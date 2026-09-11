// Clica o botao Add de verdade e mede o que aconteceu: a secao cresceu? o pad
// existe? uma parada adicionada pelo clique no pad chega na store?
const fs=require('fs'), path=require('path'), puppeteer=require('puppeteer-core');
const CHROME=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>fs.existsSync(p));
const U='http://localhost:3123', OUT=process.argv[2];
(async()=>{
  const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--enable-gpu'],defaultViewport:{width:1600,height:1100}});
  const p=await b.newPage();
  p.on('pageerror',e=>console.log('  [erro de pagina]',e.message));
  await p.goto(U+'/library',{waitUntil:'domcontentloaded',timeout:180000});
  await p.evaluate(()=>{
    const s={activeTemplateId:'wall-01',tracks:[{id:'t0',templateId:'wall-01',values:{speed:0.2}}],
      width:810,height:1080,fps:30,duration:8,
      background:{source:'color',color:'#1a1a1a',gradient:false,color2:'#1a1a1a',imageUrl:null,blur:28},effects:[],sceneCamera:{}};
    localStorage.setItem('motion-welcome-seen','1');localStorage.setItem('motion-tour-seen','1');
    localStorage.setItem('motion-scene-v1',JSON.stringify(s));
    localStorage.setItem('motion-project-addcam',JSON.stringify(s));
    localStorage.setItem('motion-projects-v1',JSON.stringify({activeId:'addcam',projects:[{id:'addcam',name:'Cam',createdAt:1,updatedAt:2,mode:'2d'}]}));
  });
  await p.goto(U+'/library',{waitUntil:'networkidle2',timeout:180000});
  await p.evaluate(()=>{document.querySelectorAll('[role=dialog], .modal-backdrop').forEach(el=>{el.style.display='none';});});
  await new Promise(r=>setTimeout(r,2500));
  await p.evaluate(()=>{const t=[...document.querySelectorAll('button,[role=tab],a')].find(e=>e.textContent.trim()==='Adjust'); t&&t.click();});
  await new Promise(r=>setTimeout(r,2000));

  const alturaSecao=()=>p.evaluate(()=>{
    const cab=[...document.querySelectorAll('.section-head')].find(el=>el.querySelector('.eyebrow')?.textContent.trim()==='Camera');
    if(!cab) return null;
    let n=cab,ultimo=cab;
    while(n && !(n!==cab && n.classList.contains('hairline'))){ultimo=n;n=n.nextElementSibling;}
    return {altura:Math.round(ultimo.getBoundingClientRect().bottom-cab.getBoundingClientRect().top),
            botao:cab.querySelector('button')?.textContent.trim(), pads:document.querySelectorAll('.campath').length};
  });
  console.log('ANTES do clique :', JSON.stringify(await alturaSecao()));

  // clica o botao Add como um usuario
  const clicou=await p.evaluate(()=>{
    const cab=[...document.querySelectorAll('.section-head')].find(el=>el.querySelector('.eyebrow')?.textContent.trim()==='Camera');
    const btn=cab?.querySelector('button');
    if(!btn) return false; btn.click(); return true;
  });
  await new Promise(r=>setTimeout(r,900));
  console.log('clicou no Add:', clicou);
  console.log('DEPOIS do clique:', JSON.stringify(await alturaSecao()));

  // agora clica no pad para criar uma parada, e confere na store
  // O clique do mouse e coordenada de VISTA: sem rolar o pad para dentro dela,
  // o clique cai noutro lugar e a medicao mente calada.
  await p.evaluate(()=>document.querySelector('.campath')?.scrollIntoView({block:'center'}));
  await new Promise(r=>setTimeout(r,500));
  const pad=await p.$('.campath');
  if(pad){ const bx=await pad.boundingBox();
    console.log('pad na vista em', JSON.stringify({x:Math.round(bx.x),y:Math.round(bx.y),w:Math.round(bx.width),h:Math.round(bx.height)}));
    await p.mouse.click(bx.x+bx.width*0.78, bx.y+bx.height*0.33);
    await new Promise(r=>setTimeout(r,900)); }
  const store=await p.evaluate(()=>{
    const raw=localStorage.getItem('motion-scene-v1');
    const c=raw?JSON.parse(raw).sceneCamera:null;
    return {sceneCameraSalva:c, pontosNoPad:document.querySelectorAll('.campath-dot').length,
            rotulos:[...document.querySelectorAll('.campath-num')].map(e=>e.textContent.trim()),
            linhas:[...document.querySelectorAll('.ctl-row')].map(e=>e.textContent.trim()).filter(t=>/Stop|zoom/i.test(t))};
  });
  console.log('DEPOIS de clicar no pad:', JSON.stringify(store));
  // Sobrevive a um recarregamento? Sinal na tela nao e escrita no disco.
  await new Promise(r=>setTimeout(r,2500));
  const antes=await p.evaluate(()=>({
    chaves:Object.keys(JSON.parse(localStorage.getItem('motion-scene-v1')||'{}').sceneCamera||{}),
    projeto:Object.keys((JSON.parse(localStorage.getItem('motion-project-addcam')||'{}').sceneCamera)||{}),
  }));
  console.log('gravado antes do reload:', JSON.stringify(antes));
  await p.reload({waitUntil:'networkidle2',timeout:180000});
  await p.evaluate(()=>{document.querySelectorAll('[role=dialog], .modal-backdrop').forEach(el=>{el.style.display='none';});});
  await new Promise(r=>setTimeout(r,2500));
  await p.evaluate(()=>{const t=[...document.querySelectorAll('button,[role=tab],a')].find(e=>e.textContent.trim()==='Adjust'); t&&t.click();});
  await new Promise(r=>setTimeout(r,2000));
  console.log('DEPOIS DO RELOAD:', JSON.stringify(await alturaSecao()),
    'pontos:', await p.evaluate(()=>document.querySelectorAll('.campath-dot').length));
  const arq=path.join(OUT,'add-ok.png');
  const rect=await p.evaluate(()=>{
    const cab=[...document.querySelectorAll('.section-head')].find(el=>el.querySelector('.eyebrow')?.textContent.trim()==='Camera');
    cab.scrollIntoView({block:'start'}); return null;});
  await new Promise(r=>setTimeout(r,500));
  const r2=await p.evaluate(()=>{
    const cab=[...document.querySelectorAll('.section-head')].find(el=>el.querySelector('.eyebrow')?.textContent.trim()==='Camera');
    let n=cab,ultimo=cab;
    while(n && !(n!==cab && n.classList.contains('hairline'))){ultimo=n;n=n.nextElementSibling;}
    const a=cab.getBoundingClientRect(),z=ultimo.getBoundingClientRect();
    return {x:a.left+scrollX-10,y:a.top+scrollY-10,width:a.width+20,height:(z.bottom-a.top)+20};});
  await p.screenshot({path:arq,clip:r2});
  console.log(arq);
  await b.close();
})();
