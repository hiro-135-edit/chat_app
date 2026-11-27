// src/app/api/bff/messages/[messageId]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth/auth";
import { backendJsonResponse, fetchBackend } from "@/lib/bff/backend";

type Params = Promise<{ messageId: string }>

export async function PATCH(
  req: NextRequest,
  { params }: { params: Params },
) {
  const { messageId } = await params
  const roomId = req.nextUrl.searchParams.get('roomId')
  const session = await getServerSession(authOptions);
  if (!session)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const userId = session.userId;
  if (!userId)
    return NextResponse.json({ error: "no_user_id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  if (!body?.body)
    return NextResponse.json({ error: "missing_body" }, { status: 400 });

  const railsRes = await fetchBackend(
    `/api/rooms/${roomId}/messages/${messageId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": String(userId),
      },
      body: JSON.stringify({
        body: body.body,
        user_id: userId, // ← セキュリティ観点でクライアントからではなくセッションから取得
      }),
    },
  );

  return backendJsonResponse(railsRes, {
    successFallback: { error: "rails_error" },
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Params },
) {
  const { messageId } = await params;
  const roomId = req.nextUrl.searchParams.get('roomId');
  const session = await getServerSession(authOptions);
  if (!session)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const userId = session.userId;
  if (!userId)
    return NextResponse.json({ error: "no_user_id" }, { status: 400 });

  const railsRes = await fetchBackend(
    `/api/rooms/${roomId}/messages/${messageId}`,
    {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": String(userId),
      },
      cache: "no-store",
    },
  );

  return backendJsonResponse(railsRes, {
    successStatus: 200,
    successFallback: { ok: true },
  });
}
