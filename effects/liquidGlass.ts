import type { Effect } from '@/lib/types';
import { AREA_CODE, AREA_UNIFORM_TYPES } from './area';

// Liquid Glass: uma lente de vidro sobre o quadro — refracao, dispersao
// cromatica na borda, brilho central, anel e uma ondulacao fluida no aro.
//
// ---------------------------------------------------------------------------
// ORIGEM E LICENCA
//
// A matematica da lente vem do `discLens` de github.com/Yousuf-developer/
// liquid-glass-carousel, sob licenca MIT:
//
//   MIT License
//   Copyright (c) 2026 Yousuf Soomro
//
//   Permission is hereby granted, free of charge, to any person obtaining a
//   copy of this software and associated documentation files (the "Software"),
//   to deal in the Software without restriction, including without limitation
//   the rights to use, copy, modify, merge, publish, distribute, sublicense,
//   and/or sell copies of the Software, and to permit persons to whom the
//   Software is furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in
//   all copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
//   THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
//   FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
//   DEALINGS IN THE SOFTWARE.
//
// Registrado tambem no NOTICE, que e parte dos termos da Apache-2.0 deste
// projeto e nao cortesia.
// ---------------------------------------------------------------------------
//
// O QUE MUDOU NA ADAPTACAO, e por que:
//
// - `texture2D(uTex, uv)` virou `fxSample(p)`. O contrato daqui entrega pixels
//   e resolve o espaco de cor e o padding do Pixi por dentro; amostrar a
//   textura direto quebraria os dois.
// - A vinheta do original saiu. Este projeto ja tem um efeito Vignette, e dois
//   caminhos para a mesma coisa divergem com o tempo — quem quiser as duas
//   coisas empilha os dois efeitos.
// - O centro vem de um `xypad` em PIXELS a partir do centro do quadro, em vez
//   de UV. E a unidade que todo controle daqui usa, e um pad em UV mudaria de
//   significado a cada proporcao de canvas.
// - Um controle `glow` unico governa o nova e o anel, que no original sao tres
//   uniforms interdependentes (`uGlow`, `uWhiteGlow`, `uBlueRing`) — trinta
//   botoes num painel de efeito nao ajudam ninguem a chegar num resultado.
// - O laco de dispersao mantem `MAX_SAMPLES` constante com `break`, porque
//   GLSL ES 1.00 (o alvo do three) nao aceita limite de laco vindo de uniform.
//
// O ALPHA e o do que estava embaixo: a lente REFRATA o que existe, nao inventa
// opacidade. Sobre um fundo transparente nao ha o que refratar e o brilho nao
// aparece no export — o que e coerente, mas vale saber antes de exportar PNG
// com fundo vazio.
const MAX_SAMPLES = 16;

export const liquidGlass: Effect = {
  // Nasce em 'artwork': o vidro age sobre os CARDS, e o fundo da cena passa
  // intacto. Em 'scene' ele refrata o fundo tambem, e como o fundo costuma ser
  // chapado, o unico resultado visivel ali e a moldura sobreposta a uma cor
  // uniforme — custo sem ganho. Quem tiver fundo com imagem troca no seletor.
  meta: { id: 'liquid-glass', name: 'Liquid Glass', defaultScope: 'artwork' },
  controls: [
    // O PRIMEIRO controle, porque e o que decide quais outros importam. Em
    // bordas ou cantos nao ha pad, tamanho nem forma para acertar: o alcance e
    // o unico numero, e era isso que estava faltando para o efeito ser usavel.
    { key: 'area', label: 'Applies at', type: 'pills', options: ['Corners', 'Edges', 'Lens'], default: 'Edges' },
    {
      key: 'reach', label: 'Reach', type: 'slider', min: 2, max: 100, step: 1, default: 22, unit: '%',
      visibleWhen: { key: 'area', not: 'Lens' },
    },
    // Pixels a partir do centro do quadro. `max` e o alcance do pad em cada
    // eixo; 540 e meia altura do canvas de referencia, entao o pad cobre a cena.
    {
      key: 'position', label: 'Position', type: 'xypad', max: 540, default: { x: 0, y: 0 },
      visibleWhen: { key: 'area', equals: 'Lens' },
    },
    {
      key: 'size', label: 'Size', type: 'slider', min: 4, max: 80, step: 1, default: 26, unit: '%',
      visibleWhen: { key: 'area', equals: 'Lens' },
    },
    {
      key: 'shape', label: 'Shape', type: 'pills', options: ['Circle', 'Square'], default: 'Circle',
      visibleWhen: { key: 'area', equals: 'Lens' },
    },
    {
      key: 'rounding', label: 'Rounding', type: 'slider', min: 0, max: 100, step: 1, default: 30, unit: '%',
      visibleWhen: { key: 'shape', equals: 'Square' },
    },
    { key: 'refraction', label: 'Refraction', type: 'slider', min: 0, max: 100, step: 1, default: 45, unit: '%' },
    { key: 'dispersion', label: 'Dispersion', type: 'slider', min: 0, max: 100, step: 1, default: 30, unit: '%' },
    { key: 'ripple', label: 'Ripple', type: 'slider', min: 0, max: 100, step: 1, default: 18, unit: '%' },
    { key: 'glow', label: 'Glow', type: 'slider', min: 0, max: 100, step: 1, default: 35, unit: '%' },
    { key: 'ring', label: 'Ring', type: 'slider', min: 0, max: 100, step: 1, default: 22, unit: '%' },
    { key: 'ringColor', label: 'Ring colour', type: 'color', default: '#009dff' },
    { key: 'shimmer', label: 'Shimmer', type: 'slider', min: 0, max: 100, step: 1, default: 25, unit: '%', advanced: true },
    { key: 'edgeBlur', label: 'Edge blur', type: 'slider', min: 0, max: 40, step: 1, default: 6, unit: 'px', advanced: true },
    { key: 'rotation', label: 'Rotation', type: 'slider', min: -180, max: 180, step: 1, default: 0, unit: '°', advanced: true },
  ],
  shader: {
    uniformTypes: {
      uCenter: 'vec2',
      uHalf: 'vec2',
      uZoom: 'float',
      uDispersion: 'float',
      uRipple: 'float',
      uGlow: 'float',
      uRing: 'float',
      uRingColor: 'vec3',
      uShimmer: 'float',
      uBlur: 'float',
      uRotation: 'float',
      uShape: 'float',
      uRound: 'float',
      uSamples: 'float',
      ...AREA_UNIFORM_TYPES,
    },
    uniforms: (v, ctx) => {
      const pos = (v.position ?? { x: 0, y: 0 }) as { x: number; y: number };
      // Meia-altura em pixels; o mesmo valor nos dois eixos mantem o circulo
      // redondo na TELA, porque a distancia e medida em pixels e nao em UV.
      const meia = (Math.max(4, Number(v.size ?? 26)) / 100) * ctx.height * 0.5;
      const hex = String(v.ringColor ?? '#009dff').replace('#', '');
      const n = parseInt(hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex, 16) || 0x009dff;
      return {
        uCenter: [ctx.width / 2 + Number(pos.x ?? 0), ctx.height / 2 + Number(pos.y ?? 0)],
        uHalf: [meia, meia],
        uZoom: Math.max(0, Number(v.refraction ?? 45)) / 100,
        uDispersion: Math.max(0, Number(v.dispersion ?? 30)) / 100,
        uRipple: Math.max(0, Number(v.ripple ?? 18)) / 100,
        uGlow: Math.max(0, Number(v.glow ?? 35)) / 100,
        uRing: Math.max(0, Number(v.ring ?? 22)) / 100,
        uRingColor: [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255],
        uShimmer: Math.max(0, Number(v.shimmer ?? 25)) / 100,
        uBlur: Math.max(0, Number(v.edgeBlur ?? 6)),
        uRotation: (Number(v.rotation ?? 0) * Math.PI) / 180,
        uShape: v.shape === 'Square' ? 1 : 0,
        uRound: Math.max(0, Math.min(1, Number(v.rounding ?? 30) / 100)),
        // Constante por enquanto, mas passa pela mesma funcao: chumbar no shader
        // esconderia o valor de quem for ler o efeito.
          uSamples: MAX_SAMPLES,
        // 'Lens' e modo proprio deste efeito e vai para 0; bordas e cantos
        // reusam a tabela compartilhada, para painel e shader nao discordarem.
        uArea: String(v.area ?? 'Edges') === 'Lens' ? 0 : (AREA_CODE[String(v.area ?? 'Edges')] ?? 1),
        uBand: Math.max(0, Math.min(1, Number(v.reach ?? 22) / 100)),
      };
    },
    fixedUniforms: ['uSamples'],
    fragment: `
const int LG_MAX = ${MAX_SAMPLES};

// distancia assinada de caixa arredondada (negativa dentro)
float lg_sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

vec4 fxMain(vec2 p) {
  vec4 base = fxSample(p);

  // DOIS modos, e a diferenca entre eles e so como 'rad' e 'rPix' nascem.
  //
  //   Lens (uArea 0)    um disco que se posiciona: 'rad' sai da elipse
  //   Edges / Corners   o vidro vive na FAIXA DA BORDA: 'rad' e a mascara de
  //                     area, e nao ha o que posicionar
  //
  // O modo de borda existe porque o disco, aplicado por cima da cena, cobre os
  // cards — e vidro em cima do assunto e o assunto que se perde. Na borda o
  // vidro emoldura, o meio fica limpo, e nao ha pad nem tamanho para acertar:
  // o alcance e o unico numero.
  bool lente = uArea < 0.5;

  vec2 centro = lente ? uCenter : uResolution * 0.5;
  vec2 d = p - centro;
  float ca = cos(uRotation), sa = sin(uRotation);
  vec2 q = mat2(ca, -sa, sa, ca) * d;

  float rad;
  float shapeND;
  float rPix;
  if (lente) {
    // 0 no centro .. 1 na borda
    float nd = length(q / uHalf);
    float maskND = nd;
    if (uShape > 0.5) {
      float corner = min(uHalf.x, uHalf.y) * uRound;
      maskND = 1.0 + lg_sdRoundBox(q, uHalf, corner) / min(uHalf.x, uHalf.y);
    }
    // Fora da lente o quadro passa intacto — inclusive o alpha.
    if (maskND > 1.0) return base;
    shapeND = clamp(maskND, 0.0, 1.0);
    rad = clamp(nd, 0.0, 1.0);
    rPix = (uHalf.x + uHalf.y) * 0.5;
  } else {
    // A mascara JA e "0 no limpo .. 1 na borda", que e a mesma orientacao do
    // 'rad' do disco — entao todo o resto do shader vale sem mudanca.
    rad = fx_areaMask(p, uArea, uBand);
    if (rad <= 0.001) return base;
    shapeND = rad;
    // O raio caracteristico e a LARGURA DA FAIXA, nao o do quadro: e ele que
    // dita a escala da ondulacao e da dispersao, e usar meio quadro faria uma
    // faixa fina ondular com a amplitude de uma lente gigante.
    rPix = uBand * min(uResolution.x, uResolution.y) * 0.5;
  }
  vec2 radialDir = normalize(d + vec2(1e-6));
  vec2 tangentDir = vec2(-radialDir.y, radialDir.x);
  float angle = atan(q.y, q.x);

  // Puxada para dentro (a refracao) mais a ondulacao no aro. A ondulacao e duas
  // senoides de frequencias diferentes: uma so daria um aro poligonal regular,
  // que le como falha de geometria e nao como liquido.
  float pull = uZoom * 0.30 * (rad * rad);
  float rimStrength = smoothstep(0.578, 1.0, rad);
  // Frequencias 2 e 1, como no original. Eu havia posto 3 e 7, que da um aro
  // ocupado — bonito de perto e nervoso em movimento; duas ondas lentas
  // desencontradas e o que le como liquido.
  float fluid = sin(angle * 2.0) * 0.55 + sin(angle * 1.0) * 0.25;
  // As constantes abaixo sao FRACAO DO RAIO da lente, nao pixels absolutos.
  // O original mede tudo em UV de altura de tela, entao converter so as
  // coordenadas e manter os fatores deixou a ondulacao vinte vezes fraca. Em
  // fracao do raio o efeito tambem fica igual em qualquer resolucao.
  vec2 rimOff = tangentDir * fluid * rimStrength * rPix * uRipple * 1.8;
  vec2 baseP = uCenter + d * (1.0 - pull) + rimOff;

  // Dispersao cromatica: amostra ao longo de um pequeno deslocamento e pesa as
  // amostras de vermelho a azul. O peso e normalizado POR CANAL — sem isso o
  // aro clareia, porque a soma dos pesos nao e 1.
  float rimMask = smoothstep(0.55, 1.0, rad);
  // Tambem em fracao do raio: no original o desvio no aro vale ~5,6% do raio da
  // lente, e 0.19 * 0.30 (o default) reproduz isso.
  vec2 dispDir = radialDir * uDispersion * rPix * 0.19 * rimMask;
  int N = int(uSamples);
  if (N < 2) N = 2;
  if (N > LG_MAX) N = LG_MAX;
  vec3 col = vec3(0.0);
  vec3 wsum = vec3(0.0);
  for (int i = 0; i < LG_MAX; i++) {
    if (i >= N) break;
    float t = float(i) / float(N - 1);
    vec3 s = fxSample(baseP + dispDir * (t - 0.5)).rgb;
    vec3 w = vec3(
      exp(-pow((t - 0.00) / 0.38, 2.0)),
      exp(-pow((t - 0.50) / 0.38, 2.0)),
      exp(-pow((t - 1.00) / 0.38, 2.0))
    );
    col += s * w;
    wsum += w;
  }
  col /= max(wsum, vec3(0.001));

  // Desfoque suave perto do aro, que e onde o vidro real perde definicao.
  float blurFade = 1.0 - smoothstep(0.72, 0.98, rad);
  if (uBlur > 0.01 && blurFade > 0.01) {
    vec2 blurRad = vec2(uBlur) * blurFade;
    vec3 bcol = vec3(0.0);
    float btw = 0.0;
    for (int a = 0; a < 6; a++) {
      float ang = float(a) * 1.0471975;
      for (int rr = 0; rr < 3; rr++) {
        float k = 0.4 + float(rr) * 0.3;
        vec2 o = vec2(cos(ang), sin(ang)) * blurRad * k;
        float w = 1.0 - k * 0.38;
        bcol += fxSample(baseP + o).rgb * w;
        btw += w;
      }
    }
    col = mix(bcol / btw, col, rimMask);
  }

  // A LUZ do vidro sai proporcional ao que existe embaixo.
  //
  // Sem isto, num escopo de arte (onde o fundo nao entra e os pixels vazios tem
  // alpha 0) o anel, a nova e a linha de reflexo saem com rgb > 0 e alpha 0 —
  // e nessa convencao pre-multiplicada isso NAO e invisivel, e luz aditiva:
  // compoe sobre o fundo da cena e desenha a moldura colorida exatamente onde
  // se pediu que ela nao fosse. Medido: 14% dos pixels de fundo mudavam, contra
  // 0,8% do Bloom, que sangra so o halo na beirada do card.
  //
  // Fisicamente tambem e o certo: vidro reflete e refrata a luz que existe.
  // Sem card, sem luz. E em escopo de cena o fundo e opaco, entao base.a vale
  // 1 e isto nao muda nada — uma linha serve os dois casos.
  float luz = base.a;

  // Vidro escurece um pouco para o centro.
  col *= mix(0.91, 1.0, smoothstep(0.0, 0.38, shapeND));

  // Nova branca no centro, duas gaussianas: a estreita da o nucleo, a larga o
  // halo. Uma so vira bolinha dura.
  // Os fatores aqui saem das formulas do original com os defaults dele
  // (glow 4.2, whiteGlow 0.24, novaSize 12): o nucleo soma 0,08 no centro, nao
  // 0,5. A minha primeira versao somava 0,47 e estourava o meio da lente de
  // branco — eu havia normalizado os controles para 0..1 sem refazer as
  // constantes que dependiam da escala antiga.
  // So no modo lente: uma nova precisa de um CENTRO, e uma faixa de borda nao
  // tem um. Somada ali, ela viraria um clarao ao longo de toda a moldura.
  if (lente) {
    float r2 = shapeND * shapeND * 0.25;
    float gs = max(uGlow * 0.43, 0.004);
    float nova = (exp(-r2 / gs) + exp(-r2 / (gs * 7.0)) * 0.18) * uGlow * 0.23;
    col += vec3(nova) * luz;
  }

  // Anel colorido mais a aura em volta dele. O anel fica quase na borda
  // (0.49 de 0.5) e e fino: mais para dentro ele le como bolha, nao como aro.
  float dC = shapeND * 0.5;
  float tR = 0.49;
  float rW = 0.014;
  float ring = exp(-pow((dC - tR) / rW, 2.0)) * uRing * 6.7;
  // O cintilar anda com uTime, que vem do FRAME: o mesmo frame cintila igual em
  // todo render, e o ciclo fecha no loop.
  if (uShimmer > 0.001) {
    ring *= sin(angle * 12.0 + uTime * uShimmer * 6.2831853) * 0.12 + 0.88;
  }
  float aura = exp(-pow((dC - tR) / (rW * 6.0), 2.0)) * 0.28 * uRing * 2.5;
  // Mesma razao da linha de reflexo: num circulo curto o anel e um brilho de
  // vidro, correndo pelo quadro inteiro ele SATURA e vira tubo de neon. Medido
  // no default antigo, o pico somava 1,62 em ciano — acima de 1,0, ou seja
  // estourado. O fator devolve o anel para a faixa visivel.
  float ganhoAnel = lente ? 1.0 : 0.3;
  col += uRingColor * (ring + aura) * ganhoAnel * luz;

  // Linha clara na borda, o reflexo do canto do vidro. No disco ela e um fio
  // curto num circulo; numa moldura ela corre pelo quadro inteiro e soma com a
  // aura do anel ao longo de tudo — no default aquilo virava letreiro de neon.
  // Um terco da intensidade no modo de borda devolve o reflexo sem o anuncio.
  col += vec3(exp(-pow((dC - 0.488) / 0.003, 2.0)) * uRing * (lente ? 3.5 : 1.2) * luz);

  // Quanto do vidro entra. No disco e 1 dentro com uma queda de 7% no aro, para
  // nao serrilhar; na faixa a propria mascara ja e a rampa, entao ela e a
  // opacidade — o vidro nasce do nada na borda interna e fecha na externa.
  float a = lente ? smoothstep(1.0, 0.93, shapeND) : rad;
  return vec4(mix(base.rgb, col, a), base.a);
}`,
  },
};
