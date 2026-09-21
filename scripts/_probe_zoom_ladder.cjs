#!/usr/bin/env node
// Escada de zoom com a parede PARADA: a camera afastando revela MAIS cartoes
// (parede grande) ou encolhe os mesmos (parede do tamanho do canvas)?
// Conta colunas de cartao atravessando a linha central, que e a unica leitura
// que separa as duas hipoteses.
const fs=require('fs'), path=require('path'), puppeteer=require('puppeteer-core');
const CHROME=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>fs.existsSync(p));
const U=process.argv[2]||'http://localhost:3123', OUT=process.argv[3]||'.';
const TPL=process.env.MS_TPL||'wall-01';
const BASE=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','default-scene.json'),'utf8'));
const ZOOMS=(process.env.MS_ZOOMS||'100,70,50,35').split(',').map(Number);
(async()=>{
  const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--enable-gpu'],defaultViewport:{width:1600,height:1100}});
  const p=await b.newPage();
  p.on('pageerror',e=>console.log('  [pageerror]',e.message));
  fs.mkdirSync(OUT,{recursive:true});
  for(const z of ZOOMS){
    await p.goto(U+'/library',{waitUntil:'domcontentloaded',timeout:180000});
    await p.evaluate((base,tpl,zoom)=>{
      localStorage.setItem('motion-welcome-seen','1');localStorage.setItem('motion-tour-seen','1');
      const s={...base,
        activeTemplateId:tpl,
        tracks:base.tracks.map((t,i)=>i===0?{...t,templateId:tpl,
          values:{...t.values,cardSize:250,gap:24,rowsSkipped:1,weave:'varied',sweep:0,hold:0,speed:0}}:t),
        background:{source:'color',color:'#ff00ff',gradient:false,color2:'#ff00ff',imageUrl:null,blur:0},
        sceneCamera:{_camOn:1,_camZoom:zoom,_camPanX:0,_camPanY:0,_camOrbitX:0,_camOrbitY:0}};
      localStorage.setItem('motion-scene-v1',JSON.stringify(s));
      localStorage.setItem('motion-project-zl',JSON.stringify(s));
      localStorage.setItem('motion-projects-v1',JSON.stringify({activeId:'zl',projects:[{id:'zl',name:'ZL',createdAt:1,updatedAt:2,mode:'2d'}]}));
    }, BASE, TPL, z);
    await p.goto(U+'/library',{waitUntil:'networkidle2',timeout:180000});
    await p.evaluate(()=>{document.querySelectorAll('[role=dialog], .modal-backdrop').forEach(el=>{el.style.display='none';});});
    await new Promise(r=>setTimeout(r,3500));
    const conf=await p.evaluate(()=>{const raw=JSON.parse(localStorage.getItem('motion-project-zl')||'{}');
      return {tpl:(raw.tracks||[]).map(t=>t.templateId)[0], zoom:(raw.sceneCamera||{})._camZoom};});
    const telas=await p.evaluate(()=>[...document.querySelectorAll('canvas')].map(c=>({
      cls:c.className.slice(0,40), w:c.width, h:c.height,
      cssW:Math.round(c.getBoundingClientRect().width), cssH:Math.round(c.getBoundingClientRect().height)})));
    console.log('  canvases:', JSON.stringify(telas));
    const cv=await p.$('canvas.stage-canvas');
    if(!cv){ console.log('z'+z+': sem palco'); continue; }
    const arq=path.join(OUT,'z'+z+'.png');
    await cv.screenshot({path:arq});
    // conta transicoes fundo->cartao na linha central e mede a margem vazia
    const m=await p.evaluate(()=>{
      const c=document.querySelector('canvas.stage-canvas');
      const g=document.createElement('canvas'); g.width=400; g.height=533;
      const x=g.getContext('2d'); x.drawImage(c,0,0,400,533);
      const d=x.getImageData(0,0,400,533).data;
      const fundo=(i)=>Math.abs(d[i]-255)<16&&d[i+1]<16&&Math.abs(d[i+2]-255)<16;
      const y=Math.floor(533/2);
      let colunas=0, dentro=false, esq=-1, dir=-1;
      for(let px=0;px<400;px++){
        const f=fundo((y*400+px)*4);
        if(!f && esq<0) esq=px;
        if(!f) dir=px;
        if(!f && !dentro){ colunas++; dentro=true; } else if(f) dentro=false;
      }
      return {colunas, margemEsq:+(esq<0?100:esq/400*100).toFixed(1), margemDir:+(dir<0?100:(399-dir)/400*100).toFixed(1)};
    });
    console.log('zoom '+String(z).padStart(3)+'%  ('+conf.tpl+')  colunas de cartao na linha central: '+String(m.colunas).padStart(2)+
      '   margem vazia esq '+String(m.margemEsq).padStart(5)+'%  dir '+String(m.margemDir).padStart(5)+'%');
  }
  await b.close();
})();
