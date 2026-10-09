"""Bounded HTTP/database recovery regression, running real PHP in a fresh disposable DB."""
import copy, http.cookiejar, json, os, pathlib, re, sqlite3, subprocess, time, urllib.request, urllib.error, uuid

RUN=pathlib.Path('C:/Users/Admin/orca/research/game-pack-forensics/runtime/LuckyLadysCharmDX')
BASE='http://127.0.0.1:8767'
class Pilot:
    def __init__(self):
        self.name='recovery-'+uuid.uuid4().hex[:8]+'.sqlite'
        self.db=RUN/'state'/self.name
        self.jar=http.cookiejar.CookieJar()
        self.http=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.state=None
    def boot(self):
        cmd=json.loads((RUN/'state/process.json').read_text())['command']
        cmd[cmd.index('-S')+1]='127.0.0.1:8767'
        self.log=open(RUN/'logs/recovery-test-process.log','ab')
        self.proc=subprocess.Popen(cmd,cwd=RUN,env={**os.environ,'LUCKY_PILOT_DB':self.name,'LUCKY_PILOT_PORT':'8767'},stdout=self.log,stderr=self.log,creationflags=subprocess.CREATE_NO_WINDOW)
        for _ in range(30):
            try: self.http.open(BASE+'/',timeout=1).read();break
            except urllib.error.URLError: time.sleep(.1)
        self.call({'slotEvent':'getSettings'})
    def call(self,body,ident=None,state=None,status=200):
        state=state or self.state
        headers={'Content-Type':'application/json','X-Pilot-Request-ID':ident or uuid.uuid4().hex}
        if state:
            headers.update({'X-Pilot-Version':str(state['version']),'X-Pilot-Round':state['roundId'] or 'none'})
        request=urllib.request.Request(BASE+'/game/LuckyLadysCharmDX/server?sessionId=regression',data=json.dumps(body,separators=(',',':')).encode(),headers=headers)
        try:r=self.http.open(request,timeout=15)
        except urllib.error.HTTPError as e:r=e
        payload=r.read()
        assert r.status==status,(r.status,payload[:500])
        result=json.loads(payload)
        if status==200 and 'recovery' in result:self.state=result['recovery']
        return result
    def snapshot(self):
        with sqlite3.connect(self.db) as db:
            user=json.loads(db.execute("SELECT data FROM records WHERE kind='User'").fetchone()[0])
            return {'ledger':db.execute('SELECT * FROM ledger ORDER BY id').fetchall(),'balance':user['balance'],'session':user['session']}
    def fixture(self,outcome):
        pathlib.Path(str(self.db)+'.next.json').write_text(json.dumps({'outcome':outcome}))
    def bonus_history(self):
        with sqlite3.connect(self.db) as db:
            g=json.loads(db.execute("SELECT data FROM records WHERE kind='Game'").fetchone()[0]);g['stat_in']=100000
            db.execute("UPDATE records SET data=? WHERE kind='Game'",(json.dumps(g),))
    def spin(self,outcome='none',free=False):
        self.fixture(outcome)
        return self.call({'slotEvent':'freespin' if free else 'bet','slotBet':'0.01','slotLines':10})
    def check_refresh(self,phase):
        before=self.snapshot();saved=copy.deepcopy(self.state)
        for _ in range(2):
            r=self.call({'slotEvent':'getSettings'},'repeated-recovery-read')
            assert r['responseEvent']=='getSettings'
            assert r['recovery']==saved,(saved,r['recovery'])
            assert self.snapshot()==before,'Refresh mutated financial/feature state'
            assert self.state['phase']==phase
        return {'phase':phase,'round':saved['roundId'],'version':saved['version'],'free':saved['free'],'ledgerRows':len(before['ledger'])}
    def close(self):
        self.proc.terminate();self.proc.wait(timeout=5);self.log.close()

def run():
    p=Pilot();out={}
    try:
        p.boot();out['initialBase']=p.check_refresh('IDLE')
        before=copy.deepcopy(p.state);p.fixture('none')
        bet={'slotEvent':'bet','slotBet':'0.01','slotLines':10}
        first=p.call(bet,'one-normal',before);snap=p.snapshot()
        assert first['responseEvent']=='spin'
        assert p.call(bet,'one-normal',before)==first
        assert p.snapshot()==snap and len(snap['ledger'])==1
        p.call(bet,'different-id-same-old-version',before,status=409)
        assert p.snapshot()==snap
        out['baseRefresh']=p.check_refresh('IDLE');out['debitReplay']='PASS'
        p.spin('win');assert p.state['pendingWin']>0
        out['pendingWin']=p.check_refresh('PENDING_WIN')
        before=copy.deepcopy(p.state);snap=p.snapshot();collect={'slotEvent':'recoveryCollect'}
        c=p.call(collect,'collect-once',before)
        assert p.snapshot()['ledger']==snap['ledger']
        assert p.call(collect,'collect-once',before)==c
        p.call(collect,'collect-again',before,status=409)
        assert p.snapshot()['ledger']==snap['ledger']
        out['postCollect']=p.check_refresh('IDLE');out['collectAndCreditReplay']='PASS'
        p.spin('win');p.call({'slotEvent':'recoveryGamble'})
        out['gambleEntry']=p.check_refresh('GAMBLE')
        before=copy.deepcopy(p.state);p.fixture('gamble-win');body={'slotEvent':'slotGamble','gambleChoice':'red'}
        win=p.call(body,'gamble-once',before);snap=p.snapshot()
        assert p.state['gamble']['attempts']==1
        assert p.call(body,'gamble-once',before)==win and p.snapshot()==snap
        p.call(body,'gamble-stale',before,status=409);assert p.snapshot()==snap
        out['gambleAfterAttempt']=p.check_refresh('GAMBLE')
        snap=p.snapshot();p.call({'slotEvent':'recoveryCollect'});assert p.snapshot()['ledger']==snap['ledger']
        out['gambleCollect']=p.check_refresh('IDLE')
        p.spin('win');p.call({'slotEvent':'recoveryGamble'})
        p.fixture('gamble-loss');p.call({'slotEvent':'slotGamble','gambleChoice':'black'})
        out['gambleLoss']=p.check_refresh('IDLE')
        p.bonus_history();p.spin('bonus');out['freeTrigger']=p.check_refresh('FREE_SPINS')
        assert p.state['free']['total']==15
        snap=p.snapshot();bad={'slotEvent':'freespin','slotBet':'0.02','slotLines':10}
        p.call(bad,status=409);p.call(bet,status=409);assert p.snapshot()==snap
        p.spin('none',free=True);out['activeFree']=p.check_refresh('FREE_SPINS')
        assert p.state['free']['current']==1 and p.state['bet']=={'slotBet':'0.01','slotLines':10}
        before=copy.deepcopy(p.state);p.fixture('bonus');body={**bet,'slotEvent':'freespin'}
        r=p.call(body,'retrigger-once',before);snap=p.snapshot()
        assert p.state['free']['total']==30 and p.state['free']['current']==2
        assert p.call(body,'retrigger-once',before)==r and p.snapshot()==snap
        p.call(body,'retrigger-stale',before,status=409);assert p.snapshot()==snap
        out['retrigger']=p.check_refresh('FREE_SPINS')
        # A replayed read ID must be fresh, not return a cached pre-spin getSettings response.
        assert p.call({'slotEvent':'getSettings'},'repeated-recovery-read')['recovery']['free']['total']==30
        out['duplicateRecoveryAndFreeProgression']='PASS'
        # Emulate expiry of legacy session entries without changing payloads or money.
        with sqlite3.connect(p.db) as db:
            u=json.loads(db.execute("SELECT data FROM records WHERE kind='User'").fetchone()[0])
            u['session']=re.sub(r'(s:8:"timelife";)i:\d+;',r'\g<1>i:1;',u['session'])
            db.execute("UPDATE records SET data=? WHERE kind='User'",(json.dumps(u),))
        money=p.snapshot()['ledger'];state=copy.deepcopy(p.state)
        p.call({'slotEvent':'getSettings'})
        assert p.state==state and p.snapshot()['ledger']==money
        p.spin('none',free=True);assert p.state['free']['current']==3
        out['expiredSessionContinuation']='PASS'
        out['database']=str(p.db);out['verdict']='PASS'
        (RUN/'evidence/recovery-regression.json').write_text(json.dumps(out,indent=2))
        print(json.dumps(out,indent=2))
    finally:p.close()

if __name__=='__main__':run()
