import { useEffect, useRef, useCallback, useState } from 'react';
import type { WsMessage } from '../types/api';

const WS_URL = import.meta.env.VITE_WS_URL ?? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/market`;

export interface LiveQuote {
  symbol: string;
  price: number;
  timestamp: string;
  provider: string;
}

export function useMarketSocket(symbols: string[]) {
  const wsRef = useRef<WebSocket | null>(null);
  const subscribedRef = useRef<Set<string>>(new Set());
  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});
  const [connected, setConnected] = useState(false);

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
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      if (subscribedRef.current.size > 0) {
        subscribe([...subscribedRef.current]);
      }
    };

    ws.onclose = () => setConnected(false);

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as WsMessage;
        if (msg.type === 'quote') {
          setQuotes((prev) => ({
            ...prev,
            [msg.symbol]: {
              symbol: msg.symbol,
              price: msg.price,
              timestamp: msg.timestamp,
              provider: msg.provider,
            },
          }));
        }
      } catch {
        // ignore malformed messages
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [subscribe]);

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
