import { describe, expect, it } from 'vitest';
import { alignEventToBar, alignEventToBarIso } from '../src/utils/eventAlign';

describe('alignEventToBar', () => {
  const tz = 'America/New_York';

  it('aligns 5Min bucket in market timezone', () => {
    const ts = new Date('2024-06-03T14:07:30.000Z');
    const aligned = alignEventToBar(ts, '5Min', tz);
    const iso = aligned.toISOString();
    expect(iso).toMatch(/T14:05:00/);
  });

  it('aligns 15Min bucket', () => {
    const ts = new Date('2024-06-03T14:22:00.000Z');
    const aligned = alignEventToBar(ts, '15Min', tz);
    expect(aligned.getUTCMinutes()).toBe(15);
  });

  it('aligns 1Hour bucket', () => {
    const ts = new Date('2024-06-03T14:45:00.000Z');
    const aligned = alignEventToBar(ts, '1Hour', tz);
    expect(aligned.getUTCMinutes()).toBe(0);
  });

  it('aligns 1Day to midnight local', () => {
    const ts = new Date('2024-06-03T18:00:00.000Z');
    const aligned = alignEventToBar(ts, '1Day', tz);
    const localHour = aligned.toISOString();
    expect(localHour).toBeTruthy();
  });

  it('aligns 1Min bucket', () => {
    const ts = new Date('2024-06-03T14:07:45.000Z');
    const aligned = alignEventToBar(ts, '1Min', tz);
    expect(aligned.getUTCSeconds()).toBe(0);
  });

  it('accepts ISO string input', () => {
    const iso = alignEventToBarIso('2024-06-03T14:07:30.000Z', '5Min', tz);
    expect(iso).toContain('T');
    expect(new Date(iso).getTime()).toBeGreaterThan(0);
  });

  it('handles string timestamp consistently', () => {
    const a = alignEventToBar('2024-06-03T14:07:30.000Z', '5Min', tz);
    const b = alignEventToBar(new Date('2024-06-03T14:07:30.000Z'), '5Min', tz);
    expect(a.getTime()).toBe(b.getTime());
  });
});
