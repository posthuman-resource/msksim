// Worker module for the step-19 bootstrap smoke test.
// This file will be deleted in step 20 and replaced by workers/simulation.worker.ts.
//
// Pattern: Turbopack-native worker construction via new Worker(new URL(...), { type: 'module' }).
// Reference: CLAUDE.md 'Worker lifecycle', node_modules/next/dist/docs/01-app/03-api-reference/08-turbopack.md
// § Magic Comments (line 129): "Turbopack supports... new Worker() expressions."
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/Worker/Worker — canonical new URL(..., import.meta.url) idiom.
//
// No 'use client' directive (this is a worker module, not a Client Component).
// No 'import server-only' directive (this is not a Server Component).
// The file carries no React context; Comlink.expose() is the sole entry point.

import * as Comlink from 'comlink';

import { createRNG } from '@/lib/sim/rng';

// CJS-dependency canary: prove that Turbopack resolves a node_modules CJS package
// inside a worker bundle. graphology ships a CJS main entry; if Turbopack cannot
// interop it from a worker module the build will fail here, surfacing the issue
// before step 20 wires the full simulation through the same plumbing.
import Graph from 'graphology';

export interface HelloWorkerApi {
  ping(): string;
  add(a: number, b: number): number;
  echo<T>(value: T): T;
  /**
   * Determinism pre-test: creates two RNG instances with the given seed,
   * draws `count` integers from each, and returns true iff both sequences
   * are bit-identical. This is the same invariant step 20 relies on for
   * the real simulation worker.
   */
  determinismCheck(seed: number, count: number): boolean;
}

// graphology canary assertion — runs once at module init time inside the worker.
// If the import is broken (returns a stub, wrong shape, etc.), this throws and
// the worker fails to initialize, which surfaces in the MCP script's console triage.
const _graphCanary = new Graph();
if (_graphCanary.order !== 0) {
  throw new Error(`graphology canary failed: empty Graph should have order 0, got ${_graphCanary.order}`);
}

const api: HelloWorkerApi = {
  ping(): string {
    return 'pong';
  },

  add(a: number, b: number): number {
    return a + b;
  },

  echo<T>(value: T): T {
    return value;
  },

  determinismCheck(seed: number, count: number): boolean {
    const rngA = createRNG(seed);
    const rngB = createRNG(seed);
    const seqA: number[] = [];
    const seqB: number[] = [];
    for (let i = 0; i < count; i++) {
      seqA.push(rngA.nextInt(0, 2 ** 30));
      seqB.push(rngB.nextInt(0, 2 ** 30));
    }
    return JSON.stringify(seqA) === JSON.stringify(seqB);
  },
};

Comlink.expose(api);
