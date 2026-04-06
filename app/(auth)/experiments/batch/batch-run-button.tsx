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
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
      >
        Batch run
      </button>
      <BatchRunModal configs={configs} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
