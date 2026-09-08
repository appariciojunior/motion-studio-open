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
const ids=templateList.filter(t=>['Parallax','Drift','Proximity','Warp','Ticker'].includes(t.meta.group)).map(t=>t.meta.id);
for (const id of ids) {
 const t=getTemplate(id),base=defaultsFor(id);
 for (const [label,patch,w,h] of [
  ['portrait',{},1080,1920],['landscape',{},3840,2160],
  ['stress',id.startsWith('parallax-r') || /^parallax-0[1-4]$/.test(id) ? {count:8,spread:20,travel:300,offset:{x:300,y:-200}} :
    id.startsWith('field-prox') ? {count:100,panRange:200,maxScale:200,tilt:45,sizeMix:100,offset:{x:300,y:-200}} :
    id.startsWith('ticker') ? {count:2,rows:1,outerFade:0,cardSize:100,speed:2,offset:{x:300,y:-200}} :
    {offset:{x:350,y:600},speed:2},1080,1920],
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

for(const id of ids) {
 const t=getTemplate(id),base=defaultsFor(id),c=context(id,1080,1920);
 if(base.speed===undefined) continue;
 const v={...base,speed:0},n=layerCountFor(id,v,c);
 for(let i=0;i<n;i++) {
  const a=t.transform(0,i,n,v,c),b=t.transform(117,i,n,v,c);
  check(Math.hypot(a.x-b.x,a.y-b.y)+Math.abs(a.scale-b.scale)+Math.abs(a.alpha-b.alpha)<1e-7,id+' zero speed moved');
 }
}
check(defaultsFor('field-prox-01').buildInOut==='off','Proximity should default to continuous');
{
 const id='field-prox-01',t=getTemplate(id),v={...defaultsFor(id),buildInOut:'on'},c=context(id,1080,1920),n=layerCountFor(id,v,c);
 for(let i=0;i<n;i++)check(t.transform(0,i,n,v,c).scale===0,'explicit build-in option lost');
}
// The projected card normals must agree with the plane traced by their centres.
// Euler XYZ applied after a Ry*Rx point transform makes coplanar cards intersect.
{
 const THREE=require('three'),id='ticker-02',t=getTemplate(id),c=context(id,1080,1920);
 for(const tilt of [-55,30,55])for(const perspective of [0,60,100]) {
  const v={...defaultsFor(id),tilt,perspective},n=layerCountFor(id,v,c);
  const a=t.transform3d(57,0,n,v,c),q=new THREE.Quaternion(a.quaternion.x,a.quaternion.y,a.quaternion.z,a.quaternion.w);
  const normal=new THREE.Vector3(0,0,1).applyQuaternion(q);
  for(let i=1;i<n;i++) {
   const b=t.transform3d(57,i,n,v,c),d=new THREE.Vector3(b.x-a.x,a.y-b.y,b.z-a.z);
   check(Math.abs(d.dot(normal))<1e-6,'Ticker card planes intersect');
  }
 }
}
console.log('Infinite fields passed: '+ids.length+' presets, '+assertions+' assertions, '+replacements+' visible recycling events matched.');
