import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Send } from 'lucide-react';
import { fetchDanmaku, postDanmaku, type DanmakuItem } from '../../api/endpoints';

interface FlyingChip {
  key: string;
  text: string;
  nickname: string;
  tone: string;
  lane: number;
  duration: number;
  self: boolean;
  mode: 'fly' | 'bubble';
}

const TONE_CLASS: Record<string, string> = {
  self: 'border-amber-400/50 bg-amber-400/15 text-amber-100',
  up: 'border-up/40 bg-up/10 text-up',
  news: 'border-news/40 bg-news/10 text-news',
  amber: 'border-amber-400/35 bg-amber-400/10 text-amber-200',
  sky: 'border-sky-400/40 bg-sky-400/10 text-sky-200',
  neutral: 'border-border bg-surface-card/90 text-gray-200',
};

interface DanmakuLaneProps {
  symbol: string;
}

export function DanmakuLane({ symbol }: DanmakuLaneProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [chips, setChips] = useState<FlyingChip[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const afterRef = useRef(0);
  const laneTick = useRef(0);
  const symbolRef = useRef(symbol);
  const bootedRef = useRef(false);

  const launch = useCallback((item: DanmakuItem, preferBubble = false) => {
    if (seenRef.current.has(item.id)) return;
    seenRef.current.add(item.id);
    if (seenRef.current.size > 200) {
      seenRef.current = new Set([...seenRef.current].slice(-120));
    }
    const lane = laneTick.current % 2;
    laneTick.current += 1;
    const duration = Math.min(14, Math.max(7, 6 + item.text.length * 0.18));
    const useBubble = preferBubble || item.self;
    const chip: FlyingChip = {
      key: `${item.id}-${Date.now()}`,
      text: item.text,
      nickname: item.nickname,
      tone: item.tone || (item.self ? 'self' : 'neutral'),
      lane,
      duration,
      self: Boolean(item.self),
      mode: useBubble ? 'bubble' : 'fly',
    };
    setChips((prev) => [...prev.slice(-24), chip]);
    const life = (useBubble ? 1100 : 0) + duration * 1000 + 250;
    window.setTimeout(() => {
      setChips((prev) => prev.filter((c) => c.key !== chip.key));
    }, life);
  }, []);

  useEffect(() => {
    symbolRef.current = symbol;
    seenRef.current.clear();
    afterRef.current = 0;
    bootedRef.current = false;
    setChips([]);
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const after = afterRef.current > 0 ? afterRef.current : undefined;
        const res = await fetchDanmaku(symbolRef.current, after);
        if (cancelled) return;
        const items = res.items ?? [];
        if (!bootedRef.current) {
          bootedRef.current = true;
          const recent = items.slice(-3);
          for (const item of recent) {
            afterRef.current = Math.max(afterRef.current, item.createdAt);
            launch(item, false);
          }
          if (items.length) {
            afterRef.current = Math.max(
              afterRef.current,
              items[items.length - 1]!.createdAt,
            );
          }
          return;
        }
        for (const item of items) {
          afterRef.current = Math.max(afterRef.current, item.createdAt);
          launch(item, false);
        }
      } catch {
        /* keep lane local if API unavailable */
      }
    };
    void pull();
    const id = window.setInterval(() => void pull(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [symbol, launch]);

  const onSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await postDanmaku(symbol, text);
      setDraft('');
      launch(res.item, true);
      afterRef.current = Math.max(afterRef.current, res.item.createdAt);
    } catch {
      launch(
        {
          id: `local-${Date.now()}`,
          symbol,
          text: text.slice(0, 48),
          nickname: '我',
          self: true,
          tone: 'self',
          createdAt: Date.now(),
        },
        true,
      );
      setDraft('');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 items-stretch gap-2">
      <div className="danmaku-stage relative min-h-[3.25rem] min-w-0 flex-1 overflow-hidden rounded-xl border border-border/50 bg-gradient-to-r from-surface/40 via-primary/[0.04] to-news/[0.05]">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-surface-card/90 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-surface-card/80 to-transparent" />

        {chips.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted/70">
            直播弹幕空中航道 · 说说你的看法
          </div>
        )}

        {chips.map((chip) => (
          <span
            key={chip.key}
            className={`danmaku-chip absolute whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs shadow-sm backdrop-blur-sm ${
              TONE_CLASS[chip.tone] ?? TONE_CLASS.neutral
            } ${chip.mode === 'bubble' ? 'danmaku-bubble' : 'danmaku-fly'} ${
              chip.lane === 0 ? 'top-[0.35rem]' : 'top-[1.55rem]'
            }`}
            style={
              {
                '--danmaku-duration': `${chip.duration}s`,
                animationDelay: chip.mode === 'bubble' ? '0s' : `${(chip.lane % 2) * 0.1}s`,
              } as CSSProperties
            }
          >
            <span className="mr-1 opacity-70">{chip.nickname}</span>
            <span className="font-medium">{chip.text}</span>
          </span>
        ))}
      </div>

      <form
        className="flex w-[min(16rem,34vw)] shrink-0 items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void onSend();
        }}
      >
        <input
          value={draft}
          maxLength={48}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="发一条弹幕…"
          className="input h-10 min-w-0 flex-1 rounded-full px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending}
          className="btn-primary h-10 shrink-0 rounded-full px-3"
          title="发送弹幕"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
