#!/usr/bin/env node
/** Real-time browser endurance runner. It never calls update(), changes game stats, or advances clocks. */
import {browserPath} from './browser.mjs';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,rename,appendFile,readdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const ROOT=fileURLToPath(new URL('../',import.meta.url));
export function parseArgs(args){
 const options={hours:10,output:null,base:null,interval:125,screenshotMinutes:20,browserRecycleVoyages:10,browserRecycleMinutes:30,disableGpu:false};
 for(let i=0;i<args.length;i++){
  const a=args[i],v=args[i+1];
  if(a==='--hours'){options.hours=Number(v);i++;}
  else if(a==='--minutes'){options.hours=Number(v)/60;i++;}
  else if(a==='--output'){options.output=path.resolve(v);i++;}
  else if(a==='--url'){options.base=v;i++;}
  else if(a==='--interval-ms'){options.interval=Number(v);i++;}
  else if(a==='--screenshot-minutes'){options.screenshotMinutes=Number(v);i++;}
  else if(a==='--browser-recycle-voyages'){options.browserRecycleVoyages=Number(v);i++;}
  else if(a==='--browser-recycle-minutes'){options.browserRecycleMinutes=Number(v);i++;}
  else if(a==='--disable-gpu'){options.disableGpu=true;}
  else throw Error('Unknown option '+a);
 }
 if(!Number.isFinite(options.hours)||options.hours<=0)throw Error('Duration must be positive');
 if(!Number.isFinite(options.interval)||options.interval<40||options.interval>1000)throw Error('Interval must be 40–1000 ms');
 if(!Number.isFinite(options.screenshotMinutes)||options.screenshotMinutes<=0)throw Error('Screenshot interval must be positive');
 if(!Number.isInteger(options.browserRecycleVoyages)||options.browserRecycleVoyages<1)throw Error('Browser recycle voyages must be a positive integer');
 if(!Number.isFinite(options.browserRecycleMinutes)||options.browserRecycleMinutes<=0)throw Error('Browser recycle minutes must be positive');
 options.targetSeconds=options.hours*3600;
 options.output??=path.join(ROOT,'artifacts','soak-'+new Date().toISOString().replace(/[:.]/g,'-'));
 return options;
}
export function validatedDelta(previous,current,wallDelta){
 if(previous?.run!==current?.run||!Number.isFinite(previous?.runTime)||!Number.isFinite(current?.runTime))return 0;
 const d=current.runTime-previous.runTime;
 if(d<=0||d>wallDelta*1.25+.15)return 0;
 return Math.min(d,Math.max(0,wallDelta));
}
export function invariants(s){
 const faults=[];
 if(!s||!['menu','playing','dialog','upgrade','paused','won','lost'].includes(s.mode))faults.push('invalid_mode');
 if(s?.mode!=='menu'){
  for(const [name,value]of Object.entries(s?.numbers||{}))if(!Number.isFinite(value))faults.push('nonfinite_'+name);
  if(s?.hp<0||s?.hp>s?.maxHp+.01)faults.push('invalid_health');
  if(s?.stage<0||s?.stage>4)faults.push('invalid_stage');
 }
 for(const [name,max]of Object.entries({enemies:200,bullets:2000,pickups:5000,particles:1000,floaters:2000}))if((s?.entities?.[name]||0)>max)faults.push('unbounded_'+name);
 if(s?.nonfiniteEntities>0)faults.push('nonfinite_entity_state');
 if(s?.heapBytes>512*1024*1024)faults.push('heap_over_512mb');
 return faults;
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function sourceHash(){const h=createHash('sha256');const files=(await readdir(ROOT,{withFileTypes:true})).filter(f=>f.isFile()&&/\.(js|html|css)$/.test(f.name)).map(f=>f.name).sort();for(const f of files){h.update(f);h.update(await readFile(path.join(ROOT,f)));}return h.digest('hex');}
async function withTimeout(promise,ms,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out after '+ms+'ms')),ms);})]);}finally{clearTimeout(timer);}}
async function startServer(){
 const child=spawn(process.execPath,[path.join(ROOT,'server.mjs')],{cwd:ROOT,env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
 const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server startup timeout')),15000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code));});child.stdout.on('data',chunk=>{const m=String(chunk).match(/port (\d+)/);if(m){clearTimeout(timer);resolve('http://127.0.0.1:'+m[1]);}});});
 return{child,base};
}
/** Runs in the browser and changes only normal input state, never game state or time. */
export function steer(){
 const g=window.__game,p=g?.player,pad=window.__soakPad;if(!g||!pad)return null;
 const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
 pad.axes=[0,0,0,0];for(const b of pad.buttons){b.pressed=false;b.value=0;}
 if(g.mode==='playing'){
  // Blend goal attraction, crowd separation, bullet prediction, obstacles and safe water bounds.
  const beacon=g.beacons.find(b=>b.active),boss=g.enemies.find(e=>e.type==='boss'&&!e.dead);
  let goal=beacon;
  if(!goal){let best=Infinity;for(const item of g.pickups){const d=distance(item,p);const priority=d/(item.type==='heal'&&p.hp<p.maxHp*.7?2.7:item.type==='xp'?1.4:1);if(priority<best){best=priority;goal=item;}}if(best>500)goal=null;}
  if(!goal){const t=g.runTime*.22;goal={x:900+Math.cos(t)*470,y:650+Math.sin(t)*320};}
  let vx=goal.x-p.x,vy=goal.y-p.y,len=Math.hypot(vx,vy)||1;vx/=len;vy/=len;
  let nearest=Infinity,nearCount=0;
  for(const e of g.enemies){if(e.dead)continue;const dx=p.x-e.x,dy=p.y-e.y,d=Math.hypot(dx,dy)||1;nearest=Math.min(nearest,d-e.r);if(d<270)nearCount++;const safe=e.type==='boss'?225:e.type==='ray'?150:125;if(d<safe){const weight=(safe-d)/safe*(beacon?.active?2.1:3);vx+=dx/d*weight;vy+=dy/d*weight;}}
  let threatening=false;
  for(const b of g.bullets){if(!b.enemy)continue;const rx=b.x-p.x,ry=b.y-p.y,sq=b.vx*b.vx+b.vy*b.vy;if(!sq)continue;const t=Math.max(0,Math.min(.65,-(rx*b.vx+ry*b.vy)/sq));const nx=rx+b.vx*t,ny=ry+b.vy*t,d=Math.hypot(nx,ny)||1;if(d<60){const w=(60-d)/60*(1-t)*3;vx-=nx/d*w;vy-=ny/d*w;if(t<.32&&d<33)threatening=true;}}
  for(const island of g.islands){if(island.kind==='wreck')continue;const dx=p.x-island.x,dy=p.y-island.y,d=Math.hypot(dx,dy)||1,r=island.r*.72+p.r+70;if(d<r){const k=(r-d)/r*3;vx+=dx/d*k;vy+=dy/d*k;}}
  if(p.x<170)vx+=(170-p.x)/80;if(p.x>1630)vx-=(p.x-1630)/80;if(p.y<135)vy+=(135-p.y)/80;if(p.y>1060)vy-=(p.y-1060)/80;
  len=Math.hypot(vx,vy)||1;pad.axes[0]=vx/len;pad.axes[1]=vy/len;
  if(boss&&distance(boss,p)<670){const dx=boss.x-p.x,dy=boss.y-p.y,l=Math.hypot(dx,dy)||1;pad.axes[2]=dx/l;pad.axes[3]=dy/l;}
  const pulse=g.player.pulseCD<=0&&(nearCount>=3||nearest<90||threatening);const dodge=g.player.dashCD<=0&&(nearest<65||threatening);
  if(pulse){pad.buttons[2].pressed=true;pad.buttons[2].value=1;}
  if(dodge){pad.buttons[0].pressed=true;pad.buttons[0].value=1;}
 }
 return{mode:g.mode,stage:g.stage,runTime:g.runTime||0,hp:p?.hp,maxHp:p?.maxHp,level:g.level||0,score:g.score||0,kills:g.kills||0,entities:Object.fromEntries(['enemies','bullets','pickups','particles','floaters'].map(k=>[k,g[k]?.length||0])),numbers:{x:p?.x,y:p?.y,hp:p?.hp,maxHp:p?.maxHp,...(g.mode!=='menu'?{runTime:g.runTime,damage:p?.damage,speed:p?.speed,fireRate:p?.fireRate,score:g.score,level:g.level,xp:g.xp}: {})},frameCount:window.__soakFrameCount||0,browserPerformanceMillis:performance.now(),profileRuns:g.profile?.runs||0,profileWins:g.profile?.wins||0,heapBytes:performance.memory?.usedJSHeapSize||0,nonfiniteEntities:['enemies','bullets','pickups','particles','floaters'].reduce((n,k)=>n+(g[k]||[]).filter(e=>!Number.isFinite(e.x)||!Number.isFinite(e.y)||!Number.isFinite(e.r??1)).length,0)};
}
export function shouldRecycle(completedVoyages,sessionSeconds,options){
 return completedVoyages>=options.browserRecycleVoyages||sessionSeconds>=options.browserRecycleMinutes*60;
}
async function processSnapshot(pid){
 try{const stat=await readFile('/proc/'+pid+'/stat','utf8');const fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');return{pid:Number(pid),ppid:Number(fields[1]),startTime:fields[19],state:fields[0],cpuTicks:Number(fields[11])+Number(fields[12])};}catch{return null;}
}
async function ownedProcessTree(rootPid){
 if(!rootPid)return[];const all=(await Promise.all((await readdir('/proc')).filter(x=>/^\d+$/.test(x)).map(processSnapshot))).filter(Boolean);const owned=new Set([rootPid]);let changed=true;while(changed){changed=false;for(const p of all)if(owned.has(p.ppid)&&!owned.has(p.pid)){owned.add(p.pid);changed=true;}}return all.filter(p=>owned.has(p.pid));
}
async function killOwnedTree(snapshots){
 // Match process identity as well as PID; never kill another process that reused an old PID.
 for(const p of snapshots.slice().reverse()){const current=await processSnapshot(p.pid);if(current?.startTime===p.startTime){try{process.kill(p.pid,'SIGKILL');}catch{}}}
}
async function nativeBrowserMetrics(rootPid){
 const tree=(await ownedProcessTree(rootPid)).filter(p=>!['Z','X'].includes(p.state));const rss=await Promise.all(tree.map(async p=>{try{const status=await readFile('/proc/'+p.pid+'/status','utf8');return Number(status.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1]||0)*1024;}catch{return 0;}}));
 return{available:tree.length>0,sampledAt:new Date().toISOString(),processCount:tree.length,totalVmRssBytes:rss.reduce((a,b)=>a+b,0),maxProcessVmRssBytes:Math.max(0,...rss),cpuTicks:tree.reduce((n,p)=>n+p.cpuTicks,0),method:'Sum of VmRSS and utime+stime over the owned live browser process tree; shared pages may appear in multiple VmRSS values.'};
}
export function healthyCaptureProgress(previous,current){
 if(!previous||!current||invariants(current).length||!Number.isFinite(current.frameCount)||current.frameCount<=(previous.frameCount||0))return false;
 return !(previous.mode==='playing'&&current.mode==='playing'&&current.runTime<=previous.runTime);
}
async function run(options){
 const {chromium}=require('playwright');await mkdir(options.output,{recursive:true});
 for(const file of ['summary.json','events.jsonl']){try{await readFile(path.join(options.output,file));throw Error('Refusing to overwrite existing soak evidence: '+options.output);}catch(error){if(error.code!=='ENOENT')throw error;}}
 const start=process.hrtime.bigint(),startedAt=new Date().toISOString();let stop=false,browser,browserServer,context,page,server,last,lastSample=Number(start)/1e9,lastHeartbeat=0,lastScreenshot=0,lastProgress=0,lastMode='',lastAction=0,runIndex=0,currentHash='',lastRunHash='',activeSeconds=0,browserOpenedAt=0,completedSinceRecycle=0,savedStorage,intentionalBrowserClose=false;
 const counts={runs:0,wins:0,losses:0,browserRestarts:0,browserRecycles:0,screenshots:0,captureWarnings:0,cleanupWarnings:0,heartbeats:0};const faults=[],warnings=[],sources=[];let outcome='running',summaryQueue=Promise.resolve(),latestNativeBrowserMetrics={available:false};
 const browserConfiguration={viewport:{width:960,height:640},deviceScaleFactor:1,disableGpu:options.disableGpu,browserRecycleVoyages:options.browserRecycleVoyages,browserRecycleMinutes:options.browserRecycleMinutes};
 const elapsed=()=>Number(process.hrtime.bigint()-start)/1e9;
 const event=async(type,detail={})=>{const row={at:new Date().toISOString(),elapsedSeconds:elapsed(),type,...detail};await appendFile(path.join(options.output,'events.jsonl'),JSON.stringify(row)+'\n');if(!['heartbeat','mode'].includes(type))console.log(JSON.stringify(row));};
 async function summary(){
  const total=elapsed(),result={schemaVersion:2,status:outcome,startedAt,updatedAt:new Date().toISOString(),pid:process.pid,targetSeconds:options.targetSeconds,wallSeconds:total,validatedPlayingSeconds:activeSeconds,requirementsMet:total>=options.targetSeconds&&activeSeconds>=options.targetSeconds,completed:outcome==='complete',publishGate:outcome==='complete'&&!faults.length,counts,sourceRevisions:sources,latestSourceSha256:currentHash,lastSample:last,faultCount:faults.length,faults:faults.slice(-40),warningCount:warnings.length,warnings,browserConfiguration,nodeRssBytes:process.memoryUsage().rss,nativeBrowserMetrics:latestNativeBrowserMetrics,outputDirectory:options.output,method:'Natural requestAnimationFrame gameplay; normal input automation only; no manual update() calls, changed stats, accelerated clocks, offline/recycle time credit, or inherited duration. Browser sessions recycle only between completed voyages.'};
  const serialized=JSON.stringify(result,null,2);summaryQueue=summaryQueue.then(async()=>{const tmp=path.join(options.output,'summary.json.tmp');await writeFile(tmp,serialized);await rename(tmp,path.join(options.output,'summary.json'));});await summaryQueue;return result;
 }
 const register=async(code,detail)=>{faults.push({code,at:new Date().toISOString(),detail});await event('fault',{code,detail});await summary();};
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{stop=true;outcome='interrupted';});
 async function closeOwnedBrowser(){
  intentionalBrowserClose=true;const oldServer=browserServer,owned=await ownedProcessTree(oldServer?.process()?.pid);browserServer=null;
  if(oldServer){try{await withTimeout(oldServer.close(),5000,'Owned browser graceful close');}catch(error){counts.cleanupWarnings++;await event('browser_cleanup_fallback',{code:'owned_browser_close_timeout',detail:String(error.message)});try{await withTimeout(oldServer.kill(),3000,'Owned browser forced close');}catch{await killOwnedTree(owned);}}for(const old of owned){let remaining=await processSnapshot(old.pid);if(remaining?.startTime===old.startTime&&!['Z','X'].includes(remaining.state)){await killOwnedTree([old]);const until=process.hrtime.bigint()+2000000000n;do{await wait(50);remaining=await processSnapshot(old.pid);}while(remaining?.startTime===old.startTime&&!['Z','X'].includes(remaining.state)&&process.hrtime.bigint()<until);if(remaining?.startTime===old.startTime&&!['Z','X'].includes(remaining.state))throw Error('Owned browser process survived cleanup: '+old.pid);}}}
  browser=null;context=null;page=null;last=null;lastSample=Number(process.hrtime.bigint())/1e9;
 }
 async function open(){
  intentionalBrowserClose=false;browserServer=await chromium.launchServer({executablePath:browserPath(chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-background-timer-throttling','--disable-renderer-backgrounding',...(options.disableGpu?['--disable-gpu']:[])]});
  browser=await chromium.connect(browserServer.wsEndpoint());
  context=await browser.newContext({viewport:browserConfiguration.viewport,deviceScaleFactor:1,...(savedStorage?{storageState:savedStorage}:{})});
  await context.addInitScript(()=>{window.__soakFrameCount=0;const frameProbe=()=>{window.__soakFrameCount++;requestAnimationFrame(frameProbe);};requestAnimationFrame(frameProbe);window.__soakPad={connected:true,index:0,id:'Soak standard controller',mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0,touched:false}))};Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[window.__soakPad]});localStorage.setItem('tidekeeper-settings-v1',JSON.stringify({mute:true,reduced:false,aim:true}));});
  page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>void register('browser_page_error',String(error.message)));page.on('crash',()=>{if(!intentionalBrowserClose)void register('browser_page_crash','Renderer process crashed');});
  await page.goto(options.base+'/?test=1',{timeout:20000});await page.waitForFunction(()=>window.__game?.mode==='menu',null,{timeout:15000});await page.bringToFront();last=null;lastProgress=elapsed();lastSample=Number(process.hrtime.bigint())/1e9;browserOpenedAt=elapsed();completedSinceRecycle=0;
 }
 async function startRun(){
  const ships=['breeze','swift','stone'],difficulties=['normal','story','storm'];
  currentHash=await sourceHash();if(currentHash!==lastRunHash){sources.push({sha256:currentHash,firstSeenAt:new Date().toISOString(),runIndex});lastRunHash=currentHash;}
  // A reload between voyages picks up improvements saved during a supervised endurance session.
  if(runIndex){await page.reload({waitUntil:'load'});await page.waitForFunction(()=>window.__game?.mode==='menu');}
  const ship=ships[runIndex%ships.length],difficulty=difficulties[Math.floor(runIndex/ships.length)%difficulties.length];
  await page.locator(`[data-ship="${ship}"]`).click();await page.locator('#difficulty').selectOption(difficulty);await page.locator('#startBtn').click();runIndex++;counts.runs++;last=null;lastProgress=elapsed();lastSample=Number(process.hrtime.bigint())/1e9;await event('voyage_started',{run:runIndex,ship,difficulty,sourceSha256:currentHash});
 }
 async function optionalCapture(){
  // Capture is diagnostic only. CDP avoids Playwright's font/layout waits; its own session is bounded.
  let session;await summary();await event('capture_started',{run:runIndex});
  try{
   session=await withTimeout(context.newCDPSession(page),2000,'Optional capture session');
   const response=await withTimeout(session.send('Page.captureScreenshot',{format:'jpeg',quality:55,fromSurface:true,captureBeyondViewport:false}),3000,'Optional capture');
   await writeFile(path.join(options.output,`sample-${String(counts.screenshots).padStart(4,'0')}.jpg`),Buffer.from(response.data,'base64'));counts.screenshots++;await event('capture_completed',{run:runIndex});
  }catch(error){
   counts.captureWarnings++;const warning={code:'diagnostic_capture_timeout',at:new Date().toISOString(),detail:String(error.message),resolved:false,healthVerifiedAt:null,healthSample:null};warnings.push(warning);await event('capture_failed',{run:runIndex,detail:warning.detail});
   // Optional capture is nonblocking only after a live responsive frame/game-clock progression check.
   try{
    const baseline=await withTimeout(page.evaluate(steer),5000,'Live health after optional capture');const deadline=process.hrtime.bigint()+5000000000n;let health;
    do{await wait(250);health=await withTimeout(page.evaluate(steer),5000,'Live progress after optional capture');if(healthyCaptureProgress(baseline,health))break;}while(process.hrtime.bigint()<deadline);
    if(!healthyCaptureProgress(baseline,health))throw Error('Browser did not demonstrate healthy frame/game-clock progress after optional capture');
    warning.resolved=true;warning.healthVerifiedAt=new Date().toISOString();warning.healthSample={mode:health.mode,runTime:health.runTime,frameCount:health.frameCount,previousRunTime:baseline.runTime,previousFrameCount:baseline.frameCount,heapBytes:health.heapBytes};await event('warning',warning);
   }catch(healthError){await register('browser_evaluate_error',{during:'capture_health_verification',error:String(healthError.message)});throw healthError;}
  }finally{
   if(session)try{await withTimeout(session.detach(),1000,'Optional capture detach');}catch{}
   await summary();
  }
 }
 try{
  if(!options.base){server=await startServer();options.base=server.base;}
  await event('started',{targetSeconds:options.targetSeconds,base:options.base,output:options.output,browserRecycleVoyages:options.browserRecycleVoyages,browserRecycleMinutes:options.browserRecycleMinutes,browserConfiguration});await open();await startRun();
  while(!stop){
   if(faults.length){outcome='failed';break;}
   const now=Number(process.hrtime.bigint())/1e9,wallDelta=Math.max(0,now-lastSample);lastSample=now;
   let state;
   try{state=await withTimeout(page.evaluate(steer),15000,'Browser control sample');}catch(error){await register('browser_evaluate_error',String(error.message));outcome='failed';break;}
   state.run=runIndex;state.sampleElapsedSeconds=elapsed();
   const delta=validatedDelta(last,state,wallDelta);activeSeconds+=delta;if(delta>0)lastProgress=elapsed();
   if(last&&last.run===state.run&&state.runTime-last.runTime>wallDelta*1.25+.15){await register('impossible_game_clock_advance',{previous:last.runTime,current:state.runTime,wallDelta});outcome='failed';break;}
   const issues=invariants(state);if(issues.length){for(const issue of issues)await register(issue,state);outcome='failed';break;}
   if(state.mode!==lastMode){await event('mode',{run:runIndex,mode:state.mode,stage:state.stage,runTime:state.runTime});lastMode=state.mode;}
   const t=elapsed();
   if(t-lastAction>.42){
    if(state.mode==='dialog'){
     const next=page.locator('#nextDialogue');if(await next.isVisible())await next.click();else if(await page.locator('#nextSea').isVisible())await page.locator('#nextSea').click();lastAction=t;
    }else if(state.mode==='upgrade'){
     const preferred=await page.locator('.upgrade-card').evaluateAll(buttons=>{const priorities=['双生星火','长明灯','燧光炮芯','铜铃快机','鲸骨船肋','穿雾针','潮汐线圈','燕尾舵','顺风帆','黎明星镜','拾星罗盘','热姜茶'];let best=0,bestRank=99;buttons.forEach((b,i)=>{const title=b.querySelector('h3')?.textContent||b.textContent;const rank=priorities.findIndex(p=>title.includes(p));if(rank>=0&&rank<bestRank){best=i;bestRank=rank;}});return best;});
     await page.locator('.upgrade-card').nth(preferred).click();lastAction=t;
    }else if(state.mode==='paused'){
     await page.keyboard.press('Escape');lastAction=t;await event('automatic_resume',{run:runIndex});
    }else if(state.mode==='won'||state.mode==='lost'){
     counts[state.mode==='won'?'wins':'losses']++;completedSinceRecycle++;await event('voyage_finished',{run:runIndex,result:state.mode,gameSeconds:state.runTime,score:state.score,kills:state.kills,level:state.level,hp:state.hp});
     if(shouldRecycle(completedSinceRecycle,elapsed()-browserOpenedAt,options)){
      await event('browser_recycle_started',{afterCompletedRun:runIndex,completedVoyages:completedSinceRecycle,browserSessionSeconds:elapsed()-browserOpenedAt});await summary();
      savedStorage=await withTimeout(context.storageState(),5000,'Browser storage checkpoint');await closeOwnedBrowser();await open();counts.browserRecycles++;await event('browser_recycle_completed',{afterCompletedRun:runIndex});await summary();
     }
     await startRun();lastAction=t;continue;
    }
   }
   if(state.mode!=='playing'&&t-lastProgress>60){await register('nonplaying_flow_stalled',{state,seconds:t-lastProgress});outcome='failed';break;}
   if(state.mode==='playing'&&t-lastProgress>20){await register('playing_clock_stalled',{state,seconds:t-lastProgress});outcome='failed';break;}
   if(state.mode==='playing'&&state.runTime>1100){await register('voyage_progress_stalled',{state});outcome='failed';break;}
   last=state;
   if(t-lastHeartbeat>=10){counts.heartbeats++;lastHeartbeat=t;try{latestNativeBrowserMetrics=await withTimeout(nativeBrowserMetrics(browserServer?.process()?.pid),2000,'Native browser process metrics');}catch(error){latestNativeBrowserMetrics={available:false,sampledAt:new Date().toISOString(),error:String(error.message)};}await summary();await event('heartbeat',{validatedPlayingSeconds:activeSeconds,runs:counts.runs,wins:counts.wins,losses:counts.losses,heapBytes:state.heapBytes,frameCount:state.frameCount,nodeRssBytes:process.memoryUsage().rss,nativeBrowserMetrics:latestNativeBrowserMetrics});}
   if(t-lastScreenshot>=options.screenshotMinutes*60){lastScreenshot=t;await optionalCapture();}
   if(elapsed()>=options.targetSeconds&&activeSeconds>=options.targetSeconds){outcome='complete';break;}
   await wait(options.interval);
  }
 }catch(error){outcome='failed';await register('runner_error',String(error.stack||error));}
 finally{
  const intended=outcome==='running'?'interrupted':outcome;outcome='finalizing';await summary();
  try{await closeOwnedBrowser();outcome=intended;}catch(error){outcome='failed';await register('browser_cleanup_error',String(error.stack||error));}
  server?.child.kill();await event('finished',{outcome,validatedPlayingSeconds:activeSeconds});await summary();
 }
 if(outcome!=='complete'||faults.length)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)run(parseArgs(process.argv.slice(2))).catch(error=>{console.error(error);process.exitCode=1;});
