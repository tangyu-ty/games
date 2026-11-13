import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {browserPath} from '../../scripts/browser.mjs';

// Focused UI fixture: opening a real authored document directly is not natural
// campaign or duration evidence. Scrolling itself uses the standard Gamepad API.
const {chromium}=createRequire(import.meta.url)('playwright');
let server,browser,base=process.env.TEST_URL;
before(async()=>{
 if(!base){
  server=spawn(process.execPath,[fileURLToPath(new URL('../../server.mjs',import.meta.url))],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Controller-scroll server timed out')),10000);server.once('error',reject);server.once('exit',code=>{clearTimeout(timer);reject(Error('Controller-scroll server exited '+code));});server.stdout.on('data',chunk=>{const match=String(chunk).match(/port (\d+)/);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1]);}});});
 }
 browser=await chromium.launch({executablePath:browserPath(chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
});
after(async()=>{await browser?.close();server?.kill();});

async function axis(page,value){await page.evaluate(value=>{window.__scrollPad.axes[3]=value;},value);}
async function frames(page,count=8){await page.evaluate(count=>new Promise(resolve=>{let n=0;function tick(){if(++n>=count)resolve();else requestAnimationFrame(tick);}requestAnimationFrame(tick);}),count);}
async function journalScroll(page){return page.evaluate(()=>[document.querySelector('#overlay'),document.querySelector('.screen-scroll'),document.querySelector('.journal-content')].reduce((total,el)=>total+(el?.scrollTop||0),0));}

test('a standard controller right stick scrolls a long field document and its archive at 320px without advancing or resuming',async()=>{
 const context=await browser.newContext({viewport:{width:320,height:568}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await context.addInitScript(()=>{
   localStorage.setItem('dead-circuit-settings-v1',JSON.stringify({mute:true,reduced:true,screenShake:false}));
   window.__scrollPad={connected:true,mapping:'standard',id:'Right-stick scroll fixture',index:0,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,touched:false,value:0}))};
   Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[window.__scrollPad]});
  });
  await page.goto(base+'/deadcircuit/index.html?test=1');
  await page.locator('#newGameBtn').click();await page.locator('#dialogueSkip').click();await page.locator('#startMissionBtn').click();await page.locator('#dialogueSkip').click();
  await page.evaluate(()=>{const g=window.__dc,o=g.level.objects.find(object=>object.fieldNote===0);if(!o)throw Error('Authored field document missing');g.interactObject(o);});
  await page.waitForFunction(()=>__dc.mode==='dialogue'&&__dc.campaign.phase==='fieldnote');
  assert.ok((await page.locator('#dialogueText').textContent()).length>180);
  const body=await page.locator('#dialogueText').evaluate(el=>({top:el.scrollTop,height:el.clientHeight,fullHeight:el.scrollHeight}));
  assert.ok(body.fullHeight>body.height+100,'The actual authored text overflows a readable small-screen panel');
  const phase=await page.evaluate(()=>({mode:__dc.mode,phase:__dc.campaign.phase,line:__dc.campaign.sceneIndex,play:__dc.campaign.totalPlay,yaw:__dc.player.angle,pitch:__dc.player.pitch}));
  await axis(page,1);await page.waitForFunction(()=>document.querySelector('#dialogueText').scrollTop>100);await axis(page,0);await frames(page);
  const stationary=await page.locator('#dialogueText').evaluate(el=>el.scrollTop);await frames(page,10);assert.equal(await page.locator('#dialogueText').evaluate(el=>el.scrollTop),stationary,'Neutral right stick stops scrolling');
  assert.deepEqual(await page.evaluate(()=>({mode:__dc.mode,phase:__dc.campaign.phase,line:__dc.campaign.sceneIndex,play:__dc.campaign.totalPlay,yaw:__dc.player.angle,pitch:__dc.player.pitch})),phase,'Scrolling a document neither advances it nor rotates the shoulder camera or resumes combat');
  await axis(page,-1);await page.waitForFunction(()=>document.querySelector('#dialogueText').scrollTop===0);await axis(page,0);
  await page.locator('#dialogueNext').click();await page.keyboard.press('KeyM');await page.locator('#journalNotesTab').click();
  assert.equal(await page.locator('[data-fieldnote]').count(),1);
  const before=await journalScroll(page);await axis(page,1);await page.waitForFunction(()=>[document.querySelector('#overlay'),document.querySelector('.screen-scroll'),document.querySelector('.journal-content')].reduce((n,el)=>n+(el?.scrollTop||0),0)>100);await axis(page,0);assert.ok(await journalScroll(page)>before+80);
  assert.equal(await page.evaluate(()=>__dc.mode),'journal');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,'Narrow reading does not create horizontal overflow');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('standard controller A cycles native difficulty and deadzone selects and saves their chosen values',async()=>{
 const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await context.addInitScript(()=>{
   if(!localStorage.getItem('dead-circuit-settings-v1'))localStorage.setItem('dead-circuit-settings-v1',JSON.stringify({mute:true,difficulty:'standard',deadzone:.18}));
   window.__scrollPad={connected:true,mapping:'standard',id:'Select-control fixture',index:0,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,touched:false,value:0}))};
   Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[window.__scrollPad]});
  });
  async function confirm(){
   await page.evaluate(()=>{__scrollPad.buttons[0]={pressed:true,touched:true,value:1};});
   await page.waitForFunction(()=>__dc.input.padPrevious[0]===true);
   await page.evaluate(()=>{__scrollPad.buttons[0]={pressed:false,touched:false,value:0};});
   await page.waitForFunction(()=>__dc.input.padPrevious[0]===false);
  }
  await page.goto(base+'/deadcircuit/index.html?test=1');await page.waitForFunction(()=>__dc?.input);
  await page.locator('#menuDifficulty').focus();await confirm();
  assert.equal(await page.locator('#menuDifficulty').inputValue(),'tactical');
  assert.equal(await page.evaluate(()=>__dc.settings.difficulty),'tactical');
  // A keyboard/browser selection still goes through its native change handler.
  await page.locator('#menuDifficulty').selectOption('story');assert.equal(await page.evaluate(()=>__dc.settings.difficulty),'story');
  await page.locator('#settingsBtn').click();await page.locator('#deadzoneSetting').focus();await confirm();
  assert.equal(await page.locator('#deadzoneSetting').inputValue(),'0.24');
  assert.equal(await page.evaluate(()=>__dc.settings.deadzone),.24);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('dead-circuit-settings-v1')));assert.equal(saved.deadzone,.24);assert.equal(saved.difficulty,'story');
  await page.reload();assert.equal(await page.locator('#menuDifficulty').inputValue(),'story');await page.locator('#settingsBtn').click();assert.equal(await page.locator('#deadzoneSetting').inputValue(),'0.24');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
