'use server';

import { revalidatePath } from 'next/cache';

import { verifySession } from '@/lib/auth/dal';
import { deleteRun as deleteRunHelper } from '@/lib/db/runs';

export async function deleteRunAction(id: string): Promise<void> {
  await verifySession();
  await deleteRunHelper(id);
  revalidatePath('/runs');
}
