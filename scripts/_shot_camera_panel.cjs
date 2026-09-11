#!/usr/bin/env node
// Fotografa a secao Camera do painel — o widget de caminho, nao o palco.
const fs=require('fs'), path=require('path'), puppeteer=require('puppeteer-core');
const CHROME=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>{try{return fs.existsSync(p)}catch{return false}});
const U=process.argv[2]||'http://localhost:3123', OUT=process.argv[3]||'.';
const semear=function(){
  const s={activeTemplateId:'wall-01',tracks:[{id:'t0',templateId:'wall-01',values:{speed:0.2}}],
    width:810,height:1080,fps:30,duration:8,
    background:{source:'color',color:'#1a1a1a',gradient:false,color2:'#1a1a1a',imageUrl:null,blur:28},effects:[],
    sceneCamera:{_camZoom:110,_camPanX:-25,_camPanY:0,_camOrbitY:0,_camOrbitX:0,_camHold:50,
      _camStop2:{x:35,y:-10},_camStop2Zoom:150,_camStop3:{x:60,y:40},_camStop3Zoom:100}};
  localStorage.setItem('motion-welcome-seen','1');localStorage.setItem('motion-tour-seen','1');
  localStorage.setItem('motion-scene-v1',JSON.stringify(s));
  localStorage.setItem('motion-project-shotcam',JSON.stringify(s));
  localStorage.setItem('motion-projects-v1',JSON.stringify({activeId:'shotcam',projects:[{id:'shotcam',name:'Cam',createdAt:1,updatedAt:2,mode:'2d'}]}));
};
(async()=>{
  const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--enable-gpu'],defaultViewport:{width:1600,height:1100}});
  const p=await b.newPage();
  await p.goto(U+'/library',{waitUntil:'domcontentloaded',timeout:180000});
  await p.evaluate(semear);
  await p.goto(U+'/library',{waitUntil:'networkidle2',timeout:180000});
  await p.evaluate(()=>{document.querySelectorAll('[role=dialog], .modal-backdrop').forEach(el=>{el.style.display='none';});});
  await new Promise(r=>setTimeout(r,2500));
  await p.evaluate(()=>{const t=Array.from(document.querySelectorAll('button,[role=tab],a')).find(e=>e.textContent.trim()==='Adjust'); if(t) t.click();});
  await new Promise(r=>setTimeout(r,2500));
  // seleciona a parada 2, para a linha do zoom aparecer na foto
  await p.evaluate(()=>{const d=Array.from(document.querySelectorAll('.campath-dot')).find(x=>x.textContent.trim()==='2');
    d?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,buttons:1,clientX:0,clientY:0}));});
  await new Promise(r=>setTimeout(r,700));
  // rola a secao Camera para dentro da vista e fotografa o recorte
  const caixa=await p.evaluate(()=>{
    const cab=Array.from(document.querySelectorAll('.section-head')).find(el=>(el.querySelector('.eyebrow')||{}).textContent?.trim()==='Camera');
    if(!cab) return null;
    cab.scrollIntoView({block:'start'});
    return null;
  });
  await new Promise(r=>setTimeout(r,600));
  // O recorte do puppeteer e espaco do DOCUMENTO: le a caixa DEPOIS de rolar.
  const rect=await p.evaluate(()=>{
    const cab=Array.from(document.querySelectorAll('.section-head')).find(el=>(el.querySelector('.eyebrow')||{}).textContent?.trim()==='Camera');
    let n=cab, ultimo=cab;
    while(n && !(n!==cab && n.classList.contains('hairline'))){ ultimo=n; n=n.nextElementSibling; }
    const a=cab.getBoundingClientRect(), z=ultimo.getBoundingClientRect();
    return {x:a.left+scrollX-10, y:a.top+scrollY-10, width:a.width+20, height:(z.bottom-a.top)+20};
  });
  const arq=path.join(OUT,'camera-panel.png');
  await p.screenshot({path:arq, clip:rect});
  console.log(arq+'  '+fs.statSync(arq).size+' bytes  ('+Math.round(rect.width)+'x'+Math.round(rect.height)+')');
  await b.close();
})();
