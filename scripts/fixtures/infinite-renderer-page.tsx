"use client";
import { useRef, useState } from 'react';
import { SceneRenderer3D } from '@/lib/renderer3d';
import { SceneRenderer } from '@/lib/renderer';
import { blankSceneState, makeTrack, useSceneStore } from '@/store/useSceneStore';
import { defaultsFor } from '@/templates';

export default function LoopQA() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [pictures,setPictures]=useState<{name:string,src:string}[]>([]);
  const [status, setStatus] = useState('Ready'), [running, setRunning] = useState(false);
  async function run() {
    if (!ref.current) return;
    setRunning(true);
    const spatial = window.location.search.includes('spatial') || window.location.search.includes('mixed');
    const renderer = spatial ? new SceneRenderer3D() : new SceneRenderer();
    const output: any[] = [];
    const assets = Array.from({length: 40}, (_,i) => {
      const c = document.createElement('canvas'); c.width=120;c.height=160;
      const g=c.getContext('2d')!;g.fillStyle=`hsl(${i*67%360} 75% 55%)`;g.fillRect(0,0,120,160);
      g.fillStyle='#111';g.font='bold 52px sans-serif';g.fillText(String(i+1),8,90);
      g.fillRect(5,5,25,12);g.fillRect(80,140,30,12);
      return {id:'qa'+i,name:'QA '+i,url:c.toDataURL(),visible:true,kind:'image' as const};
    });
    const cases: [string,number,number,Record<string,any>][] = window.location.search.includes('mixed') ? [
      ['grid-01',1080,1920,{}],['spiral-01',1080,1920,{}],
    ] : spatial ? [
      ['coil-01',1080,1920,{cycles:.25,cycleDeg:60,wobble:40}],
      ['coil-05',3840,2160,{cycles:2.5,cycleDeg:15}],
      ['coil-09',1920,1080,{cycles:1.25,cycleDeg:60}],
    ] : [
      ['wall-01',1080,1920,{}],['wall-05',3840,2160,{offset:{x:300,y:-200}}],
      ['wall-06',1080,1920,{cardSize:60,gap:0}],['grid-01',1080,1920,{}],
      ['grid-04',3840,2160,{breath:'on',pulseAmt:60,offset:{x:-250,y:200}}],
      ['spiral-01',1080,1920,{}],['spiral-02',3840,2160,{cardSize:300}],
      ['spiral-04',1080,1920,{count:8,pitch:10,cardSize:80}],
    ];
    const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
    const read=document.createElement('canvas');read.width=216;read.height=384;
    const g=read.getContext('2d',{willReadFrequently:true})!;
    const pixels=(f:number)=>{renderer.renderFrame(f);g.clearRect(0,0,216,384);g.drawImage(ref.current!,0,0,216,384);return g.getImageData(0,0,216,384).data;};
    const delta=(a:Uint8ClampedArray,b:Uint8ClampedArray)=>{let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);return sum/a.length;};
    try {
      for (const [id,width,height,patch] of cases) {
        setStatus('Running '+id+' '+width+'×'+height);
        const values={...defaultsFor(id),...patch};
        const track=makeTrack(id,'QA',{values});
        useSceneStore.setState({...blankSceneState(),width,height,duration:8,fps:30,playing:false,
          activeTemplateId:id,values,easing:track.easing,tracks:[track],activeTrackId:track.id,assets,
          background:{...blankSceneState().background,color:'#101010',gradient:false,alpha:100}});
        if (!output.length) await renderer.init(ref.current!);
        renderer.resize(width,height,Math.min(.4,384/height));renderer.syncAssets();
        // Await actual decoded source assets before measuring output.
        await Promise.all(assets.map(a=>{const img=new Image();img.src=a.url;return img.decode();}));
        await sleep(500);renderer.renderFrame(40);await sleep(100);
        let worst=0, worstAt=0;
        // Every integer boundary across two complete playback loops, approached
        // from either side. At this epsilon ordinary motion is subpixel.
        for(let f=0;f<=480;f++) {
          const d=delta(pixels((f-.0001+480)%240),pixels((f+.0001)%240));
          if(d>worst){worst=d;worstAt=f;}
          if(f%40===0)await sleep(0);
        }
        const a=pixels(57),b=pixels(58),moving=delta(a,b);
        const start=performance.now();for(let f=0;f<60;f++)renderer.renderFrame(f);
        const avgMs=(performance.now()-start)/60;
        const capture=renderer.captureFrame(57);renderer.renderFrame(57);
        const repeatDelta=delta(pixels(57),pixels(57));
        let colored=0;for(let i=0;i<a.length;i+=4)if(Math.max(a[i],a[i+1],a[i+2])-Math.min(a[i],a[i+1],a[i+2])>40)colored++;
        setPictures(p=>[...p,{name:id+' '+width+'×'+height,src:capture}]);
        const result={id,width,height,coloredPixels:colored,worstBoundaryMeanDelta:worst,worstAt,movingMeanDelta:moving,avgMs,repeatDelta,capture:!!capture,pass:worst<1&&moving>.001&&repeatDelta===0&&!!capture&&colored>50};
        output.push(result);setStatus(JSON.stringify(output,null,2));await sleep(0);
      }
      setStatus(JSON.stringify({pass:output.every(r=>r.pass),cases:output},null,2));
    } catch(e) {setStatus(String(e)+'\n'+JSON.stringify(output));}
    finally {renderer.destroy();setRunning(false);}
  }
  return <main style={{padding:24,background:'#171717',color:'white',minHeight:'100vh'}}>
    <h1>Loop rendering verification</h1><button disabled={running} onClick={run}>Run verification</button>
    <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>{pictures.map((p,i)=><figure key={i}><figcaption>{p.name}</figcaption><img src={p.src} alt={p.name} style={{height:230,maxWidth:360,objectFit:'contain'}}/></figure>)}</div>
    <canvas ref={ref} style={{display:'block',maxHeight:420,maxWidth:'100%'}}/><pre id="qa-results" style={{whiteSpace:'pre-wrap'}}>{status}</pre>
  </main>;
}
