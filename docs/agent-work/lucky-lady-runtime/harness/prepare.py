"""Prepare external pilot inputs; never execute SQL or import source accounts."""
import hashlib, json, pathlib, re

ROOT = pathlib.Path('C:/Users/Admin/orca/research/game-pack-forensics')
RUN = ROOT / 'runtime/LuckyLadysCharmDX'
APP = ROOT / 'external/evidence/taxipult-goldsvet/casino/app'

def method(text, name):
    start = text.index('public function ' + name + '(')
    pos = text.index('{', start)
    depth, quote, escape = 0, None, False
    for i in range(pos, len(text)):
        c = text[i]
        if quote:
            if escape: escape = False
            elif c == '\\': escape = True
            elif c == quote: quote = None
        elif c in "'\"": quote = c
        elif c == '{': depth += 1
        elif c == '}':
            depth -= 1
            if not depth: return text[start:i+1]
    raise ValueError(name)

def fields(raw):
    out, buf, quote, escape = [], '', False, False
    for c in raw:
        if escape:
            buf += {'n':'\n','r':'\r','t':'\t'}.get(c,c); escape=False
        elif c == '\\' and quote: escape=True
        elif c == "'": quote=not quote
        elif c == ',' and not quote: out.append(buf.strip()); buf=''
        else: buf+=c
    out.append(buf.strip())
    return [None if x=='NULL' else x for x in out]

sql = (APP.parent.parent/'v10.sql').read_text(encoding='utf8')
def record(table, ident):
    head = re.search(r'INSERT INTO `'+table+r'` \(([^\n]+)\) VALUES\n',sql)
    cols = re.findall(r'`([^`]+)`',head[1])
    block = sql[head.end():]
    row = next(x for x in block.splitlines() if x.startswith('('+str(ident)+','))
    vals = fields(row[1:row.rindex(')')])
    assert len(vals)==len(cols),(table,len(vals),len(cols))
    return dict(zip(cols,vals))

game=record('w_games',1150)
assert game['name']=='LuckyLadysCharmDX'
shop=record('w_shops',1)
# Configuration only. Histories, banks and identities are freshly disposable.
keep=['name','title','bet','denomination','rezerv','gamebank','slotViewState','lines_percent_config_spin','lines_percent_config_spin_bonus','lines_percent_config_bonus','lines_percent_config_bonus_bonus']
game={k:game[k] for k in keep}
for k in keep:
    if k.startswith('lines_'): json.loads(game[k])
shop={k:shop[k] for k in ['currency','percent','max_win']}
(RUN/'fixtures/config.json').write_text(json.dumps(dict(game=game,shop=shop),indent=2))
g=(APP/'Game.php').read_text(); u=(APP/'User.php').read_text()
keys=re.findall(r"'([0-9]+_[0-9]+)'\s*=>",g[g.index("'random_keys'"):g.index('public function')])
assert keys
trait='<?php namespace VanguardLTE;\ntrait RealGameMethods {\npublic static $values = '+"['random_keys'=>["+','.join("'%s'=>[]"%k for k in keys)+"]];\n"
trait+='\n'.join(method(g,n) for n in ['get_gamebank','set_gamebank','get_line_value','get_lines_percent_config'])+'\n}\ntrait RealUserMethods {\n'+method(u,'updateCountBalance')+'\n}\n'
(RUN/'php-shim/real-methods.php').write_text(trait)
sources=[APP/'Game.php',APP/'User.php',APP/'Lib/Banker.php']+list((APP/'Games/LuckyLadysCharmDX').glob('*'))
(RUN/'evidence/source-hashes.json').write_text(json.dumps({str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in sources if p.is_file()},indent=2))
print('Prepared real shared methods and matching configuration; no source state imported.')
