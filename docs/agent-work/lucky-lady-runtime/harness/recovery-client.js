/* Local recovery bridge. Recovered bundles/assets remain byte-for-byte unchanged. */
(() => {
  let state, busy = false, ready = false;
  const reels = [];
  const clone = value => JSON.parse(JSON.stringify(value));
  const originalReel = window.GameReel;
  window.GameReel = function (...args) {
    const reel = new originalReel(...args);
    reels.push(reel);
    return reel;
  };
  const originalCreate = window.CreateGame;
  window.CreateGame = function () {
    originalCreate();
    ready = true;
    restore();
    window.pilotRecoveryReady = true;
  };
  function restore() {
    if (!ready || !state) return;
    autoMode = false;
    bonusMode = false;
    slotStateData.scatShow = false;
    slotStateData.gambleEnd = false;
    slotSettings.Balance = state.balance;
    slotStateData.credit = state.balance;
    slotStateData.credit_new = state.balance;
    slotStateData.totalWin = state.pendingWin;
    slotStateData.oldWin = state.settlement.collected ? (state.result?.serverResponse.totalWin || 0) : 0;
    if (state.bet) {
      slotStateData.betline = state.bet.slotBet;
      slotStateData.lines = state.bet.slotLines;
      slotStateData.bet = Number(state.bet.slotBet) * state.bet.slotLines;
      slotSettings.BetCnt = slotSettings.Bet.findIndex(b => Number(b) === Number(state.bet.slotBet));
      slotSettings.LineCnt = slotSettings.gameLine.indexOf(state.bet.slotLines);
    }
    if (state.result) {
      slotSpinResult = clone(state.result.serverResponse);
      slotStateData.slotSpinResult = clone(slotSpinResult);
      slotSpinResult.totalWin = state.pendingWin;
      slotSpinResult.afterBalance = state.balance;
      slotSpinResult.totalFreeGames = state.free.total;
      slotSpinResult.currentFreeGames = state.free.current;
      reels.forEach((r, i) => r.FillServerReel(slotSpinResult.reelsSymbols['reel' + (i + 1)], slotSpinResult.reelsSymbols.rp[i]));
    }
    gameBonus.HideBonus();
    // A fresh client already has a hidden gamble view. Close() schedules a tween
    // that would otherwise hide the newly restored gamble screen 150ms later.
    gameView.EndBonus();
    slotState = SLOT_STATE_IDLE;
    if (state.phase === 'PENDING_WIN' || state.phase === 'GAMBLE') {
      // Original AddWin presents a win already included in the authoritative balance.
      slotStateData.credit = Math.round((state.balance - state.pendingWin) * 100) / 100;
      slotState = SLOT_STATE_AFTERWIN;
      gameCounters.ShowWinPaid();
      if (state.phase === 'GAMBLE') {
        slotState = SLOT_STATE_GAMBLE;
        dispatchEvent(new Event(SLOT_EVENT_GAMBLESTART));
        for (const card of state.gamble.cards.slice(-5)) gameGamble.ShowPrevCards(card);
        gameGamble.UpdatePrevCards();
      }
    } else if (state.phase === 'FREE_SPINS') {
      bonusMode = true;
      slotSettings.slotFreeMpl = state.free.multiplier;
      gameView.ShowBonus();
      slotState = SLOT_STATE_WAITBONUS;
      if (state.free.current === 0 || slotSpinResult.bonusInfo.scattersType === 'bonus') gameBonus.ShowBonus();
      // Wait for the original Start control: recovery itself never consumes another free spin.
      dispatchEvent(new Event(SLOT_EVENT_STARTBONUS));
      if (state.free.current > 0 && slotSpinResult.bonusInfo.scattersType !== 'bonus') gameBonus.HideBonus();
    }
    gameCounters.UpdateCounters();
    if (state.phase === 'IDLE') dispatchEvent(new Event(SLOT_EVENT_EMPTYSPIN));
    if (!['GAMBLE','FREE_SPINS'].includes(state.phase)) gameUI.UpdateButtons();
  }
  async function send(body) {
    const id = crypto.randomUUID();
    const headers = { 'Content-Type': 'application/json', 'X-Pilot-Request-ID': id };
    if (state && !['getSettings', 'update'].includes(body.slotEvent)) {
      headers['X-Pilot-Version'] = String(state.version);
      headers['X-Pilot-Round'] = state.roundId || 'none';
    }
    // Retry an uncertain transport result with the SAME identity/version/body only.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        let response;
        try { response = await fetch('/game/LuckyLadysCharmDX/server?sessionId=' + sessionStorage.getItem('sessionId'), {method:'POST', headers, body:JSON.stringify(body), signal:controller.signal}); }
        finally { clearTimeout(timeout); }
        if (!response.ok) throw Object.assign(new Error('Recovery request rejected: ' + response.status), {terminal:response.status < 500});
        const data = await response.json();
        if (data.recovery) state = data.recovery;
        window.pilotRecovery = state; // Read-only-by-contract diagnostics; never posted as authority.
        return data;
      } catch (error) {
        if (attempt || error.terminal) throw error;
      }
    }
  }
  window.ServerConnect = async function (body) {
    if (busy) return;
    busy = true;
    try {
      const response = await send(body);
      if (response.responseEvent === 'error') throw new Error('Native request rejected');
      ResponseController(response);
    } catch (error) {
      // A stale or ambiguous result is reconciled by a fresh server snapshot, never a new bet.
      console.warn(error.message);
      location.reload();
    } finally { busy = false; }
  };
  const originalButtons = window.ButtonsController;
  window.ButtonsController = async function (event) {
    if (busy || !state) return;
    const name = event.detail.bname;
    const entering = slotState === SLOT_STATE_AFTERWIN && ['uiButtonGamble','gambleSelectRed','gambleSelectBlack','uiButtonRed','uiButtonBlack'].includes(name);
    const collecting = name === 'uiButtonSpin' && [SLOT_STATE_AFTERWIN,SLOT_STATE_GAMBLE].includes(slotState);
    if (entering || collecting) {
      busy = true;
      try { await send({slotEvent:entering?'recoveryGamble':'recoveryCollect'}); }
      catch (error) { console.warn(error.message); location.reload(); return; }
      finally { busy = false; }
    }
    originalButtons(event);
  };
})();
