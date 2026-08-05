'use client';

import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { createPortal, createRoot, extend, type ReconcilerRoot } from '@react-three/fiber';
import type { Slot3D } from '@/lib/renderer3d';

// R3F is used as a scene-graph reconciler, not as a second renderer. The
// Motion Studio timeline remains the only clock and SceneRenderer3D remains
// responsible for render targets, layer composition and export.
extend({
  Group: THREE.Group,
  Mesh: THREE.Mesh,
  PlaneGeometry: THREE.PlaneGeometry,
  MeshStandardMaterial: THREE.MeshStandardMaterial,
});

interface BoxPortalSpec {
  id: string;
  container: THREE.Group;
  count: number;
  planeGeometry: THREE.PlaneGeometry;
  bodyGeometry: THREE.BufferGeometry;
  register: (index: number, slot: Slot3D | null) => void;
}

function PhysicalCard({
  index,
  planeGeometry,
  bodyGeometry,
  register,
}: Omit<BoxPortalSpec, 'id' | 'container' | 'count'> & { index: number }) {
  const root = useRef<THREE.Group>(null);
  const front = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>(null);
  const back = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>(null);
  const body = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>(null);

  useLayoutEffect(() => {
    if (!root.current || !front.current || !back.current || !body.current) return;
    register(index, {
      mesh: front.current,
      root: root.current,
      front: front.current,
      back: back.current,
      body: body.current as Slot3D['body'],
      texW: 480,
      texH: 600,
      cornerR: -1,
      bindKey: '',
    });
    return () => register(index, null);
  }, [index, register]);

  return (
    <group ref={root} dispose={null}>
      <mesh ref={body} geometry={bodyGeometry} castShadow receiveShadow>
        <meshStandardMaterial
          color={0x24242a}
          roughness={0.88}
          metalness={0}
          transparent
        />
      </mesh>
      <mesh ref={front} geometry={planeGeometry} position-z={0.501} castShadow receiveShadow>
        <meshStandardMaterial
          transparent
          roughness={0.82}
          metalness={0}
          emissive={0xffffff}
          emissiveIntensity={0.28}
          depthWrite
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh ref={back} geometry={planeGeometry} position-z={-0.501} rotation-y={Math.PI} castShadow receiveShadow>
        <meshStandardMaterial color={0x17171b} roughness={0.9} metalness={0} transparent />
      </mesh>
    </group>
  );
}

function BoxPortal({ spec }: { spec: BoxPortalSpec }) {
  return createPortal(
    <group dispose={null}>
      {Array.from({ length: spec.count }, (_, index) => (
        <PhysicalCard
          key={index}
          index={index}
          planeGeometry={spec.planeGeometry}
          bodyGeometry={spec.bodyGeometry}
          register={spec.register}
        />
      ))}
    </group>,
    spec.container,
  );
}

function ScenePortals({ boxes }: { boxes: BoxPortalSpec[] }) {
  return <>{boxes.map((spec) => <BoxPortal key={spec.id} spec={spec} />)}</>;
}

export class R3FSceneBridge {
  private root: ReconcilerRoot<HTMLCanvasElement> | null = null;
  private boxes = new Map<string, BoxPortalSpec>();

  async init(
    canvas: HTMLCanvasElement,
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
  ) {
    this.root = createRoot(canvas);
    await this.root.configure({
      gl: renderer,
      scene,
      camera: camera as THREE.PerspectiveCamera,
      size: { width, height, top: 0, left: 0 },
      frameloop: 'never',
      flat: true,
      shadows: { enabled: true, type: THREE.PCFShadowMap },
      dpr: 1,
    });

    // R3F configures an HTML canvas with `gl.setSize(..., true)`, which writes
    // the initial logical width/height as inline CSS. Motion Studio resizes the
    // same renderer itself with `updateStyle = false`; leaving those inline
    // values behind pins the Box preview to its first aspect even though the
    // drawing buffer has already changed. Release visual sizing back to the
    // shared `.stage-canvas` rule so canvas aspect behaves exactly like Pixi.
    canvas.style.removeProperty('width');
    canvas.style.removeProperty('height');
    this.render();
  }

  upsertBox(spec: BoxPortalSpec) {
    this.boxes.set(spec.id, spec);
    this.render();
  }

  remove(id: string) {
    if (!this.boxes.delete(id)) return;
    this.render();
  }

  private render() {
    if (!this.root) return;
    const boxes = [...this.boxes.values()];
    this.root.render(<ScenePortals boxes={boxes} />);
  }

  destroy() {
    this.boxes.clear();
    this.root?.unmount();
    this.root = null;
  }
}
