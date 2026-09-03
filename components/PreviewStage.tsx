'use client';

import { useEffect, useRef } from 'react';
import { SceneRenderer } from '@/lib/renderer';
import type { IRenderer } from '@/lib/rendererTypes';
import { setRendererInstance } from '@/lib/rendererInstance';
import { useSceneStore } from '@/store/useSceneStore';
import { getTemplate } from '@/templates';

// Um renderer por engine, guardado pela vida da pagina.
//
// Antes, trocar de engine (escolher um preset webgl com um 2D no palco, ou o
// contrario) destruia o renderer e criava outro do zero. Os dois caminhos de
// destruicao machucam, cada um do seu jeito:
//
//   - Pixi: `app.destroy()` chama `loseContext()` la dentro (esta escrito em
//     GlContextSystem.destroy(), nao e suposicao), e o Chrome SOMA as perdas
//     causadas pela pagina. Passado o limite dele, a criacao seguinte volta
//     "A WebGL context could not be created. Reason: Web page caused context
//     loss and was blocked" — e ai nada mais consegue contexto: a miniatura 3D
//     cai para 2D, o Pixi da miniatura tambem falha, e o PALCO morre em
//     `renderer3d.init` com unhandledRejection. O editor inteiro vai junto.
//   - three: `dispose()` NAO solta o contexto, entao o antigo fica vivo e
//     abandonado, contando contra o limite de ~16 contextos da pagina.
//
// Medido alternando Orbit 3D (webgl) e Runway (2D) dez vezes: perdas causadas
// pela pagina subindo 2, 3, 4 ... 11, uma por troca, linear e sem teto, e 11
// contextos criados no `stage-canvas`. Reusando, a conta para em um por engine.
//
// O canvas nao pode ser compartilhado entre as duas bibliotecas — atributos de
// contexto e comportamento de perda diferem — entao cada engine guarda o SEU
// canvas junto, e trocar de engine e trocar qual dos dois esta no DOM.
type Palco = { renderer: IRenderer; canvas: HTMLCanvasElement };
const palcos = new Map<'pixi' | 'webgl', Palco>();
// Criacao em voo, para que duas montagens do mesmo engine compartilhem UMA. Sem
// isto, o Strict Mode do dev cria dois renderers por montagem e descarta um, e
// descartar custa uma perda de contexto contada contra a pagina.
const emCriacao = new Map<'pixi' | 'webgl', Promise<Palco>>();

function obterPalco(engine: 'pixi' | 'webgl', canvas: HTMLCanvasElement): Promise<Palco> {
  const pronto = palcos.get(engine);
  if (pronto) return Promise.resolve(pronto);
  const emVoo = emCriacao.get(engine);
  if (emVoo) return emVoo;
  const p = (async () => {
    const renderer: IRenderer = engine === 'webgl'
      // three stays out of the bundle for 2D-only sessions
      ? new (await import('@/lib/renderer3d')).SceneRenderer3D()
      : new SceneRenderer();
    await renderer.init(canvas);
    const entrada: Palco = { renderer, canvas };
    palcos.set(engine, entrada);
    return entrada;
  })();
  emCriacao.set(engine, p);
  // Uma criacao que falha nao pode ficar guardada, senao a proxima tentativa
  // recebe a mesma falha para sempre.
  p.finally(() => { emCriacao.delete(engine); }).catch(() => { /* tratado no chamador */ });
  return p;
}

// Live 2D/WebGL preview stage
export default function PreviewStage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<IRenderer | null>(null);
  const rafRef = useRef<number>(0);
  const anchorTimeRef = useRef<number>(0);   // wall-clock at playback start
  const anchorFrameRef = useRef<number>(0);  // frame at playback start
  const lastRenderedFrameRef = useRef<number | null>(null);
  const dirtyRef = useRef<boolean>(true);    // a paused preview redraws only when this is set
  const lastPlayingRef = useRef<boolean>(true);
  // React Strict Mode deliberately starts, cleans up and starts effects again
  // in development. The renderer import is asynchronous, so an obsolete start
  // must not claim (and later force-loss) the canvas owned by the newer one.
  const initGenerationRef = useRef(0);

  const width = useSceneStore((s) => s.width);
  const height = useSceneStore((s) => s.height);
  // Engine flag drives a full canvas remount — a canvas can never be reused
  // across GL libraries (context attributes and loss behaviour differ).
  //
  // Layer stacking is a 2D compositing feature: only the Pixi renderer draws a
  // container per track. So a stack of two or more layers stays on Pixi even if
  // the selected track's template is webgl — that template falls back to its own
  // 2D `transform`, which every template provides. Otherwise selecting a webgl
  // layer would swap in the single-motion 3D renderer and the other layers would
  // vanish.
  const engine = useSceneStore((s) =>
    s.tracks.some((track) => track.visible && getTemplate(track.templateId).meta.engine === 'webgl')
      ? 'webgl'
      : 'pixi',
  );

  useEffect(() => {
    const initGeneration = ++initGenerationRef.current;
    let mounted = true;
    let renderer: IRenderer | null = null;
    const guardado = palcos.get(engine);
    // O canvas deste engine: o que ja existe, ou um novo na primeira vez.
    const canvas = guardado?.canvas ?? document.createElement('canvas');
    canvas.className = 'stage-canvas';
    // The canvas belongs to this exact renderer generation. Keeping it in a
    // local variable prevents an obsolete async Pixi init/cleanup from ever
    // claiming the canvas created for Three (or vice versa).
    stageRef.current?.replaceChildren(canvas);

    // Render only when there's something new to show: while playing (frame
    // advancing), or once after any state/texture change while paused. An idle
    // paused preview draws nothing — no wasted GPU/CPU at 60fps on a still image.
    const loop = () => {
      if (!mounted || initGeneration !== initGenerationRef.current || !rendererRef.current) return;
      const st = useSceneStore.getState();

      // freeze/resume card video decoding together with the timeline
      if (st.playing !== lastPlayingRef.current) {
        lastPlayingRef.current = st.playing;
        if (st.playing) rendererRef.current?.resumeVideos?.();
        else rendererRef.current?.pauseVideos?.();
        dirtyRef.current = true;
      }

      if (st.playing) {
        const now = performance.now();
        if (anchorTimeRef.current === 0) {
          anchorTimeRef.current = now;
          anchorFrameRef.current = st.frame;
        }
        const elapsed = (now - anchorTimeRef.current) / 1000;
        const total = Math.max(1, Math.round(st.duration * st.fps));
        const frame = Math.floor(anchorFrameRef.current + elapsed * st.fps) % total;
        // Compare against the frame we actually rendered, rather than the
        // store value. Store updates are batched and can lag behind the clock;
        // using st.frame here can reset videos more than once per loop and
        // makes them appear to jump backwards/forwards.
        if (lastRenderedFrameRef.current !== null && frame < lastRenderedFrameRef.current) {
          rendererRef.current?.restartVideos?.(); // clip wrapped — 'hold' videos restart with it
        }
        lastRenderedFrameRef.current = frame;
        if (frame !== st.frame) st.setFrame(frame);
        rendererRef.current?.renderFrame(frame);
      } else {
        anchorTimeRef.current = 0;
        lastRenderedFrameRef.current = null;
        if (dirtyRef.current) {
          dirtyRef.current = false;
          rendererRef.current?.renderFrame(st.frame);
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    // any store change (control tweak, scrub, asset/effect/bg edit) means the
    // paused preview must redraw once
    const unsub = useSceneStore.subscribe(() => { dirtyRef.current = true; });

    // Religar o renderer guardado: sem init, sem contexto novo, sem perda.
    const religar = (r: IRenderer) => {
      r.onDirty = () => { dirtyRef.current = true; };
      rendererRef.current = r;
      setRendererInstance(r);
      // O tamanho da cena pode ter mudado enquanto este engine estava parado.
      const st = useSceneStore.getState();
      r.resize(st.width, st.height);
      dirtyRef.current = true;
      lastPlayingRef.current = st.playing;
      rafRef.current = requestAnimationFrame(loop);
    };

    if (guardado) {
      religar(guardado.renderer);
    } else {
      (async () => {
        const entrada = await obterPalco(engine, canvas);
        // Sem `destroy()` num init obsoleto: a criacao e serializada por engine,
        // entao o Strict Mode do dev (que monta, limpa e monta de novo) espera a
        // primeira em vez de criar uma segunda para depois jogar fora. Era uma
        // perda de contexto por montagem, e o contador do Chrome nao zera.
        if (!mounted || initGeneration !== initGenerationRef.current) return;
        // A criacao vencedora pode ter usado o canvas da outra tentativa.
        if (entrada.canvas !== canvas) {
          entrada.canvas.className = 'stage-canvas';
          stageRef.current?.replaceChildren(entrada.canvas);
        }
        renderer = entrada.renderer;
        religar(entrada.renderer);
      })().catch(() => { /* sem contexto: a mensagem do renderer ja subiu */ });
    }

    return () => {
      mounted = false;
      unsub();
      cancelAnimationFrame(rafRef.current);
      setRendererInstance(null);
      rendererRef.current = null;
      // Estacionado, nao destruido: o loop para e os videos param de decodificar,
      // mas o renderer e o contexto ficam para a proxima vez que este engine
      // voltar. Destruir aqui e o que causava o bloqueio de contexto do Chrome.
      // O canvas sai do DOM sozinho, pelo replaceChildren do outro engine.
      const parado = palcos.get(engine)?.renderer;
      try { parado?.pauseVideos?.(); } catch { /* nada a fazer se ja parou */ }
    };
  }, [engine]);

  // live resize on aspect/fps-driven dimension changes
  useEffect(() => {
    rendererRef.current?.resize(width, height);
    dirtyRef.current = true; // canvas resized — redraw even if paused
  }, [width, height]);

  return (
    <div ref={stageRef} className="stage-wrap" />
  );
}
