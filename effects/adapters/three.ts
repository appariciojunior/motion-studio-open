// The three half of the effect contract: the same EffectShader as a full-screen
// pass on the compose ping-pong.
//
// renderer3d already had the machinery — composeA/composeB alternate while the
// tracks composite — so an effect is just another pass on that chain. What it
// did NOT have was a way to run an effect it did not know by name: pixelate was
// folded into the output quad and read out of the store by id. Everything else
// in effects/ was invisible to the 80 webgl presets.
//
// fxSample here is the trivial case: the pass reads a full-screen render target,
// so a pixel coordinate is just p / uResolution. No padding to undo, unlike Pixi.
import * as THREE from 'three';
import type { Effect, EffectContext } from '@/lib/types';
import { threeFragment } from './glsl';

const VERTEX = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;


const cache = new Map<string, THREE.ShaderMaterial>();

/** The material for this effect's pass, compiled once and reused. */
export function threeMaterialFor(effect: Effect): THREE.ShaderMaterial {
  const hit = cache.get(effect.meta.id);
  if (hit) return hit;

  const uniforms: Record<string, THREE.IUniform> = {
    map: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
  };
  for (const [name, type] of Object.entries(effect.shader.uniformTypes ?? {})) {
    uniforms[name] = {
      value: type === 'float' ? 0
        : type === 'vec2' ? new THREE.Vector2()
        : type === 'vec3' ? new THREE.Vector3()
        : new THREE.Vector4(),
    };
  }

  const material = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: threeFragment(effect),
  });
  cache.set(effect.meta.id, material);
  return material;
}

/** Push this frame's control values into the material. No recompilation. */
export function applyThreeUniforms(
  material: THREE.ShaderMaterial,
  effect: Effect,
  values: Record<string, any>,
  ctx: EffectContext,
): void {
  const u = material.uniforms;
  (u.uResolution.value as THREE.Vector2).set(ctx.width, ctx.height);
  u.uTime.value = ctx.time;
  const own = effect.shader.uniforms(values, ctx);
  for (const [name, value] of Object.entries(own)) {
    const slot = u[name];
    if (!slot) continue;
    if (Array.isArray(value)) (slot.value as any).fromArray(value);
    else slot.value = value;
  }
}

export function disposeThreeMaterials(): void {
  cache.forEach((m) => m.dispose());
  cache.clear();
}
