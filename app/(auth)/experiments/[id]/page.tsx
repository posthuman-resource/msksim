import 'server-only';

// Edit experiment config page.
// Fetches the config row by id and hydrates the ConfigEditor with existing values.
// verifySession() is called directly per CLAUDE.md 'Authentication patterns'.
// params is awaited per CLAUDE.md 'Known gotchas' (Next 16 async params).
// Page archetype: Form (docs/design-system.md §7).

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
    <div className="mx-auto max-w-6xl">
      <header className="border-b border-border pb-4">
        <h1 className="font-serif text-2xl font-semibold text-fg">Edit configuration</h1>
        <p className="mt-1 text-sm text-fg-muted">
          <code className="font-mono text-xs text-fg-muted">
            {result.row.contentHash.slice(0, 8)}
          </code>
        </p>
      </header>
      <div className="mt-6 rounded-md border border-border bg-surface p-6">
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
