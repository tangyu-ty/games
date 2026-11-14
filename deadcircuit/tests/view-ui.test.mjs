import {test,before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {browserPath} from '../../scripts/browser.mjs';

// These focus on the real 3D view's controls and interface. Enemy removal is a
// safety fixture for UI checks; these are not natural gameplay duration evidence.
const {chromium}=createRequire(import.meta.url)('playwright'),contexts=new Set(),WAIT={timeout:12000};
let browser,server,BASE=process.env.TEST_URL;
before(async()=>{
 if(!BASE){
  server=spawn(process.execPath,[fileURLToPath(new URL('../../server.mjs',import.meta.url))],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  BASE=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Shoulder-view UI test server timed out')),10000);server.once('error',reject);server.stdout.on('data',chunk=>{const m=String(chunk).match(/port (\d+)/);if(m){clearTimeout(timer);resolve('http://127.0.0.1:'+m[1]);}});});
 }
 browser=await chromium.launch({executablePath:browserPath(chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
});
afterEach(async()=>{await Promise.all([...contexts].map(c=>c.close().catch(()=>{})));contexts.clear();});
after(async()=>{await browser?.close();server?.kill();});
async function session({touch=false,denyCapture=false,pad=false}={}){
 const context=await browser.newContext({viewport:touch?{width:390,height:844}:{width:1280,height:800},hasTouch:touch,isMobile:touch});contexts.add(context);
 await context.addInitScript(({denyCapture,pad})=>{
  if(!localStorage.getItem('dead-circuit-settings-v1'))localStorage.setItem('dead-circuit-settings-v1',JSON.stringify({mute:true,reduced:true,reducedMotion:true,screenShake:false}));
  if(denyCapture)Object.defineProperty(HTMLCanvasElement.prototype,'requestPointerLock',{configurable:true,value(){return Promise.reject(new DOMException('Fixture denies mouse capture','NotAllowedError'));}});
  if(pad){window.__uiPad={connected:true,index:0,id:'Standard UI fixture',mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0,touched:false}))};Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[window.__uiPad]});}
 },{denyCapture,pad});
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.goto(BASE+'/deadcircuit/index.html?test=1');await page.waitForFunction(()=>window.__dc?.renderer?.is3D&&window.__dc?.input,null,WAIT);return{context,page,errors};
}
async function quiet(page){await page.evaluate(()=>{__dc.enemies=[];__dc.bullets=[];__dc.player.invulnerable=1e6;});}
async function frames(page,n=4){await page.evaluate(n=>new Promise(resolve=>{const next=()=>--n<=0?resolve():requestAnimationFrame(next);requestAnimationFrame(next);}),n);}
async function centeredReticle(page){const b=await page.locator('#combatReticle').boundingBox(),v=page.viewportSize();assert.ok(b);assert.ok(Math.abs(b.x+b.width/2-v.width/2)<1&&Math.abs(b.y+b.height/2-v.height/2)<1,'The shoulder-view reticle remains in the screen center');}

test('shoulder-view mouse entry, centered reticle and pause/resume preserve a playable control flow',async()=>{
 const {page,errors}=await session();assert.match(await page.locator('.build-note').innerText(),/第一人称/);await page.locator('#practiceBtn').click();await page.waitForFunction(()=>__dc.mode==='playing',null,WAIT);await quiet(page);await page.locator('#combatReticle').waitFor({state:'visible',...WAIT});await centeredReticle(page);
 await page.waitForFunction(()=>__dc.input.pointerLocked||__dc.input.lookFallback,null,WAIT);const locked=await page.evaluate(()=>__dc.input.pointerLocked);assert.equal(await page.locator('#mouseCaptureHint').isVisible(),!locked);
 const ads=await page.evaluate(()=>{__dc.controls.aim=true;__dc.ui.update();return document.getElementById('combatReticle').classList.contains('aiming');});assert.equal(ads,true);
 await page.keyboard.press('Escape');await page.waitForFunction(()=>__dc.mode==='pause',null,WAIT);assert.equal(await page.evaluate(()=>__dc.input.pointerLocked),false);assert.equal(await page.locator('#combatReticle').isVisible(),false);
 await page.locator('#pauseResume').click();await page.waitForFunction(()=>__dc.mode==='playing',null,WAIT);await page.waitForFunction(()=>__dc.input.pointerLocked||__dc.input.lookFallback,null,WAIT);
 const ammo=await page.evaluate(()=>__dc.weaponState.mag);await page.keyboard.press('m');await page.waitForFunction(()=>__dc.mode==='journal',null,WAIT);assert.equal(await page.evaluate(()=>__dc.input.pointerLocked),false);await page.locator('#journalBack').click();await page.waitForFunction(()=>__dc.mode==='playing',null,WAIT);await frames(page);assert.equal(await page.evaluate(()=>__dc.weaponState.mag),ammo,'Returning through a menu captures the mouse without firing an accidental shot');assert.deepEqual(errors,[]);
});

test('a refused mouse lock exposes the drag-camera fallback and a working retry control',async()=>{
 const {page,errors}=await session({denyCapture:true});await page.locator('#practiceBtn').click();await page.waitForFunction(()=>__dc.mode==='playing'&&__dc.input.lookFallback,null,WAIT);await quiet(page);await page.locator('#mouseCaptureHint').waitFor({state:'visible',...WAIT});assert.match(await page.locator('#mouseCaptureHint').innerText(),/拖动模式/);assert.match(await page.locator('#captureMouseBtn').innerText(),/重试/);await page.locator('#captureMouseBtn').click();await frames(page);assert.equal(await page.evaluate(()=>__dc.mode),'playing');assert.equal(await page.evaluate(()=>__dc.input.pointerLocked),false);await centeredReticle(page);assert.deepEqual(errors,[],'A browser refusing capture cannot become an uncaught exception');
});

test('touch shoulder view separates looking from held fire and keeps the center and pause control clear',async()=>{
 const {page,context,errors}=await session({touch:true});await page.locator('#practiceBtn').tap();await page.waitForFunction(()=>__dc.mode==='playing',null,WAIT);await quiet(page);await page.locator('#touchFireButton').waitFor({state:'visible',...WAIT});assert.equal(await page.locator('#mouseCaptureHint').isVisible(),false);await centeredReticle(page);
 const cdp=await context.newCDPSession(page),before=await page.evaluate(()=>({angle:__dc.player.angle,ammo:__dc.weaponState.mag}));
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:265,y:340}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:315,y:350}]});await frames(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await frames(page);assert.notEqual(await page.evaluate(()=>__dc.player.angle),before.angle,'Right-side dragging turns the 3D camera');assert.equal(await page.evaluate(()=>__dc.weaponState.mag),before.ammo,'Looking alone does not fire');
 const fire=await page.locator('#touchFireButton').boundingBox(),pause=await page.locator('#hudPause').boundingBox();assert.ok(fire&&pause);assert.ok(fire.y>pause.y+pause.height,'The fire control does not obscure pause');assert.ok(Math.abs(fire.y+fire.height/2-422)>70,'The fire control leaves the screen-center sightline open');
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:2,x:fire.x+fire.width/2,y:fire.y+fire.height/2}]});await page.waitForFunction(ammo=>__dc.weaponState.mag<ammo,before.ammo,WAIT);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await frames(page);const released=await page.evaluate(()=>__dc.weaponState.mag);await frames(page,8);assert.equal(await page.evaluate(()=>__dc.weaponState.mag),released,'Releasing the dedicated fire button stops automatic shooting');
 await page.locator('#hudPause').tap();await page.waitForFunction(()=>__dc.mode==='pause',null,WAIT);assert.equal(await page.locator('#touchFireButton').isVisible(),false);await page.locator('#pauseResume').tap();await page.waitForFunction(()=>__dc.mode==='playing',null,WAIT);await frames(page,8);assert.equal(await page.evaluate(()=>__dc.weaponState.mag),released,'Returning from a menu does not retain a held touch shot');
 await page.setViewportSize({width:320,height:568});await frames(page);await centeredReticle(page);const widths=await page.evaluate(()=>({page:document.documentElement.scrollWidth,overlay:document.getElementById('overlay').scrollWidth}));assert.ok(widths.page<=320&&widths.overlay<=320);assert.deepEqual(errors,[]);
});

test('controller-operable shoulder camera sensitivity and inverted view settings persist after reload',async()=>{
 const {page,errors}=await session({pad:true});
 const confirm=async()=>{await page.evaluate(()=>{__uiPad.buttons[0]={pressed:true,value:1,touched:true};});await page.waitForFunction(()=>__dc.input.padPrevious[0]===true,null,WAIT);await page.evaluate(()=>{__uiPad.buttons[0]={pressed:false,value:0,touched:false};});await page.waitForFunction(()=>__dc.input.padPrevious[0]===false,null,WAIT);};
 await page.locator('#settingsBtn').focus();await frames(page);await confirm();await page.waitForFunction(()=>__dc.mode==='settings',null,WAIT);
 for(const selector of ['#settingsMouseSensitivity','#settingsLookSensitivity','#settingsTouchSensitivity']){await page.locator(selector).focus();await confirm();}
 await page.locator('[data-setting="invertY"]').focus();await confirm();
 const expected={mouseSensitivity:.0036,lookSensitivity:1.4,touchSensitivity:.0073,invertY:true};assert.deepEqual(await page.evaluate(()=>Object.fromEntries(['mouseSensitivity','lookSensitivity','touchSensitivity','invertY'].map(key=>[key,__dc.settings[key]]))),expected);
 await page.reload();await page.waitForFunction(()=>window.__dc?.mode==='menu'&&window.__dc?.input,null,WAIT);await page.locator('#settingsBtn').focus();await frames(page);await confirm();await page.waitForFunction(()=>__dc.mode==='settings',null,WAIT);assert.deepEqual(await page.evaluate(()=>Object.fromEntries(['mouseSensitivity','lookSensitivity','touchSensitivity','invertY'].map(key=>[key,__dc.settings[key]]))),expected);assert.equal(await page.locator('#settingsMouseSensitivity').inputValue(),'0.0036');assert.equal(await page.locator('#settingsLookSensitivity').inputValue(),'1.4');assert.equal(await page.locator('#settingsTouchSensitivity').inputValue(),'0.0073');assert.equal(await page.locator('[data-setting="invertY"]').getAttribute('aria-pressed'),'true');assert.deepEqual(errors,[]);
});
