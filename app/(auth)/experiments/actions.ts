'use server';
import 'server-only';

// Experiment config Server Actions.
// File-level 'use server' marks all exports as Server Actions so ConfigEditor
// (a Client Component) can import them without bundling server-only modules.
//
// Every action calls verifySession() as its first statement — defense in depth
// per CLAUDE.md 'Authentication patterns' and Next 16 data-security.md §DAL for mutations.
// redirect() is always OUTSIDE try/catch so NEXT_REDIRECT propagates to the runtime.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { ExperimentConfig } from '@/lib/schema/experiment';
import { saveConfig, loadConfig, deleteConfig, updateConfig } from '@/lib/db/configs';
import { verifySession } from '@/lib/auth/dal';

export type SaveState =
  | { ok: true; id: string }
  | { ok: false; fieldErrors: Record<string, string[]> };

/**
 * Save or update an experiment config.
 *
 * FormData fields expected:
 *   - payload: JSON string of the ExperimentConfig (all fields except name)
 *   - name: string — the human-readable config name (sibling column, not part of the schema)
 *   - id: string | absent — if present, updates the existing row; if absent, inserts a new row
 *
 * Called via useActionState(saveConfigAction, initialState) + handleSubmit in ConfigEditor.
 * On success: revalidates /experiments and redirects there (redirect throws NEXT_REDIRECT).
 * On failure: returns { ok: false, fieldErrors } for inline error display.
 */
export async function saveConfigAction(
  prevState: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const { userId } = await verifySession();

  const payloadStr = formData.get('payload');
  if (typeof payloadStr !== 'string' || !payloadStr) {
    return { ok: false, fieldErrors: { _root: ['Invalid payload'] } };
  }

  let json: unknown;
  try {
    json = JSON.parse(payloadStr);
  } catch {
    return { ok: false, fieldErrors: { _root: ['Payload is not valid JSON'] } };
  }

  const validated = ExperimentConfig.safeParse(json);
  if (!validated.success) {
    return {
      ok: false,
      fieldErrors: validated.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const name = (formData.get('name') as string | null)?.trim() || 'Untitled';
  const id = formData.get('id') as string | null;

  if (id) {
    await updateConfig({ id, name, config: validated.data });
  } else {
    await saveConfig({ name, config: validated.data, createdBy: userId });
  }

  revalidatePath('/experiments');
  redirect('/experiments');
}

/**
 * Duplicate an existing config under "Copy of <original name>".
 * The content is identical, so the content_hash is the same as the original.
 */
export async function duplicateConfigAction(id: string): Promise<void> {
  await verifySession();
  const result = await loadConfig(id);
  if (!result) throw new Error(`Config ${id} not found`);
  await saveConfig({ name: `Copy of ${result.row.name}`, config: result.parsed });
  revalidatePath('/experiments');
}

/**
 * Permanently delete a config by id.
 * The confirm() gate runs client-side in ConfigListItem before this action fires.
 */
export async function deleteConfigAction(id: string): Promise<void> {
  await verifySession();
  await deleteConfig(id);
  revalidatePath('/experiments');
}
