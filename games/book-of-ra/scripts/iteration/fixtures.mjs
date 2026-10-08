// Presentation fixtures only. No requests reach the real wallet or RNG.
export async function prepareState(page,id){
  await page.evaluate(({id})=>{
    const el=document.querySelector('slot-game');
    const base=[['low-2','high-4','low-4'],['low-4','low-5','low-2'],['low-3','low-4','low-5'],['low-3','high-4','high-3'],['low-3','high-1','low-1']];
    const grid=id==='07-autoplay'?[['low-3','low-5','low-1'],['high-2','low-3','low-5'],['low-2','high-2','low-1'],['low-4','low-3','high-4'],['low-2','high-2','low-3']]:id==='05-free-games'?[['low-5','scatter','low-2'],['low-5','high-2','low-3'],['low-5','low-2','high-3'],['low-4','low-1','high-1'],['low-5','high-3','scatter']]:base;
    el.setAttribute('visual-preview','');el.previewGrid(grid);el.removeAttribute('visual-preview');
    const result={roundId:'visual-fixture',gameId:'book-of-the-sands',gameVersion:'1',playerId:'fixture',betUnits:'10',totalWinUnits:'0',netUnits:'-100',finalGrid:grid,wins:[],draws:[],featureState:{},complete:true,outcomeHash:'fixture',events:[]};
    const cells=[0,1,2,3,4].map(reel=>({reel,row:1}));
    if(id==='02-paylines'||id==='04-win'){
      result.totalWinUnits='500';result.events=[{sequence:0,type:'win',data:{cells,payoutUnits:'500',regular:true}},{sequence:1,type:'round-complete',data:{totalWinUnits:'500'}}];
    }
    if(id==='05-free-games'){
      result.roundState='FREE_GAME_INTRO';result.events=[{sequence:0,type:'free-spins-start',data:{spins:10,specialSymbol:'low-4'}}];
    }
    if(id==='06-gamble'){
      result.totalWinUnits='3000';result.complete=false;result.roundState='GAMBLE_PENDING';result.pendingAction={id:'fixture:gamble',type:'gamble',featureId:'gamble-feature',choices:[{id:'red',labelKey:'Red'},{id:'black',labelKey:'Black'},{id:'collect',labelKey:'Collect'}]};
    }
    window.__visual={done:false,error:null,spins:0};
    el.transport={spin:async()=>{window.__visual.spins++;return {...result,events:[{sequence:0,type:'grid-reveal',data:{grid}}]};},action:async()=>{throw Error('Unexpected visual-test action');}};
    if(id==='03-paytable'){el.shadowRoot.querySelector('.paytable').click();window.__visual.done=true;}
    else if(id==='07-autoplay'){el.turbo=true;el.shadowRoot.querySelector('[data-key="autoplay"]').click();}
    else el.playResult(result).then(()=>{window.__visual.done=true;}).catch(e=>{window.__visual.error=String(e);});
  },{id});
  // Fixed virtual time exposes the real intro before it disappears and the first
  // autoplay result before its next spin. It doesn't change production timing.
  await page.clock.runFor(id==='07-autoplay'?1000:id==='05-free-games'?500:500);
  const state=await page.locator('slot-game').evaluate(el=>{
    const s=el.shadowRoot;
    return {...window.__visual,bonus:s.querySelector('.bonus')?.classList.contains('active'),intro:s.querySelector('.announce')?.classList.contains('active'),paytable:s.querySelector('dialog')?.open,auto:s.querySelector('[data-key="autoplay"]')?.textContent,moving:el.hasAttribute('reels-moving')};
  });
  if(state.error)throw Error(state.error);
  if(id==='06-gamble'&&!state.bonus)throw Error('Gamble fixture is not visible');
  if(id==='05-free-games'&&!state.intro)throw Error('Free-games introduction is not visible');
  if(id==='03-paytable'&&!state.paytable)throw Error('Paytable is not open');
  if(id==='07-autoplay'&&(state.auto!=='Stop'||state.spins!==1||state.moving))throw Error(`Autoplay fixture invalid: ${JSON.stringify(state)}`);
  return state;
}
