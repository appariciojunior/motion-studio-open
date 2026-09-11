#!/usr/bin/env node
// A camera ve ALEM da parede? Mede a MARGEM VAZIA contigua em cada borda: o
// numero de linhas/colunas seguidas, a partir da borda, que sao quase todas
// fundo.
//
// Contar pixels de fundo soltos na moldura nao serve e foi um erro que custou
// caro aqui: o vao entre cartoes TAMBEM e fundo, entao uma parede perfeitamente
// cheia media 60-84% de "vazamento" e a leitura era indistinguivel de uma
// camera que saiu da parede. Uma borda de verdade e continua; um vao nao.
const fs=require('fs'), path=require('path'), { execFileSync }=require('child_process');
const DIR=process.argv[2], W=Number(process.argv[3]||180), H=Number(process.argv[4]||240);
const FUNDO=(process.argv[5]||'ff00ff').match(/../g).map(h=>parseInt(h,16));
const raw=path.join(DIR,'_leak.rgb');
execFileSync('ffmpeg',['-v','error','-framerate','15','-i',path.join(DIR,'%03d.png'),
  '-vf',`scale=${W}:${H}`,'-pix_fmt','rgb24','-f','rawvideo',raw,'-y']);
const buf=fs.readFileSync(raw);
const n=buf.length/(W*H*3);
const ehFundo=(base,x,y)=>{const o=base+(y*W+x)*3;
  return Math.abs(buf[o]-FUNDO[0])<14&&Math.abs(buf[o+1]-FUNDO[1])<14&&Math.abs(buf[o+2]-FUNDO[2])<14;};
let pior=[0,-1]; const ruins=[];
for(let k=0;k<n;k++){
  const base=k*W*H*3;
  const frac=(conta,total)=>conta/total;
  const colCheia=(x)=>{let c=0;for(let y=0;y<H;y++) if(ehFundo(base,x,y)) c++; return frac(c,H)>0.9;};
  const linCheia=(y)=>{let c=0;for(let x=0;x<W;x++) if(ehFundo(base,x,y)) c++; return frac(c,W)>0.9;};
  let esq=0; while(esq<W&&colCheia(esq)) esq++;
  let dir=0; while(dir<W&&colCheia(W-1-dir)) dir++;
  let topo=0; while(topo<H&&linCheia(topo)) topo++;
  let base2=0; while(base2<H&&linCheia(H-1-base2)) base2++;
  const pc=Math.max(esq/W,dir/W,topo/H,base2/H)*100;
  if(pc>pior[0]) pior=[pc,k];
  if(pc>2) ruins.push(`${k}:${pc.toFixed(0)}%`);
}
fs.unlinkSync(raw);
console.log(`quadros ${n}   pior margem vazia ${pior[0].toFixed(1)}% de um lado, no quadro ${pior[1]}`);
console.log(`quadros com margem vazia acima de 2%: ${ruins.length}${ruins.length?'   '+ruins.slice(0,10).join('  '):''}`);
console.log(pior[0]<2 ? '=> a parede chega ate as quatro bordas o clipe inteiro.' : '=> A CAMERA VE ALEM DA PAREDE.');
