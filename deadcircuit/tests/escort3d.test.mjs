import {test,before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {browserPath} from '../../scripts/browser.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const contexts=new Set(),IDS=['medical-car','stranded-driver'];let server,browser,base=process.env.TEST_URL;
before(async()=>{
 if(!base){server=spawn(process.execPath,[fileURLToPath(new URL('../../server.mjs',import.meta.url))],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('3D escort test server timed out')),10000);server.once('error',reject);server.once('exit',code=>{clearTimeout(timer);reject(Error('3D escort test server exited '+code));});server.stdout.on('data',chunk=>{const match=String(chunk).match(/port (\d+)/);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1]);}});});}
 browser=await chromium.launch({executablePath:browserPath(chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
});
afterEach(async()=>{await Promise.all([...contexts].map(c=>c.close().catch(()=>{})));contexts.clear();});
after(async()=>{await browser?.close();server?.kill();});

async function scenario(){
 const context=await browser.newContext({viewport:{width:1280,height:800}});contexts.add(context);
 await context.addInitScript(()=>localStorage.setItem('dead-circuit-settings-v1',JSON.stringify({mute:true,screenShake:false,reducedMotion:true})));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/deadcircuit/index.html?test=1');
 await page.waitForFunction(()=>window.__dc?.renderer?.is3D,null,{timeout:20000});await page.locator('#newGameBtn').click();
 // Real authored rescue and vehicle objects are brought together in a safe road
 // area for a presentation fixture. Their actual interaction, follow movement,
 // damage, save and reload code is used. This is not campaign-duration evidence.
 await page.evaluate(()=>{
  const g=__dc;g.startMission(9);g.skipDialogue();g.enemies=[];g.effects=[];g.bullets=[];g.input.clear();
  Object.assign(g.player,{x:1040,y:2690,angle:Math.PI,pitch:0,invulnerable:1e6});
  const car=g.level.objects.find(o=>o.id==='medical-car'),person=g.level.objects.find(o=>o.id==='stranded-driver');
  car.x=650;car.y=2690;person.x=790;person.y=2780;g.interactObject(car);g.interactObject(person);
 });
 await page.waitForFunction(()=>['medical-car','stranded-driver'].every(id=>__dc.renderer.actorMap.get('friendly:'+id)?.group.visible),null,{timeout:20000});
 return{page,errors};
}

async function snapshot(page){
 return page.evaluate(async ids=>{
  const {Matrix4}=await import('/deadcircuit/vendor/three.js');const g=__dc,r=g.renderer;
  r.prepareAim(g);r.renderActorInstances();
  const labels=[],text=r.hudContext.fillText;r.hudContext.fillText=function(value,...args){labels.push(String(value));return text.call(this,value,...args);};
  try{r.drawFriendlyHud(g,r.hudContext);}finally{r.hudContext.fillText=text;}
  const models=ids.map(id=>{
   const source=g.level.objects.find(o=>o.id===id),model=r.actorMap.get('friendly:'+id),marker=r.objectMap.get(id);
   if(!model)return{id,exists:false,following:source?.following,delivered:source?.delivered,hp:source?.hp,markerVisible:marker?.group.visible};
   let renderedParts=0;const matrix=new Matrix4();
   // Original actor mesh visibility is intentionally false under batching. Prove
   // its actual world transform exists in a visible instanced draw batch instead.
   model.group.traverse(part=>{
    if(!part.isMesh||part===model.hitbox)return;
    const batch=r.actorBatches.get(part.geometry.uuid+':'+part.material.uuid);if(!batch?.mesh.visible)return;
    for(let i=0;i<batch.count;i++){
     batch.mesh.getMatrixAt(i,matrix);
     if(matrix.elements.every((n,index)=>Math.abs(n-part.matrixWorld.elements[index])<.0001)){renderedParts++;break;}
    }
   });
   return{id,exists:true,type:model.type,friendly:model.friendly,visible:model.group.visible,parented:model.group.parent===r.dynamic,position:model.group.position.toArray(),source:{x:source.x,y:source.y,hp:source.hp,maxHp:source.maxHp,stopped:!!source.stopped,following:source.following,delivered:!!source.delivered},hp:model.hp,maxHp:model.maxHp,stopped:model.stopped,renderedParts,markerVisible:marker?.group.visible};
  });
  return{models,labels,friendlies:g.friendlies.map(o=>o.id),mode:g.mode,phase:g.campaign.phase};
 },IDS);
}

function visibleModels(state){
 assert.deepEqual([...state.friendlies].sort(),[...IDS].sort());
 for(const model of state.models){
  assert.equal(model.exists,true);assert.equal(model.friendly,true);assert.equal(model.visible,true);assert.equal(model.parented,true);
  assert.equal(model.markerVisible,false,'Completed interaction markers must not duplicate the actual escort model');
  assert.ok(model.renderedParts>0,'A visible real draw batch must contain this escort, not merely an unrendered actorMap entry');
  assert.ok(Math.abs(model.position[0]-model.source.x*.02)<1e-7);assert.ok(Math.abs(model.position[2]-model.source.y*.02)<1e-7);
  assert.equal(model.hp,model.source.hp);assert.equal(model.maxHp,model.source.maxHp);
 }
 assert.equal(state.models.find(m=>m.id==='medical-car').type,'vehicle');assert.equal(state.models.find(m=>m.id==='stranded-driver').type,'civilian');
}

test('rescued people and vehicles stay visibly rendered, follow through normal frames and display current health',async()=>{
 const {page,errors}=await scenario();const first=await snapshot(page);visibleModels(first);
 const start=Object.fromEntries(first.models.map(m=>[m.id,m.source]));
 await page.waitForFunction(start=>['medical-car','stranded-driver'].every(id=>{const o=__dc.level.objects.find(o=>o.id===id);return Math.hypot(o.x-start[id].x,o.y-start[id].y)>35;}),start,{timeout:20000});
 const moved=await snapshot(page);visibleModels(moved);
 for(const model of moved.models)assert.ok(Math.hypot(model.source.x-start[model.id].x,model.source.y-start[model.id].y)>35);
 await page.evaluate(()=>{const g=__dc;g.player.x=1300;for(const id of ['medical-car','stranded-driver'])g.damageActor(g.level.objects.find(o=>o.id===id),40,{x:1400,y:2600,faction:'security'});});
 const damaged=await snapshot(page);visibleModels(damaged);
 for(const m of damaged.models){assert.ok(m.hp<m.maxHp);assert.ok(damaged.labels.some(text=>text.includes('随行')&&text.includes(Math.ceil(m.hp)+'/'+m.maxHp)),'Visible escort HUD must show its current health and following state');}
 assert.deepEqual(errors,[]);
});

test('a waiting medical vehicle remains visible and both escort models, health and waiting state survive refresh',async()=>{
 const {page,errors}=await scenario();
 const saved=await page.evaluate(()=>{const g=__dc;g.player.x=1300;const car=g.level.objects.find(o=>o.id==='medical-car');g.interactObject(car);for(const id of ['medical-car','stranded-driver'])g.damageActor(g.level.objects.find(o=>o.id===id),55,{x:1400,y:2600,faction:'security'});g.pause();return g.level.objects.filter(o=>['medical-car','stranded-driver'].includes(o.id)).map(o=>({id:o.id,hp:o.hp,x:o.x,y:o.y,stopped:!!o.stopped}));});
 const waiting=await snapshot(page);visibleModels(waiting);assert.equal(waiting.models.find(m=>m.id==='medical-car').stopped,true);assert.ok(waiting.labels.some(text=>text.includes('等待')&&text.includes('/260')));
 await page.reload();await page.locator('#continueBtn').click();await page.waitForFunction(()=>__dc.friendlies.length===2&&__dc.renderer.actorMap.has('friendly:medical-car'),null,{timeout:20000});
 const restored=await snapshot(page);visibleModels(restored);
 for(const old of saved){const now=restored.models.find(m=>m.id===old.id);assert.equal(now.hp,old.hp);assert.equal(now.stopped,old.stopped);}
 const oldCar=saved.find(o=>o.id==='medical-car'),newCar=restored.models.find(m=>m.id==='medical-car');assert.equal(newCar.source.x,oldCar.x);assert.equal(newCar.source.y,oldCar.y);
 assert.ok(restored.labels.some(text=>text.includes('等待')&&text.includes('/260')));assert.deepEqual(errors,[]);
});

test('downed and delivered escorts leave no healthy model or duplicate marker, including after save and reload',async()=>{
 const {page,errors}=await scenario();
 await page.evaluate(()=>{const g=__dc,person=g.level.objects.find(o=>o.id==='stranded-driver');g.damageActor(person,person.hp+100,{x:1100,y:2700,faction:'security'});});
 await page.waitForFunction(()=>__dc.mode==='dead'&&!__dc.renderer.actorMap.has('friendly:stranded-driver'),null,{timeout:20000});
 const downed=await snapshot(page);assert.equal(downed.models.find(m=>m.id==='stranded-driver').exists,false);assert.equal(downed.models.find(m=>m.id==='stranded-driver').markerVisible,false);assert.ok(!downed.friendlies.includes('stranded-driver'));
 await page.reload();await page.locator('#continueBtn').click();await page.waitForFunction(()=>__dc.mode==='dead',null,{timeout:20000});
 const restoredDown=await snapshot(page);assert.equal(restoredDown.models.find(m=>m.id==='stranded-driver').exists,false);assert.equal(restoredDown.models.find(m=>m.id==='stranded-driver').hp,0);
 // Retrying restores the real checkpoint established by the two interactions.
 await page.evaluate(()=>__dc.retry());await page.waitForFunction(()=>__dc.friendlies.length===2&&__dc.renderer.actorMap.has('friendly:stranded-driver'),null,{timeout:20000});
 const retried=await snapshot(page);assert.equal(retried.models.find(m=>m.id==='stranded-driver').visible,true);
 await page.evaluate(()=>{const g=__dc;for(const o of g.friendlies){o.x=g.level.exit.x-45;o.y=g.level.exit.y+15;}g.player.x=g.level.exit.x-100;g.player.y=g.level.exit.y+15;});
 await page.waitForFunction(()=>__dc.level.objects.filter(o=>['medical-car','stranded-driver'].includes(o.id)).every(o=>o.delivered)&&!__dc.renderer.actorMap.has('friendly:medical-car')&&!__dc.renderer.actorMap.has('friendly:stranded-driver'),null,{timeout:20000});
 await page.evaluate(()=>__dc.pause());const delivered=await snapshot(page);assert.equal(delivered.friendlies.length,0);assert.ok(delivered.models.every(m=>!m.exists&&!m.markerVisible));assert.equal(delivered.labels.length,0);
 await page.reload();await page.locator('#continueBtn').click();await page.waitForFunction(()=>__dc.mode==='playing',null,{timeout:20000});
 const restoredDelivery=await snapshot(page);assert.equal(restoredDelivery.friendlies.length,0);assert.ok(restoredDelivery.models.every(m=>!m.exists&&!m.markerVisible&&m.delivered));assert.equal(restoredDelivery.labels.length,0);assert.deepEqual(errors,[]);
});
