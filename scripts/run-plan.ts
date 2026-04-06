#!/usr/bin/env tsx
/**
 * run-plan.ts — msksim build pipeline orchestrator
 *
 * Reads docs/plan/NN-*.md files, checks git log for completed `step NN:` commits,
 * and invokes `claude -p --dangerously-skip-permissions --effort high` sequentially
 * for each unfinished step. Interruptable (Ctrl-C) and resumable.
 *
 * Usage:
 *   npx tsx scripts/run-plan.ts              # resume from next pending step
 *   npx tsx scripts/run-plan.ts --list       # show status of all steps
 *   npx tsx scripts/run-plan.ts --only 05    # run exactly one step
 *   npx tsx scripts/run-plan.ts --from 10    # start at step 10 (requires --force if later steps exist)
 *   npx tsx scripts/run-plan.ts --dry-run    # print prompts without executing
 *   npx tsx scripts/run-plan.ts --no-server  # skip dev-server harness for UI steps
 *   npx tsx scripts/run-plan.ts --force      # override safety checks
 *   npx tsx scripts/run-plan.ts --resume     # accept and stash dirty state from a killed prior step
 *
 * See CLAUDE.md for conventions (commit markers, UI verification harness).
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import * as http from 'node:http';

function findRepoRoot(): string {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error('run-plan.ts must be invoked inside a git repository');
    process.exit(1);
  }
  return r.stdout.trim();
}

const REPO_ROOT = findRepoRoot();
const PLAN_DIR = path.join(REPO_ROOT, 'docs', 'plan');
const LOG_DIR = path.join(PLAN_DIR, 'logs');

// Tolerant step-marker regex. Matches "step NN:", "Step N:", "STEP 07 -", etc.
const STEP_MARKER_RE = /^step\s+0?(\d+)\s*[:.\-]/i;

const DEFAULT_TIMEOUT_MIN: Record<string, number> = {
  foundation: 20,
  'sim-core': 20,
  worker: 30,
  ui: 40,
  workflow: 40,
  polish: 40,
};

const SEED_USER = process.env.MSKSIM_SEED_USER ?? 'seed';
const SEED_PASS = process.env.MSKSIM_SEED_PASS ?? 'seed-password-do-not-use-in-prod';

// ---------- types ----------

interface StepFrontmatter {
  step: string; // two-digit "NN"
  title: string;
  kind: 'foundation' | 'sim-core' | 'worker' | 'ui' | 'workflow' | 'polish';
  ui: boolean;
  timeout_minutes?: number;
  prerequisites?: string[];
}

interface Step {
  number: string; // "00".."32"
  filename: string;
  title: string;
  kind: string;
  ui: boolean;
  timeoutMs: number;
  path: string;
}

interface CliArgs {
  list: boolean;
  only?: string;
  from?: string;
  dryRun: boolean;
  noServer: boolean;
  force: boolean;
  resume: boolean;
}

// ---------- arg parsing ----------

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    list: false,
    dryRun: false,
    noServer: false,
    force: false,
    resume: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--list':
        args.list = true;
        break;
      case '--only':
        args.only = padStep(argv[++i]);
        break;
      case '--from':
        args.from = padStep(argv[++i]);
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--no-server':
        args.noServer = true;
        break;
      case '--force':
        args.force = true;
        break;
      case '--resume':
        args.resume = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        if (a.startsWith('--')) {
          console.error(`unknown flag: ${a}`);
          process.exit(2);
        }
    }
  }
  return args;
}

function padStep(s: string | undefined): string {
  if (!s) {
    console.error('flag expects a step number argument');
    process.exit(2);
  }
  return s.padStart(2, '0');
}

function printHelp(): void {
  process.stdout.write(
    'Usage: npx tsx scripts/run-plan.ts [flags]\n' +
      '  --list        show status of all steps\n' +
      '  --only NN     run exactly one step\n' +
      '  --from NN     start at step NN\n' +
      '  --dry-run     print prompts without executing\n' +
      '  --no-server   skip dev-server harness for UI steps\n' +
      '  --force       override safety checks (dirty tree, out-of-order runs)\n' +
      '  --resume      stash dirty state from a killed prior step and continue\n' +
      '  --help        show this message\n',
  );
}

// ---------- step discovery ----------

function loadSteps(): Step[] {
  if (!fs.existsSync(PLAN_DIR)) {
    console.error(`plan directory missing: ${PLAN_DIR}`);
    process.exit(1);
  }
  const files = fs
    .readdirSync(PLAN_DIR)
    .filter((f) => /^\d{2}-.+\.md$/.test(f))
    .sort();
  return files.map((filename) => {
    const p = path.join(PLAN_DIR, filename);
    const content = fs.readFileSync(p, 'utf8');
    const fm = parseFrontmatter(content, filename);
    const kind = fm.kind ?? 'foundation';
    const timeoutMin = fm.timeout_minutes ?? DEFAULT_TIMEOUT_MIN[kind] ?? 20;
    return {
      number: fm.step,
      filename,
      title: fm.title,
      kind,
      ui: Boolean(fm.ui),
      timeoutMs: timeoutMin * 60 * 1000,
      path: p,
    };
  });
}

function parseFrontmatter(content: string, filename: string): StepFrontmatter {
  const numMatch = filename.match(/^(\d{2})-(.+)\.md$/);
  const fallbackNum = numMatch ? numMatch[1] : '00';
  const fallbackTitle = numMatch ? numMatch[2].replace(/-/g, ' ') : filename;

  const fm: StepFrontmatter = {
    step: fallbackNum,
    title: fallbackTitle,
    kind: 'foundation',
    ui: false,
  };

  if (!content.startsWith('---')) return fm;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return fm;
  const block = content.slice(3, end);

  for (const line of block.split('\n')) {
    const m = line.match(/^(\w+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    switch (key) {
      case 'step':
        fm.step = val.padStart(2, '0');
        break;
      case 'title':
        fm.title = val;
        break;
      case 'kind':
        fm.kind = val as StepFrontmatter['kind'];
        break;
      case 'ui':
        fm.ui = val === 'true';
        break;
      case 'timeout_minutes':
        fm.timeout_minutes = Number(val);
        break;
    }
  }
  return fm;
}

// ---------- git ----------

function git(...args: string[]): string {
  const r = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  }
  return r.stdout;
}

function getCompletedStepNumbers(): Map<string, string> {
  // returns map of "NN" -> commit SHA
  const out = git('log', '--format=%H%x00%s');
  const map = new Map<string, string>();
  for (const line of out.split('\n')) {
    if (!line) continue;
    const [sha, subject] = line.split('\0');
    const m = subject.match(STEP_MARKER_RE);
    if (!m) continue;
    const n = m[1].padStart(2, '0');
    // `git log` is newest-first; keep the most recent if duplicates
    if (!map.has(n)) map.set(n, sha);
  }
  return map;
}

function getLatestStepNumber(): string | null {
  const out = git('log', '--format=%s');
  for (const subject of out.split('\n')) {
    const m = subject.match(STEP_MARKER_RE);
    if (m) return m[1].padStart(2, '0');
  }
  return null;
}

function workingTreeIsClean(): boolean {
  return git('status', '--porcelain').trim().length === 0;
}

function listDirtyFiles(): string[] {
  return git('status', '--porcelain')
    .split('\n')
    .filter((l) => l.trim().length > 0);
}

function currentHeadSha(): string {
  return git('rev-parse', 'HEAD').trim();
}

function countCommitsSince(sha: string): number {
  const out = git('rev-list', '--count', `${sha}..HEAD`).trim();
  return Number(out);
}

// ---------- status and listing ----------

function listStepStatus(steps: Step[]): void {
  const completed = getCompletedStepNumbers();
  process.stdout.write('msksim build pipeline status\n');
  process.stdout.write('----------------------------\n');
  for (const s of steps) {
    const done = completed.get(s.number);
    const marker = done ? `[done ${done.slice(0, 7)}]` : '[pending    ]';
    const ui = s.ui ? ' (UI)' : '';
    process.stdout.write(`  ${marker} step ${s.number}: ${s.title}${ui}\n`);
  }
  const pending = steps.filter((s) => !completed.has(s.number));
  process.stdout.write(
    `\n  ${completed.size}/${steps.length} completed, ${pending.length} pending\n`,
  );
}

// ---------- dirty tree / resume handling ----------

function handleDirtyTree(args: CliArgs): void {
  if (workingTreeIsClean()) return;
  const dirty = listDirtyFiles();

  if (args.resume) {
    const stash = `msksim-plan-abort/${new Date().toISOString().replace(/[:.]/g, '-')}`;
    process.stdout.write(`stashing dirty state to refs/${stash} (from --resume)\n`);
    try {
      git('stash', 'push', '-u', '-m', stash);
      // Move the stash to a named ref for forensics, then drop it from the stash list
      const stashSha = git('rev-parse', 'stash@{0}').trim();
      git('update-ref', `refs/${stash}`, stashSha);
      git('stash', 'drop');
      process.stdout.write(`  stashed to refs/${stash}\n`);
    } catch (e) {
      console.error(`failed to stash dirty state: ${(e as Error).message}`);
      process.exit(1);
    }
    return;
  }

  process.stderr.write('refusing to run: working tree is not clean\n');
  process.stderr.write('\n  modified files:\n');
  for (const f of dirty) process.stderr.write(`    ${f}\n`);
  process.stderr.write(
    '\n  options:\n' +
      '    git stash push -u    # save changes to stash\n' +
      '    git checkout -- .    # discard changes (destructive)\n' +
      '    run-plan --resume    # stash to refs/msksim-plan-abort/<timestamp> and continue\n',
  );
  process.exit(1);
}

// ---------- step selection ----------

function selectStepsToRun(steps: Step[], args: CliArgs): Step[] {
  const completed = getCompletedStepNumbers();

  if (args.only) {
    const s = steps.find((x) => x.number === args.only);
    if (!s) {
      console.error(`no step ${args.only} found in ${PLAN_DIR}`);
      process.exit(1);
    }
    if (completed.has(s.number) && !args.force) {
      console.error(
        `step ${s.number} is already committed (${completed.get(s.number)?.slice(0, 7)}). ` +
          `use --force to re-run.`,
      );
      process.exit(1);
    }
    if (!args.force) {
      // require prior steps to be done
      const missing = steps
        .filter((x) => x.number < s.number && !completed.has(x.number))
        .map((x) => x.number);
      if (missing.length > 0) {
        console.error(
          `cannot run step ${s.number}: prior steps not committed: ${missing.join(', ')}. ` +
            `use --force to override.`,
        );
        process.exit(1);
      }
    }
    return [s];
  }

  const start =
    args.from ??
    (() => {
      // Find first pending step
      const firstPending = steps.find((s) => !completed.has(s.number));
      return firstPending?.number ?? null;
    })();

  if (!start) {
    process.stdout.write('all steps completed.\n');
    return [];
  }

  if (args.from && !args.force) {
    const laterCompleted = steps.filter((s) => s.number >= args.from! && completed.has(s.number));
    if (laterCompleted.length > 0) {
      console.error(
        `--from ${args.from} conflicts with already-committed later steps: ` +
          `${laterCompleted.map((s) => s.number).join(', ')}. use --force to override.`,
      );
      process.exit(1);
    }
  }

  return steps.filter((s) => s.number >= start && !completed.has(s.number));
}

// ---------- prompt construction ----------

function buildPrompt(step: Step, baseUrl: string | null): string {
  const lines: string[] = [];
  lines.push(`You are executing step ${step.number} of the msksim build plan.`);
  lines.push('');
  lines.push('Required reading (in this order):');
  lines.push('  1. CLAUDE.md — project conventions, Next.js 16 deltas, section schema');
  lines.push(`  2. docs/plan/${step.filename} — your detailed plan for this step`);
  lines.push('  3. docs/spec.md — specification sections referenced by your plan file');
  lines.push('');
  lines.push(
    'Follow the plan. All work for this step must land in exactly ONE commit with the subject line:',
  );
  lines.push(`  step ${step.number}: ${step.title}`);
  lines.push('');
  lines.push(
    'If you learn new conventions or discover anything that future agents should know, ' +
      'append to the appropriate section of CLAUDE.md (respect the section line caps ' +
      'and the ≤ 30 lines per section per commit rule). Do NOT edit sections outside ' +
      "your step's scope.",
  );
  lines.push('');
  if (step.ui && baseUrl) {
    lines.push(
      `A production build is already running at ${baseUrl} (next build && next start). ` +
        `Seed user credentials: username="${SEED_USER}" password="${SEED_PASS}". ` +
        `Use the chrome-devtools MCP tools for the UI verification script in your plan file. ` +
        `Save screenshots to docs/screenshots/step-${step.number}.png and include them in your commit.`,
    );
    lines.push('');
  }
  lines.push('Exit when you have committed. Do not push. Do not create additional branches.');
  return lines.join('\n');
}

// ---------- stream-json parsing ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StreamEvent = { type: string; subtype?: string; [k: string]: any };

interface ClaudeRunResult {
  exitCode: number;
  timedOut: boolean;
  interrupted: boolean;
  resultEvent?: StreamEvent;
}

function createNdjsonParser(onEvent: (e: StreamEvent) => void) {
  let buf = '';
  return {
    push(chunk: Buffer | string) {
      buf += typeof chunk === 'string' ? chunk : chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const l of lines) {
        if (!l.trim()) continue;
        try {
          onEvent(JSON.parse(l));
        } catch {
          /* partial */
        }
      }
    },
    flush() {
      if (!buf.trim()) return;
      try {
        onEvent(JSON.parse(buf));
      } catch {
        /* partial */
      }
      buf = '';
    },
  };
}

function trunc(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function toolSummary(name: string, input?: Record<string, unknown>) {
  if (!input) return '';
  switch (name) {
    case 'Bash':
      return trunc((input.command as string) ?? '', 100);
    case 'Read':
    case 'Write':
    case 'Edit':
      return (input.file_path as string) ?? '';
    case 'Glob':
      return (input.pattern as string) ?? '';
    case 'Grep':
      return `${(input.pattern as string) ?? ''} ${(input.path as string) ?? ''}`.trim();
    case 'Agent':
      return trunc((input.description as string) ?? '', 80);
    default:
      return trunc(JSON.stringify(input), 80);
  }
}

function fmtEvent(ev: StreamEvent): string | null {
  if (ev.type === 'system' && ev.subtype === 'init') {
    return `  [init] model=${ev.model ?? '?'} session=${(ev.session_id as string)?.slice(0, 8) ?? '?'}`;
  }
  if (ev.type === 'assistant') {
    const content = (
      ev.message as {
        content?: { type: string; text?: string; name?: string; input?: Record<string, unknown> }[];
      }
    )?.content;
    if (!content) return null;
    const out: string[] = [];
    for (const b of content) {
      if (b.type === 'text' && b.text)
        out.push(`  [text] ${trunc(b.text.replace(/\n/g, ' '), 150)}`);
      if (b.type === 'tool_use' && b.name)
        out.push(`  [tool] ${b.name}: ${toolSummary(b.name, b.input)}`);
    }
    return out.length ? out.join('\n') : null;
  }
  if (ev.type === 'result') {
    const ok = ev.subtype === 'success' && !ev.is_error;
    const cost = typeof ev.total_cost_usd === 'number' ? `$${ev.total_cost_usd.toFixed(2)}` : '$?';
    const dur =
      typeof ev.duration_ms === 'number' ? `${(ev.duration_ms / 1000).toFixed(1)}s` : '?s';
    let line = `  [${ok ? 'done' : 'FAIL'}] ${ev.num_turns ?? '?'} turns, ${cost}, ${dur}`;
    if (ev.is_error && typeof ev.result === 'string') line += ` — ${trunc(ev.result, 120)}`;
    return line;
  }
  return null;
}

// ---------- claude spawn with logging ----------

async function spawnClaudeWithLog(
  prompt: string,
  env: NodeJS.ProcessEnv,
  logPath: string,
  timeoutMs: number,
  dryRun: boolean,
): Promise<ClaudeRunResult> {
  if (dryRun) {
    process.stdout.write('--- dry run ---\n');
    process.stdout.write(
      'command: claude -p --dangerously-skip-permissions --effort high' +
        ' --output-format stream-json --verbose\n',
    );
    process.stdout.write('prompt:\n');
    for (const line of prompt.split('\n')) process.stdout.write(`  ${line}\n`);
    process.stdout.write('---\n');
    return { exitCode: 0, timedOut: false, interrupted: false };
  }

  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  logStream.write(`\n===== ${new Date().toISOString()} =====\n`);
  logStream.write(`prompt:\n${prompt}\n---\n`);

  // Prompt piped via stdin (not argv) so that pkill -f won't match prompt text
  // in the claude process command line.
  const proc = spawn(
    'claude',
    [
      '-p',
      '--dangerously-skip-permissions',
      '--effort',
      'high',
      '--output-format',
      'stream-json',
      '--verbose',
    ],
    {
      cwd: REPO_ROOT,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  proc.stdin!.end(prompt);

  let resultEvent: StreamEvent | undefined;
  let eventCount = 0;
  const parser = createNdjsonParser((event) => {
    eventCount++;
    logStream.write(JSON.stringify(event) + '\n');
    if (event.type === 'result') resultEvent = event;
    const line = fmtEvent(event);
    if (line) process.stdout.write(line + '\n');
  });

  proc.stdout!.on('data', (chunk: Buffer) => parser.push(chunk));
  proc.stderr!.on('data', (chunk: Buffer) => {
    process.stderr.write(chunk);
    logStream.write(chunk);
  });

  let timedOut = false;
  let interrupted = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    process.stderr.write(
      `\n[run-plan] step timeout reached (${timeoutMs / 60000}min); sending SIGTERM\n`,
    );
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (!proc.killed) {
        process.stderr.write('[run-plan] process still alive; sending SIGKILL\n');
        proc.kill('SIGKILL');
      }
    }, 5000);
  }, timeoutMs);

  const sigintHandler = (): void => {
    interrupted = true;
    process.stderr.write('\n[run-plan] SIGINT received; forwarding to claude\n');
    proc.kill('SIGINT');
  };
  process.on('SIGINT', sigintHandler);

  try {
    const exitCode = await new Promise<number>((resolve) => {
      proc.on('exit', (code) => resolve(code ?? 1));
    });
    parser.flush();
    if (eventCount === 0) {
      logStream.write('[run-plan] WARNING: zero stream events before exit\n');
      process.stderr.write(
        `[run-plan] claude exited (${exitCode}) with zero stream events` +
          ' — check stderr above or dmesg for OOM\n',
      );
    }
    return { exitCode, timedOut, interrupted, resultEvent };
  } finally {
    clearTimeout(timeoutHandle);
    process.off('SIGINT', sigintHandler);
    logStream.end();
  }
}

// ---------- post-step verification ----------

function verifyAndNormalizeCommit(step: Step, baselineSha: string): void {
  const latest = getLatestStepNumber();
  const newCommits = countCommitsSince(baselineSha);

  if (newCommits === 0) {
    throw new Error(
      `step ${step.number} produced no commits. the step did not complete successfully.`,
    );
  }

  if (latest !== step.number) {
    throw new Error(
      `step ${step.number} completed but the latest commit is not marked with its step number ` +
        `(latest marker found: ${latest ?? 'none'}). inspect git log and fix manually.`,
    );
  }

  if (newCommits > 1) {
    process.stdout.write(
      `[run-plan] step ${step.number} produced ${newCommits} commits; squashing into one\n`,
    );
    // Soft-reset to baseline and recommit with the canonical message
    git('reset', '--soft', baselineSha);
    git('commit', '-m', `step ${step.number}: ${step.title}`);
  } else {
    // Exactly one commit; normalize its subject line to the canonical form if needed
    const currentSubject = git('log', '-1', '--format=%s').trim();
    const canonical = `step ${step.number}: ${step.title}`;
    if (currentSubject !== canonical) {
      process.stdout.write(
        `[run-plan] normalizing commit marker: "${currentSubject}" -> "${canonical}"\n`,
      );
      git('commit', '--amend', '-m', canonical);
    }
  }
}

function runPostStepGates(step: Step): void {
  // tsc --noEmit
  process.stdout.write('[run-plan] running tsc --noEmit\n');
  const tsc = spawnSync('npx', ['tsc', '--noEmit'], { cwd: REPO_ROOT, stdio: 'inherit' });
  if (tsc.status !== 0) {
    throw new Error(`step ${step.number}: tsc --noEmit failed`);
  }

  // eslint
  process.stdout.write('[run-plan] running eslint\n');
  const eslint = spawnSync('npx', ['eslint', '.'], { cwd: REPO_ROOT, stdio: 'inherit' });
  if (eslint.status !== 0) {
    throw new Error(`step ${step.number}: eslint failed`);
  }

  // CLAUDE.md bloat check: compare current CLAUDE.md to the file at HEAD~1 (before this step's commit)
  const diff = spawnSync('git', ['diff', 'HEAD~1', '--', 'CLAUDE.md'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (diff.status === 0) {
    const addedLines = diff.stdout
      .split('\n')
      .filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
    if (addedLines > 100) {
      throw new Error(
        `step ${step.number}: CLAUDE.md grew by ${addedLines} lines (> 100 cap). ` +
          `review the diff and respect the section caps.`,
      );
    }
    if (addedLines > 0) {
      process.stdout.write(`[run-plan] CLAUDE.md grew by ${addedLines} lines (ok)\n`);
    }
  }
}

// ---------- UI dev server lifecycle ----------

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const addr = srv.address();
      if (typeof addr === 'object' && addr) {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        reject(new Error('could not get port'));
      }
    });
  });
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve((res.statusCode ?? 500) < 500);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(2000, () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${url}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startDevServer(port: number): Promise<ChildProcess> {
  process.stdout.write('[run-plan] running npx next build\n');
  const build = spawnSync('npx', ['next', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });
  if (build.status !== 0) {
    throw new Error('next build failed');
  }
  process.stdout.write(`[run-plan] starting next start on port ${port}\n`);
  const proc = spawn('npx', ['next', 'start', '-p', String(port)], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout?.on('data', (d) => process.stdout.write(d));
  proc.stderr?.on('data', (d) => process.stderr.write(d));

  await waitForHttp(`http://127.0.0.1:${port}/`, 60_000);
  process.stdout.write('[run-plan] dev server ready\n');
  return proc;
}

async function stopDevServer(proc: ChildProcess): Promise<void> {
  if (!proc || proc.killed) return;
  process.stdout.write('[run-plan] stopping dev server\n');
  proc.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL');
      resolve();
    }, 5000);
    proc.on('exit', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

// ---------- seed user for UI steps ----------

function ensureSeedUser(): void {
  const usersScript = path.join(REPO_ROOT, 'scripts', 'users.ts');
  if (!fs.existsSync(usersScript)) {
    process.stdout.write(
      '[run-plan] scripts/users.ts not present yet; skipping seed-user creation\n',
    );
    return;
  }
  process.stdout.write(`[run-plan] ensuring seed user "${SEED_USER}" exists\n`);
  // Best-effort: try to add; ignore "already exists" failures by then changing the password
  spawnSync('npx', ['tsx', 'scripts/users.ts', 'add', SEED_USER, SEED_PASS], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
  });
  spawnSync('npx', ['tsx', 'scripts/users.ts', 'change-password', SEED_USER, SEED_PASS], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
  });
}

// ---------- per-step execution ----------

async function runStep(step: Step, args: CliArgs): Promise<void> {
  const baselineSha = currentHeadSha();
  const logPath = path.join(
    LOG_DIR,
    `step-${step.number}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`,
  );

  let server: ChildProcess | null = null;
  let port: number | null = null;
  let baseUrl: string | null = null;

  const env = { ...process.env };
  // Remove API key so Claude Code uses the subscription plan instead of API billing.
  delete env.ANTHROPIC_API_KEY;

  try {
    if (step.ui && !args.noServer) {
      ensureSeedUser();
      port = await findFreePort();
      baseUrl = `http://127.0.0.1:${port}`;
      env.MSKSIM_PORT = String(port);
      env.MSKSIM_BASE_URL = baseUrl;
      env.MSKSIM_SEED_USER = SEED_USER;
      env.MSKSIM_SEED_PASS = SEED_PASS;
      server = await startDevServer(port);
    }

    const prompt = buildPrompt(step, baseUrl);
    process.stdout.write(
      `\n[run-plan] >>> step ${step.number}: ${step.title}${step.ui ? ' (UI)' : ''}\n`,
    );
    process.stdout.write(`[run-plan] log: ${logPath}\n`);

    const result = await spawnClaudeWithLog(prompt, env, logPath, step.timeoutMs, args.dryRun);

    if (result.interrupted) {
      process.stderr.write('[run-plan] interrupted by user; exiting 130\n');
      process.exit(130);
    }
    if (result.timedOut) {
      throw new Error(`step ${step.number} timed out after ${step.timeoutMs / 60000} minutes`);
    }
    if (result.exitCode !== 0) {
      let msg = `claude exited non-zero (${result.exitCode}) on step ${step.number}`;
      if (result.exitCode === 143) msg += ' (SIGTERM — possible OOM or external kill)';
      if (result.exitCode === 137) msg += ' (SIGKILL — likely OOM killer)';
      if (result.resultEvent?.is_error && typeof result.resultEvent.result === 'string') {
        msg += `\n  result: ${result.resultEvent.result.slice(0, 200)}`;
      }
      throw new Error(msg);
    }
  } finally {
    if (server) await stopDevServer(server);
  }

  if (args.dryRun) return;

  verifyAndNormalizeCommit(step, baselineSha);
  runPostStepGates(step);

  process.stdout.write(`[run-plan] <<< step ${step.number} complete\n`);
}

// ---------- main ----------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const steps = loadSteps();
  if (steps.length === 0) {
    process.stdout.write(`no step files found under ${PLAN_DIR}\n`);
    process.exit(0);
  }

  if (args.list) {
    listStepStatus(steps);
    return;
  }

  handleDirtyTree(args);

  const toRun = selectStepsToRun(steps, args);
  if (toRun.length === 0) {
    process.stdout.write('nothing to do.\n');
    return;
  }

  process.stdout.write(
    `[run-plan] will run ${toRun.length} step(s): ${toRun.map((s) => s.number).join(', ')}\n`,
  );

  for (const step of toRun) {
    try {
      await runStep(step, args);
    } catch (e) {
      process.stderr.write(`\n[run-plan] error: ${(e as Error).message}\n`);
      process.stderr.write(
        '[run-plan] aborting. fix the issue, clean the working tree, and re-run to resume.\n',
      );
      process.exit(1);
    }
  }

  process.stdout.write('[run-plan] all requested steps complete.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
