import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth/auth";
import { backendJsonResponse, fetchBackend } from "@/lib/bff/backend";

// 既存の作成用エンドポイントを維持し、処理は一覧ルートと共有する。
export { POST } from "../route";

type Params = Promise<{ roomId: string }>;

export async function GET(
  req: NextRequest,
  { params }: { params: Params },
) {
  const session = await getServerSession(authOptions);
  if (!session?.userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { roomId } = await params;
  const railsRes = await fetchBackend(`/api/rooms/${roomId}`, {
    cache: "no-store",
  });

  return backendJsonResponse(railsRes, { successStatus: 200 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Params },
) {
  const { roomId } = await params;
  const session = await getServerSession(authOptions);
  if (!session)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const userId = session.userId;
  if (!userId)
    return NextResponse.json({ error: "no_user_id" }, { status: 400 });

  const railsRes = await fetchBackend(`/api/rooms/${roomId}`, {
    method: "DELETE",
    headers: {
      "X-User-Id": String(userId),
    },
    cache: "no-store",
  });

  return backendJsonResponse(railsRes, {
    successStatus: 200,
    successFallback: { ok: true },
  });
}
