import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../slot-skills/node_modules/playwright/index.mjs';
const root = process.cwd();
const states = ['01-base','02-paylines','03-paytable','04-win','05-free-games','06-gamble','07-autoplay'];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage(); const report = [];
  for (const state of states) {
    const ref = `screenshots/reference/reference-${state}.png`, cur = `screenshots/current/${state}.png`;
    const [a,b] = await Promise.all([fs.readFile(cur), fs.readFile(ref)]);
    const [width,height]=[b.readUInt32BE(16),b.readUInt32BE(20)];
    if(a.readUInt32BE(16)!==width||a.readUInt32BE(20)!==height) throw Error(`Capture dimensions do not match ${state}`);
    const result = await page.evaluate(async ({a,b,width,height}) => {
      const load = async (buf) => { const img = new Image(); img.src = `data:image/png;base64,${buf}`; await img.decode(); return img; };
      const [ia,ib] = await Promise.all([load(a),load(b)]); const c = () => { const x=document.createElement('canvas'); x.width=width; x.height=height; return x; };
      const paint = (img) => { const x=c(),ctx=x.getContext('2d'); ctx.fillStyle='#000';ctx.fillRect(0,0,width,height);ctx.drawImage(img,0,0,width,height);return {x,p:ctx.getImageData(0,0,width,height).data};};
      const ca=paint(ia),cb=paint(ib),o=c(),d=c(),op=o.getContext('2d').createImageData(width,height),dp=d.getContext('2d').createImageData(width,height); let changed=0,error=0;
      for(let i=0;i<ca.p.length;i+=4){let max=0;for(let ch=0;ch<3;ch++){const delta=Math.abs(ca.p[i+ch]-cb.p[i+ch]);max=Math.max(max,delta);error+=delta;op.data[i+ch]=Math.round((ca.p[i+ch]+cb.p[i+ch])/2);dp.data[i+ch]=delta;}op.data[i+3]=dp.data[i+3]=255;if(max>0)changed++;}
      o.getContext('2d').putImageData(op,0,0);d.getContext('2d').putImageData(dp,0,0);return {changed,changedPercent:changed*100/(width*height),meanError:error/(width*height*3),overlay:o.toDataURL(),diff:d.toDataURL()};
    }, {a:a.toString('base64'),b:b.toString('base64'),width,height});
    await fs.writeFile(`screenshots/overlay/${state}.png`, Buffer.from(result.overlay.split(',')[1],'base64'));
    await fs.writeFile(`screenshots/diff/${state}.png`, Buffer.from(result.diff.split(',')[1],'base64'));
    report.push({state,width,height,changedPixels:result.changed,changedPixelPercentage:result.changedPercent,meanPixelError:result.meanError});
    console.log(`${state}: changed=${result.changedPercent.toFixed(3)}%; mean=${result.meanError.toFixed(3)}`);
  }
  await fs.writeFile('screenshots/state-visual-report.json',JSON.stringify(report,null,2)+'\n');
} finally { await browser.close(); }
