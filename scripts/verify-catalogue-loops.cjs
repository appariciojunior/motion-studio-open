// Continuous coverage, media identity and output-resolution invariants.
const assert = require('node:assert/strict');
const path = require('node:path'), Module = require('node:module');
require('sucrase/register');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(r, ...args) { return resolve.call(this, r.startsWith('@/') ? path.join(__dirname, '..', r.slice(2)) : r, ...args); };
const { getTemplate, defaultsFor, easingFor, layerCountFor, mediaCountFor } = require('../templates');
const { resolveEasing } = require('../lib/easing');
const { solveLattice } = require('../templates/lattice');
let assertions = 0, replacements = 0;
function check(ok, message) { assertions++; assert.ok(ok, message); }
function context(id,w,h,duration=8) { const ease=resolveEasing(easingFor(id)); return {width:w,height:h,fps:30,duration,totalFrames:duration*30,cardAspect:.75,ease,easedPhase:p=>Math.floor(p)+ease(p-Math.floor(p))}; }
function visible(p,c) {
 const long=340*p.scale, w=long*Math.min(1,c.cardAspect),h=long*Math.min(1,1/c.cardAspect);
 const a=Math.abs(Math.cos(p.rotation)),b=Math.abs(Math.sin(p.rotation));
 return p.alpha>.01 && Math.abs(p.x)<c.width/2+(a*w+b*h)/2 && Math.abs(p.y)<c.height/2+(b*w+a*h)/2;
}

const {templateList}=require('../templates');
const {refSpinRadians}=require('../templates/refScene3d');
const ids=templateList.filter(t=>/^(spiral-images-|scale-|canvas-gallery-|ring-r|ring-base$|globe-r|carousel3d-)/.test(t.meta.id)).map(t=>t.meta.id);
let failures=[];
function expect(ok,msg){assertions++;if(!ok&&!failures.includes(msg)&&failures.length<80)failures.push(msg);}
for(const id of ids) {
 const t=getTemplate(id),base=defaultsFor(id);
 for(const patch of [{},{cycles:.25,cycleDeg:60},{cycles:1.25,motion:'stepped'},{cycles:2.5,cycleDeg:180},{fade:0,zoom:80,spin:'on',spinAmt:30}]) {
  const v={...base,...patch},c=context(id,1080,1920),n=layerCountFor(id,v,c),c2={...c,width:2160,height:3840};
  if(t.camera) {
   const ca=t.camera(v,c),cb=t.camera(v,c2);
   expect(Math.abs((ca.fov??50)-(cb.fov??50))<1e-7 && Math.abs((ca.distance??1)-(cb.distance??1))<1e-7,id+' resize changed camera lens');
  }
  for(const f of [0,17,57,119,239])for(let i=0;i<n;i++) {
   const a=t.transform(f,i,n,v,c),b=t.transform(f+240,i,n,v,c),r=t.transform(f,i,n,v,c2);
   if(!id.startsWith('spiral-images-') && (a.alpha>.01 || b.alpha>.01))expect(Math.hypot(a.x-b.x,a.y-b.y)+340*Math.abs(a.scale-b.scale)+100*Math.abs(a.alpha-b.alpha)<1e-4,id+' timeline seam');
   expect(Math.hypot(a.x-r.x/2,a.y-r.y/2)+340*Math.abs(a.scale-r.scale/2)<1e-5,id+' resize composition');
   if(t.transform3d) {
    const x=t.transform3d(f,i,n,v,c),y=t.transform3d(f+240,i,n,v,c);
    if(x.alpha>.01||y.alpha>.01)expect(Math.hypot(x.x-y.x,x.y-y.y,x.z-y.z)+100*Math.abs(x.alpha-y.alpha)<1e-4,id+' 3D loop seam');
   }
  }
 }
}
// Inspect both sides of ALL card handoffs, not only integer frame boundaries.
for(const id of ['scale-01','scale-02','scale-03','scale-04','scale-05','scale-06','canvas-gallery-01','canvas-gallery-02','canvas-gallery-03']) {
 const t=getTemplate(id),c=context(id,1080,1920);
 for(const patch of [{},{fade:0,zoom:80,spin:'on',spinAmt:30,offset:{x:200,y:-150}},{appear:'in-out',holdT:0}]) {
  const v={...defaultsFor(id),...patch},n=v.count;
  const events=id.startsWith('scale') ? require('../lib/motion').loopCycles(v.speed,c.duration,n) : n*Math.max(1,Math.round(c.duration/(v.appearT+v.holdT+v.exitT)));
  for(let step=0;step<=events*2;step++) {
   const f=step/events*240/2;
   for(let i=0;i<n;i++) {
    const a=t.transform(f-1e-5,i,n,v,c),b=t.transform(f+1e-5,i,n,v,c);
    const weight=Math.min(a.alpha,b.alpha);
    const geometric=(Math.hypot(a.x-b.x,a.y-b.y)+340*Math.abs(a.scale-b.scale)+100*Math.abs(Math.sin((a.rotation-b.rotation)/2)))*weight;
    expect(geometric<.1&&Math.abs(a.alpha-b.alpha)<.001,id+' visible handoff '+f.toFixed(3)+' slot '+i);
   }
  }
 }
}
// Spiral currently exposes a free-running speed. Keep its low-speed contract
// while the duration policy is pending; still cover resizing and every recycle.
for(const id of ids.filter(id=>id.startsWith('spiral-images-'))) {
 const t=getTemplate(id),c=context(id,1080,1920),long=context(id,1080,1920,16);
 for(const direction of ['inward','outward'])for(const taper of [0,2]) {
  const v={...defaultsFor(id),direction,taper,fadeIn:0,fadeOut:0},n=v.count;
  for(let i=0;i<n;i++) {
   const a=t.transform(30,i,n,v,c),b=t.transform(30,i,n,v,long);
   expect(Math.hypot(a.x-b.x,a.y-b.y)<1e-6,id+' changed slow speed with duration');
   const phase=direction==='inward'?1-i/n:i/n;
   const f=phase/(v.speed*.3)*30;
   const left=t.transform(f-1e-6,i,n,v,c),right=t.transform(f+1e-6,i,n,v,c);
   expect(left.alpha<1e-4 && right.alpha<1e-4,id+' visible path recycle');
  }
 }
}
console.log(JSON.stringify({presets:ids.length,assertions,failures:[...new Set(failures)],pending:'Spiral slow-speed timeline closure requires duration policy; geometry and path recycling tested.'},null,2));
if(failures.length)process.exitCode=1;
