import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Parsing a device GLB is substantially more expensive than fetching it from
// the browser cache. Keep the untouched parsed scene here so the main preview
// and its thumbnail sheet share one request and one parse.
const scenePromises = new Map<string, Promise<THREE.Group>>();
const loader = new GLTFLoader();

export function loadGLBSource(url: string): Promise<THREE.Group> {
  const cached = scenePromises.get(url);
  if (cached) return cached;

  const pending = new Promise<THREE.Group>((resolve, reject) => {
    loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject);
  }).catch((error) => {
    // A transient failure must remain retryable.
    scenePromises.delete(url);
    throw error;
  });

  scenePromises.set(url, pending);
  return pending;
}
