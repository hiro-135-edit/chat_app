const mockGetServerSession = jest.fn();
const mockRedirect = jest.fn();
const mockNotFound = jest.fn();

jest.mock("next-auth", () => ({
  getServerSession: () => mockGetServerSession(),
}));
jest.mock("next/navigation", () => ({
  redirect: (path: string) => mockRedirect(path),
  notFound: () => mockNotFound(),
}));
jest.mock("@/lib/nextauth/auth", () => ({ authOptions: {} }));
jest.mock("@/app/components/RoomChat", () => ({
  __esModule: true,
  default: () => null,
}));

describe("room page authentication", () => {
  let RoomPage: typeof import("@/app/rooms/[roomId]/page").default;
  let fetchMock: jest.Mock;
  const redirectError = new Error("redirect to home");
  const notFoundError = new Error("room not found");
  const params = () => ({ params: Promise.resolve({ roomId: "7" }) });

  beforeEach(async () => {
    jest.resetModules();
    process.env.BACKEND_API_URL = "http://rails.test";
    process.env.BFF_SHARED_TOKEN = "test-token";
    mockGetServerSession.mockReset().mockResolvedValue({ userId: "10" });
    mockRedirect.mockReset().mockImplementation(() => { throw redirectError; });
    mockNotFound.mockReset().mockImplementation(() => { throw notFoundError; });
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock;
    RoomPage = (await import("@/app/rooms/[roomId]/page")).default;
  });

  it.each([null, {}, { userId: "" }])("redirects before fetching room data without a valid session (%s)", async (session) => {
    mockGetServerSession.mockResolvedValue(session);

    await expect(RoomPage(params())).rejects.toBe(redirectError);

    expect(mockRedirect).toHaveBeenCalledWith("/");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it("renders the room for an authenticated user using a fresh server-side request", async () => {
    fetchMock.mockResolvedValue(Response.json({
      id: 7,
      title: "Room",
      created_at_text: "2026/11/27 12:00",
      user: { id: 10, name: "Alice" },
    }));

    const page = await RoomPage(params());

    expect(page.type).toBe("main");
    expect(mockGetServerSession).toHaveBeenCalledTimes(1);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("http://rails.test/api/rooms/7", {
      cache: "no-store",
      headers: { "X-BFF-Token": "test-token" },
    });
  });

  it.each([404, 503])("preserves the existing not-found behavior for an upstream %i", async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));

    await expect(RoomPage(params())).rejects.toBe(notFoundError);

    expect(mockGetServerSession).toHaveBeenCalledTimes(1);
    expect(mockNotFound).toHaveBeenCalledTimes(1);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("preserves the not-found behavior for an invalid upstream JSON response", async () => {
    fetchMock.mockResolvedValue(new Response("not JSON", { status: 200 }));

    await expect(RoomPage(params())).rejects.toBe(notFoundError);

    expect(mockNotFound).toHaveBeenCalledTimes(1);
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
