// Headless renderer: bundles a scene.ts, renders frames with node-canvas, composites over the hero background.
import { build } from 'esbuild';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { createCanvas } = require('canvas');

const [,, entry = 'reference/scene.original.ts', out = 'out', W = '1920', H = '1080', ...times] = process.argv;
const T = (times.length ? times : ['4']).map(Number);
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: '.tmp-bundle.cjs', logLevel: 'error' });
const { HeroScene } = require(path.resolve('.tmp-bundle.cjs'));

function bg(w, h) {
  const c = createCanvas(w, h), g = c.getContext('2d');
  const base = g.createRadialGradient(w * 0.62, h * 0.4, 0, w * 0.62, h * 0.4, w * 0.75);
  base.addColorStop(0, '#1b374a'); base.addColorStop(0.68, '#102333'); base.addColorStop(1, '#0d1d2b');
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  const l = g.createRadialGradient(w * 0.68, h * 0.38, 0, w * 0.68, h * 0.38, w * 0.3);
  l.addColorStop(0, 'rgba(200,237,115,.10)'); l.addColorStop(1, 'rgba(200,237,115,0)');
  g.fillStyle = l; g.fillRect(0, 0, w, h);
  // left scrim, like the hero CSS
  const s = g.createLinearGradient(0, 0, w * 0.56, 0);
  s.addColorStop(0, 'rgba(16,35,51,.9)'); s.addColorStop(0.5, 'rgba(16,35,51,.6)'); s.addColorStop(1, 'rgba(16,35,51,0)');
  return { c, g, scrim: s };
}

const w = +W, h = +H;
const scene = new HeroScene(createCanvas(w, h), {
  makeCanvas: () => createCanvas(64, 64),
  reducedMotion: !!process.env.RM,
  ascent: process.env.GLASS ? { railStyle: 'glass' } : undefined,
});
const canvas = scene.canvas;
const small = w < 820;
scene.resize(w, h, 1, small ? { topInset: h * 0.5, bottomInset: 118 } : {});
// warm up to the requested times (60 fps steps)
let el = 0;
for (const t of T) {
  if (process.env.RM) { scene.render(9); } else while (el < t) { el += 1 / 60; scene.render(el); }
  const { c, g, scrim } = bg(w, h);
  g.drawImage(canvas, 0, 0);
  g.fillStyle = scrim; g.fillRect(0, 0, w * 0.56, h);
  // fake nav pill + headline block so spacing can be judged
  if (!small) {
    g.fillStyle = 'rgba(20,32,52,.8)'; g.beginPath(); g.roundRect?.(245, 12, 1415, 56, 16); g.fill();
    g.fillStyle = '#eef2fa'; g.font = '600 104px sans-serif'; g.fillText('Fleet ops.', 137, 370); g.fillText('Without the noise.', 137, 480);
  }
  const f = `${out}-t${String(t).replace('.', '_')}.png`;
  let outC = c;
  if (process.env.CROP) {
    const [cx, cy, cw, ch, sc] = process.env.CROP.split(',').map(Number);
    outC = createCanvas(cw * sc, ch * sc);
    const og = outC.getContext('2d'); og.imageSmoothingEnabled = true;
    og.drawImage(c, cx, cy, cw, ch, 0, 0, cw * sc, ch * sc);
  }
  fs.writeFileSync(f, outC.toBuffer('image/png'));
  console.log('wrote', f);
}
