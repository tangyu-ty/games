import {test,before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {browserPath} from '../../scripts/browser.mjs';

// These are focused state/input fixtures, not natural playthrough or duration evidence.
const {chromium}=createRequire(import.meta.url)('playwright');
const KEY='dead-circuit-campaign-v1',WAIT={timeout:10000},contexts=new Set();
let browser,server,BASE=process.env.TEST_URL;
before(async()=>{
 if(!BASE){
  server=spawn(process.execPath,[fileURLToPath(new URL('../../server.mjs',import.meta.url))],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  BASE=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Dead Circuit test server timed out')),10000);server.on('error',reject);server.on('exit',code=>{clearTimeout(timeout);reject(Error('Test server exited '+code));});server.stdout.on('data',chunk=>{const match=String(chunk).match(/port (\d+)/);if(match){clearTimeout(timeout);resolve('http://127.0.0.1:'+match[1]);}});});
 }
 browser=await chromium.launch({executablePath:browserPath(chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
});
afterEach(async()=>{await Promise.all([...contexts].map(c=>c.close().catch(()=>{})));contexts.clear();});
after(async()=>{await browser?.close();server?.kill();});

async function session({pad=false,denied=false,mobile=false}={}){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},hasTouch:mobile,isMobile:mobile});contexts.add(context);
 await context.addInitScript(({pad,denied})=>{
  localStorage.setItem('dead-circuit-settings-v1',JSON.stringify({mute:true,reducedMotion:true,screenShake:false,difficulty:'standard'}));
  if(pad){window.__pad={connected:true,id:'Fixture standard controller',index:0,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0,touched:false}))};Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[window.__pad]});}
  if(denied)Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>{throw new DOMException('Denied','SecurityError');}});
 },{pad,denied});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(BASE+'/deadcircuit/index.html?test=1');await page.waitForFunction(()=>window.__dc?.mode==='menu'&&window.__dc.input,null,WAIT);
 return{page,errors,close:async()=>{assert.deepEqual(errors,[],'No uncaught browser exceptions');await context.close();contexts.delete(context);}};
}
async function frames(page,count=6){await page.evaluate(count=>new Promise(resolve=>{let n=0;const tick=()=>{if(++n>=count)resolve();else requestAnimationFrame(tick);};requestAnimationFrame(tick);}),count);}
async function advance(page,count){await page.evaluate(count=>{for(let i=0;i<count&&__dc.mode==='playing';i++)__dc.update(1/60);},count);}
async function quiet(page){await page.evaluate(()=>{__dc.enemies=[];__dc.player.invulnerable=1e6;__dc.bullets=[];});}
async function start(page){
 await page.locator('#newGameBtn').click();await page.waitForFunction(()=>__dc.mode==='dialogue',null,WAIT);await page.locator('#dialogueSkip').click();await page.waitForFunction(()=>__dc.mode==='briefing',null,WAIT);
 await page.locator('#startMissionBtn').click();await page.locator('#dialogueSkip').click();await page.waitForFunction(()=>__dc.mode==='playing',null,WAIT);await quiet(page);
}
async function practice(page){await page.locator('#practiceBtn').click();await page.waitForFunction(()=>__dc.mode==='playing'&&__dc.practice,null,WAIT);await quiet(page);}
async function padButton(page,index,pressed){await page.evaluate(({index,pressed})=>{__pad.buttons[index]={pressed,value:pressed?1:0,touched:pressed};},{index,pressed});await page.waitForFunction(({index,pressed})=>__dc.input.padPrevious[index]===pressed,{index,pressed},WAIT);}

test('new campaign starts through real UI, saves a dialogue line, and replacement requires confirmation',async()=>{
 const s=await session(),{page}=s;assert.match(await page.title(),/断线协议/);
 await page.locator('#menuDifficulty').selectOption('story');await page.locator('#newGameBtn').click();
 const first=await page.locator('#dialogueText').innerText();await page.locator('#dialogueNext').click();assert.notEqual(await page.locator('#dialogueText').innerText(),first);
 const expected=await page.evaluate(()=>({line:__dc.campaign.sceneIndex,phase:__dc.campaign.phase}));await page.reload();await page.locator('#continueBtn').click();assert.deepEqual(await page.evaluate(()=>({line:__dc.campaign.sceneIndex,phase:__dc.campaign.phase})),expected);
 await page.keyboard.press('Escape');await page.locator('#pausePort').click();const saved=await page.evaluate(key=>localStorage.getItem(key),KEY);
 await page.locator('#newGameBtn').click();await page.locator('#cancelNew').click();assert.equal(await page.evaluate(key=>localStorage.getItem(key),KEY),saved);
 await page.locator('#newGameBtn').click();await page.locator('#confirmNew').click();assert.equal(await page.evaluate(()=>__dc.campaign.sceneIndex),0);assert.equal(await page.evaluate(()=>__dc.difficulty),'story');await s.close();
});

test('keyboard confirm advances exactly one dialogue line for both Enter and Space',async()=>{
 const s=await session(),{page}=s;await page.locator('#newGameBtn').click();await page.locator('#dialogueNext').focus();let index=await page.evaluate(()=>__dc.campaign.sceneIndex);
 await page.keyboard.press('Enter');await frames(page,4);assert.equal(await page.evaluate(()=>__dc.campaign.sceneIndex),index+1,'Enter must not be handled twice by native button click and the game loop');
 index=await page.evaluate(()=>__dc.campaign.sceneIndex);await page.locator('#dialogueNext').focus();await page.keyboard.press('Space');await frames(page,4);assert.equal(await page.evaluate(()=>__dc.campaign.sceneIndex),index+1,'Space must advance one line');await s.close();
});

test('all fourteen weapons equip from the armory and fire their own pellet, burst and ammunition definitions',async()=>{
 const s=await session(),{page}=s;await practice(page);await page.keyboard.press('Tab');await page.waitForFunction(()=>__dc.mode==='loadout',null,WAIT);assert.equal(await page.locator('[data-weapon]').count(),14);assert.equal(await page.locator('[data-slot]').count(),6);
 const ids=await page.evaluate(()=>__dc.profile.ownedWeapons.slice());
 for(const id of ids){
  await page.locator(`[data-weapon="${id}"]`).click();if(await page.locator('#equipPrimary').isEnabled())await page.locator('#equipPrimary').click();
  await page.locator('#armoryReturn').click();await page.waitForFunction(()=>__dc.mode==='playing',null,WAIT);
  const shot=await page.evaluate(()=>{const g=__dc,w=g.weaponStats();g.player.fireCooldown=0;g.player.slideTime=0;g.player.action=null;g.player.burst=null;g.bullets=[];const before=g.weaponState.mag;g.firePlayer();return{id:g.weapon,spent:before-g.weaponState.mag,bullets:g.bullets.length,pellets:w.pellets,burst:g.player.burst?.remaining||0,expectedBurst:w.burst-1};});
  assert.equal(shot.id,id);assert.equal(shot.spent,1);assert.equal(shot.bullets,shot.pellets,id);assert.equal(shot.burst,shot.expectedBurst,id);
  await page.keyboard.press('Tab');await page.waitForFunction(()=>__dc.mode==='loadout',null,WAIT);
 }
 await s.close();
});

test('real armory UI installs, replaces and detaches magazines while conserving rounds and items',async()=>{
 const s=await session(),{page}=s;await practice(page);await page.keyboard.press('Tab');await page.waitForFunction(()=>__dc.mode==='loadout',null,WAIT);await page.locator('[data-weapon="arclight"]').click();await page.locator('#equipPrimary').click();await page.locator('[data-slot="magazine"]').click();
 await page.locator('[data-attachment="extendedMag"]').click();await page.evaluate(()=>{__dc.profile.ammo.arclight={mag:45,reserve:87};});
 const total=await page.evaluate(()=>Object.values(__dc.profile.ammo.arclight).reduce((a,b)=>a+b,0));const old=await page.evaluate(()=>__dc.profile.ownedAttachments.extendedMag);
 await page.locator('[data-attachment="quickMag"]').click();assert.deepEqual(await page.evaluate(()=>__dc.profile.ammo.arclight),{mag:25,reserve:107});assert.equal(await page.evaluate(()=>__dc.profile.ownedAttachments.extendedMag),old+1);
 const quick=await page.evaluate(()=>__dc.profile.ownedAttachments.quickMag);await page.locator('#removeAttachment').click();assert.equal(await page.evaluate(()=>__dc.profile.ownedAttachments.quickMag),quick+1);assert.equal(await page.evaluate(()=>Object.values(__dc.profile.ammo.arclight).reduce((a,b)=>a+b,0)),total);
 await page.locator('#armoryReturn').click();await page.keyboard.press('KeyR');await page.waitForFunction(()=>__dc.player.action?.type==='reload',null,WAIT);await advance(page,180);assert.equal(await page.evaluate(()=>Object.values(__dc.profile.ammo.arclight).reduce((a,b)=>a+b,0)),total);assert.equal(await page.evaluate(()=>__dc.weaponState.mag),30);await s.close();
});

test('equipping another weapon in the armory cancels a pending burst instead of firing the new gun',async()=>{
 const s=await session(),{page}=s;await practice(page);
 // Pending-burst fixture pauses immediately after the first real trident shot.
 await page.evaluate(()=>{const g=__dc;g.equipWeapon(0,'trident');g.player.weaponIndex=0;g.player.fireCooldown=0;g.firePlayer();g.showLoadout();});
 assert.ok(await page.evaluate(()=>__dc.player.burst?.remaining>0));await page.locator('[data-weapon="longwatch"]').click();await page.locator('#equipPrimary').click();assert.equal(await page.evaluate(()=>__dc.player.burst),null);
 const before=await page.evaluate(()=>__dc.profile.ammo.longwatch.mag);await page.locator('#armoryReturn').click();await frames(page,12);assert.equal(await page.evaluate(()=>__dc.profile.ammo.longwatch.mag),before,'No trigger was pressed after equipping');await s.close();
});

test('an actual attachment reward crate grants its reward and stays collected after a checkpoint retry',async()=>{
 const s=await session(),{page}=s;await start(page);
 // Later-mission fixture checks a real level-data reward without claiming a full campaign.
 await page.evaluate(()=>__dc.startMission(8));await page.locator('#dialogueSkip').click();await quiet(page);
 const before=await page.evaluate(()=>Object.values(__dc.profile.ownedAttachments).reduce((a,b)=>a+b,0));
 await page.evaluate(()=>{const g=__dc,o=g.level.objects.find(o=>o.id==='prototype');if(!o)throw Error('Real prototype crate missing');g.interactObject(o);});
 assert.equal(await page.evaluate(()=>Object.values(__dc.profile.ownedAttachments).reduce((a,b)=>a+b,0)),before+1,'A crate labelled attachment must actually grant one');
 const after=await page.evaluate(()=>({inventory:{...__dc.profile.ownedAttachments},scrap:__dc.profile.scrap}));
 await page.evaluate(()=>{const g=__dc;g.player.invulnerable=0;g.damageActor(g.player,99999,{faction:'infected'});});await page.locator('#retryBtn').click();await page.waitForFunction(()=>__dc.mode==='playing',null,WAIT);
 assert.equal(await page.evaluate(()=>__dc.level.objects.find(o=>o.id==='prototype').completed),true,'Already awarded optional crate must not reset to a farmable reward');assert.equal(await page.evaluate(()=>__dc.availableObjects().some(o=>o.id==='prototype')),false);assert.deepEqual(await page.evaluate(()=>({inventory:__dc.profile.ownedAttachments,scrap:__dc.profile.scrap})),after);await s.close();
});

test('keyboard movement, normalized diagonals, pause, nested journal and window blur release combat input',async()=>{
 const s=await session(),{page}=s;await start(page);const initial=await page.evaluate(()=>({x:__dc.player.x,y:__dc.player.y}));await page.keyboard.down('KeyD');await page.waitForFunction(x=>__dc.player.x>x+10,initial.x,WAIT);await page.keyboard.down('KeyS');await frames(page);assert.ok(await page.evaluate(()=>Math.hypot(__dc.controls.x,__dc.controls.y)<=1.00001));await page.keyboard.up('KeyD');await page.keyboard.up('KeyS');
 await page.keyboard.press('Escape');await page.waitForFunction(()=>__dc.mode==='pause',null,WAIT);const before=await page.evaluate(()=>({elapsed:__dc.elapsed,x:__dc.player.x,stamina:__dc.player.stamina}));await frames(page,8);assert.deepEqual(await page.evaluate(()=>({elapsed:__dc.elapsed,x:__dc.player.x,stamina:__dc.player.stamina})),before);
 await page.locator('#pauseJournal').click();await page.locator('#journalBack').click();assert.equal(await page.evaluate(()=>__dc.mode),'pause');await page.locator('#pauseResume').click();
 await page.keyboard.down('KeyD');await page.evaluate(()=>dispatchEvent(new Event('blur')));await page.waitForFunction(()=>__dc.mode==='pause',null,WAIT);assert.equal(await page.evaluate(()=>__dc.input.keys.size),0);await page.keyboard.up('KeyD');await page.locator('#pauseResume').click();const x=await page.evaluate(()=>__dc.player.x);await frames(page,8);assert.equal(await page.evaluate(()=>__dc.player.x),x);await s.close();
});

test('training, including equipment changes and failed attempts, preserves the existing story save byte for byte',async()=>{
 const s=await session(),{page}=s;await start(page);await page.keyboard.press('Escape');await page.locator('#pausePort').click();const saved=await page.evaluate(key=>localStorage.getItem(key),KEY);
 await practice(page);await page.keyboard.press('Tab');await page.waitForFunction(()=>__dc.mode==='loadout',null,WAIT);await page.locator('[data-weapon="longwatch"]').click();await page.locator('#equipPrimary').click();await page.locator('[data-slot="optic"]').click();await page.locator('[data-attachment="scope6"]').click();await page.locator('#armoryReturn').click();
 await page.evaluate(()=>{__dc.player.invulnerable=0;__dc.damageActor(__dc.player,99999,{faction:'infected'});});await page.waitForFunction(()=>__dc.mode==='dead',null,WAIT);await page.locator('#resultMenu').click();assert.equal(await page.evaluate(()=>__dc.practice),false);assert.equal(await page.evaluate(key=>localStorage.getItem(key),KEY),saved);
 await page.locator('#continueBtn').click();await page.waitForFunction(()=>__dc.mode==='playing',null,WAIT);assert.deepEqual(await page.evaluate(()=>__dc.profile.ownedWeapons),['kestrel9','needle']);await s.close();
});

test('save reload restores the active weapon, position, ammunition and detachable fittings',async()=>{
 const s=await session(),{page}=s;await start(page);await page.keyboard.press('Tab');await page.waitForFunction(()=>__dc.mode==='loadout',null,WAIT);await page.locator('[data-slot="optic"]').click();await page.locator('[data-attachment="redDot"]').click();await page.locator('#armoryReturn').click();await page.keyboard.press('Digit2');await page.waitForFunction(()=>__dc.player.weaponIndex===1,null,WAIT);
 const saved=await page.evaluate(()=>{const g=__dc;g.profile.ammo.needle={mag:11,reserve:79};g.profile.ammo.kestrel9={mag:8,reserve:45};g.pause();return{x:g.player.x,y:g.player.y,weaponIndex:g.player.weaponIndex,ammo:JSON.parse(JSON.stringify(g.profile.ammo)),fit:JSON.parse(JSON.stringify(g.profile.fittings))};});
 await page.reload();await page.locator('#continueBtn').click();await page.waitForFunction(()=>__dc.mode==='playing',null,WAIT);const restored=await page.evaluate(()=>({x:__dc.player.x,y:__dc.player.y,weaponIndex:__dc.player.weaponIndex,ammo:__dc.profile.ammo,fit:__dc.profile.fittings}));assert.deepEqual(restored,saved);await s.close();
});

test('medical actions are interruptible without consuming a kit and completion consumes exactly one',async()=>{
 const s=await session(),{page}=s;await start(page);await page.evaluate(()=>{__dc.player.hp=30;});const kits=await page.evaluate(()=>__dc.profile.medkits);
 await page.keyboard.press('KeyV');await page.waitForFunction(()=>__dc.player.action?.type==='heal',null,WAIT);await page.keyboard.down('KeyD');await frames(page,3);await page.keyboard.up('KeyD');assert.equal(await page.evaluate(()=>__dc.player.action),null);assert.equal(await page.evaluate(()=>__dc.profile.medkits),kits);
 await page.keyboard.press('KeyV');await page.waitForFunction(()=>__dc.player.action?.type==='heal',null,WAIT);await advance(page,150);assert.equal(await page.evaluate(()=>__dc.profile.medkits),kits-1);assert.equal(await page.evaluate(()=>__dc.player.hp),95);await s.close();
});

test('supply collection and pickups replenish the equipped guns without changing the chosen loadout',async()=>{
 const s=await session(),{page}=s;await practice(page);const before=await page.evaluate(()=>{const g=__dc;for(const id of g.profile.loadout)g.profile.ammo[id].reserve=0;g.player.armor=0;g.pickups.push({x:g.player.x,y:g.player.y,r:10,type:'ammo',amount:15,life:5});return{loadout:g.profile.loadout.slice(),medkits:g.profile.medkits};});
 await frames(page,3);for(const reserve of await page.evaluate(()=>__dc.profile.loadout.map(id=>__dc.profile.ammo[id].reserve)))assert.ok(reserve>0);
 await page.evaluate(()=>{const g=__dc,o=g.level.objects.find(o=>o.id==='practice-refill');g.player.x=o.x-40;g.player.y=o.y;});await page.keyboard.down('KeyF');await page.waitForFunction(n=>__dc.profile.medkits>n,before.medkits,WAIT);await page.keyboard.up('KeyF');assert.deepEqual(await page.evaluate(()=>__dc.profile.loadout),before.loadout);assert.ok(await page.evaluate(()=>__dc.player.armor>0));await s.close();
});

test('a saved defeat restores a usable retry with resources and the current mission checkpoint',async()=>{
 const s=await session(),{page}=s;await start(page);const expected=await page.evaluate(()=>({mission:__dc.campaign.mission,stage:__dc.campaign.stage,x:__dc.checkpoint.player.x,y:__dc.checkpoint.player.y}));
 await page.evaluate(()=>{const g=__dc;g.player.invulnerable=0;g.profile.medkits=0;for(const id of g.profile.loadout)g.profile.ammo[id]={mag:0,reserve:0};g.damageActor(g.player,99999,{faction:'infected'});});await page.waitForFunction(()=>__dc.mode==='dead',null,WAIT);await page.reload();await page.locator('#continueBtn').click();await page.waitForFunction(()=>__dc.mode==='dead',null,WAIT);await page.locator('#retryBtn').click();await page.waitForFunction(()=>__dc.mode==='playing',null,WAIT);
 const retry=await page.evaluate(()=>({mission:__dc.campaign.mission,stage:__dc.campaign.stage,x:__dc.player.x,y:__dc.player.y,hp:__dc.player.hp,dead:__dc.player.dead,kits:__dc.profile.medkits,ammo:__dc.profile.loadout.map(id=>__dc.profile.ammo[id])}));for(const key of ['mission','stage','x','y'])assert.equal(retry[key],expected[key]);assert.equal(retry.dead,false);assert.ok(retry.hp>=65&&retry.kits>=1);assert.ok(retry.ammo.every(a=>a.mag>0&&a.reserve>0));await s.close();
});

test('standard gamepad navigates dialogue one line, moves and aims, pauses and handles disconnect',async()=>{
 const s=await session({pad:true}),{page}=s;await page.locator('#newGameBtn').focus();await padButton(page,0,true);await padButton(page,0,false);await page.waitForFunction(()=>__dc.mode==='dialogue',null,WAIT);const first=await page.evaluate(()=>__dc.campaign.sceneIndex);await page.waitForFunction(()=>document.activeElement?.id==='dialogueNext',null,WAIT);await padButton(page,0,true);await padButton(page,0,false);assert.equal(await page.evaluate(()=>__dc.campaign.sceneIndex),first+1);
 await page.locator('#dialogueSkip').click();await page.locator('#startMissionBtn').click();await page.locator('#dialogueSkip').click();await quiet(page);const x=await page.evaluate(()=>__dc.player.x);await page.evaluate(()=>{__pad.axes=[.8,0,0,-.9];});await page.waitForFunction(x=>__dc.player.x>x+12,x,WAIT);assert.ok(await page.evaluate(()=>Math.abs(__dc.player.angle+Math.PI/2)<.01));await page.evaluate(()=>{__pad.axes=[0,0,0,0];});
 await padButton(page,9,true);await padButton(page,9,false);assert.equal(await page.evaluate(()=>__dc.mode),'pause');await padButton(page,9,true);await padButton(page,9,false);assert.equal(await page.evaluate(()=>__dc.mode),'playing');await page.evaluate(()=>{__pad.connected=false;dispatchEvent(new Event('gamepaddisconnected'));});assert.equal(await page.evaluate(()=>__dc.mode),'pause');await s.close();
});

test('denied Gamepad permissions leave actual keyboard navigation and combat movement usable',async()=>{
 const s=await session({denied:true}),{page}=s;await start(page);const x=await page.evaluate(()=>__dc.player.x);await page.keyboard.down('KeyD');await page.waitForFunction(x=>__dc.player.x>x+10,x,WAIT);await page.keyboard.up('KeyD');await page.keyboard.press('Escape');await page.waitForFunction(()=>__dc.mode==='pause',null,WAIT);assert.equal(await page.evaluate(()=>__dc.mode),'pause');await s.close();
});

test('touch aiming releases on cancellation and equipment stays reachable in portrait',async()=>{
 const s=await session({mobile:true}),{page}=s;await practice(page);const touch=await page.context().newCDPSession(page);
 // CDP sends a real active browser pointer, so pointer capture/cancellation are exercised.
 await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:300,y:450,id:99}]});await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:350,y:450,id:99}]});
 await frames(page,3);assert.ok(await page.evaluate(()=>__dc.controls.fire));await touch.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await frames(page,3);assert.equal(await page.evaluate(()=>__dc.controls.fire),false);
 await page.evaluate(()=>__dc.showLoadout());await page.locator('[data-weapon="needle"]').click();await page.locator('[data-slot="optic"]').click();await page.locator('[data-attachment="redDot"]').click();assert.equal(await page.evaluate(()=>__dc.profile.fittings.needle.optic),'redDot');await page.locator('#armoryReturn').click();assert.equal(await page.evaluate(()=>__dc.mode),'playing');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await s.close();
});

test('tampered snapshot fields cannot overwrite controls, select an invalid gun or inject malformed ammunition',async()=>{
 const s=await session(),{page}=s;await start(page);await page.keyboard.press('Escape');
 await page.evaluate(key=>{const saved=JSON.parse(localStorage.getItem(key));saved.current.player.weaponIndex=99;saved.current.player.speed=Infinity;saved.current.player.action={type:'constructor',remaining:-1};saved.current.player.x=-900;saved.current.ammo={needle:{mag:-10,reserve:'broken'},kestrel9:{mag:999999,reserve:999999}};saved.current.update='overwritten';saved.current.level='overwritten';localStorage.setItem(key,JSON.stringify(saved));__dc.practice=true;},KEY);
 // Suppress the old page's pagehide autosave so the malformed fixture, rather
 // than an immediately rewritten valid snapshot, is what the next page reads.
 await page.reload();await page.locator('#continueBtn').click();await page.waitForFunction(()=>__dc.mode==='playing',null,WAIT);await frames(page,8);
 const restored=await page.evaluate(()=>({weaponIndex:__dc.player.weaponIndex,weapon:__dc.weapon,action:__dc.player.action,ammo:__dc.profile.ammo,updateType:typeof __dc.update,x:__dc.player.x,width:__dc.level.width}));assert.equal(restored.weaponIndex,0);assert.equal(restored.weapon,'needle');assert.equal(restored.action,null);assert.equal(restored.updateType,'function');assert.ok(restored.x>=15&&restored.x<restored.width);for(const ammo of Object.values(restored.ammo))assert.ok(Number.isFinite(ammo.mag)&&ammo.mag>=0&&Number.isFinite(ammo.reserve)&&ammo.reserve>=0);await s.close();
});

test('malformed campaign choices, dialogue index, journal entries and field notes recover into a usable clean save',async()=>{
 const s=await session(),{page}=s;await start(page);await page.keyboard.press('Escape');await page.waitForFunction(()=>__dc.mode==='pause',null,WAIT);
 await page.evaluate(key=>{
  const saved=JSON.parse(localStorage.getItem(key)),c=saved.campaign;
  c.choices=null;c.flags={public:'broken',care:-8,contain:900,constructor:{polluted:true},bad_key:true};c.sceneIndex='invalid';c.phase='fieldnote';c.completed=[null,-1,99,'0'];
  c.journal=[null,{},'malformed',{id:7,text:'wrong identifier'},{id:'valid-restored-line',mission:0,speaker:'记录员',text:'唯一的可恢复行动记录'}];
  c.fieldNotes=[null,{},'malformed',{id:'bad-note',mission:0,text:null},{id:'wrong-mission',mission:99,text:'越界记录'},{id:'valid-restored-note',mission:0,title:'恢复的便笺',text:'保留下来的现场文档正文。'}];
  c.activeFieldNote={id:'missing-active-note',title:null,text:null};c.update='overwritten';c.startMission='overwritten';localStorage.setItem(key,JSON.stringify(saved));__dc.practice=true;
 },KEY);
 await page.reload();await page.locator('#continueBtn').click();await page.waitForFunction(()=>__dc.mode==='playing',null,WAIT);await frames(page,5);
 const clean=await page.evaluate(()=>({choices:__dc.campaign.choices,flags:__dc.campaign.flags,index:__dc.campaign.sceneIndex,phase:__dc.campaign.phase,completed:__dc.campaign.completed,journal:__dc.campaign.journal,notes:__dc.campaign.fieldNotes,active:__dc.campaign.activeFieldNote,hasUnknown:'update'in __dc.campaign||'startMission'in __dc.campaign}));
 assert.deepEqual(clean.choices,{});assert.deepEqual(clean.flags,{care:0,contain:100});assert.equal(clean.index,0);assert.equal(clean.phase,'playing');assert.deepEqual(clean.completed,[]);assert.equal(clean.journal.length,1);assert.equal(clean.notes.length,1);assert.equal(clean.active,null);assert.equal(clean.hasUnknown,false);
 await page.keyboard.press('KeyM');await page.waitForFunction(()=>__dc.mode==='journal',null,WAIT);await page.locator('.journal-content summary').click();assert.match(await page.locator('.journal-content').innerText(),/唯一的可恢复行动记录/);await page.locator('#journalRadioTab').click();assert.match(await page.locator('.journal-content').innerText(),/唯一的可恢复行动记录/);await page.locator('#journalNotesTab').click();assert.equal(await page.locator('[data-fieldnote]').count(),1);assert.match(await page.locator('.journal-content').innerText(),/保留下来的现场文档正文/);
 await page.locator('#journalBack').click();await page.evaluate(()=>__dc.save());await page.reload();await page.locator('#continueBtn').click();await page.waitForFunction(()=>__dc.mode==='playing',null,WAIT);await frames(page,4);await s.close();
});

test('unavailable browser storage reports the problem and still starts a playable campaign',async()=>{
 const s=await session(),{page}=s;await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('Storage unavailable','QuotaExceededError');};});await page.locator('#newGameBtn').click();assert.match(await page.locator('#toast').innerText(),/保存/);await page.locator('#dialogueSkip').click();await page.locator('#startMissionBtn').click();await page.locator('#dialogueSkip').click();await page.waitForFunction(()=>__dc.mode==='playing',null,WAIT);assert.equal(await page.evaluate(()=>__dc.storageError),true);await s.close();
});

test('a choice made through its UI saves once and its reply continues after reload without granting another item',async()=>{
 const s=await session(),{page}=s;await start(page);
 // Objective branch fixture: directly interact with first-stage objects; no duration credit.
 await page.evaluate(()=>{const g=__dc;for(const id of g.currentObjective().targets){const o=g.level.objects.find(o=>o.id===id);if(o)g.interactObject(o);}});
 await page.waitForFunction(()=>__dc.mode==='dialogue'&&__dc.campaign.phase==='interlude',null,WAIT);await page.locator('#dialogueSkip').click();await page.locator('[data-choice="1"]').click();const chosen=await page.evaluate(()=>({choice:__dc.campaign.choices[0],inventory:{...__dc.profile.ownedAttachments},flags:{...__dc.campaign.flags}}));assert.equal(chosen.choice,1);
 await page.reload();await page.locator('#continueBtn').click();assert.equal(await page.evaluate(()=>__dc.campaign.phase),'reply');await page.locator('#dialogueSkip').click();await page.waitForFunction(()=>__dc.mode==='playing',null,WAIT);assert.deepEqual(await page.evaluate(()=>__dc.profile.ownedAttachments),chosen.inventory);assert.deepEqual(await page.evaluate(()=>__dc.campaign.flags),chosen.flags);assert.equal(await page.evaluate(()=>__dc.campaign.stage),1);await s.close();
});
