# Orbit 3D — revisão do catálogo

Revisão de 9 de setembro de 2026. Comparação dos 84 presets originais de Orbit,
Orbit 3D, Ferris, Spinner e Box 3D, incluindo os ocultos. Foram inspecionadas
12 amostras do ciclo nominal das miniaturas (frames 0, 7, 19, 37, 61, 89, 119,
151, 181, 211, 231 e 240), usando os renderizadores reais Three e Pixi.
As capturas anteriores do palco com mídia também foram consideradas.
Isto é curadoria de semelhança visual, não uma afirmação de igualdade matemática.

Resultado dos 47 presets originalmente em Orbit 3D: **25 permanecem, 5 vão para
Box 3D, 1 vai para Spinner e 16 ficam ocultos**. Também ficam ocultos 2 presets da família Orbit.
Nenhum ID, controle, valor padrão, câmera ou função de movimento foi removido.

## Transferidos para Box 3D

| ID preservado | Nome anterior | Nome no catálogo | Motivo |
| --- | --- | --- | --- |
| `ring-r02` | Ring 02 | Box Fold | Giro vertical de quatro faces, com a face ocupando o quadro. |
| `ring-r08` | Ring 08 | Box Inside | Troca horizontal de quatro faces vista por dentro; difere da caixa convexa original. |
| `ring-r09` | Ring 09 | Box Inside Vertical | Contraparte vertical da troca vista por dentro. |
| `ring-r10` | Ring 10 | Box Fold Open | Giro vertical de quatro faces com abertura visível nas extremidades. |
| `ring-r11` | Ring 11 | Box Tower | Tambor vertical facetado, com o lado traseiro oculto. |

Os três Boxes originais permanecem. O grupo passa a ter oito opções, na posição
original da família no catálogo.

## Redundâncias ocultas de Orbit 3D

| Preset oculto | Versão mantida | Critério |
| --- | --- | --- |
| Orbit Showcase (`orbit-3d-02`) | Ring Stream | Faixa horizontal de placas em anel; a compressão elíptica do preset acrescenta pouco à leitura. |
| Ring Pure 04 (`orbit-3d-07`) | Ring Pure 03 | Tambor horizontal mais fino e denso. |
| Ring Pure 05 (`orbit-3d-08`) | Ring Pure 03 | Mesmo tipo de tambor, ampliado. |
| Ring Carousel 01 (`orbit-3d-10`) | Ring Carousel 02 | Carrossel diagonal de placas frontais, com maior densidade. |
| Ring Lightroom 04 (`orbit-3d-18`) | Ring Lightroom 01 | Vista interna horizontal muito mais fina e densa. |
| Ring Bloom 03 (`orbit-3d-25`) | Ring Bloom 02 | Roda frontal com o mesmo destaque por profundidade, levemente inclinada. |
| Ring Bloom 05 (`orbit-3d-27`) | Wheel 04, em Ferris | Roda radial frontal; a opção de Ferris tem enquadramento mais legível. |
| Ring 03 (`ring-r03`) | Orbit Bloom | Anel horizontal aberto; a versão mantida acrescenta pulsação do raio. |
| Ring 06 (`ring-r06`) | Ring Lightroom 05 | Vista interna horizontal de placas planas. |
| Ring 07 (`ring-r07`) | Ring Lightroom 06 | Vista interna vertical de placas planas. |
| Ring 12 (`ring-r12`) | Ring Pure 01 | Anel diagonal curvo com placas pequenas. |
| Ring 15 (`ring-r15`) | Ring Lightroom 01 | Vista interna horizontal curva. |
| Carousel 3D 01 (`carousel3d-01`) | Spinner 03 | Leque compacto inclinado; a leitura se repete na família Spinner. |
| Carousel 3D 02 (`carousel3d-02`) | Spinner 03 | Outro leque inclinado; abertura e cadência não justificam mais uma entrada. |
| Carousel 3D 03 (`carousel3d-03`) | Spinner 04 | Leque frontal com a mesma leitura geral das placas girando. |
| Carousel 3D 05 (`carousel3d-05`) | Spinner 06 | Leque denso; a concentração de placas já está representada. |

## Transferidos para Spinner

Somente Carousel 3D 04 aparece após os Spinners existentes: sua vista aproximada
e deslocada destaca uma placa lateralmente, em vez de apresentar outro leque
central. Os Carousel 01, 02, 03 e 05 ficam ocultos por sobreposição visual.
O grupo passa de 14 para 15 opções. Os cinco IDs e nomes são mantidos no registro.

A atribuição de duração em `setActiveTemplate` passa a reconhecer os Spinners,
Hinges e Fans originais pelo prefixo do ID, em vez do grupo do catálogo.
Isso evita aplicar 12 segundos aos Carousel transferidos: eles mantêm
8, 9, 8, 12 e 20 segundos para Carousel 01 a 05, respectivamente.

## Cortes na outra família

| Preset oculto de Orbit | Versão mantida em Orbit 3D |
| --- | --- |
| Orbit 01 (`orbit-01`) | Ring Carousel 05: passagem lateral com contraste de escala e pausa por etapa. |
| Orbit 03 (`orbit-03`) | Ring Bloom 02: roda de placas frontais com destaque em profundidade. |

Orbit 02 e os três Spin permanecem. Ferris e os Spinners originais mantêm seus presets: roda
plana, rotação do conjunto, dobradiça e leque não são equivalentes apenas por
terem silhuetas próximas em uma miniatura. Os cinco Carousel 3D continuam
registrados para projetos salvos, com apenas o Carousel 3D 04 visível em Spinner.
