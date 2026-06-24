'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { WsMessage } from '@/lib/types';

interface UseWebSocketOptions {
  onMessage?: (msg: WsMessage) => void;
  /** Milliseconds before attempting to reconnect after a drop. Default: 3000 */
  reconnectDelay?: number;
}

export function useWebSocket({
  onMessage,
  reconnectDelay = 3000,
}: UseWebSocketOptions = {}) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const callbackRef = useRef(onMessage);
  callbackRef.current = onMessage;

  useEffect(() => {
    const base = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(
      /^http/,
      'ws',
    );
    let cancelled = false;

    async function open() {
      if (cancelled) return;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        timerRef.current = setTimeout(open, reconnectDelay);
        return;
      }

      const url = `${base}/ws/events?token=${encodeURIComponent(session.access_token)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!cancelled) setConnected(true);
      };

      ws.onmessage = ({ data }) => {
        try {
          const raw = JSON.parse(data) as WsMessage;
          if (raw.type === 'batch') {
            for (const m of raw.messages) callbackRef.current?.(m);
          } else {
            callbackRef.current?.(raw);
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (!cancelled) {
          setConnected(false);
          timerRef.current = setTimeout(open, reconnectDelay);
        }
      };

      ws.onerror = () => ws.close();
    }

    open();

    return () => {
      cancelled = true;
      clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [reconnectDelay]);

  return { connected };
}
