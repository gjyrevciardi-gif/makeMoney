/* Local recovery bridge. Recovered bundles/assets remain byte-for-byte unchanged.
   Presentation receipts live here, not in the recovered client: an authoritative result is
   acknowledged only once the original client has rendered it, and no later gameplay action
   starts until the server has accepted that receipt. */
(() => {
  let state, busy = false, ready = false;
  let ackEntry = null;        // in-flight receipt for the latest authoritative action
  let ackedActionId = null;   // action already acknowledged on this page
  const READ_ONLY = ['getSettings', 'update', 'ack'];
  const ACK_RENDER_TIMEOUT_MS = 20000;
  const ACK_STABLE_OBSERVATIONS = 2;
  const ACK_RETRY_KEY = 'pilotReceiptReconcile';
  const receipts = [];        // read-only diagnostics; never posted as authority
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

  /* ---------- receipt: acknowledge only what the original client actually rendered ---------- */

  /** True while the on-screen reels show exactly the authoritative rows of the current result. */
  function boardRendered() {
    try {
      const symbols = slotSpinResult && slotSpinResult.reelsSymbols;
      if (!symbols) return true; // gamble/collect responses carry no board of their own
      if (reels.length < 5) return false;
      const h = (typeof symHeight === 'number' && symHeight > 0) ? symHeight : 88;
      for (let i = 0; i < 5; i++) {
        const want = symbols['reel' + (i + 1)];
        const view = reels[i] && reels[i]._view;
        if (!want || !view) return false;
        const visible = view.children
          .filter(s => s.texture && s.texture.textureCacheIds && s.texture.textureCacheIds[0] && s.y >= 0 && s.y < h * 3 - 1)
          .sort((a, b) => a.y - b.y).slice(0, 3)
          .map(s => s.texture.textureCacheIds[0]);
        if (visible.join('|') !== want.slice(0, 3).join('|')) return false;
      }
      return true;
    } catch (error) { return false; }
  }
  /**
   * Resolves true ONLY once the presented board has been observed settled
   * ACK_STABLE_OBSERVATIONS times in a row. On timeout it resolves false; a single final
   * observation is never accepted, so a stalled, failed or unrenderable result can never be
   * mistaken for a completed presentation.
   */
  async function waitForBoard(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let stable = 0;
    for (;;) {
      if (boardRendered()) stable += 1; else stable = 0;
      if (stable >= ACK_STABLE_OBSERVATIONS) return true;
      if (Date.now() >= deadline) return false;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }

  function ackRetryList() {
    try {
      const seen = JSON.parse(sessionStorage.getItem(ACK_RETRY_KEY) || '[]');
      return Array.isArray(seen) ? seen : [];
    } catch (error) { return []; }
  }
  function ackRetryRemember(actionId) {
    try {
      const seen = ackRetryList();
      if (!seen.includes(actionId)) seen.push(actionId);
      sessionStorage.setItem(ACK_RETRY_KEY, JSON.stringify(seen.slice(-20)));
    } catch (error) { /* storage unavailable: the in-page guard still applies */ }
  }
  function ackRetryForget(actionId) {
    try {
      sessionStorage.setItem(ACK_RETRY_KEY, JSON.stringify(ackRetryList().filter((id) => id !== actionId)));
    } catch (error) { /* ignore */ }
  }
  /**
   * A withheld receipt leaves the server authoritative and pending. Reload at most once per
   * action id, so a permanently unrenderable result cannot reload the page forever.
   */
  function reconcileWithheld(actionId) {
    if (ackRetryList().includes(actionId)) {
      window.pilotReceiptWithheld = actionId;
      console.warn('receipt withheld for ' + actionId + '; the server keeps the action pending');
      return false;
    }
    ackRetryRemember(actionId);
    location.reload();
    return true;
  }
  /** Records a withheld receipt and reconciles at most once per action id. */
  function reportWithheld(entry) {
    if (entry.reported) return;
    entry.reported = true;
    receipts.push({ actionId: entry.actionId, accepted: false, reason: entry.failure || 'error', at: Date.now() });
    reconcileWithheld(entry.actionId);
  }

  function acknowledge(response) {
    const recovery = response && response.recovery;
    // An older snapshot protocol carries no receipt identity: stay inert rather than guess.
    if (!recovery || !recovery.actionId) return;
    const actionId = String(recovery.actionId);
    if (recovery.receipt && recovery.receipt.acked) { ackedActionId = actionId; return; }
    if (ackedActionId === actionId) return;
    if (ackEntry && ackEntry.actionId === actionId) return;
    const entry = { actionId, failure: null, reported: false, promise: null };
    // This promise always settles true/false: a withheld receipt is a decision, not an
    // unhandled rejection.
    entry.promise = (async () => {
      try {
        if (!(await waitForBoard(ACK_RENDER_TIMEOUT_MS))) {
          entry.failure = 'RENDER_TIMEOUT';
          reportWithheld(entry);
          return false;
        }
        const ack = await send({ slotEvent: 'ack', actionId });
        if (!ack || !ack.accepted) {
          entry.failure = 'ACK_REJECTED';
          reportWithheld(entry);
          return false;
        }
        ackedActionId = actionId;
        ackRetryForget(actionId);
        window.pilotReceiptWithheld = null;
        receipts.push({ actionId, accepted: true, boardRendered: true, at: Date.now() });
        return true;
      } catch (error) {
        entry.failure = 'TRANSPORT';
        entry.detail = String(error && error.message);
        reportWithheld(entry);
        return false;
      }
    })();
    ackEntry = entry;
  }
  async function awaitAck() {
    const entry = ackEntry;
    if (!entry) return;
    const accepted = await entry.promise;
    if (accepted) {
      if (ackEntry === entry) ackEntry = null;
      return;
    }
    // The receipt was already reported (and reconciled at most once) when it was withheld.
    throw Object.assign(new Error('receipt withheld for ' + entry.actionId + (entry.detail ? ': ' + entry.detail : '')), {
      code: 'RECEIPT_WITHHELD',
    });
  }
  /** A withheld or already-reconciling receipt must not trigger an unconditional reload loop. */
  function handleFailure(error) {
    console.warn(error.message);
    if (error && error.code === 'RECEIPT_WITHHELD') return;
    location.reload();
  }
  window.pilotReceipts = receipts;
  window.pilotReceiptWithheld = null;

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
    acknowledge({ recovery: state });
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
      // Gate: the next gameplay action waits for the receipt of the previous result.
      if (ackEntry && !READ_ONLY.includes(body.slotEvent)) await awaitAck();
      const response = await send(body);
      if (response.responseEvent === 'error') throw new Error('Native request rejected');
      ResponseController(response);
      acknowledge(response);
    } catch (error) {
      // A stale or ambiguous result is reconciled by a fresh server snapshot, never a new bet.
      handleFailure(error);
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
      try {
        if (ackEntry) await awaitAck();
        const response = await send({slotEvent: entering ? 'recoveryGamble' : 'recoveryCollect'});
        if (response.responseEvent === 'error') throw new Error('Native request rejected');
        originalButtons(event);
        acknowledge(response);
      } catch (error) { handleFailure(error); return; }
      finally { busy = false; }
      return;
    }
    originalButtons(event);
  };
})();
