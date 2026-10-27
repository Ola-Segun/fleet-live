import { build } from 'esbuild';
import { createRequire } from 'module';
import path from 'path';
const require = createRequire(import.meta.url);
const { createCanvas } = require('canvas');
await build({ entryPoints: ['src/scene.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: '.tmp-bundle.cjs', logLevel: 'error' });
const { HeroScene } = require(path.resolve('.tmp-bundle.cjs'));
const W = +(process.argv[2] ?? 1920), H = +(process.argv[3] ?? 1080);
const scene = new HeroScene(createCanvas(W, H), { makeCanvas: () => createCanvas(64, 64) });
scene.resize(W, H, 1, W < 820 ? { topInset: H * 0.5, bottomInset: 118 } : {});
let el = 0; while (el < 3) { el += 1/60; scene.render(el); }
const asc = scene.asc;
console.log('climb seconds:', asc.climbSeconds.toFixed(2), ' ground cycle (sp=.055):', (asc.gMax/0.055).toFixed(1), 's');
// concurrency of vehicles on the climb
const st = { ascending:false, u:0, x:0 };
let tot=0, min=99, max=0, n=0;
for (let t=5; t<65; t+=0.25) { let c=0; for (const a of scene.agents) { asc.state(a.u,a.sp,t,st); if (st.ascending) c++; } tot+=c; n++; min=Math.min(min,c); max=Math.max(max,c); }
console.log('vehicles on the climb at once: avg', (tot/n).toFixed(1), 'min', min, 'max', max, 'of', scene.agents.length);
// speed profile of one vehicle (screen px/s)
const F=scene.Fe, VY=scene.VY, ch=scene.ch;
const a = scene.agents[18]; const sp=a.sp;
const samples=[]; const dt=0.05; let prev=null;
const P = asc.gMax/sp + asc.climbSeconds;
for (let tt=0; tt<P; tt+=dt) {
  asc.state(0, sp, tt, st);
  let y;
  if (!st.ascending) { const d=2.4*Math.exp(st.u*Math.log(46/2.4)); y = VY + ch*F/d; }
  else { y = asc.strands[7].ay[0] - asc.shape(st.x)*asc.strands[7].Q; }
  if (prev!==null) samples.push([tt, Math.abs(y-prev)/dt, st.ascending]);
  prev=y;
}
const pick=(t0)=>samples.reduce((b,s)=>Math.abs(s[0]-t0)<Math.abs(b[0]-t0)?s:b);
const ground=samples.filter(s=>!s[2]);
console.log('ground approach speed (px/s) at 25%,50%,75%,95% of ground time:',[.25,.5,.75,.95].map(f=>pick(f*asc.gMax/sp)[1].toFixed(0)).join(', '));
console.log('speed at bend entry:', ground[ground.length-1][1].toFixed(0), 'px/s');
console.log('climb speed (px/s) at 0%,25%,50%,75%,100% of climb time:', [0,.25,.5,.75,.999].map(f=>asc.speedAt(f).toFixed(0)).join(', '));
