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
const ids = ['wall-01','wall-02','wall-03','wall-04','wall-05','wall-06','wall-07','grid-01','grid-02','grid-03','grid-04','grid-05','spiral-01','spiral-02','spiral-03','spiral-04'];
for (const id of ids) {
 const t=getTemplate(id),base=defaultsFor(id);
 for (const [label,patch,w,h] of [
  ['portrait',{},1080,1920],['landscape',{},3840,2160],['square',{},2160,2160],
  ['large cards',{cardSize:Math.min(1000,id.startsWith('spiral')?300:1000),offset:{x:350,y:-300}},1080,1920],
  ['reverse',{direction:'reverse'},1920,1080],
  ['small cards',id.startsWith('spiral')?{count:8,pitch:10,cardSize:20}:{cardSize:100,gap:0},1080,1920],
  ['breath',id.startsWith('grid')?{breath:'on',pulseAmt:60,zoom:'on',zoomAmount:60}: {},1080,1920],
 ]) {
  const v={...base,...patch},c=context(id,w,h),n=layerCountFor(id,v,c),media=Array.from({length:n},(_,i)=>t.mediaIndex?.(i,n,v,c)??i);
  const tag=id+' '+label;
  check(Math.max(...media)<mediaCountFor(id,v,c),tag+' invalid media');
  const c2={...c,width:w*2,height:h*2},n2=layerCountFor(id,v,c2);
  check(n===n2,tag+' resize changed topology');
  for(const f of [0,17,119,239,240,481]) for(let i=0;i<n;i+=Math.max(1,Math.floor(n/19))) {
   const a=t.transform(f,i,n,v,c),b=t.transform(f,i,n2,v,c2);
   check(Math.hypot(a.x-b.x/2,a.y-b.y/2)<1e-6 && Math.abs(a.scale-b.scale/2)<1e-7,tag+' resolution changed composition');
   const end=t.transform(f+240,i,n,v,c);
   check(Math.hypot(a.x-end.x,a.y-end.y)<1e-5 && Math.abs(a.alpha-end.alpha)<1e-7,tag+' nonperiodic pose');
  }
  // Follow every card for two loops. A teleport while visible must be replaced
  // by a nearby copy with the SAME media, scale, rotation and opacity.
  let before=Array.from({length:n},(_,i)=>t.transform(0,i,n,v,c));
  for(let f=1;f<=480;f++) {
   const after=Array.from({length:n},(_,i)=>t.transform(f,i,n,v,c));
   const byMedia=new Map(); after.forEach((p,i)=>{if(!byMedia.has(media[i]))byMedia.set(media[i],[]);byMedia.get(media[i]).push(p);});
   const scale=Math.max(w,h)/1080;
   for(let i=0;i<n;i++) {
    const a=before[i],b=after[i],d=Math.hypot(a.x-b.x,a.y-b.y);
    check([b.x,b.y,b.scale,b.alpha].every(Number.isFinite)&&b.alpha>=0&&b.alpha<=1,tag+' invalid transform');
    if(d<120*scale||!visible(a,c))continue;
    // Locate the discontinuity inside this frame interval, then inspect both
    // sides at subframe precision. Fast legitimate motion is not a teleport.
    let lo=f-1,hi=f;
    for(let step=0;step<24;step++) {
      const mid=(lo+hi)/2,p=t.transform(mid,i,n,v,c);
      if(Math.hypot(a.x-p.x,a.y-p.y)>120*scale)hi=mid;else lo=mid;
    }
    const left=t.transform(lo-.00001,i,n,v,c),right=t.transform(hi+.00001,i,n,v,c);
    if(Math.hypot(left.x-right.x,left.y-right.y)<scale || !visible(left,c))continue;
    let nearest=Infinity;
    for(let j=0;j<n;j++)if(media[j]===media[i]) {
      const p=t.transform(hi+.00001,j,n,v,c);
      nearest=Math.min(nearest,Math.hypot(left.x-p.x,left.y-p.y)+340*Math.abs(left.scale-p.scale)+100*Math.abs(left.alpha-p.alpha));
    }
    check(nearest<scale,tag+' exposed recycling frame '+f+' slot '+i+' distance '+nearest);
    replacements++;
   }
   before=after;
  }
 }
 console.log(id+' continuity + resolution passed');
}
for(const id of ['wall-01','grid-01','spiral-01']) {
 const t=getTemplate(id),v={...defaultsFor(id),speed:0,cycles:0},c=context(id,1080,1920),n=layerCountFor(id,v,c);
 for(let i=0;i<n;i++)check(JSON.stringify(t.transform(0,i,n,v,c))===JSON.stringify(t.transform(117,i,n,v,c)),id+' zero speed moved');
}
// The rendered spacing, including a dense 4K scene, must honour the user's gap.
for(const gap of [0,30,300])for(const cardSize of [60,100,700,1000]) {
 const l=solveLattice({cardSize,gap},{width:3840,height:2160,cardAspect:.75});
 check(Math.abs((l.pitchX-l.cardW)/l.scale-gap)<1e-7,'horizontal gap changed');
 check(Math.abs((l.pitchY-l.cardH)/l.scale-gap)<1e-7,'vertical gap changed');
}
// Fractional cycle controls on spatial Helix presets must close the actual 3D pose.
for(let k=1;k<=9;k++)for(const cycles of [.25,1,2.5,12])for(const cycleDeg of [15,60,360]) {
 const id='coil-0'+k,t=getTemplate(id),v={...defaultsFor(id),cycles,cycleDeg,wobble:60},c=context(id,1080,1920),n=v.count;
 for(const i of [0,Math.floor(n/2),n-1]) {const a=t.transform3d(0,i,n,v,c),b=t.transform3d(240,i,n,v,c);check(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)<1e-6,id+' fractional spin seam');}
}
console.log('Infinite canvas passed: '+assertions+' assertions, '+replacements+' visible recycling events matched.');
