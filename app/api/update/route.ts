import { NextRequest, NextResponse } from 'next/server';
import { applyLocalUpdate, checkLocalUpdate } from '@/lib/localUpdate';
import { IS_HOSTED_DEPLOYMENT } from '@/lib/deployment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || host.startsWith('127.');
}

function requestHostname(request: NextRequest): string {
  // Next dev normalizes request.url to its own localhost origin even when the
  // browser reached it through a LAN address. The forwarded/Host header keeps
  // the address the browser actually used.
  const rawHost = (request.headers.get('x-forwarded-host') || request.headers.get('host') || '')
    .split(',')[0]
    .trim();
  if (rawHost.startsWith('[')) return rawHost.slice(1, rawHost.indexOf(']'));
  return rawHost.split(':')[0];
}

function localOnly(request: NextRequest): NextResponse | null {
  if (IS_HOSTED_DEPLOYMENT) {
    return NextResponse.json(
      { supported: false, error: 'Hosted deployments are updated by the deployment provider.' },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const hostname = requestHostname(request) || url.hostname;
  if (!isLoopback(hostname)) {
    return NextResponse.json(
      { supported: false, error: 'Updates are only available from localhost.' },
      { status: 403 },
    );
  }

  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) {
    return NextResponse.json(
      { supported: false, error: 'Cross-origin update request rejected.' },
      { status: 403 },
    );
  }

  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') {
    return NextResponse.json(
      { supported: false, error: 'Cross-site update request rejected.' },
      { status: 403 },
    );
  }
  return null;
}

function failure(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : 'Could not check for updates.';
  return NextResponse.json({ supported: false, error: message }, { status: 503 });
}

export async function GET(request: NextRequest) {
  const rejected = localOnly(request);
  if (rejected) return rejected;

  try {
    const status = await checkLocalUpdate();
    return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  const rejected = localOnly(request);
  if (rejected) return rejected;

  if (request.headers.get('x-motion-update') !== 'confirmed' || !request.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json(
      { supported: false, error: 'Explicit update confirmation is required.' },
      { status: 400 },
    );
  }

  try {
    const body = await request.json() as { confirm?: unknown };
    if (body.confirm !== true) {
      return NextResponse.json(
        { supported: false, error: 'Explicit update confirmation is required.' },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json({ supported: false, error: 'Invalid update request.' }, { status: 400 });
  }

  try {
    const status = await applyLocalUpdate();
    const httpStatus = status.updateAvailable && !status.canUpdate ? 409 : 200;
    return NextResponse.json(status, {
      status: httpStatus,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return failure(error);
  }
}
