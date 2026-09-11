#!/usr/bin/env node
// Mede o compose no fluxo REAL: deixa o app abrir o projeto padrao com os
// assets dele, escolhe o compose na aba Composes e so entao mexe na camera.
//
// A versao anterior semeava a cena inteira, inclusive sem `assets`. Com o pool
// vazio a contagem de cartoes nao vem da trelica e o ramo `fixedCount` de
// solveLattice reescreve cols/rows: a parede virava 5x4 e parecia que a camera
// via alem dela. Media a propria semente, nao o app.
const fs=require('fs'), path=require('path'), puppeteer=require('puppeteer-core');
const CHROME=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>fs.existsSync(p));
const U=process.argv[2]||'http://localhost:3123', OUT=process.argv[3]||'.', NOME=process.argv[4]||'Contact Sheet';
const N=Number(process.env.MS_N||40);
// A cena PADRAO da propria store, extraida em node — inclusive os 8 assets.
// Semear sem eles foi o que falseou todas as medicoes anteriores: com o pool
// vazio a contagem de cartoes nao vem da trelica, o ramo `fixedCount` de
// solveLattice reescreve cols/rows, e a parede vira um retalho de 5x4.
const BASE=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','default-scene.json'),'utf8'));
(async()=>{
  const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--enable-gpu'],defaultViewport:{width:1600,height:1100}});
  const p=await b.newPage();
  p.on('pageerror',e=>console.log('  [pageerror]',e.message));
  p.on('console',m=>{if(m.type()==='error')console.log('  [error]',m.text().slice(0,200));});
  await p.goto(U+'/library',{waitUntil:'domcontentloaded',timeout:180000});
  await p.evaluate((base,cam,bg)=>{
    localStorage.setItem('motion-welcome-seen','1');localStorage.setItem('motion-tour-seen','1');
    const s={...base, sceneCamera:cam||{}};
    // Fundo separavel: so assim o medidor de vazamento distingue "sem parede"
    // de "vao escuro entre cartoes". Com fundo escuro ele conta o vao e mente.
    if(bg) s.background={source:'color',color:bg,gradient:false,color2:bg,imageUrl:null,blur:0};
    localStorage.setItem('motion-scene-v1',JSON.stringify(s));
    localStorage.setItem('motion-project-real',JSON.stringify(s));
    localStorage.setItem('motion-projects-v1',JSON.stringify({activeId:'real',projects:[{id:'real',name:'Real',createdAt:1,updatedAt:2,mode:'2d'}]}));
  }, BASE, process.env.MS_CAMJSON?JSON.parse(process.env.MS_CAMJSON):null, process.env.MS_BG||null);
  await p.goto(U+'/library',{waitUntil:'networkidle2',timeout:180000});
  await p.evaluate(()=>{document.querySelectorAll('[role=dialog], .modal-backdrop').forEach(el=>{el.style.display='none';});});
  await new Promise(r=>setTimeout(r,4000));
  const antes=await p.evaluate(()=>{
    const raw=JSON.parse(localStorage.getItem('motion-scene-v1')||'{}');
    return {assets:(raw.assets||[]).length, tpl:raw.activeTemplateId};
  });
  console.log('projeto padrao:',JSON.stringify(antes));
  // O localStorage so recebe a cena depois da primeira alteracao, entao ler
  // 0 assets aqui nao diz nada — a store nasce com 8. Nao abortar por isso.
  const achou=await p.evaluate((nome)=>{
    const t=[...document.querySelectorAll('button,[role=tab]')].find(e=>e.textContent.trim()==='Composes');
    if(!t) return 'sem aba Composes'; t.click();
    return new Promise(res=>setTimeout(()=>{
      const c=[...document.querySelectorAll('.tpl-card-custom')].find(e=>e.textContent.includes(nome));
      if(!c) return res('cartao nao achado ('+document.querySelectorAll('.tpl-card-custom').length+' cartoes)');
      c.click(); res('ok');},1200));},NOME);
  console.log('compose:',achou);
  if(achou!=='ok'){ await b.close(); process.exit(1); }
  await new Promise(r=>setTimeout(r,3000));
  const depois=await p.evaluate(()=>{
    const raw=JSON.parse(localStorage.getItem('motion-project-real')||localStorage.getItem('motion-scene-v1')||'{}');
    return {assets:(raw.assets||[]).length, tplAtivo:raw.activeTemplateId, tplDaPista:(raw.tracks||[]).map(t=>t.templateId), cam:Object.keys(raw.sceneCamera||{}).length, camZoom:(raw.sceneCamera||{})._camZoom, stops:Object.keys(raw.sceneCamera||{}).filter(k=>/Stopd+$/.test(k)).length};
  });
  console.log('depois do compose:',JSON.stringify(depois));
  const cv=await p.$('canvas.stage-canvas');
  if(!cv){ console.log('sem palco'); await b.close(); process.exit(1); }
  // Um palco vazio passa em qualquer teste de vazamento. Exigir que ele tenha
  // conteudo antes de medir qualquer coisa nele.
  const vivo=await p.evaluate(()=>{
    const c=document.querySelector('canvas.stage-canvas');
    const g=document.createElement('canvas'); g.width=60; g.height=80;
    const x=g.getContext('2d'); x.drawImage(c,0,0,60,80);
    const d=x.getImageData(0,0,60,80).data; const vals=[];
    for(let i=0;i<d.length;i+=4) vals.push(d[i]*0.3+d[i+1]*0.59+d[i+2]*0.11);
    const m=vals.reduce((a,b)=>a+b,0)/vals.length;
    return {media:+m.toFixed(1), desvio:+Math.sqrt(vals.reduce((a,v)=>a+(v-m)**2,0)/vals.length).toFixed(1)};
  });
  console.log('palco:',JSON.stringify(vivo));
  if(vivo.desvio<8){ console.log('PALCO VAZIO — medicao abortada'); await b.close(); process.exit(1); }
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
