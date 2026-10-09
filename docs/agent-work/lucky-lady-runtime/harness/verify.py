"""Read-only acceptance checks for captured pilot evidence and immutable sources."""
import hashlib, json, pathlib, sqlite3
R=pathlib.Path('C:/Users/Admin/orca/research/game-pack-forensics')
P=R/'runtime/LuckyLadysCharmDX'
load=lambda p: json.loads(p.read_text(encoding='utf8'))
normal=load(P/'evidence/normal-spin.json')
assert normal['boardProof']['matches'] and normal['boardProof']['stable']
assert normal['boardProof']['stops']==5 and normal['boardProof']['state']=='IDLE'
assert normal['consoleErrors']==[] and normal['outbound']==[]
assert normal['replayStatus']==200
db=sqlite3.connect('file:'+str(P/'state/pilot.sqlite')+'?mode=ro',uri=True)
rows=db.execute('SELECT delta,before_balance,after_balance FROM ledger WHERE request_id=?',(normal['request']['id'],)).fetchall()
assert rows==[(-0.1,1000.0,999.9)],rows
logs=[json.loads(x) for x in (P/'logs/protocol.jsonl').read_text().splitlines()]
settings=next(x for x in logs if x['request']['slotEvent']=='getSettings')
assert settings['response']['responseEvent']=='getSettings'
assert len(settings['response']['serverResponse']['gameLine'])==10
assert load(P/'evidence/collect.json')['ledgerUnchanged']
gamble=load(P/'evidence/gamble.json')
assert [g['body']['serverResponse']['gambleState'] for g in gamble]==['win','lose']
assert [g['request']['gambleChoice'] for g in gamble]==['red','black']
free=load(P/'evidence/free-spins.json')
assert free['firstFreeSpin']['serverResponse']['currentFreeGames']==1
for event in logs:
    if event['request']['slotEvent']=='freespin':
        assert not db.execute('SELECT 1 FROM ledger WHERE request_id=? AND delta<0',(event['id'],)).fetchone()
assert load(P/'evidence/retrigger.json')['response']['serverResponse']['totalFreeGames']==30
end=load(P/'evidence/free-spin-end.json')
assert end['response']['serverResponse']['currentFreeGames']==30
assert end['extraRejected']['serverResponse']=='invalid bonus state'
for path, sha in load(P/'evidence/source-hashes.json').items():
    assert hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()==sha,path
tree=load(R/'external/frontend-hunt/heidi-luong1109--game.tree.json')
files=[f for f in tree['tree'] if f['type']=='blob' and f['path'].startswith('public/games/LuckyLadysCharmDX/')]
assert len(files)==185
for f in files:
    content=(R/'external/frontend-hunt/files/heidi-luong1109--game'/f['path']).read_bytes()
    assert hashlib.sha1(b'blob '+str(len(content)).encode()+b'\0'+content).hexdigest()==f['sha'],f['path']
assert not (P/'state/test-next.json').exists()
summary=load(P/'evidence/runtime-summary.json')
assert summary['outbound']==[] and summary['pageErrors']==[]
allrows=db.execute('SELECT delta,before_balance,after_balance FROM ledger ORDER BY id').fetchall()
for delta,before,after in allrows: assert abs(before+delta-after)<1e-8
for prior,nxt in zip(allrows,allrows[1:]):assert abs(prior[2]-nxt[1])<1e-8
normal_event=next(x for x in logs if x['id']==normal['request']['id'])
result={'normalSpin':'PASS','singleDebitAndReplay':'PASS','exactStableBoard':'PASS','collect':'PASS','gambleRedWinBlackLoss':'PASS','freeSpinNoDebit':'PASS','retrigger':'PASS (API test fixture)','finalFreeSpin':'PASS (API counter fixture)','sourceHashes':'unchanged','clientGitBlobs':185,'pageErrors':[],'outbound':[],'normalRngCalls':len(normal_event['rng']),'ledgerEntries':len(allrows),'note':'No guarantee of native recovery or replay safety without explicit request IDs.'}
(P/'evidence/verification.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
