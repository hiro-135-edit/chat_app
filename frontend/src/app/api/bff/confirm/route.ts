import { NextResponse } from "next/server";
import { backendJsonResponse, fetchBackend } from "@/lib/bff/backend";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "missing_token" }, { status: 400 });
  }

  const railsRes = await fetchBackend(
    `/api/confirm?token=${encodeURIComponent(token)}`,
    {
      cache: "no-store",
    }
  );

  return backendJsonResponse(railsRes, {
    successFallback: { error: "rails_error" },
  });
}
