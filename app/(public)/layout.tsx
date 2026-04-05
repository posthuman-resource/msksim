import 'server-only';

// Public route group layout — intentionally empty today.
//
// This group is a pre-emptive carveout for the post-v1 /reports/* public routes
// that researchers can share without authentication. It exists now so the proxy's
// matcher regex and PUBLIC_PATHS allowlist do not need to be rewritten when
// public routes land.
//
// IMPORTANT: Do NOT add a page.tsx here. app/(auth)/page.tsx already handles
// the / route. Two handlers for / would cause a Next.js build error.
// See node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route-groups.md
// § Caveats.

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
