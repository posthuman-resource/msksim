// app/(auth)/playground/config-hash.ts — pure helper for config canonicalization and SHA-256 hashing.
//
// Client-safe pure helper. Canonicalizes an ExperimentConfig to a sorted-key JSON string,
// then hashes it with crypto.subtle.digest. The SHA-256 hex output is used for:
//   (a) the reproducibility banner in the playground controls
//   (b) export filenames per CLAUDE.md 'Export conventions'
//
// Canonicalization is necessary because JSON.stringify is key-order-sensitive and two
// semantically identical configs with different key orders would hash differently.
//
// crypto.subtle requires a secure context — HTTPS or localhost. See CLAUDE.md Known gotchas.

import type { ExperimentConfig } from '@/lib/schema/experiment';

/**
 * Recursively stringify a JSON-serializable value with sorted object keys.
 * Arrays preserve their element order. Object keys are sorted lexicographically.
 * Undefined values and function values in objects are skipped (matching JSON.stringify semantics).
 * Throws on NaN, Infinity, Symbol, BigInt — these are not valid in ExperimentConfig.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null) return 'null';

  if (typeof value === 'boolean') return JSON.stringify(value);

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(
        `canonicalStringify: non-finite number (${value}) is not JSON-serializable and would produce a non-deterministic hash`,
      );
    }
    return JSON.stringify(value);
  }

  if (typeof value === 'string') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalStringify(item)).join(',') + ']';
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const pairs = keys
      .filter((k) => obj[k] !== undefined && typeof obj[k] !== 'function')
      .map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`);
    return '{' + pairs.join(',') + '}';
  }

  throw new Error(
    `canonicalStringify: unsupported value type "${typeof value}" — only JSON-serializable values are allowed`,
  );
}

/**
 * Compute the full SHA-256 hex hash (64 characters) of a canonicalized ExperimentConfig.
 * Uses crypto.subtle.digest — requires a secure context (HTTPS or localhost).
 */
export async function computeConfigHash(config: ExperimentConfig): Promise<string> {
  const canonical = canonicalStringify(config);
  const bytes = new TextEncoder().encode(canonical);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Convenience wrapper — returns the first 8 hex characters of the full SHA-256 hash.
 * Suitable for display in the reproducibility banner; full hash available for export filenames.
 */
export async function computeConfigHashShort(config: ExperimentConfig): Promise<string> {
  const full = await computeConfigHash(config);
  return full.slice(0, 8);
}
