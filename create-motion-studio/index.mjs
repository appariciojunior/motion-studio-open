#!/usr/bin/env node
// create-motion-studio — one-command scaffold, the same shape as
// `npx create-video@latest` or `npx create-next-app`. Someone who has never
// touched this repo runs one line, gets a working local copy, and is told
// exactly what to do next — no manual git clone, no digging through the
// README for the ffmpeg prerequisite.
//
// Usage:
//   npx create-motion-studio [target-dir]

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_URL = 'https://github.com/appariciojunior/motion-studio-open.git';

const log = (msg) => console.log(msg);
const step = (n, total, msg) => console.log(`\n[${n}/${total}] ${msg}`);

function fail(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

// npm is a .cmd shim on Windows, which Node can only launch through a shell.
// shell:true is safe here specifically because every argument this script
// passes is either a fixed literal ('install', '--depth') or dirArg, which is
// validated against a plain-folder-name pattern before it ever reaches run() —
// there is nothing for a shell to misinterpret.
const WIN = process.platform === 'win32';

// Node's DEP0190 fires whenever shell:true is combined with an args array,
// regardless of whether that array is actually safe — its own fix is to fold
// everything into one pre-quoted string instead. Every argument here is
// either a fixed literal or dirArg (already checked against a plain-folder
// pattern), so simple double-quoting is enough.
const cmdLine = (cmd, args) => [cmd, ...args].map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ');

// Runs a command with output streamed live (git clone / npm install both take
// long enough that silence would read as a hang), and turns a non-zero exit
// into a clear failure instead of a raw stack trace.
function run(cmd, args, opts = {}) {
  const result = WIN
    ? spawnSync(cmdLine(cmd, args), { stdio: 'inherit', shell: true, ...opts })
    : spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (result.error) fail(`could not run "${cmd}": ${result.error.message}`);
  if (result.status !== 0) fail(`"${cmd} ${args.join(' ')}" exited with code ${result.status}`);
}

function commandExists(cmd, versionFlag = '--version') {
  const result = WIN
    ? spawnSync(cmdLine(cmd, [versionFlag]), { stdio: 'ignore', shell: true })
    : spawnSync(cmd, [versionFlag], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function ffmpegInstallHint() {
  switch (process.platform) {
    case 'darwin': return 'brew install ffmpeg';
    case 'win32': return 'winget install ffmpeg  (or: choco install ffmpeg)';
    default: return 'sudo apt install ffmpeg  (or your distro\'s package manager)';
  }
}

async function main() {
  const dirArg = process.argv[2] || 'motion-studio';
  if (!/^[\w.-]+$/.test(dirArg)) {
    fail(`"${dirArg}" isn't a plain folder name. Use letters, numbers, "-", "_" or "." only.`);
  }
  const target = resolve(process.cwd(), dirArg);
  const TOTAL_STEPS = 4;

  log('create-motion-studio');
  log(`This will set up motion-studio-open in ${target}\n`);

  if (existsSync(target) && readdirSync(target).length > 0) {
    fail(`"${target}" already exists and is not empty. Pick a different folder:\n  npx create-motion-studio my-motion-studio`);
  }

  if (!commandExists('git')) {
    fail(
      'git is required to fetch the project and was not found on PATH.\n' +
      `  Install git, or download the source directly: ${REPO_URL.replace(/\.git$/, '')}`,
    );
  }

  step(1, TOTAL_STEPS, `Cloning motion-studio-open into ${target}...`);
  run('git', ['clone', '--depth', '1', REPO_URL, target]);
  // Keep the shallow Git checkout: the local app uses it to detect official
  // updates and can fast-forward it after the user explicitly agrees.

  step(2, TOTAL_STEPS, 'Installing dependencies (npm install)...');
  run('npm', ['install'], { cwd: target });

  step(3, TOTAL_STEPS, 'Checking for ffmpeg...');
  // ffmpeg's own flag is single-dash `-version`; `--version` isn't
  // recognized and exits non-zero, which read as "not installed" even when it is.
  const hasFfmpeg = commandExists('ffmpeg', '-version');
  if (hasFfmpeg) log('  ffmpeg found — server-side MP4/audio export will work out of the box.');
  else {
    log('  ffmpeg was not found on PATH.');
    log('  GIF export and browser-only MP4/WebM export still work without it.');
    log(`  For server-side export (audio muxing, or browsers without WebCodecs): ${ffmpegInstallHint()}`);
  }

  step(4, TOTAL_STEPS, 'Done.');
  log(`\ncd ${dirArg}`);
  log('npm run dev');
  log('\nThen open http://localhost:3000');
}

main();
