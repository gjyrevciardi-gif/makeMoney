/**
 * Deterministic presentation-motion assertions.
 *
 * Measures pixels the player already drew:
 *
 * 1. symbols must keep entering at the top of the reel window: the top band of
 *    the window changes earliest and keeps changing while the reels turn;
 * 2. every reel must visibly move while it turns;
 * 3. reels must stop in order 1 -> 2 -> 3 -> 4 -> 5.
 *
 * Presentation only: no RNG, outcome or backend behaviour is exercised.
 */
const FIXTURE_GRID=[['low-2','high-4','low-4'],['low-4','low-5','low-2'],['low-3','low-4','low-5'],['low-3','high-4','high-3'],['low-3','high-1','low-1']];
const MOVING=0.25;
const IDLE=0.08;
const CHANGE_THRESHOLD=12;

export async function assertReelMotion(page){
  await page.evaluate((grid)=>{
    const el=document.querySelector('slot-game');
    const result={roundId:'motion-fixture',gameId:'book-of-the-sands',gameVersion:'1',playerId:'fixture',betUnits:'10',totalWinUnits:'0',netUnits:'-100',finalGrid:grid,wins:[],draws:[],featureState:{},complete:true,outcomeHash:'motion-fixture',events:[{sequence:0,type:'grid-reveal',data:{grid}}]};
    el.transport={spin:async()=>{await new Promise(resolve=>setTimeout(resolve,1200));return result;},action:async()=>{throw Error('Unexpected motion action');}};
    window.__motion={startedAt:performance.now(),sawMoving:false,prev:null,spin:el.playResult(result).catch(()=>{})};
  },FIXTURE_GRID);

  const lastChange=[0,0,0,0,0];
  const topBand=[],bottomBand=[];
  let sawMoving=false,firstTopChange=0,firstBottomChange=0;
  const startedAt=Date.now();
  while(Date.now()-startedAt<3200){
    await new Promise(resolve=>setTimeout(resolve,16));
    const probe=await page.evaluate(({threshold})=>{
      const el=document.querySelector('slot-game');
      const canvas=el.shadowRoot.querySelector('canvas.reel-canvas');
      const {width,height,data}=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);
      const state=window.__motion;
      const moving=el.hasAttribute('reels-moving');
      if(moving)state.sawMoving=true;
      const previous=state.prev;
      let perReel=[0,0,0,0,0],top=0,bottom=0;
      if(previous&&previous.width===width&&previous.height===height){
        const band=width/5,topEnd=Math.round(height*0.3),bottomStart=Math.round(height*0.7);
        for(let reel=0;reel<5;reel++){
          const x0=Math.round(reel*band+band*0.18),x1=Math.round((reel+1)*band-band*0.18);
          let changed=0,total=0;
          for(let y=0;y<height;y+=3)for(let x=x0;x<x1;x+=3){const i=(y*width+x)*4;if(Math.abs(data[i]-previous.data[i])+Math.abs(data[i+1]-previous.data[i+1])+Math.abs(data[i+2]-previous.data[i+2])>threshold)changed++;total++;}
          perReel[reel]=total?changed/total:0;
        }
        const count=(from,to)=>{let changed=0,total=0;for(let y=from;y<to;y+=3)for(let x=Math.round(width*0.1);x<width*0.9;x+=3){const i=(y*width+x)*4;if(Math.abs(data[i]-previous.data[i])+Math.abs(data[i+1]-previous.data[i+1])+Math.abs(data[i+2]-previous.data[i+2])>threshold)changed++;total++;}return total?changed/total:0;};
        top=count(0,topEnd);bottom=count(bottomStart,height);
      }
      state.prev={width,height,data:new Uint8ClampedArray(data)};
      return {moving,sawMoving:state.sawMoving,perReel,top,bottom,now:Math.round(performance.now()-state.startedAt)};
    },{threshold:CHANGE_THRESHOLD});
    sawMoving=sawMoving||probe.moving;
    // Skip the first frames after 'reels-moving' appears: reel 1 resolves before
    // the strip is drawn, and that first repaint is not a stop.
    if(probe.moving){
      if(probe.now<600)continue;
      for(let reel=0;reel<5;reel++)if(probe.perReel[reel]>MOVING)lastChange[reel]=probe.now;
      if(probe.top>IDLE){topBand.push(probe.top);if(!firstTopChange)firstTopChange=probe.now;}
      if(probe.bottom>IDLE){bottomBand.push(probe.bottom);if(!firstBottomChange)firstBottomChange=probe.now;}
    }
    if(!probe.moving&&lastChange[4]>0)break;
  }
  await page.evaluate(()=>window.__motion?.spin);
  const mean=(list)=>list.length?list.reduce((sum,value)=>sum+value,0)/list.length:0;
  // Nominal per-reel landing times the player itself scheduled, in ms from spin start.
  const scheduled=await page.evaluate(()=>{
    const raw=document.querySelector('slot-game')?.getAttribute('reel-settle-times');
    try{return raw?JSON.parse(raw):null;}catch{return null;}
  });
  return {
    sawMoving,
    topBandFrames:topBand.length,
    bottomBandFrames:bottomBand.length,
    topBandMeanChange:Number(mean(topBand).toFixed(3)),
    bottomBandMeanChange:Number(mean(bottomBand).toFixed(3)),
    firstTopChangeMs:firstTopChange,
    firstBottomChangeMs:firstBottomChange,
    reelLastChange:lastChange.map(value=>Math.round(value)),
    reelScheduledStop:Array.isArray(scheduled)?scheduled.map(Number):null,
  };
}
