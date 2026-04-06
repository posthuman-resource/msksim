// app/(auth)/playground/colors.ts — Pure color helpers for the lattice canvas renderer.
//
// Client-safe module. No 'use client' needed (plain .ts, no JSX).
// No 'import server-only' — imported by client components and the test suite.
// No Math.random() — all functions are pure and deterministic.
//
// Four exports:
//   classToColor(cls)           → hex string per AgentClass (or gray for empty cells)
//   tokenToColor(token, all)    → HSL string; evenly-spaced hue ring over allTokens
//   matchingRateToColor(rate)   → hex string; red→green lerp for [0, 1]
//   rgbLerp(a, b, t)            → [r, g, b] linear interpolation helper

import type { AgentClass } from '@/lib/schema/primitives';

// ─── Class projection ─────────────────────────────────────────────────────────

/** Tailwind-compatible hex palette for the four AgentClass values. */
const CLASS_COLORS: Record<AgentClass, string> = {
  'W1-Mono': '#3b82f6', // blue-500
  'W1-Bi': '#a855f7', // purple-500
  'W2-Native': '#22c55e', // green-500
  'W2-Immigrant': '#f97316', // orange-500
};

/** Empty-cell gray. */
const EMPTY_COLOR = '#d1d5db'; // gray-300

/**
 * Return the hex color for an AgentClass.
 * Pass null (or undefined) for an empty lattice cell to get the gray fallback.
 */
export function classToColor(cls: AgentClass | null | undefined): string {
  if (!cls) return EMPTY_COLOR;
  return CLASS_COLORS[cls] ?? EMPTY_COLOR;
}

// ─── Dominant-token projection ────────────────────────────────────────────────

/** Fallback color when a token is not in allTokens. */
const UNKNOWN_TOKEN_COLOR = '#9ca3af'; // gray-400

/**
 * Deterministically map a token to an HSL hue based on its position in allTokens.
 * Hues are evenly spaced around the 360° ring.
 *
 * Returns UNKNOWN_TOKEN_COLOR if the token is not found in allTokens.
 */
export function tokenToColor(token: string, allTokens: string[]): string {
  const idx = allTokens.indexOf(token);
  if (idx === -1) return UNKNOWN_TOKEN_COLOR;
  const hue = Math.round((idx * 360) / allTokens.length) % 360;
  return `hsl(${hue} 70% 50%)`;
}

// ─── Matching-rate projection ─────────────────────────────────────────────────

/** Red anchor (low match). */
const RED_RGB: [number, number, number] = [0xef, 0x44, 0x44]; // #ef4444 red-500
/** Green anchor (high match). */
const GREEN_RGB: [number, number, number] = [0x22, 0xc5, 0x5e]; // #22c55e green-500

/**
 * Linear interpolation between two RGB triples.
 * t = 0 → a, t = 1 → b. Values are not rounded.
 */
export function rgbLerp(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Map a matching rate in [0, 1] to a hex color string.
 * 0 → red (#ef4444), 1 → green (#22c55e), linearly interpolated.
 * Values outside [0, 1] are clamped.
 */
export function matchingRateToColor(rate: number): string {
  const t = Math.max(0, Math.min(1, rate));
  const [r, g, b] = rgbLerp(RED_RGB, GREEN_RGB, t);
  const hex = (v: number): string =>
    Math.round(v).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
