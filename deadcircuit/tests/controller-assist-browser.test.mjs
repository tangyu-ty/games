import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {browserPath} from '../../scripts/browser.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');

// Stationary actors in a small arena isolate aim friction. This is an input and
// actual-renderer fixture, not a natural campaign or duration claim.
test('real shoulder-camera controller friction is bounded, respects physical walls and leaves the shot on the actual crosshair',async()=>{
 let server,browser,context;
 try{
  server=spawn(process.execPath,[fileURLToPath(new URL('../../server.mjs',import.meta.url))],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Assist server timed out')),10000);server.once('error',reject);server.stdout.on('data',chunk=>{const match=String(chunk).match(/port (\d+)/);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1]);}});});
  browser=await chromium.launch({executablePath:browserPath(chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});context=await browser.newContext({viewport:{width:1000,height:700}});
  await context.addInitScript(()=>{
   localStorage.setItem('dead-circuit-settings-v1',JSON.stringify({mute:true,reduced:true,screenShake:false,aimAssist:true}));
   window.__assistPad={connected:true,id:'Assist standard controller',index:0,mapping:'standard',axes:[0,.25,0,0],buttons:Array.from({length:17},()=>({pressed:false,touched:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[window.__assistPad]});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.stack||error.message));
  await page.goto(base+'/deadcircuit/index.html?test=1');await page.locator('#practiceBtn').click();
  const result=await page.evaluate(async()=>{
   const {controllerLookAssist}=await import('/deadcircuit/input3d.js'),g=window.__dc;
   __assistPad.axes=[0,0,0,0];g.enemies=[];g.bullets=[];g.player.x=800;g.player.y=1000;g.player.angle=0;g.player.pitch=0;g.player.invulnerable=1e6;
   g.level={...g.level,width:2400,height:2000,walls:[],covers:[],doors:[],props:[],objects:[],floorZones:[],stages:[],spawn:{x:800,y:1000},exit:{x:2200,y:1800,r:80}};
   const enemy=g.spawnEnemy({id:'assist-target',type:'patrol',x:1300,y:1000});enemy.stunTime=999;
   const r=g.renderer,height=.9625,shotsBefore=g.missionShots||0;
   for(let i=0;i<10;i++){r.prepareAim(g);const q=r.projectPoint(enemy,height),tan=Math.tan(r.camera.fov*Math.PI/360);g.player.angle+=Math.atan(q.ndcX*tan*r.camera.aspect);g.player.pitch+=Math.atan(q.ndcY*tan);}
   g.player.angle-=.035;r.prepareAim(g);
   // A standard-controller axis activates the real Input3D path on normal rAF.
   __assistPad.axes=[0,0,.25,0];
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const inputTarget=g.input.aimAssistTargetId,active=controllerLookAssist(g,.006,0,.25,0);
   __assistPad.axes=[0,0,0,0];const neutral=controllerLookAssist(g,0,0,0,0);
   g.settings.aimAssist=false;const off=controllerLookAssist(g,.006,0,.25,0);g.settings.aimAssist=true;
   const cleanLevel=g.level;g.level={...cleanLevel,walls:[{id:'assist-wall',x:1030,y:950,w:35,h:100,material:'concrete',active:true}]};r.prepareAim(g);const wall=controllerLookAssist(g,.006,0,.25,0),wallCrosshairBlocked=!!g.aimPoint3D?.blocked&&!g.aimPoint3D?.enemyId;
   g.level=cleanLevel;r.prepareAim(g);
   const savedDevice=g.input.lastDevice;g.input.lastDevice='mouse';const mouse=controllerLookAssist(g,.006,0,.25,0);g.input.lastDevice=savedDevice;
   const before={yaw:g.player.angle,pitch:g.player.pitch};
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const after={yaw:g.player.angle,pitch:g.player.pitch};
   const automaticShots=(g.missionShots||0)-shotsBefore;r.prepareAim(g);const aim={...g.aimPoint3D};g.player.fireCooldown=0;g.player.action=null;g.player.burst=null;g.firePlayer();
   const bullet=g.bullets.at(-1),from={x:bullet.x,y:bullet.y,height:bullet.height},to={x:aim.x-from.x,y:aim.y-from.y,height:aim.height-from.height};
   const cosine=(to.x*.02*bullet.vx*.02+to.y*.02*bullet.vy*.02+to.height*(bullet.vz||0))/(Math.hypot(to.x*.02,to.y*.02,to.height)*Math.hypot(bullet.vx*.02,bullet.vy*.02,bullet.vz||0));
   return{inputTarget,active,neutral,off,wall,wallCrosshairBlocked,mouse,before,after,cosine,automaticShots,shots:(g.missionShots||0)-shotsBefore};
  });
  assert.equal(result.inputTarget,'assist-target');assert.equal(result.active.targetId,'assist-target');assert.ok(result.active.friction>=.72&&result.active.friction<1);
  for(const key of ['off','wall','mouse','neutral'])assert.equal(result[key].friction,1,key+' does not assist');
  assert.equal(result.wallCrosshairBlocked,true,'The real 3D camera also sees the same wall obstruction');assert.equal(result.automaticShots,0);assert.equal(result.shots,1,'Only the explicit trigger fixture fires a round');
  assert.deepEqual(result.after,result.before,'No right-stick input means no automatic tracking');
  assert.ok(Number.isFinite(result.cosine)&&result.cosine>.98&&result.cosine<=1.000001,'An assisted camera still fires along its real crosshair, subject to the normal weapon spread');
  assert.deepEqual(errors,[]);
 }finally{await context?.close();await browser?.close();server?.kill();}
});
