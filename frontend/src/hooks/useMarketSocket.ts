import { useEffect, useRef, useCallback, useState } from 'react';
import type { WsMessage } from '../types/api';

const WS_URL =
  import.meta.env.VITE_WS_URL ??
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/market`;

/** Coalesce burst quote ticks into one React update (~1 frame / 200ms). */
const QUOTE_FLUSH_MS = 200;

export interface LiveQuote {
  symbol: string;
  price: number;
  timestamp: string;
  provider: string;
}

export function useMarketSocket(symbols: string[]) {
  const wsRef = useRef<WebSocket | null>(null);
  const subscribedRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<Record<string, LiveQuote>>({});
  const flushTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});
  const [connected, setConnected] = useState(false);

  const flushQuotes = useCallback(() => {
    flushTimerRef.current = null;
    const pending = pendingRef.current;
    if (Object.keys(pending).length === 0) return;
    pendingRef.current = {};
    setQuotes((prev) => ({ ...prev, ...pending }));
  }, []);

  const queueQuote = useCallback(
    (q: LiveQuote) => {
      pendingRef.current[q.symbol] = q;
      if (flushTimerRef.current != null) return;
      flushTimerRef.current = window.setTimeout(flushQuotes, QUOTE_FLUSH_MS);
    },
    [flushQuotes],
  );

  const send = useCallback((payload: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const subscribe = useCallback(
    (syms: string[]) => {
      const upper = syms.map((s) => s.toUpperCase()).filter(Boolean);
      if (upper.length === 0) return;
      send({ action: 'subscribe', symbols: upper });
      upper.forEach((s) => subscribedRef.current.add(s));
    },
    [send],
  );

  const unsubscribe = useCallback(
    (syms: string[]) => {
      const upper = syms.map((s) => s.toUpperCase()).filter(Boolean);
      if (upper.length === 0) return;
      send({ action: 'unsubscribe', symbols: upper });
      upper.forEach((s) => subscribedRef.current.delete(s));
    },
    [send],
  );

  useEffect(() => {
    let stopped = false;
    let heartbeat: number | null = null;

    const clearHeartbeat = () => {
      if (heartbeat != null) window.clearInterval(heartbeat);
      heartbeat = null;
    };

    const connect = () => {
      if (stopped || wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (stopped) return;
        reconnectAttemptRef.current = 0;
        setConnected(true);
        const desired = [...subscribedRef.current];
        if (desired.length) ws.send(JSON.stringify({ action: 'subscribe', symbols: desired }));
        clearHeartbeat();
        heartbeat = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: 'ping' }));
        }, 20_000);
      };

      ws.onclose = () => {
        clearHeartbeat();
        if (wsRef.current === ws) wsRef.current = null;
        setConnected(false);
        if (stopped) return;
        const attempt = reconnectAttemptRef.current++;
        const delay = Math.min(15_000, 750 * 2 ** Math.min(attempt, 5)) + Math.random() * 300;
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as WsMessage;
          if (msg.type === 'quote') {
            queueQuote({
              symbol: msg.symbol,
              price: msg.price,
              timestamp: msg.timestamp,
              provider: msg.provider,
            });
          }
        } catch {
          // ignore malformed messages
        }
      };
    };

    const resume = () => {
      if (!document.hidden && (!wsRef.current || wsRef.current.readyState > WebSocket.OPEN)) connect();
    };
    connect();
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);

    return () => {
      stopped = true;
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
      clearHeartbeat();
      if (reconnectTimerRef.current != null) window.clearTimeout(reconnectTimerRef.current);
      if (flushTimerRef.current != null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [queueQuote]);

  useEffect(() => {
    const upper = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
    const prev = subscribedRef.current;
    const toAdd = upper.filter((s) => !prev.has(s));
    const toRemove = [...prev].filter((s) => !upper.includes(s));

    if (toRemove.length) unsubscribe(toRemove);
    if (toAdd.length) subscribe(toAdd);
  }, [symbols, subscribe, unsubscribe]);

  return { quotes, connected, subscribe, unsubscribe };
}
