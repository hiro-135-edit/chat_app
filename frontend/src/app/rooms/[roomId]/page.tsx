// /src/app/rooms/[id]/page.tsx
import type { RoomDetail } from "@/types/room";
import RoomChat from "../../components/RoomChat";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth/auth";
import { fetchBackend } from "@/lib/bff/backend";

// Next15以降ではparamsをPromise(awaitにしないといけない模様)
type Props = {
  params: Promise<{
    roomId: string; // URLパラメータは文字列で渡ってくる
  }>;
};

const fetchRoom = async (roomId: string): Promise<RoomDetail | null> => {
  const res = await fetchBackend(`/api/rooms/${roomId}`, {
    cache: "no-store",
  });

  // エラー時は null を返す（存在しないなど）
  if (!res.ok) return null;

  // 取得先が不正なJSONを返した場合も、従来どおり表示対象なしとして扱う。
  return res.json().catch(() => null);
  // {"id":1,"title":"テストルーム","created_at":"2025-12-05T10:00:00Z","user":{"id":5,"name":"山田太郎"}}
};

const RoomPage = async ({ params }: Props) => {
  // 別タブやURLの直接入力でも、データ取得前に認証を確認する。
  const session = await getServerSession(authOptions);
  if (!session?.userId) redirect("/");

  // ここでparamsをawaitしてからidを取り出す
  const { roomId } = await params;

  // 認証済みのサーバー処理からRailsへ問い合わせる。
  const room = await fetchRoom(roomId);

  if (!room) {
    return notFound();
  }

  return (
    <main className="min-h-screen bg-slate-300 flex mx-auto justify-center m-full">
      <div className="lg:w-11/12 w-full max-w-full flex flex-col border- bg-white" suppressHydrationWarning >
        <RoomChat roomId={room.id} roomTitle={room.title} roomTime={room.created_at_text} userName={room.user.name}/>
      </div>
    </main>
  );
};

export default RoomPage;

// <Link key={room.id} href={`/rooms/${room.id}`}> で設定した URL の [id] 部分が
// Next.js によって props.params に入り、ここで await してから使っている
