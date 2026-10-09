<?php
// Phase/presentation persistence only. Original game handlers own all outcomes and money.
class Recovery {
 static function session(){return unserialize(Store::rows('User')[0]['session'],['allowed_classes'=>false])?:[];}
 static function value($s,$key){return $s['LuckyLadysCharmDX'.$key]['payload']??0;}
 static function load(){
  $rows=Store::rows('Recovery');if($rows)return isset($rows[0]['nativeState'])?$rows[0]:self::sync($rows[0]);
  $r=['id'=>1,'schema'=>1,'version'=>0,'roundId'=>null,'phase'=>'IDLE','bet'=>null,'result'=>null,
      'pendingWin'=>0,'gamble'=>['attempts'=>0,'cards'=>[]],'settlement'=>['credited'=>true,'collected'=>true],
      'free'=>['total'=>0,'current'=>0,'remaining'=>0,'multiplier'=>null],'balance'=>Store::rows('User')[0]['balance']];
  // Conservative migration of pre-recovery disposable state; never replay or credit old outcomes.
  $old=Store::$db->query('SELECT response FROM responses ORDER BY rowid DESC')->fetchAll(PDO::FETCH_COLUMN);
  foreach($old as $json){$p=json_decode($json,true);if(($p['responseEvent']??'')==='spin'){
    $r['result']=$p;$r['roundId']='legacy-'.bin2hex(random_bytes(8));break;
  }}
  $s=self::session();$r=self::sync($r);
  if($r['free']['remaining']>0)$r['phase']='FREE_SPINS';
  elseif(self::value($s,'TotalWin')>0)$r['phase']='PENDING_WIN';
  if($r['phase']!=='IDLE'){
    // Legacy requests were retained by the accepted pilot's idempotency table.
    foreach(Store::$db->query('SELECT body FROM responses ORDER BY rowid DESC')->fetchAll(PDO::FETCH_COLUMN) as $json){
      $b=json_decode($json,true);if(($b['slotEvent']??'')==='bet'){$r['bet']=['slotBet'=>$b['slotBet'],'slotLines'=>$b['slotLines']];break;}
    }
    $r['pendingWin']=self::value($s,'TotalWin');$r['settlement']['collected']=false;
  }
  self::save($r);return $r;
 }
 static function save($r){Store::save('Recovery',1,$r);}
 static function sync($r){
  $s=self::session();$r['balance']=Store::rows('User')[0]['balance'];
  $r['nativeState']=[];foreach($s as $key=>$value)if(str_starts_with($key,'LuckyLadysCharmDX'))$r['nativeState'][$key]=$value['payload'];
  $r['free']['total']=(int)self::value($s,'FreeGames');$r['free']['current']=(int)self::value($s,'CurrentFreeGame');
  $r['free']['remaining']=max(0,$r['free']['total']-$r['free']['current']);return $r;
 }
 static function preserveSession($r){
  // Source constructor drops session entries after 24h. Keep the durable round's
  // exact native payloads available; no result generation or financial mutation.
  $u=Store::rows('User')[0];$s=self::session();$changed=false;
  foreach($r['nativeState']??[] as $key=>$payload){
   if(!isset($s[$key])||$s[$key]['timelife']<=time()){$s[$key]=['timelife'=>time()+86400,'payload'=>$payload];$changed=true;}
  }
  if($changed){$u['session']=serialize($s);Store::save('User',1,$u);}
 }
 static function guard($r,$body){
  if(!isset($_SERVER['HTTP_X_PILOT_VERSION'])||!isset($_SERVER['HTTP_X_PILOT_ROUND']))return 'Recovery version and round required';
  if((string)$r['version']!==$_SERVER['HTTP_X_PILOT_VERSION']||($r['roundId']??'none')!==$_SERVER['HTTP_X_PILOT_ROUND'])return 'Stale round or recovery version';
  $e=$body['slotEvent'];$phase=$r['phase'];
  if($e==='bet'&&$phase!=='IDLE')return 'Complete the current feature first';
  if($e==='freespin'){
   if($phase!=='FREE_SPINS'||$r['free']['remaining']<=0)return 'No active free spin';
   if((float)($body['slotBet']??0)!==(float)$r['bet']['slotBet']||(int)($body['slotLines']??0)!==(int)$r['bet']['slotLines'])return 'Free-spin bet is locked';
  }
  if($e==='slotGamble'&&($phase!=='GAMBLE'||!in_array($body['gambleChoice']??'', ['red','black'],true)))return 'Invalid gamble phase or choice';
  if($e==='recoveryGamble'&&($phase!=='PENDING_WIN'||$r['pendingWin']<=0))return 'No pending gamble stake';
  if($e==='recoveryCollect'&&!in_array($phase,['PENDING_WIN','GAMBLE'],true))return 'Nothing to collect';
  if(in_array($e,['gamble5GetUserCards','gamble5GetDealerCard'],true))return 'Inactive gamble variant';
  return null;
 }
 static function action($r,$event){
  if($event==='recoveryGamble')$r['phase']='GAMBLE';
  else {
   // Winnings are already credited by the real backend. Collect only acknowledges presentation.
   $u=Store::rows('User')[0];$s=self::session();
   foreach(['TotalWin','BonusWin','FreeGames','CurrentFreeGame','FreeBalance'] as $key){$s['LuckyLadysCharmDX'.$key]=['timelife'=>time()+86400,'payload'=>0];}
   $u['session']=serialize($s);Store::save('User',1,$u);
   $r['phase']='IDLE';$r['pendingWin']=0;$r['settlement']['collected']=true;$r=self::sync($r);
  }
  $r['version']++;self::save($r);return $r;
 }
 static function result($r,$body,$p){
  if($p['responseEvent']==='spin'){
   if($body['slotEvent']==='bet'){
    $r['roundId']=bin2hex(random_bytes(16));$r['bet']=['slotBet'=>$body['slotBet'],'slotLines'=>$body['slotLines']];
    $r['gamble']=['attempts'=>0,'cards'=>[]];
   }
   $r['result']=$p;$r=self::sync($r);$r['pendingWin']=$p['serverResponse']['totalWin'];
   $r['phase']=$r['free']['remaining']>0?'FREE_SPINS':($r['pendingWin']>0?'PENDING_WIN':'IDLE');
   $r['settlement']=['credited'=>true,'collected'=>$r['phase']==='IDLE'];$r['version']++;
  }elseif($p['responseEvent']==='gambleResult'){
   $g=$p['serverResponse'];$r['pendingWin']=$g['totalWin'];$r['balance']=$g['afterBalance'];
   $r['gamble']['attempts']++;$r['gamble']['cards'][]=$g['dealerCard'];
   $r['gamble']['lastResult']=$g;$r['phase']=$g['totalWin']>0?'GAMBLE':'IDLE';
   $r['settlement']['collected']=$r['phase']==='IDLE';$r['version']++;
   $r=self::sync($r);
  }
  self::save($r);return $r;
 }
}
