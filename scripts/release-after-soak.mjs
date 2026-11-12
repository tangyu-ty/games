#!/usr/bin/env node
/** Publishes only after independently checking real ten-hour evidence and a passing final regression suite. */
import {readFile,writeFile,mkdir,rename,open,readdir,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sha=data=>createHash('sha256').update(data).digest('hex');
const DIR=path.join(ROOT,'artifacts','release');
const activeCommands=new Set();
function stopCommands(){for(const child of activeCommands){try{process.kill(-child.pid,'SIGTERM');}catch{}}}
export function gate(report,expectedSource){
 const reasons=[];
 if(report?.status!=='complete'||report?.completed!==true||report?.publishGate!==true)reasons.push('Soak is not successfully complete');
 if(!Number.isFinite(report?.wallSeconds)||report.wallSeconds<36000)reasons.push('Fewer than ten actual wall-clock hours');
 if(!Number.isFinite(report?.validatedPlayingSeconds)||report.validatedPlayingSeconds<36000)reasons.push('Fewer than ten validated playing hours');
 if(!Number.isFinite(report?.targetSeconds)||report.targetSeconds<36000)reasons.push('A short smoke test cannot authorize publication');
 if(report?.faultCount!==0||!Array.isArray(report?.faults)||report.faults.length)reasons.push('Unresolved soak faults');
 if(report?.schemaVersion>=2){
  if(!Number.isInteger(report.warningCount)||report.warningCount<0||!Array.isArray(report.warnings)||report.warningCount!==report.warnings.length)reasons.push('Missing diagnostic warning audit');
  else for(const warning of report.warnings){const at=Date.parse(warning.at),verified=Date.parse(warning.healthVerifiedAt);if(warning.code!=='diagnostic_capture_timeout'||warning.resolved!==true||!Number.isFinite(at)||!Number.isFinite(verified)||verified<at||verified>Date.parse(report.updatedAt)||verified-at>60000||!warning.healthSample||!Number.isFinite(warning.healthSample.runTime)||!Number.isFinite(warning.healthSample.previousRunTime)||!Number.isFinite(warning.healthSample.frameCount)||!Number.isFinite(warning.healthSample.previousFrameCount)||warning.healthSample.frameCount<=warning.healthSample.previousFrameCount||(warning.healthSample.mode==='playing'&&warning.healthSample.runTime<=warning.healthSample.previousRunTime))reasons.push('Unresolved or misclassified diagnostic warning');}
 }
 if(!report?.counts||!['runs','wins','losses'].every(k=>Number.isInteger(report.counts[k])&&report.counts[k]>=0)||report.counts.wins<1||report.counts.runs<3||report.counts.wins+report.counts.losses>report.counts.runs)reasons.push('No valid demonstrated repeated complete voyages');
 if(report?.requirementsMet!==true)reasons.push('Soak requirements are not met');
 if(report?.wallSeconds<report?.targetSeconds||report?.validatedPlayingSeconds<report?.targetSeconds||report?.validatedPlayingSeconds>report?.wallSeconds+1)reasons.push('Incoherent measured durations');
 if(!/^[0-9a-f]{64}$/.test(report?.latestSourceSha256||'')||!Array.isArray(report?.sourceRevisions)||!report.sourceRevisions.some(r=>r.sha256===report.latestSourceSha256))reasons.push('Missing source revision evidence');
 if(expectedSource&&report?.latestSourceSha256!==expectedSource)reasons.push('Final source revision has not been exercised');
 const started=Date.parse(report?.startedAt),finished=Date.parse(report?.updatedAt);
 if(!Number.isFinite(started)||!Number.isFinite(finished)||(finished-started)/1000<36000||finished>Date.now()+30000||(Date.now()-started)/1000<36000)reasons.push('Invalid or insufficient timestamp evidence');
 return reasons;
}
async function gameHash(){const h=createHash('sha256');for(const file of (await readdir(ROOT,{withFileTypes:true})).filter(f=>f.isFile()&&/\.(js|html|css)$/.test(f.name)).map(f=>f.name).sort()){h.update(file);h.update(await readFile(path.join(ROOT,file)));}return h.digest('hex');}
async function filesUnder(dir=''){let list=[];for(const entry of await readdir(path.join(ROOT,dir),{withFileTypes:true})){const relative=path.posix.join(dir,entry.name);if(['.git','node_modules','artifacts','.cache'].includes(entry.name)||entry.name==='.DS_Store')continue;if(entry.isSymbolicLink())throw Error('Unreviewed symlink: '+relative);if(entry.isDirectory())list.push(...await filesUnder(relative));else if(entry.isFile())list.push(relative);}return list.sort();}
async function command(program,args,{log,allowFailure=false,timeout=600000}={}){
 return new Promise((resolve,reject)=>{const child=spawn(program,args,{cwd:ROOT,detached:true,stdio:['ignore','pipe','pipe']});activeCommands.add(child);child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');let output='';const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGTERM');}catch{}reject(Error(program+' command timed out'));},timeout);child.stdout.on('data',d=>{output+=d;if(log)log.write(d);});child.stderr.on('data',d=>{output+=d;if(log)log.write(d);});child.on('error',error=>{activeCommands.delete(child);clearTimeout(timer);reject(error);});child.on('exit',(code,signal)=>{activeCommands.delete(child);clearTimeout(timer);if(code===0||allowFailure)resolve({code,signal,output});else reject(Error(program+' '+args.join(' ')+' failed ('+code+'): '+output.slice(-4000)));});});
}
async function remoteMain(){const {output}=await command('git',['ls-remote','origin','refs/heads/main']);const head=output.trim().split(/\s+/)[0];if(!/^[0-9a-f]{40}$/.test(head))throw Error('Remote main cannot be verified');return head;}
async function arm(){
 await mkdir(DIR,{recursive:true});if((await command('git',['diff','--cached','--name-only'])).output.trim())throw Error('Refusing to arm with pre-existing staged changes');const files=await filesUnder();const hashes={};for(const file of files)hashes[file]=sha(await readFile(path.join(ROOT,file)));
 const manifest={schemaVersion:1,armedAt:new Date().toISOString(),localHead:(await command('git',['rev-parse','HEAD'])).output.trim(),remoteMain:await remoteMain(),gameSourceSha256:await gameHash(),files:hashes};await writeFile(path.join(DIR,'candidate.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify({status:'armed',files:files.length,gameSourceSha256:manifest.gameSourceSha256,remoteMain:manifest.remoteMain}));
}
async function verifyCandidate(manifest){if(JSON.stringify(await filesUnder())!==JSON.stringify(Object.keys(manifest.files).sort()))throw Error('Candidate file membership changed after review');for(const [file,expected]of Object.entries(manifest.files)){const actual=sha(await readFile(path.join(ROOT,file)));if(actual!==expected)throw Error('Candidate changed since final review: '+file);}if(await gameHash()!==manifest.gameSourceSha256)throw Error('Game source changed since final review');}
async function supervise(){
 await mkdir(DIR,{recursive:true});const lock=await open(path.join(DIR,'supervisor.lock'),'wx');await lock.writeFile(String(process.pid));await lock.close();
 let manifest;try{manifest=JSON.parse(await readFile(path.join(DIR,'candidate.json'),'utf8'));}catch(error){await unlink(path.join(DIR,'supervisor.lock')).catch(()=>{});throw error;}
 const reportPath=path.join(ROOT,'artifacts','soak-10h','summary.json');
 const {createWriteStream}=await import('node:fs');const log=createWriteStream(path.join(DIR,'checks.log'),{flags:'a'});
 let stopped=false;for(const s of ['SIGTERM','SIGINT'])process.once(s,()=>{stopped=true;stopCommands();});
 let periodicCount=0,lastCheck=0,lastPublishedStatus='';
 async function checkStop(){if(stopped)throw Error('Supervisor interrupted; publication cancelled');for(const flag of [path.join(DIR,'STOP'),path.join(ROOT,'artifacts','endurance','STOP')]){try{await readFile(flag);throw Error('STOP file present; publication cancelled');}catch(error){if(error.code!=='ENOENT')throw error;}}}
 async function status(state,detail={}){const row={schemaVersion:1,at:new Date().toISOString(),pid:process.pid,state,...detail};const tmp=path.join(DIR,'status.json.tmp');await writeFile(tmp,JSON.stringify(row,null,2));await rename(tmp,path.join(DIR,'status.json'));if(state!==lastPublishedStatus){console.log(JSON.stringify(row));lastPublishedStatus=state;}}
 try{
  await verifyCandidate(manifest);await status('waiting_for_ten_hours',{earliestPossiblePublication:new Date(Date.parse(JSON.parse(await readFile(reportPath,'utf8')).startedAt)+36000000).toISOString()});
  for(;;){
   await checkStop();
   const report=JSON.parse(await readFile(reportPath,'utf8'));
   if(report.status==='running'&&Date.now()-Date.parse(report.updatedAt)>120000)throw Error('Soak heartbeat stopped; no publication');
   if(report.status==='failed'||report.status==='interrupted')throw Error('Soak '+report.status+'; no publication');
   if(report.faultCount>0)throw Error('Soak recorded a fault; no publication');
   if(report.completed){const reasons=gate(report,manifest.gameSourceSha256);if(reasons.length)throw Error(reasons.join('; '));break;}
   const now=Date.now();if(now-lastCheck>=1800000){
    await status('periodic_regression',{round:++periodicCount,wallSeconds:report.wallSeconds,playingSeconds:report.validatedPlayingSeconds});
    log.write('\nRegression round '+periodicCount+' '+new Date().toISOString()+'\n');await command('npm',['test'],{log});lastCheck=Date.now();
   }
   await status('waiting_for_ten_hours',{periodicRegressionRounds:periodicCount,wallSeconds:report.wallSeconds,playingSeconds:report.validatedPlayingSeconds,targetSeconds:36000});await wait(30000);
  }
  await checkStop();await status('final_validation');await verifyCandidate(manifest);await command('npm',['test'],{log});await verifyCandidate(manifest);
  const report=JSON.parse(await readFile(reportPath,'utf8'));const reasons=gate(report,manifest.gameSourceSha256);if(reasons.length)throw Error(reasons.join('; '));
  if(await remoteMain()!==manifest.remoteMain)throw Error('Remote main changed during testing; refusing to overwrite concurrent work');
  const localHead=(await command('git',['rev-parse','HEAD'])).output.trim();if(localHead!==manifest.localHead)throw Error('Local HEAD changed after release was armed');
  // Scan only explicitly reviewed candidate files; never stage logs, credentials or unrelated new files.
  for(const file of Object.keys(manifest.files)){const text=await readFile(path.join(ROOT,file),'utf8');if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9_]{30,}\b/.test(text))throw Error('Potential credential in release candidate: '+file);}
  await mkdir(path.join(ROOT,'validation'),{recursive:true});const evidence={schemaVersion:2,startedAt:report.startedAt,finishedAt:report.updatedAt,wallSeconds:report.wallSeconds,validatedPlayingSeconds:report.validatedPlayingSeconds,targetSeconds:report.targetSeconds,counts:report.counts,faultCount:report.faultCount,warningCount:report.warningCount||0,warnings:report.warnings||[],browserConfiguration:report.browserConfiguration||null,sourceRevisions:report.sourceRevisions,finalGameSourceSha256:report.latestSourceSha256,method:report.method,periodicRegressionRounds:periodicCount,finalRegression:'passed'};await writeFile(path.join(ROOT,'validation','ten-hour-soak.json'),JSON.stringify(evidence,null,2));
  await checkStop();if((await command('git',['diff','--cached','--name-only'])).output.trim())throw Error('Unreviewed staged changes appeared during the soak');
  await command('git',['add','--',...Object.keys(manifest.files),'validation/ten-hour-soak.json']);
  for(const [file,expected]of Object.entries({...manifest.files,'validation/ten-hour-soak.json':sha(await readFile(path.join(ROOT,'validation','ten-hour-soak.json')))})){const staged=await command('git',['show',':'+file]);if(sha(staged.output)!==expected)throw Error('Staged content differs from reviewed candidate: '+file);}
  await checkStop();await command('git',['commit','-m','Ship Tidekeeper after ten-hour real-time endurance validation'],{log});
  const commit=(await command('git',['rev-parse','HEAD'])).output.trim();await checkStop();await status('pushing',{commit});await command('git',['push','origin','HEAD:refs/heads/main'],{log});if(await remoteMain()!==commit)throw Error('Remote verification did not match release commit');
  let pages={status:'not_configured'};
  const existingPages=(await command('git',['ls-remote','origin','refs/heads/gh-pages'])).output.trim();
  if(!existingPages){
   // Build a new Pages branch without touching the working checkout, and never replace an existing branch.
   const content=await readFile(path.join(ROOT,'dist','tidekeeper.html'));const htmlBlob=(await command('git',['hash-object','-w','dist/tidekeeper.html'])).output.trim();
   const tmp=path.join(DIR,'.nojekyll');await writeFile(tmp,'');const emptyBlob=(await command('git',['hash-object','-w',tmp])).output.trim();
   const treeInput=`100644 blob ${htmlBlob}\tindex.html\n100644 blob ${emptyBlob}\t.nojekyll\n`;
   const tree=await new Promise((resolve,reject)=>{const c=spawn('git',['mktree'],{cwd:ROOT,stdio:['pipe','pipe','pipe']});let out='',err='';c.stdout.on('data',d=>out+=d);c.stderr.on('data',d=>err+=d);c.on('exit',code=>code===0?resolve(out.trim()):reject(Error(err)));c.stdin.end(treeInput);});
   const pageCommit=(await command('git',['commit-tree',tree,'-m','Publish verified Tidekeeper browser build'])).output.trim();await checkStop();await command('git',['push','origin',pageCommit+':refs/heads/gh-pages'],{log});pages={status:'branch_published',branch:'gh-pages',commit:pageCommit,bytes:content.length,setup:'GitHub repository Settings → Pages → Deploy from branch → gh-pages / (root). GitHub API access was unavailable here; the live URL must be independently verified.'};
  }else pages={status:'existing_branch_preserved',setup:'Existing gh-pages was preserved; deployment needs separate review.'};
  await status('published',{repository:'https://github.com/tangyu-ty/games',commit,commitUrl:'https://github.com/tangyu-ty/games/commit/'+commit,pages,evidence,completedAt:new Date().toISOString()});
 }catch(error){await status('blocked',{reason:String(error.stack||error),publishedChangesMayExist:lastPublishedStatus==='pushing'});process.exitCode=1;}
 finally{log.end();try{if((await readFile(path.join(DIR,'supervisor.lock'),'utf8')).trim()===String(process.pid))await unlink(path.join(DIR,'supervisor.lock'));}catch{}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const mode=process.argv[2];if(mode==='--arm')arm().catch(e=>{console.error(e);process.exitCode=1;});else if(mode==='--supervise')supervise().catch(e=>{console.error(e);process.exitCode=1;});else console.error('Usage: node scripts/release-after-soak.mjs --arm | --supervise');}
