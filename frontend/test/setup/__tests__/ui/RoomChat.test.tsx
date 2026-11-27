import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RoomChat from "@/app/components/RoomChat";
import { renderWithProviders } from "../../../render";
import { useSession } from "next-auth/react";
import { toast } from "@/lib/toastPopup";

const mockRefresh = jest.fn();

jest.mock("next-auth/react", () => ({
  ...jest.requireActual("next-auth/react"),
  useSession: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

jest.mock("@/lib/toastPopup", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const makeJsonResponse = (data: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(data),
  json: async () => data,
  headers: {
    get: (key: string) =>
      key.toLowerCase() === "content-type" ? "application/json" : null,
  },
});

const originalMessage = {
  id: 10,
  body: "hello",
  room_id: 1,
  user_id: 1,
  created_at: "2026-01-18T00:00:00.000Z",
  edited_at: null as string | null,
  user: { id: 1, name: "TestUser" },
};

const renderChat = () =>
  renderWithProviders(
    <RoomChat
      roomId={1}
      roomTitle="Test room"
      roomTime="2026-01-18T00:00:00.000Z"
      userName="TestUser"
    />,
  );

const useSessionMock = useSession as jest.Mock;
let fetchMock: jest.Mock;

describe("RoomChat", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    useSessionMock.mockReturnValue({
      data: {
        userId: "1",
        user: { name: "TestUser", email: "test@example.com" },
      },
      status: "authenticated",
    });

    let messages = [{ ...originalMessage }];
    fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (method === "GET" && url === "/api/bff/messages?roomId=1") {
        return makeJsonResponse(messages);
      }
      if (method === "POST" && url === "/api/bff/messages?roomId=1") {
        const { body } = JSON.parse(String(init?.body));
        const created = { ...originalMessage, id: 11, body };
        messages = [...messages, created];
        return makeJsonResponse(created, 201);
      }
      if (method === "PATCH" && url === "/api/bff/messages/10?roomId=1") {
        const { body } = JSON.parse(String(init?.body));
        const updated = {
          ...originalMessage,
          body,
          edited_at: "2026-01-18T00:30:00.000Z",
        };
        messages = [updated];
        return makeJsonResponse(updated);
      }
      if (method === "DELETE" && url === "/api/bff/messages/10?roomId=1") {
        messages = [];
        return makeJsonResponse(null, 204);
      }
      return makeJsonResponse({ error: "unexpected_fetch" }, 500);
    });
    global.fetch = fetchMock as typeof fetch;
  });

  it("loads messages and recognizes numeric user IDs against the string session ID", async () => {
    const user = userEvent.setup();
    renderChat();

    await user.click(await screen.findByText("hello"));

    expect(screen.getByRole("button", { name: "編集" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/bff/messages?roomId=1", {
      cache: "no-store",
    });
  });

  it("does not load messages before authentication", () => {
    useSessionMock.mockReturnValue({ data: null, status: "unauthenticated" });
    renderChat();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not offer editing for another user's message", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse([{ ...originalMessage, user_id: 2 }]),
    );
    renderChat();

    await user.click(await screen.findByText("hello"));

    expect(screen.queryByRole("button", { name: "編集" })).not.toBeInTheDocument();
  });

  it("posts trimmed text, reloads messages, and clears the input", async () => {
    const user = userEvent.setup();
    renderChat();
    await screen.findByText("hello");

    await user.type(screen.getByRole("textbox"), "  new message  ");
    await user.click(screen.getByRole("button", { name: "送信" }));

    expect(await screen.findByText("new message")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/bff/messages?roomId=1",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ roomId: 1, body: "new message" }),
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("送信しました"));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("keeps the draft after a rejected post and displays validation errors", async () => {
    const user = userEvent.setup();
    renderChat();
    await screen.findByText("hello");
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse({ errors: ["first error", "second error"] }, 422),
    );

    await user.type(screen.getByRole("textbox"), "draft");
    await user.click(screen.getByRole("button", { name: "送信" }));

    expect(toast.error).toHaveBeenCalledWith("first error\nsecond error");
    expect(screen.getByRole("textbox")).toHaveValue("draft");
    expect(screen.getByRole("button", { name: "送信" })).toBeEnabled();
    expect(screen.queryByText("draft")).not.toBeInTheDocument();
  });

  it("updates a message and leaves edit mode after saving", async () => {
    const user = userEvent.setup();
    renderChat();
    await user.click(await screen.findByText("hello"));
    await user.click(screen.getByRole("button", { name: "編集" }));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "  edited message  ");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("edited message")).toBeInTheDocument();
    expect(screen.getByText("(編集済)")).toBeInTheDocument();
    expect(screen.queryByText("編集中です")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/bff/messages/10?roomId=1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ body: "edited message" }),
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("編集しました");
  });

  it("exits edit mode without a request when the message has not changed", async () => {
    const user = userEvent.setup();
    renderChat();
    await user.click(await screen.findByText("hello"));
    await user.click(screen.getByRole("button", { name: "編集" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("編集中です")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("preserves the message and draft when the edit window has expired", async () => {
    const user = userEvent.setup();
    renderChat();
    await user.click(await screen.findByText("hello"));
    await user.click(screen.getByRole("button", { name: "編集" }));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "edited message");
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse({ error: "edit_window_expired" }, 403),
    );
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("edited message");
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
    expect(toast.error).toHaveBeenCalledWith(
      "このメッセージは送信から1時間を超えたため編集できません。",
    );
  });

  it("removes a message after a successful delete and refreshes the route", async () => {
    const user = userEvent.setup();
    renderChat();
    await user.click(await screen.findByText("hello"));
    await user.click(screen.getByRole("button", { name: "削除" }));

    await waitFor(() => expect(screen.queryByText("hello")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/bff/messages/10?roomId=1", {
      method: "DELETE",
      cache: "no-store",
    });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("削除に成功しました");
  });

  it("keeps a message when deletion fails", async () => {
    const user = userEvent.setup();
    renderChat();
    await user.click(await screen.findByText("hello"));
    fetchMock.mockResolvedValueOnce(makeJsonResponse({ error: "forbidden" }, 403));
    await user.click(screen.getByRole("button", { name: "削除" }));

    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("forbidden");
  });
});
