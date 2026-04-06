// app/(auth)/playground/colors.test.ts — Unit tests for pure color helpers.
// Vitest node environment (no DOM, no Canvas).

import { describe, it, expect } from 'vitest';
import { classToColor, tokenToColor, matchingRateToColor, rgbLerp } from './colors';

describe('classToColor', () => {
  it('maps each AgentClass to the correct hex', () => {
    expect(classToColor('W1-Mono')).toBe('#3b82f6');
    expect(classToColor('W1-Bi')).toBe('#a855f7');
    expect(classToColor('W2-Native')).toBe('#22c55e');
    expect(classToColor('W2-Immigrant')).toBe('#f97316');
  });

  it('returns gray for null (empty cell)', () => {
    expect(classToColor(null)).toBe('#d1d5db');
  });

  it('returns gray for undefined', () => {
    expect(classToColor(undefined)).toBe('#d1d5db');
  });
});

describe('tokenToColor', () => {
  const allTokens = ['yellow', 'red', 'jaune', 'rouge'];

  it('returns evenly-spaced hues for a four-token list', () => {
    expect(tokenToColor('yellow', allTokens)).toBe('hsl(0 70% 50%)');
    expect(tokenToColor('red', allTokens)).toBe('hsl(90 70% 50%)');
    expect(tokenToColor('jaune', allTokens)).toBe('hsl(180 70% 50%)');
    expect(tokenToColor('rouge', allTokens)).toBe('hsl(270 70% 50%)');
  });

  it('is deterministic — same token + allTokens returns the same value', () => {
    const first = tokenToColor('yellow', allTokens);
    const second = tokenToColor('yellow', allTokens);
    expect(first).toBe(second);
  });

  it('returns fallback gray for an unknown token', () => {
    expect(tokenToColor('unknown-token', allTokens)).toBe('#9ca3af');
  });
});

describe('matchingRateToColor', () => {
  it('returns the red anchor at rate=0', () => {
    expect(matchingRateToColor(0)).toBe('#ef4444');
  });

  it('returns the green anchor at rate=1', () => {
    expect(matchingRateToColor(1)).toBe('#22c55e');
  });

  it('returns a midpoint color at rate=0.5', () => {
    // midpoint of red (#ef4444=[239,68,68]) and green (#22c55e=[34,197,94]) in RGB:
    // r: 239 + (34-239)*0.5 = 136.5 → round = 137 = 0x89
    // g: 68 + (197-68)*0.5 = 132.5 → round = 133 = 0x85
    // b: 68 + (94-68)*0.5  = 81    → round = 81  = 0x51
    expect(matchingRateToColor(0.5)).toBe('#898551');
  });

  it('clamps below 0 to the red anchor', () => {
    expect(matchingRateToColor(-0.1)).toBe('#ef4444');
  });

  it('clamps above 1 to the green anchor', () => {
    expect(matchingRateToColor(1.5)).toBe('#22c55e');
  });
});

describe('rgbLerp', () => {
  it('returns a at t=0', () => {
    expect(rgbLerp([0, 0, 0], [255, 255, 255], 0)).toEqual([0, 0, 0]);
  });

  it('returns b at t=1', () => {
    expect(rgbLerp([0, 0, 0], [255, 255, 255], 1)).toEqual([255, 255, 255]);
  });

  it('returns the midpoint at t=0.5', () => {
    expect(rgbLerp([0, 0, 0], [255, 255, 255], 0.5)).toEqual([127.5, 127.5, 127.5]);
  });

  it('is pure — does not mutate its arguments', () => {
    const a: [number, number, number] = [10, 20, 30];
    const b: [number, number, number] = [100, 200, 255];
    rgbLerp(a, b, 0.5);
    expect(a).toEqual([10, 20, 30]);
    expect(b).toEqual([100, 200, 255]);
  });
});
