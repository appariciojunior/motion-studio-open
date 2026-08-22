// The renderer contract the app depends on. Both the PixiJS SceneRenderer
// (2D templates) and the Three.js SceneRenderer3D (webgl templates) implement
// this, so PreviewStage / ExportDialog / rendererInstance are engine-agnostic.
export interface IRenderer {
  init(canvas: HTMLCanvasElement): Promise<void>;
  resize(width: number, height: number, resolution?: number): void;
  // Realize the scene state for a frame (no draw).
  getFrameState(frame: number): void;
  // Realize + draw a frame (preview loop and export both use this).
  renderFrame(frame: number): void;
  // Deterministic capture: realize frame, render, and read pixels in the requested format.
  captureFrame(frame: number, mimeType?: 'image/jpeg' | 'image/png'): string;
  // Multiply the backing-store resolution for export capture (logical size
  // unchanged, so template layout is untouched).
  setCaptureScale(k: number): void;
  // The live canvas the scene draws into (WebCodecs export copies frames from it).
  extractCanvas(): HTMLCanvasElement;
  syncAssets(): void;
  // Video cards only: advance decoded video frames to the export time for
  // deterministic capture; resume/pause live playback.
  seekVideos?(frame: number): Promise<void>;
  resumeVideos?(): void;
  pauseVideos?(): void;
  // Called when the preview timeline wraps to frame 0, so 'hold' videos
  // (loop=false, frozen at their end) restart together with the clip.
  restartVideos?(): void;
  // Prepare and release the forward-only video decode pass used by export.
  beginVideoExport?(): Promise<void>;
  endVideoExport?(): void;
  // Set by the preview loop: the renderer calls it when an async texture finishes
  // loading, so an idle (non-playing) preview knows to draw one more frame.
  onDirty?: () => void;
  destroy(): void;
}
