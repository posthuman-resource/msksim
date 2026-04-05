'use client';

// Login form client component.
// Uses useActionState (React 19) for in-place error rendering without a full
// page navigation. The Server Component page.tsx wraps this and passes the
// pre-sanitized `next` redirect target as a prop.
//
// See: node_modules/next/dist/docs/01-app/02-guides/forms.md
//      § Validation errors and § Pending states
// See: https://react.dev/reference/react/useActionState

import { useActionState } from 'react';

import { loginAction } from './actions';
import type { LoginState } from './helpers';

interface LoginFormProps {
  next: string;
}

export default function LoginForm({ next }: LoginFormProps) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    loginAction,
    undefined,
  );

  const hasError = !!state?.message;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {/* Hidden field carries the post-login redirect target to the Server Action */}
      <input type="hidden" name="next" value={next} />

      <div className="flex flex-col gap-1">
        <label
          htmlFor="username"
          className="text-sm font-medium text-zinc-700"
        >
          Username
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          required
          aria-describedby={hasError ? 'login-error' : undefined}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="password"
          className="text-sm font-medium text-zinc-700"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-describedby={hasError ? 'login-error' : undefined}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
        />
      </div>

      {/* Error slot — role="alert" + aria-live="polite" so screen readers
          announce the message without stealing focus */}
      <p
        id="login-error"
        role="alert"
        aria-live="polite"
        className="min-h-[1.25rem] text-sm text-red-600"
      >
        {state?.message}
      </p>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
