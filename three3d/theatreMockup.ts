import { getProject, val, type ISheetObject } from '@theatre/core';
import { DEFAULT_MOCKUP_POSE, type MockupPose } from './animations';

type TheatreMockupObject = ISheetObject<{
  camera: {
    distance: number; orbit: number; elevation: number; roll: number; fov: number;
    targetX: number; targetY: number; targetZ: number;
  };
  device: {
    tiltX: number; tiltY: number; tiltZ: number;
    x: number; y: number; z: number; scale: number; lidAngle: number;
  };
  lighting: {
    rotation: number; height: number; key: number; fill: number;
    warmth: number; environmentRotation: number; environmentTilt: number;
  };
}>;

let object: TheatreMockupObject | null = null;
let sheet: ReturnType<ReturnType<typeof getProject>['sheet']> | null = null;
let studio: typeof import('@theatre/studio')['default'] | null = null;
let loading: Promise<void> | null = null;

/**
 * Loads Theatre Studio only when the user asks for the advanced mockup editor.
 * Its project state is managed by Theatre in localStorage, while the render
 * loop below remains controlled by Motion Studio's own frame counter.
 */
export function enableTheatreMockup(): Promise<void> {
  if (object) {
    studio?.ui.restore();
    return Promise.resolve();
  }
  if (loading) return loading;

  loading = import('@theatre/studio').then((mod) => {
    studio = mod.default;
    studio.initialize();

    const project = getProject('Motion Studio — Device Mockup');
    sheet = project.sheet('Mockup');
    object = sheet.object('Device', {
      camera: {
        distance: DEFAULT_MOCKUP_POSE.camDistance,
        orbit: DEFAULT_MOCKUP_POSE.camOrbit,
        elevation: DEFAULT_MOCKUP_POSE.camElevation,
        roll: DEFAULT_MOCKUP_POSE.camRoll,
        fov: DEFAULT_MOCKUP_POSE.fov,
        targetX: DEFAULT_MOCKUP_POSE.targetX,
        targetY: DEFAULT_MOCKUP_POSE.targetY,
        targetZ: DEFAULT_MOCKUP_POSE.targetZ,
      },
      device: {
        tiltX: DEFAULT_MOCKUP_POSE.tiltX,
        tiltY: DEFAULT_MOCKUP_POSE.tiltY,
        tiltZ: DEFAULT_MOCKUP_POSE.tiltZ,
        x: DEFAULT_MOCKUP_POSE.posX,
        y: DEFAULT_MOCKUP_POSE.posY,
        z: DEFAULT_MOCKUP_POSE.posZ,
        scale: DEFAULT_MOCKUP_POSE.scale,
        lidAngle: DEFAULT_MOCKUP_POSE.lidAngle,
      },
      lighting: {
        rotation: DEFAULT_MOCKUP_POSE.lightRot,
        height: DEFAULT_MOCKUP_POSE.lightHeight,
        key: DEFAULT_MOCKUP_POSE.lightBright,
        fill: DEFAULT_MOCKUP_POSE.lightFill,
        warmth: DEFAULT_MOCKUP_POSE.lightWarm,
        environmentRotation: DEFAULT_MOCKUP_POSE.envRotation,
        environmentTilt: DEFAULT_MOCKUP_POSE.envTilt,
      },
    }) as TheatreMockupObject;

    studio.setSelection([sheet!, object!]);
    studio.ui.restore();
  });
  return loading;
}

export function hideTheatreMockup(): void {
  studio?.ui.hide();
}

/** Seek Theatre from a normalized Motion Studio frame, then read the pose. */
export function theatrePoseAt(progress: number): MockupPose | null {
  if (!sheet || !object) return null;
  const length = Math.max(0.001, val(sheet.sequence.pointer.length));
  sheet.sequence.position = Math.min(length, Math.max(0, progress) * length);
  const v = object.value;
  return {
    camDistance: v.camera.distance,
    camOrbit: v.camera.orbit,
    camElevation: v.camera.elevation,
    camRoll: v.camera.roll,
    fov: v.camera.fov,
    targetX: v.camera.targetX,
    targetY: v.camera.targetY,
    targetZ: v.camera.targetZ,
    tiltX: v.device.tiltX,
    tiltY: v.device.tiltY,
    tiltZ: v.device.tiltZ,
    posX: v.device.x,
    posY: v.device.y,
    posZ: v.device.z,
    scale: v.device.scale,
    lidAngle: v.device.lidAngle,
    lightRot: v.lighting.rotation,
    lightHeight: v.lighting.height,
    lightBright: v.lighting.key,
    lightFill: v.lighting.fill,
    lightWarm: v.lighting.warmth,
    envRotation: v.lighting.environmentRotation,
    envTilt: v.lighting.environmentTilt,
  };
}
