import { describe, expect, it } from "vitest";
import { createRNG } from "@/lib/sim/rng";

// Determinism is a hard requirement for simulation tests.
// Every test that exercises the RNG pins a seed and asserts bit-identical
// output across repeated invocations (per CLAUDE.md "Testing conventions").

describe("createRNG", () => {
  // ─── Test 1: Determinism across construction ─────────────────────────────
  it("produces identical sequences from two instances with the same seed", () => {
    const a = createRNG(42);
    const b = createRNG(42);
    const seqA = Array.from({ length: 100 }, () => a.nextInt(0, 99));
    const seqB = Array.from({ length: 100 }, () => b.nextInt(0, 99));
    expect(seqA).toEqual(seqB);
  });

  // ─── Test 2: Locked sequence change detector ─────────────────────────────
  // This fixture was generated with seed 42 and xoroshiro128plus via pure-rand@8.4.0.
  // If the generator, distribution, or bit-consumption pattern changes,
  // this test fails loudly with a readable diff — re-generate deliberately.
  it("produces a known locked sequence with seed 42", () => {
    const FIXTURE = [5, 25, 35, 20, 34, 84, 52, 87, 39, 33];
    const rng = createRNG(42);
    const actual = Array.from({ length: 10 }, () => rng.nextInt(0, 99));
    expect(actual).toEqual(FIXTURE);
  });

  // ─── Test 3: Different seeds produce different sequences ─────────────────
  it("produces different sequences for different seeds", () => {
    const a = createRNG(0);
    const b = createRNG(1);
    const seqA = Array.from({ length: 100 }, () => a.nextInt(0, 999999));
    const seqB = Array.from({ length: 100 }, () => b.nextInt(0, 999999));
    expect(seqA).not.toEqual(seqB);
  });

  // ─── Test 4: nextFloat range ─────────────────────────────────────────────
  it("nextFloat always returns values in [0, 1)", () => {
    const rng = createRNG(99);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  // ─── Test 5: nextFloat determinism ───────────────────────────────────────
  it("nextFloat produces identical sequences for the same seed", () => {
    const a = createRNG(7);
    const b = createRNG(7);
    const seqA = Array.from({ length: 50 }, () => a.nextFloat());
    const seqB = Array.from({ length: 50 }, () => b.nextFloat());
    expect(seqA).toEqual(seqB);
  });

  // ─── Test 6: pick returns only input elements ─────────────────────────────
  it("pick returns only elements from the input array and covers all of them", () => {
    const rng = createRNG(123);
    const input = ["a", "b", "c", "d"] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const v = rng.pick(input);
      expect(input).toContain(v);
      seen.add(v);
    }
    // All four elements should appear (probability of missing any < 10^-100)
    for (const el of input) {
      expect(seen).toContain(el);
    }
  });

  // ─── Test 7: pickWeighted biases toward high-weight item ─────────────────
  it("pickWeighted heavily favors the high-weight item [1, 99]", () => {
    const rng = createRNG(5);
    let countB = 0;
    for (let i = 0; i < 10_000; i++) {
      if (rng.pickWeighted(["a", "b"], [1, 99]) === "b") countB++;
    }
    // Expected ~9900, ±3σ ≈ ±30; use generous slack [9500, 9950]
    expect(countB).toBeGreaterThan(9500);
    expect(countB).toBeLessThan(9950);
  });

  // ─── Test 8: pickWeighted with equal weights is approximately uniform ─────
  it("pickWeighted with equal weights distributes uniformly", () => {
    const rng = createRNG(9);
    const counts: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
    for (let i = 0; i < 10_000; i++) {
      const v = rng.pickWeighted(["a", "b", "c", "d"], [1, 1, 1, 1]);
      counts[v]++;
    }
    // Expected 2500 each, ±3σ ≈ ±43; window [2200, 2800]
    for (const count of Object.values(counts)) {
      expect(count).toBeGreaterThan(2200);
      expect(count).toBeLessThan(2800);
    }
  });

  // ─── Test 9: pickWeighted rejects invalid input ───────────────────────────
  it("pickWeighted throws on length mismatch", () => {
    const rng = createRNG(0);
    expect(() => rng.pickWeighted(["a"], [1, 2])).toThrow();
  });

  it("pickWeighted throws on negative weight", () => {
    const rng = createRNG(0);
    expect(() => rng.pickWeighted(["a"], [-1])).toThrow();
  });

  it("pickWeighted throws on all-zero weights", () => {
    const rng = createRNG(0);
    expect(() => rng.pickWeighted(["a", "b"], [0, 0])).toThrow();
  });

  // ─── Test 10: shuffle does not mutate input ───────────────────────────────
  it("shuffle does not mutate the input array", () => {
    const rng = createRNG(77);
    const input = [1, 2, 3, 4, 5];
    rng.shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });

  // ─── Test 11: shuffle returns a permutation ───────────────────────────────
  it("shuffle returns a permutation of the input", () => {
    const rng = createRNG(77);
    const shuffled = rng.shuffle([1, 2, 3, 4, 5]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  // ─── Test 12: shuffle is deterministic ───────────────────────────────────
  it("shuffle produces identical output for the same seed", () => {
    const a = createRNG(11);
    const b = createRNG(11);
    const input = [10, 20, 30, 40, 50];
    expect(a.shuffle(input)).toEqual(b.shuffle(input));
  });

  // ─── Test 13: nextInt inclusive bounds ───────────────────────────────────
  it("nextInt(5, 7) produces only 5, 6, or 7 and all three appear", () => {
    const rng = createRNG(55);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextInt(5, 7);
      expect([5, 6, 7]).toContain(v);
      seen.add(v);
    }
    expect(seen).toContain(5);
    expect(seen).toContain(6);
    expect(seen).toContain(7);
  });

  // ─── Error: nextInt with min > max ───────────────────────────────────────
  it("nextInt throws when min > max", () => {
    const rng = createRNG(0);
    expect(() => rng.nextInt(10, 5)).toThrow();
  });

  // ─── Error: pick on empty array ───────────────────────────────────────────
  it("pick throws on empty array", () => {
    const rng = createRNG(0);
    expect(() => rng.pick([])).toThrow();
  });
});
