'use client';

import { useEffect, useRef, useState } from 'react';
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

  // Keep callback current without putting it in the effect dep array
  // (avoids closing/reopening the socket on every parent render).
  const callbackRef = useRef(onMessage);
  callbackRef.current = onMessage;

  useEffect(() => {
    const base = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(
      /^http/,
      'ws',
    );
    const url = `${base}/ws/events`;
    let cancelled = false;

    function open() {
      if (cancelled) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!cancelled) setConnected(true);
      };

      ws.onmessage = ({ data }) => {
        try {
          callbackRef.current?.(JSON.parse(data) as WsMessage);
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
