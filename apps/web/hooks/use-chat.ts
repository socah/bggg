'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { io, type Socket } from 'socket.io-client';
import type { ChatMessage } from '@/lib/types';

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

export function useChat(threadId: string | null) {
  const { data: session } = useSession();
  const socketRef = useRef<Socket | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(Boolean(threadId));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!threadId || !session?.accessToken) return;

    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || undefined;
    const socket = io(socketUrl, {
      auth: { token: session.accessToken },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setReady(false);
      setError(null);
      socket.emit('join-chat', { threadId });
    });
    socket.on('disconnect', () => {
      setConnected(false);
      setReady(false);
    });
    socket.on('connect_error', () => {
      setConnected(false);
      setLoading(false);
      setError('Unable to connect to chat');
    });
    socket.on(
      'chat-history',
      (payload: { threadId: string; messages: ChatMessage[] }) => {
        if (payload.threadId !== threadId) return;
        setMessages((current) => mergeMessages(current, payload.messages));
        setLoading(false);
        setReady(true);
      },
    );
    socket.on('new-message', (message: ChatMessage) => {
      if (message.threadId !== threadId) return;
      setMessages((current) => mergeMessages(current, [message]));
    });
    socket.on('exception', (payload: { message?: string } | string) => {
      setLoading(false);
      setError(typeof payload === 'string' ? payload : (payload.message ?? 'Chat request failed'));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [threadId, session?.accessToken]);

  function send(body: string): Promise<boolean> {
    const socket = socketRef.current;
    if (!socket?.connected || !ready || !threadId || !body.trim()) return Promise.resolve(false);

    setSending(true);
    setError(null);
    return new Promise((resolve) => {
      socket.timeout(10_000).emit(
        'send-message',
        { threadId, body: body.trim() },
        (timeoutError: Error | null) => {
          setSending(false);
          if (timeoutError) {
            setError('Message was not sent. Please try again.');
            resolve(false);
            return;
          }
          resolve(true);
        },
      );
    });
  }

  return { messages, connected, ready, loading, sending, error, send };
}
