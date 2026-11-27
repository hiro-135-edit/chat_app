import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();
jest.mock("next-auth", () => ({
  getServerSession: () => mockGetServerSession(),
}));
jest.mock("@/lib/nextauth/auth", () => ({ authOptions: {} }));

describe("BFF request and response contracts", () => {
  let rooms: typeof import("@/app/api/bff/rooms/route");
  let room: typeof import("@/app/api/bff/rooms/[roomId]/route");
  let messages: typeof import("@/app/api/bff/messages/route");
  let message: typeof import("@/app/api/bff/messages/[messageId]/route");
  let confirm: typeof import("@/app/api/bff/confirm/route");
  let password: typeof import("@/app/api/bff/auth/password/route");
  let fetchMock: jest.Mock;
  const roomContext = () => ({ params: Promise.resolve({ roomId: "7" }) });
  const messageContext = () => ({ params: Promise.resolve({ messageId: "9" }) });
  const request = (path: string, method = "GET", body?: unknown) =>
    new NextRequest(`http://localhost/api/bff/${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });

  beforeEach(async () => {
    jest.resetModules();
    process.env.BACKEND_API_URL = "http://rails.test";
    process.env.BFF_SHARED_TOKEN = "test-token";
    mockGetServerSession.mockReset().mockResolvedValue({ userId: "10" });
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock;
    [rooms, room, messages, message, confirm, password] = await Promise.all([
      import("@/app/api/bff/rooms/route"),
      import("@/app/api/bff/rooms/[roomId]/route"),
      import("@/app/api/bff/messages/route"),
      import("@/app/api/bff/messages/[messageId]/route"),
      import("@/app/api/bff/confirm/route"),
      import("@/app/api/bff/auth/password/route"),
    ]);
  });

  it.each(["collection", "detail"])("preserves the %s room creation endpoint and session-derived owner", async (endpoint) => {
    fetchMock.mockResolvedValue(Response.json({ id: 7, title: "room" }, { status: 200 }));
    const handler = endpoint === "collection" ? rooms.POST : room.POST;
    const response = await handler(request("rooms", "POST", { title: "room", user_id: "999" }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: 7, title: "room" });
    expect(fetchMock).toHaveBeenCalledWith("http://rails.test/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-BFF-Token": "test-token" },
      body: JSON.stringify({ title: "room", user_id: "10" }),
    });
  });

  it.each([
    [null, { title: "room" }, 401, "unauthorized"],
    [{}, { title: "room" }, 400, "no_user_id"],
    [{ userId: "10" }, {}, 400, "missing_title"],
  ])("validates room creation before contacting Rails (%s)", async (session, body, status, error) => {
    mockGetServerSession.mockResolvedValue(session);
    const response = await rooms.POST(request("rooms", "POST", body));
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves missing_title for malformed JSON", async () => {
    const response = await room.POST(new NextRequest("http://localhost/api/bff/rooms/7", {
      method: "POST", body: "{",
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "missing_title" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([null, {}, { userId: "" }])("rejects room detail reads without a valid session (%s)", async (session) => {
    mockGetServerSession.mockResolvedValue(session);
    const response = await room.GET(request("rooms/7"), roomContext());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows authenticated room detail reads with no-store and the shared token", async () => {
    fetchMock.mockResolvedValue(Response.json({ id: 7 }, { status: 202 }));
    const response = await room.GET(request("rooms/7"), roomContext());
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("http://rails.test/api/rooms/7", {
      cache: "no-store", headers: { "X-BFF-Token": "test-token" },
    });
    expect(mockGetServerSession).toHaveBeenCalledTimes(1);
  });

  it("forwards Rails errors without replacing their status or body", async () => {
    fetchMock.mockResolvedValue(Response.json({ errors: ["invalid"] }, { status: 422 }));
    const response = await rooms.POST(request("rooms", "POST", { title: "room" }));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ errors: ["invalid"] });
  });

  it("preserves rails_error for a non-JSON upstream error", async () => {
    fetchMock.mockResolvedValue(new Response("upstream unavailable", { status: 503 }));
    const response = await rooms.GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "rails_error" });
  });

  it("preserves a null body on successful non-JSON room reads", async () => {
    fetchMock.mockResolvedValue(new Response("not json", { status: 200 }));
    const response = await rooms.GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toBeNull();
  });

  it.each(["rooms", "messages"])("maps a %s deletion with no upstream body to 200/ok", async (resource) => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const response = resource === "rooms"
      ? await room.DELETE(request("rooms/7", "DELETE"), roomContext())
      : await message.DELETE(request("messages/9?roomId=7", "DELETE"), messageContext());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      `http://rails.test/api/rooms/7${resource === "messages" ? "/messages/9" : ""}`,
      expect.objectContaining({
        method: "DELETE", cache: "no-store",
        headers: expect.objectContaining({ "X-BFF-Token": "test-token", "X-User-Id": "10" }),
      }),
    );
  });

  it("preserves a forbidden message deletion", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 }));
    const response = await message.DELETE(request("messages/9?roomId=7", "DELETE"), messageContext());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "forbidden" });
  });

  it("checks roomId before session on message reads", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await messages.GET(request("messages"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "missing_room_id" });
    expect(mockGetServerSession).not.toHaveBeenCalled();
  });

  it("preserves session-only validation on message reads", async () => {
    mockGetServerSession.mockResolvedValue({});
    fetchMock.mockResolvedValue(Response.json([]));
    const response = await messages.GET(request("messages?roomId=7"));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("http://rails.test/api/rooms/7/messages", {
      method: "GET", cache: "no-store",
      headers: { "X-BFF-Token": "test-token", "X-User-Id": "undefined" },
    });
  });

  it.each(["POST", "PATCH"])("forwards %s message identity, body and upstream status", async (method) => {
    fetchMock.mockResolvedValue(Response.json({ id: 9, body: "hello" }, { status: 202 }));
    const response = method === "POST"
      ? await messages.POST(request("messages?roomId=7", method, { body: "hello", user_id: "999" }))
      : await message.PATCH(request("messages/9?roomId=7", method, { body: "hello", user_id: "999" }), messageContext());
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ id: 9, body: "hello" });
    expect(fetchMock).toHaveBeenCalledWith(
      `http://rails.test/api/rooms/7/messages${method === "PATCH" ? "/9" : ""}`,
      {
        method,
        headers: { "Content-Type": "application/json", "X-BFF-Token": "test-token", "X-User-Id": "10" },
        body: JSON.stringify({ body: "hello", user_id: "10" }),
      },
    );
  });

  it("preserves rails_error on a successful non-JSON message response", async () => {
    fetchMock.mockResolvedValue(new Response("not json", { status: 200 }));
    const response = await messages.GET(request("messages?roomId=7"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ error: "rails_error" });
  });

  it("forwards an encoded confirmation token", async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true }));
    await confirm.GET(request("confirm?token=a%2Bb%26c"));
    expect(fetchMock).toHaveBeenCalledWith("http://rails.test/api/confirm?token=a%2Bb%26c", {
      cache: "no-store", headers: { "X-BFF-Token": "test-token" },
    });
  });

  it.each([200, 422])("retains password-specific empty-body handling (%i)", async (status) => {
    fetchMock.mockResolvedValue(new Response("not json", { status }));
    const response = await password.PATCH(request("auth/password", "PATCH", {
      current_password: "old", password: "new", password_confirmation: "new", user_id: "999",
    }));
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual(status === 200
      ? { message: "password_updated" }
      : { error: "password_update_failed" });
    expect(fetchMock).toHaveBeenCalledWith("http://rails.test/api/user/password", {
      method: "PATCH", cache: "no-store",
      headers: { "Content-Type": "application/json", "X-BFF-Token": "test-token" },
      body: JSON.stringify({ user_id: "10", current_password: "old", password: "new", password_confirmation: "new" }),
    });
  });
});
