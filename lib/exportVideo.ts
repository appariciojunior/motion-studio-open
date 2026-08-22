export type VideoExportFormat = 'mp4' | 'gif' | 'both' | 'webm';

export interface ExportSettings {
  frameExtension: 'jpg' | 'png';
  pattern: string;
  outputExtension: 'mp4' | 'gif' | 'webm';
  args: string[];
}

type CapturableCanvas = { toDataURL: (type?: string, quality?: number) => string };

export function captureCanvasFrame(canvas: CapturableCanvas, mimeType: 'image/jpeg' | 'image/png'): string {
  return mimeType === 'image/png'
    ? canvas.toDataURL(mimeType)
    : canvas.toDataURL(mimeType, 0.92);
}

export function compositeAlpha(baseAlpha: number, layerAlpha: number, opacity: number): number {
  const base = Math.max(0, Math.min(1, baseAlpha));
  const layer = Math.max(0, Math.min(1, layerAlpha * opacity));
  return layer + base * (1 - layer);
}

export function exportSettings(format: VideoExportFormat, fps: number, width: number, height: number): ExportSettings {
  const sizeFilter = `scale=${width - (width % 2)}:${height - (height % 2)}:flags=lanczos`;

  if (format === 'webm') {
    return {
      frameExtension: 'png',
      pattern: 'frame_%05d.png',
      outputExtension: 'webm',
      args: ['-vf', sizeFilter, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-metadata:s:v:0', 'alpha_mode=1'],
    };
  }

  if (format === 'gif') {
    return { frameExtension: 'jpg', pattern: 'frame_%05d.jpg', outputExtension: 'gif', args: ['-vf', `fps=${fps},${sizeFilter}`] };
  }

  return {
    frameExtension: 'jpg',
    pattern: 'frame_%05d.jpg',
    outputExtension: 'mp4',
    args: ['-vf', sizeFilter, '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-crf', '18'],
  };
}

export function webmFfmpegArgs(
  settings: ExportSettings,
  fps: number,
  audioFile: string | null,
  outputPath: string,
): string[] {
  const args = ['-y', '-start_number', '0', '-framerate', String(fps), '-i', settings.pattern];
  if (audioFile) args.push('-i', audioFile);
  args.push(...settings.args);
  if (audioFile) args.push('-c:a', 'libopus', '-shortest');
  args.push(outputPath);
  return args;
}
