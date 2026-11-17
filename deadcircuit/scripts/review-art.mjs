// Controlled visual fixtures: not natural campaign or duration evidence.
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {browserPath} from '../../scripts/browser.mjs';
const out=process.argv[2]||'artifacts/deadcircuit-model-review';await mkdir(out,{recursive:true});
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});let browser;
try{
 const port=await new Promise((resolve,reject)=>{server.stdout.on('data',chunk=>{const m=String(chunk).match(/port (\d+)/);if(m)resolve(m[1]);});server.on('exit',code=>reject(Error('server '+code)));});
 browser=await chromium.launch({executablePath:browserPath(chromium),headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${port}/deadcircuit/?test=1`);await page.locator('#settingsBtn').click();await page.locator('#graphicsQualitySetting').selectOption('high');await page.locator('#settingsBack').click();await page.locator('#practiceBtn').click();await page.waitForFunction(()=>__dc?.mode==='playing');
 await page.evaluate(()=>{const g=__dc;g.enemies=[];g.bullets=[];g.profile.loadout=['arclight','longwatch'];g.player.weaponIndex=0;g.profile.fittings.arclight={optic:'redDot',muzzle:'suppressor',underbarrel:'verticalGrip'};});
 const samples=[];
 for(const quality of ['auto','high']){
  await page.evaluate(q=>__dc.setSetting('graphicsQuality',q),quality);await page.waitForFunction(q=>__dc.renderer.appliedGraphicsQuality===q,quality);await page.waitForTimeout(300);
  samples.push(await page.evaluate(async q=>{const r=__dc.renderer,original=r.draw,intervals=[];let previous;await new Promise(resolve=>{r.draw=function(...args){const now=performance.now();if(previous!==undefined)intervals.push(now-previous);previous=now;original.apply(this,args);if(intervals.length>=40){this.draw=original;resolve();}};});const sorted=[...intervals].sort((a,b)=>a-b),mean=intervals.reduce((a,b)=>a+b)/intervals.length;return{quality:q,meanFrameMs:mean,averageFps:1000/mean,p95FrameMs:sorted[Math.floor(sorted.length*.95)],frames:intervals.length,framebuffer:[r.canvas.width,r.canvas.height],gpu:r.gpuName,triangles:r.webgl.info.render.triangles,drawCalls:r.webgl.info.render.calls,method:'Actual game render calls in a controlled training scene with opponents removed for art review; not combat, natural campaign time or a hardware GPU benchmark'};},quality));
 }
 await page.waitForFunction(()=>__dc.renderer.viewWeaponKey.startsWith('arclight'));await page.waitForTimeout(600);await page.screenshot({path:out+'/rifle.png'});
 await page.evaluate(()=>{const g=__dc;g.mode='pause';g.input.clear();g.level={id:991,theme:'hospital',width:1800,height:1800,spawn:{x:900,y:1100},exit:{x:1400,y:1400},walls:[],doors:[],covers:[],objects:[],props:[{type:'bed',x:300,y:500,w:80,h:140},{type:'cabinet',x:1200,y:400,w:80,h:80}],floorZones:[],stages:[]};Object.assign(g.player,{x:900,y:1100,angle:-Math.PI/2,pitch:-.1});g.spawnEnemy({id:'showcase',type:'patrol',x:900,y:920,angle:Math.PI/2,training:true});});
 await page.waitForTimeout(800);await page.screenshot({path:out+'/security.png'});
 await page.evaluate(()=>{__dc.enemies=[];__dc.spawnEnemy({id:'showcase-infected',type:'walker',x:900,y:920,angle:Math.PI/2,training:true});});await page.waitForTimeout(600);await page.screenshot({path:out+'/infected.png'});
 await writeFile(out+'/results.json',JSON.stringify({method:'Controlled visual fixtures and short render-call samples; not natural campaign duration, combat or hardware GPU evidence',errors,samples,framebuffer:await page.evaluate(()=>[__dc.renderer.canvas.width,__dc.renderer.canvas.height])},null,2));console.log(JSON.stringify({out,errors}));
}finally{await browser?.close();server.kill();}
