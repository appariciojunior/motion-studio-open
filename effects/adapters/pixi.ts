// The Pixi half of the effect contract: wrap an EffectShader in a PIXI.Filter.
//
// Two things here are not incidental.
//
// The filter is built ONCE per effect id and cached. syncEffects used to rebuild
// its filters whenever the value signature changed, which under the old
// createFilter contract was cheap — PixelateFilter only swaps a uniform. With
// author-written shaders it stops being cheap: rebuilding means recompiling a
// GLSL program, and doing that on every pixel of a dragged slider makes the
// slider stutter. So the program is compiled once and only uniforms move.
//
// fxSample has to unmap through uInputSize. Pixi renders a filter over a texture
// that may be padded and offset inside a larger one, so a pixel coordinate is
// not simply uv * resolution — uInputSize.xy is the area's size and .zw its
// offset. Getting this wrong is invisible on a full-screen effect and wrong
// everywhere else.
import { Filter, GlProgram } from 'pixi.js';
import type { Effect, EffectContext } from '@/lib/types';
import { pixiFragment } from './glsl';

// Pixi's default filter vertex shader (v8). Kept verbatim: the filter pipeline
// depends on the exact varyings and uniform block it declares.
const VERTEX = `#version 300 es
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void )
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}`;


const cache = new Map<string, Filter>();

/** The filter for this effect, compiled once and reused. */
export function pixiFilterFor(effect: Effect): Filter {
  const hit = cache.get(effect.meta.id);
  if (hit) return hit;

  const uniforms: Record<string, { value: any; type: string }> = {
    uResolution: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
    uTime: { value: 0, type: 'f32' },
  };
  for (const [name, type] of Object.entries(effect.shader.uniformTypes ?? {})) {
    uniforms[name] = {
      value: type === 'float' ? 0 : new Float32Array(type === 'vec2' ? 2 : type === 'vec3' ? 3 : 4),
      type: type === 'float' ? 'f32' : `${type}<f32>`,
    };
  }

  const filter = new Filter({
    glProgram: GlProgram.from({ vertex: VERTEX, fragment: pixiFragment(effect), name: `fx-${effect.meta.id}` }),
    resources: { fxUniforms: uniforms },
  });
  cache.set(effect.meta.id, filter);
  return filter;
}

/** Push this frame's control values into the filter. No recompilation. */
export function applyPixiUniforms(
  filter: Filter,
  effect: Effect,
  values: Record<string, any>,
  ctx: EffectContext,
): void {
  const u = (filter.resources as any).fxUniforms.uniforms;
  u.uResolution[0] = ctx.width;
  u.uResolution[1] = ctx.height;
  u.uTime = ctx.time;
  const own = effect.shader.uniforms(values, ctx);
  for (const [name, value] of Object.entries(own)) {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) u[name][i] = value[i];
    } else {
      u[name] = value;
    }
  }
}

/** Test seam: drop the compiled programs (used by the verify script). */
export function clearPixiFilterCache(): void {
  cache.clear();
}
