<?php
require __DIR__.'/compat.php';
// Explicit network and session boundary, wholly separate from any Goldsvet or Fool's Gold service.
if(($_SERVER['REMOTE_ADDR']??'')!=='127.0.0.1'||($_SERVER['HTTP_HOST']??'')!=='127.0.0.1:8766'){http_response_code(403);exit;}
header("Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'");
header('Cache-Control: no-store');
$path=parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH);
$client='C:/Users/Admin/orca/research/game-pack-forensics/external/frontend-hunt/files/heidi-luong1109--game/public/games/LuckyLadysCharmDX';
if($_SERVER['REQUEST_METHOD']==='GET'){
 if($path==='/'){setcookie('pilot_session',trim(file_get_contents(RUN.'/state/session-token')),['httponly'=>true,'samesite'=>'Strict']);header('Content-Type: text/html');readfile(RUN.'/entry.html');exit;}
 if($path==='/preview-font-ready.js'){header('Content-Type: application/javascript');readfile(RUN.'/preview-font-ready.js');exit;}
 $prefix='/games/LuckyLadysCharmDX/';
 $file=str_starts_with($path,$prefix)?realpath($client.'/'.rawurldecode(substr($path,strlen($prefix)))):false;
 if(!$file||!str_starts_with(str_replace('\\','/',$file),$client.'/')||!is_file($file)){http_response_code(404);exit;}
 $ext=strtolower(pathinfo($file,PATHINFO_EXTENSION));$types=['js'=>'application/javascript','json'=>'application/json','png'=>'image/png','css'=>'text/css','woff'=>'font/woff','ttf'=>'font/ttf','eot'=>'application/vnd.ms-fontobject','ogg'=>'audio/ogg','mp3'=>'audio/mpeg','map'=>'application/json'];
 if(!isset($types[$ext])){http_response_code(403);exit;}header('Content-Type: '.$types[$ext]);readfile($file);exit;
}
if($path!=='/game/LuckyLadysCharmDX/server'||$_SERVER['REQUEST_METHOD']!=='POST'){http_response_code(404);exit;}
if(!hash_equals(trim(file_get_contents(RUN.'/state/session-token')),$_COOKIE['pilot_session']??'')){http_response_code(401);exit;}
if(isset($_SERVER['HTTP_ORIGIN'])&&$_SERVER['HTTP_ORIGIN']!=='http://127.0.0.1:8766'){http_response_code(403);exit;}
$raw=file_get_contents('php://input');$body=json_decode($raw,true);
if(!is_array($body)||!in_array($body['slotEvent']??'', ['getSettings','update','bet','freespin','slotGamble','gamble5GetUserCards','gamble5GetDealerCard'],true)){http_response_code(400);exit;}
$requestId=$_SERVER['HTTP_X_PILOT_REQUEST_ID']??bin2hex(random_bytes(12));
if(!preg_match('/^[a-zA-Z0-9_-]{1,80}$/',$requestId)){http_response_code(400);exit;}
$GLOBALS['requestId']=$requestId;$GLOBALS['rngTrace']=[];
if(in_array($body['slotEvent'],['bet','freespin','slotGamble'])&&file_exists(RUN.'/state/test-next.json')){
 $fixture=json_decode(file_get_contents(RUN.'/state/test-next.json'),true);unlink(RUN.'/state/test-next.json');
 $GLOBALS['testOutcome']=$fixture['outcome'];
}
Store::init();Store::seed();Store::$db->exec('BEGIN IMMEDIATE');
$q=Store::$db->prepare('SELECT body,response FROM responses WHERE id=?');$q->execute([$requestId]);$cached=$q->fetch(PDO::FETCH_ASSOC);
if($cached){Store::$db->exec('ROLLBACK');if($cached['body']!==$raw){http_response_code(409);exit;}header('Content-Type: application/json');echo $cached['response'];exit;}
register_shutdown_function(function(){try{Store::$db->exec('ROLLBACK');}catch(Throwable $e){} });
$_SERVER['DOCUMENT_ROOT']=dirname(dirname($client));
require APP.'/Lib/Banker.php';
require APP.'/Games/LuckyLadysCharmDX/GameReel.php';
require APP.'/Games/LuckyLadysCharmDX/SlotSettings.php';
require APP.'/Games/LuckyLadysCharmDX/Server.php';
header('Content-Type: application/json');
ob_start();
try {
 (new \VanguardLTE\Games\LuckyLadysCharmDX\Server())->get(null,'LuckyLadysCharmDX');
 $response=ob_get_clean();$parsed=json_decode($response,true);
 if(!$parsed)throw new RuntimeException('Backend returned invalid JSON; inspect local error log');
 $q=Store::$db->prepare('INSERT INTO responses VALUES(?,?,?)');$q->execute([$requestId,$raw,$response]);
 Store::$db->exec('COMMIT');
 file_put_contents(RUN.'/logs/protocol.jsonl',json_encode(['id'=>$requestId,'request'=>$body,'response'=>$parsed,'testOnlyOutcome'=>$GLOBALS['testOutcome']??null,'rng'=>$GLOBALS['rngTrace']])."\n",FILE_APPEND);
 echo $response;
}catch(Throwable $e){if(ob_get_level())ob_end_clean();Store::$db->exec('ROLLBACK');http_response_code(500);error_log((string)$e);echo json_encode(['error'=>$e->getMessage()]);}
