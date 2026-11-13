import {test} from 'node:test';
import assert from 'node:assert/strict';
import {updateEnemies,factionsHostile} from '../ai.js';
import {ENEMY_TYPES} from '../enemies.js';
import {lineOfSight,moveActor} from '../geometry.js';

function fixture({walls=[],covers=[],doors=[]}={}){
 const g={
  level:{width:2400,height:1700,walls,covers,doors,enemies:[]},
  player:{x:950,y:400,r:15,hp:100,maxHp:100,stance:'stand'},
  enemies:[],friendlies:[],sounds:[],shots:[],damages:[],effects:[],toasts:[],campaign:{flags:{}},
  aiDirector:{reinforcements:0},
  hasSight(a,b){return lineOfSight(a,b,this.level);},
  moveEnemy(e,dx,dy){return moveActor(e,dx,dy,this.level);},
  fireEnemy(e,target,options){this.shots.push({type:e.type,owner:e,target:{x:target.x,y:target.y},actor:target,options});},
  damageActor(actor,n,source){actor.hp=Math.max(0,actor.hp-n);this.damages.push({actor,n,source});},
  spawnEffect(...args){this.effects.push(args);},
  toast(text){this.toasts.push(text);},
  spawnEnemy(spawn){return this.add(spawn.type,spawn.x,spawn.y,spawn.angle||0);}
 };
 g.add=(type,x,y,angle=0)=>{
  const def=ENEMY_TYPES[type];assert.ok(def,'fixture uses a real enemy definition');
  const e={...def,id:'fixture-'+g.enemies.length,type,x,y,r:def.r,hp:def.hp,maxHp:def.hp,faction:def.faction,angle};
  g.enemies.push(e);return e;
 };
 g.tick=seconds=>{for(let i=0;i<Math.ceil(seconds*60);i++)updateEnemies(g,1/60);};
 g.until=(condition,seconds=10)=>{for(let i=0;i<Math.ceil(seconds*60);i++){updateEnemies(g,1/60);if(condition())return true;}return false;};
 return g;
}

test('security and machines cooperate while both fight infected, and civilians are neutral',()=>{
 assert.equal(factionsHostile('security','machine'),false);
 for(const faction of ['security','machine','player'])assert.equal(factionsHostile(faction,'infected'),true);
 assert.equal(factionsHostile('civilian','security'),false);
 const g=fixture();g.player.x=2250;g.player.y=1600;
 const security=g.add('patrol',500,400),infected=g.add('walker',750,400,Math.PI);
 g.tick(3);
 assert.equal(security.ai.target,infected);
 assert.equal(infected.ai.target,security);
 assert.ok(g.shots.some(shot=>shot.actor===infected),'a guard actually fires at an infected opponent');
});

test('opaque walls prevent visual detection and firing',()=>{
 const g=fixture({walls:[{x:600,y:0,w:80,h:1700,active:true}]}),enemy=g.add('patrol',350,400);
 g.tick(4);
 assert.equal(g.shots.length,0);
 assert.equal(enemy.ai.target,null);
 assert.equal(enemy.ai.lastKnown,null);
});

test('hearing records the old sound position instead of revealing a moving player',()=>{
 const g=fixture({walls:[{x:600,y:0,w:80,h:1700,active:true}]}),enemy=g.add('walker',350,400);
 g.sounds.push({x:850,y:800,radius:1300,faction:'player',life:1});g.tick(.5);
 assert.deepEqual(enemy.ai.lastKnown,{x:850,y:800});
 g.sounds=[];g.player.x=1800;g.player.y=1200;g.tick(.5);
 assert.deepEqual(enemy.ai.lastKnown,{x:850,y:800});
 assert.equal(g.shots.length,0);
});

test('a runner locks its charge destination before windup and a side dodge avoids damage',()=>{
 const g=fixture(),enemy=g.add('runner',650,400);g.tick(.6);enemy.ai.specialCooldown=0;
 assert.equal(g.until(()=>enemy.ai.action==='runnerWindup',1),true);
 assert.equal(enemy.ai.actionTarget.y,400);
 g.player.y=950;g.tick(1.3);
 assert.equal(g.damages.length,0);
 assert.ok(enemy.x>650,'the locked charge actually moves');
 assert.ok(enemy.y<500,'the charge does not curve to track the hidden/new position');
});

test('sniper laser freezes before the shot, leaving a real dodge window',()=>{
 const g=fixture(),enemy=g.add('sniper',400,400);g.tick(.8);enemy.cooldown=0;
 assert.equal(g.until(()=>enemy.ai.action==='sniperAim',1),true);
 g.tick(.85);const lockedY=enemy.ai.actionTarget.y;g.player.y=900;g.tick(.4);
 const shot=g.shots.find(s=>s.type==='sniper');assert.ok(shot);
 assert.equal(shot.target.y,lockedY);
 assert.notEqual(shot.target.y,g.player.y);
});

test('turrets cannot instantly reverse their protected firing direction',()=>{
 const g=fixture(),enemy=g.add('turret',700,400,Math.PI);g.player.x=950;
 g.tick(.8);assert.equal(g.shots.length,0,'the gun still has to turn after detecting a target');
 assert.equal(g.until(()=>g.shots.length>0,4),true,'a correctly tracked target can eventually be fired upon');
});

test('a radio call can be interrupted and a completed call is bounded per operator and mission',()=>{
 const g=fixture(),radio=g.add('radio',650,400);g.level.enemies=[{type:'patrol',x:160,y:150}];
 g.tick(1.1);radio.ai.specialCooldown=0;
 assert.equal(g.until(()=>radio.ai.action==='calling',2),true);
 radio.hp-=12;g.tick(.1);assert.equal(radio.ai.radioCalls,0);assert.notEqual(radio.ai.action,'calling');
 radio.suppression=0;radio.ai.specialCooldown=0;
 assert.equal(g.until(()=>radio.ai.radioCalls===1,5),true);
 assert.equal(g.aiDirector.reinforcements,1);assert.equal(g.aiDirector.reinforcementBudget,1);
 const afterCall=g.enemies.length;g.tick(8);assert.equal(radio.ai.radioCalls,1);assert.equal(g.enemies.length,afterCall);
});

test('a medic heals a living ally but never resurrects a defeated one',()=>{
 const g=fixture();g.player.x=2250;g.player.y=1600;
 const medic=g.add('medic',600,400),wounded=g.add('patrol',650,400),dead=g.add('assault',620,420);
 wounded.hp=25;dead.hp=0;dead.dead=true;g.tick(2.5);
 assert.ok(wounded.hp>25);assert.equal(dead.hp,0);assert.equal(medic.ai.healCharges,1);
});

test('a medic can notice an unconfirmed silhouette while a nearby ally becomes wounded',()=>{
 const g=fixture(),medic=g.add('medic',600,400),ally=g.add('patrol',640,450);
 g.tick(1/60);
 // A real perception edge: the first silhouette raises awareness but has not
 // reached the confirmation threshold. Another fight has just wounded an ally.
 ally.hp=25;medic.ai.perceptionTimer=0;
 assert.doesNotThrow(()=>g.tick(1/60));
 assert.equal(medic.ai.visible,true);assert.equal(medic.ai.target,null);assert.ok(medic.awareness<.55);
 g.tick(2.2);assert.ok(ally.hp>25,'The support action remains usable while threat confirmation continues');
});

test('all sixteen roles survive occluded, unconfirmed, confirmed, lost, defeated and restored target transitions',()=>{
 const roles=Object.keys(ENEMY_TYPES);assert.equal(roles.length,16);
 const finiteActors=g=>assert.ok(g.enemies.every(e=>[e.x,e.y,e.hp,e.angle].every(Number.isFinite)),'Every actor remains finite');
 for(const role of roles){
  const wall={id:'perception-wall',x:780,y:0,w:40,h:1700,active:true};
  const g=fixture({walls:[wall]}),enemy=g.add(role,600,400);
  // A stable authored actor ID exercises gradual recognition for every role.
  enemy.id='edge';
  const ally=g.add(ENEMY_TYPES[role].faction==='infected'?'walker':'patrol',640,450);ally.hp=25;
  assert.doesNotThrow(()=>g.tick(1),role+' while sight is blocked');assert.equal(enemy.ai.visible,false,role);
  wall.active=false;
  assert.equal(g.until(()=>enemy.ai.visible,.5),true,role+' notices the newly opened view');
  assert.equal(enemy.ai.target,null,role+' has not yet confirmed the first silhouette');
  assert.ok(enemy.awareness<.55,role+' remains below confirmation threshold');finiteActors(g);
  assert.equal(g.until(()=>enemy.ai.target===g.player,1),true,role+' confirms a living target');
  wall.active=true;assert.doesNotThrow(()=>g.tick(.6),role+' loses its target behind a wall');assert.equal(enemy.ai.visible,false,role);
  g.player.hp=0;assert.doesNotThrow(()=>g.tick(.6),role+' after its target is defeated');assert.equal(enemy.ai.target,null,role);finiteActors(g);
  // This is the plain-data enemy shape saved by Game. No live target or AI
  // references are inserted into the restored instance.
  const fields=['id','type','faction','x','y','r','hp','maxHp','angle','state','awareness','ammo','cooldown','suppression','reloadTime'];
  const saved=Object.fromEntries(fields.filter(k=>enemy[k]!==undefined).map(k=>[k,enemy[k]]));saved.radioCalls=enemy.ai.radioCalls;saved.healCharges=enemy.ai.healCharges;
  const restoredWall={...wall},restored=fixture({walls:[restoredWall]}),copy={...ENEMY_TYPES[role],...saved};
  restored.enemies.push(copy);const other=restored.add(ally.type,640,450);other.hp=25;
  assert.doesNotThrow(()=>restored.tick(.7),role+' initializes from flattened saved fields');
  assert.equal(copy.ai.radioCalls,saved.radioCalls,role+' keeps radio budget');assert.equal(copy.ai.healCharges,saved.healCharges,role+' keeps medical budget');
  restoredWall.active=false;assert.doesNotThrow(()=>restored.tick(2),role+' resumes actual perception after loading');
  restored.player.hp=0;assert.doesNotThrow(()=>restored.tick(.6),role+' loses the restored target');finiteActors(restored);
 }
});

test('restored finite radio and medical budgets do not refill when AI is initialized',()=>{
 const g=fixture(),radio=g.add('radio',600,400),medic=g.add('medic',600,600),wounded=g.add('patrol',640,600);
 radio.radioCalls=1;medic.healCharges=0;wounded.hp=25;g.aiDirector={reinforcements:2};
 g.tick(1.2);radio.ai.specialCooldown=0;g.tick(7);
 assert.equal(radio.ai.radioCalls,1);assert.equal(medic.ai.healCharges,0);
 assert.equal(g.aiDirector.reinforcements,2);assert.equal(g.enemies.length,3);
 assert.equal(wounded.hp,25,'An exhausted restored medic does not gain free treatment');
});

test('flash stun cancels a pending attack and works with either supported stun field',()=>{
 for(const field of ['stunTime','stunned']){
  const g=fixture(),enemy=g.add('spitter',620,400);g.tick(.7);enemy.ai.specialCooldown=0;
  assert.equal(g.until(()=>enemy.ai.action==='spitAim',1),true);
  enemy[field]=1.5;g.tick(1.2);
  assert.equal(g.shots.length,0);assert.equal(enemy.state,'stunned');assert.equal(enemy.ai.action,null);
  g.tick(.6);assert.ok(enemy.stunTime<=0&&enemy.stunned<=0);
 }
});

test('enemies have an actual empty-magazine reload window',()=>{
 const g=fixture(),enemy=g.add('patrol',600,400);enemy.ammo=1;g.tick(.7);enemy.cooldown=0;
 assert.equal(g.until(()=>g.shots.length===1,2),true);
 assert.ok(enemy.reloadTime>0);
 const shots=g.shots.length;g.tick(1.4);assert.equal(g.shots.length,shots);
 assert.equal(g.until(()=>g.shots.length>shots,2),true);
});

test('a telegraphed last shot keeps its visible reload state after finishing aim',()=>{
 const g=fixture(),enemy=g.add('sniper',400,400);enemy.ammo=1;g.tick(.8);enemy.cooldown=0;
 assert.equal(g.until(()=>g.shots.length>0,3),true);
 assert.ok(enemy.reloadTime>0);
 assert.equal(enemy.state,'reload');
 assert.equal(enemy.telegraph,null);
});

test('closed doors block navigation until they are opened',()=>{
 const wallA={x:650,y:0,w:60,h:300,active:true},wallB={x:650,y:450,w:60,h:1250,active:true};
 const door={id:'test-door',x:650,y:300,w:60,h:150,open:false};
 const g=fixture({walls:[wallA,wallB],doors:[door]});g.player.x=1000;
 const enemy=g.add('walker',550,370);g.sounds=[{x:1000,y:370,radius:1500,faction:'player',life:1}];
 g.tick(3);assert.ok(enemy.x<650,'the walker stays on its side of a closed door');
 door.open=true;g.sounds=[];g.tick(6);assert.ok(enemy.x>720,'opening the route invalidates the next navigation request');
});
