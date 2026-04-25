import 'server-only';

// Parameter sweep configuration screen (step 28).
// Server Component fetches the user's saved configs and the optional `configId`
// query param, then hands off to the Client SweepForm.
// verifySession() is called directly per CLAUDE.md 'Authentication patterns'.

import type { Metadata } from 'next';

import { verifySession } from '@/lib/auth/dal';
import { listConfigs } from '@/lib/db/configs';
import { ExperimentConfig } from '@/lib/schema/experiment';

import { SweepForm } from '../sweep-form';

export const metadata: Metadata = { title: 'msksim — parameter sweep' };

interface SweepPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SweepPage({ searchParams }: SweepPageProps) {
  await verifySession();

  const rows = await listConfigs({ limit: 100 });
  const configs = rows.map((row) => ({
    id: row.id,
    name: row.name,
    config: ExperimentConfig.parse(JSON.parse(row.contentJson)),
  }));

  const params = await searchParams;
  const initialConfigId = typeof params.configId === 'string' ? params.configId : null;

  return <SweepForm configs={configs} initialConfigId={initialConfigId} />;
}
