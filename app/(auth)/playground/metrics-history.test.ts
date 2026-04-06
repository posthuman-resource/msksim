// Unit tests for the metrics history circular buffer.
// Pure-function tests only — no React, no DOM, no RNG.
// All fixtures use `as unknown as TickReport` to avoid replicating the full
// ScalarMetricsSnapshot/GraphMetricsSnapshot shapes; the buffer cares only about
// ordering, ring indexing, and down-sampling, not the snapshot's internal structure.

import { describe, it, expect } from 'vitest';
import type { TickReport } from './metrics-history';
import {
  createMetricsHistory,
  appendTick,
  getHistoryWindow,
  clearHistory,
} from './metrics-history';

const makeReport = (tick: number): TickReport =>
  ({ tick, scalar: {} as never, graph: {} as never }) as TickReport;

describe('createMetricsHistory', () => {
  it('returns a zero-length buffer with the specified capacity', () => {
    const history = createMetricsHistory(100);
    expect(history.length).toBe(0);
    expect(history.capacity).toBe(100);
    expect(history.head).toBe(0);
    expect(getHistoryWindow(history, 10)).toEqual([]);
  });

  it('defaults to capacity 10,000', () => {
    const history = createMetricsHistory();
    expect(history.capacity).toBe(10_000);
  });
});

describe('appendTick', () => {
  it('appends in order below capacity', () => {
    let h = createMetricsHistory(10);
    for (let i = 0; i < 5; i++) h = appendTick(h, makeReport(i));
    expect(h.length).toBe(5);
    expect(h.head).toBe(5);
    const window = getHistoryWindow(h, 10);
    expect(window.map((r) => r.tick)).toEqual([0, 1, 2, 3, 4]);
  });

  it('wraps and overwrites oldest entries at capacity', () => {
    let h = createMetricsHistory(5);
    for (let i = 0; i < 8; i++) h = appendTick(h, makeReport(i));
    expect(h.length).toBe(5);
    expect(h.head).toBe(8);
    const window = getHistoryWindow(h, 10);
    // Oldest 3 (tick=0,1,2) overwritten; remaining are tick=3..7
    expect(window.map((r) => r.tick)).toEqual([3, 4, 5, 6, 7]);
  });
});

describe('getHistoryWindow', () => {
  it('down-samples when history.length exceeds maxPoints', () => {
    let h = createMetricsHistory(10_000);
    for (let i = 0; i < 10_000; i++) h = appendTick(h, makeReport(i));
    const window = getHistoryWindow(h, 1000);
    expect(window.length).toBeLessThanOrEqual(1000);
    expect(window.length).toBeGreaterThanOrEqual(900);
    // Most-recent tick always included
    expect(window[window.length - 1].tick).toBe(9999);
  });

  it('preserves chronological order after down-sampling', () => {
    let h = createMetricsHistory(10_000);
    for (let i = 0; i < 5_000; i++) h = appendTick(h, makeReport(i));
    const window = getHistoryWindow(h, 500);
    for (let i = 1; i < window.length; i++) {
      expect(window[i].tick).toBeGreaterThan(window[i - 1].tick);
    }
  });

  it('includes the most-recent tick even after wrap', () => {
    let h = createMetricsHistory(5);
    for (let i = 0; i < 20; i++) h = appendTick(h, makeReport(i));
    const window = getHistoryWindow(h, 10);
    expect(window[window.length - 1].tick).toBe(19);
  });
});

describe('clearHistory', () => {
  it('resets length and head without deallocating buffer', () => {
    let h = createMetricsHistory(500);
    for (let i = 0; i < 100; i++) h = appendTick(h, makeReport(i));
    h = clearHistory(h);
    expect(h.length).toBe(0);
    expect(h.head).toBe(0);
    expect(h.capacity).toBe(500);

    // Accepts new entries after clear without stale reads
    h = appendTick(h, makeReport(999));
    const window = getHistoryWindow(h, 10);
    expect(window).toHaveLength(1);
    expect(window[0].tick).toBe(999);
  });
});
