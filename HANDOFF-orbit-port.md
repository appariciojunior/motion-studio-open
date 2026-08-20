# Handoff — port fiel das famílias Orbit, Arc e Wheel da referência

**Data:** 2026-08-20 · **Estado:** concluído e verificado · **Risco:** MÉDIO
(três famílias de template + a tabela de duração/artboard do store; reversível)

Orbit (§1–§9) é o corpo do documento; o Arc está no §10, o Wheel no §11 e o
controle Card Bend que voltou depois, no §12.

Continuação natural de [`HANDOFF-spinner-port.md`](HANDOFF-spinner-port.md), pelo
mesmo método: **ler o código da referência**, não medi-la. Este documento é
autossuficiente.

---

## 1. O que era e o que ficou

O `templates/orbit3d.ts` anterior tinha 21 presets da referência portados **por
observação visual** (bounding box + sweep de controle). Estava errado em quase
todo número, e três coisas eram estruturalmente inexpressáveis:

| o quê | antes | agora |
|---|---|---|
| lente | fov máximo 50° | `perspectiveToFov`, 10°–147° |
| subfamília Lightroom | impossível (câmera sempre fora do anel) | 8 presets, a câmera **dentro** do tambor |
| presets da referência | 21 | **24** (Lightroom 06/07/08 não existiam aqui) |
| modelo do anel | raio vem do canvas, cartão preenche fração do slot | cartão fixo em 100, raio é o que faz o slot ter exatamente um cartão |

Os 3 presets que são nossos (`orbit-3d-01..03`, Ring Stream / Orbit Showcase /
Orbit Bloom) continuam no catálogo, reexpressos na nova parametrização, com os
mecanismos próprios (elipse do Showcase, pulso do Bloom) preservados como
extensão em cima do anel — todos os 24 portados deixam `style` em `stream`, onde
os três termos valem exatamente 1, 1 e 0.

---

## 2. Onde está a matemática

Chunks da referência, com a família Orbit aberta:

```bash
MS_REF_URL=<url> MS_OUT=/tmp/ref MS_FAMILY=Orbit MS_PRESET='Pure 01' node scripts/_chunks_ref.cjs
cd /tmp/ref && mkdir -p chunks
while read u; do curl -s "$u" -o "chunks/$(basename ${u%%\?*})"; done < chunk-urls.txt
grep -l ringRadius chunks/*.js
```

| módulo | o que tem |
|---|---|
| **25001** | `ringRadius`, `ringSlots`, `ringCardScale`, `ringWrapSign`, `buildCardGeometry`, `steppedSpinAngle`, `cardFade`, `applyRingCamera`, `ringFacing` |
| **42981** | `computeRingFrame` — o grupo do anel gira por `-spin` |
| **34379** | o renderer do palco: qual grupo carrega a escala do cartão, onde fica o pivô do Bloom, como Fade/Contrast/Isolation são aplicados de verdade |
| **51437** | `computeViewFades` — o fade é por **profundidade de vista**, não por ângulo |
| **87645** | `perspectiveToFov` (compartilhado com o Spinner) |
| **92414** | o **export MP4** — e é aqui que estava a peça que faltava (§4) |

A tabela dos 24 presets autorados sai executando o módulo de dados (o mesmo
truque do Spinner): está crua em `.shots/ref-orbit-presets-authored.json`, e em
tabela em `.shots/ref-orbit-baselines.tsv`.

---

## 3. A matemática (transcrita)

Unidades da referência, frame y-up; a conversão para a convenção do app
(y para baixo) acontece só na saída.

```
extent = |100·aspect·cos(cardRotation)| + |100·sin(cardRotation)|   // largura do cartão na tangente
perUnit = surface==='cylinder' ? TAU/n : 2·tan(π/n)                 // arco para Wrap, corda para Flat
W = extent / perUnit          // o raio que o Gap NÃO move
R = W + Diameter/2            // orbitRadius do painel tem displayScale 2
cardScale = clamp(perUnit·R / (extent·(1+gap/100)), 0.05, 8)        // ringCardScale
```

Em Diameter 0 e gap g isso colapsa em `cardScale = 1/(1+g/100)` — exatamente a
lei que já estava **medida** varrendo o painel deles ("Gap não mexe no raio;
cardSize = 100/(1+gap/100)"). Com Diameter > 0 o slot cresce e o cartão cresce
com ele.

**Pose.** Dois grupos acima dos cartões: o externo carrega Rotation X/Y/Z como
Euler XYZ do THREE (`Rx·Ry·Rz`), o interno carrega o giro em y. O rig fica **por
fora** do giro.

```
φ = i/n·TAU + spin ;  face = φ + (flip ? π : 0)
pivot = (cardTilt ≥ 0 ? -50 : +50) · cardScale        // Bloom gira na ARESTA
centro = Rig · ( R·sinφ − pivot·sinT·sin(face),
                 pivot·(1−cosT),
                 R·cosφ − pivot·sinT·cos(face) )
quat   = qRig · Ry(face) · Rx(cardTilt) · Rz(cardRotation)
```

Billboard (`Face: Billboard`): o `CameraBillboard` deles põe o quaternion de
**mundo** do cartão igual ao da câmera — paralelo ao plano da imagem, não
apontado para a lente. Nossa câmera nunca rotaciona, então esse quaternion é a
identidade, e o pivô do Bloom passa a girar em eixos de mundo, **fora** do rig.

**Câmera.**

```
fov  = perspectiveToFov(perspective)      // tan(fov/2) de tan5° a tan60° em 0..1000, clamp 2000
frame = W · zoomFactor(distance)          // meia-altura do quadro em z=0, para QUALQUER lente
dist  = frame / tan(fov/2)
zoomFactor(d) = c ≤ 0.02 ? 0.35 : 1.05 + (c−0.02)/0.98 · 2.15,  c = d·3/1000
near = max(0.01, 0.01·dist) ; far = dist + 6·W
Offset panoramiza a CÂMERA por fração da meia-altura do quadro nos DOIS eixos
```

**Zoom% = 247/distance × 100** (247 é o `distance` default deles). Exato em 22
dos 24; Bloom 01 (290) e Bloom 05 (207) foram arrastados, não digitados.

**Movimento.** Um slot por passo: `floor(p) + curva(min(1, frac(p)/move))` com
`move = 1 − pause/passo`. Em Linear sem pausa colapsa em giro contínuo exato.
A pausa implícita deles (quando o preset tem curva mas não tem pause) é
**0,125 do passo**, ou seja Hold 12,5%.

**Fade** é por profundidade de vista, normalizada pelo min/max do conjunto no
frame, remapeada por `acos(1−2u)/π` e escalada por `(1+n²·20)·n`. `solid`
escurece (nosso `dim`), `alpha` afina.

**Contrast** ENCOLHE os distantes: `1 + (1/(1+c/100) − 1)·u`. Em 200 o fundo do
anel é um terço da frente.

**Wrap** não é uma quantidade livre: o cartão segue o próprio círculo do anel,
`sag = R·(1 − cos(extent/2R))`, e o sinal é **negativo** na convenção do nosso
`bend` (o centro do cartão fica adiante das bordas). O `flip` inverte, como o
`ringWrapSign` deles.

---

## 4. A peça que faltava: o palco deles é uma JANELA

Depois de a câmera bater em quatro casas com o grafo de cena ao vivo, o palco
deles ainda fotografava o tambor **2,1× maior** do que essa câmera comporta.
Nenhuma das duas leituras estava errada:

- o canvas do palco é um **quadrado do tamanho da largura da janela** do
  navegador — 1600×1600 num viewport 1600×1000, 1900×1900 em 1900×1200 (medido,
  `scripts/_canvas_orbit.cjs`);
- o artboard é uma caixa CSS **bem menor** no meio dele (598×748);
- e o export MP4 clona a câmera e chama

```js
camera.setViewOffset(canvasCssW, canvasCssH, board.x, board.y, board.w, board.h)
```

ou seja, **o vídeo é exatamente o retângulo do artboard** dentro de um quadro
maior. A composição é a janela, não o canvas.

A fração medida foi **0,4675** (1600×1000) e 0,4832 (1900×1200) — não é
constante do lado deles, porque o canvas segue a LARGURA do viewport e o
artboard segue a ALTURA. A nossa é constante: `BOARD_CROP = 0.4675`, o valor no
viewport 1600×1000 que todas as sondas deste repo usam.

> ⚠️ **Recorte é viewport, não distância.** Puxar a câmera para trás por 1/crop
> parece a mesma correção e **se cancela exatamente** — o render voltou
> pixel-idêntico ao sem recorte e só projetar a pose à mão
> (`scripts/_frame_orbit.cjs`) mostrou por quê. O equivalente de uma janela numa
> câmera de quadro cheio é uma **lente mais estreita** na mesma distância:
> `fov_visível = 2·atan(crop · tan(fov/2))`.

---

## 5. Uma divergência deliberada: Backface

`ringFacing` escolhe o lado do material como
`frontface_visível !== (flip === 'yes') ? FrontSide : BackSide`. Esse XOR corta
a face errada quando os dois estão em jogo: **Lightroom 05, 06, 07 e 08
renderizam VAZIO no build deles**. Confirmado não por leitura de canvas (que
mente no palco deles — `toDataURL` volta limpo), mas por screenshot composto:
`.shots/ref-orbit-stage-lightroom-05.png` mostra o artboard 4:5 em branco com o
painel indicando Lightroom 05 carregado.

Reproduzir quatro presets vazios não vale nada, então aqui **Backface significa
o que diz** — não desenhar o verso de um cartão — e o papel do `flip` é só
decidir para que lado a foto aponta, que é o que torna legível um anel filmado
de dentro. `verify-reference.cjs` tem a asserção que mantém os quatro desenhados.

---

## 6. O que mudou no repo

| arquivo | mudança |
|---|---|
| `templates/orbit3d.ts` | reescrito (≈770 linhas). Toda a matemática acima, com a proveniência nos comentários. 3 presets nossos + 24 da referência |
| `templates/arc.ts` | **novo** — o motor do arco (§10), 3 presets |
| `templates/wheelEllipse.ts` | **novo** — a família Wheel deles (§12), 5 presets |
| `store/useSceneStore.ts` | tabela de duração por preset (o autorado deles), `cardShape: 'auto'` para `orbit-3d-*` (a forma é por preset) e artboard por preset (1:1 nos cinco Pure, 4:5 no resto) |
| `scripts/verify-reference.cjs` | seção **ORBIT 3D** nova: 6 presets contra o grafo de cena ao vivo (câmera, centros, orientações e a escala por cartão), os 24 presets autorados, fechamento de loop, finitude, "desenha algo" e 2D = projeção do 3D |
| `scripts/verify-tilt.cjs` | a lista de quem degraua e quem gira contínuo passou a vir da tabela autorada — Lightroom 04 estava na lista errada |
| `scripts/_chunks_ref.cjs` | parametrizado por `MS_FAMILY`/`MS_PRESET` |
| `scripts/_scene_orbit.cjs` | **novo** — câmera e matriz de mundo por cartão, ao vivo |
| `scripts/_canvas_orbit.cjs` | **novo** — o que é o canvas do palco deles, de verdade |
| `scripts/_shot_orbit.cjs` | **novo** — fotografa o ARTBOARD deles (screenshot composto, não `toDataURL`) |
| `scripts/_frame_orbit.cjs` | **novo** — projeta a nossa pose em px de canvas, sem browser |
| `lib/exportSources.ts` | snapshot regenerado (também corrigiu a chave `spinner.ts`, que estava defasada) |
| `.shots/ref-orbit-*` | presets crus, tabela, captura ao vivo e fotos do palco deles |

---

## 7. Como isso foi provado

```bash
npm test                                   # 4 suítes, todas verdes
node scripts/verify-reference.cjs           # a seção ORBIT 3D é a que interessa
node scripts/_frame_orbit.cjs orbit-3d-04   # enquadramento em px, sem browser
MS_FRAMES=4 node scripts/shoot.cjs orbit-3d-04 orbit-3d-15 orbit-3d-23   # precisa do dev server
node scripts/_shot_orbit.cjs "Pure 01" "Lightroom 01" "Bloom 01"          # o palco deles
```

Contra a referência **rodando**, em 6 presets (Pure 01, Pure 05, Carousel 04,
Lightroom 04, Bloom 01, Bloom 03 — que juntos exercitam wrap e flat, Diameter,
Gap negativo, billboard, Contrast, flip, o pivô do Bloom, rig de 1 a 3 eixos e
Offset):

| o quê | resultado |
|---|---|
| câmera (fov, z, near, far, pan) | idêntica em 4 casas |
| centros dos cartões | erro máx. **< 1,2** unidade de referência |
| orientações | erro máx. **< 0,01** |
| escala por cartão (lei do Gap × lei do Contrast) | erro máx. **< 0,01** |
| enquadramento (Pure 01) | tambor em 0,73 da altura do quadro; o palco deles mede ≈0,74 |

---

## 8. Armadilhas medidas (não repita)

1. **`toDataURL` mente no palco deles.** Sem `preserveDrawingBuffer`, ler o
   canvas fora do frame de desenho devolve buffer limpo: dois presets mediram
   "nada desenhado" estando corretos. Use screenshot composto.
2. **Recorte é viewport, não distância** — ver a caixa no §4.
3. **O editor deles força `count` para o número de assets demo.** Lightroom 05 é
   autorado com 6 e mede 9 ao vivo. Para portar preset, use o autorado.
4. **O artboard deles não é o canvas.** Comparar o nosso palco com o canvas
   deles (ou com os thumbnails, que são paisagem) faz conversão certa parecer
   errada.
5. **Ângulo de skew é diferença de dois `atan2`** e pode cair em ramos
   diferentes em frames que desenham a mesma coisa: o `verify-tilt` pegou um
   delta de 6,283 na costura. Embrulhe.
6. **Um Layout slider que não move a pose é morto** para o `verify-tilt` — e o
   Offset não move a pose, move a câmera. Ele mora na seção Camera.
7. Largura de viewport < desktop serve página de bloqueio: use ≥ 1600.

---

## 9. O que sobrou

1. **`lib/exportSources.ts` não inclui `tilt3d.ts`** — `CORE` em
   `scripts/genExportSources.mjs` não o lista, mas o `rel()` reescreve o import
   para `./tilt3d`. Pré-existente (está no §6 do handoff do Spinner), afeta toda
   família que importa `@/lib/tilt3d`, inclusive esta. Uma linha resolve; não
   toquei por estar fora do escopo pedido.
2. **`store/useSceneStore.ts` está CRLF na árvore de trabalho** e LF no HEAD —
   convertido por uma sessão anterior, não por esta. O diff do arquivo aparece
   inteiro por isso.
3. **`scripts/verify-demo-slots.cjs` falha** em "removing should preserve the
   slot id". Pré-existente, fora do `npm test`.
4. **Squircle** (`holderShape`) não foi portado: este app arredonda cantos com
   `roundRect`. Só o Pure 06 usa `normal`; os outros 23 usam squircle.
5. **Wrap + Rotation ±90**: nosso eixo de bend é sempre a LARGURA do cartão, o
   deles é o x da geometria **depois** da rotação no plano. Divergem só no
   Pure 06, cujo cartão é quadrado — a profundidade do sag está certa, só a
   direção da curva difere.

### Próximo passo natural

Sobram as famílias **Sliders**, **Sphere**, **Stickers** e **Showcase** deles —
mesma receita: `_chunks_ref.cjs` com a família trocada, achar o módulo, ler
`computeFrame` + câmera + tabela de presets, executar o módulo de dados, travar
contra o grafo de cena ao vivo. Orbit (24), Spinner (14), Arc (3) e Wheel (5)
estão portados.

---

## 10. Arc — o outro motor (`templates/arc.ts`)

**Atenção ao escopo:** o Arc **não é da família Orbit deles**. No código é
`category:"Wheel"`, subcategoria "Wheel — Arc", **3 presets** (Arc 01/02/03) —
o explorador só os lista perto dos do anel. Aqui ele entrou no grupo **Ferris**,
que é onde mora a nossa família de roda.

Matemática no módulo **41034**, mais os helpers de movimento compartilhados
(70418 `motionFromParams`/`roundsPerLoop`, 88461 `computeProgress`/`staggerOrder`).

**A mecânica:** os cartões estão colados na borda de uma roda enorme (raio 1250
a 2400 contra um cartão de 500) e o quadro olha a **crista** dela. Nada tem
profundidade — todo cartão fica em z=0 e a câmera perspectiva só define a
escala.

```
sweep = 55° + (clamp(gap,4,80) − 4)/76 · 50°      // Gap é ÂNGULO, não distância
pitch = 2·sweep / count
R = clamp(Diameter/2, 600, 2400)                  // o painel mostra 2× o raio
pos = ( R·sin a , −R·(1 − cos a) ) ; rot = −a      // frame y-up deles
halfH = ARC_REF_CARD/200 · distance = 1,75·distance
camZ = 350/(200·tan(17,5°)) · distance ; near = 0,02·camZ ; far = 4·camZ + 4000
```

**A coincidência que prova a leitura:** no Gap 20 autorado, com 8 cartões numa
roda de 1250, o arco entre vizinhos dá **357,4** unidades e o cartão mede
500 × 5/7 = **357,1** de largura. Encostam exatamente.

**Duas diferenças medidas em relação ao anel:**

1. **Não tem recorte de artboard.** A câmera ao vivo volta com aspect **0,7995**
   contra o artboard 4:5 dele, onde toda captura do anel voltou quadrada — o
   renderer do arco dimensiona o canvas pelo artboard. A foto confirma: cartão
   em 0,35 da altura do quadro, não 0,75.
2. **O Zoom do painel deles usa outra base.** O valor ao vivo é o distance 408
   (camZ 2264,519, confere em três casas) e o painel mostra **75%**, ou seja
   base 306. O nosso 100% É o valor autorado; não "conserte" para bater com o
   rótulo deles.

**Uma restatização, não uma cópia:** os slots deles ficam parados e as
**texturas** rodam entre eles (13 slots para 9 cartões). Neste app a imagem é
presa ao cartão pelo clipe inteiro, então aqui o **cartão** viaja e dá a volta
numa janela de `count` pitches. Mesmo conjunto de pares (ângulo, imagem) em todo
instante — só ~7 pitches são visíveis — e fecha o loop de graça.

**Não portado:** a sombra dele (um quad suave atrás de cada cartão; as sombras
deste app vêm de luz real e querem receptor, que uma fileira plana não tem) e o
`holderShape` squircle.

Provado em `verify-reference.cjs`, seção **ARC**: todo cartão a 1250,0 da borda
da roda, cada um tangente a ela, o pitch exato no frame 0, o "encostam
exatamente", a altura do cartão em px, fechamento de loop e finitude nos 3.

---

## 11. Wheel — a terceira família (`templates/wheelEllipse.ts`)

Categoria **Wheel** deles, 5 presets, que aqui entraram no grupo **Ferris** com
ids `wheel-r01..05` (a convenção que o repo já usa para port de referência, como
`flicker-r01`). Módulo **24248** para a matemática, **478** para a tabela,
**44392** para o renderer.

```
rx = max(1, orbitRadius) + planeSize/2 + max(0, gap)     // MEIO CARTÃO no raio
ry = rx · (1 − clamp(ellipticity, 0, 0.9))
spoke = i/n·TAU + (static ? spin : 0)
grupo = ringRotation + (static ? 0 : spin)
meshRot = radial ? spoke − π/2 : −grupo
halfH = 170/200 · distance ; camZ = 170/(200·tan(17,5°)) · distance
```

**O meio cartão no raio** é o número que nenhuma outra leitura acerta: com
orbitRadius 350 e cartão 75, o grupo do primeiro cartão fica em x = **387,5** no
grafo ao vivo. Zoom% = 631/distance × 100 (todos os 5 usam 631, logo 100%).

**O acoplamento do Spin é a família inteira.** `rotate` gira o grupo e os
cartões vão junto; `static` deixa o grupo parado no Axis e faz o **ângulo de
cada cartão** avançar, então com Card Align `normal` eles seguem em pé enquanto
viajam — a roda-gigante de verdade. Numa circunferência os dois modos são
**indistinguíveis**; só a elipse os separa, e é por isso que a asserção que vale
travar é "o Wheel 05 nunca sai da elipse fixa".

**Três ausências que importam:** não tem **fade** (o renderer passa uVis 1 e
força backface show — Contrast é a única pista, e é por **altura de tela**, não
profundidade); é **plana** (todo cartão em z=0, com um bank de 0,15° que existe
só para não haver z-fighting); e **não tem recorte de artboard** (o renderer fixa
o aspect pela caixa do palco e desenha num `setViewport` desse tamanho).

Artboard autorado da família: **1:1** (o default, que nenhum dos 5 sobrescreve).

Provado em `verify-reference.cjs`, seção **WHEEL**: a elipse e o alinhamento no
frame 0 nos dois presets extremos, a altura do cartão em px, a invariante da
elipse fixa do Wheel 05 ao longo do clipe, os 5 presets autorados, fechamento de
loop e finitude. Conferido também contra foto do palco deles: a elipse ocupa
0,84 da altura do quadro lá e 0,83 aqui.

**Não portado:** sombra de cartão e sombra por silhueta, `holderShape` e o bank
de 0,15°.

---

## 12. Card Bend voltou (pedido depois do port)

O port fiel troca o antigo `cardBend` livre por `surface: flat | cylinder`,
porque na referência a curva **é derivada** — o cartão segue o próprio círculo
do anel e não há quantidade a escolher. Só que o controle livre estava em uso,
então ele voltou **somando** por cima:

```
bend = sinal_do_flip · ( cardBend/100 − hug )
hug  = surface==='cylinder' ? R·(1 − cos(extent/2R)) / (100·aspect) : 0
```

Em Card Bend 0 o Wrap continua exato. Positivo **cupa para dentro** (o centro do
cartão recua da própria face frontal, indo na direção do centro do anel);
negativo **abaúla para fora**, na direção de quem vê. O Flip vira os dois
termos, senão o mesmo slider significaria coisas opostas nos presets que o usam.

Conferido numericamente (`scripts/_bend_orbit.cjs`) e visualmente
(`.shots/BEND-orbit-3d-04.jpg`, varredura −30 / 0 / +30 feita com
`scripts/_sweep_ours.cjs`). Todos os 24 presets portados ficam em 0, então
nenhum deles mudou.
