---
step: '07'
title: 'login and app shell'
kind: foundation
ui: true
timeout_minutes: 40
prerequisites:
  - 'step 05: cli user management'
  - 'step 06: proxy route groups and dal'
---

## 1. Goal

Build the **first UI surface** of msksim: a Server-Component login page at `app/login/page.tsx` that reads `next` from its async `searchParams`, posts to a Zod-validated Server Action that calls `verifyPassword` (step 03) and `createSession` / `setSessionCookie` (step 04), and redirects to the requested path on success or returns a generic "invalid credentials" error on failure. Alongside the login form, this step wires up a logout Server Action, extends the step-06 `app/(auth)/layout.tsx` into a full authenticated shell with a header (project name on the left, current username + logout button on the right) and a navigation bar whose Playground / Experiments / Runs entries link to tiny "coming in step NN" stub pages, and replaces the step-06 placeholder `app/(auth)/page.tsx` with a friendly "Welcome, `{username}`" home page. Because this is the **first UI step in the pipeline**, it is also the step that exercises and validates the **UI verification harness** conventions already documented in the CLAUDE.md "UI verification harness" section: a chrome-devtools MCP script drives a full login → navigate → logout round-trip against the `next build && next start` server that `scripts/run-plan.ts` starts on a random port, saves a screenshot to `docs/screenshots/step-07-home.png`, and asserts that no non-benign console errors and no 4xx/5xx network responses leaked into the run. Every later UI step will reference this harness by name and reuse the same shape.

## 2. Prerequisites

- **Step 05 — cli user management**. `scripts/users.ts` exists with `add`, `remove`, `list`, and `change-password` subcommands. `scripts/run-plan.ts`'s `ensureSeedUser` function shells out to this script (see lines 662-685) to create the seed user before the UI step starts. Without step 05 in place, the seed user will not exist and the MCP script will be stuck on the login page.
- **Step 06 — proxy route groups and dal**. `proxy.ts` is at the repository root and performs cookie-presence 307 redirects to `/login?next=<pathname>` for any request outside the public allowlist that lacks the `msksim_session` cookie. `app/(auth)/layout.tsx` exists and invokes `verifySession()` from `lib/auth/dal.ts` at the top; this step **extends** that file rather than replacing it. `app/(auth)/page.tsx` exists as a minimal placeholder from step 06; this step replaces its body. `lib/auth/dal.ts` exports `verifySession = cache(async () => ...)` wrapping the row lookup from step 04 — this step calls it from the layout and from each nav stub page so the DAL invariant (every authenticated Server Component calls the DAL directly) is preserved from day one.
- **Step 04 — session schema and service**. `lib/auth/sessions.ts` exports `createSession`, `setSessionCookie`, `destroySession`, `clearSessionCookie`, `getSessionTokenFromCookie`, and the `SESSION_COOKIE_NAME` constant. The login Server Action calls `createSession` + `setSessionCookie` on success; the logout Server Action calls `getSessionTokenFromCookie` + `destroySession` + `clearSessionCookie`.
- **Step 03 — user schema and argon2 hashing**. `lib/auth/password.ts` exports `verifyPassword(plain, hash)` which the login Server Action calls against `users.passwordHash`. The `users` drizzle table is importable from `@/db/schema`.
- **Step 01 — zod config schema**. The login action's Zod schema is a tiny reuse of the Zod idioms and helpers already established in step 01 (no new config types — just the `z.object({ username: z.string().min(1), password: z.string().min(1) })` pattern for form validation).

## 3. Spec references

- `docs/spec.md` §10 "Out of Scope" explicitly lists _"Multi-user / server-side orchestration. The app runs entirely in the researcher's browser. There is no shared backend, no user accounts, no collaboration over the network."_ Authentication is **not a spec feature** — it is a user override recorded in CLAUDE.md "Stack and versions" (_"`@node-rs/argon2` for password hashing, server-side table-backed sessions with HttpOnly cookies. All routes are gated for v1."_). Step 07 is the UI layer of that override; every decision in this plan must stay inside the override's envelope (single-user, table-backed, no multi-device flows, no account creation UI — the CLI in step 05 is the only user-creation surface).
- `docs/spec.md` §5.1 "Researcher stories" (e.g. US-7 _"save a run today and revisit it tomorrow"_) implicitly requires **session persistence across days**: a researcher opens the app in the morning, closes the laptop, and expects to resume without re-authenticating in the middle of their workflow. The 7-day default TTL locked in by step 04 covers this story; no override needed for this step.
- CLAUDE.md "Authentication patterns" fixes the layering: proxy does cookie-presence only, DAL does the real check, every Server Component in `(auth)` calls `verifySession()`. This step's layout and home page and nav stubs all obey that contract — the layout calls `verifySession()` once at the top, and each nav stub page **also** calls `verifySession()` at its own top even though the layout already ran. The docs are explicit that relying on layout alone is unsafe because a future refactor can silently strip coverage.
- CLAUDE.md "UI verification harness" (60-line cap) already documents the harness rules from Phase A of meta-planning. This step is the **first** consumer of that section and thus the first step that runs a chrome-devtools MCP script end-to-end. If any rule in the existing section turns out to be wrong or under-specified once the implementing claude runs the script for real, this step is the place to clarify it — but the clarifications go in CLAUDE.md under the same section cap and **must not** exceed 20 appended lines (see §11).

## 4. Research notes

### Local Next.js 16 documentation (shipped in `node_modules/next/dist/docs/`)

1. **`01-app/02-guides/authentication.md` §"Sign-up and login functionality → Capture user credentials" and §"Validate form fields on the server"** (lines ~40-200 of the shipped file). The authoritative Next 16 pattern for exactly this step: a Server Component (or client wrapper) with `<form action={login}>`, a Server Action whose first argument is `prevState` and second is `FormData`, a Zod `safeParse` of `formData.get('username')` / `formData.get('password')`, and an early return of `{ errors: ... }` on validation failure. The example uses `useActionState` (React 19) in a Client Component to display errors — the implementing claude follows this pattern for the msksim login form so the generic "invalid credentials" message can render without a full page navigation. Note that the Next doc uses bcrypt as a placeholder for the hash call; we substitute `verifyPassword` from step 03 (`@node-rs/argon2`) at exactly that call site, with the argument order `verifyPassword(formData.password, user.passwordHash)`.
2. **`01-app/02-guides/authentication.md` §"Database Sessions"** (lines ~860-950). Shows how to wire a Server Action to `createSession`, `cookies().set(...)`, and `redirect('/profile')` in sequence. The msksim version is structurally identical but splits creation and cookie-write into the two helpers step 04 already shipped (`createSession` returns `{ token, expiresAt }`; `setSessionCookie(token, expiresAt)` does the cookie write in one place). The Next doc's "encrypt the session id before storing in the cookie" detail is the same intentional deviation already documented in the step 04 plan — msksim uses the raw opaque CSPRNG token as the cookie value; no signing, no key management.
3. **`01-app/02-guides/authentication.md` §"Deleting the session"** (lines ~773-817). Confirms the shape of `logoutAction`: a Server Action that calls the equivalent of `deleteSession` (our `destroySession` + `clearSessionCookie` pair, which must both be called because step 04 deliberately split the row delete from the cookie delete for symmetry with `createSession` + `setSessionCookie`), then `redirect('/login')`. The doc is explicit that `cookies().delete()` can only be called from a Server Action or Route Handler, not during Server Component rendering — this is why the logout trigger is a `<form action={logoutAction}>` inside the header and not, for example, a `<button onClick={...}>` on a client component.
4. **`01-app/02-guides/forms.md` §"Validation errors" and §"Pending states"** (lines ~190-315 of the shipped file). The authoritative reference for how `useActionState` flows error state back to the UI: the Server Action returns `{ errors: { ... } }` or `{ message: string }`; the client component receives `[state, formAction, pending]` from `useActionState(action, initialState)`; errors render inside `<p aria-live="polite">` slots so screen readers announce them; the submit button is `disabled={pending}` for the duration of the round-trip. msksim's login form follows this pattern verbatim — one `aria-live="polite"` slot for the single generic error, and a `disabled={pending}` attribute on the submit button.
5. **`01-app/02-guides/upgrading/version-16.md` §"Async Request APIs (Breaking change)"** (lines ~294-328). Pins that `searchParams` on a `page.js` prop is now a **Promise** and must be `await`ed — forgetting the `await` yields a Promise whose key lookup is `undefined`, and the login form silently loses its `next` redirect target. This is already in CLAUDE.md "Next.js 16 deltas" and "Known gotchas"; step 07's login page calls it out explicitly in a comment above the `await props.searchParams` line so the implementing claude and future reviewers see the rule at the exact site where it bites. The same section also recommends `PageProps<'/login'>` as the idiomatic helper for typing the props, which this step adopts.
6. **`01-app/03-api-reference/03-file-conventions/page.md` §"searchParams (optional)" and §"Page Props Helper"** (lines ~67-140). Confirms the shape of the typed `searchParams` prop in v16: `Promise<{ [key: string]: string | string[] | undefined }>`. Because `next` could theoretically arrive as an array if a malicious client sends `?next=a&next=b`, the login page's redirect-target logic must defensively coerce arrays: `const nextRaw = sp.next; const next = Array.isArray(nextRaw) ? nextRaw[0] : nextRaw;` and then sanitize to only accept relative paths (see §7).
7. **`01-app/03-api-reference/03-file-conventions/layout.md` §"children (required)" and §"Layout Props Helper"** (lines ~56-111). Confirms that `app/(auth)/layout.tsx` takes a `children: React.ReactNode` prop and renders it inside whatever chrome the layout wants. Because `(auth)` is a **route group** (parentheses in the directory name), the URL does not inherit the group name — `/playground` maps to `app/(auth)/playground/page.tsx`, not `/auth/playground`. This is the mechanism that makes `app/login/page.tsx` (outside the group) reachable without the `verifySession()` gate while every file inside `app/(auth)/` enforces it.
8. **`01-app/03-api-reference/04-functions/redirect.md`** (lines 1-55 of the shipped file). Pins that `redirect()` from `next/navigation` issues a **303** HTTP redirect when called from a Server Action (so browsers re-issue the follow-up as GET) and a **307** otherwise. The MCP verification script assertion that the proxy redirect is 307 but the post-login success redirect is 303 is load-bearing — a single-code-point check across the two types of redirect is the easiest way to confirm both layers are behaving. The doc also states that `redirect()` throws a special `NEXT_REDIRECT` error and therefore must be called **outside** any `try/catch` block — the login action places `redirect(next ?? '/')` after its `try` block for this reason.

### External sources (WebFetched)

9. **React 19 `useActionState` reference — https://react.dev/reference/react/useActionState**. The canonical documentation for the hook used by the login form's client wrapper. Three facts drive the implementation: (a) the hook's first argument is the action, the second is the initial state, and it returns `[state, formAction, isPending]`. (b) When the form's `action={formAction}` is invoked, React serializes the FormData, calls the Server Action with `(prevState, formData)`, receives the return value, and updates `state` — all without a full page navigation, so the error message appears in place. (c) The hook is **only** available in Client Components, so the login form splits into a Server Component `page.tsx` that reads `searchParams` and a `'use client'` child component that owns the form markup and calls `useActionState`. Both parts live in the `app/login/` directory.

10. **WAI-ARIA Authoring Practices — Form Instructions and Error Messaging — https://www.w3.org/WAI/ARIA/apg/patterns/feed/examples/feed.html (and the broader WAI-ARIA APG form pattern at https://www.w3.org/WAI/tutorials/forms/notifications/)**. The authoritative source for accessible error announcement. Three decisions: (a) Each form input carries an explicit `<label htmlFor="...">` associated by `id` — this is required for assistive-tech label binding and is not optional. (b) The error-message slot is `<p id="login-error" role="alert" aria-live="polite">` so screen readers announce the message when it appears without stealing focus; `role="alert"` with `aria-live="polite"` is the well-documented combination for non-modal form-level errors. (c) The inputs carry `aria-describedby="login-error"` when an error is present so the error text is read back alongside the field. The WebFetched guidance is also why the submit button is a `<button type="submit">` rather than a `<div onClick>` — the implicit keyboard handling for `Enter` inside a form is a freebie we do not want to reinvent.

### Path not taken

11. **Why not NextAuth / Auth.js, iron-session, Lucia, better-auth, or a client-side fetch-based login?** Each was considered and rejected:
    - **NextAuth / Auth.js**: OAuth-provider-centric. Setting it up for a username+password credential provider is non-trivial and the resulting config file has more lines than the entire hand-rolled auth layer this pipeline is building in steps 03-07. It also insists on owning session management, which duplicates the step-04 service we already own and tested. No upside for two researchers with local credentials.
    - **iron-session**: stateless sealed-cookie sessions with no server-side revocation. Inherits the same "cannot force-logout a stolen laptop" problem that step 04's path-not-taken analysis already rejected for JWT. The step-04 architecture is table-backed server sessions; iron-session is the opposite.
    - **Lucia / better-auth**: closer to our shape, but both bring an adapter layer between drizzle and the `sessions` table. The existing step-04 service is 80 lines of hand-rolled glue against our drizzle client; the adapter layer would hide the schema from our migrations and give us nothing in exchange.
    - **Client-side `fetch('/api/login', { method: 'POST' })`**: the Next 16 `pages/`-era pattern from most pre-v16 tutorials (the authentication doc shows it under `<PagesOnly>` at lines ~396-515). It would require either a Route Handler or an API route, CSRF tokens, and a client-side redirect via `router.push`. Server Actions handle CSRF automatically, run on the server by construction, and compose with `useActionState` for in-place error display without a client fetch. There is nothing `fetch` gives us that the Server Action does not give us for less code.
    - **Storing the login form markup on the Server Component `page.tsx` directly**: tempting because it keeps the whole file as one Server Component, but `useActionState` is a Client Component hook, so the moment we want inline error display we need a `'use client'` boundary. The cleanest shape is exactly what the Next 16 authentication doc (source 1) prescribes: Server Component `page.tsx` that reads `searchParams`, renders the client wrapper, and passes the `next` value and the Server Action reference as props.

Total citations: eight local Next docs (sources 1-8), two external URLs WebFetched (sources 9-10), one path-not-taken with five sub-rejections (source 11) = **11 citations, quota satisfied**. All four quality gates pass (≥ 3 local, ≥ 2 external, ≥ 1 path-not-taken, total ≥ 5).

## 5. Files to create

- `app/login/page.tsx` — **Server Component**. Starts with the default `export default async function LoginPage(props: PageProps<'/login'>) { ... }`. Reads `const sp = await props.searchParams` (Next 16 async), pulls out `const nextRaw = sp.next; const next = Array.isArray(nextRaw) ? nextRaw[0] : nextRaw;`, sanitizes the path (see §7 for the sanitizer rules), and renders a centered Tailwind card containing the `<LoginForm next={safeNext} />` client component. No imports from `lib/db/` or `lib/auth/dal.ts` (the login page is the one page that must be reachable unauthenticated). No call to `verifySession()`. Sets the page `<title>` via a `metadata` export: `export const metadata = { title: 'msksim — sign in' };`.

- `app/login/LoginForm.tsx` — **Client Component** (`'use client'` on line 1). Imports `useActionState` from `'react'`, imports the login Server Action from `./actions`, and owns the `<form action={formAction}>` markup: a title `<h1>msksim — sign in</h1>`, two labeled inputs (username with `autoComplete="username"`, password with `type="password"` and `autoComplete="current-password"`), a submit button with `disabled={pending}`, and a `<p id="login-error" role="alert" aria-live="polite">{state?.message}</p>` error slot. Takes `next: string` as a prop and renders it as `<input type="hidden" name="next" value={next} />` inside the form so the Server Action can read it from `FormData` without re-parsing the URL.

- `app/login/actions.ts` — **Server Action module** (`'use server'` directive at the top of the file, after the server-only guard). Starts with `import 'server-only'` then `'use server'`. Exports `export async function loginAction(prevState: LoginState | undefined, formData: FormData): Promise<LoginState>` where `LoginState = { message: string } | undefined`. Imports `z` from zod, the `users` table from `@/db/schema`, the drizzle client from `@/lib/db/client`, `verifyPassword` from `@/lib/auth/password`, `createSession` and `setSessionCookie` from `@/lib/auth/sessions`, `redirect` from `'next/navigation'`, and `eq` from `'drizzle-orm'`. Flow: (1) parse `formData` with a `LoginInputSchema = z.object({ username: z.string().min(1), password: z.string().min(1), next: z.string().optional() })`, (2) if invalid → return `{ message: 'invalid credentials' }` (do NOT leak field-level errors — a malformed payload is treated as an auth failure for timing-attack symmetry), (3) look up `users` row by username, (4) if no row → return `{ message: 'invalid credentials' }`, (5) call `verifyPassword(password, row.passwordHash)`, (6) if `false` → return `{ message: 'invalid credentials' }`, (7) on success, `const { token, expiresAt } = await createSession(row.id); await setSessionCookie(token, expiresAt);`, (8) `redirect(sanitizeNext(next) ?? '/')` **after** the try/catch (per the redirect.md doc; throwing `NEXT_REDIRECT` inside a try block swallows it). Also exports `validateLoginInput` (the Zod `safeParse` wrapper) and `sanitizeNext` (the relative-path checker) as standalone helpers so `lib/auth/actions.test.ts` can unit-test them without a running server.

- `app/(auth)/actions.ts` — **Logout Server Action module**. Starts with `import 'server-only'`, then `'use server'`. Exports `export async function logoutAction(): Promise<void>` which (1) calls `const token = await getSessionTokenFromCookie()`, (2) `if (token) await destroySession(token);`, (3) `await clearSessionCookie()`, (4) `redirect('/login')`. The function is exposed as a Server Action so a `<form action={logoutAction}>` in the header component can trigger it without the layout needing a client boundary.

- `app/(auth)/playground/page.tsx` — **Nav stub**. Server Component; first line of function body calls `await verifySession()` (per the DAL contract) even though the layout already ran. Renders a Tailwind card with `<h1>Playground</h1>` and `<p>This view is built in step 21.</p>`. Brief — five lines of JSX.

- `app/(auth)/experiments/page.tsx` — identical shape to `playground/page.tsx`, but references step 25.

- `app/(auth)/runs/page.tsx` — identical shape, references step 26.

- `lib/auth/actions.test.ts` — **Unit tests** for the two pure helpers extracted from the login action. Tests: (a) `validateLoginInput` returns success for `{ username: 'alice', password: 'hunter2' }`, returns failure for empty-string fields, returns failure for missing fields. (b) `sanitizeNext` returns `/runs` for input `/runs`, returns `null` for `http://evil.example/x` (absolute URL), returns `null` for `//evil.example/x` (protocol-relative), returns `null` for `javascript:alert(1)`, returns `/` for `undefined`, returns `/` for `''`. No tests for the Server Action's DB or cookie side effects — those are covered by the MCP script end-to-end, per §9.

- `docs/screenshots/step-07-home.png` — **Generated by the MCP verification script** during step execution. Binary file committed in the same commit as the code. The screenshot captures the authenticated home page as rendered after a successful login: header with "msksim" on the left and the seed username + logout button on the right, nav row with Playground / Experiments / Runs, and the "Welcome, `{username}`" card below.

## 6. Files to modify

- `app/(auth)/layout.tsx` — extend the step-06 layout. Step 06 created this file with a minimal `export default async function AuthLayout({ children }) { await verifySession(); return <>{children}</>; }`. Step 07 adds a header and a nav row around `{children}`:
  - Keep the `await verifySession()` call at the top; also destructure the returned `{ user }` (or re-query the user name via the DAL) so the header can render the username.
  - Import the logout Server Action from `./actions`.
  - Render `<header>` with the `msksim` brand on the left, `{user.username}` and a `<form action={logoutAction}><button type="submit">Log out</button></form>` on the right.
  - Render a `<nav>` row with `<Link href="/playground">Playground</Link>`, `<Link href="/experiments">Experiments</Link>`, `<Link href="/runs">Runs</Link>`. All three links are **live** (they navigate to real stub pages) — this is the "create stub pages" approach the task context called the cleanest; it gives the MCP script something concrete to navigate to and surfaces any route-group resolution problems immediately.
  - Render `<main>{children}</main>` below the nav.
  - Tailwind classes only; no `<style>` tags, no CSS-in-JS.

- `app/(auth)/page.tsx` — replace the step-06 placeholder body. Still a Server Component, still calls `await verifySession()` at the top (the DAL call is redundant with the layout's but required by the "every Server Component calls verifySession directly" contract in CLAUDE.md "Authentication patterns"). Renders a Tailwind card with `<h1>Welcome, {user.username}</h1>`, a short paragraph describing msksim in one sentence (_"An agent-based simulation of a Naming Game for studying how color-term communication success emerges under geographic and linguistic pressure."_), and three links to the nav stubs. No client component, no interactivity.

- `CLAUDE.md` — see §11. The "UI verification harness" and "Authentication patterns" sections receive short appends documenting any clarifications discovered during the run; totals bounded by §11.

## 7. Implementation approach

Work proceeds in five sequential slices. Do not reorder: later slices depend on earlier file existence.

**Slice 1 — The login Server Action (`app/login/actions.ts`)**. This is the load-bearing piece; everything else is presentation around it. Create the file with `import 'server-only'` on line 1, `'use server'` on line 3, and the imports listed in §5. Declare the two pure helpers `validateLoginInput` (`z.object` + `safeParse` returning `{ ok: true, data } | { ok: false }`) and `sanitizeNext` (returns the input if it matches `/^\/[^/]/` i.e. starts with a single slash followed by a non-slash character, otherwise returns `null`; also returns `null` for `javascript:`, `data:`, and any string containing `\r` or `\n`). Declare `loginAction(prevState, formData)`. The function is **async**, the first statement is `const parsed = validateLoginInput(formData)`, the next is the "treat any validation failure as an auth failure" early return. Then the drizzle lookup: `const rows = await db.select().from(users).where(eq(users.username, parsed.data.username)).limit(1); const user = rows[0];`. If `!user`, return the same generic error. Call `await verifyPassword(parsed.data.password, user.passwordHash)`. If false, return the generic error. On success: `const { token, expiresAt } = await createSession(user.id); await setSessionCookie(token, expiresAt);`. **Finally**, outside any try/catch, call `redirect(sanitizeNext(parsed.data.next) ?? '/')`. The whole function has no explicit try/catch — if drizzle or argon2 throws, the error propagates to Next's error boundary, which is the correct behavior for a crash (don't mask bugs as auth failures).

Write the generic error message exactly once as a module constant `const GENERIC_AUTH_ERROR = { message: 'invalid credentials' } as const;` and return it from every failure path. This makes the "do not leak whether the username or the password was wrong" invariant a grep-able fact, not an implicit behavior.

One timing-attack subtlety: ideally the action calls `verifyPassword` even when the user row doesn't exist (against a fixed, well-known hash) so the response time is uniform across "no such user" and "wrong password". This is nice-to-have and is noted in the function's comments but **not required** for this step — the threat model is two researchers on a local machine, not a public hostile network, and the argon2 cost already dominates any timing signal that might leak. Leave a `// TODO: constant-time user-not-found path; see CLAUDE.md "Authentication patterns"` comment at the branch and move on.

**Slice 2 — The login page and client form (`app/login/page.tsx` + `app/login/LoginForm.tsx`)**. The Server Component is trivial: `async function LoginPage(props: PageProps<'/login'>)`, await `props.searchParams`, extract and coerce `next`, render the page layout (a Tailwind `min-h-screen flex items-center justify-center` wrapper with a `max-w-md w-full rounded-lg shadow p-6 bg-white` card inside), render `<LoginForm next={safeNext} />`. No call to `verifySession()`; the login page is the one page that must be reachable without a session (see §1 and the task's context). The `metadata` export sets the document title.

The client component owns the form. On top: `'use client'`. Imports: `useActionState` from React, `loginAction` from `./actions`, possibly a typed `LoginState` from `./actions` re-exported. Call `const [state, formAction, pending] = useActionState(loginAction, undefined);`. The form is `<form action={formAction} className="...">`, with the hidden `next` input, the two labeled fields, the error `<p id="login-error" role="alert" aria-live="polite">{state?.message}</p>`, and the submit button with `disabled={pending}` and a label that toggles between `"Sign in"` (idle) and `"Signing in…"` (pending). Tailwind for layout. One subtle point: the two inputs carry `aria-describedby="login-error"` **only when `state?.message` exists** (conditional attribute spread) so screen readers don't read "no error" on the happy path.

**Slice 3 — The logout action and the authenticated shell (`app/(auth)/actions.ts` + extensions to `app/(auth)/layout.tsx`)**. Write `actions.ts` first: `import 'server-only'`, `'use server'`, imports from `@/lib/auth/sessions` and `next/navigation`, the `logoutAction` function. Then extend the layout. The key additions: a header with a brand mark, the username, and the logout form; a nav row; and the `<main>` wrapper. Because the layout is a Server Component and the `<form action={logoutAction}>` pattern works from a Server Component directly (the Server Action is serialized into a form action URL by Next's build process), the header does NOT need a client boundary — a single-server-component layout that embeds a Server Action in a form element is the cleanest possible shape.

Nav links use the Next `Link` component from `next/link` so client-side navigation works. Tailwind classes: a simple row with underline-on-hover. Accessibility: `<nav aria-label="primary">` wrapping the link row; each link is visible text, no icons.

**Slice 4 — The nav stubs and the home page (`app/(auth)/playground/page.tsx`, `experiments/page.tsx`, `runs/page.tsx`, and replacement `app/(auth)/page.tsx`)**. Each stub is ~15 lines: `import 'server-only'` (optional — Server Components are server-only by default, but the convention in CLAUDE.md "Database access patterns" is to include it), the default async function, `await verifySession()`, a Tailwind card with a heading and a one-sentence description mentioning which step will replace the stub. The three stubs are near-identical; consider factoring a `<StubPage title="Playground" step={21} />` helper, but keep it local — do not create a new shared module for three one-liners. Per CLAUDE.md "Directory layout" and the surrounding plan files, shared UI components are added in later steps; step 07 keeps the footprint minimal.

The home page at `app/(auth)/page.tsx` is also a Server Component, also calls `await verifySession()`, also renders a Tailwind card. The "Welcome, `{username}`" header and the one-sentence msksim description are the payload. Three links below point to the nav stubs.

**Slice 5 — The MCP verification run**. This is the first step in the pipeline that uses the chrome-devtools MCP tools. See §10 for the full enumerated script. The implementing claude must execute the script in order against `process.env.MSKSIM_BASE_URL` (set by `scripts/run-plan.ts` before invoking `claude -p`). The screenshot at `docs/screenshots/step-07-home.png` is saved by the `mcp__chrome-devtools__take_screenshot` call inside the script and must land in the same commit as the code changes.

Three gotchas the implementation must handle:

1. **`searchParams` is async in v16**. The login page must `await props.searchParams`. Forgetting the `await` produces a Promise that flows through the sanitizer and yields `null`, which then redirects everyone to `/` regardless of the original `next` target. The MCP script would not catch this (everyone still ends up at `/`), so the reviewer must grep `app/login/page.tsx` for `await` next to `searchParams` and confirm.
2. **`redirect()` throws `NEXT_REDIRECT`**. Calling it inside a `try/catch` silently swallows the redirect and the user stays on `/login` forever with no visible error. The login Server Action must call `redirect(next ?? '/')` outside any try block (per the Next 16 redirect.md doc, source 8). The test for this is visible in the MCP script: if the post-login navigation fails to land on `/`, the most likely cause is a misplaced try/catch.
3. **The `(auth)` route group does NOT appear in URLs**. A file at `app/(auth)/playground/page.tsx` serves `/playground`, not `/auth/playground` or `/(auth)/playground`. Conversely, a file at `app/login/page.tsx` serves `/login` and is **outside** the group, so the layout's `verifySession()` does not run — which is exactly what we want (the login page must be reachable unauthenticated). Any link to the login page uses the literal `/login` string.

## 8. Library choices

None. All dependencies are already installed from earlier steps:

- `next` (v16.2.2) ships `next/navigation`, `next/headers`, `next/link`, and the Server Action runtime.
- `react` (v19.2.4) ships `useActionState`.
- `zod` was installed in step 01; this step's form-validation schema is a trivial reuse.
- `drizzle-orm` and `better-sqlite3` from step 02; the client singleton at `lib/db/client.ts` is imported by the login action for the username lookup.
- `@node-rs/argon2` from step 03; `verifyPassword` from `lib/auth/password.ts` is called by the login action.
- `tailwindcss` v4 from step 00; the form and shell use Tailwind utility classes only, no custom CSS.

No `package.json` edits. If any of the above are missing because earlier steps landed differently, stop and fix the earlier step — do not paper over by installing dependencies under step 07.

## 9. Unit tests

The real verification of this step is the MCP script in §10; the vitest suite is deliberately small to avoid duplicating coverage.

All tests live in `lib/auth/actions.test.ts` and import the two helpers (`validateLoginInput`, `sanitizeNext`) exported from `app/login/actions.ts`. The test file runs under the default Vitest `node` environment (no DOM needed).

1. **validateLoginInput — happy path**. A `FormData` built with `username='alice'`, `password='hunter2'` parses successfully and returns `{ ok: true, data: { username: 'alice', password: 'hunter2' } }`.
2. **validateLoginInput — missing fields**. FormData with no `username` key fails parse (returns `{ ok: false }`); same for no `password`.
3. **validateLoginInput — empty strings**. FormData with `username=''` fails parse; same for `password=''`.
4. **sanitizeNext — relative path**. `sanitizeNext('/runs')` returns `'/runs'`; `sanitizeNext('/playground/foo')` returns `'/playground/foo'`.
5. **sanitizeNext — absolute URL rejected**. `sanitizeNext('http://evil.example/x')` returns `null`; same for `https://`.
6. **sanitizeNext — protocol-relative rejected**. `sanitizeNext('//evil.example/x')` returns `null`. This is the classic "open redirect" vector that `/^\/[^/]/` protects against.
7. **sanitizeNext — javascript: rejected**. `sanitizeNext('javascript:alert(1)')` returns `null`.
8. **sanitizeNext — CRLF rejected**. `sanitizeNext('/foo\r\nSet-Cookie: x=y')` returns `null` (header-injection vector).
9. **sanitizeNext — null/empty/undefined**. `sanitizeNext(undefined)` returns `null`; `sanitizeNext('')` returns `null`; `sanitizeNext(null as unknown as string)` returns `null`.

The login action itself, the layout, the logout action, and the form rendering are covered by the MCP script. Do not write unit tests for those — the happy path and the wrong-password path are both covered end-to-end in §10.

## 10. Acceptance criteria

### Static gates

- `npm run typecheck` (or `npx tsc --noEmit`) exits 0. `scripts/run-plan.ts` runs this automatically in `runPostStepGates` after the commit; the step fails if tsc fails.
- `npm run lint` (ESLint flat config) exits 0. Also run automatically by `scripts/run-plan.ts`.
- `npm test` exits 0, including the new `lib/auth/actions.test.ts` cases.
- `npm run build` (i.e. `next build`) succeeds. `scripts/run-plan.ts` runs `next build` before starting the dev server for UI steps (see `startDevServer` at line 625), so a build failure aborts the step before the MCP script ever runs.
- `app/login/page.tsx` **does not** import from `lib/db/`, `lib/auth/dal.ts`, `lib/auth/sessions.ts` (except via the action module), or `lib/auth/password.ts`. The login page is the one page that must render without a session; accidentally pulling in the DAL would make it redirect to itself. Grep for `verifySession` in `app/login/page.tsx` and confirm zero matches.
- `app/(auth)/layout.tsx` and each of `app/(auth)/page.tsx`, `app/(auth)/playground/page.tsx`, `app/(auth)/experiments/page.tsx`, `app/(auth)/runs/page.tsx` contain a top-of-function `await verifySession()` call. Grep and confirm five matches.

### Chrome-devtools MCP script (the main verification)

The implementing claude runs the following tool calls in order against `process.env.MSKSIM_BASE_URL`. The seed user credentials come from `process.env.MSKSIM_SEED_USER` and `process.env.MSKSIM_SEED_PASS`, both set by `scripts/run-plan.ts` (see lines 53-54 and lines 706-709 of that file). `scripts/run-plan.ts`'s `ensureSeedUser` (lines 662-685) calls `scripts/users.ts add` and `scripts/users.ts change-password` before the step starts so the seed user is guaranteed to exist in the DB by the time the MCP script runs. If either env var is unset, the script fails loudly.

**Phase A — Open a fresh browser page and clear residual state.**

1. `mcp__chrome-devtools__new_page` with `url: process.env.MSKSIM_BASE_URL`. Creates a fresh page so no prior tabs or state leak between steps in the pipeline. Expected: the page loads; because there is no session cookie, the Next.js proxy responds with a 307 redirect to `/login?next=%2F` and the browser follows it, landing on `/login`.
2. `mcp__chrome-devtools__evaluate_script` with the body `document.cookie.split(';').forEach(c => document.cookie = c.replace(/^ +/, '').replace(/=.*/, '=;expires=' + new Date().toUTCString() + ';path=/')); localStorage.clear(); sessionStorage.clear(); return 'cleared';`. Clears any lingering cookies, localStorage, and sessionStorage from prior pipeline runs. Expected return value: the string `'cleared'`.
3. `mcp__chrome-devtools__navigate_page` to `/` (the authenticated home). Expected: the proxy issues a 307 redirect to `/login?next=%2F`; the browser follows to `/login`. The `list_network_requests` call in phase F will verify the redirect chain was exactly `GET /` → 307 → `GET /login?next=%2F` → 200.
4. `mcp__chrome-devtools__evaluate_script` with `return location.pathname;`. Expected return: `'/login'`. Fails the step if anything else.

**Phase B — Log in with valid credentials.**

5. `mcp__chrome-devtools__take_snapshot` to capture the accessible DOM tree and get stable UIDs for the username field, password field, and submit button. The snapshot returns element UIDs; the next three calls use those UIDs.
6. `mcp__chrome-devtools__fill` on the username-field UID with value `process.env.MSKSIM_SEED_USER` (typically `'seed'`).
7. `mcp__chrome-devtools__fill` on the password-field UID with value `process.env.MSKSIM_SEED_PASS`.
8. `mcp__chrome-devtools__click` on the submit-button UID.
9. `mcp__chrome-devtools__wait_for` for the URL to become the `MSKSIM_BASE_URL + '/'` (the authenticated home). `wait_for` can match on a text pattern or element — poll the page text for "Welcome" which appears only on the authenticated home page. 10-second timeout. Expected: the redirect flow completes as `POST /login` → 303 → `GET /` → 200.

**Phase C — Assert the authenticated shell is present and correct.**

10. `mcp__chrome-devtools__evaluate_script` with `return { path: location.pathname, text: document.body.innerText };`. Assert `path === '/'`, `text.includes(process.env.MSKSIM_SEED_USER)` (the username in the header), `text.includes('Welcome')` (the home content), and `text.includes('Playground') && text.includes('Experiments') && text.includes('Runs')` (the nav row).
11. `mcp__chrome-devtools__take_screenshot` saving to the path the Next MCP server expects for `docs/screenshots/step-07-home.png`. The exact output-path mechanism depends on the MCP server's screenshot contract — if the tool returns a binary buffer, the implementing claude writes it to `docs/screenshots/step-07-home.png` via a Write tool call afterwards; if the tool accepts a path argument, pass `docs/screenshots/step-07-home.png` directly. Either way, the file lands on disk and gets staged in the commit.

**Phase D — Navigate to each nav stub and confirm no 500s.**

12. `mcp__chrome-devtools__navigate_page` to `/playground`. Wait for the heading text "Playground". Assert location is `/playground`.
13. `mcp__chrome-devtools__take_screenshot` saving to `docs/screenshots/step-07-playground.png` (optional; if disk budget is a concern, skip the three nav-stub screenshots and keep only the home-page screenshot — see §11 regarding the harness rules on screenshots).
14. `mcp__chrome-devtools__navigate_page` to `/experiments`. Wait for the heading text "Experiments". Assert location is `/experiments`.
15. `mcp__chrome-devtools__navigate_page` to `/runs`. Wait for the heading text "Runs". Assert location is `/runs`.
16. `mcp__chrome-devtools__navigate_page` back to `/`. Confirm the Welcome card is visible again.

**Phase E — Log out and verify the auth gate re-engages.**

17. `mcp__chrome-devtools__take_snapshot` to re-fetch UIDs (the DOM changed since step 5). Locate the logout submit button UID.
18. `mcp__chrome-devtools__click` the logout button. Logout is a `<form action={logoutAction}>` which POSTs to the Server Action, which clears the cookie and `redirect('/login')`s (303).
19. `mcp__chrome-devtools__wait_for` for URL text indicating the login page (e.g. the "msksim — sign in" heading).
20. `mcp__chrome-devtools__evaluate_script` with `return location.pathname;`. Expected: `'/login'`.
21. `mcp__chrome-devtools__navigate_page` to `/`. Expected: the proxy redirects back to `/login?next=%2F` because there is no cookie. `evaluate_script` `return location.pathname;` → `'/login'`.

**Phase F — Wrong-password path.**

22. Starting from the login page (already there after phase E), `mcp__chrome-devtools__take_snapshot` to get fresh UIDs.
23. `mcp__chrome-devtools__fill` username = `process.env.MSKSIM_SEED_USER`.
24. `mcp__chrome-devtools__fill` password = `'definitely-wrong-password-xyzzy'`.
25. `mcp__chrome-devtools__click` the submit button.
26. `mcp__chrome-devtools__wait_for` for the text `'invalid credentials'` to appear on the page. This is the generic error string rendered by the `<p role="alert" aria-live="polite">` slot.
27. `mcp__chrome-devtools__evaluate_script` with `return { path: location.pathname, hasSessionCookie: document.cookie.includes('msksim_session') };`. Assert `path === '/login'` (no redirect happened) and `hasSessionCookie === false` (no cookie was set on the failed attempt).

**Phase G — Console and network triage.**

28. `mcp__chrome-devtools__list_console_messages`. Filter to `level === 'error'` (and optionally `warning`). Expected: zero errors, modulo React 19 strict-mode dev warnings (per CLAUDE.md "UI verification harness"). If any thrown error, hydration mismatch, or unhandled promise rejection appears, fail the step.
29. `mcp__chrome-devtools__list_network_requests`. Iterate the entries. Expected: every status is in `[200, 204, 301, 302, 303, 307, 308]`. Any 4xx or 5xx fails the step. (The 307 from the proxy and the 303 from the Server Action redirect are both expected and normal.)

**Phase H — Finalize.**

30. If all assertions passed, commit the code and the screenshot together with the canonical message from §12.

### Post-commit gates (automatic via run-plan.ts)

After the commit, `scripts/run-plan.ts` runs:

- `npx tsc --noEmit` — must pass.
- `npx eslint .` — must pass.
- CLAUDE.md growth check — the diff must not add more than 100 lines (this step adds ≤ 30 per §11).
- Commit marker check — the latest commit subject must match `/^step\s+07\s*[:.\-]/i`. If the implementing claude forgot to use the canonical subject, run-plan.ts normalizes it via `git commit --amend`.

## 11. CLAUDE.md updates

The "UI verification harness" section (60-line cap) was populated during the Phase A meta-planning run and is already present in CLAUDE.md. **Do not rewrite it.** Instead, this step's job is to **verify** the existing content against what actually happens when the MCP script runs for real, and append short clarifications only if discrepancies surface.

Append to CLAUDE.md "UI verification harness" (≤ 20 lines total, preserving the section cap):

- The exact sequence of MCP tool calls for the "log in → authenticated shell → log out → wrong-password retry" round-trip is preserved in `docs/plan/07-login-and-app-shell.md` §10. Later UI steps reference that script as the canonical login harness; copy and adapt it rather than reinventing the login flow from scratch.
- The proxy redirect is **307** (per-request temporary, preserves the HTTP method). The Server Action login-success redirect is **303** (per the Next 16 `next/navigation` `redirect()` doc, which explicitly returns 303 from a Server Action so the browser GETs the target). Both are normal and both must be tolerated by the `list_network_requests` triage.
- `scripts/run-plan.ts`'s `ensureSeedUser` calls `scripts/users.ts` (not a direct drizzle write) to create/repair the seed user before each UI step. If the seed user creation fails silently, the MCP script will be stuck on the login page — check the run-plan log first before debugging the UI.
- One home-page screenshot at `docs/screenshots/step-NN-home.png` is mandatory per UI step. Additional screenshots for sub-views (nav stubs, modal dialogs, etc.) are optional and should be skipped unless the step is specifically exercising a visual element that isn't visible on the home view.
- Clearing state between MCP runs: `localStorage.clear()` and `sessionStorage.clear()` are cheap. The cookie clear via `document.cookie.split(';').forEach(...)` does not clear `HttpOnly` cookies from the DOM API — those survive. The reliable path is to open a fresh page (`new_page`) at the start of each step, which resets the browser context.

Append to CLAUDE.md "Authentication patterns" (≤ 10 lines):

- The login page lives at `app/login/page.tsx`, **outside** the `(auth)` route group, and is therefore the only page in the app that does **not** call `verifySession()` from its Server Component body. It is reachable unauthenticated by design. Conversely, every file inside `app/(auth)/` — including the layout, the home page, the nav stubs — calls `verifySession()` at the top of its function body, per the "every Server Component calls the DAL directly" rule.
- Login and logout are both **Server Actions**. Logout triggers from a `<form action={logoutAction}>` in the authenticated layout's header; it can live inside a Server Component because Server Actions in forms do not require a client boundary.
- The login Server Action returns a generic `{ message: 'invalid credentials' }` for every failure path (missing fields, unknown username, wrong password) so the response does not leak which field was wrong. This is a timing-attack partial mitigation; a full fix (constant-time user-not-found path) is deferred with a TODO in the code.
- The `next` query param on the login page is passed through `sanitizeNext` (regex: starts with `/` followed by a non-slash character, rejects absolute URLs, protocol-relative URLs, `javascript:`, `data:`, and strings containing `\r` or `\n`) before being handed to `redirect()`. This blocks the classic open-redirect vector.

Total CLAUDE.md growth: ≤ 30 lines, well within the 100-lines-per-step pipeline guard and the per-section caps.

## 12. Commit message

Exactly:

```
step 07: login and app shell
```

No conventional-commit prefix (`feat:`, `chore:`, etc.), no emoji, no trailing period. The `step NN:` marker is load-bearing for `scripts/run-plan.ts` progress detection (CLAUDE.md "Commit-message convention" — the orchestrator greps `git log` for this literal pattern). One commit for the whole step, including the generated `docs/screenshots/step-07-home.png` binary. If the implementing claude's tool produces multiple intermediate commits, `scripts/run-plan.ts` will squash them via `git reset --soft` before advancing; if the subject line differs slightly (e.g. `Step 7:` or `step 7 -`), `scripts/run-plan.ts` normalizes it via `git commit --amend`.

## 13. Rollback notes

If the step lands in a broken state and needs to be undone:

1. `git log --oneline | head -20` to find the commit SHA immediately prior (the step 06 commit). It will have the subject `step 06: proxy route groups and dal` (or a normalized variant).
2. `git reset --hard <step-06-sha>`. This single operation reverts everything in step 07: the login page and its client form, `app/login/actions.ts`, `app/(auth)/actions.ts`, the three nav stubs, the layout extensions, the home page body changes, the `lib/auth/actions.test.ts` file, and the `docs/screenshots/step-07-home.png` binary.
3. Verify `docs/screenshots/step-07-home.png` is gone after the reset — because it was introduced in this step and is not referenced by any step 06 file, the hard reset will drop it. If a stray untracked copy remains (e.g. because the implementing claude saved the screenshot before the commit and the commit was never made), `rm docs/screenshots/step-07-home.png` manually to leave the directory in a clean state.
4. Re-run `npm test` against the rolled-back tree to confirm step 06's tests still pass and that nothing in step 07 left behind a stray import or test file.
5. Re-run `npx tsx scripts/run-plan.ts --only 07` to redo the step from a clean base. Because `scripts/run-plan.ts` checks the commit log for the step marker and the marker is now gone, the orchestrator will pick step 07 up as pending.

Special case: if the rollback is triggered **after** `scripts/run-plan.ts` has already advanced past step 07 (e.g. step 08 landed before the bug in step 07 was noticed), the rollback must also revert step 08 — `git reset --hard` back to the step 06 commit drops **all** intermediate commits. This is the nuclear option; prefer a forward-fix commit (`step 07-fix: ...`) if the bug is small and step 08 is expensive to re-run.
