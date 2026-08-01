import { useQuery } from '@tanstack/react-query';
import { fetchProvidersStatus } from '../api/endpoints';

export function ProviderBadge() {
  const { data } = useQuery({
    queryKey: ['providers'],
    queryFn: fetchProvidersStatus,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  if (!data) return null;

  const label = data.fixtureEnabled ? 'FIXTURE' : data.market.toUpperCase();
  const variant = data.fixtureEnabled ? 'text-news bg-news/15' : 'text-primary bg-primary/15';

  return (
    <span className={`badge font-mono text-[10px] uppercase tracking-wider ${variant}`} title={`News: ${data.news} · Realtime: ${data.realtime}`}>
      {label}
    </span>
  );
}
