#!/usr/bin/env node
// ============================================================
//  verify-fork-only — refuse to send this fork's deploy wiring upstream
//
//  This repository is a fork. Some things belong ONLY here: the Vercel
//  Analytics integration exists so davicorrea0/motion-jitter-clone can deploy
//  and measure itself. Upstream (appariciojunior/motion-studio-open) neither
//  needs it nor should be asked to carry it — it is one project's hosting
//  choice, and it drags a dependency plus a root-layout import along with it.
//
//  The leak is easy and quiet. `app/layout.tsx` is a file real features touch,
//  so a branch cut after the integration landed carries `<Analytics />` into
//  every upstream PR without anyone deciding to. It is two lines in a diff of
//  hundreds; review does not reliably catch it.
//
//  So this compares the branch against the upstream base and fails if any
//  ADDED line matches a fork-only marker. Added lines only: the point is what
//  this branch introduces, not what the fork happens to contain.
//
//  Usage:
//    node scripts/verify-fork-only.cjs                  # vs upstream/main
//    UPSTREAM_BASE=origin/main node scripts/verify-fork-only.cjs
//    npm run check:upstream
//
//  First time, add the remote the base refers to:
//    git remote add upstream https://github.com/appariciojunior/motion-studio-open.git
//    git fetch upstream
// ============================================================

const { execFileSync } = require('node:child_process');

const BASE = process.env.UPSTREAM_BASE || 'upstream/main';

// Each marker is a thing that must never reach upstream, with a note the
// failure message can print — a bare regex list teaches nobody why.
const MARKERS = [
  { re: /@vercel\/analytics/, why: 'Vercel Analytics package — this fork\'s hosting, not upstream\'s' },
  { re: /@vercel\/speed-insights/, why: 'Vercel Speed Insights — same' },
  { re: /<\s*Analytics\b/, why: '<Analytics /> element from @vercel/analytics' },
  { re: /<\s*SpeedInsights\b/, why: '<SpeedInsights /> element' },
  { re: /vercel\[bot\]/, why: 'Vercel bot co-author trailer' },
];

// Whole files that are fork-only regardless of content.
const FORK_ONLY_FILES = [/^vercel\.json$/, /^\.vercel\//, /^\.vercel\.json$/];

// This file names every marker literally, so it would report itself.
const SELF = 'scripts/verify-fork-only.cjs';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function baseExists(ref) {
  try { git(['rev-parse', '--verify', '--quiet', ref]); return true; } catch { return false; }
}

if (!baseExists(BASE)) {
  console.error(`\n  Base ref "${BASE}" not found, so there is nothing to compare against.\n`);
  console.error('  Add the upstream remote once:');
  console.error('    git remote add upstream https://github.com/appariciojunior/motion-studio-open.git');
  console.error('    git fetch upstream\n');
  console.error('  Or point the check somewhere else:');
  console.error('    UPSTREAM_BASE=origin/main node scripts/verify-fork-only.cjs\n');
  process.exit(2);
}

// Three dots: everything this branch adds since it diverged, which is exactly
// what a pull request would show. Two dots would also blame the branch for
// commits that landed upstream in the meantime.
const diff = git(['diff', '--unified=0', `${BASE}...HEAD`]);

const problems = [];
let file = null;
let lineNo = 0;

for (const raw of diff.split('\n')) {
  if (raw.startsWith('+++ b/')) { file = raw.slice(6).trim(); continue; }
  if (raw.startsWith('@@')) {
    // @@ -old,+new @@ — track the new-file line number so the report can cite it
    const m = /\+(\d+)/.exec(raw);
    lineNo = m ? Number(m[1]) : 0;
    continue;
  }
  if (!file || file === SELF || file === '/dev/null') continue;

  if (raw.startsWith('+') && !raw.startsWith('+++')) {
    const text = raw.slice(1);
    for (const { re, why } of MARKERS) {
      if (re.test(text)) problems.push({ file, lineNo, text: text.trim(), why });
    }
    lineNo++;
  }
}

// Added/renamed fork-only files, independent of their contents.
const changedFiles = git(['diff', '--name-only', `${BASE}...HEAD`]).split('\n').filter(Boolean);
for (const f of changedFiles) {
  if (f === SELF) continue;
  if (FORK_ONLY_FILES.some((re) => re.test(f))) {
    problems.push({ file: f, lineNo: 0, text: '(whole file)', why: 'fork-only deploy config' });
  }
}

if (problems.length === 0) {
  console.log(`Fork-only check passed — nothing in ${BASE}...HEAD that upstream should not receive.`);
  process.exit(0);
}

console.error(`\n  This branch would carry ${problems.length} fork-only change${problems.length > 1 ? 's' : ''} upstream:\n`);
for (const p of problems) {
  console.error(`    ${p.file}${p.lineNo ? ':' + p.lineNo : ''}`);
  console.error(`      ${p.text}`);
  console.error(`      ^ ${p.why}\n`);
}
console.error('  Keep the deploy wiring on this fork only. Either rebase the branch onto');
console.error(`  ${BASE} and drop those hunks, or move them to a branch you never PR upstream.\n`);
process.exit(1);
