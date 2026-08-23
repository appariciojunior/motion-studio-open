// Render OUR stage for one preset across several values of one control, so a
// visual mismatch can be closed by looking instead of by argument. Patches the
// template between renders and lets the dev server's HMR pick it up.
const fs=require('fs'), path=require('path'), puppeteer=require('puppeteer-core');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const [,,id,key,...vals]=process.argv;
const P='templates/orbit3d.ts';
const orig=fs.readFileSync(P,'utf8');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless:'shell',protocolTimeout:300000,
    args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--hide-scrollbars']});
  const p=await b.newPage();
  await p.setViewport({width:1600,height:1000,deviceScaleFactor:1});
  const shots=[];
  for(const v of vals){
    const crlf=orig.includes('\r\n'); let s=orig.split('\r\n').join('\n');
    const st=s.indexOf("  variant(ring3d, '"+id+"',");
    const en=s.indexOf('\n  }, ', st);
    let blk=s.slice(st,en);
    blk = new RegExp(key+': -?[\d.]+').test(blk)
      ? blk.replace(new RegExp(key+': -?[\d.]+'), key+': '+v)
      : blk.replace(/count: (\d+),/, 'count: $1, '+key+': '+v+',');
    s=s.slice(0,st)+blk+s.slice(en);
    fs.writeFileSync(P, crlf?s.split('\n').join('\r\n'):s);
    await sleep(3500);
    await p.goto('http://localhost:3000',{waitUntil:'networkidle2',timeout:120000});
    await sleep(3500);
    const data=await p.evaluate(async(tid)=>{
      const raf=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const settle=async n=>{for(let i=0;i<n;i++)await raf();};
      const set=(el,val)=>{const Pr=el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(Pr,'value').set.call(el,String(val));
        el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
      set(document.querySelector('select'),tid); await settle(12);
      const sc=document.querySelector('.scrubber input[type=range]'); if(sc){set(sc,0);await settle(8);}
      const c=document.querySelector('canvas.stage-canvas');
      const cut=document.createElement('canvas'); cut.width=460; cut.height=575;
      cut.getContext('2d').drawImage(c,0,0,c.width,c.height,0,0,460,575);
      return cut.toDataURL('image/jpeg',0.85);
    }, id);
    shots.push({v,data});
    console.log('  '+key+'='+v+' capturado');
  }
  fs.writeFileSync(P,orig);
  console.log('template restaurado');
  const sheet=await p.evaluate(async(list,label)=>{
    const cw=460,chh=575,pad=8,lab=18;
    const c=document.createElement('canvas');
    c.width=list.length*(cw+pad)+pad; c.height=chh+lab+pad*2;
    const g=c.getContext('2d'); g.fillStyle='#101014'; g.fillRect(0,0,c.width,c.height);
    g.font='14px ui-monospace, monospace';
    for(let i=0;i<list.length;i++){
      const x=pad+i*(cw+pad);
      g.fillStyle='#c8c8d0'; g.fillText(label+' = '+list[i].v, x, 14);
      const im=new Image(); im.src=list[i].data; await im.decode();
      g.drawImage(im,x,lab,cw,chh);
    }
    return c.toDataURL('image/jpeg',0.86);
  }, shots, key);
  fs.writeFileSync('.shots/sweep-ours.jpg', Buffer.from(sheet.split(',')[1],'base64'));
  console.log('-> .shots/sweep-ours.jpg');
  await b.close();
})().catch(e=>{fs.writeFileSync(P,orig);console.error(e.message);process.exit(1)});
