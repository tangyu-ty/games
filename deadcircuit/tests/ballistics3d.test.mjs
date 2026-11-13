import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.js';
import {createArmoryProfile} from '../armory.js';
import {ENEMY_TYPES} from '../enemies.js';
import {actorMetrics,obstacleDescriptor} from '../render3d.js';

// Deterministic geometry fixtures validate the real Game firing/collision code.
// They are not browser playthroughs, screenshots or duration evidence.
function fixture(target={x:400,y:200,height:1.35},{muzzle={x:100,y:200,height:1.35},legacy=false}={}){
 const g=new Game(null);g.practice=true;g.profile={...createArmoryProfile({all:true}),medkits:3,grenades:{frag:3,smoke:3,flash:3},scrap:0};g.profile.loadout=['kestrel9','needle'];
 g.level={id:0,width:1600,height:800,walls:[],covers:[],doors:[],objects:[],floorZones:[],stages:[]};
 g.player={x:80,y:200,r:15,hp:100,maxHp:100,armor:60,maxArmor:60,stamina:100,angle:0,pitch:0,stance:'stand',coverId:null,weaponIndex:0,action:null,invulnerable:1,fireCooldown:0,exposed:0,slideTime:0};
 g.renderer=legacy?{}:{is3D:true,prepareAim(game){game.muzzle3D={...muzzle};game.aimPoint3D={...target};return game.aimPoint3D;}};
 return g;
}
function run(g,seconds=.7){for(let t=0;t<seconds;t+=1/120)g.updateBullets(1/120);}

test('3D upward aim sends vertical velocity and cannot hit a ground enemy in the same compass direction',()=>{
 const g=fixture({x:600,y:200,height:20});g.input={lastDevice:'gamepad'};const e=g.spawnEnemy({type:'patrol',x:300,y:200,disabled:true});g.firePlayer();assert.equal(g.bullets[0].ballistic3D,true);assert.ok(g.bullets[0].vz>20);assert.ok(g.bullets[0].height>1);run(g);assert.equal(e.hp,e.maxHp);assert.equal(g.weaponState.mag,14);
});

test('the projectile converges from the gun muzzle onto the 3D crosshair instead of using the player compass angle',()=>{
 const g=fixture({x:400,y:350,height:1.2}),e=g.spawnEnemy({type:'patrol',x:400,y:350,disabled:true});g.player.angle=-Math.PI/2;g.player.pitch=-.8;g.firePlayer();const b=g.bullets[0];assert.ok(b.vx>0&&b.vy>0);assert.ok(Math.abs(Math.atan2(b.vy,b.vx)-Math.atan2(150,300))<.035);assert.ok(b.vz<0);run(g);assert.equal(e.hp,e.maxHp-24);
});

test('a standing muzzle clears a low cover, while a crouched muzzle is physically blocked',()=>{
 for(const [height,expectedHit]of[[1.35,true],[.8,false]]){
  const g=fixture({x:400,y:200,height},{muzzle:{x:100,y:200,height}});g.level.covers=[{id:'low',x:200,y:150,w:50,h:100,low:true,active:true,material:'metal'}];g.player.coverId='low';g.player.stance=height<1?'crouch':'stand';const e=g.spawnEnemy({type:'patrol',x:400,y:200,disabled:true});g.firePlayer();assert.equal(g.bullets[0].ignoreCover,null);run(g);assert.equal(e.hp<e.maxHp,expectedHit);if(!expectedHit)assert.ok(g.effects.some(e=>e.type==='spark'));
 }
});

test('solid walls and doors intercept 3D shots even when the crosshair target is behind them',()=>{
 for(const kind of['walls','doors']){
  const g=fixture(),e=g.spawnEnemy({type:'patrol',x:400,y:200,disabled:true});g.level[kind]=[{id:'barrier',x:200,y:150,w:30,h:100,active:true,open:false,material:'concrete'}];g.firePlayer();run(g);assert.equal(e.hp,e.maxHp);assert.ok(g.effects.some(e=>e.type==='spark'));
 }
});

test('a descending swept round hits the top of cover after entering its XY footprint above it',()=>{
 const g=fixture();g.level.covers=[{id:'cover-top',x:150,y:150,w:100,h:100,low:true,active:true,material:'metal'}];
 g.bullets=[{x:100,y:200,height:4,previousHeight:4,vx:100,vy:0,vz:-3,ballistic3D:true,life:10,r:2,faction:'player',owner:'player',damage:24,penetration:0}];g.updateBullets(1);
 assert.equal(g.bullets.length,0);const impact=g.effects.find(e=>e.type==='spark');assert.ok(impact);assert.ok(impact.x>190&&impact.x<205);assert.ok(Math.abs(impact.height-1.09)<1e-8);
});

test('airborne drone collision has a lower bound, so shots below its body miss and correctly aimed shots hit',()=>{
 for(const [height,expectedHit]of[[.8,false],[1.75,true]]){
  const g=fixture({x:350,y:200,height},{muzzle:{x:100,y:200,height}}),e=g.spawnEnemy({type:'drone',x:350,y:200,disabled:true});assert.deepEqual(g.heightBounds3D(e),{bottom:1.5,top:2.05});g.firePlayer();run(g);assert.equal(e.hp<e.maxHp,expectedHit);
 }
});

test('an obstructed gun muzzle stops the shot at the obstruction despite a clear camera crosshair',()=>{
 const g=fixture(),e=g.spawnEnemy({type:'patrol',x:400,y:200,disabled:true});g.level.walls=[{id:'muzzle-wall',x:90,y:180,w:30,h:40,active:true,material:'concrete'}];g.firePlayer();run(g);assert.equal(e.hp,e.maxHp);const impact=g.effects.find(e=>e.type==='spark');assert.equal(impact.x,100);assert.equal(g.weaponState.mag,14);
});

test('downward shots stop at the ground instead of continuing through the floor into a distant target',()=>{
 const g=fixture({x:180,y:200,height:0}),e=g.spawnEnemy({type:'patrol',x:450,y:200,disabled:true});g.firePlayer();run(g);assert.equal(e.hp,e.maxHp);const ground=g.effects.find(e=>e.type==='spark');assert.ok(ground&&ground.x<200&&ground.height<=.041);
});

test('legacy renderers retain their existing 2D projectile and cover rules',()=>{
 const g=fixture({x:400,y:200,height:20},{legacy:true}),e=g.spawnEnemy({type:'patrol',x:400,y:200,disabled:true});g.player.pitch=1;g.firePlayer();assert.equal(g.bullets[0].ballistic3D,undefined);assert.equal(g.bullets[0].height,undefined);run(g);assert.equal(e.hp,e.maxHp-24);
});

test('camera pitch is whitelisted and bounded when a campaign snapshot restores',()=>{
 const g=new Game(null);g.practice=true;g.startMission(0);g.player.pitch=.72;const save=g.makeSnapshot();assert.equal(g.restoreSnapshot(save),true);assert.equal(g.player.pitch,.72);save.player.pitch=Infinity;assert.equal(g.restoreSnapshot(save),true);assert.equal(g.player.pitch,0);save.player.pitch=500;assert.equal(g.restoreSnapshot(save),true);assert.equal(g.player.pitch,1.08);
});

test('all rendered enemy heights and solid-cover heights agree with the actual bullet collision volumes',()=>{
 const g=fixture();for(const type of Object.keys(ENEMY_TYPES)){const rendered=actorMetrics(type),physical=g.heightBounds3D({type});assert.ok(Math.abs(physical.bottom-rendered.base)<1e-10,type+' lower height');assert.ok(Math.abs(physical.top-rendered.base-rendered.height)<1e-10,type+' upper height');}
 for(const [kind,low]of[['wall',false],['door',false],['cover',true],['cover',false]]){const rect={id:'height-contract',x:10,y:20,w:40,h:60,low};assert.equal(g.solidHeight3D(rect,kind),obstacleDescriptor(rect,kind).height);}
});
