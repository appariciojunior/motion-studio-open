import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { AsciiOptions } from './ascii';
import { isOn } from './asciiControls';
import { fitAndCenter } from './frame';
import { asset } from '@/lib/paths';
import { makeCameraRig } from './cameraRig';
import { findDevice } from './devices';

// ── Device Mockup 3D effect ─────────────────────────────────────────────────
// Realistic PBR render — the GLB's own materials (colour, metalness, roughness,
// textures) are kept as-is by default, lit with a 3-point studio rig plus a
// room-environment map for believable reflections (glass/metal/plastic). A
// ground plane catches a soft contact shadow. Same model-transform, per-part
// colouring, and sun/gobo accent-light plumbing as the Cartoon effect, so the
// existing Model Control / Model Colors / Background panels drive it live.

function partKeyOf(mesh: THREE.Mesh): string {
  const mat = mesh.material as THREE.Material | undefined;
  const mn = mat && !Array.isArray(mat) && mat.name ? mat.name : '';
  if (mn) return mn;
  const nm = mesh.name || 'mesh';
  return nm.replace(/[._\-\s]?\d+$/, '') || nm;
}

export function initMockup(
  stage: HTMLElement,
  canvas: HTMLCanvasElement,
  opts: AsciiOptions = {},
): () => void {
  // No bundled fallback for this effect — an empty modelUrl means the user
  // hasn't uploaded a device .glb yet, so the stage just stays empty (lit,
  // orbitable) instead of loading one of the project's own demo assets.
  const MODEL_URL = opts.modelUrl ? asset(opts.modelUrl) : '';
  const P = () => opts.getParams?.() ?? {};

  let animId = 0;
  let disposed = false;
  let lastCenterNonce = 0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, stage.clientWidth / stage.clientHeight, 0.01, 1000);
  camera.position.set(0, 0, 4);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);   // transparent → stage bg-gradient shows
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // Room-environment map → soft, believable reflections without a real HDRI.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;

  const ambient = new THREE.AmbientLight(0xffffff, 0.6); scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, 3); key.position.set(3, 6, 4); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.3; key.shadow.camera.far = 20;
  key.shadow.bias = -0.0016; key.shadow.radius = 3;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 1.2); fill.position.set(-4, 2, -3); scene.add(fill);

  // Accent "window" light — same gobo-mask pattern as the Cartoon effect, so
  // the Background panel's Sunlight/Sun Shadow/Sun Mask controls stay live.
  const sun = new THREE.SpotLight(0xffffff, 0.0, 0, 0.62, 0.18, 0.0);
  sun.position.set(2.6, 2.6, 3.6);
  sun.target.position.set(0, 0, 0); scene.add(sun.target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.3; sun.shadow.camera.far = 20;
  sun.shadow.bias = -0.0016; sun.shadow.radius = 3;
  scene.add(sun);

  const goboCanvas = document.createElement('canvas'); goboCanvas.width = goboCanvas.height = 512;
  const goboCtx = goboCanvas.getContext('2d')!;
  const goboTex = new THREE.CanvasTexture(goboCanvas);
  goboTex.colorSpace = THREE.SRGBColorSpace;
  let goboImg: HTMLImageElement | null = null;
  let goboUrl = '';
  let goboKey = '';
  function loadGobo(url: string) {
    goboUrl = url; goboImg = null;
    const img = new Image();
    img.onload = () => { goboImg = img; goboKey = ''; };
    img.src = asset(url);
  }
  function drawGobo(scale: number, offX: number, offY: number) {
    if (!goboImg) return;
    goboCtx.clearRect(0, 0, 512, 512);
    goboCtx.filter = 'blur(6px)';
    const sz = 512 * scale;
    goboCtx.drawImage(goboImg, (512 - sz) / 2 + offX * 512, (512 - sz) / 2 + offY * 512, sz, sz);
    goboCtx.filter = 'none';
    const d = goboCtx.getImageData(0, 0, 512, 512);
    let hasAlpha = false;
    for (let i = 3; i < d.data.length; i += 4) if (d.data[i] < 250) { hasAlpha = true; break; }
    for (let i = 0; i < d.data.length; i += 4) {
      const v = hasAlpha ? d.data[i + 3]
        : 255 - (d.data[i] * 0.299 + d.data[i + 1] * 0.587 + d.data[i + 2] * 0.114);
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255;
    }
    goboCtx.putImageData(d, 0, 0);
    goboTex.needsUpdate = true;
  }

  // Ground plane — a pure shadow-catcher (invisible except where a shadow
  // falls), so the stage's CSS gradient shows through everywhere else.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.35 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 0.5;
  controls.maxDistance = 12;
  const INIT_TARGET = new THREE.Vector3(0, 0, 0);
  const INIT_CAM = new THREE.Vector3(0, 0, 4);
  controls.target.copy(INIT_TARGET);

  const rig = makeCameraRig(camera, controls);
  opts.onCamera?.(rig);

  // Arqé's own tuned camera-fit size (and screen aspect/corner radius) for
  // this exact mesh, when it's one of the bundled devices — falls back to a
  // generic size/aspect for a user upload.
  const DEV = findDevice(opts.modelUrl);
  const MODEL_SIZE = DEV?.fitHeight ?? 2.4;
  let modelHalf = MODEL_SIZE / 2;
  let modelBottom = -modelHalf;
  // Default view — a slight 3/4 turn to the right + a touch of elevation
  // (classic product-shot angle) instead of a flat, dead-on front view.
  const INIT_AZIMUTH = THREE.MathUtils.degToRad(28);
  const INIT_ELEVATION = THREE.MathUtils.degToRad(8);
  function frameCamera() {
    const halfV = Math.tan((45 * Math.PI / 180) / 2);
    const halfH = halfV * camera.aspect;
    const dist = Math.max(modelHalf / halfV, modelHalf / halfH) * 1.25;
    INIT_CAM.set(
      dist * Math.sin(INIT_AZIMUTH) * Math.cos(INIT_ELEVATION),
      dist * Math.sin(INIT_ELEVATION),
      dist * Math.cos(INIT_AZIMUTH) * Math.cos(INIT_ELEVATION),
    );
    camera.position.copy(INIT_CAM);
    controls.target.copy(INIT_TARGET);
    controls.update();
    ground.position.set(0, modelBottom, 0);
    const gs = dist * 3;
    ground.scale.set(gs, gs, 1);
  }

  function resize() {
    const W = stage.clientWidth, H = stage.clientHeight;
    if (!W || !H) return;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  }

  const materials: THREE.Material[] = [];
  const meshList: THREE.Mesh[] = [];
  const groupData = new Map<string, { box: THREE.Box3; center: THREE.Vector3; radius: number }>();

  function computeGroupData() {
    if (!model) return;
    model.updateWorldMatrix(true, true);
    const modelInv = model.matrixWorld.clone().invert();
    const corner = new THREE.Vector3();
    for (const mesh of meshList) {
      const m2m = modelInv.clone().multiply(mesh.matrixWorld);
      mesh.userData.m2m = m2m;
      const key = (mesh.material as THREE.Material).userData.partKey as string;
      const geo = mesh.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      let gd = groupData.get(key);
      if (!gd) { gd = { box: new THREE.Box3(), center: new THREE.Vector3(), radius: 1 }; groupData.set(key, gd); }
      for (let xi = 0; xi < 2; xi++) for (let yi = 0; yi < 2; yi++) for (let zi = 0; zi < 2; zi++) {
        corner.set(xi ? bb.max.x : bb.min.x, yi ? bb.max.y : bb.min.y, zi ? bb.max.z : bb.min.z).applyMatrix4(m2m);
        gd.box.expandByPoint(corner);
      }
    }
    for (const gd of groupData.values()) {
      gd.box.getCenter(gd.center);
      gd.radius = Math.max(1e-4, gd.box.getSize(new THREE.Vector3()).length() / 2);
    }
  }

  const _v = new THREE.Vector3();
  const _c1 = new THREE.Color();
  const _c2 = new THREE.Color();
  const _co = new THREE.Color();
  function applyFill(mesh: THREE.Mesh, spec: { type: string; c1: string; c2: string }) {
    const mat = mesh.material as any;
    if (spec.type === 'solid') {
      if (mat.vertexColors) { mat.vertexColors = false; mat.needsUpdate = true; }
      mat.color.set(spec.c1);
      return;
    }
    const gd = groupData.get(mat.userData.partKey as string);
    const m2m = mesh.userData.m2m as THREE.Matrix4 | undefined;
    if (!gd || !m2m) { mat.color.set(spec.c1); return; }
    const geo = mesh.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const n = pos.count;
    let colAttr = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!colAttr || colAttr.count !== n) { colAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3); geo.setAttribute('color', colAttr); }
    _c1.set(spec.c1).convertSRGBToLinear();
    _c2.set(spec.c2).convertSRGBToLinear();
    const spanY = Math.max(1e-4, gd.box.max.y - gd.box.min.y);
    for (let i = 0; i < n; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(m2m);
      const t = spec.type === 'radial'
        ? Math.min(1, _v.distanceTo(gd.center) / gd.radius)
        : Math.min(1, Math.max(0, (_v.y - gd.box.min.y) / spanY));
      _co.copy(_c1).lerp(_c2, t);
      colAttr.setXYZ(i, _co.r, _co.g, _co.b);
    }
    colAttr.needsUpdate = true;
    if (!mat.vertexColors) { mat.vertexColors = true; mat.needsUpdate = true; }
    mat.color.setRGB(1, 1, 1);
  }

  // ── Screen content — image/video composited onto the device's "Screen"
  // mesh. Cover-fit into its own aspect (like CSS object-fit: cover), masked
  // to the device's real screen corner radius so it reads as a live display.
  let screenMesh: THREE.Mesh | null = null;
  let screenKey = '';
  let screenTex: THREE.Texture | null = null;
  let screenVideoEl: HTMLVideoElement | null = null;

  function applyCoverUV(tex: THREE.Texture, mediaAspect: number, screenAspect: number) {
    let rx = 1, ry = 1, ox = 0, oy = 0;
    if (mediaAspect > screenAspect) { rx = screenAspect / mediaAspect; ox = (1 - rx) / 2; }
    else { ry = mediaAspect / screenAspect; oy = (1 - ry) / 2; }
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(rx, ry);
    tex.offset.set(ox, oy);
    tex.needsUpdate = true;
  }

  // Plain unlit textured plane — no custom shader. A rounded-corner mask was
  // cut: it relied on assumptions about the mesh's raw `vUv` varying that
  // didn't hold for these GLBs and discarded every fragment (screen went
  // fully transparent instead of showing the uploaded media). Reliability
  // over cosmetic corners.
  function makeScreenMaterial(tex: THREE.Texture): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  }

  function setScreenMaterial(mat: THREE.MeshBasicMaterial) {
    if (!screenMesh) { mat.dispose(); return; }
    const old = screenMesh.material as THREE.Material;
    if (old && old !== screenMesh.userData.origMaterial) old.dispose();
    screenMesh.material = mat;
  }

  function restoreScreenMaterial() {
    if (!screenMesh || !screenMesh.userData.origMaterial) return;
    const old = screenMesh.material as THREE.Material;
    if (old && old !== screenMesh.userData.origMaterial) old.dispose();
    screenMesh.material = screenMesh.userData.origMaterial;
  }

  const pivot = new THREE.Group();
  scene.add(pivot);
  let model: THREE.Object3D | null = null;

  if (MODEL_URL) new GLTFLoader().load(
    MODEL_URL,
    (gltf) => {
      if (disposed) return;
      model = gltf.scene;
      const keys: string[] = [];
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const orig = mesh.material as THREE.MeshStandardMaterial;
        const mat = (orig && !Array.isArray(orig) ? orig.clone() : new THREE.MeshStandardMaterial({ color: 0xd8d8dc })) as any;
        const key = partKeyOf(mesh);
        mat.userData.origColor = mat.color ? mat.color.clone() : new THREE.Color(0xd8d8dc);
        mat.userData.hasMap = !!mat.map;
        mat.userData.srcMap = mat.map ?? null;
        mat.userData.partKey = key;
        mesh.material = mat;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        materials.push(mat);
        meshList.push(mesh);
        if (!keys.includes(key)) keys.push(key);
      });
      modelHalf = fitAndCenter(model, MODEL_SIZE);
      const box = new THREE.Box3().setFromObject(model);
      modelBottom = box.min.y;
      pivot.add(model);
      computeGroupData();
      frameCamera();
      screenMesh = meshList.find((_, i) => materials[i].userData.partKey === 'Screen') ?? null;
      if (screenMesh) screenMesh.userData.origMaterial = screenMesh.material;
      opts.onParts?.(keys);
    },
    () => {},
    (err) => { console.error('GLB load failed:', err); },
  );

  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(stage);

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downX = 0, downY = 0;
  const onDown = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY; };
  const onUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(meshList, false);
    const key = hits.length ? ((hits[0].object as THREE.Mesh).material as any)?.userData?.partKey ?? null : null;
    opts.onPickPart?.(key);
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);

  const tmpColor = new THREE.Color();
  const WHITE = new THREE.Color(0xffffff);
  function loop() {
    if (disposed) return;
    animId = requestAnimationFrame(loop);
    const p = P();

    key.intensity = Number(p.keyLight ?? 3);
    fill.intensity = Number(p.fillLight ?? 1.2);
    ambient.intensity = Number(p.ambient ?? 0.6);
    const envIntensity = Number(p.envIntensity ?? 1);
    renderer.toneMappingExposure = Number(p.exposure ?? 0.7);

    const useTex = isOn(p.useModelColor);
    const wire = isOn(p.wireframe);
    const flat = isOn(p.flatShading);
    const op = Math.max(0, Math.min(1, Number(p.opacity ?? 100) / 100));
    tmpColor.set(String(p.color ?? '#d8d8dc'));
    const partFills = opts.getPartFills?.() ?? {};
    const selected = opts.getSelectedPart?.() ?? null;
    const emissiveHex = String(p.emissive ?? '#000000');
    const emissiveIntensity = Number(p.emissiveIntensity ?? 1);

    for (let i = 0; i < materials.length; i++) {
      const m = materials[i] as any;
      const mesh = meshList[i];
      const mkey = m.userData.partKey as string;
      if (mkey === 'Screen') continue;   // user content — own material, not device-tinted
      const partFill = partFills[mkey];

      if (partFill) {
        const hash = `${partFill.type}|${partFill.c1}|${partFill.c2}`;
        if (m.userData.fillHash !== hash) { applyFill(mesh, partFill); m.userData.fillHash = hash; }
      } else {
        if (m.userData.fillHash !== undefined) {
          if (m.vertexColors) { m.vertexColors = false; m.needsUpdate = true; }
          m.userData.fillHash = undefined;
        }
        if (useTex) m.color.copy(m.userData.hasMap ? WHITE : m.userData.origColor);
        else m.color.copy(tmpColor);
      }

      const desiredMap = partFill ? null : (useTex && m.userData.hasMap ? m.userData.srcMap : null);
      if (m.map !== desiredMap) { m.map = desiredMap; m.needsUpdate = true; }

      if (selected && mkey === selected) { m.emissive.setRGB(0.12, 0.35, 0.6); m.emissiveIntensity = 1; }
      else if (m.emissive) { m.emissive.set(emissiveHex); m.emissiveIntensity = emissiveIntensity; }

      if ('envMapIntensity' in m) m.envMapIntensity = envIntensity;
      m.wireframe = wire;
      m.opacity = op;
      m.transparent = op < 1;
      if (m.flatShading !== flat) { m.flatShading = flat; m.needsUpdate = true; }
    }

    // screen content — only re-touch when the media identity actually changes
    const media = opts.getScreenMedia?.() ?? null;
    const mkey2 = media ? `${media.kind}|${media.url}` : '';
    if (screenMesh && mkey2 !== screenKey) {
      screenKey = mkey2;
      if (screenVideoEl) { screenVideoEl.pause(); screenVideoEl.removeAttribute('src'); screenVideoEl.load(); screenVideoEl = null; }
      if (screenTex) { screenTex.dispose(); screenTex = null; }
      if (media) {
        const aspect = DEV?.screenAspect ?? 16 / 9;
        if (media.kind === 'video') {
          const vid = document.createElement('video');
          vid.src = media.url; vid.crossOrigin = 'anonymous'; vid.loop = true; vid.muted = true; vid.playsInline = true;
          vid.play().catch(() => {});
          screenVideoEl = vid;
          const tex = new THREE.VideoTexture(vid);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.flipY = false;
          screenTex = tex;
          vid.addEventListener('loadedmetadata', () => applyCoverUV(tex, vid.videoWidth / vid.videoHeight, aspect), { once: true });
          setScreenMaterial(makeScreenMaterial(tex));
        } else {
          new THREE.TextureLoader().load(media.url, (tex) => {
            if (disposed || mkey2 !== screenKey) { tex.dispose(); return; }
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.flipY = false;
            applyCoverUV(tex, tex.image.width / tex.image.height, aspect);
            screenTex = tex;
            setScreenMaterial(makeScreenMaterial(tex));
          });
        }
      } else {
        restoreScreenMaterial();
      }
    }

    const md = opts.getModel?.();
    if (md) {
      pivot.scale.setScalar(Math.max(0.05, md.scale));
      pivot.rotation.set(md.rotX, md.rotY, 0);
      pivot.position.set(md.offsetX ?? 0, md.offsetY ?? 0, 0);
      sun.target.position.set(md.offsetX ?? 0, md.offsetY ?? 0, 0);
      sun.target.updateMatrixWorld();
      if (md.centerNonce !== lastCenterNonce) {
        lastCenterNonce = md.centerNonce;
        camera.position.copy(INIT_CAM);
        controls.target.copy(INIT_TARGET);
      }
    }

    const shadowMat = ground.material as THREE.ShadowMaterial;
    shadowMat.opacity = Math.max(0, Math.min(1, Number(p.shadowOpacity ?? 35) / 100));

    const sunlight = opts.getSunlight?.() ?? 0;
    const sunShadow = opts.getSunShadow?.() ?? 0;
    sun.intensity = (sunlight / 100) * 14;
    sun.penumbra = 0.5 - (sunShadow / 100) * 0.46;
    const maskUrl = opts.getSunMask?.() ?? null;
    if (maskUrl) {
      if (maskUrl !== goboUrl) loadGobo(maskUrl);
      sun.map = goboTex;
      const mt = opts.getSunMaskTransform?.() ?? { scale: 16, offX: 0, offY: 0 };
      const gkey = `${goboUrl}|${mt.scale}|${mt.offX}|${mt.offY}`;
      if (gkey !== goboKey) { drawGobo(mt.scale / 100, mt.offX / 100, mt.offY / 100); goboKey = gkey; }
    } else if (sun.map) { sun.map = null; }

    rig.update();
    controls.update();
    renderer.render(scene, camera);
  }
  loop();

  return function dispose() {
    disposed = true;
    opts.onCamera?.(null);
    cancelAnimationFrame(animId);
    ro.disconnect();
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
    controls.dispose();
    pmrem.dispose();
    envRT.texture.dispose();
    ground.geometry.dispose();
    (ground.material as THREE.Material).dispose();
    if (screenVideoEl) { screenVideoEl.pause(); screenVideoEl.removeAttribute('src'); screenVideoEl.load(); }
    if (screenTex) screenTex.dispose();
    if (screenMesh) {
      const sm = screenMesh.material as THREE.Material;
      if (sm && sm !== screenMesh.userData.origMaterial) sm.dispose();
    }
    for (const m of materials) m.dispose();
    if (model) model.traverse((o) => { const g = (o as THREE.Mesh).geometry; if (g) g.dispose(); });
    renderer.dispose();
  };
}
