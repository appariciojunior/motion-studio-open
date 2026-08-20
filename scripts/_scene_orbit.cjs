// Read the reference's Orbit (ring) scene DIRECTLY: the live camera and every
// card's world matrix, instead of inferring geometry from pixels.
//
// three.js announces every renderer and scene it builds to a global devtools
// hook IF that hook exists before it is constructed, so it is installed on the
// document before navigation. The camera is not announced — it arrives as an
// argument to render() — so render is wrapped once the renderer shows up.
//
// This is the ground truth the bounding-box probes only approximate: a pixel box
// cannot see an edge-on card, and an edge-on card is exactly where a wrong
// camera hides.
//
// Usage: node scripts/_scene_orbit.cjs "Pure 01" "Lightroom 04"
//
// The ring's own maths lives in the reference's modules 25001 (ringRadius,
// ringSlots, ringCardScale, steppedSpinAngle, applyRingCamera, buildCardGeometry)
// and 34379 (the stage renderer). This probe is what proves the transcription:
// it reads the live camera and every card's world matrix out of the running page.
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const OUT = process.env.MS_OUT || path.join(__dirname, '..', '.shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The reference editor's URL is deliberately NOT committed: point this probe at
// it with MS_REF_URL. Nothing the app ships reads it — these dev probes are its
// only readers, and the comparison they do is local.
const REF_URL = process.env.MS_REF_URL;
function refUrl() {
  if (!REF_URL) throw new Error('set MS_REF_URL to the reference editor to compare against');
  return REF_URL;
}


async function main() {
  const wanted = process.argv.slice(2);
  if (!wanted.length) throw new Error('pass template names');

  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'shell',
    protocolTimeout: 900000,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => {
    window.__seen = { renderers: [], scenes: [] };
    window.__THREE_DEVTOOLS__ = {
      dispatchEvent(ev) {
        const o = ev && ev.detail;
        if (!o) return;
        if (o.isScene) window.__seen.scenes.push(o);
        else if (o.render && o.domElement) {
          window.__seen.renderers.push(o);
          if (!o.__wrapped) {
            o.__wrapped = true;
            const orig = o.render.bind(o);
            o.render = (scene, camera) => { window.__lastCam = camera; window.__lastScene = scene; return orig(scene, camera); };
          }
        }
      },
    };
  });
  await page.goto(refUrl(), { waitUntil: 'networkidle2', timeout: 120000 });
  await sleep(6000);

  const out = await page.evaluate(async (names, set, family) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const byText = (t) => [...document.querySelectorAll('*')]
      .find((n) => n.children.length === 0 && (n.textContent || '').trim() === t);
    const btnBy = (re) => [...document.querySelectorAll('button')].find((b) => re.test((b.textContent || '').trim()));
    const explorerOpen = () => !!btnBy(/^Cancel$/);

    const res = [];
    for (const name of names) {
      if (!explorerOpen()) { const b = btnBy(/^Explore \d+ Templates$/); if (b) b.click(); await wait(1200); }
      if (!byText(name)) { const fam = byText(family); if (fam) (fam.closest('button') || fam.parentElement).click(); await wait(1500); }
      const item = byText(name);
      if (!item) { res.push({ name, error: 'not listed' }); continue; }
      (item.closest('button') || item.parentElement).click();
      await wait(5000);

      // Optional "Label=value" nudge, so a control's effect on the LIVE camera
      // can be read instead of guessed from pixels.
      let setEcho = null;
      if (set) {
        const [lbl, val] = set.split('=');
        const label = byText(lbl);
        const row = label && label.parentElement;
        const input = row && row.querySelector('input');
        if (input) {
          const proto = Object.getPrototypeOf(input);
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, String(val));
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          input.blur();
          await wait(3500);
          setEcho = lbl + '=' + input.value;
        } else {
          setEcho = 'CONTROL "' + lbl + '" NOT FOUND';
        }
      }

      // Is the stage transport even running? A paused belt turns every pixel
      // measurement into a single-phase reading dressed up as an envelope.
      const spins = [];
      for (let s2 = 0; s2 < 4; s2++) {
        const sc = window.__lastScene;
        let first = null;
        if (sc) sc.traverse((o) => { if (!first && o.isMesh && o.geometry && o.geometry.parameters && o.geometry.parameters.width) first = o; });
        if (first) {
          first.updateWorldMatrix(true, false);
          const e = first.matrixWorld.elements;
          spins.push([+e[12].toFixed(2), +e[13].toFixed(2), +e[14].toFixed(2)]);
        } else spins.push(null);
        if (s2 < 3) await wait(1500);
      }
      // The same instant, measured twice: the scene graph and the pixels. The
      // only way to tell "our port draws a card the reference does not" from
      // "the reference draws it and the probe cannot see it".
      let pixels = null;
      {
        const c = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
        if (c) {
          const N = 300;
          const buf = document.createElement("canvas");
          buf.width = N; buf.height = N;
          const g = buf.getContext("2d", { willReadFrequently: true });
          const img = new Image();
          img.src = c.toDataURL("image/png");
          await img.decode();
          g.clearRect(0, 0, N, N);
          g.drawImage(img, 0, 0, N, N);
          const d = g.getImageData(0, 0, N, N).data;
          let x0 = N, x1 = -1, y0 = N, y1 = -1;
          for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
            if (d[(y * N + x) * 4 + 3] < 40) continue;
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
          pixels = { x0: +(x0 / N).toFixed(4), x1: +((x1 + 1) / N).toFixed(4), y0: +(y0 / N).toFixed(4), y1: +((y1 + 1) / N).toFixed(4) };
        }
      }
      const cam = window.__lastCam, scene = window.__lastScene;
      if (!cam || !scene) { res.push({ name, error: 'no camera captured', seen: { r: window.__seen.renderers.length, s: window.__seen.scenes.length } }); continue; }
      const cards = [];
      scene.traverse((o) => {
        if (!o.isMesh || !o.geometry || !o.geometry.parameters) return;
        const p = o.geometry.parameters;
        if (!p.width || !p.height) return;
        cards.push({
          plane: [p.width, p.height],
          local: [o.position.x, o.position.y, o.position.z].map((v) => +v.toFixed(2)),
          rot: [o.rotation.x, o.rotation.y, o.rotation.z].map((v) => +v.toFixed(5)),
          world: (o.updateWorldMatrix(true, false), o.matrixWorld.elements.map((v) => +v.toFixed(3))),
          renderOrder: o.renderOrder,
          visible: o.visible,
          scale: [o.scale.x, o.scale.y, o.scale.z].map((v) => +v.toFixed(4)),
        });
      });
      // Group chain above the first card: roll group, then rig group.
      const chain = [];
      let n = null;
      scene.traverse((o) => { if (!n && o.isMesh && o.geometry && o.geometry.parameters && o.geometry.parameters.width) n = o; });
      for (let p = n && n.parent; p; p = p.parent) chain.push({
        type: p.type,
        rot: [p.rotation.x, p.rotation.y, p.rotation.z].map((v) => +v.toFixed(5)),
        pos: [p.position.x, p.position.y, p.position.z].map((v) => +v.toFixed(3)),
        scale: [p.scale.x, p.scale.y, p.scale.z].map((v) => +v.toFixed(5)),
      });
      res.push({
        name,
        camera: { fov: +cam.fov.toFixed(4), aspect: +cam.aspect.toFixed(4), near: +cam.near.toFixed(3), far: +cam.far.toFixed(1),
                  pos: [cam.position.x, cam.position.y, cam.position.z].map((v) => +v.toFixed(3)), zoom: cam.zoom, isOrtho: !!cam.isOrthographicCamera },
        setEcho, spins, pixels, chain, cardCount: cards.length, cards,
      });
    }
    return res;
  }, wanted, process.env.MS_SET || null, process.env.MS_FAMILY || 'Orbit');

  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, 'ref-scene-' + (process.env.MS_FAMILY || 'orbit').toLowerCase() + '.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1).slice(0, 6000));
  console.log('-> ' + file);
  await browser.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
