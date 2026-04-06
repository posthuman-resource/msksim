// Next.js 16 file convention. This was called `middleware.ts` in Next ≤ 15.
// Exported function is `proxy` (not `middleware` — that is deprecated in v16).
// Runs on the Node.js runtime; setting `runtime` in this file throws at build time.
// See CLAUDE.md 'Next.js 16 deltas from training data' and
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { SESSION_COOKIE_NAME } from '@/lib/auth/sessions';

// Public paths that do not require authentication.
// The matcher regex below is a belt; this list is the suspender — it covers
// paths the regex might let through (e.g. /reports without trailing slash).
// See plan file §7 for the belt-and-suspenders rationale.
const PUBLIC_PATHS = ['/login', '/reports'] as const;

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

/**
 * Proxy — cheap cookie-presence redirects only.
 *
 * This is a UX optimization, NOT the security boundary. It prevents a Server
 * Component render just to redirect an anonymous visitor, but it does NOT
 * validate the session token against the database.
 *
 * Auth policy lives in lib/auth/dal.ts. Every Server Component in app/(auth)/
 * and every Server Action calls verifySession() directly.
 *
 * IMPORTANT: Do NOT import lib/auth/sessions.ts beyond SESSION_COOKIE_NAME,
 * and do NOT import lib/db/client.ts. Adding those turns this proxy into a
 * hot-path DB caller and causes Turbopack to attempt to bundle better-sqlite3
 * native bindings into the proxy module graph — which fails opaquely.
 * See CLAUDE.md 'Known gotchas'.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths and API auth routes through unconditionally.
  if (isPublicPath(pathname) || pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  // Cookie-presence check only — no DB lookup, no argon2, no session validation.
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);
  if (hasSessionCookie) {
    return NextResponse.next();
  }

  // Redirect to /login, preserving the original destination for post-login redirect.
  // Step 07's login Server Action reads the `next` query param to redirect back.
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.searchParams.set('next', pathname + request.nextUrl.search);

  return NextResponse.redirect(loginUrl); // defaults to 307 Temporary Redirect
}

export const config = {
  matcher: [
    // Run on everything EXCEPT:
    //   - Static Next internals: _next/static, _next/image
    //   - Public-folder assets by extension (favicon, svg, png, jpg, woff, woff2, ico)
    //   - The login page (allowlisted by name since the matcher runs before our handler)
    //   - The future /reports/* public routes (pre-allowlisted so zero-refactor v2 carveout)
    //   - API auth routes under /api/auth/*
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2)|login|reports|api/auth).*)',
  ],
};
