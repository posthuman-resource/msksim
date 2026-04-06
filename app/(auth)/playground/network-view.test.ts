// app/(auth)/playground/network-view.test.ts — unit tests for the pure palette helper.
//
// Imports only from network-view-palette.ts (zero browser dependencies).
// Runs in the default Vitest `node` environment — no DOM, no WebGL, no sigma.
// The full rendering pipeline is verified by the MCP script in section 10 of the plan.

import { describe, it, expect } from 'vitest';
import { communityColor, OKABE_ITO } from './network-view-palette';

describe('OKABE_ITO palette', () => {
  it('has exactly 8 entries', () => {
    expect(OKABE_ITO.length).toBe(8);
  });

  it('first entry is black (#000000)', () => {
    expect(OKABE_ITO[0]).toBe('#000000');
  });

  it('every entry is a valid uppercase hex code', () => {
    for (const color of OKABE_ITO) {
      expect(color).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('no two entries are duplicates', () => {
    expect(new Set(OKABE_ITO).size).toBe(8);
  });
});

describe('communityColor', () => {
  it('returns OKABE_ITO[0] for community 0', () => {
    expect(communityColor(0)).toBe('#000000');
  });

  it('returns the correct palette entry for each index 0–7', () => {
    for (let i = 0; i < 8; i++) {
      expect(communityColor(i)).toBe(OKABE_ITO[i]);
    }
  });

  it('wraps at index 8 back to #000000', () => {
    expect(communityColor(8)).toBe('#000000');
  });

  it('wraps at index 15 to OKABE_ITO[7]', () => {
    expect(communityColor(15)).toBe(OKABE_ITO[7]);
  });

  it('wraps at index 16 back to #000000 (double-wrap sanity check)', () => {
    expect(communityColor(16)).toBe('#000000');
  });

  it('treats negative input as 0 (returns OKABE_ITO[0])', () => {
    expect(communityColor(-1)).toBe('#000000');
  });

  it('treats NaN as 0 (returns OKABE_ITO[0])', () => {
    expect(communityColor(NaN)).toBe('#000000');
  });

  it('treats Infinity as 0 (returns OKABE_ITO[0])', () => {
    expect(communityColor(Infinity)).toBe('#000000');
  });

  it('floors fractional inputs (3.9 → OKABE_ITO[3])', () => {
    expect(communityColor(3.9)).toBe(OKABE_ITO[3]);
  });

  it('floors fractional inputs (0.999 → OKABE_ITO[0])', () => {
    expect(communityColor(0.999)).toBe(OKABE_ITO[0]);
  });

  it('floors fractional inputs (7.1 → OKABE_ITO[7])', () => {
    expect(communityColor(7.1)).toBe(OKABE_ITO[7]);
  });
});
