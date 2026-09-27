<?php
// Disposable local framework/database boundary. Game mathematics is never implemented here.
namespace {
const RUN = 'C:/Users/Admin/orca/research/game-pack-forensics/runtime/LuckyLadysCharmDX';
const APP = 'C:/Users/Admin/orca/research/game-pack-forensics/external/evidence/taxipult-goldsvet/casino/app';
function base_path(){return dirname(APP);}
function storage_path($p=''){return RUN.'/'.$p;}
class Auth {static function id(){return 1;}}
class Lang {static function get($key){return json_decode(file_get_contents(RUN.'/fixtures/language.json'),true);}}
class DB {static function transaction($fn,$attempts=1){return $fn();}}
class Store {
 static $db;
 static function init(){
  self::$db=new \PDO('sqlite:'.RUN.'/state/pilot.sqlite');
  self::$db->setAttribute(\PDO::ATTR_ERRMODE,\PDO::ERRMODE_EXCEPTION);
  self::$db->exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records(kind TEXT,id INTEGER,data TEXT,PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS ledger(id INTEGER PRIMARY KEY,request_id TEXT,delta REAL,before_balance REAL,after_balance REAL); CREATE TABLE IF NOT EXISTS responses(id TEXT PRIMARY KEY,body TEXT,response TEXT);');
 }
 static function save($kind,$id,$data){$q=self::$db->prepare('INSERT OR REPLACE INTO records VALUES(?,?,?)');$q->execute([$kind,$id,json_encode($data)]);}
 static function rows($kind){$q=self::$db->prepare('SELECT data FROM records WHERE kind=? ORDER BY id');$q->execute([$kind]);return array_map(fn($x)=>json_decode($x,true),$q->fetchAll(\PDO::FETCH_COLUMN));}
 static function seed(){
  if(self::rows('User'))return;
  $c=json_decode(file_get_contents(RUN.'/fixtures/config.json'),true);
  self::save('User',1,['id'=>1,'shop_id'=>1,'balance'=>1000,'count_balance'=>1000,'address'=>0,'is_blocked'=>0,'status'=>'Active','session'=>serialize([])]);
  self::save('Shop',1,array_merge($c['shop'],['id'=>1,'is_blocked'=>0,'progress_active'=>0]));
  self::save('Game',1,array_merge($c['game'],['id'=>1,'shop_id'=>1,'view'=>1,'game_bank'=>true,'stat_in'=>0,'stat_out'=>0,'bids'=>0,'advanced'=>serialize([])]));
  self::save('GameBank',1,['id'=>1,'shop_id'=>1,'slots'=>100000,'bonus'=>100000,'table_bank'=>0,'little'=>0]);
  self::save('FishBank',1,['id'=>1,'shop_id'=>1,'fish'=>0]);
 }
}
}
namespace Carbon {class Carbon {static function now(){return date('Y-m-d H:i:s');}}}
namespace VanguardLTE\Support\Enum {class UserStatus {const BANNED='Banned';}}
namespace VanguardLTE {
require RUN.'/php-shim/real-methods.php';
class Query {
 private $cls,$where;
 function __construct($cls,$where=[]){$this->cls=$cls;$this->where=$where;}
 function lockForUpdate(){return $this;}
 function find($id){$this->where['id']=$id;return $this->first();}
 function get(){ $c=$this->cls; $kind=substr(strrchr($c,'\\'),1);$out=[];foreach(\Store::rows($kind) as $r){$ok=true;foreach($this->where as $k=>$v)if(($r[$k]??null)!=$v)$ok=false;if($ok)$out[]=new $c($r);}return $out;}
 function first(){return $this->get()[0]??null;}
 function delete(){throw new \RuntimeException('Unexpected session deletion');}
}
class Model implements \JsonSerializable {
 protected $a;
 function __construct($a){$this->a=$a;}
 function __get($k){if($k==='shop')return Shop::find($this->a['shop_id']);return $this->a[$k]??null;}
 function __set($k,$v){$this->a[$k]=$v;}
 function __isset($k){return isset($this->a[$k]);}
 function jsonSerialize():mixed{return $this->a;}
 static function where($k,$v=null){return new Query(static::class,is_array($k)?$k:[$k=>$v]);}
 static function lockForUpdate(){return new Query(static::class);}
 static function find($id){return (new Query(static::class))->find($id);}
 static function create($a){$kind=substr(strrchr(static::class,'\\'),1);$rows=\Store::rows($kind);$a['id']=count($rows)+1;$o=new static($a);$o->save();return $o;}
 function save(){\Store::save(substr(strrchr(static::class,'\\'),1),$this->a['id'],$this->a);return $this;}
 function update($a){$this->a=array_merge($this->a,$a);return $this->save();}
 function increment($key,$v=1){$before=$this->a[$key]??0;$this->a[$key]=$before+$v;
  if($this instanceof User && $key==='balance'){$q=\Store::$db->prepare('INSERT INTO ledger(request_id,delta,before_balance,after_balance) VALUES(?,?,?,?)');$q->execute([$GLOBALS['requestId'],$v,$before,$this->a[$key]]);}
  return $this->save();}
 function decrement($key,$v=1){return $this->increment($key,-$v);}
 function refresh(){return $this;}
}
class User extends Model {use RealUserMethods; function update_level($type,$sum){return false;}}
class Game extends Model {use RealGameMethods; function tournament_stat(...$args){/* no tournaments in this disposable shop */}}
class Shop extends Model {}
class GameBank extends Model {}
class FishBank extends Model {}
class JPG extends Model {}
class Session extends Model {}
class GameLog extends Model {}
class StatGame extends Model {}
}
namespace VanguardLTE\Games\LuckyLadysCharmDX {
// Trace original RNG calls while delegating unchanged to PHP's native implementation.
function trace_rng($name,$args){$b=debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS,3);$GLOBALS['rngTrace'][]=[$name,$args,$b[1]['line']??0,$b[2]['function']??''];}
function rand(...$args){
 trace_rng('rand',$args);
 // Offline, one-request fixture only; never selected by an HTTP field or normal play.
 $test=$GLOBALS['testOutcome']??null;$at=debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS,1)[0];
 $line=$at['line'];$file=basename($at['file']);$pick=null;
 if($test && $file==='SlotSettings.php' && $line===1070)$pick=$test==='bonus'?1:2;
 if($test && $file==='SlotSettings.php' && $line===1071)$pick=$test==='win'?1:2;
 if($test && $file==='SlotSettings.php' && $line===1167)$pick=2;
 if($test && $file==='Server.php' && $line===214)$pick=$test==='gamble-win'?1:2;
 if($pick!==null){if($pick<$args[0]||$pick>$args[1])throw new \RuntimeException('Fixture draw outside original range');return $pick;}
 return \rand(...$args);
}
function mt_rand(...$args){trace_rng('mt_rand',$args);return \mt_rand(...$args);}
function shuffle(&$a){trace_rng('shuffle',[count($a)]);return \shuffle($a);}
}
