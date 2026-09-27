"""Start a verified, loopback-only disposable PHP pilot. No installers or source edits."""
import json, pathlib, secrets, shutil, subprocess
ROOT=pathlib.Path('C:/Users/Admin/orca/research/game-pack-forensics')
RUN=ROOT/'runtime/LuckyLadysCharmDX'
PREVIEW=ROOT/'previews/LuckyLadysCharmDX'
HERE=pathlib.Path(__file__).resolve().parent
for n in ['router.php','compat.php']:
    shutil.copyfile(HERE/n,RUN/'php-shim'/n)
shutil.copyfile(PREVIEW/'entry.preview.html',RUN/'entry.html')
shutil.copyfile(PREVIEW/'preview-font-ready.js',RUN/'preview-font-ready.js')
(RUN/'fixtures/language.json').write_text(json.dumps(json.loads((PREVIEW/'getSettings.json').read_text())['slotLanguage']))
token=RUN/'state/session-token'
if not token.exists(): token.write_text(secrets.token_hex(32))
php=RUN/'php/php.exe'
cmd=[str(php),'-n','-d','extension_dir='+str(RUN/'php/ext'),'-d','extension=php_pdo_sqlite.dll',
 '-d','allow_url_fopen=0','-d','allow_url_include=0','-d','display_errors=0','-d','log_errors=1',
 '-d','error_reporting=22527','-d','error_log='+str(RUN/'logs/php-errors.log'),
 '-d','disable_functions=exec,shell_exec,system,passthru,proc_open,popen,fsockopen,pfsockopen,stream_socket_client,stream_socket_server,mail,dl',
 '-S','127.0.0.1:8766',str(RUN/'php-shim/router.php')]
with open(RUN/'logs/process.log','ab') as log:
    p=subprocess.Popen(cmd,cwd=RUN,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
(RUN/'state/process.json').write_text(json.dumps({'pid':p.pid,'command':cmd},indent=2))
print('Started PID',p.pid,'http://127.0.0.1:8766')
