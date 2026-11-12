import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseArgs,retryDecision,freshProgress,parseProcStat,isLiveProcess} from '../scripts/endurance-release.mjs';
const failure=(...codes)=>({status:'failed',faultCount:codes.length,faults:codes.map(code=>({code})),wallSeconds:14400,validatedPlayingSeconds:11500});
const rejectedSoak={state:'blocked',reason:'Error: Soak recorded a fault; no publication\n    at supervise (release-after-soak.mjs)'};

test('outer worker permits at most three fresh ten-hour attempts and no short duration override',()=>{
 assert.deepEqual(parseArgs([]),{maxAttempts:3,pollMs:500});assert.equal(parseArgs(['--run','--max-attempts','2']).maxAttempts,2);
 for(const args of [['--max-attempts','4'],['--max-attempts','0'],['--max-attempts','NaN'],['--minutes','0.2'],['--hours','0.1'],['--poll-ms','0']])assert.throws(()=>parseArgs(args));
});

test('controlled infrastructure failures can trigger a full fresh retry, with a strict attempt budget',()=>{
 for(const code of ['browser_evaluate_error','playing_clock_stalled','browser_disconnect','browser_screenshot_error','screenshot_timeout','screenshot_capture_error','capture_timeout','optional_capture_failed']){
  assert.equal(retryDecision(failure(code),rejectedSoak,{attempt:1}).retry,true,code);
  assert.equal(retryDecision(failure(code),rejectedSoak,{attempt:2}).retry,true,code);
  assert.deepEqual(retryDecision(failure(code),rejectedSoak,{attempt:3}),{retry:false,reason:'retry_budget_exhausted'});
 }
});

test('application faults and unclassified runner exceptions never cause automatic retries',()=>{
 for(const code of ['browser_page_error','browser_page_crash','nonfinite_x','nonfinite_entity_state','invalid_health','unbounded_bullets','heap_over_512mb','voyage_progress_stalled','runner_error','new_unknown_fault']){
  const r=retryDecision(failure('browser_evaluate_error',code),rejectedSoak,{attempt:1});assert.equal(r.retry,false,code);assert.equal(r.reason,'application_or_unclassified_fault');
 }
 const unknown=failure('runner_error');unknown.faults[0].detail='page.screenshot: Timeout 10000ms exceeded';assert.equal(retryDecision(unknown,rejectedSoak,{attempt:1}).retry,false,'Screenshot text cannot reclassify an unknown runner exception');
});

test('source changes, regression failures, and push failures always require review',()=>{
 for(const reason of ['Error: Candidate changed since final review: main.js','Error: npm test failed (1)','Error: Remote main changed during testing','Error: git push origin failed (128)','Error: Supervisor interrupted; publication cancelled']){
  assert.deepEqual(retryDecision(failure('browser_evaluate_error'),{state:'blocked',reason},{attempt:1}),{retry:false,reason:'release_requires_review'});
 }
 assert.equal(retryDecision(failure('browser_evaluate_error'),{state:'pushing'},{attempt:1}).reason,'publication_started_or_completed');
 assert.equal(retryDecision(failure('browser_evaluate_error'),{state:'blocked',publishedChangesMayExist:true,reason:rejectedSoak.reason},{attempt:1}).retry,false);
});

test('missing, truncated, or nonterminal failure evidence cannot authorize retry',()=>{
 assert.equal(retryDecision(null,rejectedSoak,{attempt:1}).retry,false);
 assert.equal(retryDecision({...failure('browser_disconnect'),status:'running'},rejectedSoak,{attempt:1}).retry,false);
 assert.equal(retryDecision({...failure('browser_disconnect'),faultCount:2},rejectedSoak,{attempt:1}).retry,false);
 assert.equal(retryDecision({status:'failed',faultCount:0,faults:[]},rejectedSoak,{attempt:1}).retry,false);
 assert.equal(retryDecision(failure('browser_disconnect'),rejectedSoak,{attempt:0}).reason,'invalid_attempt_budget');
});

test('failed attempt duration never carries into the next attempt, even near ten hours',()=>{
 const prior={...failure('browser_evaluate_error'),wallSeconds:35999,validatedPlayingSeconds:35998};const history=[];
 for(let attempt=1;attempt<=3;attempt++){
  const progress=freshProgress(attempt);assert.equal(progress.wallSeconds,0);assert.equal(progress.validatedPlayingSeconds,0);assert.equal(progress.targetSeconds,36000);assert.equal(progress.priorTimeCredited,0);
  const decision=retryDecision(prior,rejectedSoak,{attempt});history.push({attempt,prior,decision});assert.equal(decision.retry,attempt<3);
 }
 assert.equal(history.length,3);assert.equal(freshProgress(3).validatedPlayingSeconds,0);assert.throws(()=>freshProgress(4));
});

test('STOP dominates retry eligibility, including when a prior report was otherwise recoverable',()=>{
 assert.deepEqual(retryDecision(failure('browser_disconnect'),rejectedSoak,{attempt:1,stopped:true}),{retry:false,reason:'cancelled'});
 assert.deepEqual(retryDecision({status:'complete'}, {state:'published'}, {attempt:1,stopped:true}),{retry:false,reason:'cancelled'});
});

test('PID state classification distinguishes live processes from exited zombies without signalling any process',()=>{
 const suffix=Array.from({length:20},(_,i)=>String(i)).join(' ');const stat='123 (browser (worker)) S '+suffix;
 const identity=parseProcStat(stat);assert.equal(identity.state,'S');assert.equal(identity.ppid,0);assert.equal(identity.startTime,'18');
 assert.equal(isLiveProcess(identity),true);for(const state of ['Z','X','x'])assert.equal(isLiveProcess({...identity,state}),false);assert.equal(isLiveProcess(null),false);assert.throws(()=>parseProcStat('not a stat'));
});
