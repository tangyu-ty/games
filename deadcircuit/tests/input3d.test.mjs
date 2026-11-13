import {test,before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {browserPath} from '../../scripts/browser.mjs';

// An isolated consumer of the real Input3D module. These fixtures test device
// semantics and browser pointer lock; they are not campaign-duration evidence.
const {chromium}=createRequire(import.meta.url)('playwright');
let server,browser,base=process.env.TEST_URL;const contexts=new Set();
before(async()=>{
 if(!base){
  server=spawn(process.execPath,[fileURLToPath(new URL('../../server.mjs',import.meta.url))],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Input3D server timed out')),10000);server.once('error',reject);server.once('exit',code=>{clearTimeout(timer);reject(Error('Input3D server exited '+code));});server.stdout.on('data',chunk=>{const match=String(chunk).match(/port (\d+)/);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1]);}});});
 }
 browser=await chromium.launch({executablePath:browserPath(chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
});
afterEach(async()=>{await Promise.all([...contexts].map(context=>context.close().catch(()=>{})));contexts.clear();});
after(async()=>{await browser?.close();server?.kill();});

const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{position:fixed;inset:0;width:100%;height:100%;background:#18303b;touch-action:none}#overlay{position:fixed;inset:0;background:#19232bee;padding:20px;color:white;z-index:5;overflow:auto}#overlay button,select{font-size:18px;padding:12px;margin:8px}.dialogue-text{height:130px;overflow:auto}.touch-stick{position:fixed;left:20px;bottom:20px;width:100px;height:100px;border-radius:50%;background:#8889;z-index:3;touch-action:none}#fire{position:fixed;right:20px;bottom:20px;width:70px;height:60px;z-index:3;touch-action:none}
</style></head><body><canvas id="game"></canvas><main id="overlay"><button id="resume">继续</button><button id="next">下一句</button><select id="difficulty"><option value="standard">标准</option><option value="tactical">战术</option></select><div class="dialogue-text">${'真实文档的长段落。'.repeat(100)}</div></main><div id="touchControls"><div class="touch-stick" data-stick="move"><i></i></div><button id="fire" data-touch="fire">开火</button></div><script type="module">
import {Input3D} from '/deadcircuit/input3d.js';
const overlay=document.querySelector('#overlay');
const game={mode:'playing',settings:{deadzone:.18},player:{x:500,y:500,angle:0,pitch:0},controls:{x:0,y:0},toasts:[],calls:{pause:0,resume:0,dialogue:0},audio:{unlock(){}},
setMode(mode){this.mode=mode;this.input?.clear();overlay.style.display=mode==='playing'?'none':'block';},
pause(){this.calls.pause++;this.setMode('pause');},resume(){this.calls.resume++;this.setMode('playing');},back(){this.resume();},
advanceDialogue(){this.calls.dialogue++;},showJournal(){this.setMode('journal');},showLoadout(){this.setMode('loadout');},
toast(text){this.toasts.push(text);},dodge(x,y){this.calls.dodge={x,y};},toggleCover(){this.calls.cover=true;},toggleCrouch(){this.calls.crouch=true;},reload(){this.calls.reload=true;},switchWeapon(slot){this.calls.swap=slot??true;},throwGrenade(type){this.calls.grenade=type||'frag';},cycleGrenade(){this.calls.grenadeType=true;},heal(){this.calls.heal=true;}};
game.input=new Input3D(game,document.querySelector('#game'));game.setMode('playing');window.__fixture=game;
document.querySelector('#resume').onclick=()=>game.resume();document.querySelector('#next').onclick=()=>game.advanceDialogue();document.querySelector('#difficulty').onchange=event=>{game.settings.difficulty=event.target.value;};
let last=performance.now();function frame(now){game.input.update(Math.min(.1,(now-last)/1000));last=now;requestAnimationFrame(frame);}requestAnimationFrame(frame);
</script></body></html>`;

async function session({pad=false,denied=false,touch=false}={}){
 const context=await browser.newContext({viewport:touch?{width:390,height:844}:{width:900,height:650},hasTouch:touch,isMobile:touch});contexts.add(context);
 await context.addInitScript(({pad,denied})=>{
  if(pad){window.__pad3d={connected:true,id:'Input3D standard controller',index:0,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0,touched:false}))};Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[window.__pad3d]});}
  if(denied)HTMLCanvasElement.prototype.requestPointerLock=function(){return Promise.reject(new DOMException('Fixture denies pointer lock','SecurityError'));};
 },{pad,denied});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.stack||error.message));
 await page.route('**/__input3d_fixture',route=>route.fulfill({contentType:'text/html',body:html}));
 await page.goto(base+'/__input3d_fixture');await page.waitForFunction(()=>window.__fixture?.input);
 return{context,page,errors};
}
async function frames(page,count=6){await page.evaluate(count=>new Promise(resolve=>{let n=0;function frame(){if(++n>=count)resolve();else requestAnimationFrame(frame);}requestAnimationFrame(frame);}),count);}
async function setPad(page,{axes,buttons}={}){await page.evaluate(({axes,buttons})=>{if(axes)__pad3d.axes=axes;if(buttons)__pad3d.buttons=Array.from({length:17},(_,index)=>({pressed:buttons.includes(index),touched:buttons.includes(index),value:buttons.includes(index)?1:0}));},{axes,buttons});await frames(page);}

test('keyboard movement is camera-relative, diagonals stay normalized, and tactical actions retain their mappings',async()=>{
 const {page,errors}=await session();
 await page.keyboard.down('KeyW');await frames(page);let c=await page.evaluate(()=>({...__fixture.controls}));assert.ok(c.x>.99&&Math.abs(c.y)<.001);
 await page.keyboard.up('KeyW');await page.evaluate(()=>{__fixture.player.angle=Math.PI/2;});await page.keyboard.down('KeyW');await frames(page);c=await page.evaluate(()=>({...__fixture.controls}));assert.ok(c.y>.99&&Math.abs(c.x)<.001);
 await page.keyboard.down('KeyD');await frames(page);c=await page.evaluate(()=>({...__fixture.controls}));assert.ok(c.x<-.7&&c.y>.7);assert.ok(Math.abs(Math.hypot(c.x,c.y)-1)<1e-6);
 await page.keyboard.up('KeyW');await page.keyboard.up('KeyD');
 for(const [key,field]of[['KeyR','reload'],['KeyC','cover'],['ControlLeft','crouch'],['KeyQ','swap'],['KeyG','grenade'],['KeyV','heal']]){await page.keyboard.press(key);await frames(page);assert.ok(await page.evaluate(field=>__fixture.calls[field],field));}
 await page.keyboard.press('Space');await frames(page);assert.ok(await page.evaluate(()=>__fixture.calls.dodge));
 await page.keyboard.press('Tab');await frames(page);assert.equal(await page.evaluate(()=>__fixture.mode),'loadout');assert.equal(await page.evaluate(()=>__fixture.controls.fire),false);
 assert.deepEqual(errors,[]);
});

test('real browser pointer lock rotates yaw and pitch, intentional menus release it, and external loss pauses exactly once',async()=>{
 const {page,errors}=await session();
 await page.mouse.move(400,300);await page.mouse.down();await page.waitForFunction(()=>document.pointerLockElement===document.querySelector('#game')&&__fixture.input.wasPointerLocked);
 await frames(page);assert.equal(await page.evaluate(()=>__fixture.controls.fire),false,'The capture click does not fire');await page.mouse.up();
 await page.mouse.move(430,280);await frames(page);let p=await page.evaluate(()=>({...__fixture.player}));assert.ok(p.angle>0,'Moving the mouse right turns the camera right');assert.ok(p.pitch>0,'Moving the mouse up raises the view');
 await page.mouse.down();await frames(page);assert.equal(await page.evaluate(()=>__fixture.controls.fire),true);await page.mouse.up();
 await page.evaluate(()=>{for(let i=0;i<8;i++)document.dispatchEvent(new MouseEvent('mousemove',{movementY:-1000,bubbles:true}));});await frames(page);assert.equal(await page.evaluate(()=>__fixture.player.pitch),1.08);
 await page.keyboard.press('KeyM');await page.waitForFunction(()=>__fixture.mode==='journal'&&document.pointerLockElement===null&&!__fixture.input.wasPointerLocked&&!__fixture.input.unlockPending);assert.equal(await page.evaluate(()=>__fixture.calls.pause),0,'Opening a menu intentionally releases the cursor without adding a pause');
 await page.locator('#resume').click();await page.mouse.move(400,300);await page.mouse.click(400,300);await page.waitForFunction(()=>document.pointerLockElement===document.querySelector('#game')&&__fixture.input.wasPointerLocked);
 await page.evaluate(()=>document.exitPointerLock());await page.waitForFunction(()=>__fixture.mode==='pause');assert.equal(await page.evaluate(()=>__fixture.calls.pause),1);assert.equal(await page.evaluate(()=>__fixture.controls.fire),false);assert.equal(await page.evaluate(()=>__fixture.input.pointerLocked),false);
 await page.locator('#resume').click();await page.mouse.click(400,300);await page.waitForFunction(()=>__fixture.input.pointerLocked&&__fixture.input.wasPointerLocked);await page.keyboard.press('Escape');await page.waitForFunction(()=>__fixture.mode==='pause'&&!__fixture.input.pointerLocked);await frames(page,8);assert.equal(await page.evaluate(()=>__fixture.mode),'pause','Native Escape must not pause on unlock and then immediately toggle back to play');
 assert.deepEqual(errors,[]);
});

test('denied pointer lock keeps a usable right-drag camera and left-button fire without uncaught errors',async()=>{
 const {page,errors}=await session({denied:true});
 await page.mouse.click(400,300);await page.waitForFunction(()=>__fixture.input.lookFallback);assert.equal(await page.evaluate(()=>__fixture.mode),'playing');
 await page.mouse.move(400,300);await page.mouse.down({button:'right'});await page.mouse.move(470,260);await frames(page);
 const p=await page.evaluate(()=>({...__fixture.player}));assert.ok(p.angle>.05&&p.pitch>.02);
 await page.mouse.down({button:'left'});await frames(page);assert.equal(await page.evaluate(()=>__fixture.controls.fire&&__fixture.controls.aim),true);await page.mouse.up({button:'left'});await page.mouse.up({button:'right'});
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await frames(page);assert.equal(await page.evaluate(()=>__fixture.mode),'pause');assert.deepEqual(await page.evaluate(()=>({x:__fixture.controls.x,y:__fixture.controls.y,fire:__fixture.controls.fire})),{x:0,y:0,fire:false});assert.equal(await page.evaluate(()=>__fixture.toasts.length),1);
 assert.deepEqual(errors,[]);
});

test('standard gamepad right stick is a rate-controlled view, left stick is camera-relative, and held fire does not leak through menus',async()=>{
 const {page,errors}=await session({pad:true});
 await setPad(page,{axes:[0,0,1,-1]});const first=await page.evaluate(()=>({...__fixture.player}));await frames(page);const second=await page.evaluate(()=>({...__fixture.player}));assert.ok(second.angle>first.angle&&second.pitch>first.pitch,'Holding a stick keeps turning rather than setting an absolute world angle');
 await setPad(page,{axes:[0,0,0,0]});const stopped=await page.evaluate(()=>({...__fixture.player}));await frames(page);assert.deepEqual(await page.evaluate(()=>({...__fixture.player})),stopped);
 await page.evaluate(()=>{__fixture.player.angle=Math.PI/2;__fixture.player.pitch=0;});await setPad(page,{axes:[0,-1,0,0]});let c=await page.evaluate(()=>({...__fixture.controls}));assert.ok(c.y>.99&&Math.abs(c.x)<.001);
 await setPad(page,{axes:[1,0,0,0]});c=await page.evaluate(()=>({...__fixture.controls}));assert.ok(c.x<-.99&&Math.abs(c.y)<.001);
 await setPad(page,{axes:[.1,-.1,.1,-.1]});c=await page.evaluate(()=>({...__fixture.controls}));assert.ok(Math.abs(c.x)+Math.abs(c.y)<.001,'All sticks respect the configured deadzone');
 await setPad(page,{axes:[0,0,0,0],buttons:[7]});assert.equal(await page.evaluate(()=>__fixture.controls.fire),true);
 await page.keyboard.press('Escape');await page.waitForFunction(()=>__fixture.mode==='pause');await page.locator('#resume').click();await frames(page);assert.equal(await page.evaluate(()=>__fixture.controls.fire),false,'A trigger held before the menu must be released before firing again');
 await setPad(page,{buttons:[]});await setPad(page,{buttons:[7]});assert.equal(await page.evaluate(()=>__fixture.controls.fire),true);
 await page.evaluate(()=>{__pad3d.connected=false;});await page.waitForFunction(()=>__fixture.mode==='pause');assert.equal(await page.evaluate(()=>__fixture.controls.fire),false);
 assert.deepEqual(errors,[]);
});

test('touch camera swipes and independent fire are separate, and cancelling a contact releases its action',async()=>{
 const {page,context,errors}=await session({touch:true}),cdp=await context.newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:300,y:300}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:350,y:265}]});await frames(page);
 let state=await page.evaluate(()=>({p:{...__fixture.player},controls:{...__fixture.controls}}));assert.ok(state.p.angle>.1&&state.p.pitch>.05);assert.equal(state.controls.fire,false,'A look swipe never silently fires');
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await frames(page);assert.equal(await page.evaluate(()=>__fixture.input.touchAim),null);
 const button=await page.locator('#fire').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:2,x:button.x+button.width/2,y:button.y+button.height/2}]});await frames(page);assert.equal(await page.evaluate(()=>__fixture.controls.fire),true);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await frames(page);assert.equal(await page.evaluate(()=>__fixture.controls.fire),false);
 const stick=await page.locator('[data-stick]').boundingBox(),x=stick.x+stick.width/2,y=stick.y+stick.height/2;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:3,x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:3,x,y:y-42}]});await frames(page);
 state=await page.evaluate(()=>({p:{...__fixture.player},controls:{...__fixture.controls}}));const forward=state.controls.x*Math.cos(state.p.angle)+state.controls.y*Math.sin(state.p.angle);assert.ok(forward>.8,'The touch stick follows the same camera-relative movement');
 await page.keyboard.press('KeyM');await frames(page);assert.equal(await page.evaluate(()=>__fixture.mode),'journal');assert.equal(await page.evaluate(()=>__fixture.controls.fire),false);assert.equal(await page.evaluate(()=>Math.hypot(__fixture.input.touchMove.x,__fixture.input.touchMove.y)),0);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.deepEqual(errors,[]);
});
