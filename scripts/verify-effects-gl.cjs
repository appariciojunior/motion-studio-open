#!/usr/bin/env node
// ============================================================
//  verify-effects-gl — compila cada efeito numa GPU de verdade e mede o efeito
//
//  scripts/verify-effects.cjs prova a ESTRUTURA (controle ligado a uniform,
//  uniform escrito, fxMain presente) e nao pode fazer mais: nao existe contexto
//  GL no Node, entao um shader que nao compila passa verde por lá.
//
//  Este abre um Chrome, compila o fragment REAL que o adaptador do Pixi gera, e
//  mede se cada efeito faz o que promete — sobre uma textura sintetica escolhida
//  para revelar exatamente aquele efeito:
//
//    grain      cinza uniforme -> o desvio padrao tem de SUBIR, e trocar o seed
//               tem de trocar o padrao (senao `animate` nao anima)
//    vignette   cinza uniforme -> o centro tem de ficar mais claro que a borda
//    rgb-split  faixa branca   -> o canal R tem de se deslocar para um lado e o
//               B para o outro, com o G parado
//    halftone   degrade liso   -> a cobertura de tinta tem de crescer com o tom
//    posterize  degrade liso   -> tem de virar exatamente N patamares, com 0 e 255
//               alcancaveis (pega o erro de dividir por n em vez de n-1)
//    scanlines  cinza uniforme -> tem de aparecer periodicidade em Y
//    wave       quadro branco  -> tem de deslocar em x, e o deslocamento tem de
//               VARIAR com y (senao e um shift, nao uma onda)
//    pixelate   ruido fino     -> blocos de N px tem de zerar a variacao interna
//
//  Uso: node scripts/verify-effects-gl.cjs
//  (nao entra no `npm test`: precisa de Chrome e de GPU)
// ============================================================

const fs = require('fs');
const path = require('path');
const Module = require('module');
const puppeteer = require('puppeteer-core');

require('sucrase/register');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, isMain, options);
};

const { effects, effectDefaults } = require('../effects');
const { passesOf, pixiFragment, threeFragment } = require('../effects/adapters/glsl');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  (process.env.LOCALAPPDATA || '') + '/Google/Chrome/Application/chrome.exe',
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });

// O fragment e os uniforms de cada efeito, em dois instantes.
const payload = {};
for (const [id, fx] of Object.entries(effects)) {
  const d = effectDefaults(id);
  payload[id] = {
    fragment: pixiFragment(fx),
    // O fragment do three tambem, para o teste de PARIDADE. O #include do three
    // nao compila cru, e a conversao final para sRGB e justamente o que se quer
    // comparar — entao ele e trocado pela transformada explicita.
    fragmentThree: threeFragment(fx)
      .replace('#include <colorspace_fragment>', 'gl_FragColor = vec4(fx_toSrgb(gl_FragColor.rgb), gl_FragColor.a);')
      // O vertex compartilhado deste teste emite vTextureCoord; renomeia para
      // linkar, em vez de manter dois vertex shaders.
      .replace(/vUv/g, 'vTextureCoord')
      .replace('varying vec2 vTextureCoord;', 'in vec2 vTextureCoord;')
      .replace(/gl_FragColor/g, 'fx_out')
      .replace(/texture2D[(]/g, 'texture(')
      // Cabecalho de ES 3.00 na frente: o vertex compartilhado deste teste e
      // 300 es, e misturar versoes nao linka.
      .replace(/^/, ["#version 300 es", "precision highp float;", "out vec4 fx_out;", ""].join(String.fromCharCode(10))),
    // TODOS os passes, para o compilador ver cada um. Um efeito separavel tem o
    // segundo passe fora de `shader`, e sem isto ele nunca chegaria a GPU — que
    // e exatamente onde `sample`, palavra reservada em GLSL ES 3.00, apareceu da
    // primeira vez, com a suite estrutural verde ao lado.
    fragmentosDosPasses: passesOf(fx).map((p) => pixiFragment(fx, p)),
    uniformsDosPasses: passesOf(fx).map((p) => p.uniforms(d, { width: 256, height: 256, time: 0 })),
    u0: fx.shader.uniforms(d, { width: 256, height: 256, time: 0 }),
    u1: fx.shader.uniforms(d, { width: 256, height: 256, time: 1 }),
    // Os valores dos CONTROLES vao junto: o esperado de um teste tem de vir da
    // intencao declarada, nao do uniform. Derivar o esperado do uniform e
    // tautologia — muta-se o uniforms() e o esperado muda com ele, entao o teste
    // sempre passa. Um teste de mutacao mostrou isso acontecendo aqui.
    defaults: d,
  };
}

// Uniforms em OUTROS pontos de um controle, para as medidas que precisam de
// mais de um. Passam pela mesma `uniforms()` do efeito — chumbar o valor aqui
// pularia a funcao e o teste deixaria de ver erro nela.
{
  const CTX = { width: 256, height: 256, time: 0 };
  const d = effectDefaults('posterize');
  payload.posterize.uMix0 = effects.posterize.shader.uniforms({ ...d, mix: 0 }, CTX);
  payload.posterize.uMix50 = effects.posterize.shader.uniforms({ ...d, mix: 50 }, CTX);
}

(async () => {
  if (!CHROME) { console.error('Chrome nao encontrado'); process.exit(2); }
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--enable-gpu', '--use-angle=gl'],
    defaultViewport: { width: 600, height: 400 },
  });
  const page = await browser.newPage();
  await page.goto('about:blank');

  const result = await page.evaluate((fx) => {
    const W = 256, H = 256;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const gl = cv.getContext('webgl2', { preserveDrawingBuffer: true });
    if (!gl) return { erro: 'sem webgl2' };

    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererName = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?';

    const VS = `#version 300 es
in vec2 aPosition;
out vec2 vTextureCoord;
void main(){ vTextureCoord = aPosition; gl_Position = vec4(aPosition*2.0-1.0, 0.0, 1.0); }`;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 0,1, 1,0, 1,1]), gl.STATIC_DRAW);

    // As texturas de teste, uma por tipo de pergunta.
    const makeTex = (fill) => {
      const px = new Uint8Array(W * H * 4);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const [r, g, b] = fill(x, y);
        px[i] = r; px[i+1] = g; px[i+2] = b; px[i+3] = 255;
      }
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const TEX = {
      cinza: makeTex(() => [128, 128, 128]),
      // faixa branca de 8px no meio, para o split ter uma borda para deslocar
      faixa: makeTex((x) => (Math.abs(x - W / 2) < 4 ? [255, 255, 255] : [0, 0, 0])),
      ruido: makeTex((x, y) => { const i = y * W + x; return [(i*37)%256, (i*91)%256, (i*17)%256]; }),
      // Ruido que varia nos DOIS eixos. O `ruido` acima nao serve para medir um
      // blur vertical: com i = y*W + x e W = 256, andar uma linha soma 256 a i,
      // e (i*37)%256 volta ao mesmo valor — a textura e constante em Y, e o
      // teste do segundo passe media zero contra zero e "passava" por acidente.
      ruido2d: makeTex((x, y) => {
        const h = (x * 73856093) ^ (y * 19349663);
        return [(h >>> 3) % 256, (h >>> 11) % 256, (h >>> 19) % 256];
      }),
      // degrade horizontal liso: revela banding (posterize) e a trama (halftone)
      degrade: makeTex((x) => { const v = Math.round((x / (W - 1)) * 255); return [v, v, v]; }),
      // O MESMO degrade, mas em espaco LINEAR — que e o que o three recebe de
      // verdade (ele trabalha linear e converte na saida). Alimentar o lado
      // three com a textura sRGB era erro do teste: dava 136/255 de divergencia
      // ate em pixelate e wave, que so deslocam coordenada e nao podem divergir.
      degradeLin: makeTex((x) => {
        const srgb = x / (W - 1);
        const lin = srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
        const v = Math.round(lin * 255);
        return [v, v, v];
      }),
      // quadro branco centrado: revela deslocamento lateral (wave)
      quadro: makeTex((x, y) => (Math.abs(x - W/2) < 40 && Math.abs(y - H/2) < 40 ? [255,255,255] : [0,0,0])),
    };

    const run = (fragment, uniforms, tex) => {
      const mk = (t, src) => {
        const sh = gl.createShader(t); gl.shaderSource(sh, src); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        return sh;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, fragment));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      const loc = gl.getAttribLocation(prog, 'aPosition');
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(prog, 'uTexture'), 0);
      gl.uniform4f(gl.getUniformLocation(prog, 'uInputSize'), W, H, 0, 0);
      gl.uniform2f(gl.getUniformLocation(prog, 'uResolution'), W, H);
      gl.uniform1f(gl.getUniformLocation(prog, 'uTime'), 0);
      for (const [name, value] of Object.entries(uniforms)) {
        const u = gl.getUniformLocation(prog, name);
        if (u === null) continue;
        if (Array.isArray(value)) {
          if (value.length === 2) gl.uniform2f(u, value[0], value[1]);
          else if (value.length === 3) gl.uniform3f(u, value[0], value[1], value[2]);
          else gl.uniform4f(u, value[0], value[1], value[2], value[3]);
        } else gl.uniform1f(u, value);
      }
      gl.viewport(0, 0, W, H);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      const out = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return out;
    };

    // ---- medidas ----
    const desvio = (px) => {
      let m = 0, n = 0;
      for (let i = 0; i < px.length; i += 4) { m += px[i]; n++; }
      m /= n;
      let s = 0;
      for (let i = 0; i < px.length; i += 4) { const d = px[i] - m; s += d * d; }
      return Math.sqrt(s / n);
    };
    const lumaEm = (px, x, y) => { const i = (y * W + x) * 4; return (px[i] + px[i+1] + px[i+2]) / 3; };
    const difere = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i]) n++; return n; };
    // centro de massa de um canal, para ver para que lado ele foi
    const centroide = (px, ch) => {
      let soma = 0, peso = 0;
      for (let y = H / 2; y < H / 2 + 1; y++) for (let x = 0; x < W; x++) {
        const v = px[(y * W + x) * 4 + ch];
        soma += v * x; peso += v;
      }
      return peso > 0 ? soma / peso : 0;
    };

    const r = { rendererName, medidas: {}, falhas: [] };

    try {
      // GRAIN: sobre cinza uniforme o desvio tem de subir; trocar o seed tem de
      // trocar o padrao, senao `animate` nao anima nada.
      const base = run(fx.grain.fragment, { ...fx.grain.u0, uAmount: 0 }, TEX.cinza);
      const g0 = run(fx.grain.fragment, fx.grain.u0, TEX.cinza);
      const g1 = run(fx.grain.fragment, fx.grain.u1, TEX.cinza);
      r.medidas.grain = {
        desvio_sem: +desvio(base).toFixed(3),
        desvio_com: +desvio(g0).toFixed(3),
        pixels_diferentes_entre_seeds: difere(g0, g1),
      };
      if (desvio(g0) <= desvio(base) + 1) r.falhas.push('grain: o ruido nao aumentou o desvio');
      if (difere(g0, g1) < W * H * 0.5) r.falhas.push('grain: trocar o seed quase nao mudou o padrao');
    } catch (e) { r.falhas.push('grain: ' + String(e.message).slice(0, 160)); }

    try {
      // VIGNETTE: centro claro, canto escuro.
      const v = run(fx.vignette.fragment, fx.vignette.u0, TEX.cinza);
      const centro = lumaEm(v, W / 2, H / 2);
      const canto = lumaEm(v, 3, 3);
      r.medidas.vignette = { centro: +centro.toFixed(1), canto: +canto.toFixed(1) };
      if (centro <= canto + 5) r.falhas.push(`vignette: centro (${centro.toFixed(1)}) nao ficou mais claro que o canto (${canto.toFixed(1)})`);
    } catch (e) { r.falhas.push('vignette: ' + String(e.message).slice(0, 160)); }

    try {
      // RGB SPLIT: numa faixa vertical, R vai para um lado e B para o outro.
      const s = run(fx['rgb-split'].fragment, fx['rgb-split'].u0, TEX.faixa);
      const cR = centroide(s, 0), cG = centroide(s, 1), cB = centroide(s, 2);
      r.medidas['rgb-split'] = { centroide_R: +cR.toFixed(2), centroide_G: +cG.toFixed(2), centroide_B: +cB.toFixed(2) };
      if (Math.abs(cR - cB) < 2) r.falhas.push(`rgb-split: R e B nao se separaram (${cR.toFixed(2)} vs ${cB.toFixed(2)})`);
      if (Math.sign(cR - cG) === Math.sign(cB - cG) && Math.abs(cR - cG) > 0.5) {
        r.falhas.push('rgb-split: R e B foram para o MESMO lado — isso desloca a imagem em vez de aberrar');
      }
    } catch (e) { r.falhas.push('rgb-split: ' + String(e.message).slice(0, 160)); }

    try {
      // POSTERIZE: um degrade liso tem de virar N patamares — nem mais nem
      // menos. Contar valores distintos e a medida direta disso, e ela tambem
      // pega o erro classico de dividir por n em vez de n-1, que deixa o branco
      // fora de alcance.
      try {
        // Pelos uniforms REAIS do efeito, nao um uSteps chumbado: passar o valor
        // a mao pula a funcao uniforms() e o teste deixa de ver erro nela. Um
        // teste de mutacao mostrou isso — trocar n-1 por n passava verde.
        const q = run(fx.posterize.fragment, fx.posterize.u0, TEX.degrade);
        const esperado = Math.round(fx.posterize.defaults.levels);
        const vals = new Set();
        for (let x = 0; x < W; x++) vals.add(q[((H >> 1) * W + x) * 4]);
        const ordenados = [...vals].sort((a, b) => a - b);
        r.medidas.posterize = { niveis: vals.size, esperado, min: ordenados[0], max: ordenados[ordenados.length - 1] };
        if (vals.size !== esperado) r.falhas.push('posterize: o controle levels pediu ' + esperado + ' niveis e a tela mostrou ' + vals.size);
        if (ordenados[ordenados.length - 1] < 250) r.falhas.push('posterize: o branco nao chega a 255 (max ' + ordenados[ordenados.length-1] + ') — sinal de dividir por n em vez de n-1');
        if (ordenados[0] > 5) r.falhas.push('posterize: o preto nao chega a 0 (min ' + ordenados[0] + ')');
      } catch (e) { r.falhas.push('posterize: ' + String(e.message).slice(0, 160)); }

      // POSTERIZE / MIX: o controle existe porque o efeito roda no quadro TODO,
      // fundo incluido, e quantizar la embaixo apaga a silhueta dos cards. Duas
      // perguntas, as duas medidas contra o que sai na tela:
      //   mix=0   tem de ser IDENTIDADE — o degrade volta com os seus ~256
      //           valores, nao com os 5 patamares
      //   mix=50  tem de cair no MEIO entre a fonte e o quantizado, ponto a
      //           ponto (o esperado vem das duas corridas medidas, nao de uma
      //           formula reescrita aqui)
      try {
        const linha = (px) => { const v = []; for (let x = 0; x < W; x++) v.push(px[((H >> 1) * W + x) * 4]); return v; };
        const fonte = linha(run(fx.posterize.fragment, fx.posterize.uMix0, TEX.degrade));
        const quant = linha(run(fx.posterize.fragment, fx.posterize.u0, TEX.degrade));
        const meio = linha(run(fx.posterize.fragment, fx.posterize.uMix50, TEX.degrade));
        const niveisFonte = new Set(fonte).size;
        let pior = 0;
        for (let x = 0; x < W; x++) {
          const esperado = (fonte[x] + quant[x]) / 2;
          const dif = Math.abs(meio[x] - esperado);
          if (dif > pior) pior = dif;
        }
        r.medidas['posterize:mix'] = {
          niveis_mix0: niveisFonte, niveis_mix100: new Set(quant).size,
          maiorDesvio_mix50: +pior.toFixed(1),
        };
        if (niveisFonte < 200) r.falhas.push('posterize: mix=0 nao e identidade — o degrade voltou com ' + niveisFonte + ' valores em vez de ~256');
        if (pior > 3) r.falhas.push('posterize: mix=50 nao cai no meio entre fonte e quantizado (maior desvio ' + pior.toFixed(1) + ')');
      } catch (e) { r.falhas.push('posterize:mix: ' + String(e.message).slice(0, 160)); }

      // HALFTONE: sobre um degrade, a cobertura de tinta tem de CRESCER conforme
      // o tom escurece. Mede a media na faixa escura contra a clara.
      try {
        const h = run(fx.halftone.fragment, { ...fx.halftone.u0, uCell: 8 }, TEX.degrade);
        const media = (x0, x1) => { let s2 = 0, n = 0; for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) { s2 += h[(y*W+x)*4]; n++; } return s2/n; };
        const escuro = media(8, 56), claro = media(W-56, W-8);
        r.medidas.halftone = { ladoEscuro: +escuro.toFixed(1), ladoClaro: +claro.toFixed(1) };
        if (claro <= escuro + 20) r.falhas.push('halftone: a trama nao segue o tom (escuro ' + escuro.toFixed(1) + ' vs claro ' + claro.toFixed(1) + ')');
      } catch (e) { r.falhas.push('halftone: ' + String(e.message).slice(0, 160)); }

      // SCANLINES: sobre cinza uniforme tem de aparecer periodicidade em Y, e a
      // media tem de CAIR (as linhas escurecem). Compara linhas pares e impares
      // no espacamento pedido.
      try {
        const base = run(fx.scanlines.fragment, { ...fx.scanlines.u0, uStrength: 0, uCurve: 0 }, TEX.cinza);
        const sc = run(fx.scanlines.fragment, { ...fx.scanlines.u0, uSpacing: 4, uStrength: 0.6, uCurve: 0 }, TEX.cinza);
        const linha = (px, y) => { let s2 = 0; for (let x = 0; x < W; x++) s2 += px[(y*W+x)*4]; return s2/W; };
        const cresta = linha(sc, H>>1), vale = linha(sc, (H>>1) + 2);
        const mediaBase = linha(base, H>>1), mediaSc = linha(sc, H>>1);
        r.medidas.scanlines = { linhaA: +cresta.toFixed(1), linhaB: +vale.toFixed(1), semEfeito: +mediaBase.toFixed(1) };
        if (Math.abs(cresta - vale) < 8) r.falhas.push('scanlines: sem periodicidade em Y (linhas a 2px: ' + cresta.toFixed(1) + ' vs ' + vale.toFixed(1) + ')');
      } catch (e) { r.falhas.push('scanlines: ' + String(e.message).slice(0, 160)); }

      // WAVE: com uSpeed 0 a fase e fixa; o quadro centrado tem de sair DESLOCADO
      // em x conforme y, e nao apenas borrado. Mede o centroide em duas alturas.
      try {
        const w0 = run(fx.wave.fragment, { uAmount: 0, uFreq: 3, uSpeed: 0 }, TEX.quadro);
        const w1 = run(fx.wave.fragment, { uAmount: 30, uFreq: 3, uSpeed: 0 }, TEX.quadro);
        const centro = (px, y) => { let soma = 0, peso = 0; for (let x = 0; x < W; x++) { const v = px[(y*W+x)*4]; soma += v*x; peso += v; } return peso > 0 ? soma/peso : -1; };
        const yA = (H>>1) - 30, yB = (H>>1) + 30;
        const semA = centro(w0, yA), comA = centro(w1, yA), comB = centro(w1, yB);
        r.medidas.wave = { semOnda: +semA.toFixed(2), comOnda_yA: +comA.toFixed(2), comOnda_yB: +comB.toFixed(2) };
        if (Math.abs(comA - semA) < 3) r.falhas.push('wave: nao deslocou nada (' + semA.toFixed(2) + ' -> ' + comA.toFixed(2) + ')');
        if (Math.abs(comA - comB) < 3) r.falhas.push('wave: o deslocamento nao varia com y — isso e um shift, nao uma onda');
      } catch (e) { r.falhas.push('wave: ' + String(e.message).slice(0, 160)); }

      // PIXELATE: blocos de N px zeram a variacao interna.
      const N = 16;
      const p = run(fx.pixelate.fragment, { uSize: [N, N] }, TEX.ruido);
      let soma = 0, blocos = 0;
      for (let by = 0; by + N <= H; by += N) for (let bx = 0; bx + N <= W; bx += N) {
        const vals = [];
        for (let y = by; y < by + N; y++) for (let x = bx; x < bx + N; x++) vals.push(p[(y * W + x) * 4]);
        const m = vals.reduce((a, b) => a + b, 0) / vals.length;
        soma += Math.sqrt(vals.reduce((a, b) => a + (b - m) * (b - m), 0) / vals.length);
        blocos++;
      }
      const dv = soma / blocos;
      r.medidas.pixelate = { desvio_intra_bloco: +dv.toFixed(3), desvio_original: +desvio(run(fx.pixelate.fragment, { uSize: [1, 1] }, TEX.ruido)).toFixed(3) };
      if (dv > 0.5) r.falhas.push(`pixelate: os blocos de ${N}px nao ficaram uniformes (desvio ${dv.toFixed(2)})`);
    } catch (e) { r.falhas.push('pixelate: ' + String(e.message).slice(0, 160)); }

    // ---- TODO PASSE TEM DE COMPILAR ----
    //
    // Um efeito separavel tem o segundo passe fora de `shader`, e as medidas
    // acima so tocam o primeiro. Sem isto, um erro de GLSL no passe vertical de
    // um blur passaria verde nas duas suites — que foi exatamente o que
    // aconteceu com `sample`, palavra reservada em GLSL ES 3.00, quando so a
    // suite estrutural existia.
    let passesCompilados = 0;
    for (const [id, e] of Object.entries(fx)) {
      const lista = e.fragmentosDosPasses || [];
      for (let i = 0; i < lista.length; i++) {
        try {
          run(lista[i], e.uniformsDosPasses[i] || {}, TEX.degrade);
          passesCompilados++;
        } catch (err) {
          r.falhas.push(id + ': passe ' + (i + 1) + '/' + lista.length + ' nao compilou — ' + String(err.message).slice(0, 140));
        }
      }
    }
    r.medidas['passes'] = { compilados: passesCompilados, efeitos: Object.keys(fx).length };

    // ---- BLUR: o desvio local tem de CAIR, e o passe 2 tem de participar ----
    //
    // Rodar so o passe horizontal deixa a variacao VERTICAL intacta. Medir os
    // dois desvios separadamente e o que distingue "borrou" de "borrou nos dois
    // eixos" — um blur separavel com o segundo passe morto passaria num teste de
    // desvio global.
    try {
      const desvioEixo = (px, dx, dy) => {
        let soma = 0, n = 0;
        for (let y = 4; y < H - 4; y += 3) for (let x = 4; x < W - 4; x += 3) {
          const a = px[((y) * W + x) * 4];
          const b = px[((y + dy) * W + (x + dx)) * 4];
          soma += Math.abs(a - b); n++;
        }
        return soma / n;
      };
      const original = run(fx.blur.fragmentosDosPasses[0], { ...fx.blur.uniformsDosPasses[0], uRadius: 0 }, TEX.ruido2d);
      // passe 1 sobre o ruido, depois passe 2 sobre a saida do 1 nao e possivel
      // aqui (o harness desenha para o canvas), entao mede-se cada passe sobre o
      // ruido: o horizontal tem de derrubar a variacao em X, o vertical em Y.
      const h = run(fx.blur.fragmentosDosPasses[0], fx.blur.uniformsDosPasses[0], TEX.ruido2d);
      const v = run(fx.blur.fragmentosDosPasses[1], fx.blur.uniformsDosPasses[1], TEX.ruido2d);
      const m = {
        original_x: +desvioEixo(original, 1, 0).toFixed(1),
        horizontal_x: +desvioEixo(h, 1, 0).toFixed(1),
        original_y: +desvioEixo(original, 0, 1).toFixed(1),
        vertical_y: +desvioEixo(v, 0, 1).toFixed(1),
      };
      r.medidas.blur = m;
      if (m.horizontal_x >= m.original_x * 0.6) r.falhas.push('blur: o passe horizontal nao derrubou a variacao em X (' + m.original_x + ' -> ' + m.horizontal_x + ')');
      if (m.vertical_y >= m.original_y * 0.6) r.falhas.push('blur: o passe vertical nao derrubou a variacao em Y (' + m.original_y + ' -> ' + m.vertical_y + ') — o segundo passe pode estar inerte');
    } catch (e) { r.falhas.push('blur: ' + String(e.message).slice(0, 160)); }

    // ---- TILT-SHIFT: a faixa em foco tem de ficar mais nitida que as pontas ----
    try {
      const nitidez = (px, y0, y1) => {
        let soma = 0, n = 0;
        for (let y = y0; y < y1; y++) for (let x = 4; x < W - 4; x += 2) {
          soma += Math.abs(px[(y * W + x) * 4] - px[(y * W + x + 1) * 4]); n++;
        }
        return soma / n;
      };
      const t = run(fx['tilt-shift'].fragmentosDosPasses[0], fx['tilt-shift'].uniformsDosPasses[0], TEX.ruido2d);
      const meio = nitidez(t, (H >> 1) - 12, (H >> 1) + 12);
      const topo = nitidez(t, 4, 28);
      r.medidas['tilt-shift'] = { faixaEmFoco: +meio.toFixed(1), foraDaFaixa: +topo.toFixed(1) };
      if (meio <= topo * 1.5) r.falhas.push('tilt-shift: a faixa de foco nao esta mais nitida que as pontas (' + meio.toFixed(1) + ' vs ' + topo.toFixed(1) + ')');
    } catch (e) { r.falhas.push('tilt-shift: ' + String(e.message).slice(0, 160)); }

    // ---- BLOOM: so o que passa do limiar transborda, e ele SOMA luz ----
    try {
      const linha = (px, x) => px[((H >> 1) * W + x) * 4];
      // A ENERGIA numa faixa ao lado, nao um pixel: o bloom espalha pouca luz
      // por muitos pixels, entao um ponto isolado mede quase nada e o teste
      // viraria uma questao de escolher bem o ponto. Somar a banda mede o que o
      // efeito realmente entrega.
      const energia = (px, x0, x1) => {
        let soma = 0;
        for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) soma += px[(y * W + x) * 4];
        return soma;
      };
      const b = run(fx.bloom.fragment, fx.bloom.u0, TEX.faixa);
      const sem = run(fx.bloom.fragment, { ...fx.bloom.u0, uIntensity: 0 }, TEX.faixa);
      const x0 = (W >> 1) + 6, x1 = (W >> 1) + 30;
      const com = energia(b, x0, x1), base = energia(sem, x0, x1);
      r.medidas.bloom = { energiaVizinha_com: com, energiaVizinha_sem: base, centro: linha(b, W >> 1) };
      if (com <= base) r.falhas.push('bloom: o brilho nao transbordou para o lado da faixa (' + base + ' -> ' + com + ')');
      if (linha(b, W >> 1) < 250) r.falhas.push('bloom: o centro da faixa branca escureceu (' + linha(b, W >> 1) + ') — bloom SOMA, nao mistura');
    } catch (e) { r.falhas.push('bloom: ' + String(e.message).slice(0, 160)); }

    // ---- PARIDADE ENTRE ENGINES ----
    //
    // O teste que faltava, e que teria pegado a divergencia de espaco de cor: o
    // contrato promete que UM shader vale nos dois engines, e ninguem estava
    // comparando as duas saidas. O three trabalha em linear e converte na saida;
    // o Pixi entrega sRGB. Sem tratar isso, o posterize caia em niveis
    // completamente diferentes (0,64,128,191,255 contra 0,137,188,225,255).
    //
    // Compara sobre o degrade, que e onde a diferenca de espaco aparece mais.
    for (const id of Object.keys(fx)) {
      try {
        const a = run(fx[id].fragment, fx[id].u0, TEX.degrade);
        const b = run(fx[id].fragmentThree, fx[id].u0, TEX.degradeLin);
        let maior = 0, soma = 0, n = 0;
        for (let i = 0; i < a.length; i += 4) {
          const d = Math.abs(a[i] - b[i]);
          if (d > maior) maior = d;
          soma += d; n++;
        }
        const media = soma / n;
        r.medidas['paridade:' + id] = { maiorDif: maior, mediaDif: +media.toFixed(2) };
        // 6 de 255 cobre arredondamento e a ida-e-volta da transformada; acima
        // disso os dois engines estao desenhando coisas diferentes.
        // A tolerancia e pela MEDIA, nao pelo pico: a ida-e-volta
        // sRGB->linear->sRGB passa por um byte de 8 bits, e nos escuros — onde a
        // curva sRGB e mais inclinada — um unico passo de quantizacao vira
        // varios niveis de volta. O pico e um artefato disso; a media diz se os
        // dois engines estao desenhando a mesma coisa.
        if (media > 4) r.falhas.push('paridade ' + id + ': pixi e three divergem, media ' + media.toFixed(2) + '/255 (pico ' + maior + ')');
      } catch (e) { r.falhas.push('paridade ' + id + ': ' + String(e.message).slice(0, 200)); }
    }

    return r;
  }, payload);

  await browser.close();

  if (result.erro) { console.error('FALHOU: ' + result.erro); process.exit(1); }
  console.log(`GPU: ${result.rendererName}\n`);
  for (const [id, m] of Object.entries(result.medidas)) {
    console.log('  ' + id.padEnd(11), JSON.stringify(m));
  }
  if (result.falhas.length) {
    console.error(`\nverify-effects-gl FALHOU — ${result.falhas.length} problema(s):\n`);
    for (const f of result.falhas) console.error('  · ' + f);
    process.exit(1);
  }
  console.log(`\nEffects GL verification passed (${Object.keys(result.medidas).length} efeitos compilados e medidos em GPU).`);
})();
