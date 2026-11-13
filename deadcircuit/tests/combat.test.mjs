import {test,before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {browserPath} from '../../scripts/browser.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const contexts=new Set(),WAIT={timeout:10000};let server,browser,BASE=process.env.TEST_URL;

// Controlled arenas isolate combat rules. Every projectile, action and cooldown
// advances only through the application's ordinary requestAnimationFrame loop.
// These tests do not provide natural campaign coverage or duration evidence.
before(async()=>{
 if(!BASE){server=spawn(process.execPath,[fileURLToPath(new URL('../../server.mjs',import.meta.url))],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});BASE=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Combat server timed out')),10000);server.on('error',reject);server.on('exit',code=>{clearTimeout(timer);reject(Error('Combat server exited '+code));});server.stdout.on('data',chunk=>{const m=String(chunk).match(/port (\d+)/);if(m){clearTimeout(timer);resolve('http://127.0.0.1:'+m[1]);}});});}
 browser=await chromium.launch({executablePath:browserPath(chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
});
afterEach(async()=>{await Promise.all([...contexts].map(c=>c.close().catch(()=>{})));contexts.clear();});
after(async()=>{await browser?.close();server?.kill();});
async function frames(page,n=6){await page.evaluate(n=>new Promise(resolve=>{let i=0;const tick=()=>{if(++i>=n)resolve();else requestAnimationFrame(tick);};requestAnimationFrame(tick);}),n);}
async function arena(weapon='kestrel9',spatial=false){
 const context=await browser.newContext({viewport:{width:960,height:640}});contexts.add(context);await context.addInitScript(()=>localStorage.setItem('dead-circuit-settings-v1',JSON.stringify({mute:true,screenShake:false,reducedMotion:true})));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(BASE+'/deadcircuit/index.html?test=1');await page.locator('#practiceBtn').click();await page.waitForFunction(()=>window.__dc?.mode==='playing',null,WAIT);
 await page.evaluate(({weapon,spatial})=>{const g=__dc;g.level={...g.level,width:1800,height:1200,walls:[],covers:[],doors:[],floorZones:[],props:[],objects:[],stages:[{title:'Controlled combat fixture',targets:['not-a-duration-test']}],spawn:{x:400,y:600},exit:{x:1700,y:1100,r:50}};g.enemies=[];g.bullets=[];g.effects=[];g.pickups=[];g.throwables=[];g.sounds=[];g.missionKills=0;g.equipWeapon(0,weapon);g.player.x=400;g.player.y=600;g.player.angle=0;g.player.pitch=0;g.player.weaponIndex=0;g.player.coverId=null;g.player.stance='stand';g.player.action=null;g.player.burst=null;g.player.fireCooldown=0;g.player.invulnerable=1e6;g.camera={x:700,y:600,zoom:1};g.input.clear();g.input.mouse.inside=false;g.input.lastDevice='keyboard';if(!spatial)g.renderer.is3D=false;},{weapon,spatial});
 return{page,errors,close:async()=>{assert.deepEqual(errors,[]);await context.close();contexts.delete(context);}};
}
async function fire(page){await page.waitForFunction(()=>__dc.player.fireCooldown<=0&&!__dc.player.burst,null,WAIT);await page.evaluate(()=>__dc.firePlayer());}
async function aim3D(page,id,height=1){
 return page.evaluate(({id,height})=>{const g=__dc,r=g.renderer,e=g.enemies.find(e=>e.id===id),p=g.player;for(let i=0;i<32;i++){r.prepareAim(g);const q=r.projectPoint({x:e.x,y:e.y,height}),t=Math.tan(r.camera.fov*Math.PI/360);if(Math.hypot(q.ndcX,q.ndcY)<.001)break;p.angle+=Math.atan(q.ndcX*t*r.camera.aspect)*.85;p.pitch=Math.max(-1.08,Math.min(1.08,p.pitch+Math.atan(q.ndcY*t)*.85));}r.prepareAim(g);return{point:g.aimPoint3D,muzzle:g.muzzle3D,projected:r.projectPoint({x:e.x,y:e.y,height}),is3D:r.is3D,camera:r.camera.isPerspectiveCamera,renderCalls:r.webgl.info.render.calls};},{id,height});
}

test('live projectiles hit an enemy, consume ammunition and finish a kill through normal frames',async()=>{
 const s=await arena(),{page}=s;await page.evaluate(()=>__dc.spawnEnemy({id:'target',type:'patrol',x:700,y:600,disabled:true}));const ammo=await page.evaluate(()=>__dc.weaponState.mag);
 await fire(page);await page.waitForFunction(()=>__dc.enemies.find(e=>e.id==='target')?.hp===48,null,WAIT);assert.equal(await page.evaluate(()=>__dc.weaponState.mag),ammo-1);
 await fire(page);await page.waitForFunction(()=>__dc.enemies.find(e=>e.id==='target')?.hp===24,null,WAIT);await fire(page);await page.waitForFunction(()=>__dc.missionKills===1,null,WAIT);assert.equal(await page.evaluate(()=>__dc.weaponState.mag),ammo-3);assert.ok(await page.evaluate(()=>__dc.effects.some(e=>e.type==='body')));await s.close();
});

test('concrete and a closed door stop shots, while holding interaction opens the door once and permits a hit',async()=>{
 const s=await arena('longwatch'),{page}=s;await page.evaluate(()=>{const g=__dc;g.player.x=300;g.level.walls=[{id:'concrete',x:550,y:350,w:40,h:500,active:true,material:'concrete'}];g.spawnEnemy({id:'behind-wall',type:'patrol',x:850,y:600,disabled:true});});
 await fire(page);await page.waitForFunction(()=>__dc.bullets.length===0,null,WAIT);assert.equal(await page.evaluate(()=>__dc.enemies[0].hp),72);assert.equal(await page.evaluate(()=>__dc.hasSight(__dc.player,__dc.enemies[0])),false);
 await page.evaluate(()=>{const g=__dc;g.level.walls=[];g.level.doors=[{id:'test-door',x:550,y:350,w:40,h:500,open:false,locked:false,active:true,hp:80,material:'metal'}];g.player.x=500;});
 await fire(page);await page.waitForFunction(()=>__dc.bullets.length===0,null,WAIT);assert.equal(await page.evaluate(()=>__dc.enemies[0].hp),72);
 await page.keyboard.down('KeyF');await page.waitForFunction(()=>__dc.level.doors[0].open,null,WAIT);await frames(page,25);assert.equal(await page.evaluate(()=>__dc.level.doors[0].open),true,'Holding F must not immediately re-close the same door');await page.keyboard.up('KeyF');assert.equal(await page.evaluate(()=>__dc.hasSight(__dc.player,__dc.enemies[0])),true);
 await fire(page);await page.waitForFunction(()=>__dc.missionKills===1,null,WAIT);await s.close();
});

test('low-cover vault crosses to a free landing and refuses a landing obstructed by a wall',async()=>{
 const s=await arena(),{page}=s;await page.evaluate(()=>{const g=__dc;g.level.covers=[{id:'vault-cover',x:600,y:420,w:64,h:300,low:true,active:true,material:'metal'}];g.player.x=565;g.player.y=570;});
 await page.keyboard.press('KeyC');await page.waitForFunction(()=>__dc.player.coverId==='vault-cover',null,WAIT);await page.keyboard.press('Space');await page.waitForFunction(()=>__dc.player.slideTime>0,null,WAIT);await page.waitForFunction(()=>__dc.player.slideTime<=0,null,WAIT);
 assert.ok(await page.evaluate(()=>__dc.player.x>679));assert.equal(await page.evaluate(()=>{const p=__dc.player,c=__dc.level.covers[0],x=Math.max(c.x,Math.min(c.x+c.w,p.x)),y=Math.max(c.y,Math.min(c.y+c.h,p.y));return Math.hypot(p.x-x,p.y-y)<p.r;}),false,'The player must not stop inside the cover rectangle');
 await page.evaluate(()=>{const g=__dc;g.player.x=565;g.player.y=570;g.player.coverId=null;g.player.stamina=100;g.level.walls=[{id:'blocked-landing',x:680,y:420,w:100,h:300,active:true,material:'concrete'}];g.toggleCover();});await page.keyboard.press('Space');await frames(page,5);assert.equal(await page.evaluate(()=>__dc.player.x),565);assert.equal(await page.evaluate(()=>__dc.player.slideTime>0),false);assert.ok(await page.evaluate(()=>__dc.player.stamina>95));await s.close();
});

test('a thrown fragmentation grenade spends one charge and its actual landing explosion damages the target',async()=>{
 const s=await arena(),{page}=s;await page.evaluate(()=>__dc.spawnEnemy({id:'frag-target',type:'walker',x:845,y:600,disabled:true}));const before=await page.evaluate(()=>__dc.profile.grenades.frag);
 await page.keyboard.press('KeyG');await page.waitForFunction(()=>__dc.throwables.length===1,null,WAIT);assert.equal(await page.evaluate(()=>__dc.profile.grenades.frag),before-1);await page.waitForFunction(()=>__dc.missionKills===1,null,WAIT);assert.ok(await page.evaluate(()=>__dc.effects.some(e=>e.type==='explosion')));assert.equal(await page.evaluate(()=>__dc.profile.grenades.frag),before-1);await s.close();
});

test('a thrown smoke grenade blocks sight in both directions and flash interrupts an active radio call',async()=>{
 const s=await arena(),{page}=s;await page.evaluate(()=>{__dc.spawnEnemy({id:'smoke-target',type:'patrol',x:850,y:600,disabled:true});__dc.throwGrenade('smoke');});await page.waitForFunction(()=>__dc.effects.some(e=>e.type==='smoke'),null,WAIT);
 const smoke=await page.evaluate(()=>{const g=__dc,e=g.enemies[0],s=g.effects.find(e=>e.type==='smoke');return{outToIn:g.hasSight(g.player,e),inToOut:g.hasSight(e,g.player),inside:Math.hypot(e.x-s.x,e.y-s.y)<s.radius};});assert.equal(smoke.inside,true);assert.equal(smoke.outToIn,false);assert.equal(smoke.inToOut,false);
 assert.equal(await page.evaluate(()=>{const g=__dc,s=g.effects.find(e=>e.type==='smoke');g.player.x=s.x-20;g.player.y=s.y;return g.hasSight(g.player,g.enemies[0]);}),false,'Two points inside smoke are still obscured');
 await page.evaluate(()=>{const g=__dc;g.effects=[];g.enemies=[];g.player.x=400;g.player.y=600;g.player.angle=0;g.player.throwCooldown=0;g.spawnEnemy({id:'caller',type:'radio',x:850,y:600});});await frames(page,3);
 await page.evaluate(()=>{const g=__dc,e=g.enemies[0];e.ai.action='calling';e.ai.actionTime=6;e.ai.actionTarget={x:g.player.x,y:g.player.y};e.state='calling';e.telegraph={type:'calling',x:e.x,y:e.y,life:6,maxLife:6};e.suppression=0;g.throwGrenade('flash');});
 await page.waitForFunction(()=>__dc.enemies[0]?.stunTime>2.8&&__dc.enemies[0]?.ai.action===null,null,WAIT);assert.equal(await page.evaluate(()=>__dc.enemies[0].state),'stunned');assert.equal(await page.evaluate(()=>__dc.profile.grenades.flash),2);assert.equal(await page.evaluate(()=>__dc.aiDirector.reinforcements),0);await s.close();
});

test('held fire uses three-round bursts with a recovery gap, and swapping in the armory cancels pending rounds',async()=>{
 const s=await arena('trident'),{page}=s;
 await page.evaluate(()=>{const g=__dc,fire=g.firePlayer;window.__combatShots=[];g.firePlayer=function(...args){const before=this.weaponState.mag;const result=fire.apply(this,args);if(this.weaponState.mag<before)__combatShots.push({time:this.elapsed,weapon:this.weapon});return result;};});
 await page.mouse.move(480,320);if(await page.evaluate(()=>typeof __dc.input.captureMouse==='function')){await page.mouse.click(480,320);await page.waitForFunction(()=>__dc.input.pointerLocked||__dc.input.lookFallback,null,WAIT);}await page.mouse.down();await page.waitForFunction(()=>__combatShots.length>=6,null,WAIT);await page.mouse.up();const shots=await page.evaluate(()=>__combatShots.slice(0,6));
 const gaps=shots.slice(1).map((s,i)=>s.time-shots[i].time);assert.ok(gaps[0]>=.065&&gaps[0]<=.12);assert.ok(gaps[1]>=.065&&gaps[1]<=.12);assert.ok(gaps[2]>=.25,'Burst recovery must be longer than its internal spacing');assert.ok(gaps[3]<=.12&&gaps[4]<=.12);
 await page.evaluate(()=>{const g=__dc;g.player.burst=null;g.player.fireCooldown=0;g.firePlayer();g.showLoadout();});assert.ok(await page.evaluate(()=>__dc.player.burst));await page.locator('[data-weapon="longwatch"]').click();await page.locator('#equipPrimary').click();const before=await page.evaluate(()=>__dc.profile.ammo.longwatch.mag);await page.locator('#armoryReturn').click();await frames(page,15);assert.equal(await page.evaluate(()=>__dc.profile.ammo.longwatch.mag),before);assert.equal(await page.evaluate(()=>__dc.player.burst),null);await s.close();
});

test('directional armour has a real front-side difference and the actual airfield node revokes platform armour',async()=>{
 const s=await arena(),{page}=s;
 const damage=await page.evaluate(async()=>{
  const g=__dc,shield=g.spawnEnemy({id:'armour-shield',type:'shield',x:900,y:400,disabled:true}),warden=g.spawnEnemy({id:'armour-warden',type:'warden',x:1200,y:700,disabled:true});
  const hit=(actor,source)=>{actor.hp=actor.maxHp;const before=actor.hp;g.damageActor(actor,100,{...source,faction:'player'});return before-actor.hp;};
  shield.angle=0;warden.angle=0;
  const shieldFront=hit(shield,{x:shield.x+150,y:shield.y}),shieldSide=hit(shield,{x:shield.x,y:shield.y+150});shield.stunTime=3;const shieldStunned=hit(shield,{x:shield.x+150,y:shield.y});
  const platformFront=hit(warden,{x:warden.x+150,y:warden.y}),platformSide=hit(warden,{x:warden.x,y:warden.y+150});
  const {createLevel}=await import('/deadcircuit/levels.js');g.level=createLevel(16);g.campaign.mission=16;g.campaign.stage=3;const turret=g.spawnEnemy({id:'airfield-turret',type:'turret',x:2700,y:1670});const node=g.level.objects.find(o=>o.id==='tower-override');g.interactObject(node);
  const platformRevoked=hit(warden,{x:warden.x+150,y:warden.y});
  return{shieldFront,shieldSide,shieldStunned,platformFront,platformSide,platformRevoked,nodeComplete:node.completed,revoked:g.campaign.flags.platformsRevoked,turretDisabled:turret.disabled};
 });
 assert.ok(Math.abs(damage.shieldFront-15)<1e-6);assert.equal(damage.shieldSide,100);assert.equal(damage.shieldStunned,100);assert.ok(Math.abs(damage.platformFront-35)<1e-6);assert.equal(damage.platformSide,100);assert.equal(damage.platformRevoked,100);assert.equal(damage.nodeComplete,true);assert.equal(damage.revoked,true);assert.equal(damage.turretDisabled,true);
 // The authored archive cart takes over the physical burden of the evidence box.
 const cart=await page.evaluate(async()=>{const g=__dc,{createLevel}=await import('/deadcircuit/levels.js');g.level=createLevel(15);g.campaign.mission=15;g.campaign.stage=2;g.enemies=[];g.player.carrying='root-backup';const cart=g.level.objects.find(o=>o.id==='freight-cart');g.interactObject(cart);return{carrying:g.player.carrying,following:cart.following,r:cart.r,hp:cart.hp};});assert.deepEqual(cart,{carrying:null,following:true,r:34,hp:260});await s.close();
});

test('the final commander actually spawns, accepts the officer evidence and no longer blocks nearby objectives',async()=>{
 const s=await arena(),{page}=s;await page.evaluate(()=>__dc.startMission(17));await page.locator('#dialogueSkip').click();
 assert.ok(await page.evaluate(()=>__dc.enemies.some(e=>e.id==='final-commander'&&e.type==='commander'&&!e.disabled)),'The encounter must exist in the actual final map');await frames(page,2);
 await page.evaluate(()=>{const g=__dc,o=g.level.objects.find(o=>o.id==='officer-ledger'),e=g.enemies.find(e=>e.id==='final-commander');g.campaign.stage=1;for(const enemy of g.enemies)if(enemy!==e)enemy.disabled=true;g.player.x=o.x-45;g.player.y=o.y;g.player.invulnerable=1e6;e.x=o.x+60;e.y=o.y;e.angle=Math.PI;e.cooldown=10;e.awareness=1;e.ai.target=g.player;e.ai.visible=true;e.ai.memory=10;e.ai.lastKnown={x:g.player.x,y:g.player.y};e.ai.perceptionTimer=10;e.ai.specialCooldown=0;});
 assert.equal(await page.evaluate(()=>__dc.hasSight(__dc.enemies.find(e=>e.id==='final-commander'),__dc.player)),true);
 await page.keyboard.down('KeyF');await page.waitForFunction(()=>__dc.level.objects.find(o=>o.id==='officer-ledger')?.completed,null,WAIT);await page.keyboard.up('KeyF');
 assert.deepEqual(await page.evaluate(()=>{const e=__dc.enemies.find(e=>e.id==='final-commander');return{disabled:e.disabled,state:e.state,flag:__dc.campaign.flags.commanderRefusal};}),{disabled:true,state:'surrendered',flag:true});
 await page.evaluate(()=>{const g=__dc,o=g.level.objects.find(o=>o.id==='city-record'),e=g.enemies.find(e=>e.id==='final-commander');g.player.x=o.x-45;g.player.y=o.y;e.x=o.x+60;e.y=o.y;});
 await page.keyboard.down('KeyF');await page.waitForFunction(()=>__dc.level.objects.find(o=>o.id==='city-record')?.completed,null,WAIT);await page.keyboard.up('KeyF');assert.equal(await page.evaluate(()=>__dc.enemies.find(e=>e.id==='final-commander').disabled),true,'A living surrendered commander must not soft-lock the next evidence interaction');
 // The optional written refusal is a second, independent route to the same ceasefire.
 await page.evaluate(()=>{delete __dc.campaign.flags.commanderRefusal;__dc.startMission(17);});await page.locator('#dialogueSkip').click();await page.evaluate(()=>__dc.interactObject(__dc.level.objects.find(o=>o.id==='commander-order')));
 assert.deepEqual(await page.evaluate(()=>{const e=__dc.enemies.find(e=>e.id==='final-commander');return{disabled:e.disabled,state:e.state,flag:__dc.campaign.flags.commanderRefusal};}),{disabled:true,state:'surrendered',flag:true});await s.close();
});

test('the real perspective renderer crosshair produces a converging 3D shot, while looking skyward misses the same ground enemy',async()=>{
 const s=await arena('kestrel9',true),{page}=s;await page.evaluate(()=>__dc.spawnEnemy({id:'real-3d-target',type:'patrol',x:800,y:600,disabled:true}));await frames(page,2);
 const aim=await aim3D(page,'real-3d-target',1);assert.equal(aim.is3D,true);assert.equal(aim.camera,true);assert.ok(aim.renderCalls>0);assert.ok(Math.hypot(aim.projected.ndcX,aim.projected.ndcY)<.01);assert.equal(aim.point.enemyId,'real-3d-target');assert.ok(aim.muzzle.height>.4&&aim.muzzle.height<2);
 await fire(page);await page.waitForFunction(()=>__dc.enemies.find(e=>e.id==='real-3d-target')?.hp===48,null,WAIT);assert.equal(await page.evaluate(()=>__dc.weaponState.mag),14);
 await page.evaluate(()=>{__dc.player.pitch=.85;__dc.input.lastDevice='gamepad';__dc.renderer.prepareAim(__dc);});await fire(page);const shot=await page.evaluate(()=>({vz:__dc.bullets.at(-1)?.vz,height:__dc.bullets.at(-1)?.height,point:__dc.aimPoint3D}));assert.ok(shot.vz>10);assert.equal(shot.point.enemyId,undefined);await frames(page,45);assert.equal(await page.evaluate(()=>__dc.enemies.find(e=>e.id==='real-3d-target').hp),48,'Skyward bullets must not damage the ground target');await s.close();
});

test('real 3D camera ray and fired rounds agree on tall-wall obstruction and shooting over a low cover',async()=>{
 const s=await arena('kestrel9',true),{page}=s;await page.evaluate(()=>{const g=__dc;g.level={...g.level,walls:[{id:'real-wall',x:570,y:490,w:40,h:220,active:true,material:'concrete'}]};g.spawnEnemy({id:'occluded-3d-target',type:'patrol',x:800,y:600,disabled:true});});await frames(page,2);
 const blocked=await aim3D(page,'occluded-3d-target',1.2);assert.equal(blocked.point.blocked,true);assert.equal(blocked.point.enemyId,undefined);await fire(page);await page.waitForFunction(()=>__dc.bullets.length===0,null,WAIT);assert.equal(await page.evaluate(()=>__dc.enemies[0].hp),72);
 await page.evaluate(()=>{const g=__dc;g.level={...g.level,walls:[],covers:[{id:'real-low-cover',x:570,y:490,w:40,h:220,low:true,active:true,material:'metal'}]};});await frames(page,2);
 const clear=await aim3D(page,'occluded-3d-target',1.2);assert.equal(clear.point.enemyId,'occluded-3d-target');assert.equal(clear.point.blocked,false);await fire(page);await page.waitForFunction(()=>__dc.enemies[0]?.hp===48,null,WAIT);assert.ok(await page.evaluate(()=>__dc.effects.some(e=>e.type==='hit'&&Number.isFinite(e.height))));await s.close();
});
