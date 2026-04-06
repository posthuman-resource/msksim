import 'server-only';

// Export route for a single experiment config as a JSON attachment.
// Uses a Route Handler (not a Server Action) because Server Actions cannot set
// Content-Disposition. See CLAUDE.md 'Export conventions'.
//
// Authentication: verifySession() called directly (defense-in-depth — the proxy
// gates this path via cookie presence, and the DAL re-validates the session token).

import { verifySession } from '@/lib/auth/dal';
import { loadConfig } from '@/lib/db/configs';
import { exportFilename } from '@/app/(auth)/experiments/config-helpers';

export async function GET(
  _request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Verify session — this route is outside (auth) route group but is still protected
  try {
    await verifySession();
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }

  const { id } = await props.params;
  const result = await loadConfig(id);

  if (!result) {
    return new Response('Not found', { status: 404 });
  }

  const filename = exportFilename(result.row.name, result.row.contentHash);

  return new Response(result.row.contentJson, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
