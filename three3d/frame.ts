import * as THREE from 'three';

// Scale a loaded model to a target world size and centre it on the origin by
// its bounding-box centre. Deterministic baseline; fine-alignment is left to
// the Model Control Offset X/Y (some assets have an off-centre visual mass).
// Returns half the fitted size (for camera framing).
export function fitAndCenter(model: THREE.Object3D, targetSize: number): number {
  // The bbox must be measured from an untransformed model — a re-fit (e.g.
  // switching devices in Mockup mode) would otherwise compound the previous
  // call's scale/position into the new box, throwing off both fit and centre.
  model.scale.set(1, 1, 1);
  model.position.set(0, 0, 0);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(...box.getSize(new THREE.Vector3()).toArray()) || 1;
  const s = targetSize / maxDim;
  model.scale.setScalar(s);
  model.position.copy(center).multiplyScalar(-s);   // bbox centre → origin
  return targetSize / 2;
}
