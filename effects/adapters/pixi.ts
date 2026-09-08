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
import { passesOf, pixiFragment } from './glsl';

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


// O PROGRAMA e por efeito; o FILTRO e por instancia.
//
// Antes o filtro inteiro era cacheado pelo id do efeito. Enquanto so existia um
// escopo isso passava despercebido: duas instancias do mesmo efeito na mesma
// pilha ja dividiam o bloco de uniforms e a ultima a escrever vencia. Com
// escopo por camada a colisao deixa de ser hipotetica — o uso natural e o MESMO
// efeito em duas camadas com valores diferentes. Um filtro por instancia com o
// `GlProgram` compartilhado preserva o motivo do cache original: compilar GLSL
// a cada frame de um slider arrastado faz o slider engasgar.
const programas = new Map<string, GlProgram>();
const cache = new Map<string, Filter[]>();

/** Um filtro por PASSE desta instancia, na ordem em que rodam. */
export function pixiFiltersFor(effect: Effect, instanceId = effect.meta.id): Filter[] {
  const hit = cache.get(instanceId);
  if (hit) return hit;

  // Pixi encadeia sozinho: `container.filters = [a, b]` roda `a` para uma
  // textura intermediaria e `b` sobre ela. Um efeito de varios passes vira
  // varios filtros em sequencia, sem maquinaria nova.
  const filtros = passesOf(effect).map((pass, i) => {
    const uniforms: Record<string, { value: any; type: string }> = {
      uResolution: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
      uTime: { value: 0, type: 'f32' },
    };
    for (const [name, type] of Object.entries(pass.uniformTypes ?? {})) {
      uniforms[name] = {
        value: type === 'float' ? 0 : new Float32Array(type === 'vec2' ? 2 : type === 'vec3' ? 3 : 4),
        type: type === 'float' ? 'f32' : `${type}<f32>`,
      };
    }
    const chave = `${effect.meta.id}#${i}`;
    let programa = programas.get(chave);
    if (!programa) {
      programa = GlProgram.from({ vertex: VERTEX, fragment: pixiFragment(effect, pass), name: `fx-${chave}` });
      programas.set(chave, programa);
    }
    return new Filter({ glProgram: programa, resources: { fxUniforms: uniforms } });
  });

  cache.set(instanceId, filtros);
  return filtros;
}

/** Atalho para quem so precisa do primeiro passe (efeitos de passe unico). */
export function pixiFilterFor(effect: Effect, instanceId = effect.meta.id): Filter {
  return pixiFiltersFor(effect, instanceId)[0];
}

/** Solta os filtros de instancias que sairam da cena. */
export function dropPixiFilters(vivas: Set<string>): void {
  for (const id of [...cache.keys()]) {
    if (!vivas.has(id)) cache.delete(id);
  }
}

/** Push this frame's control values into every pass. No recompilation. */
export function applyPixiUniforms(
  filtros: Filter | Filter[],
  effect: Effect,
  values: Record<string, any>,
  ctx: EffectContext,
): void {
  const lista = Array.isArray(filtros) ? filtros : [filtros];
  const passes = passesOf(effect);
  lista.forEach((filter, i) => {
    const pass = passes[i];
    if (!pass) return;
    const u = (filter.resources as any).fxUniforms.uniforms;
    u.uResolution[0] = ctx.width;
    u.uResolution[1] = ctx.height;
    u.uTime = ctx.time;
    // Cada passe tem a SUA funcao de uniforms: e assim que o passe horizontal e
    // o vertical de um blur separavel se distinguem, sem inventar um "indice do
    // passe" que o autor do efeito teria de interpretar.
    const own = pass.uniforms(values, ctx);
    for (const [name, value] of Object.entries(own)) {
      if (Array.isArray(value)) {
        for (let k = 0; k < value.length; k++) u[name][k] = value[k];
      } else {
        u[name] = value;
      }
    }
  });
}

/** Test seam: drop the compiled programs (used by the verify script). */
export function clearPixiFilterCache(): void {
  cache.clear();
  programas.clear();
}
