import 'server-only';

// DAL contract: every Server Component inside (auth) calls verifySession()
// directly, even though the layout already ran it.
// See CLAUDE.md 'Authentication patterns'.
import { verifySession } from '@/lib/auth/dal';
import { SimulationShell } from './simulation-shell';

export default async function PlaygroundPage() {
  await verifySession();

  return <SimulationShell />;
}
