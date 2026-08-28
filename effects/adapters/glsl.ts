// Shader assembly for both engines, with no engine imported.
//
// Split out of the adapters on purpose: this is the part worth testing, and a
// verify script that had to import pixi.js (which wants a DOM) or three (which
// wants a GL context) to look at a string would test neither. Here it is plain
// string work, so scripts/verify-effects.cjs exercises the REAL generator.
import type { Effect } from '@/lib/types';

/** Names the adapters inject. An effect redeclaring one is a compile error. */
export const RESERVED = ['uTexture', 'map', 'uInputSize', 'uResolution', 'uTime', 'fxSample', 'fxMain', 'vTextureCoord', 'vUv'];

function declarations(effect: Effect): string {
  return Object.entries(effect.shader.uniformTypes ?? {})
    .map(([name, type]) => `uniform ${type} ${name};`)
    .join('\n');
}

/** GLSL ES 3.00 fragment for Pixi, where a pixel coordinate must unmap through uInputSize. */
export function pixiFragment(effect: Effect): string {
  return `#version 300 es
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec2 uResolution;
uniform float uTime;
${declarations(effect)}

// uInputSize.xy is the filter area in pixels, .zw its offset inside the texture
// Pixi actually allocated — a filter's input can be padded, so a pixel
// coordinate is not just uv * resolution.
vec2 fx_toPixels(vec2 uv) { return uv * uInputSize.xy + uInputSize.zw; }
vec2 fx_toUv(vec2 p)      { return (p - uInputSize.zw) / uInputSize.xy; }
vec4 fxSample(vec2 p)     { return texture(uTexture, fx_toUv(p)); }

${effect.shader.fragment}

void main(void) {
  finalColor = fxMain(fx_toPixels(vTextureCoord));
}`;
}

/** GLSL ES 1.00 fragment for three, where the pass reads a full-screen target. */
export function threeFragment(effect: Effect): string {
  return `
uniform sampler2D map;
uniform vec2 uResolution;
uniform float uTime;
${declarations(effect)}
varying vec2 vUv;

vec4 fxSample(vec2 p) { return texture2D(map, p / uResolution); }

${effect.shader.fragment}

void main() {
  gl_FragColor = fxMain(vUv * uResolution);
  #include <colorspace_fragment>
}`;
}
