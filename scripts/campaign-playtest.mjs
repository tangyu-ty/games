#!/usr/bin/env node
/** Observes one story campaign through normal browser inputs. Never advances clocks or changes game stats. */
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,rename,appendFile,readdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {browserPath} from './browser.mjs';
const require=createRequire(import.meta.url);
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function parseCampaignArgs(args){
 const o={minutes:null,readingCpm:900,output:null,url:null,interval:125,ship:'stone',difficulty:'normal',choiceSeed:0,maxRetries:3,screenshotMinutes:10,maxWallMinutes:180,resume:false};
 for(let i=0;i<args.length;i++){const a=args[i],v=args[i+1];
  if(a==='--minutes'){o.minutes=Number(v);i++;}else if(a==='--reading-cpm'){o.readingCpm=Number(v);i++;}else if(a==='--output'){o.output=path.resolve(v);i++;}else if(a==='--url'){o.url=v;i++;}else if(a==='--interval-ms'){o.interval=Number(v);i++;}else if(a==='--ship'){o.ship=v;i++;}else if(a==='--difficulty'){o.difficulty=v;i++;}else if(a==='--choice-seed'){o.choiceSeed=Number(v);i++;}else if(a==='--max-retries'){o.maxRetries=Number(v);i++;}else if(a==='--screenshot-minutes'){o.screenshotMinutes=Number(v);i++;}else if(a==='--max-wall-minutes'){o.maxWallMinutes=Number(v);i++;}else if(a==='--resume')o.resume=true;else throw Error('Unknown option '+a);
 }
 if(o.minutes!==null&&(!Number.isFinite(o.minutes)||o.minutes<=0))throw Error('Sample duration must be positive');
 for(const k of ['readingCpm','interval','screenshotMinutes','maxWallMinutes'])if(!Number.isFinite(o[k])||o[k]<=0)throw Error(k+' must be positive');
 if(o.interval<40||o.interval>1000)throw Error('Control interval must be 40–1000ms');
 for(const k of ['maxRetries','choiceSeed'])if(!Number.isInteger(o[k])||o[k]<0)throw Error(k+' must be a nonnegative integer');
 if(!['breeze','swift','stone'].includes(o.ship)||!['story','normal','storm'].includes(o.difficulty))throw Error('Unknown ship/difficulty');
 o.output??=path.join(ROOT,'artifacts','campaign-'+new Date().toISOString().replace(/[:.]/g,'-'));
 return o;
}
export function readingDelaySeconds(text,cpm=900){const chars=String(text||'').replace(/\s+/g,'').length;return clamp(chars/Math.max(1,cpm)*60,.5,15);}
async function timeout(promise,ms,label){let t;try{return await Promise.race([promise,new Promise((_,reject)=>{t=setTimeout(()=>reject(Error(label+' timed out after '+ms+'ms')),ms);})]);}finally{clearTimeout(t);}}
async function productHash(){const h=createHash('sha256');for(const name of(await readdir(ROOT,{withFileTypes:true})).filter(f=>f.isFile()&&/\.(js|css|html)$/.test(f.name)).map(f=>f.name).sort()){h.update(name);h.update(await readFile(path.join(ROOT,name)));}return h.digest('hex');}
async function server(){const child=spawn(process.execPath,[path.join(ROOT,'server.mjs')],{cwd:ROOT,env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});const url=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Campaign server startup timed out')),15000);child.on('error',reject);child.on('exit',c=>{clearTimeout(t);reject(Error('Campaign server exited '+c));});child.stdout.on('data',d=>{const m=String(d).match(/port (\d+)/);if(m){clearTimeout(t);resolve('http://127.0.0.1:'+m[1]);}});});return{child,url};}
async function proc(pid){try{const s=await readFile('/proc/'+pid+'/stat','utf8'),f=s.slice(s.lastIndexOf(')')+2).split(' ');return{pid:Number(pid),ppid:Number(f[1]),startTime:f[19],state:f[0],cpuTicks:Number(f[11])+Number(f[12])};}catch{return null;}}
async function tree(pid){if(!pid)return[];const list=(await Promise.all((await readdir('/proc')).filter(n=>/^\d+$/.test(n)).map(proc))).filter(Boolean),own=new Set([pid]);let more=true;while(more){more=false;for(const p of list)if(own.has(p.ppid)&&!own.has(p.pid)){own.add(p.pid);more=true;}}return list.filter(p=>own.has(p.pid));}
async function killTree(list){for(const old of list.slice().reverse()){const p=await proc(old.pid);if(p?.startTime===old.startTime){try{process.kill(p.pid,'SIGKILL');}catch{}}}}
async function nativeMetrics(pid){const live=(await tree(pid)).filter(p=>!['Z','X'].includes(p.state)),rss=await Promise.all(live.map(async p=>{try{return Number((await readFile('/proc/'+p.pid+'/status','utf8')).match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1]||0)*1024;}catch{return 0;}}));return{available:!!live.length,processCount:live.length,totalVmRssBytes:rss.reduce((a,b)=>a+b,0),maxProcessVmRssBytes:Math.max(0,...rss),cpuTicks:live.reduce((s,p)=>s+p.cpuTicks,0),sampledAt:new Date().toISOString()};}
/** Collision-aware pilot route. Free-space cells are inflated around the actual solid island hulls. */
export function campaignRoute(start,goal,islands,playerRadius=16){
 const step=50,cols=36,rows=24,land=(islands||[]).filter(a=>a.kind!=='wreck').map(a=>({x:a.x,y:a.y,r:a.r*.72+playerRadius}));
 const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),point=i=>({x:(i%cols)*step+25,y:Math.floor(i/cols)*step+25});
 const clearance=p=>land.reduce((v,a)=>Math.min(v,distance(p,a)-a.r),Infinity);
 const clear=(a,b,margin=15)=>land.every(o=>{const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((o.x-a.x)*dx+(o.y-a.y)*dy)/l)):0;return Math.hypot(a.x+dx*t-o.x,a.y+dy*t-o.y)>=o.r+margin-.1;});
 if(distance(start,goal)<40)return[{x:goal.x,y:goal.y}];
 if(clear(start,goal,Math.max(0,Math.min(15,clearance(start)-1))))return[{x:goal.x,y:goal.y}];
 const free=Array.from({length:cols*rows},(_,i)=>{const p=point(i);return p.x>=45&&p.x<=1755&&p.y>=45&&p.y<=1155&&clearance(p)>=30;});
 const candidates=free.map((yes,i)=>yes?i:-1).filter(i=>i>=0);
 const closest=(p,endpoint)=>candidates.slice().sort((a,b)=>distance(point(a),p)-distance(point(b),p)).find(i=>clear(p,point(i),Math.max(0,Math.min(endpoint?5:1,clearance(p)-.5))))??candidates.reduce((a,b)=>distance(point(a),p)<distance(point(b),p)?a:b,candidates[0]);
 const a=closest(start,false),z=closest(goal,true);if(a===undefined||z===undefined)return[];
 const costs=new Float64Array(cols*rows).fill(Infinity),parents=new Int32Array(cols*rows).fill(-1),closed=new Set(),open=[a];costs[a]=0;
 let end=a,closestDistance=distance(point(a),goal);
 while(open.length){let best=0;for(let i=1;i<open.length;i++)if(costs[open[i]]+distance(point(open[i]),point(z))<costs[open[best]]+distance(point(open[best]),point(z)))best=i;const here=open.splice(best,1)[0];if(closed.has(here))continue;closed.add(here);const p=point(here),dg=distance(p,goal);if(dg<closestDistance){closestDistance=dg;end=here;}if(here===z){end=here;break;}
  const x=here%cols,y=Math.floor(here/cols);
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;if(nx<0||nx>=cols||ny<0||ny>=rows)continue;const n=nx+ny*cols;if(!free[n]||closed.has(n)||!clear(p,point(n),24))continue;const cost=costs[here]+Math.hypot(dx,dy)*step;if(cost<costs[n]){costs[n]=cost;parents[n]=here;open.push(n);}}
 }
 const route=[];for(let n=end;n>=0;n=parents[n]){route.push(point(n));if(n===a)break;}route.reverse();if(clear(route.at(-1),goal,Math.max(0,Math.min(5,clearance(goal)-1))))route.push({x:goal.x,y:goal.y});
 const smooth=[];let cursor=start,index=0;while(index<route.length){let next=index;const margin=Math.max(0,Math.min(15,clearance(cursor)-1));for(let j=index;j<route.length;j++)if(clear(cursor,route[j],margin))next=j;smooth.push(route[next]);cursor=route[next];index=next+1;}return smooth;
}
/** Browser-side pilot. It sets only the mocked standard controller's normal axes/buttons. */
export function campaignPilot(){
 const g=window.__game,p=g?.player,pad=window.__campaignPad;if(!g||!pad)return null;
 const mission=g.campaignMission,ui=mission?.ui||{},cs=g.campaignState||{},type=ui.type||mission?.type||null;
 const raw=mission?.navigationTargets?.()||[],targets=raw.filter(t=>Number.isFinite(t?.x)&&Number.isFinite(t?.y)).map(t=>({x:t.x,y:t.y,r:t.r||t.radius||50,type:t.type||'',priority:Number.isFinite(Number(t.priority))?Number(t.priority):1,angle:Number(t.angle)||0,preferredRange:Number(t.preferredRange)||0,optional:!!t.optional,followRole:t.followRole||null}));
 const d=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),enemies=(g.enemies||[]).filter(e=>!e.dead);
 pad.axes=[0,0,0,0];for(const b of pad.buttons){b.pressed=false;b.value=0;}
 let selected=null,aimTarget=null;
 if(g.campaignActive&&g.mode==='playing'){
  selected=targets.slice().sort((a,b)=>a.priority-b.priority||d(a,p)-d(b,p))[0]||null;
  let goal=selected;
  const missionEnemy=enemies.find(e=>e.missionRole&&/^captain-|target|boss|hunt|guardian|leader/i.test(String(e.missionRole)))||enemies.find(e=>e.type==='boss');
  if(type==='boss'||type==='hunt'){
   aimTarget=missionEnemy||enemies.filter(e=>e.missionRole).sort((a,b)=>d(a,p)-d(b,p))[0]||null;
   if(aimTarget){const a=Math.atan2(p.y-aimTarget.y,p.x-aimTarget.x)+.22,range=selected?.preferredRange||220;goal={x:aimTarget.x+Math.cos(a)*range,y:aimTarget.y+Math.sin(a)*range,r:50};}
  }
  if(type==='escort'&&selected){goal={x:selected.x+Math.cos(selected.angle)*55,y:selected.y+Math.sin(selected.angle)*55,r:70};aimTarget=enemies.slice().sort((a,b)=>d(a,selected)-d(b,selected))[0]||null;}
  if(type==='defend'&&selected){const a=(g.runTime||0)*.23;const r=Math.min(110,Math.max(45,selected.r*.55));goal={x:selected.x+Math.cos(a)*r,y:selected.y+Math.sin(a)*r,r:25};aimTarget=enemies.slice().sort((a,b)=>d(a,selected)-d(b,selected))[0]||null;}
  if(!goal){const pickups=(g.pickups||[]).slice().sort((a,b)=>d(a,p)-d(b,p));goal=pickups.find(a=>d(a,p)<400)||{x:900+Math.cos((g.runTime||0)*.18)*420,y:650+Math.sin((g.runTime||0)*.18)*280,r:50};}
  const committed=['rescue','salvage','race'].includes(type),to=d(goal,p),hold=committed&&selected&&to<Math.max(35,Math.min(48,(selected.r||21)+20));
  const now=performance.now(),routeKey=[cs.chapter,mission?.leg,type].join(':');let route=window.__campaignRouteState;
  if(!route||route.key!==routeKey||now-route.at>2000||d(route.goal,goal)>75){route={key:routeKey,at:now,goal:{x:goal.x,y:goal.y},points:window.__campaignPlanRoute?.(p,goal,g.islands,p.r)||[],escapes:route?.escapes||0};window.__campaignRouteState=route;}
  while(route.points.length>1&&d(p,route.points[0])<45)route.points.shift();const waypoint=route.points[0]||goal,routeDistance=d(waypoint,p);
  let vx=hold?0:(waypoint.x-p.x)/Math.max(1,routeDistance),vy=hold?0:(waypoint.y-p.y)/Math.max(1,routeDistance),near=Infinity,nearCount=0,threat=false;
  for(const e of enemies){const dx=p.x-e.x,dy=p.y-e.y,range=Math.hypot(dx,dy)||1;near=Math.min(near,range-e.r);if(range<265)nearCount++;const safe=e.type==='boss'?185:e.type==='ray'?115:95;if(range<safe){const w=(safe-range)/safe*(committed&&p.hp>p.maxHp*.6?1.1:2.7);vx+=dx/range*w;vy+=dy/range*w;}}
  for(const b of g.bullets||[]){if(!b.enemy)continue;const rx=b.x-p.x,ry=b.y-p.y,sq=b.vx*b.vx+b.vy*b.vy;if(!sq)continue;const t=Math.max(0,Math.min(.6,-(rx*b.vx+ry*b.vy)/sq)),x=rx+b.vx*t,y=ry+b.vy*t,range=Math.hypot(x,y)||1;if(range<48){const w=(48-range)/48*(1-t)*(committed?1.8:2.8);vx-=x/range*w;vy-=y/range*w;if(t<.3&&range<28)threat=true;}}
  for(const a of g.islands||[]){if(a.kind==='wreck')continue;const dx=p.x-a.x,dy=p.y-a.y,range=Math.hypot(dx,dy)||1,safe=a.r*.72+p.r+8;if(range<safe){const w=(safe-range)/safe*2.8;vx+=dx/range*w;vy+=dy/range*w;const cross=(goal.x-a.x)*dy-(goal.y-a.y)*dx,sign=cross>=0?1:-1;vx+=-dy/range*w*.35*sign;vy+=dx/range*w*.35*sign;}}
  if(p.x<75)vx+=(75-p.x)/50;if(p.x>1725)vx-=(p.x-1725)/50;if(p.y<65)vy+=(65-p.y)/50;if(p.y>1135)vy-=(p.y-1135)/50;
  let motion=window.__campaignMotionMark;if(!motion||motion.key!==routeKey){motion={key:routeKey,x:p.x,y:p.y,at:now,escapeUntil:0};window.__campaignMotionMark=motion;}
  if(now-motion.at>3000){if(!hold&&to>75&&Math.hypot(p.x-motion.x,p.y-motion.y)<12){motion.escapeUntil=now+1100;route.at=0;route.escapes++;}motion.x=p.x;motion.y=p.y;motion.at=now;}
  if(now<motion.escapeUntil&&!hold){const obstacle=(g.islands||[]).filter(a=>a.kind!=='wreck').sort((a,b)=>d(a,p)-a.r*.72-(d(b,p)-b.r*.72))[0];if(obstacle&&d(obstacle,p)<obstacle.r*.72+p.r+90){const dx=p.x-obstacle.x,dy=p.y-obstacle.y,r=Math.hypot(dx,dy)||1,side=(goal.x-obstacle.x)*dy-(goal.y-obstacle.y)*dx>=0?1:-1;vx=dx/r-dy/r*side*1.5;vy=dy/r+dx/r*side*1.5;}else{vx=(goal.x-p.x)/Math.max(1,to);vy=(goal.y-p.y)/Math.max(1,to);}}
  const speed=Math.hypot(vx,vy);if(speed>.12){pad.axes[0]=vx/speed;pad.axes[1]=vy/speed;}
  if(aimTarget&&d(aimTarget,p)<700){const r=d(aimTarget,p)||1;pad.axes[2]=(aimTarget.x-p.x)/r;pad.axes[3]=(aimTarget.y-p.y)/r;}
  const pulse=p.pulseCD<=0&&(nearCount>=(committed?1:2)||near<95||threat),dash=p.dashCD<=0&&(near<55||threat)&&!hold;
  if(pulse){pad.buttons[2].pressed=true;pad.buttons[2].value=1;}if(dash){pad.buttons[0].pressed=true;pad.buttons[0].value=1;}
 }
 const objectList=Array.isArray(g.missionObjects)?g.missionObjects:Object.values(g.missionObjects||{});
 const objects=objectList.filter(o=>o&&typeof o==='object').map(o=>Object.fromEntries(['id','type','kind','x','y','r','hp','maxHp','friendlyHP','done','active','rescued','salvaged','progress'].filter(k=>['number','string','boolean'].includes(typeof o[k])).map(k=>[k,o[k]])));
 const narrativeRoot=document.getElementById('modalContent');const visibleText=selector=>[...(narrativeRoot?.querySelectorAll(selector)||[])].filter(e=>e.getClientRects().length).map(e=>e.innerText.trim()).filter(Boolean).join('\n');
 const readingText=(g.mode==='hub'||cs.phase==='hub')?'':cs.phase==='choice'?visibleText(':scope > h2,.choice-card h3,.choice-card p'):visibleText('.dialogue-text')||visibleText('.letter-text')||(g.mode==='campaignWon'?visibleText(':scope > p:not(.muted)'):'');
 const visible=selector=>{const e=document.querySelector(selector);return !!e&&!e.disabled&&e.getClientRects().length>0;};
 return{mode:g.mode,campaignActive:!!g.campaignActive,chapter:Number.isInteger(cs.chapter)?cs.chapter:Number(mission?.chapter??g.stage??0),leg:Number.isInteger(mission?.leg)?mission.leg:Number(cs.leg??0),phase:cs.phase||null,sceneIndex:cs.sceneIndex??null,type,runTime:Number(g.runTime)||0,hp:p?.hp,maxHp:p?.maxHp,level:g.level||0,score:g.score||0,kills:g.kills||0,x:p?.x,y:p?.y,missionStatus:{done:!!(mission?.done||mission?.complete||mission?.completed),failed:!!(mission?.failed||ui.failed),elapsed:Number(mission?.elapsed??mission?.time??0)||0,progress:typeof ui.progress==='number'||typeof ui.progress==='string'?ui.progress:null,required:ui.required??null},targets,selectedTarget:selected,pilotRoute:window.__campaignRouteState?{points:window.__campaignRouteState.points,escapes:window.__campaignRouteState.escapes}:null,objects,friendlyHP:mission?.friendlyHP??ui.friendlyHP??null,frameCount:window.__campaignFrameCount||0,heapBytes:performance.memory?.usedJSHeapSize||0,entities:Object.fromEntries(['enemies','bullets','pickups','particles','floaters'].map(k=>[k,g[k]?.length||0])),nonfiniteEntities:['enemies','bullets','pickups'].reduce((n,k)=>n+(g[k]||[]).filter(e=>!Number.isFinite(e.x)||!Number.isFinite(e.y)).length,0),retryVisible:visible('#campaignRetry'),nextVisible:visible('#storyNext'),chapterContinueVisible:visible('#chapterContinue'),readingText,modalText:document.getElementById('modalContent')?.innerText||'',numbers:{x:p?.x,y:p?.y,hp:p?.hp,maxHp:p?.maxHp,damage:p?.damage??0,speed:p?.speed??0,fireRate:p?.fireRate??0,...(g.campaignActive?{runTime:g.runTime}:{})}};
}
export function campaignFaults(s){const a=[];if(!s){a.push('missing_campaign_instance');return a;}for(const[k,v]of Object.entries(s.numbers||{}))if(!Number.isFinite(v))a.push('nonfinite_'+k);if(s.hp<0||s.hp>s.maxHp+.01)a.push('invalid_health');if(s.nonfiniteEntities)a.push('nonfinite_entity');if(s.campaignActive&&s.phase!=='won'&&s.mode!=='campaignWon'&&(!Number.isInteger(s.chapter)||s.chapter<0||s.chapter>11))a.push('invalid_campaign_chapter');if(s.phase==='mission'&&(!Number.isInteger(s.leg)||s.leg<0||s.leg>2))a.push('invalid_campaign_leg');for(const t of s.targets||[])if(![t.x,t.y,t.r].every(Number.isFinite))a.push('nonfinite_navigation_target');for(const[k,max]of Object.entries({enemies:250,bullets:2500,pickups:6000,particles:1500,floaters:2500}))if(s.entities?.[k]>max)a.push('unbounded_'+k);if(s.heapBytes>768*1024*1024)a.push('heap_over_768mb');return a;}
async function run(o){
 const {chromium}=require('playwright');await mkdir(o.output,{recursive:true});for(const file of['summary.json','events.jsonl'])try{await readFile(path.join(o.output,file));throw Error('Refusing to overwrite campaign evidence: '+o.output);}catch(e){if(e.code!=='ENOENT')throw e;}
 const initialHash=await productHash(),begin=process.hrtime.bigint(),startedAt=new Date().toISOString(),elapsed=()=>Number(process.hrtime.bigint()-begin)/1e9;
 let srv,browserServer,browser,context,page,last=null,lastAt=Number(begin)/1e9,lastHeartbeat=0,lastCapture=0,lastProgress=0,currentMission=null,missionBeganAt=0,pendingRead=null,lastReadSignature='',lastActionAt=0,stopped=false,status='running',queue=Promise.resolve(),activeSeconds=0,dialogueWallSeconds=0,missionRetries=0,native={available:false},closing=false;
 const faults=[],warnings=[],choices=[],missionLog=[],visited=new Set(),completed=new Set(),chapters=new Set(),retryCounts=new Map();
 const event=async(type,data={})=>{const row={at:new Date().toISOString(),elapsedSeconds:elapsed(),...data,...(data.type?{missionType:data.type}:{}),type};await appendFile(path.join(o.output,'events.jsonl'),JSON.stringify(row)+'\n');if(!['heartbeat','state'].includes(type))console.log(JSON.stringify(row));};
 async function summary(){const complete=status==='complete',sourceNow=await productHash();const d={schemaVersion:1,status,startedAt,updatedAt:new Date().toISOString(),pid:process.pid,wallSeconds:elapsed(),validatedPlayingSeconds:activeSeconds,dialoguePanelWallSeconds:dialogueWallSeconds,readingCharactersPerMinute:o.readingCpm,sampleMinutes:o.minutes,campaignWon:complete,campaignCoverageComplete:complete&&completed.size===36&&chapters.size===12,observedMissionCount:visited.size,completedMissionCount:completed.size,completedChapters:[...chapters].sort((a,b)=>a-b),missionLog,choices,retries:missionRetries,retryCounts:Object.fromEntries(retryCounts),faultCount:faults.length,faults,warningCount:warnings.length,warnings,sourceSha256AtLoad:initialHash,sourceSha256Now:sourceNow,sourceUnchanged:sourceNow===initialHash,lastSample:last,nativeBrowserMetrics:native,nodeRssBytes:process.memoryUsage().rss,atLeastHour:{wall:elapsed()>=3600,validatedActivePlay:activeSeconds>=3600},method:'One natural story-campaign playthrough through standard controller axes/buttons and actual UI clicks. Engine updates only through requestAnimationFrame; no changed stats, health, objectives, timers, manual update calls, or accelerated clocks. Reading is an explicit simulated reading delay, not a claim of human reading.'};const text=JSON.stringify(d,null,2);queue=queue.then(async()=>{const tmp=path.join(o.output,'summary.json.tmp');await writeFile(tmp,text);await rename(tmp,path.join(o.output,'summary.json'));});await queue;return d;}
 const fault=async(code,detail)=>{faults.push({code,detail,at:new Date().toISOString()});await event('fault',{code,detail});await summary();};
 for(const sig of['SIGTERM','SIGINT'])process.once(sig,()=>{stopped=true;status='interrupted';});
 async function capture(){let session;await summary();try{session=await timeout(context.newCDPSession(page),2000,'Campaign capture session');const shot=await timeout(session.send('Page.captureScreenshot',{format:'jpeg',quality:60,fromSurface:true,captureBeyondViewport:false}),3000,'Campaign diagnostic capture');await writeFile(path.join(o.output,`scene-${Math.floor(elapsed())}.jpg`),Buffer.from(shot.data,'base64'));}catch(e){const before=await timeout(page.evaluate(campaignPilot),5000,'Campaign capture health'),deadline=process.hrtime.bigint()+5000000000n;let after;do{await wait(250);after=await timeout(page.evaluate(campaignPilot),5000,'Campaign capture progress');if(after.frameCount>before.frameCount&&(before.mode!=='playing'||after.mode!=='playing'||after.runTime>before.runTime))break;}while(process.hrtime.bigint()<deadline);if(campaignFaults(after).length||after.frameCount<=before.frameCount||(before.mode==='playing'&&after.mode==='playing'&&after.runTime<=before.runTime))throw Error('Campaign browser unresponsive after diagnostic capture: '+e.message);const w={code:'diagnostic_capture_timeout',detail:e.message,at:new Date().toISOString(),resolved:true,healthVerifiedAt:new Date().toISOString()};warnings.push(w);await event('warning',w);}finally{if(session)try{await timeout(session.detach(),1000,'Campaign capture detach');}catch{}await summary();}}
 async function finishMission(key,reason){if(!key||completed.has(key))return;completed.add(key);const [chapter,leg]=key.split(':').map(Number),entry={chapter,leg,reason,wallSeconds:elapsed()-missionBeganAt,at:new Date().toISOString()};missionLog.push(entry);if(leg===2)chapters.add(chapter);await event('mission_completed',entry);}
 try{
  if(!o.url){srv=await server();o.url=srv.url;}await event('started',{options:o,sourceSha256:initialHash});
  browserServer=await chromium.launchServer({executablePath:browserPath(chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-background-timer-throttling','--disable-renderer-backgrounding']});browser=await chromium.connect(browserServer.wsEndpoint());context=await browser.newContext({viewport:{width:1100,height:760},deviceScaleFactor:1});
  await context.addInitScript({content:'window.__campaignPlanRoute = '+campaignRoute.toString()+';'});
  await context.addInitScript(()=>{window.__campaignFrameCount=0;const tick=()=>{window.__campaignFrameCount++;requestAnimationFrame(tick);};requestAnimationFrame(tick);window.__campaignPad={connected:true,index:0,id:'Campaign playtest standard controller',mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0,touched:false}))};Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[window.__campaignPad]});localStorage.setItem('tidekeeper-settings-v1',JSON.stringify({mute:true,reduced:false}));});
  page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>void fault('browser_page_error',e.message));page.on('crash',()=>{if(!closing)void fault('browser_page_crash','Campaign renderer crashed');});await page.goto(o.url+'/?test=1');await page.waitForFunction(()=>window.__game,null,{timeout:20000});await page.bringToFront();
  const ship=page.locator(`[data-ship="${o.ship}"]`);if(await ship.isVisible())await ship.click();const diff=page.locator('#difficulty');if(await diff.isVisible())await diff.selectOption(o.difficulty);
  const start=page.locator(o.resume?'#campaignContinueBtn':'#campaignStartBtn');await start.waitFor({state:'visible',timeout:30000});await start.click();lastAt=Number(process.hrtime.bigint())/1e9;lastProgress=elapsed();
  while(!stopped){
   if(faults.length){status='failed';break;}const now=Number(process.hrtime.bigint())/1e9,wallDelta=Math.max(0,now-lastAt);lastAt=now;
   const s=await timeout(page.evaluate(campaignPilot),15000,'Campaign live control sample');const bad=campaignFaults(s);if(bad.length){for(const x of bad)await fault(x,s);status='failed';break;}
   if(last){const d=s.runTime-last.runTime;if(d>0&&d<=wallDelta*1.25+.15){activeSeconds+=Math.min(d,wallDelta);lastProgress=elapsed();}if(last.mode!=='playing'&&['opening','interlude','choice','reply','closing','letter','hub','ending'].includes(last.phase))dialogueWallSeconds+=wallDelta;}
   const inMission=s.phase==='mission'&&s.mode==='playing',key=inMission?`${s.chapter}:${s.leg}`:null;
   if(key&&key!==currentMission){if(currentMission&&!last?.retryVisible&&!last?.missionStatus?.failed)await finishMission(currentMission,'next_mission_entered');currentMission=key;missionBeganAt=elapsed();visited.add(key);await event('mission_started',{chapter:s.chapter,leg:s.leg,type:s.type,runTime:s.runTime,targets:s.targets,sourceSha256:initialHash});}
   if(currentMission&&!inMission&&!s.retryVisible&&!s.missionStatus.failed&&['interlude','choice','reply','closing','letter','hub','ending','won'].includes(s.phase))await finishMission(currentMission,'story_progression_'+s.phase);
   if(s.phase==='won'||s.mode==='campaignWon'){
    if(currentMission)await finishMission(currentMission,'ending_won');last=s;if(completed.size!==36||chapters.size!==12||!Array.from({length:12},(_,chapter)=>Array.from({length:3},(_,leg)=>`${chapter}:${leg}`)).flat().every(key=>completed.has(key))){await fault('incomplete_campaign_coverage',{completed:[...completed],chapters:[...chapters]});status='failed';}else status='complete';break;
   }
   const t=elapsed();
   if(t-lastActionAt>.3){
    if(s.retryVisible){const retryKey=currentMission||`${s.chapter}:${s.leg}`,n=(retryCounts.get(retryKey)||0)+1;if(n>o.maxRetries){await fault('mission_retry_limit',{mission:retryKey,attempt:n});status='failed';break;}retryCounts.set(retryKey,n);missionRetries++;await event('mission_retry',{mission:retryKey,retry:n,hp:s.hp,runTime:s.runTime});await page.locator('#campaignRetry').click();lastProgress=t;lastActionAt=t;pendingRead=null;}
    else if(s.mode==='paused'){const resume=page.locator('#resumeBtn');if(await resume.isVisible())await resume.click();else await page.keyboard.press('Escape');await event('pause_resumed');lastActionAt=t;}
    else if(s.mode==='upgrade'){
     const cards=page.locator('.upgrade-card');if(await cards.count()){const selected=await cards.evaluateAll((items,low)=>{const names=low?['热姜茶','鲸骨船肋','长明灯','双生星火','燧光炮芯','铜铃快机']:['双生星火','燧光炮芯','铜铃快机','长明灯','鲸骨船肋','穿雾针','潮汐线圈'];let best=0,rank=99;items.forEach((b,i)=>{const n=names.findIndex(t=>b.textContent.includes(t));if(n>=0&&n<rank){rank=n;best=i;}});return best;},s.hp<s.maxHp*.45);const title=await cards.nth(selected).innerText();await cards.nth(selected).click();await event('upgrade_selected',{chapter:s.chapter,leg:s.leg,title});lastActionAt=t;}
    }else if(s.mode!=='playing'){
     const buttons=page.locator('[data-story-choice]'),next=page.locator('#storyNext'),chapterNext=page.locator('#chapterContinue');let action=null;
     if(await buttons.first().isVisible()){const count=await buttons.count();action={kind:'choice',locator:buttons.nth((s.chapter+o.choiceSeed)%count)};}
     else if(await next.isVisible())action={kind:'story',locator:next};
     else if(await chapterNext.isVisible())action={kind:'chapter',locator:chapterNext};
     else if(s.mode==='hub'||s.phase==='hub'){const cards=page.locator('.chapter-card[data-chapter]:not([disabled])');const indices=await cards.evaluateAll(els=>els.map((e,i)=>({i,chapter:Number(e.dataset.chapter),available:e.classList.contains('available')||e.dataset.available==='true'||!e.classList.contains('locked')})).filter(x=>x.available));const selected=indices.sort((a,b)=>a.chapter-b.chapter).find(x=>!chapters.has(x.chapter));if(selected)action={kind:'hub',locator:cards.nth(selected.i)};}
     if(action){const signature=[s.chapter,s.leg,s.phase,s.sceneIndex,action.kind,s.readingText].join('|');if(signature!==lastReadSignature){lastReadSignature=signature;const seconds=action.kind==='hub'||s.phase==='hub'?0:readingDelaySeconds(s.readingText,o.readingCpm);pendingRead={signature,readyAt:t+seconds,seconds,startedAt:t};await event('reading_started',{chapter:s.chapter,leg:s.leg,phase:s.phase,sceneIndex:s.sceneIndex,characters:s.readingText.replace(/\s+/g,'').length,simulatedReadingSeconds:seconds});}
      if(pendingRead&&t>=pendingRead.readyAt){const text=await action.locator.innerText();if(action.kind==='choice'){const c={chapter:s.chapter,leg:s.leg,text,at:new Date().toISOString()};choices.push(c);await event('story_choice',c);}await action.locator.click();await event('story_advanced',{chapter:s.chapter,phase:s.phase,kind:action.kind,actualPanelWaitSeconds:t-pendingRead.startedAt,button:text});lastActionAt=t;pendingRead=null;}
     }
    }
   }
   if(s.mode==='playing'&&t-lastProgress>20){await fault('campaign_game_clock_stalled',s);status='failed';break;}
   if(inMission&&t-missionBeganAt>900){await fault('campaign_mission_timeout',{mission:currentMission,state:s});status='failed';break;}
   if(t>o.maxWallMinutes*60){await fault('campaign_wall_limit',{limitMinutes:o.maxWallMinutes,state:s});status='failed';break;}
   if(o.minutes!==null&&t>=o.minutes*60){status='sample_complete';last=s;break;}
   last=s;
   if(t-lastHeartbeat>=10){lastHeartbeat=t;try{native=await timeout(nativeMetrics(browserServer.process().pid),2000,'Campaign native metrics');}catch(e){native={available:false,error:e.message};}await summary();await event('heartbeat',{chapter:s.chapter,leg:s.leg,phase:s.phase,gameSeconds:s.runTime,validatedPlayingSeconds:activeSeconds,dialoguePanelWallSeconds:dialogueWallSeconds,hp:s.hp,targets:s.targets,nativeBrowserMetrics:native});}
   if(t-lastCapture>=o.screenshotMinutes*60){lastCapture=t;await capture();}
   await wait(o.interval);
  }
 }catch(e){status='failed';await fault('campaign_runner_error',String(e.stack||e));}
 finally{
  const intended=status==='running'?'interrupted':status;status='finalizing';await summary();closing=true;
  const owned=await tree(browserServer?.process()?.pid);if(browserServer)try{await timeout(browserServer.close(),5000,'Campaign browser close');}catch{try{await timeout(browserServer.kill(),3000,'Campaign browser kill');}catch{await killTree(owned);}}
  srv?.child.kill();status=intended;await event('finished',{status,completedMissionCount:completed.size,completedChapters:chapters.size,validatedPlayingSeconds:activeSeconds,dialoguePanelWallSeconds:dialogueWallSeconds});await summary();
 }
 if(status==='failed'||status==='interrupted')process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)run(parseCampaignArgs(process.argv.slice(2))).catch(e=>{console.error(e);process.exitCode=1;});
