#!/usr/bin/env node
// ============================================================
//  verify-effects — invariants every effect must hold, in BOTH engines
//
//  An effect is a fragment shader now, and the two ways to get one wrong are
//  invisible until someone drags a slider on a real GPU:
//
//    · a control that reaches no uniform. Adding a slider and forgetting to
//      wire it in uniforms() leaves a knob in the panel that moves nothing —
//      and nothing crashes, so nobody notices.
//    · a uniform the shader declares but uniforms() never writes, which reads
//      as zero. For a size or a radius, zero is usually a black frame.
//
//  It also assembles the REAL fragment for each engine (effects/adapters/glsl,
//  the same module the adapters use) and checks the assembly itself: fxMain
//  present, reserved names not redeclared, no leftover conflict markers.
//
//  What it cannot do is compile GLSL — there is no GL context here. That is the
//  gap a contact sheet covers, not this.
//
//  Usage: node scripts/verify-effects.cjs
// ============================================================

const path = require('path');
const Module = require('module');

require('sucrase/register');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, isMain, options);
};

const { effectList, effectDefaults } = require('../effects');
const { pixiFragment, threeFragment, RESERVED } = require('../effects/adapters/glsl');

let assertions = 0;
const failures = [];
const fail = (id, message) => failures.push(`${id}: ${message}`);
const check = (cond, id, message) => { assertions++; if (!cond) fail(id, message); };

const SIZES = [
  { width: 1080, height: 1350, time: 0 },
  { width: 1920, height: 1080, time: 3.5 },
  { width: 400, height: 400, time: 0.0333 },
];

for (const effect of effectList) {
  const id = effect.meta?.id ?? '(sem id)';

  check(!!effect.meta?.name, id, 'meta.name ausente');
  check(Array.isArray(effect.controls), id, 'controls nao e uma lista');
  check(!!effect.shader?.fragment, id, 'shader.fragment ausente');
  check(typeof effect.shader?.uniforms === 'function', id, 'shader.uniforms nao e funcao');

  // O escopo em que o efeito NASCE. So faz sentido declarar 'scene' ou
  // 'artwork': um id de camada nao existe na hora em que o efeito e escrito, e
  // guardar `track:` aqui daria um efeito que nasce apontando para uma camada
  // de outra cena — sem alvo, ele simplesmente nao pinta.
  const escopo = effect.meta?.defaultScope;
  check(escopo === undefined || escopo === 'scene' || escopo === 'artwork', id,
    `meta.defaultScope invalido (${escopo}) — use 'scene', 'artwork', ou nada`);

  if (!effect.shader?.fragment) continue;

  // Um efeito pode ter mais de um PASSE (blur separavel: um horizontal, um
  // vertical). Verificar so `shader` deixaria o segundo passe sem rede —
  // controle morto, uniform declarado e nunca escrito, nome reservado
  // redeclarado: nada disso apareceria. Cada passe passa pelas MESMAS
  // checagens, e a contagem de asserçoes sobe junto.
  const passes = [effect.shader, ...(effect.passes ?? [])];
  for (const pass of passes) {
  check(!!pass?.fragment && typeof pass?.uniforms === 'function', id,
    'um passe esta sem fragment ou sem uniforms()');
  if (!pass?.fragment) continue;

  // ---- the fragment itself ----
  check(/vec4\s+fxMain\s*\(\s*vec2/.test(pass.fragment), id,
    'o fragment precisa definir `vec4 fxMain(vec2 p)` — e o ponto de entrada que os dois adaptadores chamam');
  check(!/<<<<<<<|>>>>>>>/.test(pass.fragment), id, 'marcador de conflito no shader');

  // Redeclaring an injected name is a compile error the adapters cannot catch.
  for (const name of RESERVED) {
    if (name === 'fxMain') continue;
    const declared = new RegExp(`\\b(uniform|varying|in|out)\\s+\\w+\\s+${name}\\b`).test(pass.fragment)
      || new RegExp(`\\bvec4\\s+${name}\\s*\\(`).test(pass.fragment);
    check(!declared, id, `redeclara \`${name}\`, que o adaptador ja injeta`);
  }

  // ---- assembly, in both engines ----
  for (const [engine, build] of [['pixi', pixiFragment], ['three', threeFragment]]) {
    let src = '';
    try { src = build(effect, pass); } catch (e) { fail(id, `${engine}: montagem lancou ${e.message}`); continue; }
    check(src.includes(pass.fragment), id, `${engine}: o corpo do efeito nao entrou no fragment montado`);
    check(src.includes('fxSample'), id, `${engine}: helper fxSample ausente`);
    const opens = (src.match(/\{/g) || []).length, closes = (src.match(/\}/g) || []).length;
    check(opens === closes, id, `${engine}: chaves desbalanceadas (${opens} abrem, ${closes} fecham)`);
  }

  // ---- controls <-> uniforms ----
  const declaredTypes = pass.uniformTypes ?? {};
  const WIDTH = { float: 1, vec2: 2, vec3: 3, vec4: 4 };
  for (const [name, type] of Object.entries(declaredTypes)) {
    check(!!WIDTH[type], id, `uniform \`${name}\` tem tipo desconhecido \`${type}\``);
    check(/^u[A-Z]/.test(name), id, `uniform \`${name}\` deveria comecar com u maiusculo (uSize, uAmount)`);
    check(pass.fragment.includes(name), id, `uniform \`${name}\` e declarado mas o shader nunca o le`);
  }

  const defaults = effectDefaults(id);
  for (const ctx of SIZES) {
    let produced;
    try { produced = pass.uniforms(defaults, ctx); }
    catch (e) { fail(id, `uniforms() lancou em ${ctx.width}x${ctx.height}: ${e.message}`); continue; }

    check(!!produced && typeof produced === 'object', id, 'uniforms() nao devolveu um objeto');
    if (!produced) continue;

    for (const [name, value] of Object.entries(produced)) {
      check(name in declaredTypes, id, `uniforms() escreve \`${name}\`, que nao esta em uniformTypes`);
      const want = WIDTH[declaredTypes[name]];
      if (!want) continue;
      const got = Array.isArray(value) ? value.length : 1;
      check(got === want, id, `\`${name}\` e ${declaredTypes[name]} mas uniforms() deu ${got} componente(s)`);
      const nums = Array.isArray(value) ? value : [value];
      check(nums.every((n) => Number.isFinite(n)), id, `\`${name}\` recebeu um valor nao finito`);
    }
    // A declared uniform that nobody writes reads as zero on the GPU, and for a
    // size or a radius zero is a black frame.
    for (const name of Object.keys(declaredTypes)) {
      check(name in produced, id, `uniform \`${name}\` e declarado mas uniforms() nunca o escreve (leria zero)`);
    }
  }

  // A knob that reaches nothing. Compared against the union over a few value
  // sets, because a control may legitimately only matter for some of them.
  const probe = { ...defaults };
  const reached = new Set();
  for (const control of effect.controls) {
    const before = JSON.stringify(pass.uniforms(probe, SIZES[0]));
    const bumped = { ...probe };
    const v = probe[control.key];
    // Cada TIPO de controle precisa da sua perturbacao. As tres primeiras
    // linhas cobrem slider, toggle e pills, que era tudo o que existia num
    // efeito. Objeto e cor entraram depois e caiam no `: v` do fim — o valor
    // saia identico, os uniforms tambem, e o provador acusava um controle
    // perfeitamente ligado como botao morto. Falso positivo, e o pior tipo:
    // pressiona a pessoa a mexer no efeito para calar o teste.
    bumped[control.key] = typeof v === 'number'
      ? (control.max !== undefined && v >= control.max ? (control.min ?? 0) : v + (control.step ?? 1))
      : typeof v === 'boolean' ? !v
      : Array.isArray(control.options) ? control.options.find((o) => o !== v) ?? v
      // xypad: {x,y}. Mexe nos DOIS eixos, senao um pad que so le `x` passaria.
      : (v && typeof v === 'object' && 'x' in v && 'y' in v)
        ? { x: Number(v.x) + 37, y: Number(v.y) - 23 }
      // cor: troca por outra bem distante, para nao cair num arredondamento
      : (typeof v === 'string' && /^#?[0-9a-f]{3,8}$/i.test(v))
        ? (v.startsWith('#') ? '#0f8a3c' : '0f8a3c')
      : v;
    const after = JSON.stringify(pass.uniforms(bumped, SIZES[0]));
    if (before !== after) reached.add(control.key);
  }
  for (const control of effect.controls) {
    check(reached.has(control.key), id,
      `o controle \`${control.key}\` nao muda uniform nenhum — botao morto no painel`);
  }

  // O ESPELHO do botao morto: um uniform que NENHUM controle move. Ele nao
  // quebra nada, so fica preso no default para sempre — na pratica um valor
  // chumbado se passando por parametro, e ninguem descobre porque a tela
  // continua desenhando.
  //
  // Isto aconteceu de verdade: o Bloom recebeu `uArea`/`uBand` e ficou sem os
  // controles correspondentes, entao o efeito nascia restrito as bordas e nao
  // havia como tirar. As duas checagens juntas fecham o circulo — uma cobre
  // controle sem uniform, a outra uniform sem controle.
  const movidos = new Set();
  for (const control of effect.controls) {
    const antes = pass.uniforms(probe, SIZES[0]);
    const alt = { ...probe };
    const val = probe[control.key];
    alt[control.key] = typeof val === 'number'
      ? (control.max !== undefined && val >= control.max ? (control.min ?? 0) : val + (control.step ?? 1))
      : typeof val === 'boolean' ? !val
      : Array.isArray(control.options) ? control.options.find((o) => o !== val) ?? val
      : (val && typeof val === 'object' && 'x' in val && 'y' in val)
        ? { x: Number(val.x) + 37, y: Number(val.y) - 23 }
      : (typeof val === 'string' && /^#?[0-9a-f]{3,8}$/i.test(val))
        ? (val.startsWith('#') ? '#0f8a3c' : '0f8a3c')
      : val;
    const depois = pass.uniforms(alt, SIZES[0]);
    for (const nome of Object.keys(declaredTypes)) {
      if (JSON.stringify(antes[nome]) !== JSON.stringify(depois[nome])) movidos.add(nome);
    }
  }
  // `fixedUniforms` e a excecao DECLARADA: constante por desenho, como a
  // direcao do passe num blur separavel. Ter de declarar mantem o portao
  // estrito — a alternativa era afrouxa-lo para todos.
  const fixos = new Set(pass.fixedUniforms ?? []);
  for (const nome of Object.keys(declaredTypes)) {
    if (fixos.has(nome)) continue;
    check(movidos.has(nome), id,
      `o uniform \`${nome}\` nao e movido por controle nenhum — esta preso no default`
      + ' (se e constante por desenho, declare em fixedUniforms)');
  }
  } // fim do passe
}

if (failures.length) {
  console.error(`\nEffects verification FAILED — ${failures.length} problema(s):\n`);
  for (const f of failures) console.error('  · ' + f);
  process.exit(1);
}
console.log(`Effects verification passed (${assertions} assertions across ${effectList.length} effect(s), both engines).`);
