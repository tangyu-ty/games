import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.js';
// Explicit close-interaction geometry fixtures, never credited as natural play.
function arena(){
 globalThis.localStorage={getItem(){return null;},setItem(){}};
 const g=new Game(null);g.ui={render(){},dialogue(){},update(){},toast(){}};g.startMission(0);g.skipDialogue();g.enemies=[];
 g.player.x=100;g.player.y=100;g.level.walls=[];g.level.covers=[];g.level.doors=[];
 g.level.objects=[{id:'node',x:160,y:100,r:24,type:'terminal',active:true,stage:0,interaction:1,requires:[]}];g.level.stages=[{title:'Controlled interaction geometry',targets:['node']}];
 g.controls={x:0,y:0,interact:true};return g;
}
const wall={id:'wall',x:125,y:40,w:10,h:120,active:true,material:'concrete'};
test('nearby terminals and rescue targets cannot be operated through an opaque wall',()=>{
 for(const type of ['terminal','rescue','evidence']){const g=arena();g.level.objects[0].type=type;g.level.walls=[{...wall}];assert.equal(g.hasSight(g.player,g.level.objects[0]),false);g.updateInteraction(2);assert.equal(g.completedObjectIds.has('node'),false,type);assert.equal(g.interactionProgress,0);}
});
test('a shut door receives the interact action before the terminal behind it becomes reachable',()=>{
 const g=arena(),door={...wall,id:'door',open:false,locked:false,hp:80};g.level.doors=[door];g.updateInteraction(.3);assert.equal(door.open,true);assert.equal(g.completedObjectIds.has('node'),false);g.updateInteraction(.6);g.updateInteraction(.6);assert.equal(g.completedObjectIds.has('node'),true);
});
test('an exit cannot complete a mission from the opposite side of a solid wall',()=>{
 const g=arena();g.level.objects=[];g.level.exit={x:160,y:100,r:55};g.level.walls=[{...wall}];g.extractionReady=true;g.updateInteraction(2);assert.equal(g.campaign.completed.length,0);g.level.walls[0].active=false;g.updateInteraction(2);assert.deepEqual(g.campaign.completed,[0]);
});
