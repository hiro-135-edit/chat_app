"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRoomMessages, type Message } from "@/hooks/useRoomMessages";

type RoomChatProps = {
  roomId: number;
  roomTitle: string;
  roomTime: string;
  userName: string;
};

type MenuState = {
  messageId: number;
  x: number;
  y: number;
} | null;

const jstFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const formatJst = (iso: string) => jstFormatter.format(new Date(iso));

const RoomChat = ({ roomId, roomTitle, userName }: RoomChatProps) => {
  // -----------------------------
  // state / ref
  // -----------------------------
  const [menu, setMenu] = useState<MenuState>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const shouldJumpRef = useRef(true);
  const requestScrollToBottom = useCallback(() => {
    shouldJumpRef.current = true;
  }, []);
  const {
    messages,
    text,
    setText,
    busy,
    editingId,
    startEdit,
    cancelEdit,
    deleteMessage,
    submitMessage,
  } = useRoomMessages(roomId, requestScrollToBottom);

  // -----------------------------
  // derived data
  // -----------------------------
  let selectedMessage: Message | null = null;

  if (menu) {
    selectedMessage =
      messages.find((message) => message.id === menu.messageId) ?? null;
  }

  // -----------------------------
  // ui helper
  // -----------------------------
  const closeMenu = () => {
    setMenu(null);
  };

  const openMenu = (event: React.MouseEvent, message: Message) => {
    if (!message.isMe) return;

    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 0) return;

    if (menu?.messageId === message.id) {
      closeMenu();
      return;
    }

    const margin = 8;
    const rawX = event.clientX;
    const rawY = event.clientY - margin;

    const menuX = Math.max(margin, Math.min(rawX, window.innerWidth - margin));
    const menuY = Math.max(margin, Math.min(rawY, window.innerHeight - margin));

    setMenu({
      messageId: message.id,
      x: menuX,
      y: menuY,
    });
  };

  const jumpToBottom = useCallback(() => {
    const listElement = listRef.current;
    if (!listElement) return;

    listElement.scrollTop = listElement.scrollHeight;
  }, []);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void submitMessage();
  };

  // -----------------------------
  // effects
  // -----------------------------
  useEffect(() => {
    if ("scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }
  }, []);

  useEffect(() => {
    if (sessionStorage.getItem("scrollToBottomAfterReload") === "1") {
      shouldJumpRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!shouldJumpRef.current) return;
    if (messages.length === 0) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        jumpToBottom();
        shouldJumpRef.current = false;
        sessionStorage.removeItem("scrollToBottomAfterReload");
      });
    });
  }, [messages.length, jumpToBottom]);

  useEffect(() => {
    document.body.classList.add("no-page-scroll");
    document.documentElement.classList.add("no-page-scroll");

    return () => {
      document.body.classList.remove("no-page-scroll");
      document.documentElement.classList.remove("no-page-scroll");
    };
  }, []);

  // -----------------------------
  // render
  // -----------------------------
  return (
    <div
      className="flex flex-col h-[100dvh] overflow-hidden"
      suppressHydrationWarning
    >
      <header className="h-12 px-3 flex justify-end items-center border-b-2 shadow-sm bg-white">
        <div className="flex justify-end min-w-0 items-center gap-4 text-sm font-semibold text-cyan-400">
          <div className="flex min-w-0 items-center gap-1 max-w-[50%]">
            <span className="shrink-0 sm:text-sm text-xs">ルーム名:</span>
            <span className="min-w-0 truncate inline-block text-slate-800 font-normal sm:text-sm text-xs">
              {roomTitle}
            </span>
          </div>

          <div className="shrink-0 whitespace-nowrap sm:text-sm text-xs">
            ルームID:{" "}
            <span className="text-slate-800 font-normal sm:text-sm text-xs">
              {roomId}
            </span>
          </div>

          <div className="shrink-0 whitespace-nowrap md:text-base sm:text-sm text-xs">
            作成者:{" "}
            <span className="text-slate-800 font-normal md:text-base sm:text-sm text-xs">
              {userName}
            </span>
          </div>
        </div>
      </header>

      <div
        ref={listRef}
        className="flex-1 min-h-0 px-3 pt-2 pb-[9rem] overflow-y-auto space-y-3 bg-slate-50"
      >
        {messages.map((message) => (
          <div
            key={message.id}
            className={`w-full flex flex-col ${
              message.isMe ? "items-start" : "items-end"
            }`}
          >
            {!message.isMe && (
              <p className="text-[9px] sm:text-sm text-cyan-400">
                ユーザー
                <span className="text-[9px] sm:text-sm text-slate-400">:</span>
                {message.userName}
              </p>
            )}

            <p
              className={`text-[9px] sm:text-sm pb-0.5 ${
                message.isMe ? "text-cyan-400 mt-2" : "text-slate-400"
              }`}
            >
              {formatJst(message.createdAt)}
              {message.editedAt && (
                <span className="ml-2 md:text-[11px] sm:text-[9px] text-[7px] text-slate-500">
                  (編集済)
                </span>
              )}
            </p>

            <div
              className={`max-w-[80%] w-fit rounded-2xl px-3 py-2 text-xm shadow-sm bg-cyan-400 ${
                message.isMe
                  ? "text-white rounded-bl-sm cursor-pointer"
                  : "text-white rounded-br-sm"
              }`}
              onClick={(event) => openMenu(event, message)}
            >
              <p className="whitespace-pre-wrap break-words md:text-base sm:text-sm text-xs">
                {message.body}
              </p>
            </div>
          </div>
        ))}

        {messages.length === 0 && (
          <p className="text-xs text-slate-500 text-center mt-8">
            まだメッセージがありません。最初の一言を送ってみましょう。
          </p>
        )}
      </div>

      {editingId !== null && (
        <div className="fixed bottom-14 lg:w-11/12 w-full left-1/2 -translate-x-1/2 px-3 z-20">
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded-t-2xl border border-slate-200 border-b-0 bg-amber-50 px-4 py-2 text-sm text-amber-700 shadow-sm">
              編集中です
            </div>
            <div className="shrink-0 w-[48px]" />
          </div>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="fixed bottom-0 lg:w-11/12 w-full left-1/2 -translate-x-1/2 h-14 px-3 flex items-center gap-2 border-t border-slate-200 bg-white z-20"
      >
        <input
          suppressHydrationWarning
          type="text"
          className="flex-1 rounded-full border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400"
          placeholder={
            editingId !== null ? "メッセージを編集..." : "メッセージを送信..."
          }
          value={text}
          onChange={(event) => setText(event.target.value)}
        />

        <button
          type="submit"
          className="text-sm font-semibold text-cyan-400 disabled:opacity-40"
          disabled={!text.trim() || busy}
        >
          {editingId !== null ? "保存" : "送信"}
        </button>

        {editingId !== null && (
          <button
            type="button"
            className="text-sm font-semibold text-slate-500"
            onClick={cancelEdit}
          >
            キャンセル
          </button>
        )}
      </form>

      {menu && selectedMessage && (
        <>
          <div className="fixed inset-0 z-40 bg-black/5" onClick={closeMenu} />

          <div
            className="fixed z-50 w-36 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
            style={{
              left: menu.x,
              top: menu.y,
              transform: "translate(-50%, -100%)",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="block w-full px-4 py-3 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              onClick={() => {
                closeMenu();
                startEdit(selectedMessage);
              }}
            >
              編集
            </button>

            <button
              type="button"
              className="block w-full border-t border-slate-100 px-4 py-3 text-left text-sm font-medium text-red-600 transition hover:bg-red-50"
              onClick={() => {
                closeMenu();
                deleteMessage(selectedMessage);
              }}
            >
              削除
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default RoomChat;
