import type { NextAuthOptions, User, Account, Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import type { CredentialsConfig } from 'next-auth/providers/credentials';
// Exercise the real application callbacks; only the external HTTP boundary is replaced.
let options: NextAuthOptions;
let fetchMock: jest.Mock;
let authorize: CredentialsConfig['authorize'];
const credentialRequest = {} as Parameters<CredentialsConfig['authorize']>[1];
const credentials = { email: 'alice@example.com', password: 'Password123', name: 'Alice' };
const login = (input: Record<string, string> | undefined = credentials) => authorize(input, credentialRequest);
const oauthAccount = { provider: 'google', providerAccountId: 'subject-1', type: 'oauth' } as Account;
const signIn = (user: User, account: Account | null = oauthAccount) => options.callbacks!.signIn!({ user, account });
const jwt = (token: JWT, extra: Record<string, unknown> = {}) => options.callbacks!.jwt!({ token, user: undefined, account: null, ...extra } as unknown as Parameters<NonNullable<NonNullable<NextAuthOptions['callbacks']>['jwt']>>[0]);
const session = (token: JWT, user?: Session['user']) => options.callbacks!.session!({ session: { expires: '2030-01-01', user }, token } as Parameters<NonNullable<NonNullable<NextAuthOptions['callbacks']>['session']>>[0]);
beforeEach(async () => {
    jest.resetModules();
    process.env.NEXTAUTH_URL = 'http://front.test';
    process.env.BFF_SHARED_TOKEN = 'test-token';
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    jest.spyOn(console, 'error').mockImplementation(() => { });
    options = (await import('@/lib/nextauth/auth')).authOptions;
    const provider = options.providers.find((item) => item.id === 'credentials') as CredentialsConfig;
    // next-auth merges provider.options into the provider at runtime.
    authorize = (provider.options as CredentialsConfig).authorize;
});
afterEach(() => jest.restoreAllMocks());
describe('credential decisions', () => {
    const incomplete: Array<Record<string, string> | undefined> = [undefined, {}, { email: 'a@b.com' }, { password: 'secret' }, { email: '', password: 'secret' }];
    it.each(incomplete)('does not contact Rails with incomplete credentials: %j', async (input) => {
        await expect(authorize(input, credentialRequest)).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each(['login', 'register'])('sends only credential fields to the %s route and normalizes user identity', async (mode) => {
        fetchMock.mockResolvedValue(Response.json({ id: 42, name: 'Saved', email: 'saved@example.com' }));
        await expect(login({ ...credentials, mode })).resolves.toEqual({ id: '42', userId: '42', name: 'Saved', email: 'saved@example.com' });
        expect(fetchMock).toHaveBeenCalledWith(`http://front.test/api/bff/auth/${mode === 'register' ? 'signup' : 'login'}`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Alice', email: 'alice@example.com', password: 'Password123' }) }));
    });
    it.each([
        [{ error_codes: ['password_too_short', 'validation_error'], error: 'ignored' }, 'password_too_short'],
        [{ error_codes: [], error: 'invalid_credentials' }, 'invalid_credentials'],
        [{ error_codes: [] }, 'auth_failed'],
        [{}, 'auth_failed'],
    ])('selects the first useful error from %j', async (body, code) => {
        fetchMock.mockResolvedValue(Response.json(body, { status: 422 }));
        await expect(login()).rejects.toThrow(code);
    });
    it.each(['', '<html>unavailable</html>'])('reports malformed upstream errors (%s)', async (text) => {
        fetchMock.mockResolvedValue(new Response(text, { status: 502, headers: { location: '/error' } }));
        await expect(login()).rejects.toThrow('unexpected_error_502');
    });
    it.each([{}, { id: null }, { id: 1, email: '' }])('refuses successful responses without a usable identity: %j', async (data) => {
        fetchMock.mockResolvedValue(Response.json(data));
        await expect(login()).resolves.toBeNull();
    });
    it('refuses a non-JSON successful response', async () => {
        fetchMock.mockResolvedValue(new Response('not json'));
        await expect(login()).resolves.toBeNull();
    });
    it.each([true, false])('falls back to submitted name when present (%s)', async (withName) => {
        fetchMock.mockResolvedValue(Response.json({ id: 1 }));
        const input = { email: credentials.email, password: credentials.password, ...(withName ? { name: 'Alice' } : {}) };
        await expect(login(input)).resolves.toMatchObject({ email: credentials.email, name: withName ? 'Alice' : null });
    });
    it('propagates transport failure instead of inventing an authenticated user', async () => {
        fetchMock.mockRejectedValue(new Error('offline'));
        await expect(login()).rejects.toThrow('offline');
    });
});
describe('OAuth synchronization', () => {
    it.each([null, { ...oauthAccount, provider: 'credentials' }])('bypasses upsert for %j', async (account) => {
        await expect(signIn({ id: '1' }, account)).resolves.toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('rejects sign-in when Rails refuses identity synchronization', async () => {
        fetchMock.mockResolvedValue(Response.json({ error: 'invalid' }, { status: 422 }));
        await expect(signIn({ id: 'provider-id' })).resolves.toBe(false);
    });
    it.each(['Stored name', '', null])('adopts the Rails identity while handling name %j', async (name) => {
        fetchMock.mockResolvedValue(Response.json({ railsUserId: 7, railsUserName: name }));
        const user: User = { id: 'provider-id', name: 'Provider name', email: 'a@example.com' };
        await expect(signIn(user)).resolves.toBe(true);
        expect(user).toMatchObject({ userId: '7', name: name || 'Provider name' });
        expect(fetchMock).toHaveBeenCalledWith('http://front.test/api/bff/auth/upsert', expect.objectContaining({ headers: { 'Content-Type': 'application/json', 'X-BFF-Token': 'test-token' }, body: JSON.stringify({ provider: 'google', providerSub: 'subject-1', email: 'a@example.com', name: 'Provider name' }) }));
    });
    it('sends null optional profile fields and the existing empty-token fallback', async () => {
        delete process.env.BFF_SHARED_TOKEN;
        fetchMock.mockResolvedValue(Response.json({ railsUserId: 8, railsUserName: null }));
        await signIn({ id: 'provider-id' });
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ provider: 'google', providerSub: 'subject-1', email: null, name: null });
        expect(fetchMock.mock.calls[0][1].headers['X-BFF-Token']).toBe('');
    });
});
describe('JWT/session state transitions', () => {
    it('copies identity and explicit null profile fields only on sign-in', async () => {
        await expect(jwt({ userId: 'old', name: 'Old', email: 'old@example.com' }, { user: { id: '1', userId: '1', name: null, email: null } })).resolves.toMatchObject({ userId: '1', name: null, email: null });
    });
    it('keeps token fields when optional user fields are absent', async () => {
        const token = { userId: '1', name: 'Existing', email: 'e@example.com' };
        await expect(jwt({ ...token }, { user: {} })).resolves.toEqual(token);
        await expect(jwt({ ...token })).resolves.toEqual(token);
    });
    it.each([
        [{ name: 'Changed', email: 'c@example.com', userId: 'attacker' }, 'Changed', 'c@example.com'],
        [{ name: '', email: '' }, 'Original', 'o@example.com'],
        [null, 'Original', 'o@example.com'],
    ])('updates editable fields but never accepts client-supplied identity: %j', async (data, name, email) => {
        await expect(jwt({ userId: '1', name: 'Original', email: 'o@example.com' }, { trigger: 'update', session: data })).resolves.toEqual({ userId: '1', name, email });
    });
    it('ignores a session payload outside the update transition', async () => {
        await expect(jwt({ userId: '1', name: 'Original' }, { session: { name: 'Spoofed' } })).resolves.toMatchObject({ name: 'Original' });
    });
    it('prefers token profile fields while preserving the session avatar', async () => {
        await expect(session({ userId: '1', name: 'Token', email: 't@example.com' }, { name: 'Old', email: 'o@example.com', image: '/avatar' })).resolves.toMatchObject({ userId: '1', user: { name: 'Token', email: 't@example.com', image: '/avatar' } });
    });
    it('falls back to the existing session or explicit nulls', async () => {
        await expect(session({}, { name: 'Old', email: 'o@example.com' })).resolves.toMatchObject({ user: { name: 'Old', email: 'o@example.com' } });
        await expect(session({})).resolves.toMatchObject({ user: { name: null, email: null } });
    });
});
