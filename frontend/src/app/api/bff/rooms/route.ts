// /src/app/api/bff/rooms/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth/auth";
import { backendJsonResponse, fetchBackend } from "@/lib/bff/backend";

// ルーム一覧取得（ホーム画面用）
export async function GET() {
  const railsRes = await fetchBackend("/api/rooms", {
    cache: "no-store",
  });

  return backendJsonResponse(railsRes, { successStatus: 200 });
}

// ルーム作成（投稿モーダルからのPOST）
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // jwt/session に userId を入れている想定
  const userId = session.userId;
  if (!userId) {
    return NextResponse.json({ error: "no_user_id" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !body.title) {
    return NextResponse.json({ error: "missing_title" }, { status: 400 });
  }

  const railsRes = await fetchBackend("/api/rooms", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: body.title,
      user_id: userId,
    }),
  });

  return backendJsonResponse(railsRes, { successStatus: 201 });
}
