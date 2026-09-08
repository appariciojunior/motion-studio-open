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
import { passesOf, threeFragment } from './glsl';

const VERTEX = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;


// Um material por INSTANCIA, pelo mesmo motivo do lado Pixi: com escopo por
// camada o uso natural e o MESMO efeito em duas camadas com valores diferentes,
// e um material unico faria a segunda sobrescrever os uniforms da primeira.
// Compilar nao vira custo: o three cacheia o programa pelo codigo do shader,
// entao dois materiais com o mesmo fragment dividem um programa so.
const cache = new Map<string, THREE.ShaderMaterial[]>();

/** Um material por PASSE desta instancia, na ordem em que rodam. */
export function threeMaterialsFor(effect: Effect, instanceId = effect.meta.id): THREE.ShaderMaterial[] {
  const hit = cache.get(instanceId);
  if (hit) return hit;

  const materiais = passesOf(effect).map((pass) => {
    const uniforms: Record<string, THREE.IUniform> = {
      map: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
    };
    for (const [name, type] of Object.entries(pass.uniformTypes ?? {})) {
      uniforms[name] = {
        value: type === 'float' ? 0
          : type === 'vec2' ? new THREE.Vector2()
          : type === 'vec3' ? new THREE.Vector3()
          : new THREE.Vector4(),
      };
    }
    return new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms,
      vertexShader: VERTEX,
      fragmentShader: threeFragment(effect, pass),
    });
  });

  cache.set(instanceId, materiais);
  return materiais;
}

/** Atalho para quem so precisa do primeiro passe. */
export function threeMaterialFor(effect: Effect, instanceId = effect.meta.id): THREE.ShaderMaterial {
  return threeMaterialsFor(effect, instanceId)[0];
}

/** Push this frame's control values into the material. No recompilation. */
export function applyThreeUniforms(
  material: THREE.ShaderMaterial,
  effect: Effect,
  values: Record<string, any>,
  ctx: EffectContext,
  passIndex = 0,
): void {
  const pass = passesOf(effect)[passIndex];
  if (!pass) return;
  const u = material.uniforms;
  (u.uResolution.value as THREE.Vector2).set(ctx.width, ctx.height);
  u.uTime.value = ctx.time;
  // Cada passe tem a SUA funcao de uniforms — e assim que o horizontal e o
  // vertical de um blur separavel se distinguem.
  const own = pass.uniforms(values, ctx);
  for (const [name, value] of Object.entries(own)) {
    const slot = u[name];
    if (!slot) continue;
    if (Array.isArray(value)) (slot.value as any).fromArray(value);
    else slot.value = value;
  }
}

export function disposeThreeMaterials(): void {
  cache.forEach((lista) => lista.forEach((m) => m.dispose()));
  cache.clear();
}
