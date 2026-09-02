#!/usr/bin/env node
// Prova os efeitos NO APP: semeia uma cena com conteudo, aplica cada efeito pelo
// painel (select + Add, o caminho do usuario) e mede o palco.
//
// A prova de GPU (verify-effects-gl) compila o shader isolado. Ela nao diz nada
// sobre a fiacao painel -> store -> renderer, e e essa que quebra calada.
const fs=require('fs'),path=require('path');const puppeteer=require('puppeteer-core');
const CHROME=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>{try{return fs.existsSync(p)}catch{return false}});
const U=process.argv[2]||'http://localhost:3100';
const OUT=path.resolve(__dirname,'..','..','_fx-shots'); fs.mkdirSync(OUT,{recursive:true});
(async()=>{
const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--enable-gpu','--use-angle=gl'],defaultViewport:{width:1600,height:1000}});
const p=await b.newPage();
p.on('pageerror',e=>console.log('  [pageerror]',String(e).slice(0,200)));
await p.goto(U+'/library',{waitUntil:'domcontentloaded',timeout:180000});
await p.evaluate(()=>{
  localStorage.setItem('motion-welcome-seen','1'); localStorage.setItem('motion-tour-seen','1');
  const scene={activeTemplateId:'arc-01',tracks:[{id:'t0',templateId:'arc-01'}],
    width:810,height:1080,fps:30,duration:8,
    background:{source:'color',color:'#1a1a1a',gradient:false,color2:'#1a1a1a',imageUrl:null,blur:28},effects:[]};
  localStorage.setItem('motion-scene-v1',JSON.stringify(scene));
  localStorage.setItem('motion-project-fx',JSON.stringify(scene));
  localStorage.setItem('motion-projects-v1',JSON.stringify({activeId:'fx',projects:[{id:'fx',name:'Teste de efeitos',createdAt:1,updatedAt:2,mode:'2d'}]}));
});
await p.goto(U+'/library',{waitUntil:'networkidle2',timeout:180000});
// espera CONTEUDO, nao tempo
const pintou=await p.waitForFunction(()=>{
  const c=document.querySelector('canvas.stage-canvas'); if(!c||!c.width) return false;
  const o=document.createElement('canvas');o.width=c.width;o.height=c.height;
  const g=o.getContext('2d');g.drawImage(c,0,0);
  const d=g.getImageData(0,0,c.width,c.height).data;
  let m=0,n=0;for(let i=0;i<d.length;i+=4){m+=d[i];n++;}m/=n;
  let s=0;for(let i=0;i<d.length;i+=4){const v=d[i]-m;s+=v*v;}
  return Math.sqrt(s/n)>8;
},{timeout:90000,polling:600}).then(()=>true).catch(()=>false);
if(!pintou){ console.error('o palco nao pintou — sem cena nao ha o que medir'); await b.close(); process.exit(1); }

const medir=()=>p.evaluate(()=>{
  const c=document.querySelector('canvas.stage-canvas');
  const o=document.createElement('canvas');o.width=c.width;o.height=c.height;
  const g=o.getContext('2d');g.drawImage(c,0,0);
  const d=g.getImageData(0,0,c.width,c.height).data;
  const at=(x,y)=>{const i=(y*c.width+x)*4;return {r:d[i],g:d[i+1],b:d[i+2],l:(d[i]+d[i+1]+d[i+2])/3};};
  let m=0,n=0;for(let i=0;i<d.length;i+=4){m+=(d[i]+d[i+1]+d[i+2])/3;n++;}m/=n;
  let s=0;for(let i=0;i<d.length;i+=4){const v=(d[i]+d[i+1]+d[i+2])/3-m;s+=v*v;}
  // desvio LOCAL em blocos 3x3: e isso que o grao levanta, nao o desvio global
  let loc=0,cnt=0;
  for(let y=8;y<c.height-8;y+=17) for(let x=8;x<c.width-8;x+=17){
    const v=[at(x,y).l,at(x+1,y).l,at(x,y+1).l,at(x+1,y+1).l];
    const mm=v.reduce((a,z)=>a+z,0)/4;
    loc+=Math.sqrt(v.reduce((a,z)=>a+(z-mm)*(z-mm),0)/4); cnt++;
  }
  // maior separacao R-B ao longo da linha central (assinatura do split)
  let maxRB=0;
  for(let x=0;x<c.width;x++){const q=at(x,c.height>>1); maxRB=Math.max(maxRB, Math.abs(q.r-q.b));}
  return {luma:+m.toFixed(1), desvioGlobal:+Math.sqrt(s/n).toFixed(1), desvioLocal:+(loc/cnt).toFixed(2),
    canto:+at(6,6).l.toFixed(1), meio:+at(c.width>>1,c.height>>1).l.toFixed(1), maxRB};
});

const aplicar=(nome)=>p.evaluate(async(nome)=>{
  const sel=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.textContent.trim()==='Grain'));
  if(!sel) return 'sem select de efeitos';
  const opt=[...sel.options].find(o=>o.textContent.trim()===nome);
  if(!opt) return 'sem opcao '+nome;
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set.call(sel,opt.value);
  sel.dispatchEvent(new Event('change',{bubbles:true}));
  await new Promise(r=>setTimeout(r,300));
  const add=[...document.querySelectorAll('button')].find(x=>/^add$/i.test((x.textContent||'').trim()));
  if(!add) return 'sem botao Add';
  add.click();
  await new Promise(r=>setTimeout(r,400));
  return document.querySelectorAll('.effect-card').length ? 'ok' : 'clicou mas nenhum effect-card apareceu';
},nome);

const base=await medir();
console.log('sem efeito        ', JSON.stringify(base));
const linhas=[];
for(const nome of ['Grain','Vignette','RGB Split','Pixelate']){
  const r=await aplicar(nome);
  await new Promise(x=>setTimeout(x,2500));
  const m=await medir();
  linhas.push({nome,r,m});
  console.log(nome.padEnd(18), r==='ok'?JSON.stringify(m):('FALHOU: '+r));
  const cv=await p.$('canvas.stage-canvas');
  if(cv) await cv.screenshot({path:path.join(OUT,nome.replace(/ /g,'-').toLowerCase()+'.png')});
  await p.evaluate(async()=>{
    for(const btn of [...document.querySelectorAll('.effect-card .icon-btn')]){
      if(/remove/i.test(btn.getAttribute('aria-label')||'')){ btn.click(); await new Promise(r=>setTimeout(r,180)); btn.click(); await new Promise(r=>setTimeout(r,250)); }
    }
  });
  await new Promise(x=>setTimeout(x,1500));
}
console.log('\n--- veredito ---');
const g=linhas.find(l=>l.nome==='Grain'), v=linhas.find(l=>l.nome==='Vignette'), s=linhas.find(l=>l.nome==='RGB Split');
if(g&&g.r==='ok') console.log('grain     desvio local', base.desvioLocal, '->', g.m.desvioLocal, g.m.desvioLocal>base.desvioLocal+1?'OK':'<== NAO SUBIU');
if(v&&v.r==='ok') console.log('vignette  canto', base.canto, '->', v.m.canto, v.m.canto<base.canto-3||v.m.meio-v.m.canto>base.meio-base.canto+3?'OK':'<== NAO ESCURECEU A BORDA');
if(s&&s.r==='ok') console.log('rgb-split max|R-B|', base.maxRB, '->', s.m.maxRB, s.m.maxRB>base.maxRB+10?'OK':'<== NAO SEPAROU OS CANAIS');
await b.close();
})();
