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
const output=process.env.ARTIFACT_DIR||fileURLToPath(new URL('../../artifacts/deadcircuit-throwable3d/',import.meta.url));
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

test('ammo and armor have visible instanced 3D models, then disappear after actual movement collects their resources',async()=>{
 const {page,errors}=await arena();
 // Controlled supply placement and resource preconditions isolate presentation.
 // Collection and removal advance through ordinary input and animation frames.
 // This fixture supplies no natural campaign coverage or duration evidence.
 await page.evaluate(()=>{const g=__dc,p=g.player;g.enemies=[];g.bullets=[];g.effects=[];g.pickups=[];p.armor=30;for(const id of g.profile.loadout)g.profile.ammo[id].reserve=0;const forward={x:Math.cos(p.angle),y:Math.sin(p.angle)};g.pickups.push({type:'ammo',x:p.x+forward.x*140,y:p.y+forward.y*140,r:11,amount:22,life:80},{type:'armor',x:p.x+forward.x*225,y:p.y+forward.y*225,r:11,amount:20,life:80});});
 await page.waitForFunction(()=>__dc.renderer.lootVisuals?.get('ammo')?.count===1&&__dc.renderer.lootVisuals?.get('armor')?.count===1,null,WAIT);
 const first=await page.evaluate(()=>{const g=__dc,r=g.renderer;r.syncLoot(g);return g.pickups.map(p=>{const mesh=r.lootVisuals.get(p.type),a=Array.from(mesh.instanceMatrix.array.slice(0,16));return{type:p.type,count:mesh.count,visible:mesh.visible,isInstancedMesh:mesh.isInstancedMesh,parented:mesh.parent===r.scene,worldPosition:{x:a[12],height:a[13],z:a[14]},source:{x:p.x*.02,z:p.y*.02},projected:r.projectPoint(p,.13)};});});
 for(const a of first){assert.equal(a.count,1);assert.equal(a.visible,true);assert.equal(a.isInstancedMesh,true);assert.equal(a.parented,true);assert.ok(Math.abs(a.worldPosition.x-a.source.x)<1e-5);assert.ok(Math.abs(a.worldPosition.z-a.source.z)<1e-5);assert.ok(a.worldPosition.height>.09&&a.worldPosition.height<.17);assert.equal(a.projected.visible,true);}
 await page.screenshot({path:path.join(output,'supplies-visible.png')});
 await page.keyboard.down('KeyW');try{await page.waitForFunction(()=>__dc.pickups.length===0&&[...__dc.renderer.lootVisuals.values()].every(mesh=>mesh.count===0&&!mesh.visible),null,WAIT);}finally{await page.keyboard.up('KeyW');}
 const collected=await page.evaluate(()=>({armor:__dc.player.armor,reserve:__dc.weaponState.reserve,sourceCount:__dc.pickups.length,batches:[...__dc.renderer.lootVisuals].map(([type,mesh])=>({type,count:mesh.count,visible:mesh.visible}))}));
 assert.equal(collected.armor,50);assert.equal(collected.reserve,22);assert.equal(collected.sourceCount,0);assert.ok(collected.batches.every(b=>b.count===0&&!b.visible));assert.deepEqual(errors,[]);
 await writeFile(path.join(output,'supply-result.json'),JSON.stringify({first,collected,method:'Explicit supply fixture, collected using real W-key input and normal game frames.'},null,2));
});

test('real G-key throwing visibly draws an airborne 3D grenade and removes that model when its real fuse ends',async()=>{
 const {page,errors}=await arena();const before=await page.evaluate(()=>__dc.profile.grenades.frag);
 await page.keyboard.press('KeyG');await page.waitForFunction(()=>__dc.throwables.length>0&&__dc.renderer.grenadeVisual?.count===1,null,WAIT);
 const flying=await page.evaluate(()=>{const g=__dc,r=g.renderer;r.syncLoot(g);const grenade=g.throwables[0],mesh=r.grenadeVisual,a=Array.from(mesh.instanceMatrix.array.slice(0,16));return{count:mesh.count,visible:mesh.visible,isInstancedMesh:mesh.isInstancedMesh,parented:mesh.parent===r.scene,worldHeight:a[13],worldPosition:{x:a[12],z:a[14]},source:{x:grenade.x*.02,z:grenade.y*.02},simulationLife:grenade.life,colorAttribute:!!mesh.instanceColor,stock:g.profile.grenades.frag};});
 assert.equal(flying.count,1);assert.equal(flying.visible,true);assert.equal(flying.isInstancedMesh,true);assert.equal(flying.parented,true);assert.ok(flying.worldHeight>.2);assert.ok(Math.abs(flying.worldPosition.x-flying.source.x)<1e-5);assert.ok(Math.abs(flying.worldPosition.z-flying.source.z)<1e-5);assert.equal(flying.colorAttribute,true);assert.equal(flying.stock,before-1);
 await page.screenshot({path:path.join(output,'grenade-in-flight.png')});
 await page.waitForFunction(()=>__dc.throwables.length===0&&__dc.renderer.grenadeVisual.count===0&&!__dc.renderer.grenadeVisual.visible,null,WAIT);assert.deepEqual(errors,[]);
 await writeFile(path.join(output,'grenade-result.json'),JSON.stringify({flying,removed:true,method:'Real G-key input, real resource use and fuse, normal game frames. No modified physics, clocks or objectives.'},null,2));
});
