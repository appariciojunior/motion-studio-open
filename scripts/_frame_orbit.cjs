// Where does a template's pose actually LAND on the canvas?
//
// Written to settle a disagreement between this repo's own arithmetic and its
// own stage: the ported Orbit ring computes a card scale and a camera that put
// the drum at 81% of the frame height, while a photograph of the running app
// measured 36%. One of the two had to be wrong, and a screenshot cannot say
// which. This projects the pose the same way the renderer's camera does — no
// browser, no WebGL — so the two can be compared as numbers.
//
// The renderer's camera never rotates: updateTrackCamera puts it at
// (pos.x, -pos.y, pos.z) looking at (target.x, -target.y, 0), and a pose's x/y
// are canvas coordinates that it negates on the way in. So the projection is a
// plain divide by depth, and the only subtlety is the card's own size: the
// renderer normalizes a sprite's LONG edge to SPRITE_BASE and scales by
// pose.scale.
//
// Usage: node scripts/_frame_orbit.cjs orbit-3d-04 [cardAspect] [frame]
const path = require('path');
const Module = require('module');
require('sucrase/register');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, isMain, options);
};

const { getTemplate, defaultsFor, easingFor } = require('../templates');
const { resolveEasing } = require('../lib/easing');

const SPRITE_BASE = 340;
const id = process.argv[2] || 'orbit-3d-04';
const aspect = Number(process.argv[3] || 1);
const frame = Number(process.argv[4] || 0);
// A square canvas by default, because that is the artboard five of the six Pure
// presets are authored at.
const H = Number(process.env.MS_H || 1080);
const W = Number(process.env.MS_W || Math.round(H * aspect));

const t = getTemplate(id);
const v = defaultsFor(id);
const ease = resolveEasing(easingFor(id));
const ctx = {
  fps: 30, width: W, height: H, duration: 8, totalFrames: 240, ease,
  easedPhase: (p) => Math.floor(p) + ease(p - Math.floor(p)),
  cardAspect: aspect,
};
const pose = t.camera(v, ctx);
const fov = pose.fov;
const D = (H / 2) / Math.tan((fov * Math.PI) / 360);
const cam = { x: pose.position.x, y: -pose.position.y, z: pose.position.z };

let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, drawn = 0;
for (let i = 0; i < v.count; i++) {
  const p = t.transform3d(frame, i, v.count, v, ctx);
  if ((p.alpha ?? 1) <= 0.02 || p.scale <= 0) continue;
  drawn++;
  const long = SPRITE_BASE * p.scale;
  const hw = (aspect <= 1 ? long * aspect : long) / 2;
  const hh = (aspect <= 1 ? long : long / aspect) / 2;
  const q = p.quaternion || { x: 0, y: 0, z: 0, w: 1 };
  const turn = (b) => {
    const tx = 2 * (q.y * b[2] - q.z * b[1]);
    const ty = 2 * (q.z * b[0] - q.x * b[2]);
    const tz = 2 * (q.x * b[1] - q.y * b[0]);
    return [
      b[0] + q.w * tx + (q.y * tz - q.z * ty),
      b[1] + q.w * ty + (q.z * tx - q.x * tz),
      b[2] + q.w * tz + (q.x * ty - q.y * tx),
    ];
  };
  const u = turn([1, 0, 0]), w = turn([0, 1, 0]);
  const centre = { x: p.x, y: -p.y, z: p.z };   // as the renderer places it
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const X = centre.x + sx * hw * u[0] + sy * hh * w[0];
      const Y = centre.y + sx * hw * u[1] + sy * hh * w[1];
      const Z = centre.z + sx * hw * u[2] + sy * hh * w[2];
      const depth = cam.z - Z;
      if (depth <= 1) continue;                 // behind the lens
      const px = ((X - cam.x) * D) / depth;
      const py = ((Y - cam.y) * D) / depth;
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
  }
}
console.log(id, 'frame', frame, 'aspect', aspect, 'canvas', W + 'x' + H, 'cards drawn', drawn + '/' + v.count);
console.log('  camera fov', fov.toFixed(3), 'z', cam.z.toFixed(1), '| half-height at z=0', (cam.z * Math.tan((fov * Math.PI) / 360)).toFixed(1), 'px against a canvas half of', H / 2);
console.log('  projected bbox', (x1 - x0).toFixed(1) + ' x ' + (y1 - y0).toFixed(1), 'px',
  '| of the frame', ((x1 - x0) / W).toFixed(3) + ' x ' + ((y1 - y0) / H).toFixed(3));
