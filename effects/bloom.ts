import type { Effect } from '@/lib/types';

// Bloom: o que passa do limiar transborda e ilumina a vizinhanca.
//
// PASSE UNICO, E ISSO E UMA ESCOLHA. O caminho classico e separavel — borra o
// passe claro em X, depois em Y, e soma ao ORIGINAL. O problema esta nesse
// "soma ao original": o ultimo passe precisa ler a entrada da CADEIA, e nao a
// saida do passe anterior. Isso exige um protocolo novo (uma textura guardada e
// entregue aos passes seguintes) que teria de existir e ser provado nos dois
// engines, com um agravante do lado Pixi: as texturas intermediarias do
// filterManager sao recicladas de um pool, entao guardar a referencia da
// entrada e ler depois pode entregar um buffer que ja virou outra coisa.
//
// Um kernel esparso resolve o mesmo problema sem nada disso: as amostras sao
// tomadas em ANEIS ao redor do pixel, e como bloom e por definicao um brilho
// suave e espalhado, a esparsidade nao aparece — o que apareceria num blur de
// detalhe fino se dissolve aqui. E `fxSample(p)` continua sendo o original,
// porque nao ha passe anterior nenhum. A soma sai de graca.
//
// Custo medido em amostras por pixel: 4 aneis x 8 direcoes + o centro = 33,
// contra 2 x 13 = 26 do separavel de dois passes. Um terco a mais de amostras
// em troca de nao inventar protocolo — e o separavel ainda precisaria do passe
// de combinacao por cima.
//
// O LIMIAR usa luminancia Rec.709, a mesma do modo mono do Halftone. Bloom
// segue brilho percebido: um amarelo saturado transborda antes de um azul de
// mesmo valor numerico, e e assim que a lente se comporta.
const ANEIS = 4;
const DIRECOES = 8;

export const bloom: Effect = {
  meta: { id: 'bloom', name: 'Bloom', defaultScope: 'scene' },
  controls: [
    { key: 'threshold', label: 'Threshold', type: 'slider', min: 0, max: 100, step: 1, default: 65, unit: '%' },
    { key: 'radius', label: 'Radius', type: 'slider', min: 1, max: 60, step: 1, default: 22, unit: 'px' },
    { key: 'intensity', label: 'Intensity', type: 'slider', min: 0, max: 200, step: 1, default: 70, unit: '%' },
  ],
  shader: {
    uniformTypes: { uThreshold: 'float', uRadius: 'float', uIntensity: 'float' },
    uniforms: (v) => ({
      uThreshold: Math.max(0, Math.min(1, Number(v.threshold ?? 65) / 100)),
      uRadius: Math.max(1, Number(v.radius ?? 22)),
      uIntensity: Math.max(0, Number(v.intensity ?? 70) / 100),
    }),
    fragment: `
// O que passa do limiar, e SO o excedente: subtrair o limiar em vez de deixar
// passar o pixel inteiro e o que evita o degrau visivel na borda do brilho.
vec3 fx_excedente(vec3 c) {
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float acima = max(0.0, luma - uThreshold);
  // divide pelo que sobra da escala, para o limiar em 0 nao virar identidade
  float k = acima / max(0.0001, 1.0 - uThreshold);
  return c * k;
}

vec4 fxMain(vec2 p) {
  vec4 base = fxSample(p);
  vec3 brilho = vec3(0.0);
  float peso = 0.0;
  for (int anel = 1; anel <= ${ANEIS}; anel++) {
    float r = (float(anel) / float(${ANEIS})) * uRadius;
    // peso gaussiano pelo raio do anel, como num blur de verdade
    float sigma = max(0.0001, uRadius * 0.5);
    float w = exp(-(r * r) / (2.0 * sigma * sigma));
    for (int dir = 0; dir < ${DIRECOES}; dir++) {
      // Meio passo de rotacao por anel, para os aneis nao alinharem as amostras
      // no mesmo raio e desenharem uma estrela.
      float a = (float(dir) + float(anel) * 0.5) * (6.2831853 / float(${DIRECOES}));
      vec2 off = vec2(cos(a), sin(a)) * r;
      brilho += fx_excedente(fxSample(p + off).rgb) * w;
      peso += w;
    }
  }
  brilho /= max(0.0001, peso);
  // Aditivo, nao mistura: bloom SOMA luz. Misturar apagaria a imagem embaixo.
  return vec4(base.rgb + brilho * uIntensity, base.a);
}`,
  },
};
