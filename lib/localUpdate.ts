import 'server-only';

import { execFile } from 'node:child_process';

const OFFICIAL_REPOSITORY = 'https://github.com/appariciojunior/motion-studio-open.git';
const UPDATE_BRANCH = 'main';
const GIT_TIMEOUT_MS = 30_000;

export interface UpdateCommit {
  hash: string;
  subject: string;
}

export interface LocalUpdateStatus {
  supported: true;
  updateAvailable: boolean;
  canUpdate: boolean;
  currentCommit: string;
  latestCommit: string;
  branch: string | null;
  commits: UpdateCommit[];
  reason?: 'dirty' | 'detached' | 'diverged' | 'branch';
}

type GitError = Error & { code?: number | string; stderr?: string };

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        encoding: 'utf8',
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const gitError = error as GitError;
          gitError.stderr = stderr;
          reject(gitError);
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

async function succeeds(cwd: string, args: string[]): Promise<boolean> {
  try {
    await runGit(cwd, args);
    return true;
  } catch (error) {
    // `git merge-base --is-ancestor` uses exit code 1 for a normal "no".
    if ((error as GitError).code === 1) return false;
    throw error;
  }
}

async function repositoryRoot(): Promise<string> {
  return runGit(process.cwd(), ['rev-parse', '--show-toplevel']);
}

function parseCommits(output: string): UpdateCommit[] {
  if (!output) return [];
  const commits = output.split('\n').flatMap((line) => {
    const separator = line.indexOf('\t');
    if (separator < 0) return [];
    return [{ hash: line.slice(0, separator), subject: line.slice(separator + 1) }];
  });
  const meaningful = commits.filter((commit) => !commit.subject.startsWith('Merge pull request'));
  return meaningful.length ? meaningful : commits;
}

async function inspectFetchedUpdate(root: string): Promise<LocalUpdateStatus> {
  const [currentCommit, latestCommit, branch, dirty] = await Promise.all([
    runGit(root, ['rev-parse', 'HEAD']),
    runGit(root, ['rev-parse', 'FETCH_HEAD']),
    runGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => ''),
    runGit(root, ['status', '--porcelain', '--untracked-files=normal']),
  ]);

  if (currentCommit === latestCommit) {
    return {
      supported: true,
      updateAvailable: false,
      canUpdate: false,
      currentCommit,
      latestCommit,
      branch: branch || null,
      commits: [],
    };
  }

  const isBehind = await succeeds(root, ['merge-base', '--is-ancestor', currentCommit, latestCommit]);
  if (!isBehind) {
    // A local commit on top of official main is already newer for update
    // purposes. Two unrelated tips, however, need a person to reconcile them.
    const isAhead = await succeeds(root, ['merge-base', '--is-ancestor', latestCommit, currentCommit]);
    const log = isAhead ? '' : await runGit(root, [
      'log',
      '--format=%H%x09%s',
      '--max-count=8',
      latestCommit,
      `^${currentCommit}`,
    ]);
    return {
      supported: true,
      updateAvailable: !isAhead,
      canUpdate: false,
      currentCommit,
      latestCommit,
      branch: branch || null,
      commits: parseCommits(log),
      reason: isAhead ? undefined : 'diverged',
    };
  }

  const log = await runGit(root, [
    'log',
    '--format=%H%x09%s',
    '--max-count=8',
    `${currentCommit}..${latestCommit}`,
  ]);
  const reason = !branch
    ? 'detached'
    : branch !== UPDATE_BRANCH
      ? 'branch'
      : dirty
        ? 'dirty'
        : undefined;

  return {
    supported: true,
    updateAvailable: true,
    canUpdate: !reason,
    currentCommit,
    latestCommit,
    branch: branch || null,
    commits: parseCommits(log),
    reason,
  };
}

export async function checkLocalUpdate(): Promise<LocalUpdateStatus> {
  const root = await repositoryRoot();
  const repository = process.env.MOTION_STUDIO_UPDATE_REPOSITORY || OFFICIAL_REPOSITORY;
  await runGit(root, ['fetch', '--quiet', '--no-tags', repository, UPDATE_BRANCH]);
  return inspectFetchedUpdate(root);
}

type ApplyUpdateResult = LocalUpdateStatus & { updated: boolean; dependenciesChanged: boolean };

let activeUpdate: Promise<ApplyUpdateResult> | null = null;

async function applyLocalUpdateOnce(): Promise<ApplyUpdateResult> {
  const root = await repositoryRoot();
  const repository = process.env.MOTION_STUDIO_UPDATE_REPOSITORY || OFFICIAL_REPOSITORY;

  // Always fetch again at click time: the status shown in the browser may have
  // been open for hours, and FETCH_HEAD is shared mutable Git state.
  await runGit(root, ['fetch', '--quiet', '--no-tags', repository, UPDATE_BRANCH]);
  const before = await inspectFetchedUpdate(root);
  if (!before.updateAvailable) return { ...before, updated: false, dependenciesChanged: false };
  if (!before.canUpdate) return { ...before, updated: false, dependenciesChanged: false };

  await runGit(root, ['merge', '--ff-only', before.latestCommit]);
  const dependenciesChanged = !!(await runGit(root, [
    'diff',
    '--name-only',
    before.currentCommit,
    before.latestCommit,
    '--',
    'package.json',
    'package-lock.json',
  ]));
  const after = await inspectFetchedUpdate(root);
  return { ...after, updated: true, dependenciesChanged };
}

export function applyLocalUpdate(): Promise<ApplyUpdateResult> {
  // A double-click or two open tabs must never run concurrent fetch/merge
  // operations against the same checkout.
  if (!activeUpdate) {
    activeUpdate = applyLocalUpdateOnce().finally(() => {
      activeUpdate = null;
    });
  }
  return activeUpdate;
}
