#!/usr/bin/env node
// O slider dentro do card de efeito responde ao arrasto?
//
// Cuidado que custou uma rodada: o painel de efeitos vive num container com
// scroll, e o slider nasce ABAIXO da dobra. Sem rolar ate ele, a coordenada
// calculada nao existe na viewport, o clique nao chega em ninguem e o teste
// acusa "nao mexeu" sem que haja bug. elementsFromPoint vazio e o sintoma.
const fs=require('fs');const puppeteer=require('puppeteer-core');
const CHROME=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>{try{return fs.existsSync(p)}catch{return false}});
const U=process.argv[2]||'http://localhost:3100';
(async()=>{
const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--enable-gpu','--use-angle=gl'],defaultViewport:{width:1600,height:1000}});
const p=await b.newPage();
await p.goto(U+'/library',{waitUntil:'domcontentloaded',timeout:180000});
await p.evaluate(()=>{localStorage.setItem('motion-welcome-seen','1');localStorage.setItem('motion-tour-seen','1');});
await p.goto(U+'/library',{waitUntil:'networkidle2',timeout:180000});
await new Promise(r=>setTimeout(r,6000));
await p.evaluate(async()=>{
  const sel=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.textContent.trim()==='Grain'));
  const opt=[...sel.options].find(o=>o.textContent.trim()==='Grain');
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set.call(sel,opt.value);
  sel.dispatchEvent(new Event('change',{bubbles:true}));
  await new Promise(r=>setTimeout(r,300));
  [...document.querySelectorAll('button')].find(x=>/^add$/i.test((x.textContent||'').trim())).click();
});
await new Promise(r=>setTimeout(r,2500));

const prep=await p.evaluate(async()=>{
  const t=document.querySelector('.effect-card .strack');
  if(!t) return {erro:'sem slider no card'};
  t.scrollIntoView({block:'center'});
  await new Promise(r=>setTimeout(r,500));
  const r=t.getBoundingClientRect();
  const pilha=document.elementsFromPoint(r.left+r.width*0.25, r.top+r.height/2).slice(0,3)
    .map(e=>e.tagName.toLowerCase()+'.'+(e.className||'').toString().split(' ')[0]);
  return {x:r.left+r.width*0.25, y:r.top+r.height/2, w:r.width, visivel:r.width>20&&r.top>0, pilha,
    cardDraggable: document.querySelector('.effect-card').getAttribute('draggable'),
    gripDraggable: document.querySelector('.effect-card .drag-grip').getAttribute('draggable')};
});
if(prep.erro){ console.log(prep.erro); await b.close(); process.exit(1); }
console.log('draggable  card:', prep.cardDraggable ?? 'null', '| grip:', prep.gripDraggable);
console.log('slider visivel:', prep.visivel, '| sob o ponto:', prep.pilha.join(' > '));

const ler=()=>p.evaluate(()=>{
  const h=document.querySelector('.effect-card .shandle');
  const txt=document.querySelector('.effect-card').innerText.replace(/\s+/g,' ');
  return {handle:h?h.style.left:'?', amount:(txt.match(/Amount (\d+)/)||[])[1]};
});
const antes=await ler();
await p.mouse.move(prep.x, prep.y);
await p.mouse.down();
await p.mouse.move(prep.x + prep.w*0.55, prep.y, {steps:18});
await p.mouse.up();
await new Promise(r=>setTimeout(r,900));
const depois=await ler();
console.log('antes :', JSON.stringify(antes));
console.log('depois:', JSON.stringify(depois));
const mexeu = antes.handle !== depois.handle || antes.amount !== depois.amount;
console.log(mexeu ? '\n=> o slider do efeito ARRASTA (OK)' : '\n=> o slider do efeito NAO arrasta (FALHA)');
// e a lista nao se desmontou por um drag acidental
console.log('cards de efeito ainda na lista:', await p.evaluate(()=>document.querySelectorAll('.effect-card').length));
await b.close();
process.exit(mexeu?0:1);
})();
