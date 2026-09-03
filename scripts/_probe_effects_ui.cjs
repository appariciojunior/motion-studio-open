#!/usr/bin/env node
// ATENCAO: ESTE PROBE E INSTAVEL (flaky). Rodado duas vezes sem alterar nada,
// deu resultados diferentes — numa passada Vignette/Halftone/Posterize
// mediram o efeito, na seguinte voltaram ao baseline. A causa e timing: depois
// de recarregar, o palco leva um tempo variavel para reaplicar o efeito
// adicionado, e nenhuma espera fixa cobriu isso de forma confiavel.
//
// Use-o como INDICADOR, nunca como prova. A prova determinista dos efeitos e
// scripts/verify-effects-gl.cjs, que compila o shader real em GPU e mede — essa
// repete. O que este probe mostra bem, quando pega a janela, e que a fiacao
// painel -> store -> renderer funciona: ja vi aqui o Halftone zerar a cor
// (maxRB 0, que e o modo mono), o Posterize saturar as bandas (maxRB 255) e o
// Vignette apagar o centro.
//
// Para torna-lo confiavel seria preciso esperar a CONDICAO (o palco mudar em
// relacao ao baseline) em vez de um tempo, com um limite de tentativas.
//
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
const semear = () => p.evaluate(()=>{
  localStorage.setItem('motion-welcome-seen','1'); localStorage.setItem('motion-tour-seen','1');
  const scene={activeTemplateId:'arc-01',tracks:[{id:'t0',templateId:'arc-01'}],
    width:810,height:1080,fps:30,duration:8,
    background:{source:'color',color:'#1a1a1a',gradient:false,color2:'#1a1a1a',imageUrl:null,blur:28},effects:[]};
  localStorage.setItem('motion-scene-v1',JSON.stringify(scene));
  localStorage.setItem('motion-project-fx',JSON.stringify(scene));
  localStorage.setItem('motion-projects-v1',JSON.stringify({activeId:'fx',projects:[{id:'fx',name:'Teste de efeitos',createdAt:1,updatedAt:2,mode:'2d'}]}));
});
await semear();
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
for(const nome of ['Grain','Vignette','Halftone','Posterize','Scanlines','Pixelate','RGB Split','Wave']){
  const r=await aplicar(nome);
  await new Promise(x=>setTimeout(x,7000));
  const m=await medir();
  linhas.push({nome,r,m});
  console.log(nome.padEnd(18), r==='ok'?JSON.stringify(m):('FALHOU: '+r));
  const cv=await p.$('canvas.stage-canvas');
  if(cv) await cv.screenshot({path:path.join(OUT,nome.replace(/ /g,'-').toLowerCase()+'.png')});
  // ISOLAMENTO: RE-SEMEAR E RECARREGAR.
  //
  // Duas coisas descobertas medindo, nao supondo. Primeiro: remover por clique
  // nao limpava, e os efeitos acumulavam — a luma caia monotonicamente e toda
  // medida depois da primeira media o empilhamento. Segundo: recarregar TAMBEM
  // nao limpa, porque o autosave ja persistiu o efeito no projeto e a recarga
  // hidrata dali; diagnosticado vendo o painel voltar com ["Vignette",
  // "Halftone"] na segunda volta. So re-escrever a cena semeada (com effects
  // vazio) antes de recarregar isola de verdade.
  await semear();
  await p.goto(U+"/library",{waitUntil:"networkidle2",timeout:180000});
  // Espera o PALCO pintar, nao um tempo fixo: com 3s o renderer ainda estava
  // subindo e a medida saia igual a do baseline.
  await p.waitForFunction(()=>{
    const c=document.querySelector("canvas.stage-canvas"); if(!c||!c.width) return false;
    const o=document.createElement("canvas");o.width=c.width;o.height=c.height;
    const g=o.getContext("2d");g.drawImage(c,0,0);
    const d=g.getImageData(0,0,c.width,c.height).data;
    let m=0,n=0;for(let i=0;i<d.length;i+=4){m+=d[i];n++;}m/=n;
    let v=0;for(let i=0;i<d.length;i+=4){const q=d[i]-m;v+=q*q;}
    return Math.sqrt(v/n)>8;
  },{timeout:60000,polling:500}).catch(()=>{});
}
console.log('\n--- veredito ---');
const g=linhas.find(l=>l.nome==='Grain'), v=linhas.find(l=>l.nome==='Vignette'), s=linhas.find(l=>l.nome==='RGB Split');
if(g&&g.r==='ok') console.log('grain     desvio local', base.desvioLocal, '->', g.m.desvioLocal, g.m.desvioLocal>base.desvioLocal+1?'OK':'<== NAO SUBIU');
if(v&&v.r==='ok') console.log('vignette  canto', base.canto, '->', v.m.canto, v.m.canto<base.canto-3||v.m.meio-v.m.canto>base.meio-base.canto+3?'OK':'<== NAO ESCURECEU A BORDA');
if(s&&s.r==='ok') console.log('rgb-split max|R-B|', base.maxRB, '->', s.m.maxRB, s.m.maxRB>base.maxRB+10?'OK':'<== NAO SEPAROU OS CANAIS');
await b.close();
})();
