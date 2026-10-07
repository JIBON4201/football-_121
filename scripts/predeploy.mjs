#!/usr/bin/env node
/**
 * Pre-deployment gate.
 *
 * Runs every check that must pass before this site may be deployed, in both
 * applications, and fails loudly. This script does NOT deploy anything — it
 * only proves the tree is releasable. Deployment is a separate, explicit action
 * that requires a configured platform and real credentials (see
 * PRODUCTION-CHECKLIST.md).
 *
 *   node scripts/predeploy.mjs            # full gate
 *   node scripts/predeploy.mjs --quick    # skip the slowest (test) suites
 *
 * Exit codes: 0 = releasable, 1 = a FAIL gate, 2 = gate could not run.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = join(ROOT, 'backend');
const FRONTEND = join(ROOT, 'frontend');
const quick = process.argv.includes('--quick');

const GREEN = '[32m';
const YELLOW = '[33m';
const RED = '[31m';
const DIM = '[2m';
const RESET = '[0m';

const results = [];

function run(label, cwd, command, args, { severity = 'FAIL', optional = false } = {}) {
  const startedAt = Date.now();
  const proc = spawnSync(command, args, {
    cwd,
    shell: process.platform === 'win32',
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  const durationMs = Date.now() - startedAt;
  const output = `${proc.stdout ?? ''}${proc.stderr ?? ''}`;
  const ok = proc.status === 0;

  const status = ok ? 'PASS' : severity === 'WARN' ? 'WARN' : optional ? 'SKIP' : 'FAIL';
  results.push({ label, status, durationMs, output });

  const color = status === 'PASS' ? GREEN : status === 'WARN' ? YELLOW : status === 'SKIP' ? DIM : RED;
  console.log(`${color}${status.padEnd(5)}${RESET} ${label} ${DIM}(${durationMs}ms)${RESET}`);
  return ok;
}

/** Parse `npm audit --omit=dev` totals. */
function auditCounts(cwd) {
  const proc = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    cwd,
    shell: process.platform === 'win32',
    encoding: 'utf8',
  });
  if (proc.status !== 0 && !proc.stdout) return null;
  try {
    const parsed = JSON.parse(proc.stdout);
    const meta = parsed.metadata?.vulnerabilities ?? {};
    return {
      critical: meta.critical ?? 0,
      high: meta.high ?? 0,
      moderate: meta.moderate ?? 0,
      low: meta.low ?? 0,
    };
  } catch {
    return null;
  }
}

console.log('\n=== PRE-DEPLOYMENT GATE ===\n');

if (!existsSync(join(BACKEND, 'package.json')) || !existsSync(join(FRONTEND, 'package.json'))) {
  console.error(`${RED}FAIL${RESET} backend/ and frontend/ not found under ${ROOT}`);
  process.exit(2);
}

// ── Backend ─────────────────────────────────────────────────────────────────
console.log(`${DIM}-- backend --${RESET}`);
run('backend typecheck', BACKEND, 'npx', ['tsc', '--noEmit']);
if (!quick) run('backend unit + integration tests', BACKEND, 'npx', ['vitest', 'run', '--reporter=dot']);
run('backend production build', BACKEND, 'npm', ['run', 'build']);
run('backend verification audit', BACKEND, 'npm', ['run', 'verify', '--', '--no-db', '--quiet']);

const backendAudit = auditCounts(BACKEND);
if (backendAudit) {
  const clean = backendAudit.critical === 0 && backendAudit.high === 0;
  results.push({
    label: 'backend dependency audit',
    status: clean ? 'PASS' : 'WARN',
    durationMs: 0,
    output: JSON.stringify(backendAudit),
  });
  const color = clean ? GREEN : YELLOW;
  console.log(
    `${color}${clean ? 'PASS' : 'WARN'}${RESET} backend dependency audit ` +
      `${DIM}(${backendAudit.critical} critical, ${backendAudit.high} high, ${backendAudit.moderate} moderate)${RESET}`,
  );
}

// ── Frontend ────────────────────────────────────────────────────────────────
console.log(`\n${DIM}-- frontend --${RESET}`);
run('frontend typecheck', FRONTEND, 'npx', ['tsc', '--noEmit']);
run('frontend lint', FRONTEND, 'npm', ['run', 'lint']);
if (!quick) run('frontend tests', FRONTEND, 'npx', ['vitest', 'run', '--reporter=dot']);
run('frontend production build', FRONTEND, 'npm', ['run', 'build']);

const frontendAudit = auditCounts(FRONTEND);
if (frontendAudit) {
  // Any critical advisory is a deployment blocker: it is either exploitable or
  // requires a major upgrade that must be a planned, tested change.
  const clean = frontendAudit.critical === 0 && frontendAudit.high === 0;
  results.push({
    label: 'frontend dependency audit',
    status: clean ? 'PASS' : 'FAIL',
    durationMs: 0,
    output: JSON.stringify(frontendAudit),
  });
  const color = clean ? GREEN : RED;
  console.log(
    `${color}${clean ? 'PASS' : 'FAIL'}${RESET} frontend dependency audit ` +
      `${DIM}(${frontendAudit.critical} critical, ${frontendAudit.high} high, ${frontendAudit.moderate} moderate)${RESET}`,
  );
}

// ── Deployment prerequisites that are configuration, not code ───────────────
console.log(`\n${DIM}-- deployment prerequisites --${RESET}`);
const deploymentTargets = [
  ['CI/CD pipeline', ['.github/workflows', '.gitlab-ci.yml', '.circleci', 'azure-pipelines.yml']],
  ['container build', ['Dockerfile', 'docker-compose.yml', 'backend/Dockerfile', 'frontend/Dockerfile']],
  ['hosting platform', ['vercel.json', 'netlify.toml', 'fly.toml', 'render.yaml', 'railway.json', 'Procfile']],
  ['version control', ['.git']],
];
for (const [label, candidates] of deploymentTargets) {
  const found = candidates.some((candidate) => existsSync(join(ROOT, candidate)));
  results.push({ label: `deployment target: ${label}`, status: found ? 'PASS' : 'FAIL', durationMs: 0, output: '' });
  const color = found ? GREEN : RED;
  console.log(`${color}${found ? 'PASS' : 'FAIL'}${RESET} deployment target: ${label}`);
}

const prodEnvFiles = [
  join(BACKEND, '.env'),
  join(FRONTEND, '.env.local'),
  join(FRONTEND, '.env.production'),
].filter((path) => existsSync(path));
results.push({
  label: 'production environment file present',
  status: prodEnvFiles.length > 0 ? 'PASS' : 'FAIL',
  durationMs: 0,
  output: '',
});
console.log(
  `${prodEnvFiles.length > 0 ? GREEN : RED}${prodEnvFiles.length > 0 ? 'PASS' : 'FAIL'}${RESET} ` +
    'production environment file present' +
    (prodEnvFiles.length > 0 ? ` ${DIM}(${prodEnvFiles.map((p) => p.replace(ROOT, '.')).join(', ')})${RESET}` : ''),
);

// ── Summary ─────────────────────────────────────────────────────────────────
const count = (status) => results.filter((result) => result.status === status).length;
const pass = count('PASS');
const warn = count('WARN');
const fail = count('FAIL');
const skip = count('SKIP');

console.log(`\n=== GATE RESULT ===`);
console.log(`${pass} pass, ${warn} warn, ${fail} fail, ${skip} skipped`);

if (fail > 0) {
  console.log(`\n${RED}FAILING GATES${RESET}`);
  for (const result of results.filter((r) => r.status === 'FAIL')) {
    console.log(`  - ${result.label}`);
  }
  console.log(`\n${RED}DO NOT DEPLOY.${RESET} Resolve every failing gate above and re-run.`);
  process.exit(1);
}

if (warn > 0) {
  console.log(`\n${YELLOW}WARNINGS${RESET}`);
  for (const result of results.filter((r) => r.status === 'WARN')) {
    console.log(`  - ${result.label}`);
  }
}

console.log(`\n${GREEN}All gates passed.${RESET} This proves the tree is releasable — it does not deploy it.`);
process.exit(0);