import {clamp,distance,findPath,lineOfSight,moveActor,pointWalkable} from './geometry.js';
import {ENEMY_TYPES,factionsHostile} from './enemies.js';

// Security and corporate machines share a side. Infection is a third side:
// crossfire and noise remain useful even when the player never fires a shot.
const corporate=faction=>faction==='security'||faction==='machine';
export {factionsHostile};
const alive=actor=>actor&&actor.hp>0&&!actor.dead&&!actor.disabled;
const angularDistance=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
const angleTo=(a,b)=>Math.atan2(b.y-a.y,b.x-a.x);
let sequence=0;

function hash(value){
 let n=2166136261;for(const character of String(value))n=Math.imul(n^character.charCodeAt(0),16777619);
 return (n>>>0)/4294967296;
}

function init(enemy,def){
 if(enemy.ai)return enemy.ai;
 enemy.id??='ai-'+(++sequence);enemy.faction??=def.faction;enemy.r??=def.r||16;
 enemy.angle??=0;enemy.state??='patrol';enemy.awareness??=0;
 enemy.ammo??=magazine(enemy.type);enemy.cooldown??=.6+hash(enemy.id)*.65;
 const ai=enemy.ai={
  perceptionTimer:hash(enemy.id)*.24,pathTimer:hash(enemy.id)*.7,path:[],pathIndex:0,
  lastKnown:null,target:null,visible:false,memory:0,patrolIndex:0,
  age:0,alertAge:0,spawnGrace:.55,searchTime:0,action:null,actionTime:0,
  actionTarget:null,meleeCooldown:0,specialCooldown:2+hash(enemy.id)*2,
  radioCalls:Number.isFinite(enemy.radioCalls)?clamp(Math.floor(enemy.radioCalls),0,2):0,
  healCharges:Number.isInteger(enemy.healCharges)?clamp(enemy.healCharges,0,2):2,healCooldown:0,damageSinceAction:0,
  lastHp:enemy.hp,flankSide:hash(enemy.id)>.5?1:-1,volley:0,
  moveTarget:null,stuck:0,lastX:enemy.x,lastY:enemy.y,shoutCooldown:0
 };
 return ai;
}

function magazine(type){
 return ENEMY_TYPES[type]?.ammo||8;
}

function viewDistance(g,e,def,target){
 let result=def.vision||600;
 if(g.level.blackout&&e.faction!=='infected'&&e.type!=='drone')result*=.68;
 if(target===g.player){
  if(target.stance==='crouch')result*=.73;
  if(target.coverId&&!(target.exposure||target.exposed>0))result*=.73;
 }
 return result;
}

function sees(g,e,target,def){
 if(!alive(target))return false;
 const d=distance(e,target),vision=viewDistance(g,e,def,target);
 if(d>vision)return false;
 // A close silhouette is visible even behind the patrol's normal field of view.
 if(e.faction==='security'&&e.awareness<.65&&d>125&&angularDistance(e.angle,angleTo(e,target))>Math.PI*.58)return false;
 return g.hasSight?g.hasSight(e,target):lineOfSight(e,target,g.level);
}

function candidates(g,e){
 const result=[];
 if(alive(g.player)&&factionsHostile(e.faction,'player'))result.push(g.player);
 for(const actor of g.enemies||[])if(actor!==e&&alive(actor)&&factionsHostile(e.faction,actor.faction))result.push(actor);
 // Rescued people have no gun, but armoured guards may threaten an escort.
 for(const actor of g.friendlies||[])if(alive(actor)&&actor.targetable!==false&&factionsHostile(e.faction,actor.faction||'player'))result.push(actor);
 return result;
}

function soundHeard(g,e,def){
 let best=null,bestPriority=0;
 for(const sound of g.sounds||[]){
  if(sound.life!==undefined&&sound.life<=0)continue;
  if(sound.faction&&sound.faction!=='neutral'&&!factionsHostile(e.faction,sound.faction))continue;
  const hearingScale=clamp((def.hearing||550)/550,.4,1.7);
  const radius=(sound.radius||sound.r||0)*hearingScale,d=distance(e,sound);
  if(!radius||d>radius)continue;
  const priority=radius/(d+110);
  if(priority>bestPriority){bestPriority=priority;best=sound;}
 }
 return best;
}

function perceive(g,e,def,elapsed){
 const ai=e.ai;let visible=null,best=Infinity;
 for(const target of candidates(g,e)){
  const d=distance(e,target);
  if(d<best&&sees(g,e,target,def)){visible=target;best=d;}
 }
 ai.visible=!!visible;
 if(visible){
  const close=best<160,already=ai.memory>0&&ai.target===visible;
  e.awareness=clamp(e.awareness+elapsed*(close||already?3.5:e.faction==='infected'?2.4:1.7),0,1);
  if(e.awareness>=.55||close){
   ai.target=visible;ai.lastKnown={x:visible.x,y:visible.y};ai.memory=e.faction==='infected'?7:9;
   e.targetId=visible===g.player?'player':visible.id;
   if(e.state==='patrol'||e.state==='search'||e.state==='suspicious'){
    e.state='engage';ai.pathTimer=0;
    if(ai.shoutCooldown<=0&&e.faction==='security'){
     ai.shoutCooldown=9;
     g.spawnEffect?.('alert',e.x,e.y,{text:'发现目标',color:'#ffb866',life:.8});
    }
   }
  }else{
   e.state='suspicious';ai.lastKnown={x:visible.x,y:visible.y};
  }
 }else{
  e.awareness=Math.max(0,e.awareness-elapsed*.09);
  const sound=soundHeard(g,e,def);
  if(sound){
   // Hearing reveals the source of a sound, never the player's new position.
   ai.lastKnown={x:sound.x,y:sound.y};ai.memory=Math.max(ai.memory,4.5);
   if(e.state==='patrol')e.state='suspicious';
   e.awareness=Math.max(e.awareness,.28);
  }
  if(ai.target&&!alive(ai.target)){ai.target=null;e.targetId=null;}
 }
}

function move(g,e,dx,dy,ignoreCovers=false){
 if(ignoreCovers)return moveActor(e,dx,dy,g.level,{ignoreCovers:true});
 if(g.moveEnemy){const x=e.x,y=e.y;g.moveEnemy(e,dx,dy);return distance(e,{x,y})>.01;}
 return moveActor(e,dx,dy,g.level);
}

function navigate(g,e,destination,speed,dt,context,options={}){
 const ai=e.ai;if(!destination||!Number.isFinite(destination.x)||!Number.isFinite(destination.y))return false;
 if(distance(e,destination)<(options.stop||20))return false;
 const changed=!ai.moveTarget||distance(ai.moveTarget,destination)>100;
 if((ai.pathTimer<=0||changed)&&context.pathBudget>0){
  context.pathBudget--;
  ai.path=findPath(e,destination,g.level,e.r||16,{ignoreCovers:options.ignoreCovers||false});
  ai.pathIndex=0;ai.pathTimer=.68+hash(e.id)*.62;ai.moveTarget={x:destination.x,y:destination.y};
 }
 let target=ai.path[ai.pathIndex];
 while(target&&distance(e,target)<24){ai.pathIndex++;target=ai.path[ai.pathIndex];}
 target??=destination;
 const d=distance(e,target);if(d<1)return false;
 const step=Math.min(d,speed*dt),dx=(target.x-e.x)/d*step,dy=(target.y-e.y)/d*step;
 const moved=move(g,e,dx,dy,options.ignoreCovers);
 if(!ai.visible&&!ai.action)e.angle=angleTo(e,target);
 if(!moved)ai.stuck+=dt;else ai.stuck=Math.max(0,ai.stuck-dt*2);
 if(ai.stuck>.5){ai.pathTimer=0;ai.stuck=0;}
 return moved;
}

function beginAction(e,type,duration,target){
 const ai=e.ai;ai.action=type;ai.actionTime=duration;ai.actionTarget=target?{x:target.x,y:target.y,actor:target}:null;
 ai.damageSinceAction=0;e.state=type;
 e.telegraph={type,x:target?.x??e.x,y:target?.y??e.y,angle:target?angleTo(e,target):e.angle,life:duration,maxLife:duration};
}

function finishAction(e){
 const ai=e.ai;ai.action=null;ai.actionTime=0;ai.actionTarget=null;e.telegraph=null;
 e.state=e.reloadTime>0?'reload':ai.memory>0?'engage':'search';
}

function aimAndFire(g,e,target,def,options={}){
 if(e.cooldown>0||e.reloadTime>0||e.ai.spawnGrace>0)return false;
 if(e.ammo<=0){startReload(e);return false;}
 const targetAngle=angleTo(e,target);
 if(def.turnSpeed&&angularDistance(e.angle,targetAngle)>.24)return false;
 if(!def.turnSpeed)e.angle=targetAngle;e.ammo--;
 e.cooldown=options.cooldown??def.fireRate??.6;
 g.fireEnemy?.(e,target,{spread:options.spread??.055,damage:options.damage??def.damage??7,speed:options.speed??650,range:options.range??def.range??550,...options});
 if(e.ammo<=0)startReload(e);
 return true;
}

function startReload(e){
 if(e.reloadTime>0)return;
 e.reloadTime=ENEMY_TYPES[e.type]?.reload||1.9;
 e.state='reload';e.ai.volley=0;
}

function nearestCover(g,e,threat){
 let best=null,bestScore=Infinity;
 for(const cover of g.level.covers||[]){
  if(cover.active===false||cover.hp<=0)continue;
  const center={x:cover.x+cover.w/2,y:cover.y+cover.h/2};
  const d=distance(e,center);if(d>360)continue;
  const away=angleTo(threat,center),padding=(e.r||16)+22;
  const destination={x:center.x+Math.cos(away)*(cover.w/2+padding),y:center.y+Math.sin(away)*(cover.h/2+padding)};
  if(!pointWalkable(destination,g.level,e.r||16))continue;
  const score=d+distance(destination,threat)*.08;
  if(score<bestScore){bestScore=score;best=destination;}
 }
 return best;
}

function broadcast(g,e,point){
 for(const ally of g.enemies){
  if(ally===e||!alive(ally)||!corporate(ally.faction)||distance(e,ally)>1100)continue;
  const ai=init(ally,ENEMY_TYPES[ally.type]||{});
  ai.lastKnown={x:point.x,y:point.y};ai.memory=Math.max(ai.memory,6);ally.awareness=Math.max(ally.awareness,.65);
  if(ally.state==='patrol')ally.state='search';
 }
}

function callReinforcements(g,e){
 const ai=e.ai;ai.radioCalls++;
 if(ai.lastKnown)broadcast(g,e,ai.lastKnown);
 g.spawnEffect?.('radio',e.x,e.y,{text:'无线电支援',life:1.5,color:'#ffbd65'});
 g.toast?.('安保已完成通报：邻近小队开始搜索。');
 const director=g.aiDirector??={reinforcements:0};
 if(!Number.isFinite(director.reinforcementBudget))director.reinforcementBudget=Math.max(0,2-(director.reinforcements||0));
 if(director.reinforcementBudget<=0||(g.enemies||[]).filter(alive).length>65)return;
 // Arrivals use a distant, originally occupied entry. Never materialise on the player.
 const arrivals=(g.level.enemies||[]).filter(spawn=>ENEMY_TYPES[spawn.type]?.faction!=='infected'&&distance(spawn,g.player)>650);
 const arrival=arrivals.sort((a,b)=>distance(a,e)-distance(b,e))[0];
 if(!arrival||!pointWalkable(arrival,g.level,16))return;
 director.reinforcementBudget--;director.reinforcements=(director.reinforcements||0)+1;
 const count=2;
 for(let i=0;i<count;i++){
  const point={x:arrival.x+i*42,y:arrival.y};if(!pointWalkable(point,g.level,16))continue;
  const reinforcement=g.spawnEnemy?.({type:i?'patrol':'assault',...point});
  if(reinforcement){
   const a=init(reinforcement,ENEMY_TYPES[reinforcement.type]||{});a.lastKnown={...ai.lastKnown};a.memory=7;reinforcement.state='search';
  }
 }
}

function updateAction(g,e,def,dt,context){
 const ai=e.ai;if(!ai.action)return false;
 ai.actionTime-=dt;
 if(e.telegraph)e.telegraph.life=Math.max(0,ai.actionTime);
 const action=ai.action,point=ai.actionTarget,actor=point?.actor;
 if(action==='heal'){
  if(!alive(actor)||distance(e,actor)>100||ai.damageSinceAction>5||e.suppression>.6){ai.healCooldown=2;finishAction(e);return true;}
  if(ai.actionTime<=0){actor.hp=Math.min(actor.maxHp||actor.hp+24,actor.hp+24);ai.healCharges--;ai.healCooldown=8;g.spawnEffect?.('heal',actor.x,actor.y,{life:1,color:'#7be5b8'});finishAction(e);}
  return true;
 }
 if(action==='calling'){
  if(ai.damageSinceAction>7||e.suppression>.65){ai.specialCooldown=4;finishAction(e);return true;}
  if(ai.actionTime<=0){callReinforcements(g,e);ai.specialCooldown=12;finishAction(e);}
  return true;
 }
 if(action==='sniperAim'){
  // The aim point freezes for the last 0.35 seconds, leaving a readable dodge window.
  if(ai.actionTime>.35&&alive(actor)&&sees(g,e,actor,def)){point.x=actor.x;point.y=actor.y;e.angle=angleTo(e,point);if(e.telegraph){e.telegraph.x=point.x;e.telegraph.y=point.y;e.telegraph.angle=e.angle;}}
  if(ai.actionTime<=0){
   if(g.hasSight?.(e,point)??lineOfSight(e,point,g.level))aimAndFire(g,e,point,def,{spread:.008,speed:950,cooldown:2.5});
   finishAction(e);
  }
  return true;
 }
 if(action==='spitAim'){
  if(ai.actionTime<=0){
   e.angle=angleTo(e,point);g.fireEnemy?.(e,point,{projectile:'acid',speed:260,damage:def.damage||12,spread:.012,range:650,life:2.6,r:7});
   g.audio?.sfx('spit');ai.specialCooldown=3.2;finishAction(e);
  }
  return true;
 }
 if(action==='meleeWindup'){
  if(ai.actionTime<=0){
   if(alive(actor)&&distance(e,actor)<(e.r||16)+(actor.r||15)+26&&sees(g,e,actor,def))g.damageActor?.(actor,def.damage||9,e);
   ai.meleeCooldown=e.type==='brute'?1.65:1.05;g.spawnEffect?.('swipe',e.x,e.y,{angle:e.angle,life:.22});finishAction(e);
  }
  return true;
 }
 if(action==='runnerWindup'||action==='bruteWindup'||action==='climbWindup'){
  if(ai.actionTime<=0){
   const direction=angleTo(e,point);ai.chargeDirection={x:Math.cos(direction),y:Math.sin(direction)};e.angle=direction;
   ai.action=action==='climbWindup'?'vault':'charge';ai.actionTime=e.type==='brute'?.8:action==='climbWindup'?.48:.5;
   ai.chargeHit=false;e.telegraph=null;e.vaulting=action==='climbWindup'?.5:0;
  }
  return true;
 }
 if(action==='charge'||action==='vault'){
  const speed=action==='vault'?380:e.type==='brute'?400:540;
  const moved=move(g,e,ai.chargeDirection.x*speed*dt,ai.chargeDirection.y*speed*dt,action==='vault'?'low':false);
  if(action==='charge'&&!ai.chargeHit){
   for(const target of candidates(g,e))if(distance(e,target)<(e.r||16)+(target.r||15)+10){g.damageActor?.(target,def.damage||12,e);ai.chargeHit=true;break;}
  }
  if(ai.actionTime<=0||!moved){
   ai.specialCooldown=e.type==='brute'?6:e.type==='climber'?3.7:4.3;e.vaulting=0;
   ai.action='recover';ai.actionTime=e.type==='brute'?.65:.4;e.state='recover';
   g.spawnEffect?.('dust',e.x,e.y,{life:.35});
  }
  return true;
 }
 if(action==='heavySpin'){
  if(ai.actionTime<=0){ai.volley=6;finishAction(e);}
  return true;
 }
 if(action==='turretAim'){
  if(ai.actionTime<=0){ai.volley=3;finishAction(e);}
  return true;
 }
 if(action==='commanderAim'){
  if(ai.actionTime<=0){ai.volley=3;finishAction(e);}
  return true;
 }
 if(action==='recover'){
  if(ai.actionTime<=0)finishAction(e);
  return true;
 }
 if(ai.actionTime<=0)finishAction(e);
 return true;
}

function infected(g,e,target,def,dt,context){
 const ai=e.ai,speed=def.speed||85;
 if(!ai.visible){
  if(ai.lastKnown){e.angle=angleTo(e,ai.lastKnown);navigate(g,e,ai.lastKnown,speed,dt,context,{stop:25});}
  return;
 }
 const d=distance(e,target);e.angle=angleTo(e,target);
 if(e.type==='spitter'){
  if(ai.specialCooldown<=0&&d<Math.min(def.range||500,520)&&ai.visible){beginAction(e,'spitAim',.85,target);return;}
  if(d<220){const angle=angleTo(target,e),destination={x:e.x+Math.cos(angle)*150,y:e.y+Math.sin(angle)*150};navigate(g,e,destination,speed,dt,context);}
  else if(d>340)navigate(g,e,target,speed,dt,context);
  return;
 }
 if((e.type==='runner'||e.type==='brute')&&ai.specialCooldown<=0&&ai.visible&&d>95&&d<(e.type==='brute'?440:470)){
  beginAction(e,e.type==='brute'?'bruteWindup':'runnerWindup',e.type==='brute'?1.05:.65,target);return;
 }
 if(e.type==='climber'&&ai.specialCooldown<=0&&d>80){
  const cover=(g.level.covers||[]).find(c=>c.low&&c.active!==false&&c.hp!==0&&distance(e,{x:c.x+c.w/2,y:c.y+c.h/2})<140);
  if(cover&&ai.visible){beginAction(e,'climbWindup',.35,target);return;}
 }
 if(d<(e.r||16)+(target.r||15)+20&&ai.meleeCooldown<=0&&ai.visible){beginAction(e,'meleeWindup',e.type==='brute'?.55:.3,target);return;}
 navigate(g,e,ai.visible?target:ai.lastKnown,speed,dt,context,{stop:(e.r||16)+(target.r||15)+6,ignoreCovers:false});
}

function supportBehaviour(g,e,def,dt,context){
 const ai=e.ai;
 if(e.type==='radio'&&ai.visible&&ai.radioCalls<1&&ai.specialCooldown<=0&&ai.alertAge>1){beginAction(e,'calling',2.1,ai.target);return true;}
 if(e.type!=='medic'||ai.healCharges<=0||ai.healCooldown>0)return false;
 const wounded=(g.enemies||[]).filter(a=>a!==e&&alive(a)&&corporate(a.faction)&&a.hp<(a.maxHp||a.hp)*.68&&distance(a,e)<460&&g.hasSight?.(e,a));
 const ally=wounded.sort((a,b)=>a.hp/(a.maxHp||1)-b.hp/(b.maxHp||1))[0];
 if(!ally)return false;
 if(ai.visible&&distance(e,ai.target)<220)return false;
 if(distance(e,ally)<65)beginAction(e,'heal',1.9,ally);
 else navigate(g,e,ally,(def.speed||95)*.9,dt,context,{stop:52});
 return true;
}

function security(g,e,target,def,dt,context){
 const ai=e.ai,d=distance(e,target),speed=(def.speed||95)*(e.suppression>.5?.62:1);
 const desiredAngle=angleTo(e,ai.visible?target:ai.lastKnown||e);
 const delta=Math.atan2(Math.sin(desiredAngle-e.angle),Math.cos(desiredAngle-e.angle));
 e.angle+=clamp(delta,-(def.turnSpeed||7)*dt,(def.turnSpeed||7)*dt);
 if(supportBehaviour(g,e,def,dt,context))return;
 if(e.reloadTime>0){
  const cover=nearestCover(g,e,target);if(cover&&e.type!=='turret')navigate(g,e,cover,speed*.7,dt,context,{stop:28});
  return;
 }
 if(!ai.visible){if(e.type!=='turret')navigate(g,e,ai.lastKnown,speed,dt,context);return;}
 if(e.type==='sniper'){
  if(e.cooldown<=0&&d<(def.range||1000)&&ai.spawnGrace<=0){beginAction(e,'sniperAim',1.15,target);return;}
  if(d<310){const away=angleTo(target,e);navigate(g,e,{x:e.x+Math.cos(away)*180,y:e.y+Math.sin(away)*180},speed*.8,dt,context);}
  else if(d>(def.range||900)*.85)navigate(g,e,target,speed,dt,context,{stop:580});
  return;
 }
 if(e.type==='turret'){
  if(e.cooldown<=0&&d<(def.range||650)&&ai.spawnGrace<=0){
   if(ai.volley>0){if(aimAndFire(g,e,target,def,{cooldown:.22,spread:.05}))ai.volley--;}
   else beginAction(e,'turretAim',.65,target);
  }
  return;
 }
 if(e.type==='commander'){
  if(d<(def.range||800)&&e.cooldown<=0&&ai.spawnGrace<=0){
   if(ai.volley>0){
    if(aimAndFire(g,e,target,def,{cooldown:.16,spread:.035}))ai.volley--;
    if(ai.volley<=0){e.cooldown=1.1;ai.specialCooldown=1.8;ai.flankSide*=-1;}
   }else if(ai.specialCooldown<=0)beginAction(e,'commanderAim',.48,target);
  }
  if(ai.specialCooldown>0||d>600){
   const angle=angleTo(target,e)+ai.flankSide*.65;
   const destination={x:target.x+Math.cos(angle)*390,y:target.y+Math.sin(angle)*390};
   navigate(g,e,pointWalkable(destination,g.level,e.r||16)?destination:target,speed,dt,context,{stop:35});
  }
  return;
 }
 if(e.type==='heavy'||e.type==='warden'){
  if(d<(def.range||620)&&e.cooldown<=0&&ai.spawnGrace<=0){
   if(ai.volley>0){if(aimAndFire(g,e,target,def,{cooldown:e.type==='warden'?.22:.17,spread:e.type==='warden'?.045:.085}))ai.volley--;if(ai.volley<=0)e.cooldown=e.type==='warden'?1.65:1.1;}
   else beginAction(e,'heavySpin',e.type==='warden'?1.25:.9,target);
  }
  if(d>430)navigate(g,e,target,speed*.65,dt,context,{stop:380});
  return;
 }
 if(e.type==='drone'){
  const orbit=angleTo(target,e)+ai.flankSide*.65;
  const destination={x:target.x+Math.cos(orbit)*280,y:target.y+Math.sin(orbit)*280};
  navigate(g,e,destination,speed,dt,context,{stop:35,ignoreCovers:true});
  if(d<(def.range||500))aimAndFire(g,e,target,def,{spread:.08,speed:570});
  return;
 }
 const preferred=e.type==='shield'?190:e.type==='assault'?285:e.type==='medic'||e.type==='radio'?410:340;
 if(e.suppression>.55&&e.type!=='shield'){
  const cover=nearestCover(g,e,target);if(cover)navigate(g,e,cover,speed*.8,dt,context,{stop:25});
 }else if(d>preferred+70){
  const allies=(g.enemies||[]).filter(a=>a!==e&&alive(a)&&corporate(a.faction)&&a.ai?.visible&&distance(a,e)<750);
  if(e.type==='assault'&&allies.length&&d<700){
   const angle=angleTo(target,e)+ai.flankSide*.8;
   const flank={x:target.x+Math.cos(angle)*preferred,y:target.y+Math.sin(angle)*preferred};
   navigate(g,e,pointWalkable(flank,g.level,e.r||16)?flank:target,speed,dt,context,{stop:35});
  }else navigate(g,e,target,speed,dt,context,{stop:preferred});
 }else if(d<preferred*.55&&e.type!=='shield'){
  const away=angleTo(target,e);navigate(g,e,{x:e.x+Math.cos(away)*95,y:e.y+Math.sin(away)*95},speed*.7,dt,context);
 }
 if(d<(def.range||560)&&ai.alertAge>.35&&e.suppression<.92)aimAndFire(g,e,target,def,{spread:e.type==='shield'?.11:e.type==='assault'?.085:.07});
}

function idle(g,e,def,dt,context){
 const ai=e.ai;
 if(supportBehaviour(g,e,def,dt,context))return;
 if(ai.lastKnown&&ai.memory>0){
  e.state='search';e.angle=angleTo(e,ai.lastKnown);
  if(distance(e,ai.lastKnown)>35){if(e.type!=='turret')navigate(g,e,ai.lastKnown,(def.speed||90)*.72,dt,context,{stop:25});}
  else {ai.searchTime+=dt;e.angle+=Math.sin(ai.age*1.5)*dt*.8;if(ai.searchTime>3.5){ai.memory=0;ai.lastKnown=null;ai.searchTime=0;}}
  return;
 }
 ai.target=null;ai.lastKnown=null;ai.alertAge=0;e.targetId=null;
 if(e.awareness>.12){e.state='suspicious';e.angle+=Math.sin(ai.age*.9)*dt*.4;return;}
 e.state='patrol';
 const patrol=e.patrol||[];
 if(!patrol.length||e.type==='turret'){e.angle+=Math.sin(ai.age*.45)*dt*.12;return;}
 const destination=patrol[ai.patrolIndex%patrol.length];
 if(distance(e,destination)<30){ai.patrolIndex=(ai.patrolIndex+1)%patrol.length;ai.pathTimer=0;}
 else navigate(g,e,destination,(def.speed||85)*.48,dt,context,{stop:20});
}

export function updateEnemies(g,dt){
 if(!g?.level||!g.player||!Array.isArray(g.enemies)||!Number.isFinite(dt)||dt<=0)return;
 dt=Math.min(dt,.05);
 const context={pathBudget:2};
 for(const e of [...g.enemies]){
  if(!alive(e))continue;
  const def=ENEMY_TYPES[e.type]||ENEMY_TYPES.patrol||{},ai=init(e,def);
  ai.age+=dt;ai.spawnGrace=Math.max(0,ai.spawnGrace-dt);ai.perceptionTimer-=dt;ai.pathTimer-=dt;
  ai.specialCooldown=Math.max(0,ai.specialCooldown-dt);ai.meleeCooldown=Math.max(0,ai.meleeCooldown-dt);
  ai.healCooldown=Math.max(0,ai.healCooldown-dt);ai.shoutCooldown=Math.max(0,ai.shoutCooldown-dt);
  ai.memory=Math.max(0,ai.memory-dt);e.cooldown=Math.max(0,(e.cooldown||0)-dt);
  e.suppression=Math.max(0,(e.suppression||0)-dt*.22);
  const damage=Math.max(0,ai.lastHp-e.hp);ai.damageSinceAction+=damage;ai.lastHp=e.hp;
  if(damage>0){
   e.awareness=Math.max(e.awareness,.65);
   if(!ai.lastKnown){const source=e.lastDamageSource;if(source&&Number.isFinite(source.x)&&Number.isFinite(source.y)){ai.lastKnown={x:source.x,y:source.y};ai.memory=5;}}
  }
  if(e.reloadTime>0){e.reloadTime=Math.max(0,e.reloadTime-dt);if(e.reloadTime===0){e.ammo=magazine(e.type);e.state=ai.memory>0?'engage':'search';}}
  const stun=Math.max(e.stunTime||0,e.stunned||0);
  if(stun>0){
   e.stunTime=Math.max(0,stun-dt);e.stunned=e.stunTime;
   if(ai.action){finishAction(e);ai.volley=0;e.cooldown=Math.max(e.cooldown,.55);}
   e.state='stunned';continue;
  }
  // Sleeping distant patrols still react to loud sounds at a lower frequency.
  const distant=distance(e,g.player)>1700&&!ai.memory&&!ai.action;
  if(ai.perceptionTimer<=0){
   const period=distant?.55:.18+hash(e.id)*.1;
   perceive(g,e,def,period);ai.perceptionTimer=period;
  }
  if(ai.visible&&ai.target&&alive(ai.target))ai.alertAge+=dt;
  if(updateAction(g,e,def,dt,context))continue;
  if(distant&&!ai.memory&&e.type!=='medic')continue;
  const target=ai.target;
  if(alive(target)&&ai.memory>0){
   if(e.faction==='infected')infected(g,e,target,def,dt,context);
   else security(g,e,target,def,dt,context);
  }else idle(g,e,def,dt,context);
 }
}
