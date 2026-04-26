'use client';

import { useState } from 'react';

import { BatchRunModal } from './batch-run-modal';
import type { ExperimentConfig } from '@/lib/schema/experiment';

interface BatchRunButtonProps {
  configs: Array<{ id: string; name: string; config: ExperimentConfig }>;
}

export function BatchRunButton({ configs }: BatchRunButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        data-testid="batch-run-open-button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center rounded-md border border-border-strong bg-surface px-3.5 py-1.5 text-sm font-medium text-fg hover:bg-surface-muted"
      >
        Batch run
      </button>
      <BatchRunModal configs={configs} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
