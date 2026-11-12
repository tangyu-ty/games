import {browserPath} from '../scripts/browser.mjs';
import {test,before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire(import.meta.url)('playwright');
let browser,server,base;
const contexts=new Set();
const WAIT={timeout:8000};
before(async()=>{
 server=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
 base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Robustness server timed out')),10000);server.once('error',reject);server.stdout.on('data',chunk=>{const m=String(chunk).match(/port (\d+)/);if(m){clearTimeout(timer);resolve('http://127.0.0.1:'+m[1]);}});server.once('exit',code=>{clearTimeout(timer);reject(Error('Robustness server exited '+code));});});
 browser=await chromium.launch({executablePath:browserPath(chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
});
afterEach(async()=>{await Promise.all([...contexts].map(c=>c.close().catch(()=>{})));contexts.clear();});
after(async()=>{await browser?.close();server?.kill();});
async function open(init){
 const context=await browser.newContext({viewport:{width:1280,height:800}});contexts.add(context);
 await context.addInitScript(()=>localStorage.setItem('tidekeeper-settings-v1',JSON.stringify({mute:true,reduced:true})));
 if(init)await context.addInitScript(init);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/?test=1');await page.waitForFunction(()=>window.__game?.mode==='menu',null,WAIT);
 return {page,errors};
}
async function begin(page){
 await page.locator('#startBtn').click();await drain(page);await page.waitForFunction(()=>__game.mode==='playing',null,WAIT);
}
async function drain(page){let count=0;while(await page.locator('#nextDialogue').isVisible()){await page.locator('#nextDialogue').click();assert.ok(++count<30,'Dialogue terminates');}}

test('truncated saves cannot appear as usable journeys or stop a fresh game loop',async()=>{
 const {page,errors}=await open(()=>localStorage.setItem('tidekeeper-voyage-v1',JSON.stringify({version:1,stage:0,player:{x:900,y:680}})));
 assert.equal(await page.locator('#continueBtn').isVisible(),false,'Malformed save is not offered');
 await page.evaluate(()=>__game.resumeSaved());assert.equal(await page.evaluate(()=>localStorage.getItem('tidekeeper-voyage-v1')),null);
 assert.equal(await page.evaluate(()=>__game.mode),'menu');await begin(page);
 const x=await page.evaluate(()=>__game.player.x);await page.keyboard.down('KeyD');await page.waitForFunction(x=>__game.player.x>x+15,x,WAIT);await page.keyboard.up('KeyD');assert.deepEqual(errors,[]);
});

test('voyage restores whitelisted game state and cannot overwrite live methods or services',async()=>{
 const {page,errors}=await open();await begin(page);
 await page.evaluate(()=>{__game.pause();const saved=JSON.parse(localStorage.getItem('tidekeeper-voyage-v1'));Object.assign(saved,{renderer:null,audio:null,frame:null,profile:{achievements:null},keys:null,mode:'broken'});localStorage.setItem('tidekeeper-voyage-v1',JSON.stringify(saved));});
 await page.reload();await page.locator('#continueBtn').click();await page.waitForFunction(()=>__game.mode==='playing',null,WAIT);
 const restored=await page.evaluate(()=>({frame:typeof __game.frame,renderer:typeof __game.renderer.render,audio:typeof __game.audio.sfx,keys:__game.keys instanceof Set,achievements:Array.isArray(__game.profile.achievements)}));
 assert.deepEqual(restored,{frame:'function',renderer:'function',audio:'function',keys:true,achievements:true});const time=await page.evaluate(()=>__game.runTime);await page.waitForFunction(t=>__game.runTime>t,time,WAIT);assert.deepEqual(errors,[]);
});

test('completed delivery survives reload without replaying combat or granting its award twice',async()=>{
 const {page,errors}=await open();await begin(page);
 const checkpoint=await page.evaluate(()=>{const g=__game;g.enemies=[];g.spawnTimer=1e6;g.stageKills=16;g.player.x=g.beacons[0].x;g.player.y=g.beacons[0].y;g.player.invuln=100;g.update(1/60);return{score:g.score,stageKills:g.stageKills,save:JSON.parse(localStorage.getItem('tidekeeper-voyage-v1'))};});
 assert.equal(checkpoint.save.cleared,true);assert.equal(checkpoint.save.phase,'letter');assert.equal(checkpoint.save.score,checkpoint.score);assert.equal(checkpoint.save.stageKills,checkpoint.stageKills);
 await page.reload();await page.locator('#continueBtn').click();await page.waitForFunction(()=>__game.mode==='dialog',null,WAIT);
 assert.equal(await page.evaluate(()=>__game.score),checkpoint.score);assert.equal(await page.evaluate(()=>__game.cleared),true);
 await drain(page);await page.locator('#nextSea').waitFor({state:'visible',...WAIT});assert.match(await page.locator('#modalContent').innerText(),/已送达/);await page.locator('#nextSea').click();await page.waitForFunction(()=>__game.mode==='playing'&&__game.stage===1,null,WAIT);
 assert.equal(await page.evaluate(()=>__game.score),checkpoint.score,'Restoring a delivery does not grant the stage bonus again');assert.deepEqual(await page.evaluate(()=>__game.profile.letters),[0]);assert.deepEqual(errors,[]);
});

test('malformed profile/settings normalize safely while valid collected letters survive',async()=>{
 const {page,errors}=await open(()=>{localStorage.setItem('tidekeeper-profile-v1',JSON.stringify({best:-50,runs:'oops',letters:[0,0,4,9,'2'],achievements:null}));localStorage.setItem('tidekeeper-settings-v1',JSON.stringify('obsolete-settings-format'));});
 await page.locator('#archiveBtn').click();await page.locator('#archiveClose').waitFor({state:'visible',...WAIT});assert.equal(await page.locator('.archive-list details.locked').count(),3);
 const profile=await page.evaluate(()=>__game.profile);assert.deepEqual(profile.letters,[0,4]);assert.deepEqual(profile.achievements,[]);assert.equal(profile.best,0);assert.equal(profile.runs,0);
 await page.locator('#archiveClose').click();await page.locator('#settingsBtn').click();await page.locator('#reduceCheck').check();await page.locator('#settingsClose').click();assert.equal(await page.evaluate(()=>__game.settings.reduced),true);await begin(page);assert.deepEqual(errors,[]);
});

test('denied Gamepad Permissions-Policy falls back to a working keyboard game',async()=>{
 const {page,errors}=await open(()=>Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>{throw new DOMException('Gamepad access denied by policy','SecurityError');}}));
 await begin(page);const x=await page.evaluate(()=>__game.player.x);await page.keyboard.down('KeyD');await page.waitForFunction(x=>__game.player.x>x+18,x,WAIT);await page.keyboard.up('KeyD');
 assert.ok(await page.evaluate(()=>__game.runTime>0));assert.deepEqual(errors,[]);
});

test('high-speed magnetic attraction reaches loot instead of oscillating past it',async()=>{
 const {page,errors}=await open();await begin(page);
 const result=await page.evaluate(()=>{const g=__game;g.player.x=900;g.player.y=680;g.player.speed=1300;g.player.invuln=100;g.enemies=[];g.spawnTimer=1e6;g.fireTimer=1e6;g.xp=0;g.nextXp=1000;g.pickups=[{x:930,y:680,r:5,type:'xp',value:3}];for(let i=0;i<100;i++)g.update(.04);g.mode='paused';return {xp:g.xp,left:g.pickups.length};});
 assert.equal(result.xp,3);assert.equal(result.left,0);assert.deepEqual(errors,[]);
});

test('a newly spawning boss cannot damage a player during its telegraph grace period',async()=>{
 const {page,errors}=await open();await begin(page);
 const grace=await page.evaluate(()=>{const g=__game;g.stage=4;g.stageTime=3.01;g.player.x=900;g.player.y=250;g.player.invuln=0;g.enemies=[];g.spawnTimer=1e6;g.fireTimer=1e6;g.bossActive=false;g.bossDefeated=false;g.stageHits=0;const before=g.player.hp;g.update(1/60);const boss=g.enemies.find(e=>e.type==='boss');return{before,after:g.player.hp,hits:g.stageHits,age:boss.age};});
 assert.ok(grace.age<1.2);assert.equal(grace.after,grace.before);assert.equal(grace.hits,0);
 const contact=await page.evaluate(()=>{const g=__game,boss=g.enemies.find(e=>e.type==='boss');boss.age=1.3;boss.attack=5;g.player.x=boss.x;g.player.y=boss.y;g.player.invuln=0;g.update(1/60);g.mode='paused';return{hp:g.player.hp,hits:g.stageHits};});
 assert.ok(contact.hp<grace.before,'Boss contact becomes dangerous once the grace period ends');assert.equal(contact.hits,1);assert.deepEqual(errors,[]);
});

test('unavailable browser storage is reported honestly without stopping the voyage',async()=>{
 const {page,errors}=await open();
 await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('Storage quota exhausted','QuotaExceededError');};});
 await begin(page);await page.locator('#pauseBtn').click();await page.waitForFunction(()=>__game.mode==='paused',null,WAIT);
 const text=await page.locator('#modalContent').innerText();assert.match(text,/未能保存/);assert.doesNotMatch(text,/已自动保存/);
 await page.locator('#resumeBtn').click();await page.waitForFunction(()=>__game.mode==='playing',null,WAIT);const x=await page.evaluate(()=>__game.player.x);await page.keyboard.down('KeyD');await page.waitForFunction(x=>__game.player.x>x+15,x,WAIT);await page.keyboard.up('KeyD');assert.deepEqual(errors,[]);
});
