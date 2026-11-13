#!/usr/bin/env node
// A natural-input campaign pilot, not a duration fixture. It reads the world to
// plan routes, but sends only standard Gamepad input and visible UI clicks.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {appendFileSync,existsSync,mkdirSync,readFileSync,readdirSync,renameSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {chromium} from 'playwright';
import {browserPath} from '../../scripts/browser.mjs';
import {findPath,pointWalkable,segmentRect,distance,clamp,lineOfSight,segmentRectTime,movementObstacles,sweptCircleRect} from '../geometry.js';

const gameRoot=fileURLToPath(new URL('../',import.meta.url));
const repoRoot=path.dirname(gameRoot.replace(/\/$/,''));
const args=process.argv.slice(2),options={missions:3,readingCpm:700,output:'artifacts/dc-natural',maxMinutes:240,difficulty:'standard',headless:true,explore:false,diagnostic3D:false};
for(let i=0;i<args.length;i++){
 const key=args[i];
 if(key==='--missions')options.missions=Number(args[++i]);
 else if(key==='--reading-cpm')options.readingCpm=Number(args[++i]);
 else if(key==='--output')options.output=args[++i];
 else if(key==='--max-minutes')options.maxMinutes=Number(args[++i]);
 else if(key==='--difficulty')options.difficulty=args[++i];
 else if(key==='--headed')options.headless=false;
 else if(key==='--explore')options.explore=true;
 else if(key==='--diagnostic-3d')options.diagnostic3D=true;
 else if(key==='--help'){
  console.log('node deadcircuit/scripts/playtest.mjs [--missions 1..18] [--reading-cpm 700] [--output artifacts/dc-natural] [--max-minutes 240] [--difficulty standard] [--explore] [--diagnostic-3d] [--headed]');process.exit(0);
 }else throw Error('Unknown argument '+key);
}
if(!Number.isInteger(options.missions)||options.missions<1||options.missions>18)throw Error('--missions must be an integer from 1 to 18');
if(!Number.isFinite(options.readingCpm)||options.readingCpm<100||options.readingCpm>2400)throw Error('--reading-cpm must be between 100 and 2400');
if(!Number.isFinite(options.maxMinutes)||options.maxMinutes<=0)throw Error('--max-minutes must be positive');
if(!['story','standard','tactical'].includes(options.difficulty))throw Error('Unknown difficulty');
const output=path.resolve(repoRoot,options.output);mkdirSync(output,{recursive:true});
const summaryPath=path.join(output,'summary.json'),eventsPath=path.join(output,'events.jsonl');
if(existsSync(summaryPath))throw Error('Output already contains a run; choose a fresh --output directory');

function productHash(){
 const hash=createHash('sha256');
 const files=[...readdirSync(gameRoot).filter(name=>/\.(?:js|css|html)$/.test(name)),'vendor/three.js'].sort();
 for(const filename of files){
  hash.update(filename+'\0');hash.update(readFileSync(path.join(gameRoot,filename)));hash.update('\0');
 }
 return hash.digest('hex');
}
const start=performance.now(),sourceHash=productHash(),method='Fresh campaign operated only through standard Gamepad axes/buttons and visible DOM controls. The pilot reads exposed world state for navigation and aiming. Game simulation advances only through the normal requestAnimationFrame loop; no stats, mission state, actor positions, health, clocks or update methods are changed. Reading delays are explicit simulated reading, not human reading.';
const summary={schemaVersion:1,status:'running',startedAt:new Date().toISOString(),updatedAt:null,pid:process.pid,options,method,wallSeconds:0,validatedPlayingSeconds:0,dialoguePanelWallSeconds:0,readingCharacters:0,readingPanels:0,completedMissions:[],observedStages:[],completedStages:[],completedObjectives:[],choices:[],fieldNotes:[],deaths:0,retries:0,errors:[],warnings:[],missionLog:[],inputSamples:0,diagnostic3D:{requested:options.diagnostic3D,is3DObserved:false,movementPixels:0,yawTravel:0,pitchTravel:0,playerShots:0,ballisticPlayerHitObserved:false,enemyHpReductionObservedIncludingCrossfire:0,doorsOpenedByPad:[],completed:false},sourceSha256AtLoad:sourceHash,sourceSha256Now:sourceHash,sourceUnchanged:true,campaignWon:false,coverageComplete:false,lastSample:null};
function event(type,data={}){const record={at:new Date().toISOString(),...data,type,wallSeconds:(performance.now()-start)/1000};if(Object.hasOwn(data,'wallSeconds'))record.durationSeconds=data.wallSeconds;appendFileSync(eventsPath,JSON.stringify(record)+'\n');}
function updateHash(){summary.sourceSha256Now=productHash();summary.sourceUnchanged=summary.sourceSha256Now===sourceHash;if(!summary.sourceUnchanged&&!summary.warnings.some(w=>w.code==='SOURCE_CHANGED')){summary.warnings.push({code:'SOURCE_CHANGED',message:'Product sources changed during the run; this run cannot validate a frozen release.'});event('warning',summary.warnings.at(-1));}}
function saveSummary(){summary.updatedAt=new Date().toISOString();summary.wallSeconds=(performance.now()-start)/1000;const temporary=summaryPath+'.tmp';writeFileSync(temporary,JSON.stringify(summary,null,2)+'\n');renameSync(temporary,summaryPath);}
function fault(code,message,extra={}){const item={code,message,...extra};summary.errors.push(item);event('error',item);}
event('start',{options,sourceHash,method});saveSummary();

let server,browser,context,page,base,stopped=false,lastPadInput={axes:[0,0,0,0],buttons:[]};
process.on('SIGINT',()=>{stopped=true;});process.on('SIGTERM',()=>{stopped=true;});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function startServer(){
 server=spawn(process.execPath,[path.join(repoRoot,'server.mjs')],{cwd:repoRoot,env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Server startup timed out')),15000);
  server.once('error',reject);server.stdout.on('data',chunk=>{const match=String(chunk).match(/port (\d+)/);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1]);}});
  server.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code));});
 });
}

async function readState(){
 return page.evaluate(()=>{
  const g=window.__dc;if(!g)return null;
  const p=g.player,l=g.level,c=g.campaign,d=g.dialogueState;
  const render=g.renderer,scale=render?.unitScale||.02,is3D=!!render?.is3D;const actorBounds=actor=>g.heightBounds3D?.(actor)||(actor?.type==='drone'?{bottom:1.5,top:2.05}:{bottom:0,top:({brute:2.4,warden:2.5,heavy:1.95,shield:1.85,walker:1.65,runner:1.5,climber:1.45,spitter:1.8,turret:1.55}[actor?.type]||1.75)*(actor===p&&p?.stance==='crouch'?.72:1)});
  const project=point=>{try{const q=render?.projectPoint?.(point);return q?{x:q.x,y:q.y,ndcX:q.ndcX,ndcY:q.ndcY,inFront:q.inFront,visible:q.visible}:null;}catch{return null;}};
  const rect=(r,kind)=>({...r,height3D:g.solidHeight3D?.(r,kind)||(kind==='cover'?(r.low===false?2.3:1.05):3.2)});
  const camera=render?.cameraData,threeCamera=render?.camera;let cameraData=camera?{...camera,height:camera.heightMeters??camera.height,viewportWidth:camera.viewportWidth??innerWidth,viewportHeight:camera.viewportHeight??innerHeight,aspect:threeCamera?.aspect||innerWidth/innerHeight}:null;if(!cameraData&&threeCamera?.isPerspectiveCamera){const m=threeCamera.matrixWorld?.elements;cameraData={x:threeCamera.position.x/scale,y:threeCamera.position.z/scale,height:threeCamera.position.y,dirX:-(m?.[8]||0),dirY:-(m?.[10]||0),dirHeight:-(m?.[9]||0),fov:threeCamera.fov,width:innerWidth,height:innerHeight};}
  const take=(object,keys)=>Object.fromEntries(keys.filter(k=>object?.[k]!==undefined).map(k=>[k,object[k]]));
  return{
   mode:g.mode,mission:c.mission,stage:c.stage,phase:c.phase,sceneIndex:c.sceneIndex,completed:[...c.completed],choices:{...c.choices},fieldNotes:(c.fieldNotes||[]).map(n=>({id:n.id,mission:n.mission,title:n.title})),deaths:c.deaths,totalPlay:c.totalPlay,time:g.time,elapsed:g.elapsed,
   is3D,unitScale:scale,cameraData,inputLook:{yawRate:2.4*Math.max(.25,Math.min(3,g.settings.lookSensitivity||1)),pitchRate:1.65*Math.max(.25,Math.min(3,g.settings.lookSensitivity||1)),adsMultiplier:.55,deadzone:g.settings.deadzone??.18,pitchLimit:1.08,invertY:!!g.settings.invertY},muzzle3D:g.muzzle3D?{x:g.muzzle3D.x,y:g.muzzle3D.y,height:g.muzzle3D.height}:null,
   difficulty:g.settings.difficulty,grenadeType:g.grenadeType,extractionReady:g.extractionReady,objective:g.objectiveText,interactionHint:g.interactionHint||'',interactionProgress:g.interactionProgress||0,
   completedObjects:[...(g.completedObjectIds||[])],missionKills:g.missionKills,missionShots:g.missionShots||0,stageStartKills:g.stageStartKills||0,
   player:p?take(p,['x','y','r','hp','maxHp','armor','maxArmor','stamina','angle','pitch','stance','coverId','action','weaponIndex','slideTime','throwCooldown','carrying']):null,
   weapon:p?g.weaponStats():null,weaponId:p?g.profile.loadout[p.weaponIndex||0]:null,ammo:p?{...g.profile.ammo[g.profile.loadout[p.weaponIndex||0]]}:null,
   profile:{loadout:[...g.profile.loadout],ownedWeapons:[...g.profile.ownedWeapons],ownedAttachments:{...g.profile.ownedAttachments},fittings:JSON.parse(JSON.stringify(g.profile.fittings)),ammo:JSON.parse(JSON.stringify(g.profile.ammo)),medkits:g.profile.medkits,grenades:{...g.profile.grenades}},
   dialogueText:document.querySelector('#dialogueText')?.textContent||'',choiceText:document.querySelector('.choice-prompt')?.textContent||'',dialogueLines:d?.lines?.length||0,hasChoice:!!d?.choice,
   level:l?{id:l.id,name:l.name,width:l.width,height:l.height,spawn:{...l.spawn},exit:{...l.exit},walls:l.walls.map(w=>rect(take(w,['id','x','y','w','h','active','hp','material','destroyed','height3D']),'wall')),covers:l.covers.map(w=>rect(take(w,['id','x','y','w','h','active','hp','material','low','destroyed','height3D']),'cover')),doors:l.doors.map(w=>rect(take(w,['id','x','y','w','h','open','active','hp','locked','height3D']),'door')),floorZones:l.floorZones.map(z=>take(z,['id','type','x','y','w','h','active'])),objects:l.objects.map(o=>take(o,['id','x','y','r','type','name','stage','interaction','optional','active','completed','following','delivered','stopped','hp','maxHp','requires','fieldNote'])),stages:l.stages.map(s=>take(s,['id','title','targets','requiredKills']))}:null,
   enemies:g.enemies.filter(e=>e.hp>0&&!e.dead&&!e.disabled).map(e=>({...take(e,['id','type','faction','x','y','r','hp','maxHp','angle','state','range','damage','speed','ammo','reloadTime','stunTime','telegraph']),targetingPlayer:e.ai?.target===p,visibleToPlayer:p?g.hasSight(p,e):false,aimHeight:(actorBounds(e).bottom+actorBounds(e).top)*.5,projection:project({x:e.x,y:e.y,height:(actorBounds(e).bottom+actorBounds(e).top)*.5})})),
   bullets:g.bullets.filter(b=>b.life>0&&b.faction!=='player').map(b=>take(b,['x','y','vx','vy','r','faction','projectile','height','vz','ballistic3D'])),
   ballisticPlayerHitEffects:g.effects.filter(e=>e.type==='hit'&&Number.isFinite(e.height)).map(e=>take(e,['x','y','height','life'])),
   effects:g.effects.filter(e=>['smoke','acid'].includes(e.type)&&e.life>0).map(e=>take(e,['x','y','radius','life','type'])),
   pickups:g.pickups.map(e=>take(e,['x','y','type','amount','life'])),
   interactionTarget:g.interactionTarget?{id:g.interactionTarget.id,type:g.interactionTarget.type,x:g.interactionTarget.x,y:g.interactionTarget.y}:null,
   result:g.lastResult?take(g.lastResult,['mission','seconds','kills','optional']):null,
   numbersValid:!p||[p.x,p.y,p.hp,p.armor,p.stamina,...(is3D?[p.pitch??0]:[]),...g.enemies.flatMap(e=>[e.x,e.y,e.hp])].every(Number.isFinite)
  };
 });
}

const neutral={axes:[0,0,0,0],buttons:[]};
async function sendPad(controls=neutral){
 await page.evaluate(input=>{window.__dcNaturalPad.axes=input.axes;window.__dcNaturalPad.buttons=input.buttons;},controls);
 lastPadInput={axes:[...controls.axes],buttons:[...controls.buttons]};summary.inputSamples++;
}
const inverseAxis=(value,deadzone=.18)=>Math.abs(value)<.004?0:Math.sign(value)*(deadzone+Math.min(1,Math.abs(value))*(1-deadzone));
function padFor(state,moveVector,aimVector,buttons,aimTarget=null){
 if(!state.is3D)return{axes:[inverseAxis(moveVector.x),inverseAxis(moveVector.y),inverseAxis(aimVector.x),inverseAxis(aimVector.y)],buttons:[...new Set(buttons)]};
 const p=state.player,yaw=p.angle||0,right={x:-Math.sin(yaw),y:Math.cos(yaw)},forward={x:Math.cos(yaw),y:Math.sin(yaw)};
 const localX=moveVector.x*right.x+moveVector.y*right.y,localY=-(moveVector.x*forward.x+moveVector.y*forward.y);
 let yawError=angleDifference(Math.atan2(aimVector.y,aimVector.x),yaw),desiredPitch=-.035,pitchError=desiredPitch-(p.pitch||0),projected=false;
 const camera=Number.isFinite(state.cameraData?.x)&&Number.isFinite(state.cameraData?.height)?state.cameraData:null,point=aimTarget;
 if(point&&camera){const scale=state.unitScale||.02,targetYaw=Math.atan2(point.y-camera.y,point.x-camera.x),cameraYaw=Math.atan2(camera.dirY,camera.dirX),range=Math.hypot(point.x-camera.x,point.y-camera.y)*scale;desiredPitch=Math.atan2((point.aimHeight??.9)-camera.height,Math.max(.01,range));yawError=angleDifference(targetYaw,cameraYaw);pitchError=desiredPitch-Math.asin(clamp(camera.dirHeight||0,-1,1));
  if(point.projection?.inFront!==false&&Number.isFinite(point.projection?.ndcX)&&Number.isFinite(point.projection?.ndcY)){const tangent=Math.tan((camera.fov||65)*Math.PI/360),aspect=camera.aspect||(camera.viewportWidth||1440)/(camera.viewportHeight||900);yawError=Math.atan(point.projection.ndcX*tangent*aspect);pitchError=Math.atan(point.projection.ndcY*tangent);projected=true;}
 }else if(point){const range=Math.hypot(point.x-p.x,point.y-p.y)*(state.unitScale||.02),muzzle=state.muzzle3D?.height??(p.stance==='crouch'?.972:1.35);desiredPitch=Math.atan2((point.aimHeight??.9)-muzzle,Math.max(.01,range));pitchError=desiredPitch-(p.pitch||0);}
 const chosen=[...new Set(buttons)];if(Math.abs(yawError)>.55){const ads=chosen.indexOf(6);if(ads>=0)chosen.splice(ads,1);}
 const multiplier=chosen.includes(6)?.55:1,yawRate=(state.inputLook?.yawRate||2.4)*multiplier,pitchRate=(state.inputLook?.pitchRate||1.65)*multiplier;
 const yawControl=Math.abs(yawError)<.004?0:clamp(yawError*4.6/yawRate,-1,1),pitchControl=Math.abs(pitchError)<.003?0:clamp(-pitchError*4.2/pitchRate*(state.inputLook?.invertY?-1:1),-1,1);
 const targetDistance=point?distance(p,point):500,fireTolerance=clamp((point?.r||15)/Math.max(80,targetDistance)*.7,.012,.045);
 if(Math.abs(yawError)>fireTolerance||Math.abs(pitchError)>.035||point?.projection?.inFront===false){const fire=chosen.indexOf(7);if(fire>=0)chosen.splice(fire,1);}
 state.pilotAim={targetId:point?.id||null,yawError,pitchError,desiredPitch,projected,controls:{localX,localY,yawControl,pitchControl}};
 const dz=state.inputLook?.deadzone??.18;return{axes:[inverseAxis(localX,dz),inverseAxis(localY,dz),inverseAxis(yawControl,dz),inverseAxis(pitchControl,dz)],buttons:chosen};
}
const unit=(x,y)=>{const len=Math.hypot(x,y);return len>0?{x:x/len,y:y/len}:{x:0,y:0};};
const normalize=vector=>{const len=Math.hypot(vector.x,vector.y);return len>1?{x:vector.x/len,y:vector.y/len}:vector;};
const angleDifference=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
function lineOfFire(state,enemy){
 const p=state.player,angle=Math.atan2(enemy.y-p.y,enemy.x-p.x),a=state.is3D&&state.muzzle3D?state.muzzle3D:{x:p.x+Math.cos(angle)*24,y:p.y+Math.sin(angle)*24};
 const obstacles=[...state.level.walls.filter(w=>w.active!==false&&!w.destroyed&&w.hp!==0),...state.level.doors.filter(d=>!d.open&&d.active!==false),...state.level.covers.filter(c=>c.active!==false&&!c.destroyed&&c.hp!==0&&(state.is3D||c.id!==p.coverId))];
 return !obstacles.some(rect=>{if(!segmentRect(a,enemy,rect,1))return false;if(!state.is3D)return true;const entry=segmentRectTime(a,enemy,rect,1),exit=1-(segmentRectTime(enemy,a,rect,1)??0),originHeight=state.muzzle3D?.height??(p.stance==='crouch'?.972:1.35),targetHeight=enemy.aimHeight??.9,z1=originHeight+(targetHeight-originHeight)*(entry??0),z2=originHeight+(targetHeight-originHeight)*exit;return Math.min(z1,z2)<(rect.height3D??(rect.low===false?2.3:1.05))+.02;});
}

class Pilot{
 constructor(){this.path=[];this.pathIndex=0;this.routeAt=0;this.goalKey='';this.geometryKey='';this.lastPosition=null;this.stuck=0;this.pulseTimes={};this.navFailures=0;this.lastGoal=null;this.dodgeSide=1;this.lastHealth=null;this.lastDamageAt=-10;this.lastAction=null;this.lastMedkits=null;this.shelter=null;this.shelterAt=-10;this.medicalIntent=false;this.lastCover=null;}
 pulse(name,now,delay){if((this.pulseTimes[name]||0)>now)return false;this.pulseTimes[name]=now+delay;return true;}
 plan(state,goal,now){
  const level=state.level,p=state.player;
  const geometryKey=level.doors.map(d=>d.id+':'+d.open).join('|')+';'+level.walls.filter(w=>w.active===false||w.hp<=0).map(w=>w.id).join('|')+';'+level.covers.map(c=>c.id+':'+c.x+':'+c.y+':'+c.active).join('|');
  const physicalRadius=(p.r||15)-.05,playerRadius=(p.r||15)+3,escortRadius=Math.max(playerRadius,...level.objects.filter(o=>o.following&&!o.delivered&&o.hp>0).map(o=>(o.r||20)+2));
  const key=state.mission+':'+state.stage+':'+goal.id+':radius'+escortRadius;
  if(key!==this.goalKey||geometryKey!==this.geometryKey||now-this.routeAt>.9||this.stuck>1.4||!this.path.length){
   this.routeAt=now;this.goalKey=key;this.geometryKey=geometryKey;this.pathIndex=0;
   const dangerousZones=(level.floorZones||[]).filter(z=>z.active!==false&&['electric','fire'].includes(z.type));
   const safeLevel=dangerousZones.length?{...level,walls:[...level.walls,...dangerousZones.map(z=>({...z,id:'pilot-avoid:'+z.id,material:'hazard'}))]}:level;
   const route=(map,radius)=>{
    let endpoints=[goal];
    if(!pointWalkable(goal,map,radius,{ignoreDoors:true})){
     endpoints=[];
     // The player can reach the last arm's length of a console while an escort
     // waits in its wider corridor. A vehicle is never assigned a smaller body.
     for(const ring of [32,48,64,96,128])for(let step=0;step<8;step++){
      const a=step*Math.PI/4,point={x:goal.x+Math.cos(a)*ring,y:goal.y+Math.sin(a)*ring};
      if(pointWalkable(point,map,radius,{ignoreDoors:true}))endpoints.push(point);
     }
     endpoints.sort((a,b)=>distance(goal,a)+distance(p,a)*.08-distance(goal,b)-distance(p,b)*.08);
    }
    const origins=[];
    if(pointWalkable(p,map,radius,{ignoreDoors:true}))origins.push({point:p,prefix:[]});
    else for(const ring of [32,56,88,128,180]){
     for(let step=0;step<8;step++){
      const a=step*Math.PI/4,point={x:p.x+Math.cos(a)*ring,y:p.y+Math.sin(a)*ring};
      if(!pointWalkable(point,map,radius,{ignoreDoors:true}))continue;
      // A legal actor may touch a wall more closely than the route's comfort
      // margin. Escape using its actual body; retain the wider margin afterward.
      const prefix=findPath(p,point,map,physicalRadius,{ignoreDoors:true});if(prefix.length)origins.push({point,prefix});
     }
     if(origins.length>=4)break;
    }
    for(const origin of origins.slice(0,5))for(const endpoint of endpoints.slice(0,6)){
     const wide=findPath(origin.point,endpoint,map,radius,{ignoreDoors:true});if(!wide.length)continue;
     const tail=distance(endpoint,goal)>65?findPath(endpoint,goal,map,playerRadius,{ignoreDoors:true}):[];
     return[...origin.prefix,...wide,...tail];
    }
    return[];
   };
   this.path=route(safeLevel,escortRadius);this.navigationRadius=escortRadius;
   // Some objectives intentionally require crossing a damaged corridor. A safe
   // detour is preferred, but a fictitious navigation wall cannot softlock play.
   if(!this.path.length&&safeLevel!==level)this.path=route(level,escortRadius);
   if(!this.path.length){this.path=findPath(p,goal,level,physicalRadius,{ignoreDoors:true});this.navigationRadius=physicalRadius;}
   if(!this.path.length&&escortRadius>playerRadius){this.path=findPath(p,goal,level,playerRadius,{ignoreDoors:true});this.navigationRadius=playerRadius;}
   if(!this.path.length&&distance(p,goal)>90){
    for(const radius of [48,80,128]){
     for(let i=0;i<12;i++){const a=i*Math.PI/6,candidate={x:goal.x+Math.cos(a)*radius,y:goal.y+Math.sin(a)*radius};if(!pointWalkable(candidate,level,18,{ignoreDoors:true}))continue;const route=findPath(p,candidate,level,18,{ignoreDoors:true});if(route.length){this.path=route;break;}}
     if(this.path.length)break;
    }
   }
   if(!this.path.length&&distance(p,goal)>120){this.navFailures++;if(this.navFailures%20===1)event('route_missing',{mission:state.mission,stage:state.stage,goal:{id:goal.id,x:goal.x,y:goal.y},player:{x:p.x,y:p.y},navigationRadius:this.navigationRadius});}
  }
  const obstacles=movementObstacles(level,{ignoreDoors:true});
  while(this.path[this.pathIndex]&&distance(p,this.path[this.pathIndex])<20){const next=this.path[this.pathIndex+1];if(next&&obstacles.some(rect=>sweptCircleRect(p,next,rect,physicalRadius)))break;this.pathIndex++;}
  return this.path[this.pathIndex]||goal;
 }
 chooseGoal(state){
  const p=state.player,l=state.level,stage=l.stages[state.stage],completed=new Set(state.completedObjects);
  if(options.diagnostic3D&&!summary.diagnostic3D.doorsOpenedByPad.length){const door=l.doors.filter(d=>!d.open&&d.active!==false&&d.hp!==0).map(d=>({...d,x:d.x+d.w/2,y:d.y+d.h/2,id:'diagnostic-door:'+d.id,type:'door',diagnosticDoorId:d.id,interaction:.3})).sort((a,b)=>distance(p,a)-distance(p,b))[0];if(door)return door;}
  const followers=l.objects.filter(o=>o.following&&!o.delivered&&o.hp>0);
  const behind=followers.filter(o=>distance(o,p)>480).sort((a,b)=>distance(b,p)-distance(a,p))[0];
  if(behind)return{...behind,id:'escort-wait:'+behind.id,waitForEscort:true};
  const optional=options.explore?l.objects.filter(o=>o.optional&&o.type!=='supply'&&!o.completed&&o.active!==false&&!(o.requires||[]).some(id=>!completed.has(id))).sort((a,b)=>distance(p,a)-distance(p,b)):[];
  if(state.extractionReady){
   if(optional.length)return optional[0];
   return{...l.exit,id:'__exit',type:'exit',interaction:1};
  }
  const ids=new Set(stage?.targets||[]);
  const targets=l.objects.filter(o=>ids.has(o.id)&&!o.completed&&o.active!==false);
  const ready=targets.filter(o=>!(o.requires||[]).some(id=>!completed.has(id)));
  const ordered=(ready.length?ready:targets).sort((a,b)=>distance(p,a)-distance(p,b));
  const main=ordered[0];
  const nearbyDanger=state.enemies.some(e=>e.visibleToPlayer&&e.targetingPlayer&&distance(p,e)<850&&!e.stunTime);
  const scarce=state.ammo&&state.ammo.mag+state.ammo.reserve<55||p.armor<30||p.hp<70&&state.profile.medkits<2;
  if(scarce&&!nearbyDanger){const supply=l.objects.filter(o=>o.optional&&o.type==='supply'&&!o.completed&&o.active!==false&&distance(o,p)<800).sort((a,b)=>distance(p,a)-distance(p,b))[0];if(supply)return supply;}
  if(optional.length&&!nearbyDanger&&p.hp>=65&&(!main||distance(p,optional[0])<distance(p,main)*1.15))return optional[0];
  if(main)return main;
  if(stage?.requiredKills&&state.missionKills-state.stageStartKills<stage.requiredKills){const enemy=state.enemies.sort((a,b)=>distance(p,a)-distance(p,b))[0];if(enemy)return{...enemy,id:'quota:'+enemy.id};}
  return null;
 }
 control(state,now){
  const p=state.player,l=state.level,buttons=[];
  if(!p||!l)return neutral;
  if(this.lastPosition){const moved=distance(p,this.lastPosition);this.stuck=moved<2?this.stuck+.1:Math.max(0,this.stuck-.3);}this.lastPosition={x:p.x,y:p.y};
  const goal=this.chooseGoal(state);this.lastGoal=goal?{id:goal.id,x:goal.x,y:goal.y}:null;
  let waypoint=goal?this.plan(state,goal,now):p,move=unit(waypoint.x-p.x,waypoint.y-p.y),aim={...move},aimPoint=goal?{...goal,aimHeight:['terminal','switch','power','relay'].includes(goal.type)?.9:.25}:null;
  const goalDistance=goal?distance(p,goal):Infinity;
  if(goalDistance<(goal?.waitForEscort?170:62)&&lineOfSight(p,goal,l))move={x:0,y:0};
  const nearEnemies=state.enemies.filter(e=>e.visibleToPlayer&&distance(p,e)<Math.min(1050,(state.weapon?.range||650)+180));
  const prioritized=nearEnemies.map(e=>{
   const d=distance(p,e),shootable=lineOfFire(state,e);
   const dangerous=['runner','climber','brute','spitter','sniper'].includes(e.type),blockingGoal=goal&&distance(e,goal)<240;
   const score=(e.targetingPlayer?650:0)+(dangerous?240:0)+(blockingGoal?200:0)+(shootable?130:0)-d;
   return{...e,d,shootable,score};
  }).sort((a,b)=>b.score-a.score);
  const threat=prioritized.find(e=>e.d<540||e.targetingPlayer||goal&&distance(e,goal)<250);
  const action=p.action?.type;
  if(this.lastHealth!==null&&p.hp<this.lastHealth-.1)this.lastDamageAt=now;
  if(this.lastAction==='heal'&&action!=='heal')event(state.profile.medkits<this.lastMedkits?'heal_complete':'heal_interrupted',{mission:state.mission,stage:state.stage,hp:p.hp,medkits:state.profile.medkits});
  this.lastHealth=p.hp;this.lastAction=action;this.lastMedkits=state.profile.medkits;
  const acid=state.effects.find(e=>e.type==='acid'&&distance(p,e)<(e.radius||75)+22);
  const hot=l.floorZones.find(z=>z.active!==false&&['electric','fire'].includes(z.type)&&p.x>z.x-10&&p.x<z.x+z.w+10&&p.y>z.y-10&&p.y<z.y+z.h+10);
  let hazardEscape=null;
  if(acid)hazardEscape=unit(p.x-acid.x,p.y-acid.y);
  else if(hot){
   const exits=[{x:hot.x-35,y:p.y},{x:hot.x+hot.w+35,y:p.y},{x:p.x,y:hot.y-35},{x:p.x,y:hot.y+hot.h+35}].filter(point=>pointWalkable(point,l,18));
   const exit=exits.sort((a,b)=>distance(p,a)-distance(p,b))[0];if(exit)hazardEscape=unit(exit.x-p.x,exit.y-p.y);
  }
  if(action==='heal'&&!hazardEscape)return padFor(state,{x:0,y:0},{x:Math.cos(p.angle),y:Math.sin(p.angle)},[]);
  const closeThreat=prioritized.some(e=>e.d<220&&!e.stunTime);
  // A medkit takes 2.1 s and is interrupted by any hit. Find real geometric
  // cover before attempting it; a 220 px distance check alone ignores rifles.
  const threats=state.enemies.filter(e=>!e.stunTime&&distance(p,e)<900&&(e.targetingPlayer||e.visibleToPlayer));
  const exposed=point=>threats.some(e=>distance(point,e)<Math.max(450,e.range||700)&&lineOfSight(point,e,l));
  if(p.hp<65&&state.profile.medkits>0&&!hazardEscape){
   if(!exposed(p)&&now-this.lastDamageAt>.8&&!action&&this.pulse('heal',now,3.5)){
    event('heal_input',{mission:state.mission,stage:state.stage,hp:p.hp,medkits:state.profile.medkits});return padFor(state,{x:0,y:0},{x:Math.cos(p.angle),y:Math.sin(p.angle)},[12]);
   }
   if(exposed(p)){
    if(!this.shelter||now-this.shelterAt>2.5||exposed(this.shelter)){
     const points=[];
     for(const radius of [100,180,280,420,600])for(let i=0;i<16;i++){const a=i*Math.PI/8;points.push({x:p.x+Math.cos(a)*radius,y:p.y+Math.sin(a)*radius});}
     for(const w of [...l.walls,...l.covers.filter(c=>c.low===false)]){const pad=35;points.push({x:w.x-pad,y:clamp(p.y,w.y-pad,w.y+w.h+pad)},{x:w.x+w.w+pad,y:clamp(p.y,w.y-pad,w.y+w.h+pad)},{x:clamp(p.x,w.x-pad,w.x+w.w+pad),y:w.y-pad},{x:clamp(p.x,w.x-pad,w.x+w.w+pad),y:w.y+w.h+pad});}
     const candidates=points.filter(q=>distance(p,q)<750&&pointWalkable(q,l,(p.r||15)+1)&&!exposed(q)).sort((a,b)=>distance(p,a)-distance(p,b));
     this.shelter=null;
     for(const q of candidates.slice(0,20)){const route=findPath(p,q,l,(p.r||15)-.05);if(route.length){this.shelter={...q,id:'medical-shelter'};this.shelterAt=now;event('medical_shelter',{mission:state.mission,stage:state.stage,x:q.x,y:q.y,hp:p.hp});break;}}
    }
    if(this.shelter){const next=this.plan(state,this.shelter,now),escape=unit(next.x-p.x,next.y-p.y);return padFor(state,escape,threat?unit(threat.x-p.x,threat.y-p.y):escape,p.stamina>18?[10]:[],threat||this.shelter);}
   }
  }else this.shelter=null;
  let firing=false;
  if(threat){
   aimPoint=threat;const predict=threat.faction==='infected'&&threat.type!=='spitter'?.04:0;
   aim=unit(threat.x+Math.cos(threat.angle||0)*(threat.speed||0)*predict-p.x,threat.y+Math.sin(threat.angle||0)*(threat.speed||0)*predict-p.y);
   const inRange=threat.d<(state.weapon?.range||650)*.94;
   if(threat.shootable&&inRange&&action!=='reload'){
    firing=true;buttons.push(6,7);
    if(threat.faction==='infected'&&threat.d<260){const away=unit(p.x-threat.x,p.y-threat.y);move=normalize({x:away.x*.9+move.x*.18,y:away.y*.9+move.y*.18});}
    else if(threat.d<180){const away=unit(p.x-threat.x,p.y-threat.y);move=normalize({x:away.x*.6-aim.y*.5,y:away.y*.6+aim.x*.5});}
    else if(threat.targetingPlayer){const sign=Math.floor(now/1.7)%2?1:-1;move=normalize({x:move.x*.25-aim.y*sign*.28,y:move.y*.25+aim.x*sign*.28});}
    else move={x:0,y:0};
   }else if(!threat.shootable){
    const cover=l.covers.find(c=>c.active!==false&&c.hp!==0&&segmentRect(p,threat,c));
    const nearbyCover=l.covers.find(c=>c.active!==false&&distance(p,{x:clamp(p.x,c.x,c.x+c.w),y:clamp(p.y,c.y,c.y+c.h)})<58);
    if(nearbyCover&&!p.coverId&&this.pulse('cover',now,2))buttons.push(5);
    else if(cover){
     const corners=[{x:cover.x-45,y:cover.y-45},{x:cover.x+cover.w+45,y:cover.y-45},{x:cover.x-45,y:cover.y+cover.h+45},{x:cover.x+cover.w+45,y:cover.y+cover.h+45}].filter(c=>pointWalkable(c,l,18));
     const flank=corners.sort((a,b)=>distance(p,a)+distance(a,threat)*.25-distance(p,b)-distance(b,threat)*.25)[0];
     if(flank){const next=this.plan(state,{...flank,id:'flank:'+threat.id},now);move=unit(next.x-p.x,next.y-p.y);}
    }
   }
   const clustered=nearEnemies.filter(e=>distance(e,threat)<170).length;
   if(state.profile.grenades.flash>0&&closeThreat&&(clustered>=2||p.hp<35)&&this.pulse('flash',now,5))buttons.push(14);
   if(state.profile.grenades.frag>0&&threat.d>330&&threat.d<520&&(clustered>=3||threat.type==='shield')&&this.pulse('grenade',now,4))buttons.push(4);
   const incoming=state.bullets.find(b=>{const d=distance(p,b);return d<115&&((p.x-b.x)*b.vx+(p.y-b.y)*b.vy)>0;});
   const charge=prioritized.find(e=>e.telegraph&&['runnerWindup','bruteWindup','sniperAim'].includes(e.telegraph.type)&&e.telegraph.life<.35&&distance(e.telegraph,p)<95);
   if((incoming||charge)&&p.stamina>=30&&this.pulse('dodge',now,1.6)){
    this.dodgeSide*=-1;move={x:-aim.y*this.dodgeSide,y:aim.x*this.dodgeSide};buttons.push(1);
   }
  }
  if(p.coverId&&(!threat||!lineOfFire(state,threat))&&this.pulse('leave-cover',now,1.5))buttons.push(5);
  if(state.ammo?.mag===0&&state.ammo.reserve===0){const other=state.profile.loadout[1-p.weaponIndex];if(state.profile.ammo[other]?.mag+state.profile.ammo[other]?.reserve>0&&this.pulse('swap',now,1))buttons.push(3);}
  else if(state.ammo&&state.ammo.mag<Math.max(1,state.weapon.mag*.25)&&!threat&&!action&&this.pulse('reload',now,2.5))buttons.push(2);
  const closed=l.doors.filter(d=>!d.open&&d.active!==false&&segmentRect(p,waypoint,d,22)).sort((a,b)=>distance(p,{x:a.x+a.w/2,y:a.y+a.h/2})-distance(p,{x:b.x+b.w/2,y:b.y+b.h/2}))[0];
  if(closed){const center={x:closed.x+closed.w/2,y:closed.y+closed.h/2};if(distance(p,center)<160){buttons.push(0,10);if(distance(p,center)<75)move={x:0,y:0};}}
  if(goal&&!goal.waitForEscort&&goalDistance<78&&!closeThreat&&lineOfSight(p,goal,l)){
   const escortReady=goal.type!=='exit'||!l.objects.some(o=>o.following&&!o.delivered&&distance(o,l.exit)>135);
   if(escortReady){buttons.push(0);if(!threat||goalDistance<60)move={x:0,y:0};}
  }
  // Sprint only while travelling; deliberate fire and medical actions get a stable stance.
  if(!firing&&!threat&&!action&&Math.hypot(move.x,move.y)>.1&&p.stamina>18)buttons.push(10);
  const followerDistance=Math.max(0,...l.objects.filter(o=>o.following&&!o.delivered&&o.hp>0).map(o=>distance(p,o)));
  if(followerDistance>240&&!goal?.waitForEscort){move={x:move.x*.62,y:move.y*.62};const sprint=buttons.indexOf(10);if(sprint>=0)buttons.splice(sprint,1);}
  if(hazardEscape){move=hazardEscape;buttons.push(10);if(p.stamina>=30&&this.pulse('hazard-dodge',now,1.5))buttons.push(1);}
  if(this.stuck>3&&!p.action&&this.pulse('unstick',now,2)){buttons.push(1);this.routeAt=0;this.dodgeSide*=-1;move=normalize({x:move.x-aim.y*.5*this.dodgeSide,y:move.y+aim.x*.5*this.dodgeSide});event('navigation_replan',{mission:state.mission,stage:state.stage,x:p.x,y:p.y,goal:this.lastGoal});}
  return padFor(state,move,aim,buttons,aimPoint);
 }
}

async function clickIfVisible(selector){const locator=page.locator(selector).first();if(await locator.isVisible().catch(()=>false)){await locator.click({timeout:5000});return true;}return false;}
async function prepareArmory(state){
 if(!await clickIfVisible('#loadoutBtn'))return;
 const ranking=['arclight','bullpup','trident','vector45','needle','kestrel9'];
 const primary=ranking.find(id=>state.profile.ownedWeapons.includes(id))||state.profile.loadout[0];
 await clickIfVisible(`[data-weapon="${primary}"]`);const equip=page.locator('#equipPrimary');if(await equip.isEnabled().catch(()=>false))await equip.click();
 // Fit available ordinary parts using the same visible workbench as a player.
 for(const [slot,preferences] of [['optic',['redDot','holo']],['muzzle',['suppressor','flashHider']],['underbarrel',['verticalGrip','angledGrip']],['rail',['laser']],['magazine',['extendedMag','quickMag']],['stock',['heavyStock','lightStock']]]){
  await clickIfVisible(`[data-slot="${slot}"]`);
  for(const id of preferences){const attachment=page.locator(`[data-attachment="${id}"]`);if(await attachment.isEnabled().catch(()=>false)){await attachment.click();event('workbench_install',{weapon:primary,slot,attachment:id});break;}}
 }
 await clickIfVisible('#armoryBack');event('workbench_prepare',{mission:state.mission,primary});
}

async function run(){
 base=await startServer();
 browser=await chromium.launch({executablePath:browserPath(chromium),headless:options.headless,args:['--no-sandbox','--disable-dev-shm-usage','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 context=await browser.newContext({viewport:options.diagnostic3D?{width:1100,height:720}:{width:1440,height:900},deviceScaleFactor:1});
 await context.addInitScript(()=>{
  window.__dcNaturalPad={axes:[0,0,0,0],buttons:[]};
  Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>{const input=window.__dcNaturalPad;return[{id:'DEAD CIRCUIT natural-input standard controller',index:0,connected:true,mapping:'standard',timestamp:performance.now(),axes:[...input.axes],buttons:Array.from({length:17},(_,i)=>({pressed:input.buttons.includes(i),touched:input.buttons.includes(i),value:input.buttons.includes(i)?1:0}))}];}});
 });
 page=await context.newPage();
 page.on('pageerror',error=>fault('PAGE_ERROR',error.message,{stack:error.stack||null}));
 page.on('console',message=>{if(message.type()==='error'&&!/favicon/.test(message.text()))fault('CONSOLE_ERROR',message.text());});
 await page.goto(base+'/deadcircuit/index.html?test=1',{waitUntil:'networkidle',timeout:30000});
 await page.waitForFunction(()=>window.__dc?.ui&&window.__dc?.input,{timeout:20000});
 await page.locator('#menuDifficulty').selectOption(options.difficulty);
 await page.locator('#newGameBtn').click();
 const pilot=new Pilot();let previous=null,previousAt=performance.now(),readingKey='',readingUntil=0,lastSave=0,lastHash=0,lastProgress=performance.now(),lastMode='',preparedMission=-1,lastSummaryMission=-1;
 const seenStages=new Set(),completedStageKeys=new Set(),seenCompleted=new Set(),seenChoices=new Set(),seenObjectives=new Set(),missionStarts=new Map(),stageStarts=new Map(),retryMap=new Map(),missionMetrics=new Map();
 let successful=false,diagnosticSuccess=false;
 while(!stopped){
  const now=performance.now(),seconds=(now-start)/1000;
  if(seconds>options.maxMinutes*60)throw Error('Natural playtest exceeded its configured wall-time limit');
  if(existsSync(path.join(output,'STOP'))){summary.warnings.push({code:'STOP_REQUESTED',message:'Stopped by an explicit STOP marker.'});stopped=true;break;}
  const state=await readState();if(!state)throw Error('Exposed game instance disappeared');
  const delta=(now-previousAt)/1000;
  if(!missionMetrics.has(state.mission))missionMetrics.set(state.mission,{mission:state.mission,firstSeenWallSeconds:seconds,wallSeconds:0,activePlaySeconds:0,simulatedReadingSeconds:0,playerShots:0,enemyShotsObservedAtLeast:0,enemiesDefeatedIncludingCrossfire:0,minHp:100,minArmor:60,deaths:0,rescued:[],delivered:[],optionalCompleted:[],fieldNotes:[]});
  const metrics=missionMetrics.get(state.mission);metrics.wallSeconds=seconds-metrics.firstSeenWallSeconds;
  if(previous?.mode==='playing'&&state.totalPlay>=previous.totalPlay){const increment=state.totalPlay-previous.totalPlay;if(increment<=Math.max(2,delta*1.5)){summary.validatedPlayingSeconds+=increment;missionMetrics.get(previous.mission).activePlaySeconds+=increment;}else throw Error('Game-time discontinuity cannot be credited as natural play');}
  if(previous?.mode==='dialogue'&&previous.dialogueText){summary.dialoguePanelWallSeconds+=delta;missionMetrics.get(previous.mission).simulatedReadingSeconds+=delta;}
  const currentMissionValid=state.level?.id===state.mission&&!!state.player;
  if(options.diagnostic3D&&state.mode==='playing'&&!state.is3D)throw Error('3D diagnostic requires the actual third-person 3D renderer and input.');
  if(state.is3D){summary.diagnostic3D.is3DObserved=true;if(state.ballisticPlayerHitEffects.length)summary.diagnostic3D.ballisticPlayerHitObserved=true;}
  if(currentMissionValid&&previous?.mode==='playing'&&state.mode==='playing'&&previous.mission===state.mission&&previous.player){
   const d=summary.diagnostic3D,moved=distance(state.player,previous.player);if(moved<200)d.movementPixels+=moved;
   d.yawTravel+=Math.abs(angleDifference(state.player.angle||0,previous.player.angle||0));d.pitchTravel+=Math.abs((state.player.pitch||0)-(previous.player.pitch||0));d.playerShots+=Math.max(0,state.missionShots-previous.missionShots);
   const priorEnemies=new Map(previous.enemies.map(e=>[e.id,e]));for(const e of state.enemies){const before=priorEnemies.get(e.id);if(before)d.enemyHpReductionObservedIncludingCrossfire+=Math.max(0,before.hp-e.hp);}
   const oldDoors=new Map((previous.level?.doors||[]).map(x=>[x.id,x]));for(const door of state.level.doors){const old=oldDoors.get(door.id);if(old&&!old.open&&door.open&&lastPadInput.buttons.includes(0)&&distance(state.player,{x:door.x+door.w/2,y:door.y+door.h/2})<190&&!d.doorsOpenedByPad.includes(door.id)){d.doorsOpenedByPad.push(door.id);event('diagnostic_door_opened',{mission:state.mission,door:door.id,position:{x:state.player.x,y:state.player.y},inputButtons:lastPadInput.buttons});}}
  }
  if(options.diagnostic3D){const d=summary.diagnostic3D;if(d.is3DObserved&&d.movementPixels>=100&&d.yawTravel>=.4&&d.pitchTravel>=.025&&d.playerShots>=3&&d.ballisticPlayerHitObserved&&d.doorsOpenedByPad.length){d.completed=true;diagnosticSuccess=true;event('diagnostic_3d_complete',{...d,completedMissions:summary.completedMissions.length,note:'Input/first-level smoke only; no full-campaign or duration claim.'});break;}}
  if(currentMissionValid){metrics.minHp=Math.min(metrics.minHp,state.player.hp);metrics.minArmor=Math.min(metrics.minArmor,state.player.armor);}
  if(currentMissionValid&&previous?.level?.id===state.mission&&previous.mission===state.mission){
   metrics.playerShots+=Math.max(0,state.missionShots-previous.missionShots);
   metrics.deaths+=Math.max(0,state.deaths-previous.deaths);
   const prior=new Map(previous.enemies.map(e=>[e.id,e]));
   for(const enemy of state.enemies){const old=prior.get(enemy.id);if(old&&Number.isFinite(old.ammo)&&enemy.ammo<old.ammo)metrics.enemyShotsObservedAtLeast+=old.ammo-enemy.ammo;}
  }
  if(currentMissionValid){metrics.enemiesDefeatedIncludingCrossfire=Math.max(metrics.enemiesDefeatedIncludingCrossfire,state.missionKills||0);metrics.rescued=state.level.objects.filter(o=>o.following||o.delivered).map(o=>o.id);metrics.delivered=state.level.objects.filter(o=>o.delivered||o.following&&distance(o,state.level.exit)<140).map(o=>o.id);metrics.optionalCompleted=state.level.objects.filter(o=>o.optional&&o.completed).map(o=>o.id);}
  summary.fieldNotes=state.fieldNotes;metrics.fieldNotes=state.fieldNotes.filter(n=>n.mission===state.mission).map(n=>n.id);
  if(!state.numbersValid)throw Error('Game contains a nonfinite actor position or health');
  summary.deaths=state.deaths;summary.campaignWon=state.phase==='won';
  summary.lastSample={is3D:state.is3D,cameraData:state.cameraData,pitch:state.player?.pitch,yaw:state.player?.angle,pilotAim:state.pilotAim||null,muzzle3D:state.muzzle3D,mode:state.mode,mission:state.mission,stage:state.stage,phase:state.phase,sceneIndex:state.sceneIndex,elapsed:state.elapsed,totalPlay:state.totalPlay,hp:state.player?.hp,armor:state.player?.armor,action:state.player?.action,medkits:state.profile.medkits,weapon:state.weaponId,ammo:state.ammo,objective:state.objective,interactionHint:state.interactionHint,player:state.player?{x:state.player.x,y:state.player.y}:null,enemies:state.enemies.length,followers:state.level?.objects.filter(o=>o.following&&!o.delivered).map(o=>({id:o.id,x:o.x,y:o.y,hp:o.hp})),hazards:state.effects.filter(e=>e.type==='acid').map(e=>({x:e.x,y:e.y,r:e.radius})),completedObjects:state.completedObjects,pilotGoal:pilot.lastGoal,currentMissionMetrics:metrics};
  if(state.mode!==lastMode){event('mode',{mode:state.mode,mission:state.mission,stage:state.stage,phase:state.phase});lastMode=state.mode;}
  if(state.mode==='playing'){
   const stageKey=state.mission+':'+state.stage;
   if(!missionStarts.has(state.mission)){missionStarts.set(state.mission,seconds);event('mission_start',{mission:state.mission,title:state.level.name});}
   if(state.stage<state.level.stages.length&&!seenStages.has(stageKey)){seenStages.add(stageKey);stageStarts.set(stageKey,seconds);summary.observedStages.push({mission:state.mission,stage:state.stage,title:state.level.stages[state.stage].title});event('stage_observed',summary.observedStages.at(-1));lastProgress=now;}
  }
  if(state.level){
   for(const id of state.completedObjects){const key=state.mission+':'+id;if(seenObjectives.has(key))continue;seenObjectives.add(key);const object=state.level.objects.find(o=>o.id===id);const item={mission:state.mission,id,type:object?.type,optional:!!object?.optional,fieldNote:Number.isInteger(object?.fieldNote)};summary.completedObjectives.push(item);event('object_complete',item);lastProgress=now;}
   for(let stage=0;stage<Math.min(state.stage,state.level.stages.length);stage++){
    const key=state.mission+':'+stage;if(completedStageKeys.has(key))continue;
    if(!seenStages.has(key))throw Error('A stage completed without being observed in normal gameplay: '+key);
    completedStageKeys.add(key);const item={mission:state.mission,stage,title:state.level.stages[stage].title,wallSeconds:seconds-(stageStarts.get(key)||seconds)};summary.completedStages.push(item);event('stage_complete',item);lastProgress=now;
   }
  }
  for(const mission of state.completed){
   if(seenCompleted.has(mission))continue;
   if(!missionStarts.has(mission))throw Error('A mission was credited without a natural start: '+mission);
   if(options.explore&&state.level?.objects.some(o=>o.optional&&o.type!=='supply'&&!o.completed&&o.active!==false))throw Error('Exploration run extracted before its optional documents/evidence/rescue objectives were complete');
   seenCompleted.add(mission);summary.completedMissions.push(mission);const item=missionMetrics.get(mission);item.finalGameSeconds=state.result?.mission===mission?state.result.seconds:state.elapsed;item.finalEnemiesDefeatedIncludingCrossfire=state.result?.kills;item.optional=state.result?.optional;summary.missionLog.push(item);event('mission_complete',{...item});lastProgress=now;
  }
  for(const [mission,choice] of Object.entries(state.choices))if(!seenChoices.has(mission)){seenChoices.add(mission);summary.choices.push({mission:Number(mission),choice});event('choice_saved',summary.choices.at(-1));}
  if(summary.errors.length)throw Error('Browser reported an application error');
  if(now-lastSave>5000){saveSummary();lastSave=now;}
  if(now-lastHash>30000){updateHash();lastHash=now;}
  if(state.mode==='playing'&&now-lastProgress>10*60*1000)throw Error('No task progress for ten minutes; natural pilot may be stuck');
  if(state.mode==='playing'){
   const controls=pilot.control(state,seconds);await sendPad(controls);summary.lastSample.pilotAim=state.pilotAim||null;summary.lastSample.lastPadInput=controls;readingKey='';
  }else{
   await sendPad();
   if(state.mode==='dialogue'){
    const text=state.hasChoice?state.choiceText:state.dialogueText;
    const key=state.mission+':'+state.phase+':'+state.sceneIndex+':'+text;
    if(key!==readingKey){
     const characters=(text.match(/[\p{L}\p{N}]/gu)||[]).length;
     readingKey=key;readingUntil=now+Math.max(.65,characters/options.readingCpm*60)*1000;
     summary.readingCharacters+=characters;summary.readingPanels++;event('simulated_reading',{mission:state.mission,phase:state.phase,line:state.sceneIndex,characters,delaySeconds:(readingUntil-now)/1000,readingCpm:options.readingCpm});
    }
    if(now>=readingUntil){
     if(state.hasChoice){const index=state.mission%2;if(!await clickIfVisible('#choice-'+index))throw Error('Expected choice control is missing');event('choice_input',{mission:state.mission,choice:index});}
     else{if(!await page.locator('#dialogueNext').isVisible())throw Error('Expected dialogue-next control is missing');await page.keyboard.press('Enter');}
    }
   }else if(state.mode==='briefing'){
    readingKey='';
    if(preparedMission!==state.mission){await prepareArmory(state);preparedMission=state.mission;}
    await clickIfVisible('#startMissionBtn');
   }else if(state.mode==='missionComplete'){
    if(seenCompleted.size>=options.missions&&options.missions<18){successful=true;break;}
    if(lastSummaryMission!==state.mission){await page.screenshot({path:path.join(output,'mission-'+String(state.mission+1).padStart(2,'0')+'.png')});lastSummaryMission=state.mission;}
    if(!await clickIfVisible('#nextMissionBtn'))throw Error('Mission result has no next-action button');
   }else if(state.mode==='ending'){
    if(options.missions===18&&state.phase==='won'){successful=true;break;}
    throw Error('Unexpected ending before full campaign coverage');
   }else if(state.mode==='dead'){
    const key=state.mission+':'+state.stage,count=(retryMap.get(key)||0)+1;retryMap.set(key,count);summary.retries++;event('retry',{mission:state.mission,stage:state.stage,attempt:count,deaths:state.deaths});
    await page.screenshot({path:path.join(output,'retry-'+summary.retries+'.png')});if(count>4||summary.retries>15)throw Error('Natural pilot exhausted its checkpoint retry budget');
    if(!await clickIfVisible('#retryBtn'))throw Error('Failure screen has no retry button');pilot.path=[];pilot.goalKey='';pilot.routeAt=0;pilot.lastPosition=null;pilot.stuck=0;lastProgress=now;
   }else if(state.mode==='pause'){
    if(!await clickIfVisible('#pauseResume'))throw Error('Unexpected pause without a resume control');
   }else if(state.mode==='loadout'){
    if(!await clickIfVisible('#armoryBack'))throw Error('Workbench is stuck');
   }else throw Error('Unexpected game mode '+state.mode);
  }
  previous=state;previousAt=now;
  await wait(state.is3D?60:100);
 }
 await sendPad();updateHash();
 summary.coverageComplete=successful&&summary.completedMissions.length===options.missions&&summary.observedStages.length===summary.completedStages.length&&(options.missions<18||summary.campaignWon);
 if(successful&&!summary.coverageComplete)throw Error('Completion coverage is incomplete');
 if(!summary.sourceUnchanged)throw Error('Product sources changed during this run; not a frozen-build completion');
 summary.status=diagnosticSuccess?'diagnostic_complete':summary.coverageComplete?'complete':'stopped';
 await page.screenshot({path:path.join(output,'final.png')});
 event('finish',{status:summary.status,coverageComplete:summary.coverageComplete,completed:summary.completedMissions.length});saveSummary();
 if(!['complete','diagnostic_complete'].includes(summary.status))process.exitCode=1;
}

try{await run();}
catch(error){fault('RUNNER_FAILURE',error.stack||String(error));summary.status='failed';try{updateHash();await page?.screenshot({path:path.join(output,'failure.png'),timeout:10000});}catch{}saveSummary();process.exitCode=1;}
finally{await context?.close().catch(()=>{});await browser?.close().catch(()=>{});server?.kill();saveSummary();console.log(JSON.stringify({status:summary.status,wallSeconds:summary.wallSeconds,validatedPlayingSeconds:summary.validatedPlayingSeconds,readingSeconds:summary.dialoguePanelWallSeconds,completedMissions:summary.completedMissions,errors:summary.errors.length,sourceUnchanged:summary.sourceUnchanged,summary:summaryPath}));}
