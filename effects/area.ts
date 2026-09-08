import type { ControlDef } from '@/lib/types';

// Onde no quadro um efeito de lente age.
//
// Compartilhado por Blur, Bloom, Tilt-shift e Liquid Glass. Os quatro nasceram
// de tela cheia e os quatro tinham o mesmo defeito: aplicados por cima de tudo,
// borram os CARDS, que sao o assunto da cena — o resultado e uma imagem
// uniformemente mole em vez de uma imagem com foco.
//
// Um lugar so para os dois controles e para a tabela de codigos, porque quatro
// copias sao quatro chances de o painel dizer "Corners" e o shader entender
// outra coisa. A matematica da mascara vive em `fx_areaMask`, injetada pelo
// montador de GLSL nos dois engines (effects/adapters/glsl.ts).

/** Painel -> uniform. A ordem tem de casar com `fx_areaMask`. */
export const AREA_CODE: Record<string, number> = {
  'Full frame': 0,
  Edges: 1,
  Corners: 2,
};

export const AREA_OPTIONS = ['Corners', 'Edges', 'Full frame'];

/** As duas linhas que todo efeito de lente ganha, iguais em todos. */
export const AREA_CONTROLS: ControlDef[] = [
  { key: 'area', label: 'Applies at', type: 'pills', options: AREA_OPTIONS, default: 'Edges' },
  {
    key: 'reach', label: 'Reach', type: 'slider', min: 2, max: 100, step: 1, default: 35, unit: '%',
    // Sem alcance nao ha o que ajustar: em 'Full frame' a mascara e 1 em todo
    // lugar e este slider nao move nada — um controle visivel que nao faz nada
    // e pior do que um controle ausente.
    visibleWhen: { key: 'area', not: 'Full frame' },
  },
];

/** Os uniforms correspondentes, para o efeito nao reescrever a conversao. */
export const areaUniforms = (v: Record<string, any>) => ({
  uArea: AREA_CODE[String(v.area ?? 'Edges')] ?? 1,
  uBand: Math.max(0, Math.min(1, Number(v.reach ?? 35) / 100)),
});

/** Os tipos, para o efeito nao reescrever isso tambem. */
export const AREA_UNIFORM_TYPES = { uArea: 'float', uBand: 'float' } as const;
