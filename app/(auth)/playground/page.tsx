import 'server-only';

// DAL contract: every Server Component inside (auth) calls verifySession()
// directly, even though the layout already ran it.
// See CLAUDE.md 'Authentication patterns'.
import { verifySession } from '@/lib/auth/dal';
import { SimulationShell } from './simulation-shell';

export default async function PlaygroundPage({
  searchParams,
}: {
  searchParams: Promise<{ configId?: string; seed?: string }>;
}) {
  await verifySession();
  const params = await searchParams;

  return <SimulationShell initialConfigId={params.configId} initialSeedParam={params.seed} />;
}
