import {test} from 'node:test';
import assert from 'node:assert/strict';
import {controllerLookAssist} from '../input3d.js';

function fixture(){
 const g={mode:'playing',settings:{aimAssist:true},input:{lastDevice:'gamepad',lookDelta:{}},player:{x:0,y:0,angle:0,pitch:0},enemies:[{id:'visible',x:500*Math.cos(.035),y:500*Math.sin(.035),hp:80,type:'patrol'}],hasSight:()=>true,weaponStats:()=>({range:1000})};
 g.renderer={is3D:true,unitScale:.02,width:1000,height:700,cameraData:{x:0,y:0,height:.9625,fov:64},colliders:[],actorMap:new Map([['visible',{group:{visible:true},metrics:{base:0,height:1.75}}]]),projectPoint(enemy){const error=Math.atan2(enemy.y-g.player.y,enemy.x-g.player.x)-g.player.angle;return{visible:Math.abs(error)<.4,inFront:true,ndcX:Math.tan(error)/(Math.tan(32*Math.PI/180)*(1000/700)),ndcY:0};}};
 return g;
}

test('near a visible opponent, active controller look gets bounded friction and a smaller overshoot window',()=>{
 const assisted=fixture(),manual=fixture();manual.settings.aimAssist=false;
 const result=controllerLookAssist(assisted,.006,0,.25,0);
 assert.equal(result.targetId,'visible');assert.ok(result.friction>=.72&&result.friction<1);assert.ok(result.yaw>0&&result.yaw<.006);assert.equal(result.pitch,0,'Friction never invents a vertical turn');
 for(let frame=0;frame<9;frame++){assisted.player.angle+=controllerLookAssist(assisted,.006,0,.25,0).yaw;manual.player.angle+=controllerLookAssist(manual,.006,0,.25,0).yaw;}
 assert.ok(Math.abs(.035-assisted.player.angle)<Math.abs(.035-manual.player.angle),'A small held stick crosses the same target with less overshoot');
});

test('disabled assist, no stick, keyboard/mouse, hidden targets and opposing movement never acquire friction',()=>{
 for(const change of [g=>{g.settings.aimAssist=false;},g=>{g.input.lastDevice='mouse';},g=>{g.input.lastDevice='keyboard';},g=>{g.input.lookDelta.mouseX=1;},g=>{g.input.touchAim={id:1};},g=>{g.hasSight=()=>false;},g=>{g.renderer.actorMap.get('visible').group.visible=false;},g=>{g.enemies[0].dead=true;},g=>{g.enemies[0].disabled=true;},g=>{g.enemies[0].y=500;}]){
  const g=fixture();change(g);const result=controllerLookAssist(g,.006,.002,.25,.1);assert.equal(result.friction,1);assert.equal(result.yaw,.006);assert.equal(result.pitch,.002);
 }
 const g=fixture();assert.equal(controllerLookAssist(g,0,0,0,0).targetId,null);assert.equal(controllerLookAssist(g,-.006,0,-.25,0).friction,1,'Moving away remains unimpeded');
});

test('actual-height camera blockers exclude hidden targets even when the planar sight helper permits them',()=>{
 const g=fixture(),door={x:240,y:-30,w:40,h:80,open:false,active:true};g.renderer.colliders=[{def:door,kind:'door',height:3.2,collidable:true}];
 assert.equal(controllerLookAssist(g,.006,0,.25,0).friction,1,'Closed physical door occludes the target');
 door.open=true;assert.ok(controllerLookAssist(g,.006,0,.25,0).friction<1,'The actual live door state is honoured');
 g.renderer.colliders=[{def:{x:240,y:-30,w:40,h:80,low:false,active:true},kind:'cover',height:2.3}];assert.equal(controllerLookAssist(g,.006,0,.25,0).friction,1,'A tall vehicle blocks camera visibility');
 g.renderer.colliders[0].def.active=false;assert.ok(controllerLookAssist(g,.006,0,.25,0).friction<1);
});
