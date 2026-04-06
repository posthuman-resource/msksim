import 'server-only';

// DAL contract: every Server Component inside (auth) calls verifySession()
// directly, even though the layout already ran it.
// See CLAUDE.md 'Authentication patterns'.
import { verifySession } from '@/lib/auth/dal';

export default async function RunsPage() {
  await verifySession();

  return (
    <div className="rounded-lg bg-white p-6 shadow-sm">
      <h1 className="text-xl font-bold text-zinc-900">Runs</h1>
      <p className="mt-2 text-sm text-zinc-600">This view is built in step 26.</p>
    </div>
  );
}
