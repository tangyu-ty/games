// Verify the full archive independently for both earned ending branches.
import {test,before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const appRoot=process.env.TIDEKEEPER_APP_ROOT?path.resolve(process.env.TIDEKEEPER_APP_ROOT):fileURLToPath(new URL('../',import.meta.url));
const appFile=name=>pathToFileURL(path.join(appRoot,name));
const {browserPath}=await import(appFile('scripts/browser.mjs'));
const {CAMPAIGN,CAMPAIGN_INTRO,CAMPAIGN_ENDINGS}=await import(appFile('story.js'));
const {chromium}=createRequire(path.join(appRoot,'package.json'))('playwright');
const contexts=new Set(),WAIT={timeout:10000},KEY='tidekeeper-story-v2';
let server,browser,base;
before(async()=>{
 server=spawn(process.execPath,[path.join(appRoot,'server.mjs')],{cwd:appRoot,env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
 base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Journal test server timed out')),10000);server.once('error',reject);server.stdout.on('data',chunk=>{const match=String(chunk).match(/port (\d+)/);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1]);}});server.once('exit',code=>{clearTimeout(timer);reject(Error('Journal test server exited '+code));});});
 browser=await chromium.launch({executablePath:browserPath(chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
});
afterEach(async()=>{await Promise.all([...contexts].map(c=>c.close().catch(()=>{})));contexts.clear();});
after(async()=>{await browser?.close();server?.kill();});
async function openEnding(choice){
 const context=await browser.newContext({viewport:{width:1280,height:800}});contexts.add(context);
 await context.addInitScript(()=>localStorage.setItem('tidekeeper-settings-v1',JSON.stringify({mute:true,reduced:true})));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/?test=1');await page.waitForFunction(()=>typeof window.__game?.startCampaign==='function',null,WAIT);
 await page.locator('#campaignStartBtn').click();await page.locator('#storySkip').click();await page.waitForFunction(()=>__game.mode==='playing',null,WAIT);
 // Archive-branch fixture: preserve a real saved vessel, then load a valid ending phase.
 // This does not claim natural completion or replace the full gameplay validation.
 await page.evaluate(({key,choice})=>{__game.pause();const saved=JSON.parse(localStorage.getItem(key));saved.chapter=11;saved.phase='ending';saved.sceneIndex=0;saved.completed=Array.from({length:12},(_,i)=>i);saved.choices=Object.fromEntries(Array.from({length:12},(_,i)=>[i,choice]));saved.mission=null;saved.legStart=null;localStorage.setItem(key,JSON.stringify(saved));},{key:KEY,choice});
 await page.reload();await page.locator('#campaignContinueBtn').click();await page.locator('#storyNext').waitFor({state:'visible',...WAIT});
 return{page,errors};
}
async function transcript(page){
 const details=page.locator('.story-recap details');await details.locator('summary').click();
 return details.locator('p').allTextContents();
}
const linesText=lines=>lines.map(line=>line.speaker+'　'+line.text);
function chapterLines(chapter,choice){const c=CAMPAIGN[chapter];return[...(chapter===0?CAMPAIGN_INTRO:[]),...c.opening,...c.interlude,...c.choice.options[choice].reply,...c.closing];}
for(const [name,choice] of [['hope',0],['memory',1]])test(`${name} journal retains intro, chosen reply and earned ending in narrative order`,async()=>{
 const {page,errors}=await openEnding(choice);
 assert.equal(await page.locator('.dialogue-text').innerText(),CAMPAIGN_ENDINGS[name][0].text);
 await page.keyboard.press('Escape');await page.locator('#pauseJournal').click();
 assert.deepEqual(await transcript(page),linesText(chapterLines(11,choice)),'Before the ending is completed, the chapter journal retains its chosen reply but reveals no ending');
 await page.locator('#journalReturn').click();await page.locator('#resumeBtn').click();await page.locator('#storySkip').click();await page.waitForFunction(()=>__game.mode==='campaignWon',null,WAIT);
 await page.locator('#endingJournal').click();
 assert.deepEqual(await transcript(page),linesText([...chapterLines(11,choice),...CAMPAIGN_ENDINGS[name]]),'The earned ending follows the chapter closing, after the selected reply and without the other branch');
 await page.locator('[data-journal="0"]').click();
 assert.deepEqual(await transcript(page),linesText(chapterLines(0,choice)),'Chapter one preserves the introduction before its opening and the chosen reply between interlude and closing');
 await page.locator('#journalReturn').click();assert.equal(await page.evaluate(()=>__game.mode),'campaignWon');
 const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);assert.equal(saved.phase,'won');assert.equal(saved.completed.length,12);assert.equal(Object.keys(saved.choices).length,12);assert.deepEqual(errors,[]);
});
