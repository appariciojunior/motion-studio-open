// Card geometry and textures for the 3D path — the deformations themselves.
//
// Lifted out of lib/renderer3d so the catalogue thumbnail can build the SAME
// mesh the stage builds. That matters because a fifth of the webgl presets are
// defined by their deformation and not by their pose: measured over the
// catalogue, bend appears in 461 sampled cards, sticker roll in 68, curl and
// corner peel in 6 each. A thumbnail that only reproduces position and rotation
// shows a Sticker as a flat rectangle — the paper simply does not fold, which is
// the whole point of the preset.
//
// Nothing here touches the store or a renderer instance: they are pure builders
// over THREE primitives, which is why they can be shared as-is.
import * as THREE from 'three';
import { clamp } from '@/lib/motion';

// Shared with the Pixi placeholder so a card with no image reads the same.
const PLACEHOLDER_FILL = '#242424';
const PLACEHOLDER_LABEL = '#555555';
// A normalized curved image surface inspired by PMNDRS' public bent-plane
// example. UVs are untouched, so the same crop is used on a flat or bent card.
// `sag` is the centre displacement as a fraction of the card width.
export function makeBentPlaneGeometry(sag: number): THREE.PlaneGeometry {
  const bend = clamp(sag, -0.45, 0.45);
  const geometry = new THREE.PlaneGeometry(1, 1, 20, 8);
  if (Math.abs(bend) < 0.0001) return geometry;
  const halfWidth = 0.5;
  const a = new THREE.Vector2(-halfWidth, 0);
  const b = new THREE.Vector2(0, bend);
  const c = new THREE.Vector2(halfWidth, 0);
  const ab = new THREE.Vector2().subVectors(a, b);
  const bc = new THREE.Vector2().subVectors(b, c);
  const ac = new THREE.Vector2().subVectors(a, c);
  const radius = (ab.length() * bc.length() * ac.length()) / (2 * Math.abs(ab.cross(ac)));
  const centre = new THREE.Vector2(0, bend - Math.sign(bend) * radius);
  // The arc from c to a around the centre, taken the SHORT way. This used to be
  // `(a - centre).angle() * 2 - PI`, which relies on the centre sitting BELOW
  // the chord and so only held for a positive bend. Vector2.angle() returns
  // [0, 2*PI), so a negative bend — centre above the chord — picked the reflex
  // angle and swept the card nearly all the way round its own circle: at
  // bend -0.04 the centre vertex landed 6.25 units out instead of 0.04, about
  // 150x too far. Measuring the signed difference works for either side.
  const angleA = new THREE.Vector2().subVectors(a, centre).angle();
  const angleC = new THREE.Vector2().subVectors(c, centre).angle();
  let arc = angleA - angleC;
  if (arc > Math.PI) arc -= Math.PI * 2;
  if (arc < -Math.PI) arc += Math.PI * 2;
  const uv = geometry.attributes.uv;
  const position = geometry.attributes.position;
  const point = new THREE.Vector2();
  for (let i = 0; i < uv.count; i++) {
    const ratio = 1 - uv.getX(i);
    const y = position.getY(i);
    point.copy(c).rotateAround(centre, arc * ratio);
    position.setXYZ(i, point.x, y, -point.y);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

// Cylindrical page roll anchored at the right edge. Unlike `bend`, which is a
// shallow symmetric bow, curl can turn far enough to expose the back face.
export function makeCurlPlaneGeometry(angle: number): THREE.PlaneGeometry {
  const curl = clamp(angle, -Math.PI * 2.4, Math.PI * 2.4);
  const geometry = new THREE.PlaneGeometry(1, 1, 32, 8);
  if (Math.abs(curl) < 0.001) return geometry;
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < position.count; i++) {
    const u = 1 - uv.getX(i); // right edge anchored, left edge free
    const a = u * curl;
    position.setX(i, 0.5 - Math.sin(a) / curl);
    position.setZ(i, (1 - Math.cos(a)) / curl);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

// Continuous cylindrical sticker roll. This is deliberately a different
// primitive from the page/corner peel below: vinyl does not lift as a rigid
// triangular flap. Once a point crosses `front`, it travels around a cylinder;
// after half a turn it continues behind the attached face at a constant depth.
export function makeStickerRollGeometry(
  front: number,
  radius: number,
  directionDeg: number,
): THREE.PlaneGeometry {
  // 32×32 is already sub-pixel smooth at the editor's card sizes and keeps
  // animated geometry caching bounded enough for Sticker 01's 36-second loop.
  const geometry = new THREE.PlaneGeometry(1, 1, 32, 32);
  const position = geometry.attributes.position;
  const direction = directionDeg * Math.PI / 180;
  const dx = Math.cos(direction);
  const dy = Math.sin(direction);
  const nx = -dy;
  const ny = dx;
  const safeRadius = Math.max(0.0001, radius);

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    let along = x * dx + y * dy;
    const across = x * nx + y * ny;
    let z = 0;
    const loose = along - front;

    if (loose > 0) {
      const theta = loose / safeRadius;
      if (theta <= Math.PI) {
        along = front + safeRadius * Math.sin(theta);
        z = safeRadius * (1 - Math.cos(theta));
      } else {
        along = front - (loose - Math.PI * safeRadius);
        z = 2 * safeRadius;
      }
    }

    position.setXYZ(i, dx * along + nx * across, dy * along + ny * across, z);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

// Directional page peel. The moving fold begins at the edge/corner selected by
// the direction vector and travels through the sheet to the opposite side.
// Cardinal directions become straight page flips; diagonals become corner
// peels. These are the two silhouettes used across Poster 01-06.
const CORNER_PEEL_SEGMENTS = 32;

export function makeCornerPeelGeometry(
  progress: number,
  angle: number,
  curl: number,
  directionDeg: number,
  softness = 0,
): THREE.BufferGeometry {
  const p = clamp(progress, 0, 1);
  if (p < 0.0001) return new THREE.PlaneGeometry(1, 1, 1, 1);
  const raw = ((directionDeg % 360) + 360) % 360;
  const radians = raw * Math.PI / 180;
  const nx = Math.cos(radians), ny = Math.sin(radians);
  const tx = -ny, ty = nx;
  const edgeN = 0.5 * (Math.abs(nx) + Math.abs(ny));
  const foldDistance = p * edgeN * 2;
  const foldN = edgeN - foldDistance;
  // Soft diagonal sticker peels grow from the chosen CORNER as a circular
  // patch. Pages keep the straight travelling fold below. A circular boundary
  // is what removes the cut-paper triangle from the image while leaving
  // cardinal edge peels predictable.
  const roundedCorner = softness > 0.5 && Math.abs(nx) > 0.35 && Math.abs(ny) > 0.35;
  const cornerX = nx >= 0 ? 0.5 : -0.5;
  const cornerY = ny >= 0 ? 0.5 : -0.5;
  const peelRadius = Math.max(0.001, Math.min(Math.SQRT2, p * 1.75));

  type PeelVertex = { x: number; y: number; u: number; v: number };
  const positions: number[] = [];
  const uvs: number[] = [];
  const signedDistance = (vertex: PeelVertex) => roundedCorner
    ? peelRadius - Math.hypot(vertex.x - cornerX, vertex.y - cornerY)
    : vertex.x * nx + vertex.y * ny - foldN;
  const intersection = (a: PeelVertex, b: PeelVertex): PeelVertex => {
    const da = signedDistance(a), db = signedDistance(b);
    const t = da / (da - db);
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      u: a.u + (b.u - a.u) * t,
      v: a.v + (b.v - a.v) * t,
    };
  };
  const clipTriangle = (triangle: PeelVertex[], folded: boolean) => {
    const result: PeelVertex[] = [];
    for (let i = 0; i < triangle.length; i++) {
      const a = triangle[i];
      const b = triangle[(i + 1) % triangle.length];
      const aInside = folded ? signedDistance(a) >= -1e-7 : signedDistance(a) <= 1e-7;
      const bInside = folded ? signedDistance(b) >= -1e-7 : signedDistance(b) <= 1e-7;
      if (aInside) result.push(a);
      if (aInside !== bInside) result.push(intersection(a, b));
    }
    return result;
  };
  const emitVertex = (vertex: PeelVertex, folded: boolean) => {
    let x = vertex.x, y = vertex.y, z = 0;
    if (folded) {
      const normal = x * nx + y * ny;
      const tangent = x * tx + y * ty;
      const distanceBehindFold = Math.max(0, signedDistance(vertex));
      const activeDistance = roundedCorner ? peelRadius : foldDistance;
      const across = clamp(distanceBehindFold / Math.max(0.001, activeDistance), 0, 1);
      // A poster/page wants a crisp moving crease. Stickers use a soft peel:
      // the angle grows continuously from zero at the attached edge to the
      // authored Peel value at the loose corner, avoiding a rigid triangular
      // flap while keeping both profiles on the same directional geometry.
      const firstEase = across * across * (3 - 2 * across);
      // A second smoothstep keeps more of the sticker attached and gathers
      // the curvature near the loose corner. This reads as flexible vinyl
      // instead of a triangular sheet rotating around one straight hinge.
      const ramp = firstEase * firstEase * (3 - 2 * firstEase);
      const localAngle = angle * ((1 - softness) + softness * ramp)
        + curl * Math.sin(across * Math.PI);
      if (roundedCorner) {
        // Vinyl bends through a short radius rather than reflecting the full
        // triangular corner. The loose tip moves inward and upward, while the
        // circular attachment boundary stays exactly in place.
        const bendDistance = distanceBehindFold * 0.36;
        const inward = bendDistance * (1 - Math.cos(localAngle));
        x -= inward * nx;
        y -= inward * ny;
        z = bendDistance * Math.sin(localAngle);
      } else {
        const foldedN = foldN + distanceBehindFold * Math.cos(localAngle);
        x = foldedN * nx + tangent * tx;
        y = foldedN * ny + tangent * ty;
        z = distanceBehindFold * Math.sin(localAngle);
      }
    }
    positions.push(x, y, z);
    uvs.push(vertex.u, vertex.v);
  };
  const emitPolygon = (polygon: PeelVertex[], folded: boolean) => {
    for (let i = 1; i + 1 < polygon.length; i++) {
      emitVertex(polygon[0], folded);
      emitVertex(polygon[i], folded);
      emitVertex(polygon[i + 1], folded);
    }
  };
  const makeVertex = (x: number, y: number): PeelVertex => ({ x, y, u: x + 0.5, v: y + 0.5 });
  const step = 1 / CORNER_PEEL_SEGMENTS;
  for (let row = 0; row < CORNER_PEEL_SEGMENTS; row++) {
    const y0 = -0.5 + row * step, y1 = y0 + step;
    for (let col = 0; col < CORNER_PEEL_SEGMENTS; col++) {
      const x0 = -0.5 + col * step, x1 = x0 + step;
      const triangles = [
        [makeVertex(x0, y0), makeVertex(x1, y0), makeVertex(x1, y1)],
        [makeVertex(x0, y0), makeVertex(x1, y1), makeVertex(x0, y1)],
      ];
      for (const triangle of triangles) {
        emitPolygon(clipTriangle(triangle, false), false);
        emitPolygon(clipTriangle(triangle, true), true);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}


// Rounded-rectangle alpha mask (white on black) for cornerRadius; cached by
// (fraction, aspect) so corners stay circular on non-square cards.
export function makeCornerAlphaMap(fracR: number, aspect: number): THREE.CanvasTexture {
  const W = 512;
  const H = Math.max(2, Math.round(W / aspect));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff';
  const r = (Math.min(W, H) / 2) * fracR;
  g.beginPath();
  g.roundRect(0, 0, W, H, r);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

// 2-stop vertical gradient texture for the scene backdrop.
export function makeGradientTexture(c1: string, c2: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 512;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Numbered placeholder card as a CanvasTexture (mirrors the Pixi placeholder).
export function makePlaceholderTexture(label: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 480; c.height = 600;
  const g = c.getContext('2d')!;
  g.fillStyle = PLACEHOLDER_FILL;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = PLACEHOLDER_LABEL;
  g.font = '600 130px Inter, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
