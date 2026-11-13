import {test,before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {browserPath} from '../../scripts/browser.mjs';

const {chromium}=createRequire(import.meta.url)('playwright'),contexts=new Set(),KEY='dead-circuit-campaign-v1',WAIT={timeout:12000};
let browser,server,BASE=process.env.TEST_URL;
before(async()=>{
 if(!BASE){server=spawn(process.execPath,[fileURLToPath(new URL('../../server.mjs',import.meta.url))],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});BASE=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Menu save test server timed out')),10000);server.once('error',reject);server.stdout.on('data',chunk=>{const m=String(chunk).match(/port (\d+)/);if(m){clearTimeout(timer);resolve('http://127.0.0.1:'+m[1]);}});});}
 browser=await chromium.launch({executablePath:browserPath(chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
});
afterEach(async()=>{await Promise.all([...contexts].map(c=>c.close().catch(()=>{})));contexts.clear();});
after(async()=>{await browser?.close();server?.kill();});
async function session(){const context=await browser.newContext({viewport:{width:1280,height:800}});contexts.add(context);await context.addInitScript(()=>{if(!localStorage.getItem('dead-circuit-settings-v1'))localStorage.setItem('dead-circuit-settings-v1',JSON.stringify({mute:true,reduced:true,reducedMotion:true,screenShake:false}));});const page=await context.newPage(),errors=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.goto(BASE+'/deadcircuit/index.html?test=1');await page.waitForFunction(()=>window.__dc?.mode==='menu',null,WAIT);return{page,errors};}
async function seed(page,difficulty='standard'){
 // Valid chapter-boundary fixture, not a claim of naturally completed missions.
 await page.evaluate(async({key,difficulty})=>{const {CAMPAIGN}=await import('/deadcircuit/story.js'),g=__dc,note=CAMPAIGN[0].fieldNotes[0];g.startNew(difficulty);g.campaign={...g.freshCampaign(),mission:5,phase:'briefing',completed:[0,1,2,3,4],choices:{0:1,1:0,2:1,3:0,4:1},flags:{care:5},fieldNotes:[{id:'0:field-note-0',mission:0,title:note.title,text:note.text}],difficulty};g.level=null;g.player=null;g.save();const settings=JSON.parse(localStorage.getItem('dead-circuit-settings-v1'));delete settings.preferredDifficulty;localStorage.setItem('dead-circuit-settings-v1',JSON.stringify(settings));},{key:KEY,difficulty});
 await page.reload();await page.waitForFunction(()=>__dc.mode==='menu',null,WAIT);return page.evaluate(key=>localStorage.getItem(key),KEY);
}

test('the unloaded menu shows saved progress and a read-only archive, preserves the old save, and applies an explicit difficulty before continuing or replacing',async()=>{
 const {page,errors}=await session(),baseline=await seed(page);assert.match(await page.locator('#continueBtn').innerText(),/5\/18/);assert.equal(await page.evaluate(()=>__dc.campaignLoaded),false);
 const resident=await page.evaluate(()=>JSON.stringify({campaign:__dc.campaign,profile:__dc.profile}));await page.locator('#menuJournalBtn').click();await page.waitForFunction(()=>__dc.mode==='journal',null,WAIT);assert.equal(await page.locator('[data-journal]').count(),6);await page.locator('[data-journal="0"]').click();await page.locator('#journalNotesTab').click();assert.equal(await page.locator('.field-note-card').count(),1);assert.equal(await page.evaluate(()=>__dc.campaignLoaded),false);assert.equal(await page.evaluate(()=>JSON.stringify({campaign:__dc.campaign,profile:__dc.profile})),resident,'Previewing an archive does not replace the resident campaign or equipment');
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));assert.equal(await page.evaluate(key=>localStorage.getItem(key),KEY),baseline,'Read-only archive navigation cannot rewrite the old save');await page.locator('#journalBack').click();assert.match(await page.locator('#continueBtn').innerText(),/5\/18/);
 await page.locator('#menuDifficulty').selectOption('story');assert.equal(await page.evaluate(key=>localStorage.getItem(key),KEY),baseline,'Difficulty selection only changes preferences until the campaign is actually continued');assert.equal(await page.evaluate(()=>JSON.stringify({campaign:__dc.campaign,profile:__dc.profile})),resident);
 await page.reload();await page.waitForFunction(()=>__dc.mode==='menu',null,WAIT);assert.equal(await page.locator('#menuDifficulty').inputValue(),'story');assert.equal(await page.evaluate(key=>localStorage.getItem(key),KEY),baseline);
 await page.locator('#newGameBtn').click();await page.locator('#cancelNew').click();assert.equal(await page.evaluate(()=>__dc.campaignLoaded),false);assert.equal(await page.evaluate(key=>localStorage.getItem(key),KEY),baseline);
 await page.locator('#continueBtn').click();await page.waitForFunction(()=>__dc.mode==='briefing',null,WAIT);assert.deepEqual(await page.evaluate(()=>({loaded:__dc.campaignLoaded,mission:__dc.campaign.mission,completed:__dc.campaign.completed.length,difficulty:__dc.settings.difficulty,campaignDifficulty:__dc.campaign.difficulty})),{loaded:true,mission:5,completed:5,difficulty:'story',campaignDifficulty:'story'});
 await page.locator('#briefMenu').click();const continued=JSON.parse(await page.evaluate(key=>localStorage.getItem(key),KEY));assert.equal(continued.campaign.difficulty,'story');assert.equal(continued.campaign.completed.length,5);assert.equal(continued.campaign.fieldNotes.length,1);
 await page.locator('#newGameBtn').click();await page.locator('#cancelNew').click();assert.equal(await page.evaluate(()=>__dc.campaign.mission),5);await page.locator('#newGameBtn').click();await page.locator('#confirmNew').click();await page.waitForFunction(()=>__dc.mode==='dialogue',null,WAIT);assert.deepEqual(await page.evaluate(()=>({loaded:__dc.campaignLoaded,mission:__dc.campaign.mission,completed:__dc.campaign.completed.length,notes:__dc.campaign.fieldNotes.length,difficulty:__dc.campaign.difficulty})),{loaded:true,mission:0,completed:0,notes:0,difficulty:'story'});
 await page.locator('#dialogueNext').click();await page.reload();await page.locator('#continueBtn').click();assert.equal(await page.evaluate(()=>__dc.campaign.sceneIndex),1);assert.deepEqual(await page.evaluate(()=>__dc.campaign.completed),[]);assert.deepEqual(errors,[]);
});

test('continuing without an explicit preference retains the saved campaign difficulty',async()=>{
 const {page,errors}=await session(),baseline=await seed(page,'tactical');await page.evaluate(()=>{const key='dead-circuit-settings-v1',s=JSON.parse(localStorage.getItem(key));s.difficulty='standard';delete s.preferredDifficulty;localStorage.setItem(key,JSON.stringify(s));});await page.reload();await page.waitForFunction(()=>__dc.mode==='menu',null,WAIT);assert.equal(await page.locator('#menuDifficulty').inputValue(),'tactical');assert.equal(await page.evaluate(key=>localStorage.getItem(key),KEY),baseline);await page.locator('#continueBtn').click();await page.waitForFunction(()=>__dc.mode==='briefing',null,WAIT);assert.equal(await page.evaluate(()=>__dc.settings.difficulty),'tactical');assert.equal(await page.evaluate(()=>__dc.campaign.mission),5);assert.deepEqual(errors,[]);
});
