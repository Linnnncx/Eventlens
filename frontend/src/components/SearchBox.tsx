import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { searchSymbols } from '../api/endpoints';
import type { SymbolProfile } from '../types/api';

interface SearchBoxProps {
  placeholder?: string;
  onSelect?: (symbol: string) => void;
  autoFocus?: boolean;
  className?: string;
}

export function SearchBox({
  placeholder = 'Search symbols…',
  onSelect,
  autoFocus = false,
  className = '',
}: SearchBoxProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => searchSymbols(debounced, 12),
    enabled: debounced.length >= 1,
    staleTime: 30_000,
  });

  const handleSelect = useCallback(
    (symbol: string) => {
      setQuery('');
      setOpen(false);
      if (onSelect) {
        onSelect(symbol);
      } else {
        navigate(`/workbench/${symbol}`);
      }
    },
    [navigate, onSelect],
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const items = data?.items ?? [];

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          type="text"
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && items[0]) {
              handleSelect(items[0].symbol);
            }
            if (e.key === 'Escape') setOpen(false);
          }}
          placeholder={placeholder}
          className="input pl-9 pr-9"
        />
        {isFetching && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted" />
        )}
      </div>
      {open && debounced.length >= 1 && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-surface-card shadow-xl">
          {items.length === 0 && !isFetching ? (
            <div className="px-3 py-2 text-sm text-muted">No symbols found</div>
          ) : (
            items.map((item: SymbolProfile) => (
              <button
                key={item.symbol}
                type="button"
                onClick={() => handleSelect(item.symbol)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface-hover"
              >
                <span className="font-medium">{item.symbol}</span>
                <span className="truncate pl-3 text-muted">{item.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
