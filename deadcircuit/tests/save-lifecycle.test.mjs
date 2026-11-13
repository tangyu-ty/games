import {test,before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {browserPath} from '../../scripts/browser.mjs';

const {chromium}=createRequire(import.meta.url)('playwright'),KEY='dead-circuit-campaign-v1',contexts=new Set(),WAIT={timeout:20000};
let browser,server,BASE=process.env.TEST_URL;
before(async()=>{
 if(!BASE){server=spawn(process.execPath,[fileURLToPath(new URL('../../server.mjs',import.meta.url))],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});BASE=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Save lifecycle server timed out')),10000);server.on('error',reject);server.on('exit',code=>{clearTimeout(timer);reject(Error('Save lifecycle server exited '+code));});server.stdout.on('data',chunk=>{const match=String(chunk).match(/port (\d+)/);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1]);}});});}
 browser=await chromium.launch({executablePath:browserPath(chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
});
afterEach(async()=>{await Promise.all([...contexts].map(context=>context.close().catch(()=>{})));contexts.clear();});
after(async()=>{await browser?.close();server?.kill();});
async function session(){
 const context=await browser.newContext({viewport:{width:960,height:640}});contexts.add(context);await context.addInitScript(()=>{try{localStorage.setItem('dead-circuit-settings-v1',JSON.stringify({mute:true,screenShake:false,reducedMotion:true}));}catch{/* about:blank has no storage origin during the unload probe. */}});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(BASE+'/deadcircuit/index.html?test=1');await page.waitForFunction(()=>window.__dc?.mode==='menu',null,WAIT);
 return{page,close:async()=>{assert.deepEqual(errors,[]);await context.close();contexts.delete(context);}};
}
async function saved(page){return page.evaluate(key=>localStorage.getItem(key),KEY);}
async function seedLaterMission(page){
 await page.locator('#newGameBtn').click();await page.locator('#dialogueSkip').click();
 // Later-chapter fixture uses actual Game start/save APIs. It does not claim
 // natural progress or time. The unload and reload paths below are unmodified.
 await page.evaluate(()=>{const g=__dc;g.campaign.completed=[0,1,2,3,4];g.campaign.flags.care=3;g.startMission(5);g.skipDialogue();g.enemies=[];g.player.invulnerable=1e6;g.player.pitch=.22;g.save();});
 await page.reload();await page.waitForFunction(()=>__dc.mode==='menu',null,WAIT);const baseline=await saved(page);assert.equal(JSON.parse(baseline).campaign.mission,5);assert.equal(await page.evaluate(()=>__dc.campaignLoaded),false);return baseline;
}

test('reopening the menu without continuing preserves a later campaign across another actual pagehide and reload',async()=>{
 const s=await session(),{page}=s,baseline=await seedLaterMission(page);
 await page.reload();await page.waitForFunction(()=>__dc.mode==='menu',null,WAIT);assert.equal(await saved(page),baseline,'An unopened resident campaign must not replace the detected save');
 await page.goto('about:blank');await page.goto(BASE+'/deadcircuit/index.html?test=1');await page.waitForFunction(()=>__dc.mode==='menu',null,WAIT);assert.equal(await saved(page),baseline,'Leaving the unopened menu also triggers pagehide safely');await s.close();
});

test('viewing settings and archives or cancelling a new game before continuing cannot overwrite existing progress',async()=>{
 const s=await session(),{page}=s,baseline=await seedLaterMission(page);
 await page.locator('#settingsBtn').click();await page.locator('[data-setting="invertY"]').click();await page.locator('#settingsBack').click();await page.locator('#menuJournalBtn').click();await page.locator('#journalBack').click();await page.locator('#newGameBtn').click();await page.locator('#cancelNew').click();
 assert.equal(await page.evaluate(()=>__dc.campaignLoaded),false);await page.reload();await page.waitForFunction(()=>__dc.mode==='menu',null,WAIT);assert.equal(await saved(page),baseline);await s.close();
});

test('training before continuing does not authorize saving a fresh campaign over the story',async()=>{
 const s=await session(),{page}=s,baseline=await seedLaterMission(page);
 await page.locator('#practiceBtn').click();await page.waitForFunction(()=>__dc.practice&&__dc.mode==='playing',null,WAIT);await page.keyboard.press('Escape');await page.locator('#pausePort').click();assert.equal(await page.evaluate(()=>__dc.campaignLoaded),false);
 await page.reload();await page.waitForFunction(()=>__dc.mode==='menu',null,WAIT);assert.equal(await saved(page),baseline);await s.close();
});

test('a continued campaign and an explicitly confirmed new campaign both retain normal autosaving',async()=>{
 const s=await session(),{page}=s;await seedLaterMission(page);await page.locator('#continueBtn').click();await page.waitForFunction(()=>__dc.mode==='playing',null,WAIT);assert.equal(await page.evaluate(()=>__dc.campaignLoaded),true);
 await page.evaluate(()=>{const g=__dc;g.enemies=[];g.player.invulnerable=1e6;g.player.pitch=.43;g.pause();});assert.equal(JSON.parse(await saved(page)).current.player.pitch,.43);await page.reload();await page.waitForFunction(()=>__dc.mode==='menu',null,WAIT);assert.equal(JSON.parse(await saved(page)).campaign.mission,5);assert.equal(JSON.parse(await saved(page)).current.player.pitch,.43);
 await page.locator('#newGameBtn').click();await page.locator('#confirmNew').click();await page.waitForFunction(()=>__dc.mode==='dialogue',null,WAIT);assert.equal(await page.evaluate(()=>__dc.campaignLoaded),true);await page.locator('#dialogueNext').click();const fresh=JSON.parse(await saved(page));assert.equal(fresh.campaign.mission,0);assert.equal(fresh.campaign.sceneIndex,1);assert.deepEqual(fresh.campaign.completed,[]);
 await page.reload();await page.locator('#continueBtn').click();await page.waitForFunction(()=>__dc.mode==='dialogue',null,WAIT);assert.equal(await page.evaluate(()=>__dc.campaign.sceneIndex),1);await page.locator('#dialogueNext').click();assert.equal(JSON.parse(await saved(page)).campaign.sceneIndex,2);await s.close();
});
