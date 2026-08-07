import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AsciiOptions } from './ascii';
import { isOn } from './asciiControls';
import { fitAndCenter } from './frame';
import { asset } from '@/lib/paths';
import { makeCameraRig } from './cameraRig';
import { use3DStore } from '../store/use3DStore';
import { useSceneStore } from '../store/useSceneStore';
import { apply3DAnimation } from './animations';

// ── Cartoon (toon) 3D effect ────────────────────────────────────────────────
// Renders the model with THREE.MeshToonMaterial straight to the (WebGL) canvas.
// gradientMap is generated from a "Toon Steps" count (banded shading). Reads
// live control values every frame. Returns dispose().

// Generic "colourable group" key for any GLB: prefer a named material, else
// the object name with a trailing numeric suffix stripped (Plane.048 → Plane,
// stem_02 → stem). Works without hardcoding to a particular model.
function partKeyOf(mesh: THREE.Mesh): string {
  const mat = mesh.material as THREE.Material | undefined;
  const mn = mat && !Array.isArray(mat) && mat.name ? mat.name : '';
  if (mn) return mn;
  const nm = mesh.name || 'mesh';
  return nm.replace(/[._\-\s]?\d+$/, '') || nm;
}

// Banded gradient map for toon shading (steps × 1 red texture, nearest-filtered).
function makeGradient(steps: number): THREE.DataTexture {
  const n = Math.max(2, Math.round(steps));
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) data[i] = Math.round((i / (n - 1)) * 255);
  const tex = new THREE.DataTexture(data, n, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

export function initCartoon(
  stage: HTMLElement,
  canvas: HTMLCanvasElement,
  opts: AsciiOptions = {},
): () => void {
  const MODEL_URL = asset(opts.modelUrl ?? '/3d/model/dayse.glb');
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
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Paint textures (brush strokes). Shared across all materials.
  const texLoader = new THREE.TextureLoader();
  const paintNormal = texLoader.load(asset('/3d/textures/paint-normal.png'));
  paintNormal.colorSpace = THREE.NoColorSpace;
  paintNormal.wrapS = paintNormal.wrapT = THREE.RepeatWrapping;
  const paintGrey = texLoader.load(asset('/3d/textures/paint-grey.jpg'));   // value strokes → diffuse
  paintGrey.colorSpace = THREE.SRGBColorSpace;
  paintGrey.wrapS = paintGrey.wrapT = THREE.RepeatWrapping;
  const paintAlpha = texLoader.load(asset('/3d/textures/paint-alpha.png'));  // contrast mask → rim erosion
  paintAlpha.wrapS = paintAlpha.wrapT = THREE.RepeatWrapping;

  // GLSL helpers shared by the wall material (stochastic paint tiling).
  const PAINT_GLSL = `
uniform int uType; uniform vec3 uC1; uniform vec3 uC2; uniform float uAmount; uniform float uScale;
varying vec2 vWallUv;
vec2 pHash(vec2 p){ p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))); return fract(sin(p)*43758.5453); }
float stochGrey(sampler2D tex, vec2 uv){
  vec2 c=floor(uv), f=uv-c; float acc=0.0, w=0.0;
  for(int j=0;j<=1;j++){ for(int i=0;i<=1;i++){
    vec2 g=vec2(float(i),float(j)); vec2 h=pHash(c+g);
    float a=(h.x-0.5)*6.28318; float ca=cos(a), sa=sin(a);
    vec2 uvr=mat2(ca,-sa,sa,ca)*uv + h*7.31;
    float ww=smoothstep(1.3,0.0,length(f-g));
    acc+=texture2D(tex,uvr).r*ww; w+=ww;
  }}
  return acc/max(w,1e-4);
}
vec4 stochNormalW(sampler2D tex, vec2 uv){
  vec2 c=floor(uv), f=uv-c; vec2 nxy=vec2(0.0); float nz=0.0, w=0.0;
  for(int j=0;j<=1;j++){ for(int i=0;i<=1;i++){
    vec2 g=vec2(float(i),float(j)); vec2 h=pHash(c+g);
    float a=(h.x-0.5)*6.28318; float ca=cos(a), sa=sin(a); mat2 rot=mat2(ca,-sa,sa,ca);
    vec3 n=texture2D(tex, rot*uv + h*7.31).xyz*2.0-1.0;
    float ww=smoothstep(1.3,0.0,length(f-g));
    nxy+=(rot*n.xy)*ww; nz+=n.z*ww; w+=ww;
  }}
  return vec4((nxy/max(w,1e-4))*0.5+0.5, (nz/max(w,1e-4))*0.5+0.5, 1.0);
}
`;

  // ── Background wall: a real 3D plane behind the model (receives shadows). ──
  // Painterly gradient + strokes injected via onBeforeCompile; MeshToonMaterial
  // so it takes toon-banded cast shadows from the sun.
  const wallMat = new THREE.MeshToonMaterial({ color: 0xffffff, map: paintGrey, normalMap: paintNormal });
  wallMat.gradientMap = makeGradient(3);
  wallMat.onBeforeCompile = (shader) => {
    shader.uniforms.uType = { value: 1 };
    shader.uniforms.uC1 = { value: new THREE.Color(0.1, 0.1, 0.1) };
    shader.uniforms.uC2 = { value: new THREE.Color(0, 0, 0) };
    shader.uniforms.uAmount = { value: 0 };
    shader.uniforms.uScale = { value: 3 };
    shader.vertexShader = 'varying vec2 vWallUv;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\n vWallUv = uv;');
    shader.fragmentShader = PAINT_GLSL + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       #ifdef USE_MAP
       {
         float t = (uType==2) ? clamp(length(vWallUv-vec2(0.5))*1.6,0.0,1.0) : vWallUv.y;
         vec3 grad = (uType==0) ? uC1 : mix(uC1, uC2, t);
         diffuseColor.rgb = mix(grad, mix(uC1, uC2, stochGrey(map, vWallUv*uScale)), uAmount);
       }
       #endif`);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#ifdef USE_NORMALMAP_TANGENTSPACE
         vec3 mapN = stochNormalW( normalMap, vWallUv * uScale ).xyz * 2.0 - 1.0;
         mapN.xy *= normalScale;
         normal = normalize( tbn * mapN );
       #endif`);
    wallMat.userData.shader = shader;
  };
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), wallMat);
  wall.receiveShadow = true;
  scene.add(wall);

  const ambient = new THREE.AmbientLight(0xffffff, 0.5); scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(3, 6, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 1.0); fill.position.set(-4, 2, -3); scene.add(fill);

  // Sun — casts the model's shadow onto the wall (from the front). Intensity via control.
  // Window light — a SpotLight projecting the window shape (gobo/cookie). Light
  // passes through the panes, mullions block it → hard "colonial window" light
  // on the flower AND the wall, plus the flower's own cast shadow.
  const sun = new THREE.SpotLight(0xffa64d, 0.0, 0, 0.62, 0.18, 0.0);   // warm golden-hour
  sun.position.set(2.6, 2.6, 3.6);   // top-right, front → 45° cast
  sun.target.position.set(0, 0, 0); scene.add(sun.target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.3; sun.shadow.camera.far = 20;
  sun.shadow.bias = -0.0016; sun.shadow.radius = 3;
  scene.add(sun);

  // Gobo (light cookie) from the mask. One canvas/texture; the image is cached
  // and re-drawn on scale/offset change (no reload). Panes (opaque alpha) let
  // light through (white), frame/outside blocks it (black); gaussian-blurred.
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
    img.onload = () => { goboImg = img; goboKey = ''; };   // force redraw next frame
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

  const MODEL_SIZE = 2.4;
  let modelHalf = MODEL_SIZE / 2;
  const INIT_AZIMUTH = 0;
  const INIT_ELEVATION = 0;
  function frameCamera() {
    const halfV = Math.tan((45 * Math.PI / 180) / 2);
    const halfH = halfV * camera.aspect;
    const dist = Math.max(modelHalf / halfV, modelHalf / halfH) * 1.25;
    INIT_CAM.set(0, 0, dist);
    camera.position.copy(INIT_CAM);
    controls.target.copy(INIT_TARGET);
    controls.update();
    // place the wall just behind the model, sized to over-fill the view
    const wallZ = -modelHalf * 0.62;
    const wh = 2 * Math.tan((45 * Math.PI / 180) / 2) * (dist - wallZ) * 1.3;
    wall.position.set(0, 0, wallZ);
    wall.scale.set(wh * Math.max(camera.aspect, 1), wh, 1);
  }

  function resize() {
    const W = stage.clientWidth, H = stage.clientHeight;
    if (!W || !H) return;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  }

  // toon materials swapped onto the model
  const materials: THREE.MeshToonMaterial[] = [];
  const meshList: THREE.Mesh[] = [];   // for click-to-pick raycasting
  // per-group bounds in model space (for gradient normalisation)
  const groupData = new Map<string, { box: THREE.Box3; center: THREE.Vector3; radius: number }>();

  // Compute each mesh's transform relative to the model root (pivot-invariant)
  // and each colour group's bounding box in that model space.
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
  // Bake a fill (solid / linear-Y / radial) into a mesh's vertex colours.
  function applyFill(mesh: THREE.Mesh, spec: { type: string; c1: string; c2: string }) {
    const mat = mesh.material as THREE.MeshToonMaterial;
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
  let gradient = makeGradient(3);
  let gradientSteps = 3;

  const pivot = new THREE.Group();
  scene.add(pivot);
  let model: THREE.Object3D | null = null;

  new GLTFLoader().load(
    MODEL_URL,
    (gltf) => {
      if (disposed) return;
      model = gltf.scene;
      const keys: string[] = [];
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const orig = mesh.material as THREE.MeshStandardMaterial;
        const mat = new THREE.MeshToonMaterial({
          color: orig?.color ? orig.color.clone() : new THREE.Color(0xe9e4d6),
          map: orig?.map ?? null,
          gradientMap: gradient,
        });
        // petals etc. are single-sided planes → render + cast shadow from both
        // sides (otherwise thin faces facing away from the sun cast no shadow).
        mat.side = THREE.DoubleSide;
        mat.shadowSide = THREE.DoubleSide;
        const key = partKeyOf(mesh);
        mat.userData.origColor = mat.color.clone();
        mat.userData.hasMap = !!orig?.map;
        mat.userData.srcMap = orig?.map ?? null;
        mat.userData.partKey = key;
        // Paint diffuse: use the grey stroke texture to LERP between the part's
        // two colours (palette only — never leaks the texture's black/grey).
        mat.onBeforeCompile = (shader) => {
          shader.uniforms.uC1 = { value: new THREE.Color(1, 1, 1) };
          shader.uniforms.uC2 = { value: new THREE.Color(0.5, 0.5, 0.5) };
          shader.uniforms.uUsePaint = { value: 0 };
          shader.uniforms.uAlphaTex = { value: paintAlpha };
          shader.uniforms.uRim = { value: 0 };
          shader.uniforms.uRimAmt = { value: 2.0 };
          shader.uniforms.uRimThresh = { value: 0.5 };
          shader.uniforms.uRimCurv = { value: 0.0 };
          // Stochastic tiling: sample in 2×2 overlapping tiles, each with a random
          // rotation + offset, blended by weight → breaks the regular grid.
          const helpers = `
uniform vec3 uC1; uniform vec3 uC2; uniform float uUsePaint;
uniform sampler2D uAlphaTex; uniform float uRim; uniform float uRimAmt; uniform float uRimThresh; uniform float uRimCurv;
vec2 pHash(vec2 p){ p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))); return fract(sin(p)*43758.5453); }
float stochGrey(sampler2D tex, vec2 uv){
  vec2 c=floor(uv), f=uv-c; float acc=0.0, w=0.0;
  for(int j=0;j<=1;j++){ for(int i=0;i<=1;i++){
    vec2 g=vec2(float(i),float(j)); vec2 h=pHash(c+g);
    float a=(h.x-0.5)*6.28318; float ca=cos(a), sa=sin(a);
    vec2 uvr=mat2(ca,-sa,sa,ca)*uv + h*7.31;
    float ww=smoothstep(1.3,0.0,length(f-g));   // 1.3 → ~30% tile overlap
    acc+=texture2D(tex,uvr).r*ww; w+=ww;
  }}
  return acc/max(w,1e-4);
}
// same stochastic tiling for the normal map — the sampled tangent-space xy is
// rotated by each tile's angle so brush directions stay consistent.
vec4 stochNormal(sampler2D tex, vec2 uv){
  vec2 c=floor(uv), f=uv-c; vec2 nxy=vec2(0.0); float nz=0.0, w=0.0;
  for(int j=0;j<=1;j++){ for(int i=0;i<=1;i++){
    vec2 g=vec2(float(i),float(j)); vec2 h=pHash(c+g);
    float a=(h.x-0.5)*6.28318; float ca=cos(a), sa=sin(a);
    mat2 rot=mat2(ca,-sa,sa,ca);
    vec3 n=texture2D(tex, rot*uv + h*7.31).xyz*2.0-1.0;
    float ww=smoothstep(1.3,0.0,length(f-g));
    nxy+=(rot*n.xy)*ww; nz+=n.z*ww; w+=ww;
  }}
  return vec4((nxy/max(w,1e-4))*0.5+0.5, (nz/max(w,1e-4))*0.5+0.5, 1.0);
}
`;
          shader.fragmentShader = helpers + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            `#include <map_fragment>
             #ifdef USE_MAP
             if (uUsePaint > 0.5) { diffuseColor.rgb = mix(uC1, uC2, stochGrey(map, vMapUv)); }
             #endif`,
          );
          // de-tile the brush normal map too — replace the whole include (its
          // inner code isn't expanded yet at onBeforeCompile time).
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <normal_fragment_maps>',
            `#ifdef USE_NORMALMAP_TANGENTSPACE
               vec3 mapN = ( uUsePaint > 0.5 ? stochNormal( normalMap, vNormalMapUv ) : texture2D( normalMap, vNormalMapUv ) ).xyz * 2.0 - 1.0;
               mapN.xy *= normalScale;
               normal = normalize( tbn * mapN );
             #endif`,
          );
          // rim erosion — chip the silhouette with the contrast brush mask
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <opaque_fragment>',
            `#ifdef USE_MAP
             if (uRim > 0.5) {
               float fres = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
               vec3 gN = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
               float curv = clamp(length(fwidth(gN)) * uRimCurv, 0.0, 1.0);   // per-element edges
               float edge = max(fres * uRimAmt, curv);
               float amask = stochGrey(uAlphaTex, vMapUv);
               if (edge - amask > uRimThresh) discard;
             }
             #endif
             #include <opaque_fragment>`,
          );
          mat.userData.shader = shader;
        };
        mesh.material = mat;
        mesh.castShadow = true;
        materials.push(mat);
        meshList.push(mesh);
        if (!keys.includes(key)) keys.push(key);
      });
      modelHalf = fitAndCenter(model, MODEL_SIZE);   // centroid-centred + fitted
      pivot.add(model);
      computeGroupData();                            // group bounds for gradients
      frameCamera();
      opts.onParts?.(keys);                          // report colourable groups
    },
    () => {},
    (err) => { console.error('GLB load failed:', err); },
  );

  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(stage);

  // ── click-to-pick (raycast) ──
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downX = 0, downY = 0;
  const onDown = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY; };
  const onUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;   // was an orbit-drag
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

    // lights
    key.intensity = Number(p.keyLight ?? 2.6);
    fill.intensity = Number(p.fillLight ?? 1);
    ambient.intensity = Number(p.ambient ?? 0.5);

    // toon steps → rebuild gradient map when changed
    const steps = Math.max(2, Math.round(Number(p.gradientSteps ?? 3)));
    if (steps !== gradientSteps) {
      gradientSteps = steps;
      gradient.dispose();
      gradient = makeGradient(steps);
      for (const m of materials) { m.gradientMap = gradient; m.needsUpdate = true; }
    }

    // material params
    const useTex = isOn(p.useModelColor);
    const wire = isOn(p.wireframe);
    const flat = isOn(p.flatShading);
    const op = Math.max(0, Math.min(1, Number(p.opacity ?? 100) / 100));
    tmpColor.set(String(p.color ?? '#e9e4d6'));
    const partFills = opts.getPartFills?.() ?? {};
    const selected = opts.getSelectedPart?.() ?? null;
    const emissiveHex = String(p.emissive ?? '#000000');
    // paint strokes (brush normal map)
    const paintOn = isOn(p.paintStrokes);
    const nStr = Number(p.normalStrength ?? 1);
    const pScale = Number(p.paintScale ?? 2);
    if (paintNormal.repeat.x !== pScale) { paintNormal.repeat.set(pScale, pScale); paintGrey.repeat.set(pScale, pScale); paintAlpha.repeat.set(pScale, pScale); }
    const rimOn = isOn(p.rimErosion);
    const rimAmt = Number(p.rimAmount ?? 2);
    const rimThr = Number(p.rimThreshold ?? 0.5);
    const rimCurv = Number(p.rimCurvature ?? 0);
    for (let i = 0; i < materials.length; i++) {
      const m = materials[i];
      const mesh = meshList[i];
      const key = m.userData.partKey as string;
      const fill = partFills[key];

      // per-part fill (solid / gradient → vertex colours) or model/uniform colour
      if (fill) {
        const hash = `${fill.type}|${fill.c1}|${fill.c2}`;
        if (m.userData.fillHash !== hash) { applyFill(mesh, fill); m.userData.fillHash = hash; }
      } else {
        if (m.userData.fillHash !== undefined) {   // fill removed → restore
          if (m.vertexColors) { m.vertexColors = false; m.needsUpdate = true; }
          m.userData.fillHash = undefined;
        }
        if (useTex) m.color.copy((m.userData.hasMap && !paintOn) ? WHITE : (m.userData.origColor as THREE.Color));
        else m.color.copy(tmpColor);
      }

      // map: paint grey (drives the c1↔c2 lerp in-shader) > model texture > none
      const desiredMap = paintOn ? paintGrey
        : (fill ? null : (useTex && m.userData.hasMap ? (m.userData.srcMap as THREE.Texture) : null));
      if (m.map !== desiredMap) { m.map = desiredMap; m.needsUpdate = true; }
      // feed the paint lerp colours (palette only → no black leak)
      const sh = m.userData.shader as any;
      if (sh) {
        sh.uniforms.uUsePaint.value = paintOn ? 1 : 0;
        sh.uniforms.uRim.value = rimOn ? 1 : 0;
        sh.uniforms.uRimAmt.value = rimAmt;
        sh.uniforms.uRimThresh.value = rimThr;
        sh.uniforms.uRimCurv.value = rimCurv;
        if (paintOn) {
          const pc1 = fill?.c1 ?? (useTex ? '#ffffff' : String(p.color ?? '#e9e4d6'));
          const pc2 = fill?.c2 ?? pc1;   // solid → flat (c1), gradient → c1↔c2
          sh.uniforms.uC1.value.set(pc1).convertSRGBToLinear();
          sh.uniforms.uC2.value.set(pc2).convertSRGBToLinear();
        }
      }

      // selection highlight (overrides emissive on the picked group)
      if (selected && key === selected) { m.emissive.setRGB(0.12, 0.35, 0.6); m.emissiveIntensity = 1; }
      else { m.emissive.set(emissiveHex); m.emissiveIntensity = Number(p.emissiveIntensity ?? 1); }

      // paint stroke normal map — toon lighting follows the brush strokes
      const wantNormal = paintOn ? paintNormal : null;
      if (m.normalMap !== wantNormal) { m.normalMap = wantNormal; m.needsUpdate = true; }
      if (paintOn) m.normalScale.set(nStr, nStr);

      m.wireframe = wire;
      m.opacity = op;
      m.transparent = op < 1;
      const mAny = m as any;   // flatShading is valid at runtime but absent from the toon type
      if (mAny.flatShading !== flat) { mAny.flatShading = flat; m.needsUpdate = true; }
    }

    // model transform + recenter
    const md = opts.getModel?.();
    if (md) {
      pivot.scale.setScalar(Math.max(0.05, md.scale));
      pivot.rotation.set(md.rotX, md.rotY, 0);
      pivot.position.set(md.offsetX ?? 0, md.offsetY ?? 0, 0);
      // aim the window light at the flowers so the gobo lands on them
      sun.target.position.set(md.offsetX ?? 0, md.offsetY ?? 0, 0);
      sun.target.updateMatrixWorld();
      if (md.centerNonce !== lastCenterNonce) {
        lastCenterNonce = md.centerNonce;
        camera.position.copy(INIT_CAM);
        controls.target.copy(INIT_TARGET);
      }
    }

    const animState = use3DStore.getState();
    const sceneState = useSceneStore.getState();
    const duration = Math.max(0.1, sceneState.duration);
    const fps = Math.max(1, sceneState.fps);
    const progress = ((sceneState.frame / (duration * fps)) * (animState.mockupSpeed || 1)) % 1;
    apply3DAnimation(
      animState.mockupAnimation || 'static',
      progress,
      camera,
      controls,
      pivot,
      INIT_CAM,
      INIT_TARGET,
      INIT_AZIMUTH,
      INIT_ELEVATION,
      modelHalf,
      md?.rotX ?? 0,
      md?.rotY ?? 0,
      md?.offsetX ?? 0,
      md?.offsetY ?? 0,
      md?.scale ?? 1.0,
    );

    // wall (background) uniforms — gradient + stroke amount
    const wsh = wallMat.userData.shader as any;
    const bf = opts.getBgFill?.();
    if (wsh && bf) {
      wsh.uniforms.uType.value = bf.type === 'linear' ? 1 : bf.type === 'radial' ? 2 : 0;
      wsh.uniforms.uC1.value.set(bf.c1).convertSRGBToLinear();
      wsh.uniforms.uC2.value.set(bf.c2).convertSRGBToLinear();
      const bt = opts.getBgTex?.();
      if (bt) {
        const a = Math.max(0, Math.min(1, bt.amount / 100));
        wsh.uniforms.uAmount.value = a;
        wsh.uniforms.uScale.value = bt.scale;
        wallMat.normalScale.set(a, a);   // relief follows the stroke amount → in sync
      }
    }
    // window light — intensity (Sunlight), gobo (mask), hardness (Sun Shadow)
    const sunlight = opts.getSunlight?.() ?? 0;
    const sunShadow = opts.getSunShadow?.() ?? 0;
    sun.intensity = (sunlight / 100) * 14;
    sun.penumbra = 0.5 - (sunShadow / 100) * 0.46;   // higher Sun Shadow → harder
    const maskUrl = opts.getSunMask?.() ?? null;
    if (maskUrl) {
      if (maskUrl !== goboUrl) loadGobo(maskUrl);
      sun.map = goboTex;
      const mt = opts.getSunMaskTransform?.() ?? { scale: 16, offX: 0, offY: 0 };
      const key = `${goboUrl}|${mt.scale}|${mt.offX}|${mt.offY}`;
      if (key !== goboKey) { drawGobo(mt.scale / 100, mt.offX / 100, mt.offY / 100); goboKey = key; }
    } else if (sun.map) { sun.map = null; }

    rig.update();       // gizmo snap tween — writes camera.position
    if (controls.enabled) controls.update();  // re-derives its spherical state from that position
    renderer.render(scene, camera);
  }

  const renderFrameAt = (frame: number) => {
    if (disposed) return;
    const sceneState = useSceneStore.getState();
    sceneState.setFrame(frame);
    const animState = use3DStore.getState();
    const duration = Math.max(0.1, sceneState.duration);
    const fps = Math.max(1, sceneState.fps);
    const progress = ((frame / (duration * fps)) * (animState.mockupSpeed || 1)) % 1;
    const md = opts.getModel?.() ?? { scale: 1, rotX: 0, rotY: 0, offsetX: 0, offsetY: 0, centerNonce: 0 };
    apply3DAnimation(
      animState.mockupAnimation || 'static',
      progress,
      camera,
      controls,
      pivot,
      INIT_CAM,
      INIT_TARGET,
      INIT_AZIMUTH,
      INIT_ELEVATION,
      modelHalf,
      md?.rotX ?? 0,
      md?.rotY ?? 0,
      md?.offsetX ?? 0,
      md?.offsetY ?? 0,
      md?.scale ?? 1.0,
    );
    rig.update();
    if (controls.enabled) controls.update();
    renderer.render(scene, camera);
  };

  const captureFrameAt = (frame: number): string => {
    renderFrameAt(frame);
    return renderer.domElement.toDataURL('image/jpeg', 0.92);
  };

  const setCaptureScale = (k: number): void => {
    const st = useSceneStore.getState();
    renderer.setSize(Math.round(st.width * k), Math.round(st.height * k), false);
  };

  opts.onRenderer?.({
    renderFrame: renderFrameAt,
    captureFrame: captureFrameAt,
    setCaptureScale: setCaptureScale,
  });

  loop();

  return function dispose() {
    disposed = true;
    opts.onRenderer?.(null);
    opts.onCamera?.(null);
    cancelAnimationFrame(animId);
    ro.disconnect();
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
    controls.dispose();
    gradient.dispose();
    paintNormal.dispose();
    paintGrey.dispose();
    paintAlpha.dispose();
    wallMat.dispose();
    (wallMat.gradientMap as THREE.Texture | null)?.dispose();
    wall.geometry.dispose();
    for (const m of materials) m.dispose();
    if (model) model.traverse((o) => { const g = (o as THREE.Mesh).geometry; if (g) g.dispose(); });
    renderer.dispose();
  };
}
