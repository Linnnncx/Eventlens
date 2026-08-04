import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { fetchDanmaku, postDanmaku } from '../../api/endpoints';
import { EmptyState } from './ui';

const TONE_STYLE: Record<string, string> = {
  bull: 'bg-up/12 text-up',
  bear: 'bg-down/12 text-down',
  neutral: 'bg-surface-hover text-gray-200',
};

/**
 * Desktop shows a flying danmaku lane; on a phone that is unreadable, so the same
 * feed renders as a chat list with the composer pinned underneath.
 */
export function MobileDanmaku({ symbol }: { symbol: string }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  const { data } = useQuery({
    queryKey: ['danmaku', symbol],
    queryFn: () => fetchDanmaku(symbol),
    refetchInterval: 15_000,
    staleTime: 8_000,
  });

  const send = useMutation({
    mutationFn: (value: string) => postDanmaku(symbol, value),
    onSuccess: () => {
      setText('');
      queryClient.invalidateQueries({ queryKey: ['danmaku', symbol] });
    },
  });

  const items = data?.items ?? [];

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  return (
    <div className="flex flex-col">
      <div ref={listRef} className="max-h-72 space-y-2 overflow-y-auto px-3 py-3">
        {items.length === 0 ? (
          <EmptyState text="还没有讨论，来说两句" />
        ) : (
          items.map((item) => (
            <div key={item.id} className={`flex ${item.self ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[80%]">
                {!item.self && (
                  <div className="mb-0.5 pl-1 text-[11px] text-muted">{item.nickname}</div>
                )}
                <div
                  className={`rounded-2xl px-3 py-1.5 text-[13px] leading-snug ${
                    item.self
                      ? 'bg-primary/20 text-gray-100'
                      : (TONE_STYLE[item.tone] ?? 'bg-surface-hover text-gray-200')
                  }`}
                >
                  {item.text}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <form
        className="flex items-center gap-2 border-t border-border/60 px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          const value = text.trim();
          if (value) send.mutate(value);
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={80}
          placeholder="说点什么…"
          className="input flex-1 py-2 text-[14px]"
        />
        <button
          type="submit"
          disabled={!text.trim() || send.isPending}
          className="m-tap flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-white disabled:opacity-40"
          aria-label="发送"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
