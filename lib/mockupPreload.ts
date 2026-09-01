import { readProjectThreeD } from '@/lib/three3dPersist';
import { asset } from '@/lib/paths';
import { DEVICES } from '@/three3d/devices';
import { loadGLBSource } from '@/three3d/gltfCache';

/** Warm the exact model the next Mockup project will open. */
export function preloadMockupProject(projectId?: string): Promise<void> {
  const saved = projectId ? readProjectThreeD(projectId) : null;
  const url = saved?.models?.mockup?.url ?? DEVICES[0]?.modelUrl;
  if (!url || url.startsWith('blob:')) return Promise.resolve();
  return loadGLBSource(asset(url)).then(() => {}, () => {});
}
