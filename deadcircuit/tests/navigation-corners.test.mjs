import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLevel} from '../levels.js';
import {circleRect,distance,findPath,moveActor,movementObstacles,pointWalkable,segmentRect,sweptCircleRect} from '../geometry.js';

function walkCertifiedRoute(start,end,level,radius){
 assert.ok(pointWalkable(start,level,radius),'The starting circular body is legally positioned');
 assert.ok(pointWalkable(end,level,radius),'The destination circular body is legally positioned');
 const route=findPath(start,end,level,radius);
 assert.ok(route.length,'A legal corner position must connect to the navigation grid');
 assert.ok(distance(route.at(-1),end)<1e-6,'The route reaches the actual destination, not only a grid proxy');
 const actor={x:start.x,y:start.y,r:radius},obstacles=movementObstacles(level);
 for(const waypoint of route){
  assert.ok(!obstacles.some(rect=>sweptCircleRect(actor,waypoint,rect,radius)),'Every returned segment clears the actual circular body');
  let frames=0;
  while(distance(actor,waypoint)>.05&&frames++<10000){
   const before={x:actor.x,y:actor.y},d=distance(actor,waypoint),travel=Math.min(1.5,d);
   moveActor(actor,(waypoint.x-actor.x)/d*travel,(waypoint.y-actor.y)/d*travel,level);
   assert.ok(!obstacles.some(rect=>circleRect(actor,rect)),'Actual movement must never put the body inside a wall');
   assert.ok(distance(before,actor)>1e-8,'Actual axis-separated movement must make progress along the certified route');
  }
  assert.ok(frames<10000,'Actual movement must reach every waypoint without sticking at a corner');
 }
 assert.ok(distance(actor,end)<.05);assert.equal(actor.r,radius,'The repair must preserve the original collision radius');
 return route;
}

test('rounded swept-circle clearance distinguishes an empty padded-box corner from a real collision',()=>{
 const rect={x:100,y:100,w:80,h:80},corner={x:85,y:85};
 assert.equal(circleRect({...corner,r:20},rect),false);
 assert.equal(segmentRect(corner,{x:70,y:70},rect,20),true,'The broad-phase square includes this legal circular corner');
 assert.equal(sweptCircleRect(corner,{x:70,y:70},rect,20),false,'Leaving an empty rounded corner is legal');
 assert.equal(sweptCircleRect({x:70,y:70},corner,rect,20),false,'Entering the same legal corner is also legal');
 assert.equal(sweptCircleRect(corner,{x:140,y:140},rect,20),true,'Crossing the wall remains forbidden');
 assert.equal(sweptCircleRect({x:80,y:90},{x:80,y:170},rect,20),false,'An exact side tangent does not overlap');
 assert.equal(sweptCircleRect({x:80.01,y:90},{x:80.01,y:170},rect,20),true,'A slight true side penetration is blocked');
 assert.equal(sweptCircleRect({x:80,y:100},{x:100,y:80},rect,20),true,'A diagonal shortcut through the rounded corner is blocked');
});

test('street market escort radius 20 escapes its naturally observed legal corner and reaches the player',()=>{
 const level=createLevel(1);
 for(const object of level.objects){
  const effect=object.effect||{};
  for(const move of effect.moveCover||[])Object.assign(level.covers.find(c=>c.id===move.id),move);
  for(const id of effect.openDoors||[]){const door=level.doors.find(d=>d.id===id);door.open=true;door.locked=false;}
 }
 const npc={x:3580.3554934585513,y:1040.2429406824021};
 const player={x:4017.9168391636285,y:1128.5095906839542};
 assert.deepEqual(level.walls.find(w=>w.id==='market-s2'),{id:'market-s2',x:3600,y:1044,w:510,h:26,material:'concrete',active:true});
 walkCertifiedRoute(npc,player,level,20);
 walkCertifiedRoute(player,npc,level,20);
});

test('all four rectangle corners support legal tangent starts and tangent destinations without wall shortcuts',()=>{
 const level={width:800,height:800,walls:[{x:300,y:300,w:160,h:120}],covers:[],doors:[]};
 for(const [x,y,sx,sy] of [[300,300,-1,-1],[460,300,1,-1],[300,420,-1,1],[460,420,1,1]]){
  const corner={x:x+sx*19.7,y:y+sy*3.6},farSide={x:sx<0?640:140,y:sy<0?600:140};
  walkCertifiedRoute(corner,farSide,level,20);
  walkCertifiedRoute(farSide,corner,level,20);
 }
});

test('rounded-corner navigation still refuses a route across a full-height solid wall',()=>{
 const level={width:700,height:500,walls:[{x:330,y:0,w:35,h:500}],covers:[],doors:[]};
 assert.equal(findPath({x:250,y:250},{x:420,y:250},level,20).length,0);
});
