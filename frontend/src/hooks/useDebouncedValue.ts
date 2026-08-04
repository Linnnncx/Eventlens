import { useEffect, useRef, useState } from 'react';

/** Debounce JSON-compatible request payloads without resetting on unrelated renders. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const serialized = JSON.stringify(value);
  const latestRef = useRef(value);
  latestRef.current = value;
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(latestRef.current), delayMs);
    return () => window.clearTimeout(timer);
  }, [serialized, delayMs]);

  return debounced;
}
