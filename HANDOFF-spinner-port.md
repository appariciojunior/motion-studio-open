# Handoff — port fiel da família Spinner da referência

**Data:** 2026-08-20 · **Estado:** concluído e verificado · **Risco:** MÉDIO (uma
família de template + dois defaults do store; reversível, nada commitado)

Este documento é autossuficiente: quem continuar não precisa do transcript da
sessão anterior. Ele cobre (1) como a matemática foi obtida, (2) qual é ela,
(3) o que mudou no repo, (4) como isso foi provado, (5) as armadilhas medidas e
(6) o que sobrou para fazer.

---

## 1. O pedido e o método

O pedido foi "copiar certo a matemática do spinner da referência". O port
anterior tinha sido feito por observação visual e estava errado em quase todo
número. O que resolveu foi **ler o código da referência**, não medi-la.

A referência é um Next.js. O módulo de cada família — tabela de presets,
`computeFrame`, câmera, easing — vive num chunk que **só é pedido quando um
template daquela família é selecionado**. Buscar só o HTML não acha nada.

```bash
# 1. gravar as URLs dos chunks com a família aberta
MS_REF_URL=<url> MS_OUT=/tmp/ref node scripts/_chunks_ref.cjs
# 2. baixar e achar o módulo
cd /tmp/ref && mkdir -p chunks
while read u; do curl -s "$u" -o "chunks/$(basename ${u%%\?*})"; done < chunk-urls.txt
grep -l spinner chunks/*.js     # -> o módulo do Spinner (id turbopack 45638)
```

Saiu tudo em texto claro: `SPINNER_PLANE_SIZE`, `applySpinnerCamera`,
`computeFrame`, `spinnerRollRad`, `steppedSpinAngle`, `effectiveStops`,
`cardFade`, `computeViewFades`, `perspectiveToFov`, `makeRingCardMaterial` e as
**14 tabelas de preset autoradas**.

**O módulo de dados dá para executar.** Recorte o corpo do módulo turbopack
(`NNNN,e=>{…}`) e rode em `new Function('e', body)` com um `e` falso — `e.i()`
devolve stub e `e.s(arr)` lê a lista de exports de 3 em 3. Devolve
`SPINNER_DEFAULT_PARAMS` e `presetToParams` como objetos JS. Nada de regex sobre
JSON minificado.

Ground truth mais forte que pixel: **o grafo de cena ao vivo**. O three anuncia
renderer e scene num hook global se ele existir antes da construção. Instale via
`page.evaluateOnNewDocument`, embrulhe `renderer.render` para pegar a câmera (ela
não é anunciada, chega como argumento) e leia `matrixWorld` de cada mesh. É o
`scripts/_scene_spinner.cjs`.

> **Valor ao vivo ≠ valor autorado.** O editor deles força `count` para o número
> de assets demo (9) e o acoplamento recalcula `loopDuration` (12 → 18, mantendo
> 2 s por cartão). O botão *Copy Variant Values* dá o valor **ao vivo**; a tabela
> do chunk dá o **autorado**. Para portar preset, use o autorado.

---

## 2. A matemática (transcrita, não inferida)

Vive em [`templates/spinner.ts`](templates/spinner.ts). Tudo abaixo está nas
unidades da referência, no frame **y-up** dela; a conversão para a convenção do
app (y para baixo) acontece só na saída.

### Geometria — não é anel de cartões tangentes

Cada cartão é uma **pá radial** presa pela **borda interna** ao eixo de rotação.
O pivô local é girado pelo ângulo do anel e só então empurrado radialmente.

```
PLANE = 600                      // altura do cartão, SEMPRE; aspect só move a largura
across = horizontal ? 300 : 300*aspect     // metade do cartão ATRAVÉS da dobra
radius = Diameter/2                        // o painel mostra 2× orbitRadius (displayScale: 2)
pivot  = hypot(across, hinge)              // constante no giro inteiro
push   = radius !== 0 && pivot > 0.001 ? (pivot + radius)/pivot : 1

θ = index/count * TAU + spin
a = across*push ; b = hinge*push
dobra horizontal:  pos = (0, a·cosθ − b·sinθ,  a·sinθ + b·cosθ) ; euler = (θ, 0, cardRot)
dobra vertical:    pos = (a·cosθ + b·sinθ, 0, −a·sinθ + b·cosθ) ; euler = (0, θ, cardRot)
```

Os sinais da dobra vertical são **opostos** aos da horizontal (giro em +y carrega
o plano x,z ao contrário). São as duas expressões da referência, não uma
simplificação delas.

`hinge` é deslocamento ao longo da **própria normal** do cartão — é isso que
transforma o pinwheel nos presets Hinge e Fan. O empurrão radial é **somado** ao
comprimento do pivô, não o substitui: em Diameter 0 o anel fecha na borda interna
do cartão, não num ponto.

### Rig e roll — dois grupos aninhados

```
mesh → grupo interno (rotationX/Y/Z como Euler XYZ do THREE = Rx·Ry·Rz)
     → grupo externo (rotation.z = rollTurns · TAU · t/L)
     → scene
```

O **roll é de fora**. O port anterior girava a posição com `Ry·Rx·Rz`
(`tiltPointCanvas`) e a orientação com `Rx·Ry·Rz` — só aparece quando dois eixos
do rig estão ativos ao mesmo tempo, que é o caso de Spinner 03, Hinge 05 e Fan 01.

### Câmera — o pulo do gato

```
camZ = SREF·distance · tan(refFov/2)/tan(fov/2),  SREF = 600/(200·tan(refFov/2))
```

O `refFov` (12 + 61/290·98 ≈ 32,614°) **cancela**: a meia-altura em z=0 sai
`PLANE/200 · distance = 3·distance` para **qualquer** lente. É por isso que o
Perspective muda o keystone sem mudar o tamanho de um cartão de frente.

```
perspectiveToFov(p) = 2·atan( tan5° + clamp(p,0,2000)/1000 · (tan60° − tan5°) )
   → 125 = 32,7° · 840 = 100° · 1000 = 120° · 1500 = 137°
near = max(0,1 ; 0,01·camZ)
far  = camZ + (max(600·aspect, 600) + |hinge| + orbitRadius)·4 + 10
Offset panoramiza a CÂMERA (position e lookAt juntos), em fração da
meia-ALTURA nos dois eixos
```

**Zoom% = 585/distance × 100** (585 é o `distance` default deles). Dá exato nos
14 e é o mesmo número que o painel deles mostra: 688,235→85 · 780→75 · 1170→50 ·
1500→39 · 460,63→127 · 468→125 · 325→180.

Conversão para as unidades do app: `k = (ctx.height/2) / (PLANE/200 · distance)`
px por unidade de referência. Com isso a câmera fica na distância 1:1 do próprio
app (`(height/2)/tan(fov/2)`), e o cartão default mede 157 px de altura num palco
de 1080 — 0,1453 da altura do quadro, que é exatamente o que se mede no palco 4:5
deles.

### Movimento — um slot por passo

```
cycles = rollTurns > 0 ? 2·rollTurns : 1      // a Rotation DOBRA os cycles
steps  = (t/L) · cycles · count
ângulo = dir · easedPhase(steps) · (TAU/count)
dir: forward = +1, reverse = −1
```

Em Linear isso colapsa em `dir·(t/L)·cycles·TAU` — giro contínuo exato. Com
curva, ele **degraua um cartão por vez**. Aqui `easedPhase` é o certo, ao
contrário da lição de `easedphase-lurches-continuous-rings`: a referência
realmente degraua (o `steppedSpinAngle` dela conta passos inteiros e molda a
fração com a curva).

Duração autorada = **2 s por cartão**, exceto a subfamília Hinge (1,33 s; 1 s no
count 12; 1,25 s no Hinge 05).

### Fade, face e curvas

- **Fade é por profundidade de vista**, não por ângulo: normaliza pelo min/max de
  z do conjunto no frame, remapeia com `acos(1−2u)/π` e escala por `(1+n²·20)·n`.
  (O `cardFade` angular existe no módulo mas o renderer o sobrescreve com
  `computeViewFades`.)
- `fadeMode: solid` mistura para a cor de fundo, opaco → nosso `dim`;
  `alpha` afina de verdade.
- **Frontface/Backface é cull de verdade** (FrontSide/BackSide/DoubleSide),
  decidido contra a **linha de visada** — não contra o eixo z. Com Offset grande
  (Fan 03 panoramiza um terço do quadro) as duas respostas divergem.
- Curvas: `Linear`→`linear` · `Glide [.85,.15,.15,.85]`→`flow [.86,.14,.14,.86]` ·
  `Natural [.8,0,.2,1]`→`smooth [.76,0,.24,1]`. Cuidado: a constante `GLIDE_BEZIER`
  deles ([.5,0,0,1]) é uma curva **diferente** do preset chamado "Glide"; os
  presets são o que as variantes carregam.

### Os 14 presets autorados (já convertidos para os nossos controles)

Fonte: tabela do chunk, salva crua em `.shots/ref-spinner-presets-authored.json`.

| preset | count | axis | hinge | diameter | cardRot | zoom | persp | rig X/Y/Z | offset X/Y | roll | dir | curva | fade | back | forma |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Spinner 01 | 6 | horizontal | 0 | 70 | 0 | 85 | 125 | 0/0/0 | 0/0 | static | fwd | linear | 0 | show | 1:1 |
| Spinner 02 | 6 | horizontal | 0 | 70 | 0 | 85 | 125 | 0/0/0 | 0/0 | rotation | fwd | linear | 0 | show | 1:1 |
| Spinner 03 | 32 | vertical | 0 | 500 | 0 | 50 | 1500 | −60/60/90 | 0/0 | static | fwd | linear | 0 | show | 1:1 |
| Spinner 04 | 18 | vertical | 0 | 70 | 0 | 85 | 840 | −18/−4/0 | 0/7 | static | fwd | linear | 0 | show | 1:1 |
| Spinner 05 | 32 | horizontal | 0 | 70 | 0 | 85 | 1000 | 0/0/0 | 0/0 | static | fwd | linear | 0 | show | 1:1 |
| Spinner 06 | 40 | vertical | 0 | 1000 | 0 | 39 | 125 | 20/0/0 | 0/0 | static | fwd | linear | 0 | show | 4:3 |
| Hinge 01 | 9 | horizontal | 282 | 70 | 0 | 75 | 125 | −45/−45/0 | 0/0 | static | fwd | linear | 0 | show | 1:1 |
| Hinge 02 | 9 | horizontal | 282 | 70 | 0 | 75 | 125 | −45/0/0 | 0/0 | static | fwd | linear | 0 | show | 1:1 |
| Hinge 03 | 9 | horizontal | 282 | 70 | 0 | 75 | 125 | 0/−30/0 | 0/0 | static | fwd | linear | 0 | show | 1:1 |
| Hinge 04 | 12 | horizontal | 282 | 70 | 0 | 75 | 1345 | 0/−15/0 | −5/0 | static | fwd | linear | 0 | show | 1:1 |
| Hinge 05 | 12 | horizontal | 280 | 70 | 0 | 75 | 1000 | −115/−35/−15 | 0/0 | static | fwd | **flow** | 0 | show | 1:1 |
| Fan 01 | 12 | vertical | 75 | 70 | **180** | 125 | 250 | 0/−60/−180 | −16/0 | static | **rev** | **smooth** | 0 | **hide** | 4:5 |
| Fan 02 | 6 | horizontal | 0 | 50 | 0 | 180 | 150 | 0/0/0 | 0/34 | static | fwd | linear | 0 | show | 4:5 |
| Fan 03 | 9 | vertical | 0 | 440 | 0 | 127 | 1000 | −26/120/0 | 34/5 | static | fwd | linear | **13** | **hide** | 4:5 |

Duração (fixada pelo store): Spinner 01/02 e Fan 02 = 12 s · Spinner 03/05 = 64 ·
Spinner 04 = 36 · Spinner 06 = 80 · Hinge 01-04 = 12 · Hinge 05 = 15 · Fan 01 = 24 ·
Fan 03 = 18. Fan 01 e Fan 02 têm valores por artboard na referência (a tabela usa
o 4:5, que é o artboard default deles).

---

## 3. O que mudou no repo

| arquivo | mudança |
|---|---|
| `templates/spinner.ts` | reescrito (472 linhas). Toda a matemática acima, com a proveniência nos comentários |
| `store/useSceneStore.ts:365` | `cardShape` do grupo Spinner: `'4:3'` → `'auto'`. A referência autora a forma **por preset**; fixar a família em 4:3 virava todo preset quadrado numa lasca larga. `'auto'` defere ao `meta.cardAspect` de cada template |
| `store/useSceneStore.ts:328` | tabela de duração pelos valores autorados. O que a referência fixa é **segundos por cartão**, então Spinner 01/02 e Fan 02 caem de 18 s para 12 s agora que têm os 6 cartões autorados |
| `scripts/verify-reference.cjs` | seção **Spinner** nova: câmera + matrizes de mundo capturadas ao vivo, os 14 presets autorados, altura do cartão em 3 formas, fechamento de loop e finitude |
| `scripts/_chunks_ref.cjs` | **novo** — lista os chunks JS que a referência carrega com a família aberta |
| `scripts/_scene_spinner.cjs` | **novo** — lê a câmera ao vivo e a matriz de mundo de cada cartão; também reporta se o transporte está rodando e a caixa de pixels do mesmo instante |
| `scripts/_probe_spinner.cjs` | **novo** — envelope varrido do palco por **máscara de alfa**, com leitura do painel para provar qual preset carregou |
| `scripts/_sweep_spinner.cjs` | **novo** — varre um controle e mede o envelope a cada valor |
| `scripts/_dump_spinner.cjs` | **novo** — valores AO VIVO, interceptando o clipboard do *Copy Variant Values* |
| `scripts/_shot_spinner.cjs` | **novo** — uma foto do palco, com um empurrão opcional num controle |
| `.shots/ref-spinner-presets-authored.json` | os 14 presets crus, extraídos do chunk |
| `.shots/ref-spinner-scene-fan03.json` | captura ao vivo do Fan 03: câmera + 9 matrizes de mundo |

O template também virou `variant()` puro (o helper aceita curva e `meta` por
preset, incluindo `cardAspect`), então o `spinnerPreset()` local saiu.

---

## 4. Como isso foi provado

```bash
npm test                              # tilt + catalogue + contexts + reference
node scripts/verify-reference.cjs     # a seção Spinner é a que interessa
MS_FRAMES=6 node scripts/shoot.cjs spinner-01 hinge-05 fan-03   # precisa do dev server em :3000
```

Contra a referência **rodando**, em 4 presets (Spinner 01, Spinner 03, Hinge 01,
Fan 03 — que juntos exercitam dobra horizontal e vertical, hinge, rig de 1 a 3
eixos, offset e cartão 4:5):

| o quê | resultado |
|---|---|
| câmera (fov, z, near, far) | idêntica em 4 casas. Spinner 01: fov 32,6674 · z 7045,361 · near 70,454 · far 9595,4 |
| centros dos cartões | erro máx. **0,002** unidade de referência |
| normais / orientações | erro máx. **0,000** |
| conjunto visível (Fan 03, backface hide) | os mesmos 4 de 9 que o produto escalar da referência aponta |
| envelope em pixel (Spinner 01) | 0,0065 de diferença, dentro da resolução da grade |

Os números estão embutidos em `verify-reference.cjs` como tabela de proveniência,
com a explicação de cada linha (o que cada preset trava que os outros não).

---

## 5. Armadilhas medidas (não repita)

1. **Bounding box de pixel não decide câmera.** Varrer Perspective de 125 a 2000
   no palco deles moveu a caixa medida em **menos de meio por cento**: os cartões
   que estufam com lente larga são justo os que passam de perfil, e cartão de
   perfil não rasteriza nada. Uma câmera errada por fator 6 fotografa igual.
   Para pose e câmera, leia o grafo de cena.
2. **Meça o canal alfa, não a cor.** O palco renderiza sobre transparente, então
   alfa é máscara perfeita; cor com limiar apaga cartão escuro em fundo escuro.
3. **Ao converter y-up → y-down, negue o centro, não os cantos.** Escrevi
   `wy = -p.y - u.y - w.y` num script de medição e isso espelha cada cartão em
   torno de si mesmo — jogou um canto do Fan 03 para fora do quadro e quase me
   fez "consertar" o template certo.
4. **Confirme que o transporte roda** antes de acreditar em veredito de
   movimento: medi 0,352 rad/s contra TAU/18 s previstos.
5. **Clicar num nome no explorador não é prova de que carregou.** Dois presets
   medindo igual é exatamente a cara de um no-op silencioso. O
   `_probe_spinner.cjs` lê o painel por **label** (`.ed-type-section`) e imprime
   — nunca por posição de input, porque o conjunto de linhas muda por preset.
6. **Um cartão frontal pode não ser desenhado.** Se a mídia tem alfa,
   `applyMediaOverride` redimensiona a malha para o aspect da **imagem** e
   desliga o clip de canto (modo adesivo). No Fan 03 isso faz o cartão mais
   próximo desaparecer do render **deles**. É mídia, não geometria: não persiga
   com matemática. (Foi o que explicou a última divergência de envelope.)
7. Largura de viewport < desktop serve página de bloqueio: use ≥ 1600.
8. Painel oculto do Browser pane congela rAF. Todas as sondas usam puppeteer
   headless, que se considera visível.

---

## 6. O que sobrou

**Nada pendente no Spinner.** Duas coisas adjacentes, nenhuma causada por este
trabalho:

1. **`lib/exportSources.ts` está quebrado para toda família que importa
   `@/lib/tilt3d`** — a lista `CORE` de `scripts/genExportSources.mjs` não
   inclui `tilt3d`, mas o `rel()` reescreve o import para `./tilt3d`, que não
   existe no pacote (51 chaves, nenhuma `tilt3d.ts`). O snapshot também está
   defasado: a chave `spinner.ts` ainda tem o template antigo. Já existe uma
   tarefa em segundo plano com o diagnóstico completo. O gerador já normaliza
   para LF, então a armadilha de CRLF que sujava 45 chaves está resolvida.
2. **`scripts/verify-demo-slots.cjs` falha** em "removing should preserve the
   slot id". Pré-existente e sem relação: ele só toca
   `resetScene`/`addAssets`/`removeAsset`, e as duas linhas mudadas no store
   estão dentro de `setTemplate`. Não está no `npm test`.

### Próximo passo natural

Aplicar o mesmo método nas outras 6 famílias da referência (Orbit 21, Sliders 19,
Sphere 14, Spinner 14 ✅, Stickers 9, Wheel 8, Showcase 6 — 91 templates em 7
famílias). A receita, em ordem:

1. `_chunks_ref.cjs` com a família trocada no `byText('Spinner')` → achar o
   módulo → ler `computeFrame` + a função de câmera + a tabela de presets.
2. Executar o módulo de dados para tirar os presets autorados como JSON.
3. `_scene_spinner.cjs` (mesma troca de família) para a câmera e as matrizes de
   mundo ao vivo — é o ground truth.
4. Portar, e travar os números numa seção nova de `verify-reference.cjs`.
5. Pixel só para confirmação ponta-a-ponta, com máscara de alfa.

Módulos já localizados de graça no mesmo chunk (`05cmunxxve1s5.js`) durante esta
extração, para quem for atacar as próximas: a família **Orbit/ring** está no
módulo 41034 (`ARC_FOV = 35`, `ARC_REF_CARD = 350`, `applyCamera`,
`computeFrame` com `boomerang`/`staggerOrder`) e o módulo 25001 tem
`applyRingCamera`, `ringSlots`, `ringRadius`, `ringCardScale`,
`buildCardGeometry` (a superfície `cylinder`), `steppedSpinAngle` e `cardFade`
— compartilhados por várias famílias.

---

## 7. Onde estão as coisas

- Template: [`templates/spinner.ts`](templates/spinner.ts)
- Teste de fidelidade: `scripts/verify-reference.cjs`, seção `SPINNER_SCENES`
- Sondas: `scripts/_chunks_ref.cjs`, `_scene_spinner.cjs`, `_probe_spinner.cjs`,
  `_sweep_spinner.cjs`, `_dump_spinner.cjs`, `_shot_spinner.cjs`
- Dados crus: `.shots/ref-spinner-presets-authored.json`,
  `.shots/ref-spinner-scene-fan03.json`
- Folhas de contato: `.shots/spinner-*.jpg`, `hinge-*.jpg`, `fan-*.jpg` (nossas) e
  `.shots/ref-*.jpg` (deles)
- Memórias gravadas nesta sessão: que os chunks da referência trazem a
  matemática em texto claro, que o spinner dela é uma esteira de pás com
  dobradiça, e que envelope de pixel é instrumento fraco
