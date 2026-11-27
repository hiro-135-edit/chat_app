import { NextRequest } from 'next/server';
const mockSession = jest.fn();
jest.mock('next-auth', () => ({ getServerSession: () => mockSession() }));
jest.mock('@/lib/nextauth/auth', () => ({ authOptions: {} }));
let fetchMock: jest.Mock;
let routes: {
    login: typeof import('@/app/api/bff/auth/login/route');
    signup: typeof import('@/app/api/bff/auth/signup/route');
    upsert: typeof import('@/app/api/bff/auth/upsert/route');
    profile: typeof import('@/app/api/bff/profile/route');
    user: typeof import('@/app/api/bff/user/route');
    password: typeof import('@/app/api/bff/auth/password/route');
};
const request = (method: string, body?: unknown, raw?: string) => new NextRequest('http://front.test/api/bff/test', {
    method, headers: { 'Content-Type': 'application/json' }, body: raw ?? JSON.stringify(body ?? {}),
});
beforeEach(async () => {
    jest.resetModules();
    process.env.BACKEND_API_URL = 'http://rails.test';
    process.env.BFF_SHARED_TOKEN = 'test-token';
    mockSession.mockReset().mockResolvedValue({ userId: '12' });
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    jest.spyOn(console, 'error').mockImplementation(() => { });
    routes = {
        login: await import('@/app/api/bff/auth/login/route'), signup: await import('@/app/api/bff/auth/signup/route'),
        upsert: await import('@/app/api/bff/auth/upsert/route'), profile: await import('@/app/api/bff/profile/route'),
        user: await import('@/app/api/bff/user/route'), password: await import('@/app/api/bff/auth/password/route'),
    };
});
afterEach(() => jest.restoreAllMocks());
it.each(['login', 'signup', 'upsert', 'profile', 'user'] as const)('%s rejects missing server configuration', async (route) => {
    delete process.env.BACKEND_API_URL;
    const response = route === 'profile' ? await routes.profile.PATCH(request('PATCH'))
        : route === 'user' ? await routes.user.DELETE(request('DELETE')) : await routes[route].POST(request('POST'));
    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await response.json()).toHaveProperty('error');
});
it.each([null, {}, { userId: '' }])('profile and deletion reject unusable session %j', async (session) => {
    mockSession.mockResolvedValue(session);
    for (const response of [await routes.profile.PATCH(request('PATCH')), await routes.user.DELETE(request('DELETE'))]) {
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: 'unauthorized' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
});
it.each([200, 401, 422])('login filters fields and relays upstream status %i', async (status) => {
    const body = status === 200 ? { id: 12 } : { error: 'invalid_credentials' };
    fetchMock.mockResolvedValue(Response.json(body, { status }));
    const response = await routes.login.POST(request('POST', { email: 'a@example.com', password: 'Password123', user_id: '999', admin: true }));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 'a@example.com', password: 'Password123' });
});
it('login preserves a null non-JSON response and does not create an identity', async () => {
    fetchMock.mockResolvedValue(new Response('unavailable', { status: 502 }));
    expect(await (await routes.login.POST(request('POST'))).json()).toBeNull();
});
it('documents unhandled malformed login input without forwarding it', async () => {
    await expect(routes.login.POST(request('POST', undefined, '{'))).rejects.toMatchObject({ name: 'SyntaxError' });
    expect(fetchMock).not.toHaveBeenCalled();
});
it('signup rejects malformed JSON before contacting Rails', async () => {
    const response = await routes.signup.POST(request('POST', undefined, '{'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Request body must be JSON' });
    expect(fetchMock).not.toHaveBeenCalled();
});
it.each(['', 'null', '{}'])('signup handles empty or absent fields (%s)', async (body) => {
    fetchMock.mockResolvedValue(Response.json({ error: 'missing_email' }, { status: 422 }));
    const response = await routes.signup.POST(request('POST', undefined, body));
    expect(response.status).toBe(422);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({});
});
it('signup forwards allowed attributes, JSON content type and validation errors', async () => {
    fetchMock.mockResolvedValue(Response.json({ error_codes: ['email_duplication'] }, { status: 409 }));
    const response = await routes.signup.POST(request('POST', { name: 'Alice', email: 'a@example.com', password: 'Password123', admin: true }));
    expect(response.status).toBe(409);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: 'Alice', email: 'a@example.com', password: 'Password123' });
    expect(fetchMock.mock.calls[0][1].redirect).toBe('manual');
});
it.each(['upstream error', ''])('signup describes a non-JSON upstream response (%s)', async (text) => {
    const upstream = new Response(text, { status: 502, headers: { location: '/unavailable' } });
    upstream.headers.delete('content-type');
    fetchMock.mockResolvedValue(upstream);
    const response = await routes.signup.POST(request('POST'));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: text || 'Upstream returned non-JSON', upstreamStatus: 502, upstreamContentType: '', location: '/unavailable' });
});
it('signup returns a generic 500 on network failure', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const response = await routes.signup.POST(request('POST'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'BFF internal error' });
});
it('upsert requires configured shared credentials', async () => {
    delete process.env.BFF_SHARED_TOKEN;
    const response = await routes.upsert.POST(request('POST'));
    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
});
it.each([201, 204, 422])('upsert relays status %i and empty bodies', async (status) => {
    const body = status === 204 ? null : '{"railsUserId":12}';
    fetchMock.mockResolvedValue(new Response(body, { status }));
    const response = await routes.upsert.POST(request('POST', { provider: 'google', providerSub: 'sub' }));
    expect(response.status).toBe(status);
    expect(await response.text()).toBe(body ?? '');
});
it.each([new Error('offline'), 'connection unavailable'])('upsert translates thrown transport errors to 502', async (error) => {
    fetchMock.mockRejectedValue(error);
    const response = await routes.upsert.POST(request('POST'));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: error instanceof Error ? error.message : error });
});
it('documents that OAuth upsert currently forwards unauthenticated requests (security finding)', async () => {
    mockSession.mockResolvedValue(null);
    fetchMock.mockResolvedValue(Response.json({ railsUserId: 12 }));
    await routes.upsert.POST(request('POST', { provider: 'google', providerSub: 'forged', email: 'victim@example.com' }));
    expect(mockSession).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('http://rails.test/api/auth/upsert', expect.objectContaining({ headers: { 'Content-Type': 'application/json', 'X-BFF-Token': 'test-token' } }));
});
it.each([200, 422])('profile always addresses the session user and preserves status %i', async (status) => {
    fetchMock.mockResolvedValue(new Response('{"name":"Alice"}', { status }));
    const response = await routes.profile.PATCH(request('PATCH', { name: 'Alice', email: 'a@example.com', user_id: '999', id: '999' }));
    expect(response.status).toBe(status);
    expect(fetchMock).toHaveBeenCalledWith('http://rails.test/api/users/12', expect.objectContaining({ body: JSON.stringify({ name: 'Alice', email: 'a@example.com' }) }));
});
it('documents malformed profile JSON as a rejected request before transport', async () => {
    await expect(routes.profile.PATCH(request('PATCH', undefined, '{'))).rejects.toMatchObject({ name: 'SyntaxError' });
    expect(fetchMock).not.toHaveBeenCalled();
});
it.each(['profile', 'user'] as const)('%s retains the empty shared-token fallback', async (route) => {
    delete process.env.BFF_SHARED_TOKEN;
    fetchMock.mockResolvedValue(Response.json({}));
    if (route === 'profile')
        await routes.profile.PATCH(request('PATCH'));
    else
        await routes.user.DELETE(request('DELETE', { current_password: 'Password123' }));
    expect(fetchMock.mock.calls[0][1].headers['X-BFF-Token']).toBe('');
});
it.each(['{}', '{', '{"current_password":""}'])('deletion rejects absent/malformed password (%s)', async (body) => {
    const response = await routes.user.DELETE(request('DELETE', undefined, body));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
});
it('deletion trims the base URL and uses only the authenticated identity', async () => {
    process.env.BACKEND_API_URL = 'http://rails.test/';
    fetchMock.mockResolvedValue(Response.json({ message: 'account_deleted' }));
    const response = await routes.user.DELETE(request('DELETE', { current_password: 'Password123', user_id: '999' }));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith('http://rails.test/api/user', expect.objectContaining({ headers: expect.objectContaining({ 'X-User-Id': '12' }), body: JSON.stringify({ current_password: 'Password123' }) }));
});
it.each([
    [null, {}, 401, 'unauthorized'], [{}, {}, 400, 'no_user_id'],
    [{ userId: '12' }, {}, 400, 'missing_current_password'],
    [{ userId: '12' }, { current_password: 'old' }, 400, 'missing_password'],
    [{ userId: '12' }, { current_password: 'old', password: 'new' }, 400, 'missing_password_confirmation'],
])('password checks session and missing fields in order (%j, %j)', async (session, body, status, error) => {
    mockSession.mockResolvedValue(session);
    const response = await routes.password.PATCH(request('PATCH', body));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
    expect(fetchMock).not.toHaveBeenCalled();
});
it('password reports transport failures without revealing their details', async () => {
    fetchMock.mockRejectedValue(new Error('internal connection detail'));
    const response = await routes.password.PATCH(request('PATCH', { current_password: 'old', password: 'new', password_confirmation: 'new' }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'BFF internal error' });
});
it('password handles invalid JSON as missing input', async () => {
    const response = await routes.password.PATCH(request('PATCH', undefined, '{'));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
});
