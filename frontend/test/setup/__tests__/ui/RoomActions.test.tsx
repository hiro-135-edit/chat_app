import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSession } from 'next-auth/react';
import Header from '@/app/components/Header';
import RoomsList from '@/app/components/RoomsList';
import { toast } from '@/lib/toastPopup';
import { deferred, jsonResponse, renderUI } from '../../../helpers/ui';
const mockPush = jest.fn();
const mockRefresh = jest.fn();
let mockPath = '/';
jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, refresh: mockRefresh }), usePathname: () => mockPath }));
jest.mock('@/lib/toastPopup', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
let fetchMock: jest.Mock;
beforeEach(() => {
    jest.clearAllMocks();
    mockPath = '/';
    (useSession as jest.Mock).mockReturnValue({ data: { userId: '1', user: { name: 'Alice' } }, status: 'authenticated' });
    fetchMock = jest.fn().mockResolvedValue(jsonResponse({}));
    global.fetch = fetchMock;
    jest.spyOn(console, 'error').mockImplementation(() => { });
});
afterEach(() => jest.restoreAllMocks());
const openPost = async () => {
    await userEvent.click(screen.getByRole('button', { name: '投稿する' }));
    return screen.findByRole('dialog', { name: '新規投稿' });
};
const submitPost = () => fireEvent.submit(screen.getByLabelText('タイトル').closest('form')!);
describe('header navigation and room creation', () => {
    it('waits for authentication before offering actions', () => {
        (useSession as jest.Mock).mockReturnValue({ data: null, status: 'loading' });
        renderUI(<Header onLoginClick={jest.fn()}/>);
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
    it.each(['/', '/rooms/1'])('opens login and returns home if needed (%s)', async (path) => {
        mockPath = path;
        const login = jest.fn();
        (useSession as jest.Mock).mockReturnValue({ data: null, status: 'unauthenticated' });
        renderUI(<Header onLoginClick={login}/>);
        await userEvent.click(screen.getByRole('button', { name: '投稿する' }));
        expect(toast.error).toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'ログイン / 新規登録' }));
        expect(login).toHaveBeenCalledTimes(1);
        if (path !== '/')
            expect(mockPush).toHaveBeenCalledWith('/');
    });
    it('navigates to home and profile', async () => {
        renderUI(<Header onLoginClick={jest.fn()}/>);
        await userEvent.click(screen.getByRole('button', { name: 'ホーム' }));
        expect(mockPush).toHaveBeenCalledWith('/');
        await userEvent.click(screen.getByRole('button', { name: 'Alice' }));
        expect(mockPush).toHaveBeenCalledWith('/profile');
    });
    it.each(['ホーム', 'プロフィール', '投稿する', '閉じる'])('handles mobile action %s', async (action) => {
        (useSession as jest.Mock).mockReturnValue({ data: { userId: '1' }, status: 'authenticated' });
        renderUI(<Header onLoginClick={jest.fn()}/>);
        await userEvent.click(screen.getByRole('button', { name: 'メニューを開く' }));
        const menu = await screen.findByRole('dialog', { name: 'メニュー' });
        await userEvent.click(within(menu).getByRole('button', { name: action }));
        if (action === '投稿する')
            expect(await screen.findByLabelText('タイトル')).toBeInTheDocument();
        else {
            await waitFor(() => expect(screen.queryByRole('dialog', { name: 'メニュー' })).not.toBeInTheDocument());
            if (action !== '閉じる')
                expect(mockPush).toHaveBeenCalledWith(action === 'ホーム' ? '/' : '/profile');
        }
    });
    it('opens login from the unauthenticated mobile menu', async () => {
        (useSession as jest.Mock).mockReturnValue({ data: null, status: 'unauthenticated' });
        const login = jest.fn();
        renderUI(<Header onLoginClick={login}/>);
        await userEvent.click(screen.getByRole('button', { name: 'メニューを開く' }));
        await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'ログイン / 新規登録' }));
        expect(login).toHaveBeenCalled();
    });
    it('rejects blank titles and allows cancellation', async () => {
        renderUI(<Header onLoginClick={jest.fn()}/>);
        const dialog = await openPost();
        fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: ' ' } });
        submitPost();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith('タイトルを入力してください');
        await userEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
        await waitFor(() => expect(screen.queryByLabelText('タイトル')).not.toBeInTheDocument());
    });
    it.each(['/', '/profile'])('posts once then navigates after success from %s', async (path) => {
        mockPath = path;
        const pending = deferred<Response>();
        fetchMock.mockReturnValue(pending.promise);
        renderUI(<Header onLoginClick={jest.fn()}/>);
        const dialog = await openPost();
        fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '  New room  ' } });
        submitPost();
        submitPost();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(within(dialog).getByRole('button', { name: 'キャンセル' })).toBeDisabled();
        await act(async () => pending.resolve(jsonResponse({ id: 3 }, 201)));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('投稿しました'));
        expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({ title: 'New room' }));
        if (path === '/')
            expect(mockRefresh).toHaveBeenCalledTimes(1);
        else
            expect(mockPush).toHaveBeenCalledWith('/');
    });
    it.each(['validation', 'invalid-json', 'offline'])('retains a draft and restores controls after %s', async (kind) => {
        if (kind === 'validation')
            fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid' }, 422));
        if (kind === 'invalid-json')
            fetchMock.mockResolvedValue({ ok: false, json: async () => { throw new SyntaxError(); } });
        if (kind === 'offline')
            fetchMock.mockRejectedValue(new Error('offline'));
        renderUI(<Header onLoginClick={jest.fn()}/>);
        const dialog = await openPost();
        fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: 'Draft' } });
        submitPost();
        await waitFor(() => expect(toast.error).toHaveBeenCalled());
        expect(screen.getByLabelText('タイトル')).toHaveValue('Draft');
        expect(within(dialog).getByRole('button', { name: '投稿する' })).toBeEnabled();
    });
});
describe('room ownership and deletion', () => {
    const room = { id: 1, title: 'Room', user_id: 1, created_at: '2026-01-01T00:00:00Z', user: { id: 1, name: 'Alice' } };
    it('requires login before following a room link', async () => {
        (useSession as jest.Mock).mockReturnValue({ data: null, status: 'unauthenticated' });
        const login = jest.fn();
        renderUI(<RoomsList rooms={[room]} onLoginClick={login}/>);
        await userEvent.click(screen.getByRole('link'));
        expect(login).toHaveBeenCalled();
        expect(screen.queryByLabelText('ルーム操作')).not.toBeInTheDocument();
    });
    it.each(['unauthenticated', 'loading'])('blocks middle-click navigation while %s and offers login', (status) => {
        (useSession as jest.Mock).mockReturnValue({ data: null, status });
        const login = jest.fn();
        renderUI(<RoomsList rooms={[room]} onLoginClick={login}/>);
        const event = new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true });

        fireEvent(screen.getByRole('link'), event);

        expect(event.defaultPrevented).toBe(true);
        expect(login).toHaveBeenCalledTimes(1);
        expect(toast.error).toHaveBeenCalledWith('投稿するにはログインが必要です');
    });
    it('preserves middle-click navigation for authenticated users', () => {
        const login = jest.fn();
        renderUI(<RoomsList rooms={[room]} onLoginClick={login}/>);
        const event = new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true });

        fireEvent(screen.getByRole('link'), event);

        expect(event.defaultPrevented).toBe(false);
        expect(login).not.toHaveBeenCalled();
        expect(toast.error).not.toHaveBeenCalled();
    });
    it('preserves the browser context menu on right-click', () => {
        (useSession as jest.Mock).mockReturnValue({ data: null, status: 'unauthenticated' });
        const login = jest.fn();
        renderUI(<RoomsList rooms={[room]} onLoginClick={login}/>);
        const event = new MouseEvent('auxclick', { button: 2, bubbles: true, cancelable: true });

        fireEvent(screen.getByRole('link'), event);

        expect(event.defaultPrevented).toBe(false);
        expect(login).not.toHaveBeenCalled();
    });
    it('does not offer deletion of another users room', () => {
        renderUI(<RoomsList rooms={[{ ...room, user_id: 2 }]}/>);
        expect(screen.queryByLabelText('ルーム操作')).not.toBeInTheDocument();
    });
    it('requires confirmation and removes a successfully deleted room', async () => {
        renderUI(<RoomsList rooms={[room]}/>);
        await userEvent.click(screen.getByLabelText('ルーム操作'));
        await userEvent.click(screen.getByRole('button', { name: 'いいえ' }));
        expect(fetchMock).not.toHaveBeenCalled();
        await userEvent.click(screen.getByLabelText('ルーム操作'));
        await userEvent.click(screen.getByRole('button', { name: 'はい' }));
        await waitFor(() => expect(screen.queryByText('Room')).not.toBeInTheDocument());
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('削除しました'));
        expect(mockRefresh).toHaveBeenCalled();
    });
    it.each(['forbidden', 'invalid-json', 'offline'])('documents failed deletion (%s) leaving the busy state stuck', async (kind) => {
        if (kind === 'forbidden')
            fetchMock.mockResolvedValue(jsonResponse({ error: 'forbidden' }, 403));
        if (kind === 'invalid-json')
            fetchMock.mockResolvedValue({ ok: false, json: async () => { throw new SyntaxError(); } });
        if (kind === 'offline')
            fetchMock.mockRejectedValue(new Error('offline'));
        renderUI(<RoomsList rooms={[room]}/>);
        await userEvent.click(screen.getByLabelText('ルーム操作'));
        await userEvent.click(screen.getByRole('button', { name: 'はい' }));
        await waitFor(() => expect(toast.error).toHaveBeenCalled());
        expect(screen.getByText('Room')).toBeInTheDocument();
        expect(mockRefresh).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: '削除中...' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'いいえ' })).toBeDisabled();
    });
});
