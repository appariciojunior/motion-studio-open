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
const { pixiFragment } = require('../effects/adapters/glsl');

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
    u0: fx.shader.uniforms(d, { width: 256, height: 256, time: 0 }),
    u1: fx.shader.uniforms(d, { width: 256, height: 256, time: 1 }),
    // Os valores dos CONTROLES vao junto: o esperado de um teste tem de vir da
    // intencao declarada, nao do uniform. Derivar o esperado do uniform e
    // tautologia — muta-se o uniforms() e o esperado muda com ele, entao o teste
    // sempre passa. Um teste de mutacao mostrou isso acontecendo aqui.
    defaults: d,
  };
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
      // degrade horizontal liso: revela banding (posterize) e a trama (halftone)
      degrade: makeTex((x) => { const v = Math.round((x / (W - 1)) * 255); return [v, v, v]; }),
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
