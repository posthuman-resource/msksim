# msksim Design System

> **Living document.** Read this before adding or changing any UI in this repo. Future Claude/agent sessions are expected to consult this file the same way they consult `CLAUDE.md`. Tokens defined here are mirrored to `app/globals.css` as Tailwind 4 `@theme` variables.

---

## 1. Charter

`msksim` is a research instrument that will accompany a PhD thesis on color-term naming-game communication under linguistic pressure modulated by geography. Its primary readers are the author, their advisor and committee, and academic collaborators who may run their own sweeps and read the resulting reports. The interface must communicate _seriousness, reproducibility, and rigor_ before anything else. Optimize for: **information density** (more chart, more table, less chrome), **legibility** at long working sessions, and **stable visual identity** across pages so that screenshots in a thesis appendix read as one tool.

This is not a SaaS dashboard, a marketing site, or a prototype. It is a published artifact. Treat every page as if it might appear in the thesis as a figure.

---

## 2. Aesthetic anchor

**Restrained academic.** The tie-breaker for every design decision.

- Tone: serious, dense, data-first. Reads as "an instrument", not "an app".
- References: Stripe Docs (typography & restraint), Observable notebooks (data density + serif headings), Edward Tufte (chart minimalism), academic journals (chrome stays out of the way of content).
- What it is **not**: bouncy SaaS, gradient backgrounds, animated illustrations, soft pastel cards floating on shadows, emoji in UI copy, "fun" microcopy.

When uncertain, choose the option that would look more credible in a thesis figure caption.

---

## 3. Tokens

Defined in `app/globals.css` under `@theme inline`. Tailwind 4 auto-generates utilities (e.g. `bg-surface`, `text-fg`, `border-border`, `text-accent`).

| Token                   | Value     | Tailwind hex equivalent | Usage                                           |
| ----------------------- | --------- | ----------------------- | ----------------------------------------------- |
| `--color-bg`            | `#fafaf9` | `stone-50`              | Page background under main content              |
| `--color-surface`       | `#ffffff` | `white`                 | Cards, tables, header, nav                      |
| `--color-surface-muted` | `#f4f4f5` | `zinc-100`              | Hover row, alternate panel, disabled control bg |
| `--color-border`        | `#e4e4e7` | `zinc-200`              | Default 1px borders                             |
| `--color-border-strong` | `#d4d4d8` | `zinc-300`              | Form field borders, button outlines             |
| `--color-fg`            | `#18181b` | `zinc-900`              | Primary text                                    |
| `--color-fg-muted`      | `#52525b` | `zinc-600`              | Secondary text, table headers                   |
| `--color-fg-subtle`     | `#a1a1aa` | `zinc-400`              | Tertiary text, disabled, placeholder            |
| `--color-accent`        | `#4338ca` | `indigo-700`            | Primary actions, active nav, links, focus ring  |
| `--color-accent-hover`  | `#3730a3` | `indigo-800`            | Primary action hover                            |
| `--color-accent-fg`     | `#ffffff` | `white`                 | Text on accent backgrounds                      |
| `--color-danger`        | `#b91c1c` | `red-700`               | Destructive actions, error text                 |
| `--color-danger-bg`     | `#fef2f2` | `red-50`                | Error banner background                         |
| `--color-success`       | `#15803d` | `green-700`             | Success badge, converged classification         |
| `--color-warn`          | `#b45309` | `amber-700`             | Warning text, partial convergence               |

**Hard rules**

- Hex literals other than these do not appear in `app/`. The chart palette in §8 is the only exception (Recharts series colors).
- One accent color. No "secondary brand color." `purple-600` is removed (was used for `New sweep` button — restyled as accent + ghost in §6).
- Do **not** add a `brand-*` palette without amending this doc.

---

## 4. Type scale

Two families. Geist Sans is body and UI. **Source Serif 4** carries h1/h2 (and h3 in long-form prose). Mono is `ui-monospace`/Geist Mono for numerics, IDs, and code.

The serif is the visible signature of the "academic" anchor. It is what differentiates a research tool from a SaaS dashboard.

| Style     | Family | Size / leading                    | Weight | Tracking         | Use                             |
| --------- | ------ | --------------------------------- | ------ | ---------------- | ------------------------------- |
| `display` | serif  | `text-3xl/tight` (1.875rem / 1.2) | 600    | -0.01em          | Page hero (login, home only)    |
| `h1`      | serif  | `text-2xl/tight` (1.5rem / 1.2)   | 600    | -0.005em         | Page title                      |
| `h2`      | serif  | `text-xl/snug` (1.25rem / 1.3)    | 600    | normal           | Section title                   |
| `h3`      | sans   | `text-base` (1rem)                | 600    | normal           | Card title, form section        |
| `body`    | sans   | `text-sm` (0.875rem / 1.5)        | 400    | normal           | Default text                    |
| `body-lg` | sans   | `text-base` (1rem / 1.6)          | 400    | normal           | Guide / prose pages only        |
| `small`   | sans   | `text-xs` (0.75rem / 1.4)         | 500    | 0.01em uppercase | Table headers, labels, eyebrow  |
| `mono`    | mono   | `text-xs`–`text-sm`               | 400    | normal           | Hashes, seeds, tick counts, IDs |

**Hard rules**

- `<h1>` always serif. Apply with `font-serif`. Pages that don't have a single h1 are wrong.
- Mono is reserved for content that is _literally_ an identifier or numeric readout. Do not use mono for stylistic flair.
- Body never goes below `text-xs`. If you reach for `text-[10px]`, you are doing something else wrong.

---

## 5. Spacing scale

Pick from this list. Other Tailwind spacing values do not appear in `app/`.

| Use                      | Class                                           | px           |
| ------------------------ | ----------------------------------------------- | ------------ |
| Inline icon-text gap     | `gap-1.5`                                       | 6            |
| Form-row inner gap       | `gap-2`                                         | 8            |
| Form section gap         | `gap-4`                                         | 16           |
| Card padding             | `p-4` (compact) / `p-6` (spacious)              | 16 / 24      |
| Page padding (auth main) | `px-6 py-8` desktop / `px-4 py-6` mobile        | 24/32, 16/24 |
| Header→content gap       | `mt-6` (24px)                                   | 24           |
| Section→section gap      | `mt-8` (32px)                                   | 32           |
| Table cell padding       | `px-3 py-2` (compact) / `px-4 py-2.5` (default) | —            |

**Hard rules**

- A page header (h1 + actions) **must** be followed by `mt-6` of vertical space before the next block. The `/experiments` regression that prompted this whole pass was a missing version of this rule.
- Container width:
  - List + detail + form pages: `max-w-6xl mx-auto`
  - Long-form prose (`/guide`): `max-w-prose` (~65ch) for the text column
  - Dashboard (`/playground`): full-bleed (`max-w-none`)
  - Login: `max-w-sm`

---

## 6. Component patterns

Each pattern below has a canonical Tailwind class string. New code should match it. Existing code is being migrated to it in this same pass.

### Page header

```
<header class="flex items-end justify-between border-b border-border pb-4">
  <div>
    <h1 class="font-serif text-2xl font-semibold text-fg">{Title}</h1>
    {subtitle && <p class="mt-1 text-sm text-fg-muted">{subtitle}</p>}
  </div>
  <div class="flex items-center gap-2">{actions}</div>
</header>
<!-- followed by mt-6 -->
```

### Card / panel

```
<section class="rounded-md border border-border bg-surface">
  {/* no shadow; chrome is the border */}
</section>
```

Cards never have soft shadows. Borders carry the elevation. `rounded-md` (6px) only — no `rounded-lg`/`xl`.

### Table

```
<table class="w-full text-sm">
  <thead class="border-b border-border">
    <tr class="text-left">
      <th class="px-3 py-2 text-xs font-medium uppercase tracking-wide text-fg-muted">…</th>
    </tr>
  </thead>
  <tbody class="divide-y divide-border">
    <tr class="hover:bg-surface-muted">
      <td class="px-3 py-2 text-fg">…</td>
      <td class="px-3 py-2 font-mono text-xs text-fg-muted">{hash8}</td>
    </tr>
  </tbody>
</table>
```

- Compact rows. No zebra striping; row dividers carry separation.
- Numerics, hashes, seeds, durations: `font-mono`.
- Last column (actions) is right-aligned.

### Form row

```
<div class="grid grid-cols-[200px_1fr] items-start gap-4">
  <label class="pt-1.5 text-sm font-medium text-fg">
    {Label} <HelpTip helpKey="…" />
  </label>
  <div>
    {control}
    {error && <p class="mt-1 text-xs text-danger">{error}</p>}
    {hint && <p class="mt-1 text-xs text-fg-subtle">{hint}</p>}
  </div>
</div>
```

Stacks to one column under `sm:`.

### Button

| Variant     | Class string                                                                                                                                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary     | `inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent` |
| Secondary   | `inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3.5 py-1.5 text-sm font-medium text-fg hover:bg-surface-muted`                                                                                    |
| Ghost       | `inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-fg-muted hover:text-fg hover:bg-surface-muted`                                                                                                                       |
| Destructive | `inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium text-danger hover:bg-danger-bg`                                                                                                                           |

One primary action per page header. Everything else is secondary or ghost. **Never** stack two primary buttons next to each other (the prior `/experiments` page had three side-by-side blue/purple/blue — this is now one accent + two secondary).

### Tooltip / HelpTip

`(?)` next to a form label or table header.

- **Hover-first**: opens on `mouseenter` and `focus`; closes on `mouseleave` and `blur`.
- **Click-to-pin**: clicking pins it open; outside-click closes.
- **Touch**: tap toggles (no hover state on touch devices).
- ARIA: button has `aria-label="Help"` + `aria-describedby` pointing to the popover when open.
- Popover width: `w-72` (288px). Position: `left-6 top-0` relative to the button.

### Modal

```
<div class="fixed inset-0 z-40 flex items-center justify-center bg-fg/40 backdrop-blur-sm">
  <div class="w-full max-w-md rounded-md border border-border bg-surface p-6 shadow-lg">
    {/* shadow-lg is allowed here — modals are the only floating surface */}
  </div>
</div>
```

### Badge / pill

```
<span class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium">
```

Classification map:

| Classification | Border             | Text            |
| -------------- | ------------------ | --------------- |
| Converged      | `border-green-200` | `text-success`  |
| Partial        | `border-amber-200` | `text-warn`     |
| Cycling        | `border-zinc-200`  | `text-fg-muted` |
| Failed         | `border-red-200`   | `text-danger`   |

### Empty state

```
<div class="rounded-md border border-dashed border-border bg-surface p-12 text-center">
  <p class="text-sm font-medium text-fg-muted">{title}</p>
  <p class="mt-1 text-sm text-fg-subtle">{copy}</p>
  <div class="mt-4">{single CTA, primary}</div>
</div>
```

---

## 7. Page archetypes

| Archetype                                                                    | Container                                             | Header                                                                          | Body                                                                                             |
| ---------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **List** (`/experiments`, `/runs`)                                           | `max-w-6xl`                                           | Page header (title + subtitle + actions)                                        | Filter row, then table card. `mt-6` between header and table.                                    |
| **Detail** (`/runs/[id]`)                                                    | `max-w-6xl`                                           | Page header (title = run name; subtitle = hash + seed mono; back link as ghost) | Summary card grid (3 cols desk / 1 mobile) → charts grid (2 cols)                                |
| **Form** (`/experiments/new`, `/experiments/[id]`, `/experiments/sweep/new`) | `max-w-6xl`                                           | Page header                                                                     | Vertical sections separated by `mt-8` and serif h2; sticky bottom action bar with primary submit |
| **Dashboard** (`/playground`)                                                | full-bleed                                            | Slim header (no border-b on the page itself; the auth nav already provides it)  | 12-col grid: lattice (8) + controls (4) on desktop; chart panel below; network drawer            |
| **Long-form** (`/guide`)                                                     | `max-w-prose` for body, sticky TOC at `lg:` left rail | Page header + serif h2 sections                                                 | Generous leading (`leading-7`), small caps eyebrow for section labels                            |
| **Auth single** (`/login`)                                                   | `max-w-sm centered`                                   | Display heading                                                                 | Single card form                                                                                 |
| **Home** (`/`)                                                               | `max-w-6xl`                                           | Display heading + 1-line subtitle                                               | 3-card shortcut grid (Playground / Experiments / Runs / Guide)                                   |

---

## 8. Charts (Recharts)

All Recharts components in `app/(auth)/playground/*` and `app/(auth)/runs/[id]/*` share this palette and styling. Defined as constants in `lib/charts/theme.ts` (introduced in this design pass) so future edits don't drift.

### Series palette (categorical)

In order of preference for adding new series:

```
['#4338ca', // accent (indigo-700)
 '#15803d', // green-700
 '#b45309', // amber-700
 '#0e7490', // cyan-700
 '#7c3aed', // violet-600
 '#be123c', // rose-700
 '#1d4ed8', // blue-700
 '#374151'] // gray-700
```

Single-series metrics use `--color-accent`. Convergence-state metrics use `success` / `warn` / `danger` mapped to converged / partial / failed.

### Axis & grid

- Axes: `stroke="#a1a1aa"` (`fg-subtle`), `tick={{ fill: '#52525b', fontSize: 11 }}`.
- Gridlines: `strokeDasharray="2 4"`, `stroke="#e4e4e7"` (`border`). Horizontal only.
- Tooltip: `border border-border bg-surface text-fg shadow-md`, mono numerics, label uppercase tracking.
- Legend: bottom, `text-xs text-fg-muted`, no boxed background.

### Hard rules

- No drop shadows on chart elements.
- No 3D, no gradients on bars/areas.
- Y-axis label: `text-xs`, rotated `-90deg`, `fill: #52525b`.
- `<ResponsiveContainer>` always; no fixed pixel widths.

---

## 9. Decision principles (priority order)

When two patterns conflict, the higher rule wins.

1. **Density > decoration.** A denser, plainer layout always beats a sparser, more decorated one.
2. **Serif > sans for hierarchy.** A serif h1 instantly signals "research instrument" — never replace it with sans for stylistic preference.
3. **One accent > many.** If a page has more than one accent color besides indigo, that page is wrong.
4. **Show data > show chrome.** Borders, dividers, padding shrink before charts and tables shrink.
5. **Hover > click for non-destructive disclosure.** HelpTips, popovers, secondary info: hover. Reserve clicks for actions and pinning.
6. **Keyboard reachable always.** Every interactive element gets a visible `focus-visible:outline-accent` ring. No `outline-none` without a replacement.
7. **Mono for data, never for flair.** If a glyph is not literally an identifier or numeric readout, it is not mono.
8. **Borders carry elevation.** Reserve shadows for modals and the toast layer.
9. **Stability > novelty.** Once a pattern is in this doc, future PRs adopt it; they don't reinvent it.
10. **If in doubt, ask: does this look like it belongs in a thesis figure?** If no, change it.

---

## 10. Workflow recipe (artistic-vision prompt template)

Used by the design-pass loop documented in `docs/plan/` and re-runnable any time. The prompt sent to artistic-vision when critiquing a page screenshot:

```
You are reviewing a screenshot of `<route>` from msksim, a research instrument
that accompanies a PhD thesis on agent-based naming-game simulation.

The aesthetic anchor is "Restrained academic": muted, dense, data-first. It
should read as a research instrument, not a SaaS dashboard. References:
Stripe Docs, Observable notebooks, Tufte. See the design-system tokens and
patterns below; treat them as ground truth.

<paste full text of docs/design-system.md>

Return a structured verdict in this exact JSON shape:
{
  "route": "<route>",
  "viewport": "desktop|mobile",
  "summary": "<one paragraph>",
  "consistent_with_anchor": true|false,
  "issues": [
    {
      "severity": "low|med|high",
      "area": "header|table|form|chart|nav|spacing|typography|color|focus|other",
      "evidence": "<what you see in the screenshot>",
      "suggested_fix": "<class-level or pattern-level fix, citing the
                       design-system section that applies>"
    }
  ],
  "wins": ["<things that already match the anchor>"]
}

Be terse. No marketing copy. If you do not see a problem, do not invent one.
```

The verdicts file `docs/design/verdicts/<timestamp>.md` collects one such JSON block per (route, viewport) pair, plus a top-level summary.

---

## 11. Changelog

| Date       | Change                                                                                                                                                            | Commit        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 2026-04-25 | Initial design system. Tokens, patterns, archetypes, chart theme, hover-first HelpTip, fixed `/experiments` header→table gap, indigo accent replaces blue+purple. | (this commit) |
