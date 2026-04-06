// app/(auth)/playground/network-view-palette.ts — pure palette helper for the network view.
//
// Zero imports. No React, no sigma, no graphology — just the Okabe-Ito colour table
// and the pure mapping function. Split out so unit tests can import it without pulling
// in browser-only packages (sigma, graphology-layout-forceatlas2) that are side-effect-
// free at import time but may cause issues in node test environments.
//
// Both `network-view.tsx` and `network-view.test.ts` import from this file directly.

/**
 * Okabe-Ito colorblind-safe qualitative palette (8 colours).
 * Source: Okabe & Ito 2008, "Color Universal Design" (https://jfly.uni-koeln.de/color/).
 * Order: [black, orange, sky blue, bluish green, yellow, blue, vermillion, reddish purple].
 * Chosen because it is safe for deuteranopia and protanopia (the two most common forms of
 * color blindness affecting ~8% of males) while still providing visually distinct hues
 * for publication-quality scientific figures.
 */
export const OKABE_ITO = [
  '#000000', // 0 — black
  '#E69F00', // 1 — orange
  '#56B4E9', // 2 — sky blue
  '#009E73', // 3 — bluish green
  '#F0E442', // 4 — yellow
  '#0072B2', // 5 — blue
  '#D55E00', // 6 — vermillion
  '#CC79A7', // 7 — reddish purple
] as const;

/**
 * Maps a Louvain community id (non-negative integer) to a hex colour from the
 * Okabe-Ito palette. Communities beyond 8 wrap via modulo — in practice the
 * N ≤ 500 target produces 2–6 communities on a well-connected cumulative graph
 * so wraparound is rare.
 *
 * Defensive inputs:
 *   - Negative, NaN, or Infinity → returns OKABE_ITO[0] (black).
 *   - Fractional inputs → floored before modulo (e.g. 3.9 → colour 3).
 *
 * This is the only pure helper in the network view stack that unit tests cover
 * directly. The rest of the rendering is MCP-verified.
 */
export function communityColor(communityId: number): string {
  if (!Number.isFinite(communityId) || communityId < 0) return OKABE_ITO[0];
  return OKABE_ITO[Math.floor(communityId) % OKABE_ITO.length];
}
