import {browserPath} from '../scripts/browser.mjs';
import {test,before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire(import.meta.url)('playwright');
let browser,server,base;
const contexts=new Set(),WAIT={timeout:10000},KEY='tidekeeper-story-v2';
before(async()=>{
 server=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
 base=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Campaign test server timed out')),10000);server.once('error',reject);server.stdout.on('data',chunk=>{const m=String(chunk).match(/port (\d+)/);if(m){clearTimeout(t);resolve('http://127.0.0.1:'+m[1]);}});server.once('exit',code=>{clearTimeout(t);reject(Error('Campaign server exited '+code));});});
 browser=await chromium.launch({executablePath:browserPath(chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
});
afterEach(async()=>{await Promise.all([...contexts].map(c=>c.close().catch(()=>{})));contexts.clear();});
after(async()=>{await browser?.close();server?.kill();});
async function open(mockPad=false){
 const context=await browser.newContext({viewport:{width:1280,height:800}});contexts.add(context);
 await context.addInitScript(mock=>{localStorage.setItem('tidekeeper-settings-v1',JSON.stringify({mute:true,reduced:true}));if(mock){window.__pad={connected:true,index:0,id:'Campaign test standard pad',mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[window.__pad]});}},mockPad);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/?test=1');await page.waitForFunction(()=>typeof window.__game?.startCampaign==='function',null,WAIT);return{page,errors};
}
async function start(page){await page.locator('#campaignStartBtn').click();await page.locator('#storyNext').waitFor({state:'visible',...WAIT});assert.equal(await page.evaluate(()=>__game.campaignState.phase),'opening');}
async function skip(page){await page.locator('#storySkip').waitFor({state:'visible',...WAIT});await page.locator('#storySkip').click();}
async function leg(page){
 // Shorten only fixtures for branch coverage: fulfill real targets/kills and call the actual mission update.
 // These checks do not establish the campaign's natural play duration or balance.
 return page.evaluate(()=>{
  const g=__game,e=g.campaignMission,s=e.spec;g.pendingLevel=0;g.player.invuln=100000;g.player.crit=0;e.spawnTimer=1e9;e.hazardTimer=1e9;g.campaignHazards=[];
  if(s.quota){const need=Math.max(0,s.quota-(g.kills-e.baseKills));for(let i=0;i<need;i++){const enemy=e.spawn('skiff');g.damageEnemy(enemy,enemy.maxHp*3);}}
  g.enemies=g.enemies.filter(x=>!x.dead);
  if(s.type==='rescue'||s.type==='salvage'){
   g.enemies=[];for(const object of [...g.missionObjects].filter(o=>!o.optional)){g.player.x=object.x;g.player.y=object.y;for(let k=0;k<Math.ceil((object.channel||7)/.1)+3&&g.mode==='playing';k++)e.update(.1);}
  }else if(s.type==='defend'){g.enemies=[];e.elapsed=s.duration-.04;e.update(.1);}
  else if(s.type==='escort'){e.state.routeIndex=8;const convoy=g.missionObjects.find(o=>o.type==='convoy');const target=e.safePoint({x:900,y:330},46);convoy.x=target.x;convoy.y=target.y;g.player.x=convoy.x;g.player.y=convoy.y;e.update(.1);}
  else if(s.type==='race'){e.state.routeIndex=e.state.totalGates-1;const gate=g.missionObjects.find(o=>o.type==='gate');g.player.x=gate.x;g.player.y=gate.y;e.update(.1);}
  else if(s.type==='hunt'){for(let i=0;i<s.captains&&g.mode==='playing';i++){const captain=g.enemies.find(x=>!x.dead&&x.missionRole===e.state.currentCaptainRole);if(!captain)throw Error('Missing captain target');g.damageEnemy(captain,captain.maxHp*3);e.update(.1);}}
  else if(s.type==='boss'){e.elapsed=3;e.update(.1);const boss=g.enemies.find(x=>!x.dead&&x.missionRole==='campaign-boss');if(!boss)throw Error('Boss did not spawn');g.damageEnemy(boss,boss.maxHp*3);e.update(.1);}
  return{phase:g.campaignState.phase,mode:g.mode,chapter:g.campaignState.chapter,leg:e.leg};
 });
}
async function advanceChapter(page,choice=0){
 await page.waitForFunction(()=>__game.mode==='playing',null,WAIT);
 assert.equal((await leg(page)).phase,'interlude');await skip(page);
 assert.equal((await leg(page)).phase,'choice');await page.locator(`[data-story-choice="${choice}"]`).click();assert.equal(await page.evaluate(()=>__game.campaignState.phase),'reply');await skip(page);
 assert.equal((await leg(page)).phase,'closing');await skip(page);await page.locator('#chapterContinue').waitFor({state:'visible',...WAIT});
}
async function press(page,index){await page.evaluate(i=>{__pad.buttons[i]={pressed:true,value:1};},index);await page.waitForFunction(i=>__game.oldButtons[i]===true,index,WAIT);await page.evaluate(i=>{__pad.buttons[i]={pressed:false,value:0};},index);await page.waitForFunction(i=>__game.oldButtons[i]===false,index,WAIT);}

test('story ships twelve substantial chapters, thirty-six varied missions and two complete endings',async()=>{
 const {CAMPAIGN,CAMPAIGN_INTRO,CAMPAIGN_ENDINGS}=await import('../story.js');const {CampaignEngine}=await import('../campaign-engine.js');const {UPGRADES}=await import('../content.js');
 assert.equal(CAMPAIGN.length,12);assert.equal(CampaignEngine.plans.length,12);assert.equal(CampaignEngine.plans.flat().length,36);assert.ok(new Set(CampaignEngine.plans.flat().map(m=>m.type)).size>=7);
 const rewardIDs=new Set(UPGRADES.map(u=>u.id));let storyText=CAMPAIGN_INTRO.map(l=>l.text).join('');
 for(const [i,c] of CAMPAIGN.entries()){assert.equal(c.id,i);assert.ok(c.title.length>0);assert.ok(c.letter.length>=100);assert.equal(c.choice.options.length,2);for(const section of ['opening','interlude','closing']){assert.ok(c[section].length>=3);for(const line of c[section]){assert.ok(line.speaker&&line.text.length>10&&line.portrait);storyText+=line.text;}}storyText+=c.letter;for(const option of c.choice.options){assert.ok(rewardIDs.has(option.reward));assert.ok(option.reply.length>=2);storyText+=option.reply.map(l=>l.text).join('');}}
 for(const name of ['hope','memory']){assert.ok(CAMPAIGN_ENDINGS[name].length>=3);storyText+=CAMPAIGN_ENDINGS[name].map(l=>l.text).join('');}
 assert.ok((storyText.match(/[\u3400-\u9fff]/g)||[]).length>=16000,'Substantial original Chinese story text is included, beyond metadata and labels');
});

test('new campaign saves exact dialogue position and restores actual mission position and collected objectives',async()=>{
 const {page,errors}=await open();await start(page);await page.locator('#storyNext').click();const scene=await page.evaluate(()=>__game.campaignState.sceneIndex);assert.equal(scene,1);
 await page.reload();await page.locator('#campaignContinueBtn').click();assert.equal(await page.evaluate(()=>__game.campaignState.sceneIndex),scene);await skip(page);await page.waitForFunction(()=>__game.mode==='playing',null,WAIT);
 const saved=await page.evaluate(()=>{const g=__game,e=g.campaignMission;e.spawnTimer=1e9;e.hazardTimer=1e9;g.enemies=[];const object=g.missionObjects.find(o=>!o.optional);g.player.x=object.x;g.player.y=object.y;for(let i=0;i<74;i++)e.update(.1);g.player.x=1100;g.player.y=600;g.pause();return{collected:e.state.collected,x:g.player.x,y:g.player.y,elapsed:e.elapsed};});assert.equal(saved.collected,1);
 await page.reload();await page.locator('#campaignContinueBtn').click();await page.waitForFunction(()=>__game.mode==='playing',null,WAIT);
 const actual=await page.evaluate(()=>({collected:__game.campaignMission.state.collected,x:__game.player.x,y:__game.player.y,elapsed:__game.campaignMission.elapsed}));assert.equal(actual.collected,1);assert.equal(actual.x,saved.x);assert.equal(actual.y,saved.y);assert.ok(actual.elapsed>=saved.elapsed);assert.deepEqual(errors,[]);
});

test('pause journal returns to pause and gameplay, and campaign choices grant a reward only once across reload',async()=>{
 const {page,errors}=await open();await start(page);await skip(page);await page.keyboard.press('Escape');await page.locator('#pauseJournal').click();await page.locator('#journalReturn').click();await page.locator('#resumeBtn').waitFor({state:'visible',...WAIT});assert.equal(await page.evaluate(()=>__game.mode),'paused');await page.locator('#resumeBtn').click();
 assert.equal((await leg(page)).phase,'interlude');await skip(page);assert.equal((await leg(page)).phase,'choice');
 const before=await page.evaluate(()=>Object.values(__game.upgradeCounts).reduce((a,b)=>a+b,0));await page.locator('[data-story-choice="1"]').click();const chosen=await page.evaluate(()=>({counts:__game.upgradeCounts,choice:__game.campaignState.choices[0],total:Object.values(__game.upgradeCounts).reduce((a,b)=>a+b,0)}));assert.equal(chosen.choice,1);assert.equal(chosen.total,before+1);
 await page.reload();await page.locator('#campaignContinueBtn').click();assert.equal(await page.evaluate(()=>__game.campaignState.phase),'reply');assert.deepEqual(await page.evaluate(()=>__game.upgradeCounts),chosen.counts);await skip(page);assert.equal(await page.evaluate(()=>__game.campaignMission.leg),2);assert.deepEqual(await page.evaluate(()=>__game.upgradeCounts),chosen.counts);assert.deepEqual(errors,[]);
});

test('all twelve chapters complete their three objectives, open the map sequentially and reach a persisted ending',async()=>{
 const {page,errors}=await open();await start(page);await skip(page);
 for(let chapter=0;chapter<12;chapter++){
  assert.equal(await page.evaluate(()=>__game.campaignState.chapter),chapter);await advanceChapter(page,chapter%2);assert.equal(await page.evaluate(()=>__game.campaignState.completed.length),chapter+1);await page.locator('#chapterContinue').click();
  if(chapter<11){assert.equal(await page.locator('[data-chapter]').count(),12);assert.equal(await page.locator(`[data-chapter="${chapter+1}"]`).isEnabled(),true);if(chapter<10)assert.equal(await page.locator(`[data-chapter="${chapter+2}"]`).isEnabled(),false);await page.locator(`[data-chapter="${chapter+1}"]`).click();await skip(page);}
 }
 assert.equal(await page.evaluate(()=>__game.campaignState.phase),'ending');await skip(page);await page.waitForFunction(()=>__game.mode==='campaignWon',null,WAIT);
 const final=await page.evaluate(()=>({state:__game.campaignState,save:JSON.parse(localStorage.getItem('tidekeeper-story-v2'))}));assert.equal(final.state.completed.length,12);assert.equal(Object.keys(final.state.choices).length,12);assert.equal(final.save.phase,'won');assert.equal(final.save.completed.length,12);
 await page.locator('#endingJournal').click();await page.locator('#journalReturn').click();assert.equal(await page.evaluate(()=>__game.mode),'campaignWon');assert.equal(await page.evaluate(()=>__game.campaignState.completed.length),12);await page.locator('#campaignPort').click();await page.locator('#campaignContinueBtn').waitFor({state:'visible',...WAIT});assert.match(await page.locator('#campaignContinueBtn').innerText(),/重读/);await page.locator('#campaignContinueBtn').click();await page.waitForFunction(()=>__game.mode==='campaignWon',null,WAIT);assert.equal(await page.evaluate(()=>__game.campaignState.completed.length),12);assert.deepEqual(errors,[]);
});

test('objective failure and player death retry only the current mission, preserving completed chapters and choices',async()=>{
 const {page,errors}=await open();await start(page);await skip(page);await advanceChapter(page,0);await page.locator('#chapterContinue').click();await page.locator('[data-chapter="1"]').click();await skip(page);
 const prior=await page.evaluate(()=>({chapter:__game.campaignState.chapter,completed:__game.campaignState.completed,choices:__game.campaignState.choices}));
 await page.evaluate(()=>{const g=__game,e=g.campaignMission,o=g.missionObjects.find(o=>o.type==='convoy');e.elapsed=4;o.hp=1;o.hitCD=0;const enemy=e.spawn('brute','wave',{x:o.x,y:o.y});enemy.x=o.x;enemy.y=o.y;enemy.age=5;e.update(.1);});
 await page.locator('#campaignRetry').waitFor({state:'visible',...WAIT});assert.equal(await page.evaluate(()=>__game.mode),'missionFailed');await page.locator('#campaignPort').click();await page.locator('#campaignContinueBtn').click();await page.locator('#campaignRetry').waitFor({state:'visible',...WAIT});await page.locator('#campaignRetry').click();await page.waitForFunction(()=>__game.mode==='playing',null,WAIT);assert.equal(await page.evaluate(()=>__game.campaignMission.transitioning),false);assert.ok(await page.evaluate(()=>__game.missionObjects.find(o=>o.type==='convoy').hp>1));
 await page.evaluate(()=>{__game.player.hp=1;__game.player.invuln=0;__game.hurt(1000);});await page.locator('#campaignRetry').waitFor({state:'visible',...WAIT});await page.locator('#campaignRetry').click();assert.equal(await page.evaluate(()=>__game.mode),'playing');
 const after=await page.evaluate(()=>({chapter:__game.campaignState.chapter,completed:__game.campaignState.completed,choices:__game.campaignState.choices}));assert.deepEqual(after,prior);assert.ok(await page.evaluate(()=>__game.player.hp===__game.player.maxHp));assert.deepEqual(errors,[]);
});

test('quick voyage and story campaign use independent checkpoints',async()=>{
 const {page,errors}=await open();await page.locator('#startBtn').click();while(await page.locator('#nextDialogue').isVisible())await page.locator('#nextDialogue').click();await page.evaluate(()=>{__game.player.x=1120;__game.player.y=600;__game.score=4321;__game.pause();});const quick=await page.evaluate(()=>localStorage.getItem('tidekeeper-voyage-v1'));await page.locator('#quitBtn').click();
 await start(page);await page.locator('#storyNext').click();await page.evaluate(()=>__game.toMenu());assert.equal(await page.evaluate(()=>localStorage.getItem('tidekeeper-voyage-v1')),quick);const story=await page.evaluate(()=>localStorage.getItem('tidekeeper-story-v2'));
 await page.locator('#continueBtn').click();assert.equal(await page.evaluate(()=>__game.campaignActive),false);assert.equal(await page.evaluate(()=>__game.score),4321);assert.equal(await page.evaluate(()=>localStorage.getItem('tidekeeper-story-v2')),story);await page.keyboard.press('Escape');await page.locator('#quitBtn').click();await page.locator('#campaignContinueBtn').click();assert.equal(await page.evaluate(()=>__game.campaignActive),true);assert.equal(await page.evaluate(()=>__game.campaignState.sceneIndex),1);assert.deepEqual(errors,[]);
});

test('standard gamepad advances a single story line, moves the ship, pauses, and returns from the journal',async()=>{
 const {page,errors}=await open(true);await page.locator('#campaignStartBtn').focus();await press(page,0);await page.locator('#storyNext').waitFor({state:'visible',...WAIT});await page.waitForFunction(()=>document.activeElement?.id==='storyNext',null,WAIT);await press(page,0);assert.equal(await page.evaluate(()=>__game.campaignState.sceneIndex),1);assert.equal(await page.evaluate(()=>__game.mode),'dialog');
 await skip(page);const x=await page.evaluate(()=>__game.player.x);await page.evaluate(()=>__pad.axes[0]=.85);await page.waitForFunction(x=>__game.player.x>x+15,x,WAIT);await page.evaluate(()=>__pad.axes[0]=0);await press(page,9);await page.locator('#resumeBtn').waitFor({state:'visible',...WAIT});await page.waitForFunction(()=>document.activeElement?.id==='resumeBtn',null,WAIT);await press(page,13);assert.equal(await page.evaluate(()=>document.activeElement?.id),'pauseJournal');await press(page,0);await page.locator('#journalReturn').waitFor({state:'visible',...WAIT});await press(page,1);await page.locator('#resumeBtn').waitFor({state:'visible',...WAIT});await press(page,9);await page.waitForFunction(()=>__game.mode==='playing',null,WAIT);assert.deepEqual(errors,[]);
});


test('story dialogue can pause, resume and save to port without losing its current line',async()=>{
 const {page,errors}=await open();await start(page);await page.locator('#storyNext').click();const index=await page.evaluate(()=>__game.campaignState.sceneIndex);
 await page.keyboard.press('Escape');await page.waitForFunction(()=>__game.mode==='paused',null,WAIT);await page.locator('#resumeBtn').click();await page.waitForFunction(()=>__game.mode==='dialog',null,WAIT);assert.equal(await page.evaluate(()=>__game.campaignState.sceneIndex),index);
 await page.keyboard.press('Escape');await page.locator('#campaignPort').click();await page.locator('#campaignContinueBtn').click();await page.waitForFunction(()=>__game.mode==='dialog',null,WAIT);assert.equal(await page.evaluate(()=>__game.campaignState.sceneIndex),index);assert.deepEqual(errors,[]);
});

test('new-story confirmation preserves an existing journey until replacement is explicitly chosen',async()=>{
 const {page,errors}=await open();await start(page);await page.locator('#storyNext').click();
 await page.keyboard.press('Escape');await page.locator('#campaignPort').click();const originalSave=await page.evaluate(key=>localStorage.getItem(key),KEY);
 await page.locator('#campaignStartBtn').click();await page.locator('#keepStory').waitFor({state:'visible',...WAIT});assert.equal(await page.evaluate(()=>__game.mode),'menu');assert.equal(await page.locator('#replaceStory').isVisible(),true);assert.equal(await page.locator('#cancelStory').isVisible(),true);assert.equal(await page.evaluate(key=>localStorage.getItem(key),KEY),originalSave);
 await page.locator('#cancelStory').click();assert.equal(await page.locator('#modal').isVisible(),false);assert.equal(await page.evaluate(key=>localStorage.getItem(key),KEY),originalSave,'Cancel leaves the current story byte-for-byte intact');
 await page.locator('#campaignStartBtn').click();await page.locator('#keepStory').click();await page.waitForFunction(()=>__game.mode==='dialog',null,WAIT);assert.equal(await page.evaluate(()=>__game.campaignState.sceneIndex),1,'Continue resumes the saved line rather than starting over');
 // Build a nonempty, legitimately progressed save before checking destructive replacement.
 await skip(page);await advanceChapter(page,1);await page.locator('#chapterContinue').click();await page.locator('[data-chapter="1"]').click();await page.locator('#storyNext').click();await page.keyboard.press('Escape');await page.locator('#campaignPort').click();
 const advancedSave=await page.evaluate(key=>localStorage.getItem(key),KEY),advanced=JSON.parse(advancedSave);assert.equal(advanced.chapter,1);assert.equal(advanced.choices[0],1);assert.deepEqual(advanced.completed,[0]);
 await page.locator('#campaignStartBtn').click();await page.locator('#replaceStory').waitFor({state:'visible',...WAIT});assert.equal(await page.evaluate(key=>localStorage.getItem(key),KEY),advancedSave,'Merely opening replacement confirmation cannot reset chapters or choices');
 await page.locator('#replaceStory').click();await page.locator('#storyNext').waitFor({state:'visible',...WAIT});const replacement=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);assert.equal(replacement.chapter,0);assert.equal(replacement.sceneIndex,0);assert.deepEqual(replacement.choices,{});assert.deepEqual(replacement.completed,[]);assert.notEqual(JSON.stringify(replacement),advancedSave);assert.deepEqual(errors,[]);
});

test('memory-leaning ending checkpoint selects the memory dialogue and reaches the saved ending through UI',async()=>{
 const {CAMPAIGN_ENDINGS}=await import('../story.js');const {page,errors}=await open();await start(page);await skip(page);
 // Branch fixture only: reuse a real saved vessel, then supply a valid ending checkpoint.
 // Full thirty-six-mission traversal is covered separately; this does not establish natural playtime.
 await page.evaluate(key=>{__game.pause();const checkpoint=JSON.parse(localStorage.getItem(key));checkpoint.chapter=11;checkpoint.phase='ending';checkpoint.sceneIndex=0;checkpoint.completed=Array.from({length:12},(_,i)=>i);checkpoint.choices=Object.fromEntries(Array.from({length:12},(_,i)=>[i,1]));checkpoint.mission=null;checkpoint.legStart=null;localStorage.setItem(key,JSON.stringify(checkpoint));},KEY);
 await page.reload();await page.locator('#campaignContinueBtn').click();await page.locator('#storyNext').waitFor({state:'visible',...WAIT});assert.equal(await page.evaluate(()=>__game.campaignState.phase),'ending');assert.equal(await page.locator('.dialogue-text').innerText(),CAMPAIGN_ENDINGS.memory[0].text);assert.notEqual(await page.locator('.dialogue-text').innerText(),CAMPAIGN_ENDINGS.hope[0].text);
 await page.locator('#storyNext').click();assert.equal(await page.evaluate(()=>__game.campaignState.sceneIndex),1);assert.equal(await page.locator('.dialogue-text').innerText(),CAMPAIGN_ENDINGS.memory[1].text);await skip(page);await page.waitForFunction(()=>__game.mode==='campaignWon',null,WAIT);
 const completed=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);assert.equal(completed.phase,'won');assert.equal(completed.completed.length,12);assert.equal(Object.values(completed.choices).filter(choice=>choice===1).length,12);assert.equal(await page.locator('#endingJournal').isVisible(),true);assert.deepEqual(errors,[]);
});
