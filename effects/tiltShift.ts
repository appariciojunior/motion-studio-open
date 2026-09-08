import type { Effect, EffectShader } from '@/lib/types';

// Tilt-shift: uma FAIXA em foco, o resto borrado, com a transicao suave.
//
// E o mesmo blur separavel do effects/blur.ts com o raio modulado pela
// distancia ate a faixa de foco. Nao herda o codigo de la de proposito: o raio
// aqui varia POR PIXEL, e um blur cujo raio muda a cada pixel nao e o mesmo
// shader com um uniform diferente — o laco tem de calcular o raio antes de
// amostrar.
//
// A faixa e horizontal e medida em fracao da ALTURA, que e como a lente de
// verdade se comporta: o plano de foco e paralelo ao chao, e o que decide se um
// ponto esta nele e a altura dele no quadro.
//
// A rampa usa smoothstep entre a borda da faixa e a borda mais a transicao. Um
// corte duro entre nitido e borrado denuncia o truque na hora; e justamente a
// rampa que faz o olho ler "profundidade de campo" em vez de "mascara".
const TAPS = 6;

const corpo = `
float fx_desfoque(vec2 p) {
  // distancia ate a faixa, em pixels, 0 dentro dela
  float centro = uFocus * uResolution.y;
  float meia = max(1.0, uBand * uResolution.y * 0.5);
  float d = abs(p.y - centro) - meia;
  if (d <= 0.0) return 0.0;
  float rampa = max(1.0, uFeather * uResolution.y);
  return uRadius * smoothstep(0.0, rampa, d);
}

vec4 fxMain(vec2 p) {
  float raio = fx_desfoque(p);
  if (raio < 0.5) return fxSample(p);
  vec4 soma = fxSample(p);
  float peso = 1.0;
  float sigma = max(0.0001, raio * 0.5);
  for (int i = 1; i <= ${TAPS}; i++) {
    float d = (float(i) / float(${TAPS})) * raio;
    float w = exp(-(d * d) / (2.0 * sigma * sigma));
    soma += fxSample(p + uDir * d) * w;
    soma += fxSample(p - uDir * d) * w;
    peso += 2.0 * w;
  }
  return soma / peso;
}`;

function passe(direcao: [number, number]): EffectShader {
  return {
    uniformTypes: {
      uRadius: 'float', uFocus: 'float', uBand: 'float', uFeather: 'float', uDir: 'vec2',
    },
    uniforms: (v) => ({
      uRadius: Math.max(0, Number(v.radius ?? 14)),
      // 0 = topo, 1 = base. Metade e o centro do quadro.
      uFocus: Math.max(0, Math.min(1, Number(v.focus ?? 50) / 100)),
      uBand: Math.max(0, Math.min(1, Number(v.band ?? 25) / 100)),
      // Nunca exatamente zero: smoothstep com as duas bordas iguais e indefinido,
      // e o mesmo cuidado que o Vignette ja precisou ter na sua rampa.
      uFeather: Math.max(0.001, Number(v.feather ?? 12) / 100),
      uDir: direcao,
    }),
    fragment: corpo,
  };
}

export const tiltShift: Effect = {
  meta: { id: 'tilt-shift', name: 'Tilt-shift', defaultScope: 'scene' },
  controls: [
    { key: 'radius', label: 'Radius', type: 'slider', min: 0, max: 40, step: 1, default: 14, unit: 'px' },
    { key: 'focus', label: 'Focus', type: 'slider', min: 0, max: 100, step: 1, default: 50, unit: '%' },
    { key: 'band', label: 'Band', type: 'slider', min: 0, max: 100, step: 1, default: 25, unit: '%' },
    { key: 'feather', label: 'Feather', type: 'slider', min: 0, max: 60, step: 1, default: 12, unit: '%' },
  ],
  shader: passe([1, 0]),
  passes: [passe([0, 1])],
};
