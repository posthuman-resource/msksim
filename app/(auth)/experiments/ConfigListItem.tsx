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
    <tr className="border-b border-zinc-100 hover:bg-zinc-50">
      <td className="py-3 pr-4">
        <Link
          href={`/experiments/${config.id}`}
          className="font-medium text-zinc-900 hover:text-blue-600"
        >
          {config.name}
        </Link>
      </td>
      <td className="py-3 pr-4 text-sm text-zinc-500">
        {dateFormatter.format(new Date(config.updatedAt))}
      </td>
      <td className="py-3 pr-4">
        <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-mono text-zinc-600">
          {config.contentHash.slice(0, 8)}
        </code>
      </td>
      <td className="py-3">
        <div className="flex items-center gap-2">
          <Link
            href={`/experiments/${config.id}`}
            className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
          >
            Edit
          </Link>

          <form action={duplicateConfigAction.bind(null, config.id)}>
            <button
              type="submit"
              className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100"
            >
              Duplicate
            </button>
          </form>

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
              className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          </form>

          <Link
            href={`/playground?configId=${config.id}`}
            className="rounded px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50"
          >
            Run
          </Link>

          <Link
            href={`/api/configs/${config.id}/export`}
            className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100"
          >
            Export
          </Link>
        </div>
      </td>
    </tr>
  );
}
