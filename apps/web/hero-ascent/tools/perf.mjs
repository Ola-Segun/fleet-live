import { build } from 'esbuild'; import { createRequire } from 'module';
import path from 'path';
const require = createRequire(import.meta.url); const { createCanvas } = require('canvas');
for (const [name, entry] of [['baseline','reference/scene.original.ts'],['with ascent','src/scene.ts']]) {
  await build({ entryPoints:[entry], bundle:true, platform:'node', format:'cjs', outfile:'.tmp-bundle.cjs', logLevel:'error' });
  delete require.cache[path.resolve('.tmp-bundle.cjs')];
  const { HeroScene } = require(path.resolve('.tmp-bundle.cjs'));
  const sc = new HeroScene(createCanvas(1920,1080), { makeCanvas:()=>createCanvas(64,64) }); sc.resize(1920,1080,1,{});
  let t=0; for(let i=0;i<120;i++){t+=1/60; sc.render(t);} 
  const t0=performance.now(); for(let i=0;i<600;i++){t+=1/60; sc.render(t);} 
  console.log(name.padEnd(12), ((performance.now()-t0)/600).toFixed(2), 'ms/frame (software canvas)');
}
