import { build } from 'esbuild'; import { createRequire } from 'module'; import path from 'path';
const require = createRequire(import.meta.url); const { createCanvas } = require('canvas');
await build({ entryPoints:['src/scene.ts'], bundle:true, platform:'node', format:'cjs', outfile:'.tmp-bundle.cjs', logLevel:'error' });
const { HeroScene } = require(path.resolve('.tmp-bundle.cjs'));
for (const [w,h] of [[1920,1080],[390,844]]) {
  const sc = new HeroScene(createCanvas(w,h), { makeCanvas:()=>createCanvas(64,64) });
  sc.resize(w,h,1,w<820?{topInset:h*.5,bottomInset:118}:{}); let t=0; for(let i=0;i<5;i++){t+=1/60; sc.render(t);}
  const ys=sc.asc.ringY, gaps=ys.slice(1).map((y,i)=>Math.round(ys[i]-y));
  console.log(w+'x'+h,'lanes',sc.lanes.length,'agents',sc.agents.length,'hoops',ys.length,'gaps bottom->top',gaps.join(', '));
}
