import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSession, signIn, signOut } from 'next-auth/react';
import LoginModal from '@/app/components/LoginModal';
import ProfileForm from '@/app/components/ProfileForm';
import AuthPassword from '@/app/components/AuthPassword';
import DeleteAccountModal from '@/app/components/DeleteAccountModal';
import SettingTabs from '@/app/components/SettingTabs';
import DeleteTab from '@/app/components/DeleteTab';
import { toast } from '@/lib/toastPopup';
import { deferred, jsonResponse, renderUI } from '../../../helpers/ui';
jest.mock('next-auth/react', () => ({ useSession: jest.fn(), signIn: jest.fn(), signOut: jest.fn() }));
jest.mock('@/lib/toastPopup', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
const update = jest.fn();
let fetchMock: jest.Mock;
const submit = (buttonName: string) => fireEvent.submit(screen.getByRole('button', { name: buttonName }).closest('form')!);
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
beforeEach(() => {
    jest.clearAllMocks();
    (useSession as jest.Mock).mockReturnValue({ data: { userId: '1' }, status: 'authenticated', update });
    update.mockResolvedValue({});
    (signIn as jest.Mock).mockResolvedValue({ ok: true });
    (signOut as jest.Mock).mockResolvedValue(undefined);
    fetchMock = jest.fn().mockResolvedValue(jsonResponse({}));
    global.fetch = fetchMock;
    jest.spyOn(console, 'error').mockImplementation(() => { });
    jest.spyOn(console, 'log').mockImplementation(() => { });
});
afterEach(() => jest.restoreAllMocks());
describe('login and registration', () => {
    it.each([
        ['invalid_credentials', 'メールアドレスまたはパスワードが正しくありません。'],
        ['unknown', '登録またはログインに失敗しました。'],
    ])('keeps login open and explains %s', async (error, text) => {
        const close = jest.fn();
        (signIn as jest.Mock).mockResolvedValue({ error });
        renderUI(<LoginModal opened onClose={close}/>);
        const panel = screen.getByRole('tabpanel', { name: 'メールでログイン' });
        fireEvent.change(within(panel).getByLabelText('メール', { exact: false }), { target: { value: 'test@example.com' } });
        fireEvent.change(within(panel).getByLabelText('パスワード', { exact: false }), { target: { value: 'wrong' } });
        submit('ログイン');
        expect(await screen.findByText(text)).toBeInTheDocument();
        expect(close).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'ログイン' })).toBeEnabled();
    });
    it('submits credentials once while pending and closes after successful login', async () => {
        const pending = deferred<{
            ok: boolean;
        }>();
        (signIn as jest.Mock).mockReturnValue(pending.promise);
        const close = jest.fn();
        renderUI(<LoginModal opened onClose={close}/>);
        const panel = screen.getByRole('tabpanel', { name: 'メールでログイン' });
        fireEvent.change(within(panel).getByLabelText('メール', { exact: false }), { target: { value: 'test@example.com' } });
        fireEvent.change(within(panel).getByLabelText('パスワード', { exact: false }), { target: { value: 'Password123' } });
        await userEvent.click(screen.getByRole('button', { name: 'ログイン' }));
        expect(screen.getByRole('button', { name: 'ログイン' })).toBeDisabled();
        expect(signIn).toHaveBeenCalledWith('credentials', { email: 'test@example.com', password: 'Password123', mode: 'login', redirect: false });
        await act(async () => pending.resolve({ ok: true }));
        expect(close).toHaveBeenCalledTimes(1);
    });
    it.each(['google', 'twitter'])('starts %s OAuth with the home callback', async (provider) => {
        renderUI(<LoginModal opened onClose={jest.fn()}/>);
        await userEvent.click(screen.getByRole('button', { name: provider === 'google' ? 'Googleでログイン' : 'Xでログイン' }));
        expect(signIn).toHaveBeenCalledWith(provider, { callbackUrl: '/' });
    });
    it.each([
        ['REGISTER_OK', '確認メールを送信しました。メール内リンクを開いてからログインしてください。'],
        ['email_duplication', 'このメールアドレスは既に登録されています。'],
        [undefined, null],
    ])('handles registration result %s and preserves the submitted identity', async (error, text) => {
        (signIn as jest.Mock).mockResolvedValue({ error });
        renderUI(<LoginModal opened onClose={jest.fn()}/>);
        await userEvent.click(screen.getByRole('tab', { name: '新規登録' }));
        const panel = screen.getByRole('tabpanel', { name: '新規登録' });
        for (const [label, value] of [['名前', 'Alice'], ['メール', 'alice@example.com'], ['パスワード', 'Password123']]) {
            fireEvent.change(within(panel).getByLabelText(label, { exact: false }), { target: { value } });
        }
        submit('登録');
        await waitFor(() => expect(screen.getByRole('button', { name: '登録' })).toBeEnabled());
        expect(signIn).toHaveBeenCalledWith('credentials', { name: 'Alice', email: 'alice@example.com', password: 'Password123', mode: 'register', redirect: false });
        if (text)
            expect(screen.getByText(text)).toBeInTheDocument();
        if (error === 'REGISTER_OK') {
            await userEvent.click(screen.getByRole('tab', { name: 'メールでログイン' }));
            expect(within(screen.getByRole('tabpanel', { name: 'メールでログイン' })).getByLabelText('メール', { exact: false })).toHaveValue('alice@example.com');
        }
    });
    it('uses browser-required/email validation before invoking signIn', async () => {
        renderUI(<LoginModal opened onClose={jest.fn()}/>);
        await userEvent.click(screen.getByRole('button', { name: 'ログイン' }));
        expect(signIn).not.toHaveBeenCalled();
    });
});
describe('profile', () => {
    const renderProfile = (email = 'alice@example.com') => renderUI(<ProfileForm initialName="Alice" initialEmail={email} userId="1"/>);
    it.each(['oauth-google-123@example.invalid', ' OAUTH-X-123@example.invalid '])('warns about placeholder address %s', (email) => {
        renderProfile(email);
        expect(screen.getByText(/現在のメールアドレスは仮/)).toBeInTheDocument();
    });
    it('saves edited fields and updates the session only after the API succeeds', async () => {
        const pending = deferred<Response>();
        fetchMock.mockReturnValue(pending.promise);
        renderProfile();
        change('ユーザー名', 'Bob');
        change('メールアドレス', 'bob@example.com');
        submit('更新');
        submit('更新中...');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(update).not.toHaveBeenCalled();
        await act(async () => pending.resolve(jsonResponse({})));
        expect(update).toHaveBeenCalledWith({ name: 'Bob', email: 'bob@example.com' });
        expect(fetchMock).toHaveBeenCalledWith('/api/bff/profile', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: 'Bob', email: 'bob@example.com' }) }));
        expect(toast.success).toHaveBeenCalled();
    });
    it.each(['validation', 'invalid-json', 'network', 'session'])('retains edits and restores retry after %s failure', async (failure) => {
        if (failure === 'validation')
            fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid_email' }, 422));
        if (failure === 'invalid-json')
            fetchMock.mockResolvedValue({ ok: false, json: async () => { throw new SyntaxError(); } });
        if (failure === 'network')
            fetchMock.mockRejectedValue(new Error('offline'));
        if (failure === 'session')
            update.mockRejectedValueOnce(new Error('session failed'));
        renderProfile();
        change('ユーザー名', 'Changed');
        submit('更新');
        await waitFor(() => expect(toast.error).toHaveBeenCalled());
        expect(screen.getByLabelText('ユーザー名')).toHaveValue('Changed');
        expect(screen.getByRole('button', { name: '更新' })).toBeEnabled();
        expect(toast.success).not.toHaveBeenCalled();
    });
});
describe('password decision table', () => {
    const fill = (current: string, next: string, confirmation: string) => {
        change('現在のパスワード', current);
        change('新しいパスワード', next);
        change('新しいパスワード（確認）', confirmation);
    };
    it.each([
        ['', '', '', '現在のパスワードを入力してください'],
        ['   ', 'Next1234', 'Next1234', '現在のパスワードを入力してください'],
        ['Old12345', ' ', 'Next1234', '新しいパスワードを入力してください'],
        ['Old12345', 'Next1234', ' ', '確認用の新しいパスワードを入力してください'],
        ['Old12345', 'Next1234', 'Other123', '新しいパスワードが確認用と一致していません'],
        ['Old12345', 'Old12345', 'Old12345', '現在のパスワードとは別の新しいパスワードを入力してください'],
    ])('rejects invalid combination (%s, %s, %s) before transport', (a, b, c, error) => {
        renderUI(<AuthPassword />);
        fill(a, b, c);
        submit('パスワードを変更');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith(error);
    });
    it('prevents duplicate requests then clears all secrets after success', async () => {
        const pending = deferred<Response>();
        fetchMock.mockReturnValue(pending.promise);
        renderUI(<AuthPassword />);
        fill('Old12345', 'Next1234', 'Next1234');
        submit('パスワードを変更');
        fireEvent.submit(screen.getByLabelText('現在のパスワード').closest('form')!);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await act(async () => pending.resolve(jsonResponse({ message: 'password_updated' })));
        for (const label of ['現在のパスワード', '新しいパスワード', '新しいパスワード（確認）'])
            expect(screen.getByLabelText(label)).toHaveValue('');
        expect(toast.success).toHaveBeenCalledWith('パスワードを変更しました');
    });
    it.each(['rejected', 'invalid-json', 'offline'])('keeps the form available after %s', async (kind) => {
        if (kind === 'rejected')
            fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid_password' }, 401));
        if (kind === 'invalid-json')
            fetchMock.mockResolvedValue({ ok: false, json: async () => { throw new SyntaxError(); } });
        if (kind === 'offline')
            fetchMock.mockRejectedValue(new Error('offline'));
        renderUI(<AuthPassword />);
        fill('Old12345', 'Next1234', 'Next1234');
        submit('パスワードを変更');
        await waitFor(() => expect(toast.error).toHaveBeenCalled());
        expect(screen.getByLabelText('現在のパスワード')).toHaveValue('Old12345');
        expect(screen.getByRole('button', { name: 'パスワードを変更' })).toBeEnabled();
    });
});
describe('account deletion and logout', () => {
    const renderDelete = (close = jest.fn()) => renderUI(<DeleteAccountModal opened onClose={close}/>);
    const password = (value: string) => fireEvent.change(screen.getByLabelText(/現在のパスワード/), { target: { value } });
    it('does not delete for a whitespace-only password', () => {
        renderDelete();
        password(' ');
        submit('アカウントを削除');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalled();
    });
    it('deletes first, blocks repeat submission and signs out even if the legacy logout endpoint fails', async () => {
        const pending = deferred<Response>();
        fetchMock.mockReturnValueOnce(pending.promise).mockRejectedValueOnce(new Error('logout unavailable'));
        renderDelete();
        password('Password123');
        submit('アカウントを削除');
        fireEvent.submit(screen.getByLabelText(/現在のパスワード/).closest('form')!);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(signOut).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'キャンセル' })).toBeDisabled();
        await act(async () => pending.resolve(jsonResponse({ message: 'account_deleted' })));
        expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/' });
        expect(fetchMock.mock.calls[0]).toEqual(['/api/bff/user', expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ current_password: 'Password123' }) })]);
    });
    it.each(['wrong-password', 'invalid-json', 'offline'])('preserves the account session after %s', async (kind) => {
        if (kind === 'wrong-password')
            fetchMock.mockResolvedValue(jsonResponse({ error: 'current_password_is_invalid' }, 401));
        if (kind === 'invalid-json')
            fetchMock.mockResolvedValue({ ok: false, json: async () => { throw new SyntaxError(); } });
        if (kind === 'offline')
            fetchMock.mockRejectedValue(new Error('offline'));
        renderDelete();
        password('wrong');
        submit('アカウントを削除');
        await waitFor(() => expect(toast.error).toHaveBeenCalled());
        expect(signOut).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'キャンセル' })).toBeEnabled();
    });
    it('clears the password when cancelled', async () => {
        const close = jest.fn();
        renderDelete(close);
        password('Password123');
        await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
        expect(close).toHaveBeenCalled();
        expect(screen.getByLabelText(/現在のパスワード/)).toHaveValue('');
    });
    it('allows logout despite the absent Rails logout proxy', async () => {
        fetchMock.mockRejectedValue(new Error('offline'));
        renderUI(<DeleteTab />);
        submit('ログアウト');
        await waitFor(() => expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/' }));
    });
    it('reports a failed signOut and permits retry', async () => {
        (signOut as jest.Mock).mockRejectedValueOnce(new Error('session failed'));
        renderUI(<DeleteTab />);
        submit('ログアウト');
        expect(await screen.findByText(/ログアウトに失敗しました/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'ログアウト' })).toBeEnabled();
    });
    it('switches profile/password/deletion tabs and opens then closes the deletion dialog', async () => {
        renderUI(<SettingTabs initialName="Alice" initialEmail="a@example.com" userId="1"/>);
        await userEvent.click(screen.getByRole('button', { name: '認証とパスワード' }));
        expect(screen.getByLabelText('現在のパスワード')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'ログアウトとアカウント削除' }));
        await userEvent.click(screen.getByRole('button', { name: 'アカウント削除' }));
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
        await userEvent.click(screen.getByRole('button', { name: 'プロフィール' }));
        expect(screen.getByLabelText('ユーザー名')).toHaveValue('Alice');
    });
});
