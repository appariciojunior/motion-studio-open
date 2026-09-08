// Shader assembly for both engines, with no engine imported.
//
// Split out of the adapters on purpose: this is the part worth testing, and a
// verify script that had to import pixi.js (which wants a DOM) or three (which
// wants a GL context) to look at a string would test neither. Here it is plain
// string work, so scripts/verify-effects.cjs exercises the REAL generator.
import type { Effect, EffectShader } from '@/lib/types';

/** Todo passe do efeito, em ordem. `shader` e sempre o primeiro. */
export function passesOf(effect: Effect): EffectShader[] {
  return [effect.shader, ...(effect.passes ?? [])];
}

/** Names the adapters inject. An effect redeclaring one is a compile error. */
export const RESERVED = ['uTexture', 'map', 'uInputSize', 'uResolution', 'uTime', 'fxSample', 'fxMain', 'vTextureCoord', 'vUv'];

// sRGB <-> linear, formula exata (nao a aproximacao pow 2.2, que erra 4% nos
// escuros por ignorar o trecho linear perto de zero).
//
// POR QUE ISTO EXISTE. O three trabalha em espaco LINEAR e converte para sRGB
// na saida (`#include <colorspace_fragment>`, que roda DEPOIS do efeito),
// enquanto o Pixi entrega e consome sRGB direto. Sem tratar isso, o MESMO
// efeito faz contas em espacos diferentes nos dois engines — o que quebra a
// promessa inteira do contrato.
//
// Medido no Posterize com levels=5, onde caem os niveis em sRGB 0-255:
//   Pixi  (sRGB)   0, 64, 128, 191, 255   espacamento 64, 64, 63, 64
//   three (linear) 0, 137, 188, 225, 255  espacamento 137, 51, 37, 30
// Um salto de 137 niveis do preto para o primeiro degrau, e as bandas
// amontoadas nos claros — 73 de diferenca no pior nivel. Visivelmente outro
// efeito, e o pior dos dois.
//
// Afeta todo efeito que faz MATEMATICA DE COR: posterize (o pior caso),
// halftone (o tom medido decide o tamanho do ponto), grain (a soma) e vignette
// (a multiplicacao). Os que so deslocam coordenada — pixelate, rgb-split, wave
// — sao imunes, e e por isso que a divergencia passou tanto tempo invisivel.
//
// A escolha e sRGB, nao linear: e o que o Pixi ja da, e e o espaco em que
// "cinco niveis" significa cinco degraus PERCEPTUALMENTE iguais, que e o que
// alguem mexendo no controle espera ver.
const SRGB_HELPERS = `
vec3 fx_toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 fx_toLinear(vec3 c) {
  return mix(c / 12.92, pow((max(c, vec3(0.0)) + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}`;

// Os helpers de espaco de cor tambem sao injetados, entao tambem sao reservados.
RESERVED.push('fx_toSrgb', 'fx_toLinear');


function declarations(pass: EffectShader): string {
  return Object.entries(pass.uniformTypes ?? {})
    .map(([name, type]) => `uniform ${type} ${name};`)
    .join('\n');
}

/** GLSL ES 3.00 fragment for Pixi, where a pixel coordinate must unmap through uInputSize. */
export function pixiFragment(effect: Effect, pass: EffectShader = effect.shader): string {
  return `#version 300 es
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec2 uResolution;
uniform float uTime;
${declarations(pass)}

// uInputSize.xy is the filter area in pixels, .zw its offset inside the texture
// Pixi actually allocated — a filter's input can be padded, so a pixel
// coordinate is not just uv * resolution.
vec2 fx_toPixels(vec2 uv) { return uv * uInputSize.xy + uInputSize.zw; }
vec2 fx_toUv(vec2 p)      { return (p - uInputSize.zw) / uInputSize.xy; }
vec4 fxSample(vec2 p)     { return texture(uTexture, fx_toUv(p)); }

${pass.fragment}

void main(void) {
  finalColor = fxMain(fx_toPixels(vTextureCoord));
}`;
}

/** GLSL ES 1.00 fragment for three, where the pass reads a full-screen target. */
export function threeFragment(effect: Effect, pass: EffectShader = effect.shader): string {
  return `
uniform sampler2D map;
uniform vec2 uResolution;
uniform float uTime;
${declarations(pass)}
varying vec2 vUv;

${SRGB_HELPERS}

// A amostra chega em espaco linear (o three trabalha assim) e o efeito tem de
// ver sRGB, para casar com o Pixi.
vec4 fxSample(vec2 p) {
  vec4 c = texture2D(map, p / uResolution);
  return vec4(fx_toSrgb(c.rgb), c.a);
}

${pass.fragment}

void main() {
  vec4 fx_result = fxMain(vUv * uResolution);
  // De volta a linear: o colorspace_fragment abaixo faz a conversao final para
  // sRGB, e converter duas vezes clareia a imagem inteira. Eu esqueci esta
  // linha na primeira tentativa e o teste de paridade acusou 47/255 de
  // divergencia media uniforme em TODOS os efeitos, inclusive nos que so
  // deslocam coordenada — o que era o sinal de que o erro estava no wrapper e
  // nao nos efeitos.
  gl_FragColor = vec4(fx_toLinear(fx_result.rgb), fx_result.a);
  #include <colorspace_fragment>
}`;
}
