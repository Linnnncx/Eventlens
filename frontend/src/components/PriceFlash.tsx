import { useEffect, useRef, useState } from 'react';

interface PriceFlashProps {
  value: number;
  formatter?: (v: number) => string;
  className?: string;
}

export function PriceFlash({ value, formatter = (v) => v.toFixed(2), className = '' }: PriceFlashProps) {
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

  const flashClass =
    flash === 'up' ? 'bg-up/20' : flash === 'down' ? 'bg-down/20' : '';

  return (
    <span className={`tabular inline-block rounded px-0.5 transition-colors duration-300 ${flashClass} ${className}`}>
      {formatter(value)}
    </span>
  );
}
