import { useEffect, useRef, useState } from 'react';

interface PriceFlashProps {
  value: number;
  formatter?: (v: number) => string;
  className?: string;
  emphasis?: 'normal' | 'strong';
}

export function PriceFlash({
  value,
  formatter = (v) => v.toFixed(2),
  className = '',
  emphasis = 'normal',
}: PriceFlashProps) {
  const prevRef = useRef(value);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    if (value > prev) setFlash('up');
    else if (value < prev) setFlash('down');
    prevRef.current = value;

    if (value !== prev) {
      const t = setTimeout(() => setFlash(null), 600);
      return () => clearTimeout(t);
    }
  }, [value]);

  const flashClass = flash === 'up'
    ? emphasis === 'strong'
      ? 'bg-up/35 text-up ring-1 ring-inset ring-up/60 shadow-[0_0_12px_rgba(34,197,94,0.28)]'
      : 'bg-up/20'
    : flash === 'down'
      ? emphasis === 'strong'
        ? 'bg-down/35 text-down ring-1 ring-inset ring-down/60 shadow-[0_0_12px_rgba(239,68,68,0.28)]'
        : 'bg-down/20'
      : '';

  return (
    <span className={`tabular inline-block rounded px-0.5 transition-all duration-300 ${flashClass} ${className}`}>
      {formatter(value)}
    </span>
  );
}
