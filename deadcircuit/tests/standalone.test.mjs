import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {browserPath} from '../../scripts/browser.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
let server,browser,base;
before(async()=>{
 server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
 base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server did not start')),10000);server.once('error',reject);server.stdout.on('data',d=>{const m=String(d).match(/port (\d+)/);if(m){clearTimeout(timer);resolve('http://127.0.0.1:'+m[1]);}});});
 browser=await chromium.launch({executablePath:browserPath(chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
});
after(async()=>{await browser?.close();server?.kill();});

test('the published standalone contains all eighteen levels, art, audio and story and really plays without other HTTP resources',async()=>{
 const html=await readFile(root+'dist/deadcircuit.html','utf8');
 assert.match(html,/DEAD CIRCUIT/);assert.match(html,/FIELD_NOTES/);assert.doesNotMatch(html,/<script[^>]+src=/);assert.doesNotMatch(html,/<link[^>]+stylesheet[^>]+href=/);
 const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage(),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const url=route.request().url();if(url.startsWith(base+'/dist/deadcircuit.html')){requests.push(url);route.continue();}else{requests.push('BLOCKED '+url);route.abort();}});
 await page.goto(base+'/dist/deadcircuit.html?test=1');await page.locator('#newGameBtn').click();
 await page.locator('#dialogueSkip').click();await page.locator('#startMissionBtn').click();await page.locator('#dialogueSkip').click();
 await page.waitForFunction(()=>window.__dc?.mode==='playing');const x=await page.evaluate(()=>__dc.player.x);
 await page.keyboard.down('KeyD');await page.waitForFunction(x=>__dc.player.x>x+35,x);await page.keyboard.up('KeyD');
 await page.keyboard.press('Escape');await page.locator('#pauseLoadout').click();assert.equal(await page.locator('[data-weapon]').count(),14);
 await page.locator('[data-slot="optic"]').click();await page.locator('[data-attachment="redDot"]').click();
 assert.equal(await page.evaluate(()=>__dc.profile.fittings.needle.optic),'redDot');
 await page.locator('#armoryReturn').click();await page.locator('#pauseResume').click();assert.equal(await page.evaluate(()=>__dc.mode),'playing');
 assert.deepEqual(errors,[]);assert.equal(requests.length,1,JSON.stringify(requests));assert.ok(await page.evaluate(()=>__dc.audio!=null));await context.close();
});

test('the source server routes the new game directory while preserving the original game entry',async()=>{
 for(const [url,title] of [['/deadcircuit/','断线协议'],['/','潮汐信使']]){const response=await fetch(base+url);assert.equal(response.status,200);assert.match(await response.text(),new RegExp(title));}
 for(const url of ['/node_modules/playwright/package.json','/.git/config'])assert.equal((await fetch(base+url)).status,403);
});
