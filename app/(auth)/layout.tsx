// Authenticated route group layout.
// This layout does NOT declare <html> or <body> — the root app/layout.tsx
// from step 00 owns those. This file is purely a security checkpoint.
//
// Every page inside app/(auth)/ inherits this layout, so the verifySession()
// call here fires on every authenticated route render. Step 07 will add the
// real header/nav/logout UI inside this layout.

import { verifySession } from '@/lib/auth/dal';

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // verifySession() throws NEXT_REDIRECT to /login if the session is missing or
  // invalid. No explicit redirect logic is needed here.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _session = await verifySession();

  return <>{children}</>;
}
