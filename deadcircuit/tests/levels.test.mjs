import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LEVELS,createLevel,topologySignature} from '../levels.js';
import {ENEMY_TYPES} from '../enemies.js';
import {circleRect,distance,findPath,lineOfSight,moveActor,movementObstacles,pointWalkable,segmentRect,segmentRectTime} from '../geometry.js';

test('eighteen authored operations have distinct physical topology, themes and complete objective chains',()=>{
 assert.equal(LEVELS.length,18);
 const signatures=new Set(),themes=new Set();
 for(const meta of LEVELS){
  const l=createLevel(meta.id);signatures.add(l.topologySignature);themes.add(l.theme);
  assert.equal(l.topologySignature,topologySignature(l));
  assert.ok(l.width>=4000&&l.height>=1700);
  assert.equal(l.stages.length,4);
  assert.equal(l.stages.flatMap(s=>s.targets).length,8);
  assert.equal(l.stages.filter(s=>s.reinforcements.length>=3).length,3);
  assert.ok(l.enemies.length>=12);
  assert.ok(l.objects.filter(o=>o.optional).length>=3);
  assert.ok(l.props.length>0&&l.floorZones.length>0);
  const ids=new Set(l.objects.map(o=>o.id));assert.equal(ids.size,l.objects.length);
  for(const stage of l.stages){
   assert.ok(stage.title&&stage.description&&stage.checkpoint);
   assert.ok(stage.targets.length>0);
   for(const id of stage.targets){const object=l.objects.find(o=>o.id===id);assert.ok(object,`${meta.id}: missing target ${id}`);assert.equal(object.stage,stage.id);}
  }
  for(const object of l.objects)for(const required of object.requires)assert.ok(ids.has(required),`${meta.id}: missing prerequisite ${required}`);
 }
 assert.equal(signatures.size,18,'Art changes do not count as a new route graph');assert.equal(themes.size,18);
});

test('all spawn points, objectives, optional rewards and exits occupy walkable space and are reachable',()=>{
 for(const meta of LEVELS){
  const l=createLevel(meta.id),options={ignoreDoors:true};
  assert.ok(pointWalkable(l.spawn,l,16,options),`${meta.id}: player spawn`);
  for(const object of [l.exit,...l.objects]){
   assert.ok(pointWalkable(object,l,16,options),`${meta.id}: ${object.id||'exit'} overlaps geometry`);
   const path=findPath(l.spawn,object,l,16,options);
   assert.ok(path.length||distance(l.spawn,object)<30,`${meta.id}: no route to ${object.id||'exit'}`);
   assert.ok(distance(path.at(-1)||l.spawn,object)<28,`${meta.id}: route does not reach ${object.id||'exit'}`);
   let previous=l.spawn;
   for(const p of path){
    const steps=Math.ceil(distance(previous,p)/10);
    for(let step=1;step<=steps;step++){
     const sample={x:previous.x+(p.x-previous.x)*step/steps,y:previous.y+(p.y-previous.y)*step/steps,r:15};
     assert.ok(!movementObstacles(l,options).some(rect=>circleRect(sample,rect)),`${meta.id}: path crosses obstacle to ${object.id||'exit'}`);
    }
    previous=p;
   }
  }
  for(const enemy of [...l.enemies,...l.stages.flatMap(s=>s.reinforcements)])assert.ok(pointWalkable(enemy,l,ENEMY_TYPES[enemy.type].r,options),`${meta.id}: enemy ${enemy.id} overlaps geometry`);
 }
});

test('authored mechanics reference real doors, hazards, covers, walls and enemy nodes',()=>{
 let changingGeometry=0,controlledHazards=0,escorts=0;
 for(const meta of LEVELS){
  const l=createLevel(meta.id);
  for(const object of l.objects){
   const e=object.effect||{};
   for(const id of [...(e.openDoors||[]),...(e.closeDoors||[])])assert.ok(l.doors.some(d=>d.id===id),`${meta.id}: door ${id}`);
   for(const id of [...(e.disableHazards||[]),...(e.enableHazards||[])])assert.ok(l.floorZones.some(d=>d.id===id),`${meta.id}: zone ${id}`);
   for(const id of e.removeWalls||[])assert.ok(l.walls.some(d=>d.id===id),`${meta.id}: wall ${id}`);
   for(const move of e.moveCover||[])assert.ok(l.covers.some(d=>d.id===move.id)&&Number.isFinite(move.x)&&Number.isFinite(move.y),`${meta.id}: cover ${move.id}`);
   for(const id of e.disableEnemies||[])assert.ok(l.enemies.some(d=>d.id===id),`${meta.id}: enemy ${id}`);
   if(e.openDoors?.length||e.removeWalls?.length||e.moveCover?.length)changingGeometry++;
   if(e.disableHazards?.length||e.enableHazards?.length)controlledHazards++;
   if(object.escort)escorts++;
  }
 }
 assert.ok(changingGeometry>=20);assert.ok(controlledHazards>=10);assert.ok(escorts>=8);
});

test('every enemy dossier role appears in actual authored encounters and the final commander has usable ceasefire evidence',()=>{
 const present=new Set();
 for(const {id} of LEVELS){
  const l=createLevel(id);
  for(const enemy of [...l.enemies,...l.stages.flatMap(stage=>stage.reinforcements)])present.add(enemy.type);
 }
 assert.deepEqual([...present].sort(),Object.keys(ENEMY_TYPES).sort(),'Dossier-only enemy types must not count as campaign variety');
 assert.equal(present.size,16);
 const final=createLevel(17),commander=final.enemies.find(enemy=>enemy.id==='final-commander');
 assert.ok(commander&&commander.type==='commander');
 assert.ok(pointWalkable(commander,final,ENEMY_TYPES.commander.r),'The actual commander body has a legal spawn');
 const main=final.objects.find(object=>object.id==='officer-ledger');
 assert.ok(final.stages.some(stage=>stage.targets.includes(main.id)),'Ceasefire evidence is on the real main path');
 assert.ok(main.effect.disableEnemies.includes(commander.id));
 assert.equal(main.effect.setFlag.commanderRefusal,true);
 assert.equal(final.objects.find(object=>object.id==='commander-order').flag,'commanderRefusal','The alternative written refusal activates the same ceasefire flag');
 assert.equal(LEVELS[5].mechanic,'三塔连桥与广播接力');
});

test('main objectives can be reached in order without bypassing locked progression doors',()=>{
 for(const meta of LEVELS){
  const l=createLevel(meta.id);let position=l.spawn;
  // Ordinary doors can be opened by the player; locked ones require real effects.
  for(const door of l.doors)if(!door.locked)door.open=true;
  for(const stage of l.stages)for(const id of stage.targets){
   const object=l.objects.find(o=>o.id===id),route=findPath(position,object,l,16);
   assert.ok(route.length||distance(position,object)<30,`${meta.id}, stage ${stage.id}: locked progression blocks ${id}`);
   position={x:object.x,y:object.y};
   const e=object.effect||{};
   for(const doorId of e.openDoors||[]){const d=l.doors.find(d=>d.id===doorId);d.open=true;d.locked=false;}
   for(const doorId of e.closeDoors||[])l.doors.find(d=>d.id===doorId).open=false;
   for(const wallId of e.removeWalls||[])l.walls.find(w=>w.id===wallId).active=false;
   for(const move of e.moveCover||[])Object.assign(l.covers.find(c=>c.id===move.id),move);
  }
  assert.ok(findPath(position,l.exit,l,16).length,`${meta.id}: exit unreachable after final operation`);
 }
});

test('every level construction returns independent mutable state',()=>{
 for(let id=0;id<18;id++){
  const a=createLevel(id),b=createLevel(id),original=b.walls[0].x;
  a.walls[0].x=123456;a.enemies[0].x=-100;a.objects[0].active=false;a.stages[0].targets.push('invalid');
  assert.equal(b.walls[0].x,original);assert.notEqual(b.enemies[0].x,-100);assert.equal(b.objects[0].active,true);assert.ok(!b.stages[0].targets.includes('invalid'));
 }
 assert.throws(()=>createLevel(-1),RangeError);assert.throws(()=>createLevel(18),RangeError);assert.throws(()=>createLevel('0'),RangeError);
});

test('walls and closed doors stop sight; low cover stops bodies but leaves genuine sight lines',()=>{
 const l={width:600,height:400,walls:[],covers:[{id:'cover',x:270,y:90,w:40,h:220,low:true}],doors:[]};
 const a={x:150,y:200,r:15},b={x:450,y:200};
 assert.equal(lineOfSight(a,b,l),true);moveActor(a,300,0,l);assert.ok(a.x<260);
 a.x=150;moveActor(a,300,0,l,{ignoreCovers:true});assert.ok(Math.abs(a.x-450)<1e-7);
 l.walls.push({x:270,y:0,w:40,h:400});a.x=150;moveActor(a,300,0,l,{ignoreCovers:true});assert.ok(a.x<260);assert.equal(lineOfSight(a,b,l),false);
 l.walls=[];l.covers=[];l.doors=[{id:'door',x:270,y:0,w:40,h:400,open:false}];
 assert.equal(findPath({x:150,y:200},{x:450,y:200},l).length,0);
 l.doors[0].open=true;assert.ok(findPath({x:150,y:200},{x:450,y:200},l).length);assert.equal(lineOfSight(a,b,l),true);
});

test('swept segment collisions include starts inside walls, parallel rays and high-speed travel',()=>{
 const rect={x:100,y:100,w:80,h:80};
 assert.equal(segmentRect({x:0,y:140},{x:1000,y:140},rect),true);
 assert.equal(segmentRectTime({x:0,y:140},{x:1000,y:140},rect),.1);
 assert.equal(segmentRectTime({x:120,y:140},{x:1000,y:140},rect),0);
 assert.equal(segmentRect({x:0,y:90},{x:1000,y:90},rect),false);
 assert.equal(segmentRect({x:120,y:10},{x:120,y:1000},rect),true);
 assert.equal(segmentRectTime({x:0,y:0},{x:0,y:0},rect),null);
});
