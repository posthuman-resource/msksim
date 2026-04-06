'use server';

import { revalidatePath } from 'next/cache';

import { verifySession } from '@/lib/auth/dal';
import { createRun, finishRun } from '@/lib/db/runs';
import { persistCompletedRun } from '@/app/(auth)/playground/actions';

// Re-export step 26's action for completed runs — identical payload shape.
export { persistCompletedRun };

/**
 * Persist a failed or cancelled batch replicate to the database.
 * Creates a run row and immediately finalizes it with the terminal status.
 * No tick metrics are persisted for non-completed runs.
 */
export async function persistFailedReplicate(payload: {
  configId: string;
  seed: number;
  status: 'failed' | 'cancelled';
  tickCount: number;
  errorMessage: string | null;
}): Promise<{ runId: string }> {
  const session = await verifySession();

  const { configId, seed, status, tickCount, errorMessage } = payload;

  const run = await createRun({ configId, seed, createdBy: session.userId });

  await finishRun({
    id: run.id,
    status,
    tickCount,
    errorMessage,
  });

  revalidatePath('/runs');

  return { runId: run.id };
}
