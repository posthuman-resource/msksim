import 'server-only';

// Edit experiment config page.
// Fetches the config row by id and hydrates the ConfigEditor with existing values.
// verifySession() is called directly per CLAUDE.md 'Authentication patterns'.
// params is awaited per CLAUDE.md 'Known gotchas' (Next 16 async params).

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { verifySession } from '@/lib/auth/dal';
import { loadConfig } from '@/lib/db/configs';
import { ConfigEditor } from '../ConfigEditor';

interface EditConfigPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: EditConfigPageProps): Promise<Metadata> {
  const { id } = await params;
  const result = await loadConfig(id);
  const name = result?.row.name ?? 'Config';
  return { title: `msksim — edit ${name}` };
}

export default async function EditConfigPage({ params }: EditConfigPageProps) {
  await verifySession();

  const { id } = await params;
  const result = await loadConfig(id);

  if (!result) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-zinc-900">Edit configuration</h1>
        <p className="mt-1 text-sm text-zinc-500">
          <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-600">
            {result.row.contentHash.slice(0, 8)}
          </code>
        </p>
      </div>
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <ConfigEditor
          mode="edit"
          configId={result.row.id}
          initialName={result.row.name}
          initialValues={result.parsed}
        />
      </div>
    </div>
  );
}
