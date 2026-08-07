import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ── 3D Mockup Animation Engine (Arqé-inspired Multi-Keyframe System) ─────────
// A production-grade animation engine for 3D Device Mockups and PBR scenes.
// Recreates the timeline, pose interpolation, Bezier easing curves, and camera
// choreography of Arqé's 3D Mockup Studio (app.arqe.ai/mockups).
//
// Each animation preset is defined as a sequence of MockupKeyframes across a
// normalized 0.0 – 1.0 timeline. The solver evaluates Bezier curves and
// interpolates camera spherical coordinates (orbit, elevation, distance, FOV),
// model transforms (pitch, yaw, roll, position), studio lighting choreography,
// and hardware articulation (e.g., MacBook laptop lid opening/closing).

// ── 1. Pose & Keyframe Data Structures ───────────────────────────────────────

export interface MockupPose {
  // Camera Rig
  camDistance: number;       // radial distance multiplier (1.0 = default fit distance)
  camOrbit: number;          // horizontal azimuth angle offset (degrees)
  camElevation: number;      // vertical pitch angle offset (degrees)
  camRoll: number;           // camera bank / Z-roll angle (degrees)
  fov: number;               // camera vertical field of view (degrees)
  targetX: number;           // camera lookAt target X (world units)
  targetY: number;           // camera lookAt target Y
  targetZ: number;           // camera lookAt target Z
  // Device Model Transform
  tiltX: number;             // model pitch around X-axis (degrees)
  tiltY: number;             // model yaw around Y-axis (degrees)
  tiltZ: number;             // model roll around Z-axis (degrees)
  posX: number;              // model world position X
  posY: number;              // model world position Y
  posZ: number;              // model world position Z
  scale: number;             // model scale multiplier
  // Studio Lighting Choreography
  lightRot: number;          // keylight azimuth rotation (degrees)
  lightHeight: number;       // keylight elevation (degrees)
  lightBright: number;       // keylight intensity multiplier (0.0 .. 2.0)
  lightFill: number;         // filllight intensity multiplier (0.0 .. 2.0)
  lightWarm: number;         // color temperature warmness factor (-1.0 .. 1.0)
  // Environment Reflection
  envRotation: number;       // HDRI environment map rotation (degrees)
  envTilt: number;           // HDRI tilt offset (degrees)
  // Hardware Articulation
  lidAngle: number;          // laptop lid opening angle (0° = closed, 115° = open)
}

export type EasingPreset =
  | 'linear'
  | 'easeInOutCubic'
  | 'easeOutExpo'
  | 'easeInOutQuint'
  | 'easeInOutQuad'
  | 'smoothstep'
  | 'spring'
  | 'bounce';

export interface CubicBezierCurve {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface MockupKeyframe {
  time: number;              // normalized timestamp (0.0 to 1.0)
  pose: Partial<MockupPose>;
  easing?: EasingPreset | CubicBezierCurve;
}

export interface MockupAnimationPreset {
  key: string;
  label: string;
  description: string;
  icon: string;
  badge?: string;
  category: 'studio' | 'turntable' | 'cinematic' | 'product' | 'dynamic';
  durationRatio: number;     // recommended relative speed factor
  keyframes: MockupKeyframe[];
}

export interface MockupLightingState {
  keyLightIntensity: number;
  keyLightAzimuth: number;
  keyLightElevation: number;
  fillLightIntensity: number;
  envRotation: number;
  lidAngle: number;
}

// ── 2. Default Pose Reference ────────────────────────────────────────────────

export const DEFAULT_MOCKUP_POSE: MockupPose = {
  camDistance: 1.0,
  camOrbit: 0,
  camElevation: 0,
  camRoll: 0,
  fov: 42,
  targetX: 0,
  targetY: 0,
  targetZ: 0,
  tiltX: 0,
  tiltY: 0,
  tiltZ: 0,
  posX: 0,
  posY: 0,
  posZ: 0,
  scale: 1.0,
  lightRot: 45,
  lightHeight: 45,
  lightBright: 1.0,
  lightFill: 1.0,
  lightWarm: 0.0,
  envRotation: 0,
  envTilt: 0,
  lidAngle: 112,
};

// ── 3. Bezier & Spring Easing Engine ─────────────────────────────────────────

/**
 * Evaluates a cubic-bezier curve B(t) given control points (x1, y1) and (x2, y2).
 * Uses Newton-Raphson iteration for rapid convergence on the temporal axis.
 */
function solveCubicBezier(p: number, x1: number, y1: number, x2: number, y2: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  if (x1 === y1 && x2 === y2) return p;

  const sampleCurveX = (t: number) =>
    ((1 - 3 * x2 + 3 * x1) * t + (3 * x2 - 6 * x1)) * t * t + 3 * x1 * t;
  const sampleCurveY = (t: number) =>
    ((1 - 3 * y2 + 3 * y1) * t + (3 * y2 - 6 * y1)) * t * t + 3 * y1 * t;
  const sampleDerivX = (t: number) =>
    3 * ((1 - 3 * x2 + 3 * x1) * t * t + 2 * (3 * x2 - 6 * x1) * t + x1);

  let t = p;
  for (let i = 0; i < 8; i++) {
    const x = sampleCurveX(t) - p;
    if (Math.abs(x) < 1e-6) break;
    const d = sampleDerivX(t);
    if (Math.abs(d) < 1e-6) break;
    t -= x / d;
  }
  return sampleCurveY(t);
}

/**
 * Evaluates standard animation easing presets or custom cubic-bezier curves.
 */
export function evaluateEasing(t: number, easing?: EasingPreset | CubicBezierCurve): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (!easing || easing === 'linear') return t;

  if (typeof easing === 'object') {
    return solveCubicBezier(t, easing.x1, easing.y1, easing.x2, easing.y2);
  }

  switch (easing) {
    case 'easeInOutCubic':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'easeOutExpo':
      return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    case 'easeInOutQuint':
      return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
    case 'easeInOutQuad':
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case 'smoothstep':
      return t * t * (3 - 2 * t);
    case 'spring': {
      // Damped harmonic oscillation for subtle keynote settle
      const decay = Math.exp(-5 * t);
      const osc = Math.cos(12 * t * Math.PI);
      return 1 - decay * osc;
    }
    case 'bounce': {
      const n1 = 7.5625;
      const d1 = 2.75;
      if (t < 1 / d1) return n1 * t * t;
      if (t < 2 / d1) {
        const t1 = t - 1.5 / d1;
        return n1 * t1 * t1 + 0.75;
      }
      if (t < 2.5 / d1) {
        const t1 = t - 2.25 / d1;
        return n1 * t1 * t1 + 0.9375;
      }
      const t1 = t - 2.625 / d1;
      return n1 * t1 * t1 + 0.984375;
    }
    default:
      return t;
  }
}

// ── 4. Keyframe Timeline Evaluator ───────────────────────────────────────────

/**
 * Interpolates two MockupPoses linearly or angularly for a given factor t.
 */
function interpolatePose(poseA: MockupPose, poseB: MockupPose, t: number): MockupPose {
  const lerp = (a: number, b: number, factor: number) => a + (b - a) * factor;

  return {
    camDistance: lerp(poseA.camDistance, poseB.camDistance, t),
    camOrbit: lerp(poseA.camOrbit, poseB.camOrbit, t),
    camElevation: lerp(poseA.camElevation, poseB.camElevation, t),
    camRoll: lerp(poseA.camRoll, poseB.camRoll, t),
    fov: lerp(poseA.fov, poseB.fov, t),
    targetX: lerp(poseA.targetX, poseB.targetX, t),
    targetY: lerp(poseA.targetY, poseB.targetY, t),
    targetZ: lerp(poseA.targetZ, poseB.targetZ, t),
    tiltX: lerp(poseA.tiltX, poseB.tiltX, t),
    tiltY: lerp(poseA.tiltY, poseB.tiltY, t),
    tiltZ: lerp(poseA.tiltZ, poseB.tiltZ, t),
    posX: lerp(poseA.posX, poseB.posX, t),
    posY: lerp(poseA.posY, poseB.posY, t),
    posZ: lerp(poseA.posZ, poseB.posZ, t),
    scale: lerp(poseA.scale, poseB.scale, t),
    lightRot: lerp(poseA.lightRot, poseB.lightRot, t),
    lightHeight: lerp(poseA.lightHeight, poseB.lightHeight, t),
    lightBright: lerp(poseA.lightBright, poseB.lightBright, t),
    lightFill: lerp(poseA.lightFill, poseB.lightFill, t),
    lightWarm: lerp(poseA.lightWarm, poseB.lightWarm, t),
    envRotation: lerp(poseA.envRotation, poseB.envRotation, t),
    envTilt: lerp(poseA.envTilt, poseB.envTilt, t),
    lidAngle: lerp(poseA.lidAngle, poseB.lidAngle, t),
  };
}

/**
 * Evaluates a sequence of keyframes at a normalized progress timestamp (0..1).
 */
export function evaluateTimeline(
  keyframes: MockupKeyframe[],
  progress: number,
  basePose: MockupPose = DEFAULT_MOCKUP_POSE
): MockupPose {
  if (!keyframes || keyframes.length === 0) return basePose;
  if (keyframes.length === 1) {
    return { ...basePose, ...keyframes[0].pose };
  }

  // Normalize progress loop (0.0 to 1.0)
  const p = ((progress % 1) + 1) % 1;

  // Ensure keyframes are sorted chronologically
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);

  // Find surrounding keyframes [kfA, kfB]
  let idx = 0;
  while (idx < sorted.length - 1 && sorted[idx + 1].time <= p) {
    idx++;
  }

  const kfA = sorted[idx];
  const kfB = sorted[Math.min(idx + 1, sorted.length - 1)];

  if (kfA === kfB || kfA.time === kfB.time) {
    return { ...basePose, ...kfA.pose };
  }

  // Local progress inside the keyframe span [kfA.time .. kfB.time]
  const rawT = (p - kfA.time) / (kfB.time - kfA.time);
  const easedT = evaluateEasing(rawT, kfB.easing ?? 'easeInOutCubic');

  const fullPoseA: MockupPose = { ...basePose, ...kfA.pose };
  const fullPoseB: MockupPose = { ...basePose, ...kfB.pose };

  return interpolatePose(fullPoseA, fullPoseB, easedT);
}

// ── 5. 16 Comprehensive 3D Mockup Animation Presets ──────────────────────────

export const MOCKUP_ANIMATIONS: MockupAnimationPreset[] = [
  // 1. Studio Still (Classic Pro)
  {
    key: 'static',
    label: 'Studio Still',
    description: 'Classic 3/4 professional product studio shot. Mouse orbit controls active.',
    category: 'studio',
    durationRatio: 1.0,
    icon: 'M2 12h12M4 8h8M6 4h4',
    keyframes: [
      { time: 0.0, pose: { camDistance: 1.0, camOrbit: 0, camElevation: 0, lightRot: 45, lightBright: 1.0 } },
      { time: 1.0, pose: { camDistance: 1.0, camOrbit: 0, camElevation: 0, lightRot: 45, lightBright: 1.0 } },
    ],
  },

  // 2. Turntable 360° (Continuous Studio Spin)
  {
    key: 'orbit360',
    label: 'Orbit 360°',
    description: 'Smooth 360-degree turntable rotation with synchronized specular highlight shimmer.',
    category: 'turntable',
    badge: 'POPULAR',
    durationRatio: 1.0,
    icon: 'M13.5 8A5.5 5.5 0 1 1 8 2.5a5.5 5.5 0 0 1 5.5 5.5z M13.5 5v3h-3',
    keyframes: [
      { time: 0.0, pose: { camOrbit: 0, camElevation: 0, lightRot: 45, envRotation: 0 }, easing: 'linear' },
      { time: 0.25, pose: { camOrbit: 90, camElevation: 4, lightRot: -45, envRotation: 90 }, easing: 'linear' },
      { time: 0.5, pose: { camOrbit: 180, camElevation: 0, lightRot: -135, envRotation: 180 }, easing: 'linear' },
      { time: 0.75, pose: { camOrbit: 270, camElevation: -2, lightRot: -225, envRotation: 270 }, easing: 'linear' },
      { time: 1.0, pose: { camOrbit: 360, camElevation: 0, lightRot: -315, envRotation: 360 }, easing: 'linear' },
    ],
  },

  // 3. Showcase Arc 180° (Profile to Profile)
  {
    key: 'orbit180_return',
    label: 'Showcase Arc 180°',
    description: 'Cinematic 180° sweep highlighting left and right hardware side profiles.',
    category: 'turntable',
    durationRatio: 1.2,
    icon: 'M3 8a5 5 0 0 1 10 0 M13 6v2h-2',
    keyframes: [
      { time: 0.0, pose: { camOrbit: -45, camElevation: 0, lightRot: 60 }, easing: 'easeInOutCubic' },
      { time: 0.5, pose: { camOrbit: 45, camElevation: 8, lightRot: -30 }, easing: 'easeInOutCubic' },
      { time: 1.0, pose: { camOrbit: -45, camElevation: 0, lightRot: 60 }, easing: 'easeInOutCubic' },
    ],
  },

  // 4. Apple Keynote Reveal (High Altitude Crane to Hero Shot)
  {
    key: 'hero_reveal',
    label: 'Hero Reveal',
    description: 'Dramatic keynote-style overhead crane down into a bold front-facing hero shot.',
    category: 'cinematic',
    badge: 'KEYNOTE',
    durationRatio: 0.9,
    icon: 'M2 14l5-5m0 0h-4m4 0v4 M14 2l-5 5m0 0h4m-4 0v-4',
    keyframes: [
      {
        time: 0.0,
        pose: { camDistance: 1.7, camOrbit: -25, camElevation: 54, fov: 32, tiltX: 18, lightRot: 80, lightBright: 0.5 },
        easing: 'easeOutExpo',
      },
      {
        time: 0.5,
        pose: { camDistance: 0.95, camOrbit: 0, camElevation: 2, fov: 42, tiltX: 0, lightRot: 35, lightBright: 1.2 },
        easing: 'easeInOutCubic',
      },
      {
        time: 1.0,
        pose: { camDistance: 1.7, camOrbit: -25, camElevation: 54, fov: 32, tiltX: 18, lightRot: 80, lightBright: 0.5 },
        easing: 'easeInOutCubic',
      },
    ],
  },

  // 5. Cinematic Dolly Reveal (Dynamic FOV Compression)
  {
    key: 'hero_reveal_dolly',
    label: 'Dolly Reveal',
    description: 'Cinematic dolly-in combined with dynamic FOV compression for high-end product ads.',
    category: 'cinematic',
    durationRatio: 1.0,
    icon: 'M8 2v12M4 6l4-4 4 4 M4 10l4 4 4-4',
    keyframes: [
      {
        time: 0.0,
        pose: { camDistance: 1.8, camOrbit: 15, camElevation: 26, fov: 24, lightBright: 0.8 },
        easing: 'easeInOutQuint',
      },
      {
        time: 0.5,
        pose: { camDistance: 0.82, camOrbit: 0, camElevation: 0, fov: 52, lightBright: 1.35 },
        easing: 'easeInOutCubic',
      },
      {
        time: 1.0,
        pose: { camDistance: 1.8, camOrbit: 15, camElevation: 26, fov: 24, lightBright: 0.8 },
        easing: 'easeInOutQuint',
      },
    ],
  },

  // 6. Zero-Gravity Levitation (Organic Bobbing & Roll)
  {
    key: 'float_hover',
    label: 'Float & Hover',
    description: 'Zero-gravity levitation loop with smooth pitch, yaw, and vertical bobbing.',
    category: 'dynamic',
    badge: 'SMOOTH',
    durationRatio: 1.0,
    icon: 'M3 10c0-3.5 2.5-6 5-6s5 2.5 5 6 M6 13h4',
    keyframes: [
      { time: 0.0, pose: { posY: 0.0, tiltX: -4, tiltY: -8, tiltZ: -2, camElevation: 0 }, easing: 'easeInOutCubic' },
      { time: 0.25, pose: { posY: 0.16, tiltX: 2, tiltY: 5, tiltZ: 1.5, camElevation: 4 }, easing: 'easeInOutCubic' },
      { time: 0.5, pose: { posY: 0.03, tiltX: 5, tiltY: 10, tiltZ: 3, camElevation: -2 }, easing: 'easeInOutCubic' },
      { time: 0.75, pose: { posY: -0.12, tiltX: -1, tiltY: -3, tiltZ: -1.5, camElevation: 2 }, easing: 'easeInOutCubic' },
      { time: 1.0, pose: { posY: 0.0, tiltX: -4, tiltY: -8, tiltZ: -2, camElevation: 0 }, easing: 'easeInOutCubic' },
    ],
  },

  // 7. Floating Turntable (Levitating 360° Spin)
  {
    key: 'float_rotate',
    label: 'Floating Spin',
    description: 'Levitating vertical bobbing combined with an effortless 360° turntable spin.',
    category: 'dynamic',
    durationRatio: 1.0,
    icon: 'M8 3v10M5 6l3-3 3 3',
    keyframes: [
      { time: 0.0, pose: { posY: -0.1, camOrbit: 0, tiltX: -3 }, easing: 'linear' },
      { time: 0.25, pose: { posY: 0.15, camOrbit: 90, tiltX: 3 }, easing: 'linear' },
      { time: 0.5, pose: { posY: -0.05, camOrbit: 180, tiltX: -2 }, easing: 'linear' },
      { time: 0.75, pose: { posY: 0.18, camOrbit: 270, tiltX: 4 }, easing: 'linear' },
      { time: 1.0, pose: { posY: -0.1, camOrbit: 360, tiltX: -3 }, easing: 'linear' },
    ],
  },

  // 8. Showcase Sweep (Edge & Display Inspection)
  {
    key: 'showcase_sweep',
    label: 'Showcase Sweep',
    description: 'Side-to-side sweeping pan inspecting hardware edges, ports, and front screen.',
    category: 'product',
    durationRatio: 1.1,
    icon: 'M2 8h12M10 4l4 4-4 4',
    keyframes: [
      { time: 0.0, pose: { camOrbit: -38, camElevation: 0, tiltX: -4, lightRot: 65 }, easing: 'easeInOutCubic' },
      { time: 0.35, pose: { camOrbit: 8, camElevation: 8, tiltX: 2, lightRot: 15 }, easing: 'easeInOutCubic' },
      { time: 0.7, pose: { camOrbit: 36, camElevation: 2, tiltX: -2, lightRot: -45 }, easing: 'easeInOutCubic' },
      { time: 1.0, pose: { camOrbit: -38, camElevation: 0, tiltX: -4, lightRot: 65 }, easing: 'easeInOutCubic' },
    ],
  },

  // 9. Back-to-Front Reveal (Fast Case Flip)
  {
    key: 'screen_flip_180',
    label: 'Screen Flip',
    description: 'Rapid 180° spin from back camera housing to front display reveal.',
    category: 'product',
    badge: 'REVEAL',
    durationRatio: 1.0,
    icon: 'M4 4h8v8H4z M12 8h2a2 2 0 0 1 2 2v2',
    keyframes: [
      { time: 0.0, pose: { tiltY: 180, camElevation: 8, lightBright: 0.7 }, easing: 'easeInOutQuint' },
      { time: 0.45, pose: { tiltY: 0, camElevation: 0, lightBright: 1.25 }, easing: 'easeInOutQuad' },
      { time: 0.75, pose: { tiltY: 0, camElevation: 0, lightBright: 1.25 }, easing: 'easeInOutCubic' },
      { time: 1.0, pose: { tiltY: 180, camElevation: 8, lightBright: 0.7 }, easing: 'easeInOutQuint' },
    ],
  },

  // 10. Vertigo Dolly Zoom (Hitchcock Background Expansion)
  {
    key: 'dolly_zoom_vertigo',
    label: 'Dolly Zoom',
    description: 'Hitchcock-style Dolly Zoom: device size remains steady while background expands.',
    category: 'cinematic',
    durationRatio: 1.0,
    icon: 'M4 8h8M8 4v8',
    keyframes: [
      { time: 0.0, pose: { camDistance: 1.5, fov: 26, camElevation: 4 }, easing: 'easeInOutCubic' },
      { time: 0.5, pose: { camDistance: 0.75, fov: 58, camElevation: 0 }, easing: 'easeInOutCubic' },
      { time: 1.0, pose: { camDistance: 1.5, fov: 26, camElevation: 4 }, easing: 'easeInOutCubic' },
    ],
  },

  // 11. Diagonal Dynamic Dolly (Corner-to-Corner Glide)
  {
    key: 'dolly_pan_diagonal',
    label: 'Diagonal Glide',
    description: 'Dynamic low-angle diagonal camera glide across the product display.',
    category: 'cinematic',
    durationRatio: 1.0,
    icon: 'M3 13L13 3M13 3H8M13 3v5',
    keyframes: [
      { time: 0.0, pose: { camOrbit: -32, camElevation: -4, camDistance: 1.2, tiltZ: -3 }, easing: 'easeInOutCubic' },
      { time: 0.5, pose: { camOrbit: 28, camElevation: 14, camDistance: 0.88, tiltZ: 3 }, easing: 'easeInOutCubic' },
      { time: 1.0, pose: { camOrbit: -32, camElevation: -4, camDistance: 1.2, tiltZ: -3 }, easing: 'easeInOutCubic' },
    ],
  },

  // 12. MacBook Lid Opening (Hardware Articulation)
  {
    key: 'laptop_lid_open',
    label: 'Lid Reveal',
    description: 'Smooth hardware articulation opening a laptop lid from closed (0°) to open (115°).',
    category: 'product',
    badge: 'HARDWARE',
    durationRatio: 1.0,
    icon: 'M2 13h12M4 11V6l4-2v7',
    keyframes: [
      { time: 0.0, pose: { lidAngle: 0, camElevation: 20, camDistance: 1.15, lightBright: 0.6 }, easing: 'easeOutExpo' },
      { time: 0.45, pose: { lidAngle: 115, camElevation: 2, camDistance: 0.92, lightBright: 1.3 }, easing: 'easeInOutCubic' },
      { time: 0.78, pose: { lidAngle: 115, camElevation: 2, camDistance: 0.92, lightBright: 1.3 }, easing: 'easeInOutCubic' },
      { time: 1.0, pose: { lidAngle: 0, camElevation: 20, camDistance: 1.15, lightBright: 0.6 }, easing: 'easeInOutCubic' },
    ],
  },

  // 13. Studio Floor Glide Left-to-Right
  {
    key: 'studio_glide_left',
    label: 'Floor Glide L→R',
    description: 'Smooth lateral tracking across the studio shadow-catcher ground plane.',
    category: 'studio',
    durationRatio: 1.0,
    icon: 'M3 8h10M10 5l3 3-3 3',
    keyframes: [
      { time: 0.0, pose: { posX: -1.2, camOrbit: -15, camElevation: 0 }, easing: 'easeInOutCubic' },
      { time: 0.5, pose: { posX: 1.2, camOrbit: 15, camElevation: 6 }, easing: 'easeInOutCubic' },
      { time: 1.0, pose: { posX: -1.2, camOrbit: -15, camElevation: 0 }, easing: 'easeInOutCubic' },
    ],
  },

  // 14. Studio Floor Glide Right-to-Left
  {
    key: 'studio_glide_right',
    label: 'Floor Glide R→L',
    description: 'Symmetric right-to-left lateral camera tracking over the studio floor.',
    category: 'studio',
    durationRatio: 1.0,
    icon: 'M13 8H3M6 5L3 8l3 3',
    keyframes: [
      { time: 0.0, pose: { posX: 1.2, camOrbit: 15, camElevation: 0 }, easing: 'easeInOutCubic' },
      { time: 0.5, pose: { posX: -1.2, camOrbit: -15, camElevation: 6 }, easing: 'easeInOutCubic' },
      { time: 1.0, pose: { posX: 1.2, camOrbit: 15, camElevation: 0 }, easing: 'easeInOutCubic' },
    ],
  },

  // 15. Crane Down (Bird's Eye to Eye Level)
  {
    key: 'topdown_crane_down',
    label: 'Crane Down',
    description: 'Architectural bird’s-eye overhead shot lowering smoothly to eye level.',
    category: 'cinematic',
    durationRatio: 1.0,
    icon: 'M8 2v10M5 9l3 3 3-3',
    keyframes: [
      { time: 0.0, pose: { camElevation: 72, camDistance: 1.65, camOrbit: -45, fov: 36 }, easing: 'easeOutExpo' },
      { time: 0.5, pose: { camElevation: 0, camDistance: 0.98, camOrbit: 0, fov: 42 }, easing: 'easeInOutCubic' },
      { time: 1.0, pose: { camElevation: 72, camDistance: 1.65, camOrbit: -45, fov: 36 }, easing: 'easeInOutCubic' },
    ],
  },

  // 16. Isometric Studio Loop
  {
    key: 'isometric_pulse',
    label: 'Isometric Loop',
    description: 'Clean isometric 30° elevation angle with rhythmic depth focus.',
    category: 'studio',
    durationRatio: 1.0,
    icon: 'M2 6l6-4 6 4v5l-6 4-6-4z',
    keyframes: [
      { time: 0.0, pose: { camOrbit: 45, camElevation: 22, camDistance: 1.35, scale: 0.96 }, easing: 'easeInOutCubic' },
      { time: 0.5, pose: { camOrbit: 45, camElevation: 24, camDistance: 1.15, scale: 1.04 }, easing: 'easeInOutCubic' },
      { time: 1.0, pose: { camOrbit: 45, camElevation: 22, camDistance: 1.35, scale: 0.96 }, easing: 'easeInOutCubic' },
    ],
  },
];

// ── 6. Main 3D Animation Solver & Controller Bridge ──────────────────────────

/**
 * Solves and applies the 3D Mockup pose for any animation preset at `progress`.
 * Updates camera position, lookAt target, FOV, model pivot transforms,
 * laptop lid hardware articulation, and returns dynamic lighting overrides.
 */
export function apply3DAnimation(
  animKey: string,
  progress: number,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  pivot: THREE.Group,
  initCam: THREE.Vector3,
  initTarget: THREE.Vector3,
  initAzimuth: number,
  initElevation: number,
  modelHalf: number,
  userRotX: number = 0,
  userRotY: number = 0,
  userOffsetX: number = 0,
  userOffsetY: number = 0,
  userScale: number = 1.0
): MockupLightingState {
  const preset = MOCKUP_ANIMATIONS.find((a) => a.key === animKey);

  // If preset is 'static' or not found, let user orbit freely with mouse
  if (!preset || animKey === 'static') {
    controls.enabled = true;
    return {
      keyLightIntensity: 1.0,
      keyLightAzimuth: 45,
      keyLightElevation: 45,
      fillLightIntensity: 1.0,
      envRotation: 0,
      lidAngle: DEFAULT_MOCKUP_POSE.lidAngle,
    };
  }

  // An automated camera motion is active → disable OrbitControls mouse damping
  // so it never overwrites or fights the animated camera coordinates.
  controls.enabled = false;

  // Evaluate the interpolated pose across the multi-keyframe timeline
  const pose = evaluateTimeline(preset.keyframes, progress, DEFAULT_MOCKUP_POSE);

  // 1. Update Camera FOV and Projection Matrix if changed
  if (Math.abs(camera.fov - pose.fov) > 0.1) {
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
  }

  // 2. Compute Camera Spherical Coordinates around lookAt target
  const baseDist = Math.max(0.5, initCam.distanceTo(initTarget));
  const radius = Math.max(0.2, baseDist * pose.camDistance);
  const theta = initAzimuth + THREE.MathUtils.degToRad(pose.camOrbit);
  const phi = Math.max(
    0.05,
    Math.min(
      Math.PI - 0.05,
      Math.PI / 2 - (initElevation + THREE.MathUtils.degToRad(pose.camElevation))
    )
  );

  const target = new THREE.Vector3(
    initTarget.x + pose.targetX + userOffsetX,
    initTarget.y + pose.targetY + userOffsetY,
    initTarget.z + pose.targetZ
  );

  const eyeX = target.x + radius * Math.sin(phi) * Math.sin(theta);
  const eyeY = target.y + radius * Math.cos(phi);
  const eyeZ = target.z + radius * Math.sin(phi) * Math.cos(theta);

  camera.position.set(eyeX, eyeY, eyeZ);
  controls.target.copy(target);
  camera.lookAt(target);

  // 3. Apply Camera Roll / Bank around Z axis if specified
  if (Math.abs(pose.camRoll) > 0.01) {
    camera.rotation.z += THREE.MathUtils.degToRad(pose.camRoll);
  }

  // 4. Update Model Pivot Transform (Pitch, Yaw, Roll, Translation, Scale)
  pivot.rotation.set(
    userRotX + THREE.MathUtils.degToRad(pose.tiltX),
    userRotY + THREE.MathUtils.degToRad(pose.tiltY),
    THREE.MathUtils.degToRad(pose.tiltZ)
  );

  pivot.position.set(
    (userOffsetX || 0) + pose.posX,
    (userOffsetY || 0) + pose.posY,
    pose.posZ
  );

  const finalScale = Math.max(0.05, userScale * pose.scale);
  pivot.scale.setScalar(finalScale);

  // 5. Hardware Articulation — articulate upper laptop lid meshes if present
  if (Math.abs(pose.lidAngle - DEFAULT_MOCKUP_POSE.lidAngle) > 0.5) {
    articulateLaptopLid(pivot, pose.lidAngle);
  }

  // 6. Return Dynamic Studio Lighting choreography
  return {
    keyLightIntensity: pose.lightBright,
    keyLightAzimuth: pose.lightRot,
    keyLightElevation: pose.lightHeight,
    fillLightIntensity: pose.lightFill,
    envRotation: pose.envRotation,
    lidAngle: pose.lidAngle,
  };
}

/**
 * Traverses model meshes to find laptop lid / upper screen housing groups
 * and articulates the hinge smoothly according to `lidAngle` in degrees.
 */
function articulateLaptopLid(pivot: THREE.Group, lidAngleDeg: number): void {
  const angleRad = THREE.MathUtils.degToRad(lidAngleDeg);
  pivot.traverse((child) => {
    const nm = child.name.toLowerCase();
    if (
      nm.includes('lid') ||
      nm.includes('screen_group') ||
      nm.includes('upper') ||
      nm.includes('top_case') ||
      nm === 'lid_hinge'
    ) {
      // Articulate around X-axis hinge
      child.rotation.x = angleRad;
    }
  });
}
