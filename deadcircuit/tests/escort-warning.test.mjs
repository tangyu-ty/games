import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {browserPath} from '../../scripts/browser.mjs';

const {chromium}=createRequire(import.meta.url)('playwright');
let server,browser,base=process.env.TEST_URL;
before(async()=>{
 if(!base){server=spawn(process.execPath,[fileURLToPath(new URL('../../server.mjs',import.meta.url))],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Escort warning server timed out')),10000);server.once('error',reject);server.once('exit',code=>{clearTimeout(timer);reject(Error('Escort warning server exited '+code));});server.stdout.on('data',chunk=>{const match=String(chunk).match(/port (\d+)/);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1]);}});});}
 browser=await chromium.launch({executablePath:browserPath(chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
});
after(async()=>{await browser?.close();server?.kill();});

test('offscreen escort injury warns with bounded repetition, identifies failure and clears it on retry and player defeat',async()=>{
 const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await context.addInitScript(()=>localStorage.setItem('dead-circuit-settings-v1',JSON.stringify({mute:true,screenShake:false,reducedMotion:true})));
  await page.goto(base+'/deadcircuit/index.html?test=1');await page.waitForFunction(()=>window.__dc?.renderer?.is3D,null,{timeout:20000});
  await page.locator('#newGameBtn').click();
  // A controlled encounter fixture uses a real authored rescue, real damage,
  // save/reload and UI. It is not evidence of natural campaign duration.
  const initial=await page.evaluate(()=>{
   const g=__dc;g.startMission(2);g.skipDialogue();g.enemies=[];g.bullets=[];g.effects=[];
   const npc=g.level.objects.find(o=>o.id==='nurse');g.interactObject(npc);
   g.player.angle=-Math.PI/2;g.renderer.updateCamera(g);
   const projected=g.renderer.projectPoint(npc,1);g.messages=[];
   g.damageActor(npc,10,{x:npc.x-100,y:npc.y,faction:'security'});
   const first=g.messages.map(m=>m.text);g.damageActor(npc,10,{x:npc.x-100,y:npc.y,faction:'security'});
   const second=g.messages.map(m=>m.text);g.damageActor(npc,110,{x:npc.x-100,y:npc.y,faction:'security'});
   return{name:npc.name,visible:projected.visible,first,second,critical:g.messages.map(m=>m.text),hp:npc.hp};
  });
  assert.equal(initial.visible,false,'warning must work when the escort is outside the camera');
  assert.ok(initial.first.some(s=>s.includes(initial.name)&&s.includes('受到攻击')));
  assert.deepEqual(initial.second,initial.first,'rapid hits do not flood the player with repeated warnings');
  assert.ok(initial.critical.some(s=>s.includes(initial.name)&&s.includes('伤势危急')),'crossing the critical threshold bypasses the ordinary warning cooldown');
  assert.ok(initial.hp>0);assert.match(await page.locator('#toast').innerText(),/伤势危急/);
  await page.evaluate(()=>{const g=__dc,npc=g.level.objects.find(o=>o.id==='nurse');g.damageActor(npc,npc.hp+1,{faction:'security'});});
  await page.waitForFunction(()=>__dc.mode==='dead');assert.match(await page.locator('.result-copy').innerText(),new RegExp(initial.name+'已倒下'));
  await page.reload();await page.locator('#continueBtn').click();await page.waitForFunction(()=>__dc.mode==='dead');
  assert.match(await page.locator('.result-copy').innerText(),new RegExp(initial.name+'已倒下'),'the actual saved defeat preserves its reason on reload');
  await page.locator('#retryBtn').click();await page.waitForFunction(()=>__dc.mode==='playing');
  assert.equal(await page.evaluate(()=>__dc.failureReason),'');
  assert.ok(await page.evaluate(()=>__dc.level.objects.find(o=>o.id==='nurse').hp>0),'retry restores the actual escort checkpoint');
  await page.evaluate(()=>{const g=__dc;g.player.invulnerable=0;g.damageActor(g.player,10000,{faction:'infected'});});
  await page.waitForFunction(()=>__dc.mode==='dead');const reason=await page.locator('.result-copy').innerText();assert.match(reason,/你已倒下/);assert.ok(!reason.includes(initial.name),'a later player defeat must not retain the previous escort reason');
  await page.locator('#retryBtn').click();await page.waitForFunction(()=>__dc.mode==='playing');assert.equal(await page.evaluate(()=>__dc.failureReason),'');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
