'use client';

// Temporary smoke page for step 19. Deleted in step 20.
// Verifies that the Turbopack-native Web Worker + Comlink integration works
// before the real simulation worker is wired up in step 20.
//
// Pattern: useEffect with idempotent cleanup (cancelled flag + worker.terminate())
// protects against React 19 strict-mode double-invocation leaking worker instances.
// See CLAUDE.md 'Worker lifecycle'.

import { useEffect, useState } from 'react';

import * as Comlink from 'comlink';

// Type-only import: erased at compile time, so the worker module is NOT pulled
// into the page's client bundle graph. The runtime reference is the new Worker(new URL(...))
// call below — that is the bundler directive Turbopack uses to emit a separate chunk.
import type { HelloWorkerApi } from '@/workers/hello.worker';

export default function WorkerSmokePage() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [pingResult, setPingResult] = useState<string>('');
  const [addResult, setAddResult] = useState<string>('');
  const [echoResult, setEchoResult] = useState<string>('');
  const [determinismResult, setDeterminismResult] = useState<string>('');

  useEffect(() => {
    // Turbopack-native worker construction. The new URL(path, import.meta.url) expression
    // form is required — Turbopack recognizes it as a bundler directive and emits a
    // separate worker chunk. A string literal would NOT trigger code-splitting.
    // Path: four levels up from app/(public)/%5Fdev/worker-smoke/ to the repo root, then into workers/.
    const worker = new Worker(
      new URL('../../../../workers/hello.worker.ts', import.meta.url),
      { type: 'module' },
    );
    const api = Comlink.wrap<HelloWorkerApi>(worker);
    let cancelled = false;

    (async () => {
      setStatus('loading');
      try {
        const ping = await api.ping();
        const add = await api.add(2, 3);
        const echo = await api.echo({ hello: 'world' });
        const det = await api.determinismCheck(42, 100);
        if (cancelled) return;
        setPingResult(ping);
        setAddResult(String(add));
        setEchoResult(JSON.stringify(echo));
        setDeterminismResult(String(det));
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        console.error('worker smoke error:', err);
      }
    })();

    return () => {
      cancelled = true;
      worker.terminate();
    };
  }, []);

  return (
    <main style={{ padding: '2rem', fontFamily: 'monospace' }}>
      <h1>Worker Smoke Test (step 19)</h1>
      <p>This page is temporary and will be removed in step 20.</p>
      <dl>
        <dt>Status</dt>
        <dd data-testid="worker-status">{status}</dd>
        <dt>ping()</dt>
        <dd data-testid="ping-result">{pingResult}</dd>
        <dt>add(2, 3)</dt>
        <dd data-testid="add-result">{addResult}</dd>
        <dt>echo({'{'}&#34;hello&#34;:&#34;world&#34;{'}'})</dt>
        <dd data-testid="echo-result">{echoResult}</dd>
        <dt>determinismCheck(42, 100)</dt>
        <dd data-testid="determinism-result">{determinismResult}</dd>
      </dl>
    </main>
  );
}
