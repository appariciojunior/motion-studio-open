import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const runtime = 'nodejs';
export const maxDuration = 300;

const EXPORTS_DIR = path.join(process.cwd(), 'public', 'exports');

// This route needs two things a serverless deploy does not have: a writable
// filesystem and a native ffmpeg. On Vercel it fails at the first mkdir —
// /var/task is read-only — so no action here has ever completed there. What it
// did do was answer anonymous requests, spend an invocation, write attacker
// bytes into /tmp and report internal paths back in the error body.
//
// So it is off unless a deployment opts in. Local development sets
// ENABLE_EXPORT_API=1 in .env.local; a host that really does have ffmpeg and a
// writable disk sets it too, having read the note in the README about
// authenticating and rate-limiting it first.
const API_ENABLED = process.env.ENABLE_EXPORT_API === '1';

// 404 with an empty body rather than 403: nothing about the disabled route,
// including whether it exists, needs to reach the caller. Next still answers
// 405 for a method this file does not export, so the file's presence is not
// fully hidden — the point is that no action runs and no path leaks.
const notDeployed = () => new NextResponse(null, { status: 404 });

// sessionId/index/fps feed into filesystem paths and ffmpeg filter strings —
// accept only the exact shapes we generate ourselves.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sessionDir(id: string) {
  return path.join(os.tmpdir(), `motion-export-${id}`);
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let stderr = '';
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}

// Build an all-intra (every-frame-keyframe) proxy of an uploaded video. Normal
// H.264 has keyframes seconds apart, so the per-frame seeks the export loop does
// force the browser to re-decode a whole GOP per captured frame — that's why
// exports crawl with video cards. An intra-only proxy makes every seek decode
// exactly one frame. Body: raw video bytes; response: { url } under /exports.
export async function PUT(req: NextRequest) {
  if (!API_ENABLED) return notDeployed();
  try {
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length === 0) return NextResponse.json({ error: 'empty body' }, { status: 400 });
    if (buf.length > 512 * 1024 * 1024) return NextResponse.json({ error: 'too large' }, { status: 413 });
    const contentHash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 24);
    await fs.mkdir(EXPORTS_DIR, { recursive: true });
    const out = `proxy_${contentHash}.mp4`;
    const outPath = path.join(EXPORTS_DIR, out);
    try {
      const existing = await fs.stat(outPath);
      if (existing.size > 0) return NextResponse.json({ url: `/exports/${out}` });
    } catch { /* build and cache it below */ }
    const id = crypto.randomUUID();
    const dir = sessionDir(id);
    await fs.mkdir(dir, { recursive: true });
    const input = path.join(dir, 'proxy-input');
    await fs.writeFile(input, buf);
    // -g 1: intra-only · -an: card videos render muted · veryfast keeps this a
    // few-seconds one-time cost, cached client-side per asset
    await run('ffmpeg', ['-y', '-i', input, '-an', '-c:v', 'libx264', '-preset', 'veryfast',
      '-tune', 'fastdecode', '-g', '1', '-bf', '0', '-sc_threshold', '0',
      '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', outPath]);
    await fs.rm(dir, { recursive: true, force: true });
    return NextResponse.json({ url: `/exports/${out}` });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!API_ENABLED) return notDeployed();
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  const { action } = body;

  try {
    if (action === 'begin') {
      const id = crypto.randomUUID();
      await fs.mkdir(sessionDir(id), { recursive: true });
      return NextResponse.json({ sessionId: id });
    }

    if (action === 'frame') {
      const { sessionId, index, dataUrl } = body;
      const idx = Number(index);
      if (!UUID_RE.test(String(sessionId)) || !Number.isInteger(idx) || idx < 0 || idx > 99999) {
        return NextResponse.json({ error: 'bad params' }, { status: 400 });
      }
      const dir = sessionDir(sessionId);
      const base64 = String(dataUrl).replace(/^data:image\/\w+;base64,/, '');
      const file = path.join(dir, `frame_${String(idx).padStart(5, '0')}.jpg`);
      await fs.writeFile(file, Buffer.from(base64, 'base64'));
      return NextResponse.json({ ok: true });
    }

    if (action === 'encode') {
      const { sessionId, format, audio, width, height } = body;
      const fps = Number(body.fps);
      if (!UUID_RE.test(String(sessionId)) || !Number.isFinite(fps) || fps <= 0 || fps > 120) {
        return NextResponse.json({ error: 'bad params' }, { status: 400 });
      }
      const dir = sessionDir(sessionId);
      const pattern = path.join(dir, 'frame_%05d.jpg');
      await fs.mkdir(EXPORTS_DIR, { recursive: true });

      // Exact output size when the client provides one (already even-rounded);
      // otherwise just force even dimensions, which yuv420p requires.
      const w = Number(width), h = Number(height);
      const sizeFilter =
        Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0
          ? `scale=${w - (w % 2)}:${h - (h % 2)}:flags=lanczos`
          : 'scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos';

      let audioFile: string | null = null;
      if (audio) {
        audioFile = path.join(dir, 'audio.input');
        await fs.writeFile(audioFile, Buffer.from(audio, 'base64'));
      }

      const files: string[] = [];

      if (format === 'mp4' || format === 'both') {
        const out = `motion_${sessionId}.mp4`;
        const outPath = path.join(EXPORTS_DIR, out);
        const args = ['-y', '-start_number', '0', '-framerate', String(fps), '-i', pattern];
        if (audioFile) args.push('-i', audioFile);
        args.push('-vf', sizeFilter);
        // veryfast: 2–4× faster encode than the default 'medium' for a marginal
        // size increase — this path is now the fallback behind WebCodecs anyway.
        args.push('-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-crf', '18');
        if (audioFile) args.push('-c:a', 'aac', '-shortest');
        args.push(outPath);
        await run('ffmpeg', args);
        files.push(out);
      }

      if (format === 'gif' || format === 'both') {
        const palette = path.join(dir, 'palette.png');
        const out = `motion_${sessionId}.gif`;
        const outPath = path.join(EXPORTS_DIR, out);
        await run('ffmpeg', ['-y', '-start_number', '0', '-framerate', String(fps), '-i', pattern,
          '-vf', `fps=${fps},${sizeFilter},palettegen`, palette]);
        await run('ffmpeg', ['-y', '-start_number', '0', '-framerate', String(fps), '-i', pattern, '-i', palette,
          '-filter_complex', `fps=${fps},${sizeFilter} [x]; [x][1:v] paletteuse`, outPath]);
        files.push(out);
      }

      // clean temp frames
      await fs.rm(dir, { recursive: true, force: true });

      return NextResponse.json({ files });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
