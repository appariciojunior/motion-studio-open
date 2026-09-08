import type { Effect, EffectShader } from '@/lib/types';

// Blur gaussiano, SEPARAVEL: um passe horizontal e um vertical.
//
// Um gaussiano 2D e o produto de dois gaussianos 1D, entao borrar em X e depois
// em Y da exatamente o mesmo resultado que um kernel 2D — e custa muito menos.
// Um raio r num passe unico pede (2r+1)^2 amostras por pixel; separado pede
// 2*(2r+1). A 20px de raio isso e 1681 contra 82, vinte vezes menos trabalho, e
// e por isso que este efeito precisou do contrato de multiplos passes.
//
// TAPS FIXOS, RAIO VARIAVEL. O laco tem contagem constante (GLSL ES 1.00 nem
// aceita laco com limite vindo de uniform) e o espacamento entre amostras cresce
// com o raio. A um raio grande as amostras ficam esparsas, entao o peso e
// normalizado pela soma REAL acumulada — sem isso a imagem escurece conforme o
// raio sobe, porque a cauda do gaussiano que ficou de fora nao entra na conta.
//
// O peso e calculado no shader em vez de vir numa tabela de uniforms: sao 13
// exponenciais por pixel contra 13 uniforms para manter em sincronia entre os
// dois passes e os dois engines. A conta e mais barata que o risco.
const TAPS = 6; // de cada lado; 13 amostras no total por passe

// Os dois passes sao o MESMO shader com uma direcao diferente. Escrever duas
// vezes seria duas oportunidades de divergir.
const corpo = `
vec4 fxMain(vec2 p) {
  if (uRadius < 0.5) return fxSample(p);
  vec4 soma = fxSample(p);
  float peso = 1.0;
  float sigma = max(0.0001, uRadius * 0.5);
  for (int i = 1; i <= ${TAPS}; i++) {
    float d = (float(i) / float(${TAPS})) * uRadius;
    float w = exp(-(d * d) / (2.0 * sigma * sigma));
    soma += fxSample(p + uDir * d) * w;
    soma += fxSample(p - uDir * d) * w;
    peso += 2.0 * w;
  }
  return soma / peso;
}`;

function passe(direcao: [number, number]): EffectShader {
  return {
    uniformTypes: { uRadius: 'float', uDir: 'vec2' },
    uniforms: (v) => ({
      uRadius: Math.max(0, Number(v.radius ?? 8)),
      uDir: direcao,
    }),
    fragment: corpo,
  };
}

export const blur: Effect = {
  // Nasce no quadro todo: desfocar a cena inteira, fundo incluido, e o que um
  // blur de cena faz. Quem quiser so os cards troca no seletor.
  meta: { id: 'blur', name: 'Blur', defaultScope: 'scene' },
  controls: [
    { key: 'radius', label: 'Radius', type: 'slider', min: 0, max: 40, step: 1, default: 8, unit: 'px' },
  ],
  shader: passe([1, 0]),
  passes: [passe([0, 1])],
};
