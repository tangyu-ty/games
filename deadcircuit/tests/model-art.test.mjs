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
const output=process.env.ARTIFACT_DIR||fileURLToPath(new URL('../../artifacts/deadcircuit-model-art/',import.meta.url));
before(async()=>{
 await mkdir(output,{recursive:true});
 if(!base){server=spawn(process.execPath,[fileURLToPath(new URL('../../server.mjs',import.meta.url))],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('3D throwable test server timed out')),10000);server.once('error',reject);server.once('exit',code=>{clearTimeout(timer);reject(Error('3D throwable server exited '+code));});server.stdout.on('data',chunk=>{const match=String(chunk).match(/port (\d+)/);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1]);}});});}
 browser=await chromium.launch({executablePath:browserPath(chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
});
afterEach(async()=>{await Promise.all([...contexts].map(c=>c.close().catch(()=>{})));contexts.clear();});
after(async()=>{await browser?.close();server?.kill();});
async function arena(){
 const context=await browser.newContext({viewport:{width:1280,height:800}});contexts.add(context);
 await context.addInitScript(()=>{if(!localStorage.getItem('dead-circuit-settings-v1'))localStorage.setItem('dead-circuit-settings-v1',JSON.stringify({mute:true,screenShake:false,reducedMotion:true}));});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/deadcircuit/index.html?test=1');await page.waitForFunction(()=>window.__dc?.renderer?.is3D,null,WAIT);await page.locator('#practiceBtn').click();await page.waitForFunction(()=>__dc.mode==='playing',null,WAIT);return{page,errors};
}

test('graphics quality changes the actual framebuffer through settings and survives reload',async()=>{
 const {page,errors}=await arena();await page.keyboard.press('Escape');await page.waitForFunction(()=>__dc.mode==='pause',null,WAIT);await page.locator('#pauseSettings').click();
 await page.locator('#graphicsQualitySetting').selectOption('high');await page.locator('#settingsBack').click();await page.waitForFunction(()=>__dc.renderer.appliedGraphicsQuality==='high',null,WAIT);
 const high=await page.evaluate(()=>({width:__dc.renderer.canvas.width,height:__dc.renderer.canvas.height}));assert.ok(high.width>=1200&&high.height>=750);
 await page.reload();await page.waitForFunction(()=>window.__dc?.settings.graphicsQuality==='high',null,WAIT);await page.locator('#settingsBtn').click();assert.equal(await page.locator('#graphicsQualitySetting').inputValue(),'high');await page.locator('#graphicsQualitySetting').selectOption('performance');await page.locator('#settingsBack').click();
 await page.waitForFunction(()=>__dc.renderer.appliedGraphicsQuality==='performance',null,WAIT);const low=await page.evaluate(()=>({width:__dc.renderer.canvas.width,height:__dc.renderer.canvas.height}));assert.ok(low.width*low.height<high.width*high.height*.5);assert.deepEqual(errors,[]);
});

test('all weapon and fitting models have finite geometry and valid muzzle transforms without changing gameplay inventory',async()=>{
 const {page,errors}=await arena();const data=await page.evaluate(async()=>{const {WEAPONS}=await import('/deadcircuit/armory.js'),r=__dc.renderer,before=JSON.stringify(__dc.profile),out=[];for(const weapon of WEAPONS)for(const fit of [{},{muzzle:'suppressor',optic:'scope3',magazine:'extendedMag',underbarrel:'bipod',rail:'bioSensor'}]){const model=r.buildWeapon(weapon.id,fit);model.updateMatrixWorld(true);let meshes=0,invalid=false;model.traverse(part=>{if(part.isMesh){meshes++;const p=part.geometry.attributes.position;for(let i=0;i<p.array.length;i++)if(!Number.isFinite(p.array[i]))invalid=true;if(part.matrixWorld.elements.some(n=>!Number.isFinite(n)))invalid=true;}});out.push({id:weapon.id,meshes,invalid,muzzle:model.userData.muzzle.position.toArray(),length:model.userData.length});}return{out,unchanged:JSON.stringify(__dc.profile)===before};});
 assert.equal(data.out.length,28);for(const model of data.out){assert.ok(model.meshes>=20,model.id);assert.equal(model.invalid,false,model.id);assert.ok(model.muzzle.every(Number.isFinite));assert.ok(model.muzzle[0]>model.length*.8);}assert.equal(data.unchanged,true);assert.deepEqual(errors,[]);
});
