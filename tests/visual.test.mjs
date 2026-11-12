import {browserPath} from '../scripts/browser.mjs';
import {test,before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire(import.meta.url)('playwright');
let browser,server,base;
const contexts=new Set();
before(async()=>{
 server=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
 base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Visual test server failed to start')),10000);server.stdout.on('data',d=>{const m=String(d).match(/port (\d+)/);if(m){clearTimeout(timer);resolve('http://127.0.0.1:'+m[1]);}});server.on('error',reject);server.on('exit',c=>{clearTimeout(timer);reject(Error('Visual server exited '+c));});});
 browser=await chromium.launch({executablePath:browserPath(chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
});
afterEach(async()=>{await Promise.all([...contexts].map(c=>c.close().catch(()=>{})));contexts.clear();});
after(async()=>{await browser?.close();server?.kill();});
async function open(viewport){const c=await browser.newContext({viewport,hasTouch:viewport.width<900});contexts.add(c);await c.addInitScript(()=>localStorage.setItem('tidekeeper-settings-v1',JSON.stringify({mute:true,reduced:true})));const p=await c.newPage();await p.goto(base+'/?test=1');await p.waitForFunction(()=>window.__game);return p;}
async function sail(p){await p.locator('#startBtn').click();while(await p.locator('#nextDialogue').isVisible())await p.locator('#nextDialogue').click();await p.waitForFunction(()=>__game.mode==='playing');await p.evaluate(()=>{__game.spawnTimer=1e6;__game.player.invuln=1e6;});}

test('a transient toast actually disappears after its lifetime',async()=>{
 const p=await open({width:1280,height:800});await p.evaluate(()=>__game.toast('过期提示回归测试'));
 await p.locator('#toast').waitFor({state:'visible',timeout:2000});assert.match(await p.locator('#toast').innerText(),/过期提示/);
 await p.locator('#toast').waitFor({state:'hidden',timeout:6500});assert.equal(await p.locator('#toast').isVisible(),false);
});

test('320px status panels stay on screen and boss notices avoid the health bar in portrait and landscape',async()=>{
 for(const viewport of [{width:320,height:568},{width:390,height:844},{width:844,height:390}]){
  const p=await open(viewport);await sail(p);
  const boxes=await p.locator('.hud-bottom').evaluate(e=>[...e.children].map(e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));
  for(const r of boxes){assert.ok(r.left>=0&&r.right<=viewport.width,`Status panel remains inside ${viewport.width}px viewport`);assert.ok(r.top>=0&&r.bottom<=viewport.height);}
  await p.evaluate(()=>{const g=__game;g.stage=4;g.beginStage();g.spawn('boss');g.player.invuln=1e6;g.spawnTimer=1e6;g.toast('首领战提示不可覆盖血条');});
  await p.waitForFunction(()=>document.querySelector('#gameCanvas').dataset.bossActive==='true');
  const toast=await p.locator('#toast').boundingBox();assert.ok(toast,'Boss toast is displayed');const healthBarBottom=(viewport.width<700?142:116)+35;
  assert.ok(toast.y>=healthBarBottom+8,`Notice starts at ${toast.y}, below boss bar ending at ${healthBarBottom}`);assert.ok(toast.y+toast.height<=viewport.height);
  await p.context().close();contexts.delete(p.context());
 }
});

test('all relic options remain reachable in small portrait and landscape dialogs',async()=>{
 for(const viewport of [{width:320,height:568},{width:844,height:390}]){
  const p=await open(viewport);await sail(p);await p.evaluate(()=>{__game.pendingLevel=1;__game.chooseUpgrade();});
  const cards=p.locator('.upgrade-card');assert.equal(await cards.count(),3);
  for(let i=0;i<3;i++){await cards.nth(i).scrollIntoViewIfNeeded();const r=await cards.nth(i).boundingBox();assert.ok(r.x>=0&&r.x+r.width<=viewport.width,'Relic card fits horizontal viewport');}
  await cards.nth(2).click();await p.waitForFunction(()=>__game.mode==='playing');
  assert.equal(await p.evaluate(()=>Object.values(__game.upgradeCounts).reduce((a,b)=>a+b,0)),1);
  await p.context().close();contexts.delete(p.context());
 }
});

test('retina canvas bounds raster pixels while keeping full CSS viewport coverage',async()=>{
 const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2});contexts.add(context);const p=await context.newPage();await p.goto(base+'/?test=1');await p.waitForFunction(()=>window.__game);
 const canvas=await p.locator('#gameCanvas').evaluate(e=>({width:e.width,height:e.height,cssWidth:e.clientWidth,cssHeight:e.clientHeight}));
 assert.equal(canvas.cssWidth,1440);assert.equal(canvas.cssHeight,900);assert.ok(canvas.width*canvas.height<=2_010_000,'Retina pixel budget prevents a five-million-pixel redraw every frame');assert.ok(canvas.width>=canvas.cssWidth,'This viewport keeps at least CSS-pixel clarity');
});
