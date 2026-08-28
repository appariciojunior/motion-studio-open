#!/usr/bin/env node
// Varredura do catalogo INTEIRO: cada miniatura pinta algo?
//
// Amostrar nao serve aqui — a pergunta e "quais pararam de exibir", e a resposta
// tem de ser uma lista, nao uma impressao. Percorre as letras do alfabeto na
// busca (que renderiza a grade direto, sem depender do acordeao), agrega por
// nome, e mede o CONTEUDO de cada still: um <img> com src valido e 0 pixels
// opacos e uma miniatura vazia, e era invisivel para as contagens anteriores.
const fs=require('fs');const puppeteer=require('puppeteer-core');
const CHROME=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>{try{return fs.existsSync(p)}catch{return false}});
(async()=>{
const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--enable-gpu','--use-angle=gl'],defaultViewport:{width:1500,height:1100}});
const p=await b.newPage();  // UMA pagina: cinco esgotam os contextos GL
const erros=new Set();
p.on('console',m=>{const t=m.text(); if(/sem contexto|falhou/i.test(t)) erros.add(t.slice(0,120));});
await p.goto('http://localhost:3000/library',{waitUntil:'domcontentloaded',timeout:120000});
await p.evaluate(()=>{localStorage.setItem('motion-welcome-seen','1');localStorage.setItem('motion-tour-seen','1');});
await p.goto('http://localhost:3000/library',{waitUntil:'networkidle2',timeout:120000});

const todos=new Map();
for(const letra of 'abcdefghijklmnopqrstuvwxyz'){
  await p.evaluate((t)=>{const i=document.querySelector('.tpl-head input, input[placeholder]');const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(i,t);i.dispatchEvent(new Event('input',{bubbles:true}));},letra);
  await new Promise(r=>setTimeout(r,2600));
  const lote=await p.evaluate(()=>{
    const out=[];
    for(const c of document.querySelectorAll('.tpl-card')){
      const nome=(c.querySelector('.tpl-card-label')?.textContent||'').trim();
      if(!nome) continue;
      const th=c.querySelector('.tpl-thumb');
      const img=th?.querySelector('img');
      const divs=th?th.querySelectorAll('.tpl-thumb-el').length:0;
      if(!img||!img.src||!img.complete||!img.naturalWidth){ out.push({nome, estado: divs>0?'divs':'SEM-IMG', divs}); continue; }
      const cv=document.createElement('canvas'); cv.width=90; cv.height=120;
      const g=cv.getContext('2d'); g.drawImage(img,0,0,90,120);
      const d=g.getImageData(0,0,90,120).data;
      let op=0; const cores=new Set();
      for(let i=0;i<d.length;i+=4){ if(d[i+3]>12){op++; cores.add((d[i]>>5)+','+(d[i+1]>>5)+','+(d[i+2]>>5));} }
      out.push({nome, estado: op<40?'VAZIA':'ok', cobertura:+(op/10800).toFixed(3), cores:cores.size});
    }
    return out;
  });
  for(const e of lote) if(!todos.has(e.nome)) todos.set(e.nome,e);
}
const arr=[...todos.values()];
const vazias=arr.filter(e=>e.estado==='VAZIA');
const semImg=arr.filter(e=>e.estado==='SEM-IMG');
const divs=arr.filter(e=>e.estado==='divs');
console.log('presets vistos:', arr.length);
console.log('  ok    :', arr.filter(e=>e.estado==='ok').length);
console.log('  VAZIA :', vazias.length);
console.log('  SEM-IMG:', semImg.length);
console.log('  divs  :', divs.length);
if(vazias.length) console.log('\nVAZIAS:', vazias.map(e=>e.nome).join(', '));
if(semImg.length) console.log('\nSEM-IMG:', semImg.map(e=>e.nome).join(', '));
if(erros.size) { console.log('\nerros de console:'); [...erros].slice(0,6).forEach(e=>console.log('  ',e)); }
fs.writeFileSync(require('path').resolve(__dirname,'..','..','_thumbs-final','varredura.json'), JSON.stringify(arr,null,1));
await b.close();
})();
