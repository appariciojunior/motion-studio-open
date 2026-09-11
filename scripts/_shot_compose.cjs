#!/usr/bin/env node
// Aplica um compose embarcado e fotografa o PALCO ao longo do clipe, para medir
// o movimento com a mesma regua usada no video de referencia.
const fs=require('fs'), path=require('path'), puppeteer=require('puppeteer-core');
const CHROME=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>fs.existsSync(p));
const U=process.argv[2]||'http://localhost:3123', OUT=process.argv[3]||'.', NOME=process.argv[4]||'Contact Sheet';
const N=Number(process.env.MS_N||35);
(async()=>{
  const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--enable-gpu'],defaultViewport:{width:1600,height:1100}});
  const p=await b.newPage();
  p.on('pageerror',e=>console.log('  [erro]',e.message));
  await p.goto(U+'/library',{waitUntil:'domcontentloaded',timeout:180000});
  await p.evaluate(()=>{
    const s={activeTemplateId:'wall-01',tracks:[{id:'t0',templateId:'wall-01',values:{}}],
      width:810,height:1080,fps:30,duration:7,
      background:{source:'color',color:'#f2efe9',gradient:false,color2:'#f2efe9',imageUrl:null,blur:0},effects:[],sceneCamera:{}};
    localStorage.setItem('motion-welcome-seen','1');localStorage.setItem('motion-tour-seen','1');
    localStorage.setItem('motion-scene-v1',JSON.stringify(s));
    localStorage.setItem('motion-project-cmp',JSON.stringify(s));
    localStorage.setItem('motion-projects-v1',JSON.stringify({activeId:'cmp',projects:[{id:'cmp',name:'Cmp',createdAt:1,updatedAt:2,mode:'2d'}]}));
  });
  await p.goto(U+'/library',{waitUntil:'networkidle2',timeout:180000});
  await p.evaluate(()=>{document.querySelectorAll('[role=dialog], .modal-backdrop').forEach(el=>{el.style.display='none';});});
  await new Promise(r=>setTimeout(r,3000));
  // abre a aba Composes e escolhe o cartao pelo nome
  const achou=await p.evaluate((nome)=>{
    const t=[...document.querySelectorAll('button,[role=tab]')].find(e=>e.textContent.trim()==='Composes');
    if(!t) return 'sem aba Composes';
    t.click();
    return new Promise(res=>setTimeout(()=>{
      const c=[...document.querySelectorAll('.tpl-card-custom')].find(e=>e.textContent.includes(nome));
      if(!c) return res('cartao "'+nome+'" nao esta na aba ('+document.querySelectorAll('.tpl-card-custom').length+' cartoes)');
      c.click(); res('ok');
    },900));
  },NOME);
  console.log('escolha do compose:',achou);
  if(achou!=='ok'){ await b.close(); process.exit(1); }
  await new Promise(r=>setTimeout(r,2500));
  // MS_SPEED=0 congela a parede: o que sobrar de movimento e camera e so camera.
  if(process.env.MS_SPEED!==undefined){
    await p.evaluate((v)=>{
      const alvo=[...document.querySelectorAll('.ctl-row')].find(e=>e.textContent.trim().startsWith('Speed'));
      const inp=alvo?.querySelector('input[type=range]');
      if(!inp) return 'sem Speed';
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(inp,String(v));
      inp.dispatchEvent(new Event('input',{bubbles:true}));
      return 'ok';
    }, process.env.MS_SPEED);
    await new Promise(r=>setTimeout(r,1200));
    console.log('parede congelada em speed', process.env.MS_SPEED);
  }
  const cam=await p.evaluate(()=>{const raw=localStorage.getItem('motion-project-cmp');
    return raw?JSON.parse(raw).sceneCamera:null;});
  console.log('camera aplicada:',JSON.stringify(cam));
  const cv=await p.$('canvas.stage-canvas');
  if(!cv){ console.log('sem palco'); await b.close(); process.exit(1); }
  fs.mkdirSync(OUT,{recursive:true});
  const total=await p.evaluate(()=>{const r=document.querySelector('.scrubber input[type=range]');return r?Number(r.max):209;});
  for(let k=0;k<N;k++){
    const q=Math.round(k*total/(N-1));
    await p.evaluate((v)=>{const r=document.querySelector('.scrubber input[type=range]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(r,String(v));
      r.dispatchEvent(new Event('input',{bubbles:true}));},q);
    await new Promise(r=>setTimeout(r,260));
    await cv.screenshot({path:path.join(OUT,String(k).padStart(3,'0')+'.png')});
  }
  console.log('quadros:',N,' de 0 a',total,' em',OUT);
  await b.close();
})();
