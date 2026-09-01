import 'server-only';

import { execFile } from 'node:child_process';

const OFFICIAL_REPOSITORY = 'https://github.com/appariciojunior/motion-studio-open.git';
const UPDATE_BRANCH = 'main';
const UPDATE_REF = 'refs/motion-studio/update-main';
const FALLBACK_UPDATE_REFS = [UPDATE_REF, 'refs/remotes/appariciojunior/main'] as const;
const UPDATE_LOG_FORMAT = '%x1e%H%x1f%s%x1f%b';
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
  refresh: 'online' | 'cached';
  refreshError?: string;
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

interface UpdateSource {
  latestRef: string;
  refresh: LocalUpdateStatus['refresh'];
  refreshError?: string;
}

async function firstAvailableUpdateRef(root: string): Promise<string | null> {
  for (const ref of FALLBACK_UPDATE_REFS) {
    try {
      await runGit(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
      return ref;
    } catch {
      // Try the next locally cached official ref.
    }
  }
  return null;
}

function offlineMessage(error: unknown): string {
  const detail = error instanceof Error
    ? `${error.message}\n${(error as GitError).stderr || ''}`.toLowerCase()
    : '';
  if (detail.includes('failed to connect') || detail.includes('could not resolve') || detail.includes('timed out')) {
    return 'GitHub could not be reached. Showing the last update information saved locally.';
  }
  return 'Update information could not be refreshed. Showing the last version saved locally.';
}

async function refreshUpdateSource(root: string, repository: string): Promise<UpdateSource> {
  try {
    // Unlike FETCH_HEAD, this dedicated ref survives a later offline fetch.
    await runGit(root, [
      'fetch',
      '--quiet',
      '--no-tags',
      '--no-write-fetch-head',
      repository,
      `+${UPDATE_BRANCH}:${UPDATE_REF}`,
    ]);
    return { latestRef: UPDATE_REF, refresh: 'online' };
  } catch (error) {
    const latestRef = await firstAvailableUpdateRef(root);
    if (!latestRef) {
      throw new Error('GitHub could not be reached and no saved update information is available. Check your connection and try again.');
    }
    return { latestRef, refresh: 'cached', refreshError: offlineMessage(error) };
  }
}

function parseCommits(output: string): UpdateCommit[] {
  if (!output) return [];
  const seen = new Set<string>();
  return output.split('\x1e').flatMap((record) => {
    const [rawHash, rawSubject, rawBody = ''] = record.trim().split('\x1f');
    if (!rawHash || !rawSubject) return [];

    const bodySummary = rawBody
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !/^(merge|co-authored-by|signed-off-by)\b/i.test(line));
    const branchSummary = rawSubject.match(/^Merge pull request #\d+ from [^/]+\/(.+)$/i)?.[1];
    const source = rawSubject.startsWith('Merge pull request')
      ? bodySummary || branchSummary || 'Project improvements'
      : rawSubject;
    const cleaned = source
      .replace(/^(feat|fix|refactor|perf|style|docs|test|build|ci|chore)(\([^)]*\))?!?(?:\s*[:/-]\s*|\s+)/i, '')
      .replace(/[-_/]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const subject = /^consolidacao\b/i.test(cleaned)
      ? 'Project maintenance and consolidation'
      : cleaned;
    if (!subject) return [];

    const readable = subject.charAt(0).toUpperCase() + subject.slice(1);
    const key = readable.toLocaleLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ hash: rawHash.trim(), subject: readable }];
  });
}

async function inspectFetchedUpdate(root: string, source: UpdateSource): Promise<LocalUpdateStatus> {
  const [currentCommit, latestCommit, branch, dirty] = await Promise.all([
    runGit(root, ['rev-parse', 'HEAD']),
    runGit(root, ['rev-parse', source.latestRef]),
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
      refresh: source.refresh,
      refreshError: source.refreshError,
    };
  }

  const isBehind = await succeeds(root, ['merge-base', '--is-ancestor', currentCommit, latestCommit]);
  if (!isBehind) {
    // A local commit on top of official main is already newer for update
    // purposes. Two unrelated tips, however, need a person to reconcile them.
    const isAhead = await succeeds(root, ['merge-base', '--is-ancestor', latestCommit, currentCommit]);
    const log = isAhead ? '' : await runGit(root, [
      'log',
      `--format=${UPDATE_LOG_FORMAT}`,
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
      refresh: source.refresh,
      refreshError: source.refreshError,
      reason: isAhead ? undefined : 'diverged',
    };
  }

  const log = await runGit(root, [
    'log',
    `--format=${UPDATE_LOG_FORMAT}`,
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
    canUpdate: !reason && source.refresh === 'online',
    currentCommit,
    latestCommit,
    branch: branch || null,
    commits: parseCommits(log),
    refresh: source.refresh,
    refreshError: source.refreshError,
    reason,
  };
}

export async function checkLocalUpdate(): Promise<LocalUpdateStatus> {
  const root = await repositoryRoot();
  const repository = process.env.MOTION_STUDIO_UPDATE_REPOSITORY || OFFICIAL_REPOSITORY;
  const source = await refreshUpdateSource(root, repository);
  return inspectFetchedUpdate(root, source);
}

type ApplyUpdateResult = LocalUpdateStatus & { updated: boolean; dependenciesChanged: boolean };

let activeUpdate: Promise<ApplyUpdateResult> | null = null;

async function applyLocalUpdateOnce(): Promise<ApplyUpdateResult> {
  const root = await repositoryRoot();
  const repository = process.env.MOTION_STUDIO_UPDATE_REPOSITORY || OFFICIAL_REPOSITORY;

  // Always refresh again at click time: the status shown in the browser may
  // have been open for hours. Offline cached data is never auto-installed.
  const source = await refreshUpdateSource(root, repository);
  const before = await inspectFetchedUpdate(root, source);
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
  const after = await inspectFetchedUpdate(root, source);
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
