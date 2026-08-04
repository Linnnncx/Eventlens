import { useEffect, useState } from 'react';

/** Desktop workbench needs >= 1024px; anything narrower gets the mobile app shell. */
const MOBILE_QUERY = '(max-width: 1023px)';

function match(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(MOBILE_QUERY).matches;
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(match);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}

/** Landscape phone/tablet — used to promote the chart to full screen. */
export function useIsLandscape(): boolean {
  const [landscape, setLandscape] = useState(
    () => typeof window !== 'undefined' && window.innerWidth > window.innerHeight,
  );

  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)');
    const onChange = () => setLandscape(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return landscape;
}
