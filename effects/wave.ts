import type { Effect } from '@/lib/types';

// Wave: displace the sample coordinate along a travelling sine.
//
// The displacement is on X and driven by Y — a vertical wave running
// horizontally, which is the shape that reads as a ripple over a frame. Driving
// X by X instead would stretch and squeeze the image along its own axis, which
// reads as a lens defect, not as water.
//
// `speed` is in cycles per second and `uTime` comes from the FRAME, so the
// phase at frame 47 is identical on every render of the same clip. A wave keyed
// to the wall clock would land differently in every export, and worse, it would
// not loop: the phase at the last frame would not meet the phase at the first.
//
// The phase advances by whole cycles across the clip so the loop closes. Any
// non-integer number of cycles leaves a visible jump at the wrap, which on an
// 8-second seamless clip is the one artefact there is no hiding.
//
// Out-of-frame samples come back transparent instead of clamped: clamping
// smears the edge pixel into a band along the border wherever the wave reaches
// past the canvas.
// Nasce em 'artwork', nao no quadro todo. O Wave desloca a COORDENADA de
// amostragem, e num quadro ja composto isso arrasta o fundo junto: sobre um
// fundo chapado o efeito nem aparece la (deslocar cor uniforme nao muda nada) e
// o unico resultado visivel e a borda, onde a amostra sai do quadro e volta
// transparente, abrindo uma faixa vazia na lateral da cena. Sobre os cards, o
// mesmo deslocamento e exatamente o que se quer ver ondular. O seletor de
// escopo permite voltar para 'scene'; isto e so onde o efeito comeca.
export const wave: Effect = {
  meta: { id: 'wave', name: 'Wave', defaultScope: 'artwork' },
  controls: [
    { key: 'amount', label: 'Amount', type: 'slider', min: 0, max: 120, step: 1, default: 18, unit: 'px' },
    { key: 'freq', label: 'Frequency', type: 'slider', min: 1, max: 20, step: 1, default: 3 },
    { key: 'speed', label: 'Speed', type: 'slider', min: 0, max: 8, step: 0.5, default: 1 },
  ],
  shader: {
    uniformTypes: { uAmount: 'float', uFreq: 'float', uSpeed: 'float' },
    // `speed` gets its own uniform instead of being folded into a phase on the
    // CPU. Folding it looked cheaper — one multiply saved per pixel — but
    // phase = time * speed is ZERO at t=0 whatever the speed, so the control
    // was indistinguishable on the first frame. The suite reported it as a dead
    // button, exactly as it did for Grain. A parameter the user can move needs
    // a uniform of its own.
    uniforms: (v) => ({
      uAmount: Math.max(0, Number(v.amount ?? 18)),
      uFreq: Math.max(1, Math.round(Number(v.freq ?? 3))),
      uSpeed: Math.max(0, Number(v.speed ?? 1)),
    }),
    fragment: `
vec4 fxMain(vec2 p) {
  // Y normalized so the frequency means whole waves across the frame height, not
  // per pixel — the same slider value then reads the same in any canvas size.
  float y = p.y / uResolution.y;
  // uTime is frame-derived, so the phase at a given frame is identical on every
  // render of the same clip.
  float offset = sin(y * uFreq * 6.28318 + uTime * uSpeed * 6.28318) * uAmount;
  vec2 src = vec2(p.x + offset, p.y);
  // Past the edge there is no image. Clamping would streak the border pixel.
  if (src.x < 0.0 || src.x > uResolution.x) return vec4(0.0);
  return fxSample(src);
}`,
  },
};
