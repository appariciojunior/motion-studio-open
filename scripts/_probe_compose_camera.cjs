#!/usr/bin/env node
// Mede a CAMERA sozinha: semeia a cena com o compose e a parede parada, entao
// o que restar de movimento e so o que a camera fez. Clicar no controle de
// Speed nao serve — as duas medidas sairam identicas e so o retorno do evaluate
// teria denunciado que ele nao pegou.
const fs=require('fs'), path=require('path'), puppeteer=require('puppeteer-core');
require('sucrase/register');
const M=require('module'); const _r=M._resolveFilename;
M._resolveFilename=function(q,...a){ return _r.call(this, q.startsWith('@/')?path.join(__dirname,'..',q.slice(2)):q, ...a); };
const { SHIPPED_COMPOSES } = require('../lib/composes.ts');
const CHROME=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>fs.existsSync(p));
const U=process.argv[2]||'http://localhost:3123', OUT=process.argv[3]||'.', NOME=process.argv[4]||'Contact Sheet';
const N=Number(process.env.MS_N||105);
const cmp=SHIPPED_COMPOSES.find(c=>c.name===NOME);
if(!cmp){ console.log('compose nao encontrado:',NOME); process.exit(1); }
(async()=>{
  const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--enable-gpu'],defaultViewport:{width:1600,height:1100}});
  const p=await b.newPage();
  p.on('pageerror',e=>console.log('  [pageerror]',e.message));
  p.on('console',m=>{ if(m.type()==='error'||m.type()==='warning') console.log('  ['+m.type()+']',m.text().slice(0,300)); });
  await p.goto(U+'/library',{waitUntil:'domcontentloaded',timeout:180000});
  await p.evaluate((cmp,cam)=>{
    const s={activeTemplateId:cmp.templateId,
      tracks:[{id:'t0',templateId:cmp.templateId,values:{...cmp.values, speed:0, sweep:0},visible:true}],
      width:810,height:1080,fps:30,duration:7,easing:cmp.easing,
      background:{source:'color',color:'#ff00ff',gradient:false,color2:'#ff00ff',imageUrl:null,blur:0},
      effects:[], sceneCamera:(cam||cmp.sceneCamera)};
    localStorage.setItem('motion-welcome-seen','1');localStorage.setItem('motion-tour-seen','1');
    localStorage.setItem('motion-scene-v1',JSON.stringify(s));
    localStorage.setItem('motion-project-cc',JSON.stringify(s));
    localStorage.setItem('motion-projects-v1',JSON.stringify({activeId:'cc',projects:[{id:'cc',name:'CC',createdAt:1,updatedAt:2,mode:'2d'}]}));
  }, cmp, process.env.MS_CAMJSON?JSON.parse(process.env.MS_CAMJSON):null);
  await p.goto(U+'/library',{waitUntil:'networkidle2',timeout:180000});
  await p.evaluate(()=>{document.querySelectorAll('[role=dialog], .modal-backdrop').forEach(el=>{el.style.display='none';});});
  await new Promise(r=>setTimeout(r,3000));
  // confere que a cena semeada e a que esta no ar, em vez de torcer
  const conf=await p.evaluate(()=>{
    const raw=JSON.parse(localStorage.getItem('motion-project-cc')||'{}');
    return {speed:raw.tracks?.[0]?.values?.speed, cam:Object.keys(raw.sceneCamera||{}).length,
            palco:!!document.querySelector('canvas.stage-canvas')};
  });
  console.log('cena no ar:',JSON.stringify(conf));
  if(conf.speed!==0){ console.log('A PAREDE NAO ESTA PARADA — medicao abortada'); await b.close(); process.exit(1); }
  const cv=await p.$('canvas.stage-canvas');
  fs.mkdirSync(OUT,{recursive:true});
  const total=await p.evaluate(()=>{const r=document.querySelector('.scrubber input[type=range]');return r?Number(r.max):209;});
  for(let k=0;k<N;k++){
    const q=Math.round(k*total/(N-1));
    await p.evaluate((v)=>{const r=document.querySelector('.scrubber input[type=range]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(r,String(v));
      r.dispatchEvent(new Event('input',{bubbles:true}));},q);
    await new Promise(r=>setTimeout(r,240));
    await cv.screenshot({path:path.join(OUT,String(k).padStart(3,'0')+'.png')});
  }
  console.log('quadros:',N,'de 0 a',total);
  await b.close();
})();
