'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Top-nav link with active-route highlight.
 *
 * Active state is the design system's single accent. Inactive links use
 * fg-muted, hovering to fg. See docs/design-system.md §6 (Page header).
 */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active =
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`relative px-1 py-2 text-sm transition-colors ${
        active
          ? 'text-accent font-medium after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-accent'
          : 'text-fg-muted hover:text-fg'
      }`}
    >
      {children}
    </Link>
  );
}
