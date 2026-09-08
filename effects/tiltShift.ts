import type { Effect, EffectShader } from '@/lib/types';
import { AREA_OPTIONS, AREA_UNIFORM_TYPES, areaUniforms } from './area';

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
// A faixa horizontal: 0 dentro dela, subindo para fora. E o modo 'Band', o
// tilt-shift classico — plano de foco paralelo ao chao.
float ts_faixa(vec2 p) {
  float centro = uFocus * uResolution.y;
  float meia = max(1.0, uBandY * uResolution.y * 0.5);
  float d = abs(p.y - centro) - meia;
  if (d <= 0.0) return 0.0;
  float rampa = max(1.0, uFeather * uResolution.y);
  return smoothstep(0.0, rampa, d);
}

vec4 fxMain(vec2 p) {
  // Faixa (codigo 3) usa a mascara propria; bordas e cantos usam a
  // compartilhada. A faixa deixa o meio nitido e borra TOPO E BASE, o que numa
  // cena de cards deitados ainda come metade deles — por isso ela deixou de ser
  // o unico modo, e nao e mais o default.
  float mascara = (uArea > 2.5) ? ts_faixa(p) : fx_areaMask(p, uArea, uBand);
  float raio = uRadius * mascara;
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
      uRadius: 'float', uFocus: 'float', uBandY: 'float', uFeather: 'float', uDir: 'vec2',
      ...AREA_UNIFORM_TYPES,
    },
    uniforms: (v) => ({
      uRadius: Math.max(0, Number(v.radius ?? 14)),
      // 0 = topo, 1 = base. Metade e o centro do quadro.
      uFocus: Math.max(0, Math.min(1, Number(v.focus ?? 50) / 100)),
      // `uBandY` e a faixa de foco; `uBand`, que vem da area compartilhada, e o
      // alcance da mascara de borda. Nomes distintos porque sao duas coisas
      // diferentes e o mesmo nome nos dois era um bug esperando acontecer.
      uBandY: Math.max(0, Math.min(1, Number(v.band ?? 25) / 100)),
      // Nunca exatamente zero: smoothstep com as duas bordas iguais e indefinido,
      // e o mesmo cuidado que o Vignette ja precisou ter na sua rampa.
      uFeather: Math.max(0.001, Number(v.feather ?? 12) / 100),
      uDir: direcao,
      ...areaUniforms(v),
      // 'Band' nao esta na tabela compartilhada: e um modo so deste efeito.
      uArea: String(v.area ?? 'Edges') === 'Band' ? 3 : areaUniforms(v).uArea,
    }),
    fixedUniforms: ['uDir'],
    fragment: corpo,
  };
}

export const tiltShift: Effect = {
  // Nasce em 'artwork': age sobre os CARDS, e o fundo da cena passa intacto.
  // Aplicado ao fundo tambem, um efeito de lente amassa a cena inteira e o
  // assunto se perde junto. Quem quiser o fundo troca no seletor de escopo.
  meta: { id: 'tilt-shift', name: 'Tilt-shift', defaultScope: 'artwork' },
  controls: [
    { key: 'radius', label: 'Radius', type: 'slider', min: 0, max: 40, step: 1, default: 14, unit: 'px' },
    // A faixa horizontal virou UMA das areas em vez de a unica. Ela deixa o
    // meio nitido e borra topo e base, o que numa cena de cards deitados ainda
    // come metade deles; bordas e cantos protegem o assunto de verdade.
    { key: 'area', label: 'Applies at', type: 'pills', options: [...AREA_OPTIONS, 'Band'], default: 'Edges' },
    {
      key: 'reach', label: 'Reach', type: 'slider', min: 2, max: 100, step: 1, default: 35, unit: '%',
      visibleWhen: { key: 'area', not: 'Full frame' },
    },
    {
      key: 'focus', label: 'Focus', type: 'slider', min: 0, max: 100, step: 1, default: 50, unit: '%',
      visibleWhen: { key: 'area', equals: 'Band' },
    },
    {
      key: 'band', label: 'Band', type: 'slider', min: 0, max: 100, step: 1, default: 25, unit: '%',
      visibleWhen: { key: 'area', equals: 'Band' },
    },
    {
      key: 'feather', label: 'Feather', type: 'slider', min: 0, max: 60, step: 1, default: 12, unit: '%',
      visibleWhen: { key: 'area', equals: 'Band' },
    },
  ],
  shader: passe([1, 0]),
  passes: [passe([0, 1])],
};
