import { NextResponse } from "next/server";

const backendApiUrl = process.env.BACKEND_API_URL!;
const bffSharedToken = process.env.BFF_SHARED_TOKEN!;

type BackendRequestInit = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
};

// 認証・入力検証は各ルートが行い、ここでは Rails への通信だけを扱う。
export function fetchBackend(path: string, options: BackendRequestInit = {}) {
  return fetch(`${backendApiUrl}${path}`, {
    ...options,
    headers: {
      "X-BFF-Token": bffSharedToken,
      ...options.headers,
    },
  });
}

type JsonResponseOptions = {
  successStatus?: number;
  successFallback?: unknown;
};

export async function backendJsonResponse(
  response: Response,
  { successStatus, successFallback = null }: JsonResponseOptions = {},
) {
  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    return NextResponse.json(data ?? { error: "rails_error" }, {
      status: response.status,
    });
  }

  return NextResponse.json(data ?? successFallback, {
    status: successStatus ?? response.status,
  });
}
