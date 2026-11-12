import {browserPath} from '../scripts/browser.mjs';
import {test,before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
let BASE=process.env.TEST_URL;
let browser,server;
const liveContexts=new Set();
const WAIT={timeout:5000};
before(async()=>{
 if(!BASE){
  server=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  BASE=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Test server startup timed out')),10000);server.stdout.on('data',chunk=>{const match=String(chunk).match(/port (\d+)/);if(match){clearTimeout(timeout);resolve('http://127.0.0.1:'+match[1]);}});server.on('error',reject);server.on('exit',code=>{clearTimeout(timeout);reject(Error('Test server exited: '+code));});});
 }
 browser=await chromium.launch({executablePath:browserPath(chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
});
afterEach(async()=>{await Promise.all([...liveContexts].map(context=>context.close().catch(()=>{})));liveContexts.clear();});
after(async()=>{await browser?.close();server?.kill();});

async function session(options={},mockPad=false){
 const context=await browser.newContext({viewport:{width:1280,height:800},...options});liveContexts.add(context);
 await context.addInitScript(({mockPad})=>{
  localStorage.setItem('tidekeeper-settings-v1',JSON.stringify({mute:true,reduced:true,aim:true}));
  if(mockPad){window.__pad={connected:true,index:0,id:'Test standard controller',mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0,touched:false}))};Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[window.__pad]});}
 },{mockPad});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${BASE}/?test=1`);await page.waitForFunction(()=>window.__game?.mode==='menu');
 return {page,context,errors,async close(){try{assert.deepEqual(errors,[],'No uncaught browser exceptions');}finally{await context.close();liveContexts.delete(context);}}};
}
async function start(page,keyboard=false){
 if(keyboard){await page.locator('#startBtn').focus();await page.keyboard.press('Space');}
 else await page.locator('#startBtn').click();
 assert.equal(await page.evaluate(()=>__game.mode),'dialog');
 let seen=0;
 while(await page.locator('#nextDialogue').isVisible()){
  await page.locator('#nextDialogue').click();
  if(++seen>20)throw Error('Introduction did not finish');
 }
 await page.waitForFunction(()=>__game.mode==='playing',null,WAIT);await page.locator('#hud').waitFor({state:'visible',...WAIT});
 assert.ok(seen>=2,'Introduction contains multiple dialogue lines');
 await quiet(page);
}
async function quiet(page){await page.evaluate(()=>{__game.spawnTimer=1e6;__game.player.invuln=1e6;});}
async function advance(page,frames){return page.evaluate(frames=>{for(let i=0;i<frames&&__game.mode==='playing';i++)__game.update(1/60);return __game.mode;},frames);}
async function drainDialogue(page){let count=0;while(await page.locator('#nextDialogue').isVisible()){await page.locator('#nextDialogue').click();if(++count>30)throw Error('Dialogue failed to terminate');}return count;}
async function button(page,index,pressed){
 await page.evaluate(({index,pressed})=>{window.__pad.buttons[index]={pressed,value:pressed?1:0,touched:pressed};},{index,pressed});
 await page.waitForFunction(({index,pressed})=>__game.oldButtons[index]===pressed,{index,pressed},WAIT);
}
async function observedFrames(page,count=6){
 await page.evaluate(count=>{window.__frameProbe=0;const tick=()=>{window.__frameProbe++;if(window.__frameProbe<count)requestAnimationFrame(tick);};requestAnimationFrame(tick);},count);
 await page.waitForFunction(count=>window.__frameProbe>=count,count,WAIT);
}

test('port, vessel selection, guide, archive and persisted accessibility/audio settings',async()=>{
 const s=await session();const {page}=s;
 assert.equal(await page.title(),'潮汐信使 · TIDEKEEPER');
 await page.locator('[data-ship="stone"]').click();assert.equal(await page.evaluate(()=>__game.ship),'stone');
 await page.locator('#difficulty').selectOption('story');
 await page.locator('#guideBtn').click();assert.ok(await page.locator('#guideClose').isVisible());assert.match(await page.locator('#modalContent').innerText(),/共鸣/);await page.locator('#guideClose').click();
 await page.locator('#archiveBtn').click();assert.equal(await page.locator('.archive-list details').count(),5);assert.match(await page.locator('#modalContent').innerText(),/尚未送达/);await page.locator('#archiveClose').click();
 await page.locator('#settingsBtn').click();await page.locator('#reduceCheck').check();await page.locator('#audioCheck').uncheck();await page.locator('#settingsClose').click();
 const settings=await page.evaluate(()=>JSON.parse(localStorage.getItem('tidekeeper-settings-v1')));assert.equal(settings.reduced,true);assert.equal(settings.mute,true);
 await start(page,true);const p=await page.evaluate(()=>({hp:__game.player.maxHp,difficulty:__game.difficulty}));assert.equal(p.hp,160);assert.equal(p.difficulty,'story');
 await s.close();
});

test('keyboard movement, diagonal normalization, dodge cooldown, pulse clearing and pause freeze',async()=>{
 const s=await session();const {page}=s;await start(page);
 const x=await page.evaluate(()=>__game.player.x);await page.keyboard.down('KeyD');await page.waitForFunction(x=>__game.player.x>x+12,x,WAIT);await page.keyboard.up('KeyD');
 assert.ok(await page.evaluate(x=>__game.player.x>x+12,x),'Actual held movement key moves the ship');
 const input=await page.evaluate(()=>{__game.keys.add('KeyD');__game.keys.add('KeyS');const m=__game.moveInput();__game.keys.clear();return m;});assert.ok(Math.abs(Math.hypot(input.x,input.y)-1)<1e-8);
 await page.keyboard.press('Space');const first=await page.evaluate(()=>({dash:__game.dashCount,cd:__game.player.dashCD}));assert.equal(first.dash,1);assert.ok(first.cd>1);
 await page.keyboard.press('Space');assert.equal(await page.evaluate(()=>__game.dashCount),1,'Cooldown prevents dodge spam');
 await page.evaluate(()=>{const g=__game,p=g.player;g.bullets=[{x:p.x+50,y:p.y,r:5,vx:0,vy:0,enemy:true,life:7},{x:p.x+450,y:p.y,r:5,vx:0,vy:0,enemy:true,life:7},{x:p.x+50,y:p.y,r:4,vx:0,vy:0,enemy:false,life:7,hit:[],damage:1,pierce:0}];});
 await page.keyboard.press('KeyE');const pulse=await page.evaluate(()=>({enemy:__game.bullets.filter(b=>b.enemy).length,friendly:__game.bullets.filter(b=>!b.enemy).length,cd:__game.player.pulseCD,effect:__game.effects.some(e=>e.type==='pulse')}));assert.equal(pulse.enemy,1);assert.equal(pulse.friendly,1);assert.ok(pulse.cd>8);assert.equal(pulse.effect,true);
 await page.keyboard.press('Escape');await page.waitForFunction(()=>__game.mode==='paused');const state=await page.evaluate(()=>({time:__game.runTime,x:__game.player.x,cd:__game.player.pulseCD}));await observedFrames(page);
 assert.deepEqual(await page.evaluate(()=>({time:__game.runTime,x:__game.player.x,cd:__game.player.pulseCD})),state,'Simulation and cooldowns freeze while paused');
 await page.keyboard.press('Escape');await page.waitForFunction(()=>__game.mode==='playing');await page.waitForFunction(t=>__game.runTime>t,state.time,WAIT);assert.ok(await page.evaluate(t=>__game.runTime>t,state.time));await s.close();
});

test('automatic cannon really destroys a vessel, attracts its XP and opens a working relic choice',async()=>{
 const s=await session();const {page}=s;await start(page);
 await page.evaluate(()=>{const g=__game;g.player.crit=0;g.xp=g.nextXp-3;g.fireTimer=0;const e=g.spawn('skiff',0);e.x=g.player.x+90;e.y=g.player.y;e.speed=0;e.hp=40;e.attack=1e6;g.spawnTimer=1e6;});
 await advance(page,240);assert.equal(await page.evaluate(()=>__game.mode),'upgrade');
 const killed=await page.evaluate(()=>({kills:__game.kills,level:__game.level,pending:__game.pendingLevel,enemies:__game.enemies.length}));assert.equal(killed.kills,1);assert.equal(killed.level,2);assert.equal(killed.pending,1);assert.equal(killed.enemies,0);
 assert.equal(await page.locator('.upgrade-card').count(),3);await page.locator('#upgrade0').click();await page.waitForFunction(()=>__game.mode==='playing');
 const result=await page.evaluate(()=>({count:Object.values(__game.upgradeCounts).reduce((a,b)=>a+b,0),saved:JSON.parse(localStorage.getItem('tidekeeper-voyage-v1')).upgradeCounts}));assert.equal(result.count,1);assert.equal(Object.values(result.saved).reduce((a,b)=>a+b,0),1);await s.close();
});

test('all five deliveries, final boss second-phase attacks, lethal cannon hit and complete ending',async()=>{
 const s=await session();const {page}=s;await start(page);
 for(let stage=0;stage<4;stage++){
  assert.equal(await page.evaluate(()=>__game.stage),stage);
  await page.evaluate(stage=>{const g=__game;g.stageKills=[16,23,30,36][stage];g.spawnTimer=1e6;g.player.x=g.beacons[0].x;g.player.y=g.beacons[0].y;g.update(1/60);},stage);
  assert.equal(await page.evaluate(()=>__game.mode),'dialog');assert.ok((await drainDialogue(page))>=1);
  assert.ok(await page.locator('#nextSea').isVisible());assert.match(await page.locator('#modalContent').innerText(),/已送达/);await page.locator('#nextSea').click();await page.waitForFunction(stage=>__game.mode==='playing'&&__game.stage===stage+1,stage);await quiet(page);
 }
 await page.evaluate(()=>{const g=__game;g.stageTime=3.1;g.spawnTimer=1e6;g.player.invuln=1e6;g.update(1/60);});
 assert.equal(await page.evaluate(()=>__game.bossActive),true);
 await page.evaluate(()=>{const g=__game,e=g.enemies.find(e=>e.type==='boss');e.hp=e.maxHp*.45;e.attack=0;e.age=16;e.speed=0;g.update(1/60);});
 assert.equal(await page.evaluate(()=>__game.bullets.filter(b=>b.enemy).length),16,'Boss switches to radial barrage below half health');
 await page.evaluate(()=>{const g=__game,e=g.enemies.find(e=>e.type==='boss');g.bullets=[];g.player.x=900;g.player.y=680;g.player.crit=0;g.player.magnet=0;g.nextXp=1000;e.x=1000;e.y=680;e.hp=1;e.attack=1e6;g.fireTimer=0;});
 await advance(page,30);assert.equal(await page.evaluate(()=>__game.bossDefeated),true,'Real player cannon defeats the boss');
 await page.evaluate(()=>{const g=__game;g.player.x=g.beacons[0].x;g.player.y=g.beacons[0].y;g.update(1/60);});
 await drainDialogue(page);
 // The final letter is reviewed before the epilogue, just like the earlier four.
 if(await page.locator('#nextSea').isVisible()){await page.locator('#nextSea').click();await drainDialogue(page);}
 if(await page.locator('#endingBtn').isVisible()){await page.locator('#endingBtn').click();await drainDialogue(page);}
 await page.waitForFunction(()=>__game.mode==='won');
 const completed=await page.evaluate(()=>({wins:__game.profile.wins,letters:__game.profile.letters,achievements:__game.profile.achievements,save:localStorage.getItem('tidekeeper-voyage-v1')}));assert.equal(completed.wins,1);assert.deepEqual(completed.letters,[0,1,2,3,4]);assert.ok(completed.achievements.includes('keeper'));assert.ok(completed.achievements.includes('collector'));assert.equal(completed.save,null);
 await page.locator('#endPort').click();assert.ok(await page.locator('#menu').isVisible());assert.equal(await page.locator('#continueBtn').isVisible(),false);await page.locator('#archiveBtn').click();assert.equal(await page.locator('.archive-list details.locked').count(),0);await s.close();
});

test('save, return to port and continue restore upgraded vessel, voyage progress and position',async()=>{
 const s=await session();const {page}=s;await start(page);
 const expected=await page.evaluate(()=>{const g=__game;g.applyUpgrade('damage');g.applyUpgrade('multishot');g.applyUpgrade('regen');g.stage=2;g.stageTime=14;g.stageKills=7;g.level=4;g.xp=3;g.shells=11;g.player.x=1120;g.player.y=420;g.enemies=[];return {damage:g.player.damage,multishot:g.player.multishot,regen:g.regen};});
 await page.keyboard.press('Escape');await page.locator('#quitBtn').click();assert.ok(await page.locator('#continueBtn').isVisible());await page.locator('#continueBtn').click();await page.waitForFunction(()=>__game.mode==='playing');
 const actual=await page.evaluate(()=>({damage:__game.player.damage,multishot:__game.player.multishot,regen:__game.regen,stage:__game.stage,kills:__game.stageKills,level:__game.level,shells:__game.shells,x:__game.player.x,y:__game.player.y,upgrades:__game.upgradeCounts}));
 assert.equal(actual.damage,expected.damage);assert.equal(actual.multishot,expected.multishot);assert.equal(actual.regen,expected.regen);assert.equal(actual.stage,2);assert.equal(actual.kills,7);assert.equal(actual.level,4);assert.equal(actual.shells,11);assert.equal(actual.x,1120);assert.equal(actual.y,420);assert.deepEqual(actual.upgrades,{damage:1,multishot:1,regen:1});await s.close();
});

test('standard gamepad polls movement, deadzone, dodge, Start pause, D-pad navigation and relic confirmation',async()=>{
 const s=await session({},true);const {page}=s;await start(page);assert.match(await page.locator('#padStatus').innerText(),/手柄已连接/);
 const x=await page.evaluate(()=>__game.player.x);await page.evaluate(()=>__pad.axes[0]=.85);await page.waitForFunction(x=>__game.player.x>x+10,x,WAIT);await page.evaluate(()=>__pad.axes[0]=0);assert.ok(await page.evaluate(x=>__game.player.x>x+10,x));
 await page.evaluate(()=>__pad.axes[0]=.1);await page.waitForFunction(()=>__game.pad.x===0,null,WAIT);const stopped=await page.evaluate(()=>__game.player.x);await observedFrames(page);assert.equal(await page.evaluate(()=>__game.player.x),stopped);await page.evaluate(()=>__pad.axes[0]=0);
 await button(page,0,true);assert.equal(await page.evaluate(()=>__game.dashCount),1);await button(page,0,false);
 await button(page,9,true);assert.equal(await page.evaluate(()=>__game.mode),'paused');await button(page,9,false);
 await page.waitForFunction(()=>document.activeElement?.id==='resumeBtn');await button(page,13,true);assert.equal(await page.evaluate(()=>document.activeElement?.id),'pauseGuide');await button(page,13,false);
 await button(page,0,true);await page.locator('#guideClose').waitFor({state:'visible',...WAIT});assert.ok(await page.locator('#guideClose').isVisible());await button(page,0,false);await page.waitForFunction(()=>document.activeElement?.id==='guideClose',null,WAIT);await button(page,0,true);await button(page,0,false);await page.locator('#resumeBtn').waitFor({state:'visible',...WAIT});assert.ok(await page.locator('#resumeBtn').isVisible());
 await button(page,9,true);await button(page,9,false);assert.equal(await page.evaluate(()=>__game.mode),'playing');
 await page.evaluate(()=>{__game.level=2;__game.pendingLevel=1;__game.chooseUpgrade();});await page.waitForFunction(()=>document.activeElement?.id==='upgrade0');await button(page,13,true);assert.equal(await page.evaluate(()=>document.activeElement?.id),'upgrade1');await button(page,13,false);await button(page,0,true);await button(page,0,false);
 assert.equal(await page.evaluate(()=>__game.mode),'playing');assert.equal(await page.evaluate(()=>Object.values(__game.upgradeCounts).reduce((a,b)=>a+b,0)),1);await s.close();
});

test('touch viewport stays inside screen and on-screen movement, dodge and resonance work',async()=>{
 const s=await session({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});const {page}=s;
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Port fits narrow screen');await start(page);await page.locator('#touchControls').waitFor({state:'visible',...WAIT});assert.ok(await page.locator('#touchControls').isVisible());
 const x=await page.evaluate(()=>__game.player.x);const box=await page.locator('[data-dir="right"]').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForFunction(x=>__game.player.x>x+10,x,WAIT);await page.mouse.up();assert.ok(await page.evaluate(x=>__game.player.x>x+10,x));
 await page.locator('#touchDash').tap();assert.equal(await page.evaluate(()=>__game.dashCount),1);await page.locator('#touchPulse').tap();assert.ok(await page.evaluate(()=>__game.player.pulseCD>8));
 await page.locator('#pauseBtn').tap();assert.equal(await page.evaluate(()=>__game.mode),'paused');assert.ok(await page.locator('#resumeBtn').isVisible());assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Pause menu fits narrow screen');await s.close();
});


test('wreck exploration grants one reward, saves salvage status, and score chains reward skill',async()=>{
 const s=await session();const {page}=s;await start(page);
 const result=await page.evaluate(()=>{const g=__game,w=g.islands.find(i=>i.kind==='wreck');g.nextXp=1000;g.player.x=w.x;g.player.y=w.y;g.player.hp=80;for(let i=0;i<100;i++){g.update(1/60);g.updateCosmetics(1/60);}const first={salvaged:w.salvaged,count:g.salvageCount,shells:g.shells,xp:g.xp,hp:g.player.hp};for(let i=0;i<100;i++)g.update(1/60);g.saveVoyage();return{first,after:g.salvageCount,saved:JSON.parse(localStorage.getItem('tidekeeper-voyage-v1')).salvaged};});
 assert.equal(result.first.salvaged,true);assert.equal(result.first.count,1);assert.equal(result.first.shells,4);assert.ok(result.first.xp>=8);assert.ok(result.first.hp>80);assert.equal(result.after,1);assert.equal(result.saved[0],true);
 const combo=await page.evaluate(()=>{const g=__game;g.player.crit=0;g.combo=0;g.score=0;for(let i=0;i<3;i++){const e=g.spawn('skiff',0);g.damageEnemy(e,10000);}const score=g.score;g.player.invuln=0;g.hurt(1);return{score,combo:g.combo};});assert.ok(combo.score>120,'Rapid kills earn more than base score');assert.equal(combo.combo,0,'Damage breaks a chain');await s.close();
});


test('self-contained distribution runs from one resource with functioning Web Audio and no external assets',async()=>{
 const context=await browser.newContext({viewport:{width:1280,height:800}});liveContexts.add(context);const page=await context.newPage();const requests=[],errors=[];page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url().includes('/dist/tidekeeper.html')?route.continue():route.abort());
 await page.goto(BASE+'/dist/tidekeeper.html?test=1');await page.waitForFunction(()=>window.__game?.mode==='menu');await start(page);
 const audio=await page.evaluate(()=>{__game.audio.sfx('pulse');__game.audio.update(.1,.8);return {state:__game.audio.ctx?.state,muted:__game.audio.muted,beat:__game.audio.beat};});assert.equal(audio.state,'running');assert.equal(audio.muted,false);assert.ok(audio.beat>0);
 const x=await page.evaluate(()=>__game.player.x);await page.keyboard.down('KeyD');await page.waitForFunction(x=>__game.player.x>x+15,x,WAIT);await page.keyboard.up('KeyD');assert.ok(await page.evaluate(x=>__game.player.x>x+15,x));assert.equal(requests.filter(u=>/^http/.test(u)).length,1,'Only the bundled HTML is requested');
 await page.evaluate(()=>__game.toMenu());await page.locator('#campaignStartBtn').click();await page.locator('#storyNext').waitFor({state:'visible',...WAIT});await page.locator('#storySkip').click();await page.waitForFunction(()=>__game.campaignActive&&__game.mode==='playing',null,WAIT);assert.ok(await page.evaluate(()=>__game.missionObjects.filter(o=>!o.optional).length>=3),'Bundled story campaign has actual rescue objectives');const storyX=await page.evaluate(()=>__game.player.x);await page.keyboard.down('KeyD');await page.waitForFunction(x=>__game.player.x>x+15,storyX,WAIT);await page.keyboard.up('KeyD');assert.equal(requests.filter(u=>/^http/.test(u)).length,1,'Long-story gameplay also requests no external assets');assert.deepEqual(errors,[]);await context.close();liveContexts.delete(context);
});

test('lethal damage completes loss once, clears the voyage save and retry starts a fresh playable run',async()=>{
 const s=await session();const {page}=s;await start(page);
 const loss=await page.evaluate(()=>{
  const g=__game;g.difficulty='normal';g.score=123;g.level=4;g.applyUpgrade('damage');g.player.hp=10;g.player.invuln=0;g.hurt(20);g.hurt(20);
  return {mode:g.mode,hp:g.player.hp,runs:g.profile.runs,best:g.profile.best,save:localStorage.getItem('tidekeeper-voyage-v1')};
 });
 assert.equal(loss.mode,'lost');assert.equal(loss.hp,0);assert.equal(loss.runs,1,'Further damage cannot finish an ended voyage twice');assert.equal(loss.best,123);assert.equal(loss.save,null);
 await page.locator('#againBtn').click();assert.equal(await page.evaluate(()=>__game.mode),'dialog');
 const fresh=await page.evaluate(()=>({score:__game.score,level:__game.level,hp:__game.player.hp,maxHp:__game.player.maxHp,upgrades:__game.upgradeCounts,runs:__game.profile.runs}));
 assert.equal(fresh.score,0);assert.equal(fresh.level,1);assert.equal(fresh.hp,fresh.maxHp);assert.equal(fresh.hp,120);assert.deepEqual(fresh.upgrades,{});assert.equal(fresh.runs,1);
 assert.ok((await drainDialogue(page))>=2);await page.waitForFunction(()=>__game.mode==='playing',null,WAIT);await quiet(page);
 const x=await page.evaluate(()=>__game.player.x);await page.keyboard.down('KeyA');await page.waitForFunction(x=>__game.player.x<x-12,x,WAIT);await page.keyboard.up('KeyA');assert.ok(await page.evaluate(x=>__game.player.x<x-12,x));await s.close();
});
