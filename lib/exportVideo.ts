export type VideoExportFormat = 'mp4' | 'gif' | 'both' | 'webm';

export interface ExportSettings {
  frameExtension: 'jpg' | 'png';
  pattern: string;
  outputExtension: 'mp4' | 'gif' | 'webm';
  args: string[];
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
