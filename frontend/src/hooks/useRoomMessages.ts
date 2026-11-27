"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toastPopup";

export type Message = {
  id: number;
  userName: string;
  body: string;
  isMe: boolean;
  createdAt: string;
  editedAt?: string | null;
};

export function useRoomMessages(roomId: number, onMessagesLoaded: () => void) {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [originalText, setOriginalText] = useState("");

  const startEdit = (message: Message) => {
    setEditingId(message.id);
    setText(message.body);
    setOriginalText(message.body);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setText("");
    setOriginalText("");
  };

  const loadMessages = useCallback(async () => {
    const response = await fetch(`/api/bff/messages?roomId=${roomId}`, {
      cache: "no-store",
    });

    const responseText = await response.text().catch(() => "");
    let responseData = null;

    try {
      responseData = responseText ? JSON.parse(responseText) : null;
    } catch {
      responseData = null;
    }

    if (!response.ok) {
      const info = {
        status: response.status,
        contentType: response.headers.get("content-type"),
        text: responseText.slice(0, 500),
      };
      console.error("load messages failed:\n" + JSON.stringify(info, null, 2));
      return;
    }

    const myId = session?.userId;

    const messageList: Message[] = Array.isArray(responseData)
      ? responseData.map((message) => ({
          id: message.id,
          userName: message.user?.name ?? "unknown",
          body: message.body,
          isMe: myId ? String(message.user_id) === String(myId) : false,
          createdAt: message.created_at,
          editedAt: message.edited_at ?? null,
        }))
      : [];

    onMessagesLoaded();
    setMessages(messageList);
  }, [roomId, session?.userId, onMessagesLoaded]);

  const deleteMessage = async (message: Message) => {
    if (busy) return;

    setBusy(true);

    try {
      const response = await fetch(
        `/api/bff/messages/${message.id}?roomId=${roomId}`,
        {
          method: "DELETE",
          cache: "no-store",
        },
      );

      if (response.status === 204 || response.ok) {
        setMessages((prevMessages) =>
          prevMessages.filter((prevMessage) => prevMessage.id !== message.id),
        );
        toast.success("削除に成功しました");
        router.refresh();
        return;
      }

      const responseData = await response.json().catch(() => null);
      toast.error(responseData?.error ?? "削除に失敗しました");
    } catch (error) {
      console.error(error);
      toast.error("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  const updateMessage = async (trimmedText: string) => {
    if (editingId === null) return;

    if (trimmedText === originalText.trim()) {
      cancelEdit();
      return;
    }

    setBusy(true);

    try {
      const response = await fetch(
        `/api/bff/messages/${editingId}?roomId=${roomId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ body: trimmedText }),
        },
      );

      const responseData = await response.json().catch(() => null);

      if (!response.ok) {
        if (responseData?.error === "edit_window_expired") {
          toast.error(
            "このメッセージは送信から1時間を超えたため編集できません。",
          );
        } else {
          toast.error(responseData?.error ?? "編集に失敗しました");
        }
        return;
      }

      setMessages((prevMessages) =>
        prevMessages.map((message) =>
          message.id === editingId
            ? {
                ...message,
                body: responseData.body ?? trimmedText,
                editedAt: responseData.edited_at ?? new Date().toISOString(),
              }
            : message,
        ),
      );

      cancelEdit();
      toast.success("編集しました");
    } catch (error) {
      console.error(error);
      toast.error("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  const createMessage = async (trimmedText: string) => {
    setBusy(true);

    try {
      const response = await fetch(`/api/bff/messages?roomId=${roomId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, body: trimmedText }),
      });

      const responseData = await response.json().catch(() => null);

      if (!response.ok) {
        toast.error(
          responseData?.error ||
            (Array.isArray(responseData?.errors)
              ? responseData.errors.join("\n")
              : "送信に失敗しました"),
        );
        return;
      }

      setText("");

      setMessages((prevMessages) => [
        ...prevMessages,
        {
          id: responseData.id,
          userName: responseData.user?.name ?? "自分",
          body: responseData.body,
          isMe: true,
          createdAt: responseData.created_at,
          editedAt: responseData.edited_at ?? null,
        },
      ]);

      sessionStorage.setItem("scrollToBottomAfterReload", "1");
      await loadMessages();
      onMessagesLoaded();
      toast.success("送信しました");
    } catch (error) {
      console.error(error);
      toast.error("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  const submitMessage = async () => {
    const trimmedText = text.trim();
    if (!trimmedText || busy) return;

    if (editingId !== null) {
      await updateMessage(trimmedText);
      return;
    }

    await createMessage(trimmedText);
  };

  useEffect(() => {
    if (status !== "authenticated") return;
    loadMessages();
  }, [status, loadMessages]);

  return {
    messages,
    text,
    setText,
    busy,
    editingId,
    startEdit,
    cancelEdit,
    deleteMessage,
    submitMessage,
  };
}
