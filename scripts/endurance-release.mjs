#!/usr/bin/env node
/** Coordinates fresh ten-hour attempts. Durations from failed attempts never authorize release. */
import {readFile,writeFile,mkdir,rename,lstat,readdir,open,unlink} from 'node:fs/promises';
import {createWriteStream,writeFileSync,watch} from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const ARTIFACTS=path.join(ROOT,'artifacts');
const ENDURANCE=path.join(ARTIFACTS,'endurance');
const SOAK=path.join(ARTIFACTS,'soak-10h');
const RELEASE=path.join(ARTIFACTS,'release');
const TARGET_SECONDS=36000;
const MAX_ATTEMPTS=3;
const LOG_LIMIT=8*1024*1024;
const INFRA_FAULTS=new Set(['browser_evaluate_error','playing_clock_stalled','browser_disconnect','browser_screenshot_error','screenshot_timeout','screenshot_capture_error','capture_timeout','optional_capture_failed']);
const SOAK_DERIVED_BLOCK=/^(?:Error: )?Soak (?:failed; no publication|interrupted; no publication|recorded a fault; no publication|heartbeat stopped; no publication)(?:\n|$)/;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const digest=b=>createHash('sha256').update(b).digest('hex');

export function parseArgs(args){
 const options={maxAttempts:MAX_ATTEMPTS,pollMs:500};
 for(let i=0;i<args.length;i++){
  if(args[i]==='--run')continue;
  if(args[i]==='--max-attempts'){options.maxAttempts=Number(args[++i]);continue;}
  if(args[i]==='--poll-ms'){options.pollMs=Number(args[++i]);continue;}
  throw Error('Usage: node scripts/endurance-release.mjs --run [--max-attempts 1..3] [--poll-ms 100..10000]');
 }
 if(!Number.isInteger(options.maxAttempts)||options.maxAttempts<1||options.maxAttempts>MAX_ATTEMPTS)throw Error('At most three fresh attempts are allowed');
 if(!Number.isFinite(options.pollMs)||options.pollMs<100||options.pollMs>10000)throw Error('Poll interval must be 100–10000 ms');
 return options;
}

/** Pure policy: never reinterpret an application exception or unknown runner failure as infrastructure. */
export function retryDecision(report,releaseStatus,{attempt,maxAttempts=MAX_ATTEMPTS,stopped=false}={}){
 if(stopped)return{retry:false,reason:'cancelled'};
 if(!Number.isInteger(attempt)||attempt<1||!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>MAX_ATTEMPTS)return{retry:false,reason:'invalid_attempt_budget'};
 if(releaseStatus?.state==='published'||releaseStatus?.state==='pushing'||releaseStatus?.publishedChangesMayExist===true)return{retry:false,reason:'publication_started_or_completed'};
 if(releaseStatus?.state==='blocked'&&!SOAK_DERIVED_BLOCK.test(String(releaseStatus.reason||'')))return{retry:false,reason:'release_requires_review'};
 if(!report||!['failed','interrupted'].includes(report.status))return{retry:false,reason:'missing_terminal_soak_failure'};
 if(!Number.isInteger(report.faultCount)||report.faultCount<1||!Array.isArray(report.faults)||report.faultCount!==report.faults.length)return{retry:false,reason:'incomplete_fault_evidence'};
 const unknown=report.faults.filter(f=>!INFRA_FAULTS.has(f?.code)).map(f=>f?.code||'missing_code');
 if(unknown.length)return{retry:false,reason:'application_or_unclassified_fault',codes:unknown};
 if(attempt>=maxAttempts)return{retry:false,reason:'retry_budget_exhausted'};
 return{retry:true,reason:'classified_infrastructure_failure',codes:report.faults.map(f=>f.code)};
}

/** A new attempt starts at zero; historical times are deliberately not accepted as an argument. */
export function freshProgress(attempt){
 if(!Number.isInteger(attempt)||attempt<1||attempt>MAX_ATTEMPTS)throw Error('Invalid fresh attempt number');
 return{attempt,targetSeconds:TARGET_SECONDS,wallSeconds:0,validatedPlayingSeconds:0,priorTimeCredited:0};
}
export function parseProcStat(text){
 const close=text.lastIndexOf(')');if(close<0)throw Error('Unrecognized process stat');
 const fields=text.slice(close+2).trim().split(/\s+/);
 if(fields.length<20)throw Error('Incomplete process stat');
 return{state:fields[0],ppid:Number(fields[1]),startTime:fields[19]};
}
export const isLiveProcess=s=>Boolean(s&&!['Z','X','x'].includes(s.state));
const liveState=isLiveProcess;
async function processIdentity(pid){
 if(!Number.isInteger(Number(pid))||Number(pid)<1)return null;
 try{return{pid:Number(pid),...parseProcStat(await readFile('/proc/'+pid+'/stat','utf8'))};}
 catch(error){if(error.code==='ENOENT'||error.code==='ESRCH')return null;throw Error('Cannot safely inspect PID '+pid+': '+error.message);}
}
async function jsonIfExists(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw Error('Cannot read '+path.relative(ROOT,file)+': '+error.message);}}
async function exists(file){try{await lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function realDirectory(dir,{create=false}={}){
 if(create)await mkdir(dir,{recursive:true});
 try{const s=await lstat(dir);if(s.isSymbolicLink()||!s.isDirectory())throw Error('Refusing non-directory or symlink: '+dir);}
 catch(error){if(error.code==='ENOENT'&&!create)return false;throw error;}
 return true;
}
async function atomicJson(file,value){const tmp=file+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2));await rename(tmp,file);}
async function priorProcessesExited(){
 const records=[['soak summary',(await jsonIfExists(path.join(SOAK,'summary.json')))?.pid],['release status',(await jsonIfExists(path.join(RELEASE,'status.json')))?.pid]];
 const lockFile=path.join(RELEASE,'supervisor.lock');if(await exists(lockFile)){const value=(await readFile(lockFile,'utf8')).trim();if(!/^\d+$/.test(value))throw Error('Unrecognized prior supervisor lock; review before moving release evidence');records.push(['supervisor lock',Number(value)]);}
 for(const [label,pid]of records){if(pid===undefined||pid===null)continue;if(!Number.isInteger(Number(pid))||Number(pid)<1)throw Error('Invalid prior '+label+' PID; refusing to move evidence');const identity=await processIdentity(Number(pid));if(liveState(identity))throw Error(`Prior ${label} PID ${pid} is still live; refusing to move paths or kill an unowned process`);}
}
async function processTree(rootIdentity){
 if(!rootIdentity)return[];const current=await processIdentity(rootIdentity.pid);if(!current||current.startTime!==rootIdentity.startTime)return[];
 const processes=(await Promise.all((await readdir('/proc')).filter(n=>/^\d+$/.test(n)).map(async n=>{try{return await processIdentity(Number(n));}catch{return null;}}))).filter(Boolean);
 const ids=new Set([rootIdentity.pid]);let changed=true;while(changed){changed=false;for(const p of processes)if(ids.has(p.ppid)&&!ids.has(p.pid)){ids.add(p.pid);changed=true;}}
 return processes.filter(p=>ids.has(p.pid));
}
async function signalMatching(identity,signal){const current=await processIdentity(identity.pid);if(current?.startTime===identity.startTime&&liveState(current)){try{process.kill(identity.pid,signal);}catch(error){if(!['ESRCH'].includes(error.code))throw error;}}}

export async function runCoordinator(options=parseArgs([])){
 await realDirectory(ARTIFACTS,{create:true});await realDirectory(ENDURANCE,{create:true});await realDirectory(path.join(ENDURANCE,'history'),{create:true});
 const sessionId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
 const lockPath=path.join(ENDURANCE,'coordinator.lock');let lockOwned=false;
 const identity=await processIdentity(process.pid);
 try{
  let lock;
  try{lock=await open(lockPath,'wx');}
  catch(error){
   if(error.code!=='EEXIST')throw error;
   const prior=await jsonIfExists(lockPath);if(!Number.isInteger(prior?.pid))throw Error('Unrecognized coordinator lock; refusing to replace it');
   if(liveState(await processIdentity(prior.pid)))throw Error('An endurance coordinator is already running (PID '+prior.pid+')');
   await rename(lockPath,lockPath+'.stale-'+sessionId);lock=await open(lockPath,'wx');
  }
  await lock.writeFile(JSON.stringify({pid:process.pid,startTime:identity?.startTime,sessionId}));await lock.close();lockOwned=true;
 }catch(error){console.error(error.message);process.exitCode=1;return{state:'blocked',reason:error.message};}
 let stopped=false,stopReason='',currentAttempt=0,children=[],failureHistory=[],archiveNumber=0,lastStatusAt=0,currentReport=null,currentRelease=null,state='starting',stopWatcher;
 const coordinatorStartedAt=new Date().toISOString(),clock=process.hrtime.bigint();
 const elapsed=()=>Number(process.hrtime.bigint()-clock)/1e9;
 const event=async(type,detail={})=>{const row={at:new Date().toISOString(),type,sessionId,attempt:currentAttempt,...detail};await writeFile(path.join(ENDURANCE,'events.jsonl'),JSON.stringify(row)+'\n',{flag:'a'});console.log(JSON.stringify(row));};
 async function status(next,detail={}){
  state=next;const progress=currentReport?{attempt:currentAttempt,targetSeconds:TARGET_SECONDS,wallSeconds:currentReport.wallSeconds,validatedPlayingSeconds:currentReport.validatedPlayingSeconds,priorTimeCredited:0}:freshProgress(Math.max(1,currentAttempt));
  const row={schemaVersion:1,state,at:new Date().toISOString(),pid:process.pid,sessionId,startedAt:coordinatorStartedAt,coordinatorWallSeconds:elapsed(),maxAttempts:options.maxAttempts,progress,failureHistory,...detail};
  await atomicJson(path.join(ENDURANCE,'status.json'),row);lastStatusAt=Date.now();return row;
 }
 function requestStop(reason){
  stopped=true;stopReason||=reason;
  // Keep cancellation outside archived attempt folders and mirror it before signalling publication workers.
  try{writeFileSync(path.join(ENDURANCE,'STOP'),reason+'\n',{flag:'a'});}catch{}
  try{writeFileSync(path.join(RELEASE,'STOP'),reason+'\n',{flag:'a'});}catch{}
  for(const record of children)if(!record.exited&&record.identity)void signalMatching(record.identity,'SIGTERM').catch(()=>{});
 }
 const signals=new Map(['SIGTERM','SIGINT'].map(signal=>[signal,()=>requestStop('Coordinator received '+signal)]));
 for(const [signal,handler]of signals)process.on(signal,handler);
 async function checkStop(){
  if(!stopped&&(await exists(path.join(ENDURANCE,'STOP'))||await exists(path.join(RELEASE,'STOP'))))requestStop('STOP marker present; publication cancelled');
  if(stopped)throw Object.assign(Error(stopReason||'Cancelled'),{cancelled:true});
 }
 async function heartbeat(){if(Date.now()-lastStatusAt>=10000)await status(state);}
 async function waitOwned(record,ms){const until=Date.now()+ms;while(!record.exited&&Date.now()<until){await wait(Math.min(options.pollMs,250));await heartbeat();}return record.exited;}
 async function stopOwned(record){
  if(!record||record.exited)return;
  const initial=await processTree(record.identity);await signalMatching(record.identity,'SIGTERM');
  if(await waitOwned(record,15000))return;
  await event('owned_child_force_stop',{role:record.role,pid:record.child.pid});
  const current=await processTree(record.identity);const unique=new Map([...initial,...current].map(p=>[p.pid+':'+p.startTime,p]));
  for(const p of [...unique.values()].reverse())await signalMatching(p,'SIGKILL');
  if(!await waitOwned(record,5000))throw Error('Owned '+record.role+' did not exit after bounded cleanup');
 }
 async function launch(role,script,args,logPath){
  const log=createWriteStream(logPath,{flags:'a'});let logged=0,truncated=false;
  const child=spawn(process.execPath,[path.join(ROOT,'scripts',script),...args],{cwd:ROOT,env:{...process.env},stdio:['ignore','pipe','pipe']});
  const record={role,child,identity:null,exited:false,exitCode:null,signal:null,error:null};children.push(record);
  const output=data=>{if(logged<LOG_LIMIT){const chunk=Buffer.from(data),kept=chunk.subarray(0,LOG_LIMIT-logged);logged+=kept.length;log.write(kept);}else if(!truncated){truncated=true;log.write('\n[Coordinator log limit reached; structured evidence remains in the attempt files.]\n');}};
  child.stdout.on('data',output);child.stderr.on('data',output);
  child.on('error',error=>{record.error=error.message;record.exited=true;record.exitCode=-1;log.end();});
  child.on('close',(code,signal)=>{record.exited=true;record.exitCode=code;record.signal=signal;log.end();});
  record.identity=child.pid?await processIdentity(child.pid):null;
  await event('owned_child_started',{role,pid:child.pid||null,script});return record;
 }
 async function archivePrevious(candidate,label){
  if(children.some(c=>!c.exited))throw Error('Cannot archive while an owned child is still running');
  await checkStop();await priorProcessesExited();
  const hasSoak=await realDirectory(SOAK),hasRelease=await realDirectory(RELEASE);
  if(!hasSoak&&!hasRelease){await realDirectory(RELEASE,{create:true});await writeFile(path.join(RELEASE,'candidate.json'),candidate,{flag:'wx'});return null;}
  if(hasRelease){const now=await readFile(path.join(RELEASE,'candidate.json'));if(!now.equals(candidate))throw Error('Release candidate changed before archive; refusing to replace it');}
  const archive=path.join(ENDURANCE,'history',`attempt-${String(++archiveNumber).padStart(3,'0')}-${sessionId}`);await mkdir(archive);
  if(hasSoak)await rename(SOAK,path.join(archive,'soak-10h'));
  if(hasRelease)await rename(RELEASE,path.join(archive,'release'));
  const hadStop=hasRelease&&await exists(path.join(archive,'release','STOP'));
  await realDirectory(RELEASE,{create:true});await writeFile(path.join(RELEASE,'candidate.json'),candidate,{flag:'wx'});
  await writeFile(path.join(archive,'archive.json'),JSON.stringify({schemaVersion:1,archivedAt:new Date().toISOString(),sessionId,label,candidateSha256:digest(candidate),priorTimeCredited:0},null,2),{flag:'wx'});
  if(hadStop)requestStop('STOP marker was present in the archived release; publication cancelled');
  await checkStop();await event('evidence_archived',{label,archive:path.relative(ROOT,archive),candidateSha256:digest(candidate),priorTimeCredited:0});return path.relative(ROOT,archive);
 }
 async function freshSummary(soak){
  const until=Date.now()+30000;
  while(Date.now()<until){
   await checkStop();const report=await jsonIfExists(path.join(SOAK,'summary.json'));
   if(report){if(report.pid!==soak.child.pid||report.targetSeconds!==TARGET_SECONDS||!Number.isFinite(Date.parse(report.startedAt)))throw Error('Fresh soak evidence identity or ten-hour target is invalid');return report;}
   if(soak.exited)throw Error('Fresh soak exited before writing its first summary'+(soak.error?': '+soak.error:''));
   await wait(Math.min(options.pollMs,500));await heartbeat();
  }
  throw Error('Fresh soak did not write a summary within 30 seconds');
 }
 try{
  await checkStop();await realDirectory(RELEASE);
  const candidate=await readFile(path.join(RELEASE,'candidate.json'));JSON.parse(candidate);
  // Retain historical failures for review without importing their elapsed credit.
  for(const entry of await readdir(path.join(ENDURANCE,'history'),{withFileTypes:true})){
   if(!entry.isDirectory()||!await exists(path.join(ENDURANCE,'history',entry.name,'archive.json')))continue;
   const archived=await jsonIfExists(path.join(ENDURANCE,'history',entry.name,'soak-10h','summary.json'));
   if(archived)failureHistory.push({kind:'archived_prior_attempt',archive:path.relative(ROOT,path.join(ENDURANCE,'history',entry.name)),soakStatus:archived.status,faults:archived.faults||[],wallSeconds:archived.wallSeconds||0,validatedPlayingSeconds:archived.validatedPlayingSeconds||0,priorTimeCredited:0});
  }
  const priorReport=await jsonIfExists(path.join(SOAK,'summary.json')),priorRelease=await jsonIfExists(path.join(RELEASE,'status.json'));
  await priorProcessesExited();
  if(priorReport||priorRelease)failureHistory.push({kind:'prior_preserved_evidence',soakStatus:priorReport?.status||null,releaseState:priorRelease?.state||null,faults:priorReport?.faults||[],wallSeconds:priorReport?.wallSeconds||0,validatedPlayingSeconds:priorReport?.validatedPlayingSeconds||0,priorTimeCredited:0});
  stopWatcher=watch(ENDURANCE,(_,name)=>{if(String(name)==='STOP'&&!stopped)requestStop('Endurance STOP marker observed');});
  for(currentAttempt=1;currentAttempt<=options.maxAttempts;currentAttempt++){
   await checkStop();currentReport=null;currentRelease=null;await status('preparing_fresh_attempt');
   const archive=await archivePrevious(candidate,currentAttempt===1?'initial preparation':'failed attempt '+(currentAttempt-1));
   if(archive&&failureHistory.length)failureHistory.at(-1).archive=archive;
   await realDirectory(SOAK,{create:true});children=[];
   await status('starting_soak',{candidateSha256:digest(candidate)});
   const soak=await launch('soak','soak.mjs',['--hours','10','--output',SOAK],path.join(SOAK,'runner.log'));
   currentReport=await freshSummary(soak);await checkStop();
   const supervisor=await launch('supervisor','release-after-soak.mjs',['--supervise'],path.join(RELEASE,'supervisor.log'));
   await status('running');let supervisorStopRequested=false;
   while(!soak.exited||!supervisor.exited){
    await checkStop();currentReport=await jsonIfExists(path.join(SOAK,'summary.json'))||currentReport;currentRelease=await jsonIfExists(path.join(RELEASE,'status.json'))||currentRelease;
    await heartbeat();
    if(supervisor.exited&&!soak.exited){
     // A faulting runner normally exits immediately; give its existing cleanup a bounded grace period.
     if((currentReport?.faultCount||0)>0||['failed','interrupted'].includes(currentReport?.status))await waitOwned(soak,12000);
     if(!soak.exited)await stopOwned(soak);
    }
    if(soak.exited&&soak.exitCode!==0&&!supervisor.exited&&!supervisorStopRequested){
     // The supervisor checks every 30 seconds. Allow it to preserve its own rejection reason first.
     if(!await waitOwned(supervisor,90000)){supervisorStopRequested=true;await stopOwned(supervisor);}
    }
    if(!soak.exited||!supervisor.exited)await wait(options.pollMs);
   }
   currentReport=await jsonIfExists(path.join(SOAK,'summary.json'));currentRelease=await jsonIfExists(path.join(RELEASE,'status.json'));
   if(soak.exitCode===0&&supervisor.exitCode===0&&currentReport?.status==='complete'&&currentRelease?.state==='published'){
    await status('published',{release:currentRelease,successfulAttempt:currentAttempt});await event('published',{attempt:currentAttempt,commit:currentRelease.commit});return{state:'published',attempt:currentAttempt};
   }
   const decision=retryDecision(currentReport,currentRelease,{attempt:currentAttempt,maxAttempts:options.maxAttempts,stopped});
   failureHistory.push({kind:'fresh_attempt_failed',attempt:currentAttempt,at:new Date().toISOString(),soakExitCode:soak.exitCode,supervisorExitCode:supervisor.exitCode,soakStatus:currentReport?.status||null,releaseState:currentRelease?.state||null,releaseReason:currentRelease?.reason||null,faults:currentReport?.faults||[],wallSeconds:currentReport?.wallSeconds||0,validatedPlayingSeconds:currentReport?.validatedPlayingSeconds||0,priorTimeCredited:0,decision});
   await event('attempt_failed',{decision,soakExitCode:soak.exitCode,supervisorExitCode:supervisor.exitCode});
   if(!decision.retry){await status('blocked',{reason:decision.reason,needsReview:true,release:currentRelease});process.exitCode=1;return{state:'blocked',reason:decision.reason};}
   await status('retrying_fresh_attempt',{reason:decision.reason,nextAttempt:currentAttempt+1});
  }
  throw Error('Fresh attempt budget exhausted');
 }catch(error){
  if(error.cancelled||stopped){await status('cancelled',{reason:stopReason||error.message,publicationCancelled:true});await event('cancelled',{reason:stopReason||error.message});}
  else{await status('blocked',{reason:String(error.stack||error),needsReview:true});await event('blocked',{reason:error.message});}
  process.exitCode=1;return{state:stopped?'cancelled':'blocked',reason:error.message};
 }finally{
  // Only children spawned by this invocation can receive a signal from this coordinator.
  for(const record of children)if(!record.exited)try{await stopOwned(record);}catch(error){await event('owned_cleanup_failed',{role:record.role,detail:error.message});process.exitCode=1;}
  stopWatcher?.close();for(const [signal,handler]of signals)process.off(signal,handler);
  if(lockOwned){try{const content=await jsonIfExists(lockPath);if(content?.pid===process.pid&&content?.sessionId===sessionId)await unlink(lockPath);}catch{}}
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)runCoordinator(parseArgs(process.argv.slice(2))).catch(error=>{console.error(error);process.exitCode=1;});
