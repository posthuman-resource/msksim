// Pure, React-free, DOM-free circular buffer for TickReport time-series.
// Used by metrics-dashboard.tsx to cap memory usage and down-sample very long runs
// for display. See `docs/plan/22-metrics-dashboard.md` §7 slice two for design rationale.
//
// Contract: the outer MetricsHistory object is immutable from React's perspective
// (appendTick returns a new outer object so useState reference-equality fires a
// re-render), but the underlying buffer array is mutated in place for performance.
// Callers must treat the buffer as a read-only snapshot after receiving it.

import type { TickReport } from '@/workers/simulation.worker';

// Re-export TickReport as a type-only re-export so consumers can import it here
// without importing the worker module at runtime.
export type { TickReport };

/**
 * Opaque circular ring buffer shape.
 * - buffer: fixed-length array, mutated in place by appendTick
 * - capacity: maximum number of entries before oldest are overwritten
 * - head: monotonic write counter (next write index = head % capacity)
 * - length: number of valid entries (capped at capacity)
 */
export type MetricsHistory = {
  readonly buffer: TickReport[];
  readonly capacity: number;
  readonly head: number;
  readonly length: number;
};

/**
 * Create an empty MetricsHistory with the given capacity.
 * Default capacity is 10,000 ticks — enough for a full interactive session
 * without unbounded memory growth.
 */
export function createMetricsHistory(capacity = 10_000): MetricsHistory {
  return {
    buffer: new Array(capacity),
    capacity,
    head: 0,
    length: 0,
  };
}

/**
 * Append a TickReport to the history, overwriting the oldest entry when full.
 *
 * MUTATION NOTE: the underlying buffer array is mutated in place via circular
 * indexing for performance (avoids a 10 MB/s allocation at 60 Hz). The outer
 * MetricsHistory object is a fresh reference so React's useState reference-equality
 * check fires a re-render. Callers must NOT mutate the buffer directly.
 *
 * @returns A new MetricsHistory object (fresh outer reference, same buffer array).
 */
export function appendTick(history: MetricsHistory, report: TickReport): MetricsHistory {
  const { buffer, capacity, head, length } = history;
  buffer[head % capacity] = report;
  return {
    buffer,
    capacity,
    head: head + 1,
    length: Math.min(length + 1, capacity),
  };
}

/**
 * Return a down-sampled, chronologically ordered read view of the history.
 *
 * - If history.length <= maxPoints, returns every stored tick in order.
 * - Otherwise, returns maxPoints evenly-spaced ticks with the most-recent
 *   tick always included as the last element.
 *
 * The returned array is a fresh TickReport[] — the ring-to-linear unwrap
 * allocates once per render, not per tick.
 *
 * @param history The circular buffer to read from.
 * @param maxPoints Maximum number of ticks to return (default 1000).
 * @returns Chronologically ordered TickReport[], length <= maxPoints.
 */
export function getHistoryWindow(history: MetricsHistory, maxPoints: number): TickReport[] {
  const { buffer, capacity, head, length } = history;
  if (length === 0) return [];

  // Oldest entry index in the ring
  const startIdx = (head - length + capacity * Math.ceil(length / capacity)) % capacity;

  // Linearize the ring into chronological order
  const linearized: TickReport[] = new Array(length);
  for (let i = 0; i < length; i++) {
    linearized[i] = buffer[(startIdx + i) % capacity];
  }

  if (length <= maxPoints) {
    return linearized;
  }

  // Down-sample: pick at most (maxPoints - 1) evenly-spaced entries, then
  // always append the most-recent entry so the last tick is guaranteed present.
  // This ensures result.length <= maxPoints regardless of stride rounding.
  const stride = Math.floor(length / maxPoints);
  const result: TickReport[] = [];
  for (let i = 0; i < length - 1 && result.length < maxPoints - 1; i += stride) {
    result.push(linearized[i]);
  }
  result.push(linearized[length - 1]);

  return result;
}

/**
 * Reset length and head to zero without deallocating the buffer.
 * Used by the reset-button path in step 24. Cleared buffers accept new entries
 * without stale reads.
 *
 * @returns A new MetricsHistory object with head and length reset to 0.
 */
export function clearHistory(history: MetricsHistory): MetricsHistory {
  return {
    ...history,
    head: 0,
    length: 0,
  };
}
