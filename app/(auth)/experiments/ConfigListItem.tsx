'use client';

import Link from 'next/link';

import type { Config } from '@/db/schema/configs';
import { duplicateConfigAction, deleteConfigAction } from './actions';

interface ConfigListItemProps {
  config: Config;
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function ConfigListItem({ config }: ConfigListItemProps) {
  return (
    <tr className="hover:bg-surface-muted">
      <td className="px-4 py-2.5">
        <Link href={`/experiments/${config.id}`} className="font-medium text-fg hover:text-accent">
          {config.name}
        </Link>
      </td>
      <td className="px-4 py-2.5 font-mono text-xs text-fg-muted">
        {dateFormatter.format(new Date(config.updatedAt))}
      </td>
      <td className="px-4 py-2.5 font-mono text-xs text-fg-muted">
        {config.contentHash.slice(0, 8)}
      </td>
      <td className="px-4 py-2.5 text-right">
        <div className="flex items-center justify-end gap-1">
          <Link
            href={`/playground?configId=${config.id}`}
            className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:bg-surface-muted hover:text-fg"
          >
            Run
          </Link>
          <Link
            href={`/experiments/${config.id}`}
            className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:bg-surface-muted hover:text-fg"
          >
            Edit
          </Link>
          <form action={duplicateConfigAction.bind(null, config.id)}>
            <button
              type="submit"
              className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:bg-surface-muted hover:text-fg"
            >
              Duplicate
            </button>
          </form>
          <Link
            href={`/api/configs/${config.id}/export`}
            className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:bg-surface-muted hover:text-fg"
          >
            Export
          </Link>
          <form
            action={deleteConfigAction.bind(null, config.id)}
            onSubmit={(e) => {
              if (!confirm(`Delete "${config.name}"? This also deletes any runs it owns.`)) {
                e.preventDefault();
              }
            }}
          >
            <button
              type="submit"
              className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-danger hover:bg-danger-bg"
            >
              Delete
            </button>
          </form>
        </div>
      </td>
    </tr>
  );
}
