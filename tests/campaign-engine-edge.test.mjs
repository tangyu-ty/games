import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
// Run from the project root, or set CAMPAIGN_ROOT when reviewing this draft elsewhere.
const {CampaignEngine}=await import(pathToFileURL(process.env.CAMPAIGN_ENGINE_MODULE||path.resolve(process.env.CAMPAIGN_ROOT||process.cwd(),'campaign-engine.js')).href);
function raceFixture(){
 const game={
  mode:'playing',stage:0,campaignClock:0,kills:0,score:0,shells:0,enemies:[],bullets:[],effects:[],pickups:[],islands:[],
  player:{x:900,y:680,r:16,hp:120,maxHp:120,speed:205,damage:20,fireRate:.48,multishot:1,crit:.05,pulseCD:0,pulseMax:9,invuln:0},
  difficulty:'normal',makeIslands(){this.islands=[];},spawn(type){const e={x:1500,y:500,r:16,type,hp:40,maxHp:40,speed:50,angle:0,age:0,attack:2};this.enemies.push(e);return e;},
  effect(){},toast(){},burst(){},audio:{sfx(){}},enemyBullet(){},hurt(n){this.player.hp-=n;},saveVoyage(){},
  onCampaignLegComplete(leg){this.legCompletions=(this.legCompletions||0)+1;this.completedLeg=leg;this.mode='dialog';},
  onCampaignChapterComplete(){throw Error('Race leg fixture should not complete the chapter');},
  onCampaignMissionFailed(reason){throw Error('Race fixture unexpectedly failed: '+reason);}
 };
 const engine=new CampaignEngine(game);engine.startChapter(3);engine.leg=1;engine.setupLeg({quiet:true});assert.equal(engine.kind,'race');
 engine.spawnTimer=1e9;engine.hazardTimer=1e9;
 const gate=game.missionObjects.find(o=>o.type==='gate');engine.state.routeIndex=engine.state.totalGates-1;game.player.x=gate.x;game.player.y=gate.y;
 return{game,engine,gate};
}

test('finishing all race gates before the kill quota keeps progress bounded and its checkpoint restorable',()=>{
 const {game,engine}=raceFixture();engine.update(1/60);
 assert.equal(engine.state.routeIndex,engine.state.totalGates,'The final physical gate was crossed');
 assert.equal(engine.transitioning,false,'The mission still waits for its separate kill objective');assert.equal(game.legCompletions||0,0);
 for(let frame=0;frame<20;frame++)engine.update(1/60);
 assert.equal(engine.state.routeIndex,engine.state.totalGates,'Remaining near the final gate must not repeatedly increment progress');
 const checkpoint=engine.snapshot();assert.equal(engine.restore(checkpoint),true,'A legitimate waiting checkpoint remains restorable');
 assert.equal(engine.state.routeIndex,engine.state.totalGates);assert.equal(engine.transitioning,false);assert.equal(engine.state.legKills,0);assert.equal(game.legCompletions||0,0);
});

test('reaching the race kill quota after the final gate completes exactly once without overflowing gate progress',()=>{
 const {game,engine}=raceFixture();engine.update(1/60);
 assert.equal(engine.state.routeIndex,engine.state.totalGates);assert.equal(engine.transitioning,false);
 game.kills=engine.baseKills+engine.spec.quota;engine.update(1/60);
 assert.equal(game.legCompletions,1);assert.equal(game.completedLeg,1);assert.equal(engine.transitioning,true);assert.equal(game.mode,'dialog');
 assert.equal(engine.state.routeIndex,engine.state.totalGates,'The completed gate count remains equal to the actual number of gates');
 const score=game.score,shells=game.shells;for(let frame=0;frame<10;frame++)engine.update(1/60);
 assert.equal(game.legCompletions,1);assert.equal(game.score,score);assert.equal(game.shells,shells);
});
