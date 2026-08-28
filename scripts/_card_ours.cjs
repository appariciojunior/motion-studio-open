// Measure OUR card the same way the reference's was measured — face-on ring,
// few cards, connected blobs — so the two numbers are comparable. Everything
// so far compared our DECLARED card size against their MEASURED one, which is
// not the same claim.
const fs=require('fs'), puppeteer=require('puppeteer-core');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const id=process.argv[2]||'orbit-3d-04';
const overrides=process.argv.slice(3); // key=value pairs
const P='templates/orbit3d.ts';
const orig=fs.readFileSync(P,'utf8');
(async()=>{
  const crlf=orig.includes('\r\n'); let s=orig.split('\r\n').join('\n');
  const st=s.indexOf("  variant(ringStream, '"+id+"',"), en=s.indexOf('\n  }, ', st);
  let blk=s.slice(st,en);
  for(const o of overrides){
    const [k,v]=o.split('=');
    blk = new RegExp(k+': -?[\d.]+').test(blk)
      ? blk.replace(new RegExp(k+': -?[\d.]+'), k+': '+v)
      : blk.replace(/count: (\d+),/, 'count: $1, '+k+': '+v+',');
  }
  fs.writeFileSync(P, crlf?(s.slice(0,st)+blk+s.slice(en)).split('\n').join('\r\n'):(s.slice(0,st)+blk+s.slice(en)));
  await sleep(3500);
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless:'shell',protocolTimeout:300000,
    args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--hide-scrollbars']});
  const p=await b.newPage();
  await p.setViewport({width:1600,height:1000,deviceScaleFactor:1});
  await p.goto('http://localhost:3000',{waitUntil:'networkidle2',timeout:120000});
  await sleep(4000);
  const out=await p.evaluate(async(tid)=>{
    const raf=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const settle=async n=>{for(let i=0;i<n;i++)await raf();};
    const set=(el,val)=>{const Pr=el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(Pr,'value').set.call(el,String(val));
      el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
    set(document.querySelector('select'),tid); await settle(12);
    const sc=document.querySelector('.scrubber input[type=range]'); if(sc){set(sc,0);await settle(8);}
    const c=document.querySelector('canvas.stage-canvas');
    const G=400, buf=document.createElement('canvas'); buf.width=G; buf.height=G;
    const g=buf.getContext('2d',{willReadFrequently:true});
    g.drawImage(c,0,0,c.width,c.height,0,0,G,G);
    const d=g.getImageData(0,0,G,G).data, bg=[d[0],d[1],d[2]];
    const lit=new Uint8Array(G*G);
    for(let i=0;i<G*G;i++){const q=i*4;
      lit[i]=(Math.abs(d[q]-bg[0])+Math.abs(d[q+1]-bg[1])+Math.abs(d[q+2]-bg[2]))>30?1:0;}
    const seen=new Uint8Array(G*G), blobs=[];
    for(let i=0;i<G*G;i++){
      if(!lit[i]||seen[i])continue;
      const stk=[i]; seen[i]=1;
      let x0=G,x1=-1,y0=G,y1=-1,n=0,sx=0,sy=0;
      while(stk.length){const q=stk.pop(), x=q%G, y=(q-x)/G;
        n++; sx+=x; sy+=y;
        if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
        for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){
          const nx=x+dx, ny=y+dy; if(nx<0||ny<0||nx>=G||ny>=G)continue;
          const k=ny*G+nx; if(lit[k]&&!seen[k]){seen[k]=1;stk.push(k);}}}
      if(n<40)continue;
      blobs.push({w:x1-x0+1,h:y1-y0+1,n,cx:sx/n,cy:sy/n});}
    return {blobs,G};
  }, id);
  fs.writeFileSync(P,orig);
  const {blobs,G}=out;
  if(!blobs.length){console.log('nenhum blob');await b.close();return;}
  blobs.sort((a,c)=>c.n-a.n);
  const cx=blobs.reduce((s,x)=>s+x.cx,0)/blobs.length, cy=blobs.reduce((s,x)=>s+x.cy,0)/blobs.length;
  const radii=blobs.map(x=>Math.hypot(x.cx-cx,x.cy-cy));
  const R=radii.reduce((a,c)=>a+c,0)/radii.length;
  const card=blobs[0], slot=(Math.PI*2*R)/blobs.length;
  console.log(id+' '+overrides.join(' ')+'  ('+blobs.length+' blob(s), grade '+G+')');
  console.log('  cartao      '+card.w+' x '+card.h+' px  (aspecto '+(card.w/card.h).toFixed(3)+')');
  console.log('  raio        '+R.toFixed(1)+' px  (espalhamento '+Math.min(...radii).toFixed(1)+'..'+Math.max(...radii).toFixed(1)+')');
  console.log('  slot        '+slot.toFixed(1)+' px');
  console.log('  cartao/slot '+(card.w/slot).toFixed(3));
  await b.close();
})().catch(e=>{fs.writeFileSync(P,orig);console.error(e.message);process.exit(1)});
