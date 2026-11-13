import {test,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {browserPath} from '../../scripts/browser.mjs';
import {LEVELS,createLevel} from '../levels.js';
import {UNIT_SCALE,worldTo3D,actorMetrics,obstacleDescriptor,SCENE_THEMES} from '../render3d.js';

const close=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<1e-8,message||`${actual} != ${expected}`);
const {chromium}=createRequire(import.meta.url)('playwright');
const contexts=new Set();let server,browser,base=process.env.TEST_URL;
async function boot(){
 if(browser)return;
 if(!base){
  server=spawn(process.execPath,[fileURLToPath(new URL('../../server.mjs',import.meta.url))],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('3D world test server timed out')),10000);server.once('error',reject);server.once('exit',code=>{clearTimeout(timer);reject(Error('3D world test server exited '+code));});server.stdout.on('data',chunk=>{const m=String(chunk).match(/port (\d+)/);if(m){clearTimeout(timer);resolve('http://127.0.0.1:'+m[1]);}});});
 }
 browser=await chromium.launch({executablePath:browserPath(chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
}
async function fixture(){
 await boot();const context=await browser.newContext({viewport:{width:1280,height:800}});contexts.add(context);
 await context.addInitScript(()=>localStorage.setItem('dead-circuit-settings-v1',JSON.stringify({mute:true,screenShake:false,reducedMotion:true})));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/deadcircuit/index.html?test=1');
 await page.waitForFunction(()=>window.__dc?.renderer?.is3D,null,{timeout:20000});
 await page.locator('#practiceBtn').click();await page.waitForFunction(()=>__dc.mode==='playing',null,{timeout:20000});
 // Presentation fixtures isolate actual renderer behaviour. Teleports and paused
 // time are deliberately not natural-input campaign or playtime evidence.
 await page.evaluate(()=>{const g=__dc;g.mode='pause';g.input.clear();g.enemies=[];g.effects=[];g.bullets=[];g.player.invulnerable=1e6;});
 return{page,errors};
}
afterEach(async()=>{await Promise.all([...contexts].map(c=>c.close().catch(()=>{})));contexts.clear();});
after(async()=>{await browser?.close();server?.kill();});

test('world-to-3D coordinates preserve horizontal distances, handedness and independent metric height',()=>{
 close(UNIT_SCALE,.02);
 assert.deepEqual(worldTo3D({x:200,y:350},1.75),{x:4,y:1.75,z:7});
 assert.deepEqual(worldTo3D({x:-100,y:0},2.1),{x:-2,y:2.1,z:0});
 const a=worldTo3D({x:30,y:40}),b=worldTo3D({x:330,y:440});
 close(Math.hypot(b.x-a.x,b.z-a.z),10);
 close(actorMetrics('patrol').height,1.75);close(actorMetrics('drone').base,1.5);
 assert.ok(actorMetrics('brute').height>actorMetrics('runner').height);
});

test('all eighteen authored maps retain exact physical footprints and door clearance in their 3D descriptors',()=>{
 const themes=new Set(),structures=new Set();
 for(const meta of LEVELS){
  const level=createLevel(meta.id);assert.ok(SCENE_THEMES[level.theme],`Missing 3D theme ${level.theme}`);themes.add(level.theme);
  const physical=[];
  for(const kind of ['wall','cover','door'])for(const rect of level[kind==='wall'?'walls':kind==='cover'?'covers':'doors']){
   const d=obstacleDescriptor(rect,kind);physical.push([kind,d.minX,d.maxX,d.minZ,d.maxZ,d.height]);
   close(d.minX,rect.x*UNIT_SCALE);close(d.maxX,(rect.x+rect.w)*UNIT_SCALE);
   close(d.minZ,rect.y*UNIT_SCALE);close(d.maxZ,(rect.y+rect.h)*UNIT_SCALE);
   close(d.minY,0);close(d.maxY,d.height);
   assert.ok(d.maxX>d.minX&&d.maxZ>d.minZ&&d.height>0);
   close(d.height,kind==='cover'?(rect.low===false?2.3:1.05):3.2);
   if(kind==='door'){
    assert.ok(Math.max(d.maxX-d.minX,d.maxZ-d.minZ)>2*34*UNIT_SCALE+.4,'An authored open door must accommodate the real vehicle diameter with clearance');
    assert.ok(d.height>actorMetrics('patrol').height+.5,'Standing actors must fit below the door lintel');
   }
  }
  structures.add(JSON.stringify(physical));
 }
 assert.equal(themes.size,18);assert.equal(structures.size,18,'Different theme names alone do not count as different 3D geometry');
});

test('3D blocker descriptors respect real open, disabled and destroyed game state',()=>{
 const rect={id:'physical-state',x:100,y:200,w:40,h:160,active:true,hp:90};
 assert.equal(obstacleDescriptor(rect,'wall').collidable,true);
 assert.equal(obstacleDescriptor({...rect,open:false},'door').collidable,true);
 assert.equal(obstacleDescriptor({...rect,open:true},'door').collidable,false);
 for(const change of [{active:false},{destroyed:true},{hp:0},{hp:-1}]){
  for(const kind of ['wall','cover','door'])assert.equal(obstacleDescriptor({...rect,...change},kind).collidable,false);
 }
 assert.equal(obstacleDescriptor({...rect,low:true},'cover').height,1.05);
 assert.equal(obstacleDescriptor({...rect,low:false},'cover').height,2.3);
});

test('the actual WebGL scene uses each map physical footprint, metric height and distinct theme geometry',async()=>{
 const {page,errors}=await fixture();
 const scenes=await page.evaluate(async()=>{
  const {createLevel}=await import('/deadcircuit/levels.js');const g=__dc,r=g.renderer,out=[];
  for(let id=0;id<18;id++){
   const l=createLevel(id);g.level=l;g.player.x=l.spawn.x;g.player.y=l.spawn.y;g.player.angle=0;g.player.pitch=0;g.player.stance='stand';g.player.aimBlend=0;g.enemies=[];
   r.prepareAim(g);r.webgl.render(r.scene,r.camera);
   const descriptors=r.colliders.map(c=>({id:c.def.id,kind:c.kind,x:c.def.x,y:c.def.y,w:c.def.w,h:c.def.h,low:c.def.low,bounds:{min:c.bounds.min.toArray(),max:c.bounds.max.toArray()},scale:c.mesh.scale.toArray(),visible:c.mesh.visible,collidable:c.collidable}));
   let instances=0,meshCount=0;r.world.traverse(o=>{if(o.isMesh)meshCount++;if(o.isInstancedMesh)instances+=o.count;});
   out.push({id,theme:l.theme,descriptors,expected:l.walls.length+l.covers.length+l.doors.length,meshCount,instances,camera:r.camera.type,drawCalls:r.webgl.info.render.calls,background:r.scene.background.getHexString()});
  }
  return out;
 });
 const shapeSignatures=new Set(),backgrounds=new Set();
 for(const s of scenes){
  assert.equal(s.camera,'PerspectiveCamera');assert.equal(s.descriptors.length,s.expected);assert.ok(s.meshCount>15&&s.instances>20&&s.drawCalls>0);
  for(const d of s.descriptors){
   close(d.bounds.min[0],d.x*UNIT_SCALE);close(d.bounds.max[0],(d.x+d.w)*UNIT_SCALE);
   close(d.bounds.min[2],d.y*UNIT_SCALE);close(d.bounds.max[2],(d.y+d.h)*UNIT_SCALE);
   const height=d.kind==='cover'?(d.low===false?2.3:1.05):3.2;
   close(d.bounds.max[1],height);close(d.scale[0],d.w*UNIT_SCALE);close(d.scale[1],height);close(d.scale[2],d.h*UNIT_SCALE);
  }
  shapeSignatures.add(JSON.stringify(s.descriptors.map(d=>[d.kind,d.bounds])));backgrounds.add(s.background);
 }
 assert.equal(shapeSignatures.size,18);assert.ok(backgrounds.size>=15);assert.deepEqual(errors,[]);
});

test('actual camera and aiming blockers update after a door opens, recloses, is destroyed, and a cover moves',async()=>{
 const {page,errors}=await fixture();
 const state=await page.evaluate(()=>{
  const g=__dc,r=g.renderer;
  const door={id:'dynamic-door',x:400,y:400,w:26,h:160,open:false,locked:false,active:true,hp:90};
  const cover={id:'dynamic-cover',x:660,y:360,w:110,h:60,low:false,active:true,hp:120};
  g.level={id:900,theme:'hospital',width:1400,height:1000,spawn:{x:450,y:480},exit:{x:1200,y:800},walls:[{id:'wall-top',x:400,y:100,w:26,h:300,active:true},{id:'wall-bottom',x:400,y:560,w:26,h:340,active:true}],doors:[door],covers:[cover],objects:[],props:[],floorZones:[],stages:[]};
  Object.assign(g.player,{x:450,y:480,angle:0,pitch:0,stance:'stand',aimBlend:0});
  const sample=()=>{r.prepareAim(g);const d=r.colliders.find(c=>c.def.id===door.id),c=r.colliders.find(c=>c.def.id===cover.id);return{distance:r.cameraData.collisionDistance,desired:r.cameraData.desiredDistance,doorVisible:d.mesh.visible,doorCollidable:d.collidable,doorAim:r.solidAim.includes(d.mesh),coverBounds:{min:c.bounds.min.toArray(),max:c.bounds.max.toArray()},coverPosition:c.mesh.position.toArray()};};
  const closed=sample();door.open=true;const open=sample();door.open=false;const reclosed=sample();door.hp=0;const destroyed=sample();cover.x=840;cover.y=620;const moved=sample();
  return{closed,open,reclosed,destroyed,moved};
 });
 assert.equal(state.closed.doorVisible,true);assert.equal(state.closed.doorCollidable,true);assert.equal(state.closed.doorAim,true);
 for(const s of [state.open,state.destroyed]){assert.equal(s.doorVisible,false);assert.equal(s.doorCollidable,false);assert.equal(s.doorAim,false);assert.ok(s.distance>state.closed.distance+2);}
 assert.equal(state.reclosed.doorVisible,true);assert.equal(state.reclosed.doorCollidable,true);close(state.reclosed.distance,state.closed.distance);
 close(state.moved.coverBounds.min[0],840*UNIT_SCALE);close(state.moved.coverBounds.min[2],620*UNIT_SCALE);close(state.moved.coverPosition[0],(840+55)*UNIT_SCALE);close(state.moved.coverPosition[2],(620+30)*UNIT_SCALE);
 assert.deepEqual(errors,[]);
});

test('standing, crouched and aiming shoulder cameras remain outside walls and keep the actual near plane clear at tight corners',async()=>{
 const {page,errors}=await fixture();
 const results=await page.evaluate(async()=>{
  const THREE=await import('/deadcircuit/vendor/three.js'),g=__dc,r=g.renderer,out=[];
  g.level={id:901,theme:'archive',width:1200,height:1200,spawn:{x:445,y:445},exit:{x:1050,y:1050},walls:[{id:'corner-west',x:400,y:200,w:26,h:700,active:true},{id:'corner-north',x:200,y:400,w:700,h:26,active:true}],doors:[],covers:[],objects:[],props:[],floorZones:[],stages:[]};
  Object.assign(g.player,{x:445,y:445});
  for(const stance of ['stand','crouch'])for(const ads of [0,1])for(const pitch of [-.75,0,.75])for(let index=0;index<8;index++){
   Object.assign(g.player,{stance,aimBlend:ads,pitch,angle:index*Math.PI/4});r.prepareAim(g);
   const position=r.camera.position,blockers=r.colliders.filter(c=>c.collidable);
   const centerBlocked=blockers.some(c=>c.bounds.containsPoint(position));
   let nearBlocked=false;
   // Nine positions sample the actual perspective near plane, rather than an
   // arbitrary radius or only the camera centre.
   for(const x of [-1,0,1])for(const y of [-1,0,1]){const point=new THREE.Vector3(x,y,-1).unproject(r.camera);if(blockers.some(c=>c.bounds.containsPoint(point)))nearBlocked=true;}
   out.push({stance,ads,pitch,index,centerBlocked,nearBlocked,height:position.y,collision:r.cameraData.collisionDistance,desired:r.cameraData.desiredDistance});
  }
  return out;
 });
 assert.equal(results.length,96);assert.ok(results.some(s=>s.collision<s.desired-.1),'The test must actually exercise camera collision shortening');
 for(const s of results){assert.equal(s.centerBlocked,false,JSON.stringify(s));assert.equal(s.nearBlocked,false,JSON.stringify(s));assert.ok(Number.isFinite(s.height)&&s.height>.07);}
 assert.deepEqual(errors,[]);
});
