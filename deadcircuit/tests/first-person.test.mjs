import {test,before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {browserPath} from '../../scripts/browser.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const contexts=new Set(),WAIT={timeout:12000};let server,browser,base=process.env.TEST_URL;
const output=process.env.ARTIFACT_DIR||fileURLToPath(new URL('../../artifacts/deadcircuit-first-person/',import.meta.url));
before(async()=>{
 await mkdir(output,{recursive:true});
 if(!base){server=spawn(process.execPath,[fileURLToPath(new URL('../../server.mjs',import.meta.url))],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('3D throwable test server timed out')),10000);server.once('error',reject);server.once('exit',code=>{clearTimeout(timer);reject(Error('3D throwable server exited '+code));});server.stdout.on('data',chunk=>{const match=String(chunk).match(/port (\d+)/);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1]);}});});}
 browser=await chromium.launch({executablePath:browserPath(chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
});
afterEach(async()=>{await Promise.all([...contexts].map(c=>c.close().catch(()=>{})));contexts.clear();});
after(async()=>{await browser?.close();server?.kill();});
async function arena(){
 const context=await browser.newContext({viewport:{width:1280,height:800}});contexts.add(context);
 await context.addInitScript(()=>localStorage.setItem('dead-circuit-settings-v1',JSON.stringify({mute:true,screenShake:false,reducedMotion:true})));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/deadcircuit/index.html?test=1');await page.waitForFunction(()=>window.__dc?.renderer?.is3D,null,WAIT);await page.locator('#practiceBtn').click();await page.waitForFunction(()=>__dc.mode==='playing',null,WAIT);return{page,errors};
}

test('first-person view follows the player, shows the equipped weapon and hides the player model',async()=>{
 const {page,errors}=await arena();
 await page.waitForFunction(()=>__dc.renderer.viewWeapon?.visible&&__dc.renderer.viewArms?.visible,null,WAIT);
 const state=await page.evaluate(()=>{const g=__dc,r=g.renderer;return{player:{x:g.player.x,y:g.player.y},camera:r.cameraData,gun:r.viewWeaponKey,arms:r.viewArms.visible,playerMeshes:[...r.actorMap.get('player').group.children].filter(x=>x.isMesh).map(x=>x.visible)};});
 assert.ok(Math.abs(state.camera.x-state.player.x)<.01&&Math.abs(state.camera.y-state.player.y)<.01);assert.equal(state.camera.desiredDistance,0);assert.ok(state.gun.length>0);
 assert.equal(state.arms,true);assert.ok(state.playerMeshes.every(v=>!v));
 await page.screenshot({path:path.join(output,'first-person.png')});
 await page.keyboard.down('KeyW');try{await page.waitForFunction(p=>Math.hypot(__dc.player.x-p.x,__dc.player.y-p.y)>15,state.player,WAIT);}finally{await page.keyboard.up('KeyW');}
 const moved=await page.evaluate(()=>({p:__dc.player,c:__dc.renderer.cameraData}));assert.ok(Math.hypot(moved.c.x-moved.p.x,moved.c.y-moved.p.y)<.1);assert.deepEqual(errors,[]);
});
