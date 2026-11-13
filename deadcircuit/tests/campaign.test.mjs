import {test,before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {Game} from '../game.js';
import {CAMPAIGN,INTRO,ENDINGS} from '../story.js';
import {WEAPONS} from '../armory.js';
import {updateEnemies} from '../ai.js';
import {browserPath} from '../../scripts/browser.mjs';

// These are explicit state and branch fixtures. They place actors, clear enemies,
// invoke real interactions and deliver escorts. They do not establish play time,
// shooting balance, pathfinding success or natural completion of the campaign.
const KEY='dead-circuit-campaign-v1',AXES=['public','care','contain'];
class MemoryStorage{
 constructor(){this.data=new Map();}
 getItem(key){return this.data.get(String(key))??null;}
 setItem(key,value){this.data.set(String(key),String(value));}
 removeItem(key){this.data.delete(String(key));}
 clear(){this.data.clear();}
}
const previousStorage=globalThis.localStorage;
const storage=new MemoryStorage();globalThis.localStorage=storage;
const finished=new Map(),contexts=new Set(),{chromium}=createRequire(import.meta.url)('playwright');
let browser,server,BASE=process.env.TEST_URL;
const WAIT={timeout:10000};
before(async()=>{
 assert.equal(CAMPAIGN.length,18,'All eighteen authored chapters must exist before campaign validation');
 if(!BASE){
  server=spawn(process.execPath,[fileURLToPath(new URL('../../server.mjs',import.meta.url))],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  BASE=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Campaign test server timed out')),10000);server.once('error',reject);server.once('exit',code=>{clearTimeout(timer);reject(Error('Campaign test server exited '+code));});server.stdout.on('data',chunk=>{const match=String(chunk).match(/port (\d+)/);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1]);}});});
 }
 browser=await chromium.launch({executablePath:browserPath(chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
});
afterEach(async()=>{await Promise.all([...contexts].map(c=>c.close().catch(()=>{})));contexts.clear();});
after(async()=>{await browser?.close();server?.kill();if(previousStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=previousStorage;});

function game(){
 const g=new Game(null),views=[];
 g.ui={render(mode){views.push({mode});},dialogue(lines,index,choice){views.push({mode:'dialogue',line:lines[index]?.text,choice:!!choice});},toast(){},update(){}};
 g.testViews=views;return g;
}
function quiet(g){g.enemies=[];g.bullets=[];g.effects=[];}
function inventoryCount(g){return Object.values(g.profile.ownedAttachments).reduce((sum,n)=>sum+Number(n),0);}
function reload(g){g.save();const resumed=game();resumed.continueGame();return resumed;}
function newCampaign(){storage.clear();const g=game();g.startNew('standard');assert.equal(g.campaign.phase,'intro');assert.deepEqual(g.sceneLines(),INTRO);g.skipDialogue();assert.equal(g.mode,'briefing');return g;}
function start(g,id=0){g.startMission(id);assert.equal(g.campaign.phase,'opening');assert.ok(g.sceneLines().length>0);g.skipDialogue();assert.equal(g.mode,'playing');assert.equal(g.campaign.stage,0);quiet(g);}
function choose(g,axis,{withReload=false}={}){
 assert.equal(g.campaign.phase,'interlude');g.skipDialogue();assert.equal(g.campaign.phase,'choice');assert.equal(g.mode,'dialogue');
 // The skip affordance is forbidden from bypassing a required decision.
 g.skipDialogue();assert.equal(g.campaign.phase,'choice');
 if(withReload){g=reload(g);assert.equal(g.campaign.phase,'choice');}
 const chapter=CAMPAIGN[g.campaign.mission],index=Math.max(0,chapter.choice.options.findIndex(o=>(o.axis||o.flag)===axis)),before=inventoryCount(g),mission=g.campaign.mission;
 g.advanceDialogue(index);assert.equal(g.campaign.phase,'reply');assert.equal(g.campaign.choices[mission],index);assert.equal(inventoryCount(g),before+1,'One decision grants precisely one attachment');
 const flags=JSON.parse(JSON.stringify(g.campaign.flags));
 if(withReload){g=reload(g);assert.equal(g.campaign.phase,'reply');assert.equal(g.campaign.choices[mission],index);assert.equal(inventoryCount(g),before+1);}
 // An obsolete confirm after a reload cannot award the branch reward twice.
 g.advanceDialogue(index);assert.equal(inventoryCount(g),before+1);assert.deepEqual(g.campaign.flags,flags);
 if(g.mode==='dialogue')g.skipDialogue();assert.equal(g.mode,'playing');assert.equal(g.campaign.phase,'playing');quiet(g);return g;
}
function interactStage(g){
 const stage=g.currentObjective();assert.ok(stage,'A real current objective exists');const index=g.campaign.stage;
 for(const id of stage.targets){
  const object=g.level.objects.find(o=>o.id===id);assert.ok(object,`Target ${id} exists`);assert.equal(object.active!==false,true,`Target ${id} is active`);
  for(const prerequisite of object.requires||[])assert.equal(g.completedObjectIds.has(prerequisite),true,`${id} has satisfied prerequisite ${prerequisite}`);
  g.player.x=object.x;g.player.y=object.y;g.interactObject(object);assert.equal(g.completedObjectIds.has(id),true);
 }
 if(stage.requiredKills){g.missionKills=(g.stageStartKills||0)+stage.requiredKills;g.checkObjective();}
 assert.equal(g.campaign.stage,index+1,'Finishing the whole stage advances exactly one milestone');
 assert.equal(g.checkpoint.mission,g.campaign.mission);assert.equal(g.checkpoint.stage,g.campaign.stage);
 for(const id of stage.targets)assert.ok(g.checkpoint.completedObjectIds.includes(id),'Checkpoint preserves completed target '+id);
 return {stage:index,targets:[...stage.targets]};
}
function finishMission(g){
 assert.equal(g.extractionReady,true);const exit=g.level.exit;
 for(const object of g.level.objects)if(object.following){object.x=exit.x-20;object.y=exit.y;}
 g.player.x=exit.x;g.player.y=exit.y;g.updateObjects(0);
 assert.ok(g.level.objects.filter(o=>o.following).every(o=>o.delivered),'Every rescued escort reaches the real extraction condition');
 g.controls={interact:false};g.updateInteraction(.01);g.controls={interact:true};g.updateInteraction(1.1);
 assert.equal(g.campaign.phase,'closing');assert.equal(g.mode,'dialogue');assert.ok(g.campaign.completed.includes(g.campaign.mission));
 g.skipDialogue();assert.equal(g.campaign.phase,'letter');assert.equal(g.sceneLines()[0].text,CAMPAIGN[g.campaign.mission].letter);
 g.skipDialogue();assert.equal(g.mode,'missionComplete');assert.equal(g.campaign.phase,'complete');
 const rewardState=JSON.stringify(g.profile);g.completeMission();assert.equal(JSON.stringify(g.profile),rewardState,'Re-entering completion does not grant mission rewards twice');
}
function runCampaign(axis){
 let g=newCampaign();const milestones=[];
 for(let mission=0;mission<18;mission++){
  assert.equal(g.mode,'briefing');assert.equal(g.campaign.mission,mission);start(g,mission);const visited=[];
  while(g.currentObjective()){
   visited.push(interactStage(g));
   if(g.campaign.phase==='interlude')g=choose(g,axis,{withReload:true});
   quiet(g);
  }
  assert.ok(visited.length>=3,`Mission ${mission+1} has several actual objectives`);assert.equal(g.campaign.choices[mission]===0||g.campaign.choices[mission]===1,true);
  finishMission(g);milestones.push({mission,stages:visited});g.nextMission();
 }
 assert.equal(g.campaign.phase,'ending');assert.equal(g.determineEnding(),axis);assert.deepEqual(g.sceneLines(),ENDINGS[axis]);
 g.skipDialogue();assert.equal(g.campaign.phase,'won');assert.equal(g.mode,'ending');assert.equal(g.campaign.completed.length,18);assert.equal(Object.keys(g.campaign.choices).length,18);assert.equal(g.profile.ownedWeapons.length,WEAPONS.length);
 assert.equal(AXES.reduce((sum,key)=>sum+(Number(g.campaign.flags[key])||0),0),18,'Each mission contributes exactly one ending-axis decision');
 assert.equal(g.campaign.totalPlay,0,'Accelerated branch fixtures must not claim natural playing time');
 g.save();const saved=storage.getItem(KEY);finished.set(axis,{saved,milestones});return {g,saved,milestones};
}

for(const axis of AXES)test(`all eighteen missions and choices reach the ${axis} ending through the real campaign transitions`,()=>{
 const {g,milestones}=runCampaign(axis);assert.equal(milestones.length,18);assert.ok(milestones.every(m=>m.stages.every(s=>s.targets.length>0)));
 const resumed=reload(g);assert.equal(resumed.mode,'ending');assert.equal(resumed.campaign.phase,'won');assert.equal(resumed.endingKey,axis);assert.equal(resumed.campaign.completed.length,18);
});

test('a mid-mission save restores the actual milestone, doors, chosen reward, ammunition and operative state',()=>{
 let g=newCampaign();start(g,0);interactStage(g);g=choose(g,'public',{withReload:true});
 const rewardCount=inventoryCount(g),completed=[...g.completedObjectIds],doors=g.level.doors.map(d=>({id:d.id,open:d.open,locked:d.locked}));
 g.player.x=g.level.spawn.x;g.player.y=g.level.spawn.y;g.player.hp=72;g.player.armor=14;g.player.stamina=56;g.player.angle=1.2;g.player.weaponIndex=1;g.profile.ammo[g.weapon]={mag:7,reserve:11};
 const expected={mission:g.campaign.mission,stage:g.campaign.stage,x:g.player.x,y:g.player.y};g=reload(g);
 assert.equal(g.mode,'playing');assert.equal(g.campaign.stage,expected.stage);assert.equal(g.player.x,expected.x);assert.equal(g.player.y,expected.y);assert.equal(g.player.hp,72);assert.equal(g.player.armor,14);assert.equal(g.player.weaponIndex,1);assert.deepEqual(g.profile.ammo[g.weapon],{mag:7,reserve:11});assert.deepEqual([...g.completedObjectIds],completed);assert.deepEqual(g.level.doors.map(d=>({id:d.id,open:d.open,locked:d.locked})),doors);assert.equal(inventoryCount(g),rewardCount);
 g.player.invulnerable=0;g.damageActor(g.player,10000,{x:g.player.x+40,y:g.player.y,faction:'infected'});assert.equal(g.mode,'dead');assert.equal(g.campaign.phase,'dead');assert.equal(g.campaign.deaths,1);
 g=reload(g);assert.equal(g.mode,'dead');g.retry();assert.equal(g.mode,'playing');assert.equal(g.campaign.stage,expected.stage);assert.ok(g.player.hp>=65);assert.equal(g.player.dead,false);assert.equal(g.campaign.deaths,1);assert.equal(inventoryCount(g),rewardCount);assert.ok(g.profile.ammo[g.weapon].reserve>=g.weaponStats().mag*2);
});

test('escorts must reach extraction and their failure restores a usable mission checkpoint',()=>{
 let g=newCampaign();start(g,2);let escort;
 while(!escort&&g.currentObjective()){
  const stage=g.currentObjective();
  for(const id of stage.targets){const o=g.level.objects.find(x=>x.id===id);g.interactObject(o);if(o.following){escort=o;break;}}
  if(g.campaign.phase==='interlude')g=choose(g,'care');quiet(g);
 }
 assert.ok(escort,'Hospital campaign contains a real escorted patient');const checkpointStage=g.checkpoint.stage,patientId=escort.id,checkpointPatient=g.checkpoint.objects.find(o=>o.id===patientId);
 escort.hp=0;g.updateObjects(0);assert.equal(g.mode,'dead');assert.equal(g.campaign.deaths,1);g=reload(g);assert.equal(g.mode,'dead');g.retry();assert.equal(g.mode,'playing');assert.equal(g.campaign.stage,checkpointStage);assert.equal(g.campaign.deaths,1);
 const patient=g.level.objects.find(o=>o.id===patientId);assert.ok(patient);assert.equal(patient.completed,checkpointPatient.completed,'Retry restores the rescue milestone actually present in the checkpoint');assert.equal(patient.following,checkpointPatient.following);assert.equal(patient.active,true);assert.ok(patient.hp===undefined||patient.hp>0,'The checkpoint cannot retain a failed escort as permanently dead');
 while(g.currentObjective()){interactStage(g);if(g.campaign.phase==='interlude')g=choose(g,'care');quiet(g);}
 assert.ok(g.level.objects.some(o=>o.following&&!o.delivered));g.player.x=g.level.exit.x;g.player.y=g.level.exit.y;g.controls={interact:true};g.updateInteraction(1.1);assert.equal(g.mode,'playing');assert.equal(g.campaign.completed.includes(2),false,'Leaving a rescued escort behind cannot finish the mission');
 finishMission(g);assert.equal(g.mode,'missionComplete');
});

test('retry repairs critically injured and zero-health escort checkpoints into a usable rescue',()=>{
 for(const checkpointHealth of [1,0]){
  let g=newCampaign();start(g,0);const npc=g.level.objects.find(o=>o.optional&&o.type==='rescue');assert.ok(npc,'The first location has a real optional rescue');g.interactObject(npc);assert.equal(npc.following,true);
  npc.hp=checkpointHealth;g.checkpoint=g.makeSnapshot();const id=npc.id,stage=g.campaign.stage;
  g.player.hp=0;g.player.dead=true;g.campaign.phase='dead';g.mode='dead';g=reload(g);assert.equal(g.mode,'dead');assert.equal(g.checkpoint.objects.find(o=>o.id===id).hp,checkpointHealth);
  g.retry();const rescued=g.level.objects.find(o=>o.id===id);assert.equal(g.mode,'playing');assert.equal(g.campaign.stage,stage);assert.equal(rescued.following,true);assert.equal(rescued.dead,false);assert.ok(rescued.hp>=rescued.maxHp*.7,`An escort saved at ${checkpointHealth} HP receives the retry health floor`);assert.ok(g.completedObjectIds.has(id),'Retry preserves the rescue already completed');
  g.updateObjects(0);assert.equal(g.mode,'playing','The next object update must not immediately fail the mission again');
  rescued.x=g.level.exit.x;rescued.y=g.level.exit.y;g.player.x=g.level.exit.x;g.player.y=g.level.exit.y;g.updateObjects(0);assert.equal(rescued.delivered,true,'The recovered escort can still satisfy extraction');assert.equal(g.mode,'playing');
 }
});

test('save and restore preserve reinforcement limits, spent radio calls, depleted medic charges and reload progress after AI initialization',()=>{
 let g=newCampaign();start(g,0);const radio=g.spawnEnemy({id:'snapshot-radio',type:'radio',x:g.level.spawn.x+140,y:g.level.spawn.y+90}),medic=g.spawnEnemy({id:'snapshot-medic',type:'medic',x:g.level.spawn.x+240,y:g.level.spawn.y+90});
 const tick=1/60;updateEnemies(g,tick);assert.ok(radio.ai&&medic.ai,'The real AI initializer supplies the initial role state');radio.ai.radioCalls=1;medic.ai.healCharges=0;radio.reloadTime=1.4;medic.reloadTime=.7;g.aiDirector={reinforcements:2};g.save();
 const serialized=JSON.parse(storage.getItem(KEY)).current;assert.equal(serialized.aiReinforcements,2);assert.equal(serialized.enemies.find(e=>e.id===radio.id).radioCalls,1);assert.equal(serialized.enemies.find(e=>e.id===medic.id).healCharges,0);assert.equal(serialized.enemies.find(e=>e.id===radio.id).reloadTime,1.4);
 let expectedRadio=1.4,expectedMedic=.7;
 for(let round=0;round<2;round++){
  g=reload(g);assert.equal(g.aiDirector.reinforcements,2,'Refreshing cannot replenish the mission reinforcement budget');const r=g.enemies.find(e=>e.id==='snapshot-radio'),m=g.enemies.find(e=>e.id==='snapshot-medic');assert.ok(r&&m);assert.equal(r.reloadTime,expectedRadio);assert.equal(m.reloadTime,expectedMedic);
  updateEnemies(g,tick);expectedRadio-=tick;expectedMedic-=tick;assert.equal(r.ai.radioCalls,1,'A radio operator that already called remains spent after lazy AI initialization');assert.equal(m.ai.healCharges,0,'A medic with no charges does not receive two fresh heals');assert.equal(g.aiDirector.reinforcements,2);assert.equal(r.reloadTime,expectedRadio);assert.equal(m.reloadTime,expectedMedic);g.save();
 }
});

for(const axis of AXES)test(`the saved ${axis} ending and its selected replies remain complete in the real archive UI`,async()=>{
 const fixture=finished.get(axis)||runCampaign(axis),saved=JSON.parse(fixture.saved);
 const context=await browser.newContext({viewport:{width:1280,height:800}});contexts.add(context);
 await context.addInitScript(({key,saved})=>{localStorage.setItem(key,saved);localStorage.setItem('dead-circuit-settings-v1',JSON.stringify({mute:true,reducedMotion:true,reduced:true}));},{key:KEY,saved:fixture.saved});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(BASE+'/deadcircuit/index.html?test=1');await page.locator('#continueBtn').waitFor(WAIT);await page.locator('#continueBtn').click();await page.waitForFunction(()=>__dc.mode==='ending',null,WAIT);assert.equal(await page.evaluate(()=>__dc.endingKey),axis);
 await page.locator('#endingJournal').click();await page.locator('.journal-content details summary').click();
 const lines=await page.locator('.journal-content details p').allTextContents(),ending=ENDINGS[axis].map(l=>l.speaker+'　'+l.text);
 assert.deepEqual(lines.slice(-ending.length),ending,'The earned ending follows the last chapter, not a different branch');
 const last=CAMPAIGN[17],choice=saved.campaign.choices[17],reply=last.choice.options[choice].reply.map(l=>l.speaker+'　'+l.text);for(const line of reply)assert.ok(lines.includes(line),'The chosen final reply is archived');
 await page.locator('[data-journal="0"]').click();const details=page.locator('.journal-content details');await details.locator('summary').click();const first=await details.locator('p').allTextContents();assert.deepEqual(first.slice(0,INTRO.length),INTRO.map(l=>l.speaker+'　'+l.text),'The introduction precedes chapter one');
 await page.locator('#journalBack').click();assert.equal(await page.evaluate(()=>__dc.mode),'ending');await page.reload();await page.locator('#continueBtn').click();assert.equal(await page.evaluate(()=>__dc.campaign.phase),'won');assert.deepEqual(errors,[]);
});

test('collected field documents survive reading and chapter completion without revealing uncollected documents or entering dialogue order',async()=>{
 const context=await browser.newContext({viewport:{width:320,height:640}});contexts.add(context);
 await context.addInitScript(()=>localStorage.setItem('dead-circuit-settings-v1',JSON.stringify({mute:true,reducedMotion:true,reduced:true})));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(BASE+'/deadcircuit/index.html?test=1');await page.locator('#newGameBtn').click();await page.locator('#dialogueSkip').click();await page.locator('#startMissionBtn').click();await page.locator('#dialogueSkip').click();
 const notes=await page.evaluate(async()=>{
  const {CAMPAIGN}=await import('/deadcircuit/story.js');
  __dc.enemies=[];__dc.bullets=[];
  return __dc.level.objects.filter(o=>Number.isInteger(o.fieldNote)).map(o=>({id:o.id,...CAMPAIGN[0].fieldNotes[o.fieldNote]}));
 });
 assert.equal(notes.length,2,'The first location contains two independently collectible documents');
 await page.locator('#hudJournal').click();await page.locator('#journalNotesTab').click();assert.equal(await page.locator('.field-note-card').count(),0);assert.equal(await page.locator('#fieldNotesEmpty').count(),1);
 for(const note of notes)assert.equal((await page.locator('.journal-content').innerText()).includes(note.title),false,'The archive cannot reveal an uncollected title');
 await page.locator('#journalBack').click();
 // Interaction and later mission completion are explicit state fixtures. The UI,
 // reading/save transitions and reload use the real game, not a fabricated archive.
 await page.evaluate(id=>{const g=__dc,o=g.level.objects.find(o=>o.id===id);g.player.x=o.x;g.player.y=o.y;g.interactObject(o);},notes[0].id);
 await page.waitForFunction(()=>__dc.campaign.phase==='fieldnote',null,WAIT);assert.equal(await page.locator('#dialogueText').innerText(),notes[0].text);
 await page.reload();await page.locator('#continueBtn').click();assert.equal(await page.evaluate(()=>__dc.campaign.phase),'fieldnote');assert.equal(await page.locator('#dialogueText').innerText(),notes[0].text);
 await page.locator('#dialogueSkip').click();await page.waitForFunction(()=>__dc.mode==='playing',null,WAIT);await page.locator('#hudJournal').click();await page.locator('#journalNotesTab').click();
 assert.equal(await page.locator('.field-note-card').count(),1);assert.equal(await page.locator('.field-note-card h4').innerText(),notes[0].title);assert.equal(await page.locator('.field-note-card p').innerText(),notes[0].text);assert.equal((await page.locator('.journal-content').innerText()).includes(notes[1].text),false);
 await page.locator('#journalStoryTab').click();await page.locator('.journal-content details summary').click();assert.equal((await page.locator('.journal-content details').innerText()).includes(notes[0].text),false,'Documents do not change the authored dialogue order');
 await page.locator('#journalRadioTab').click();assert.equal((await page.locator('.journal-content').innerText()).includes(notes[0].text),false,'Documents have their own archive, not a duplicated radio entry');
 await page.locator('#journalBack').click();
 const completed=await page.evaluate(()=>{
  const g=__dc;let guard=0;
  while(g.currentObjective()&&guard++<20){
   g.enemies=[];g.bullets=[];
   if(g.mode==='dialogue'){if(g.campaign.phase==='choice')g.advanceDialogue(0);else g.skipDialogue();continue;}
   const objective=g.currentObjective();for(const id of objective.targets){const o=g.level.objects.find(o=>o.id===id);g.interactObject(o);}
  }
  while(g.mode==='dialogue'){if(g.campaign.phase==='choice')g.advanceDialogue(0);else g.skipDialogue();}
  const exit=g.level.exit;for(const o of g.level.objects)if(o.following){o.x=exit.x;o.y=exit.y;}g.player.x=exit.x;g.player.y=exit.y;g.updateObjects(0);g.enemies=[];g.controls={interact:false};g.updateInteraction(.01);g.controls={interact:true};g.updateInteraction(1.1);
  return{phase:g.campaign.phase,completed:g.campaign.completed,notes:g.campaign.fieldNotes.length};
 });
 assert.equal(completed.phase,'closing');assert.deepEqual(completed.completed,[0]);assert.equal(completed.notes,1);
 await page.locator('#dialogueSkip').click();await page.locator('#dialogueSkip').click();await page.locator('#nextMissionBtn').click();await page.locator('#briefJournal').click();await page.locator('#journalNotesTab').click();await page.locator('[data-journal="1"]').click();assert.equal(await page.locator('.field-note-card').count(),0,'The next chapter does not inherit another chapter’s documents');
 await page.locator('[data-journal="0"]').click();assert.equal(await page.locator('.field-note-card').count(),1);assert.equal(await page.locator('.field-note-card p').innerText(),notes[0].text);
 const widths=await page.evaluate(()=>({document:document.documentElement.scrollWidth,overlay:document.getElementById('overlay').scrollWidth}));assert.ok(widths.document<=320&&widths.overlay<=320,'The document tab remains usable at 320px');
 await page.locator('#journalBack').click();await page.locator('#briefMenu').click();await page.reload();await page.locator('#continueBtn').click();await page.locator('#briefJournal').click();await page.locator('#journalNotesTab').click();await page.locator('[data-journal="0"]').click();assert.equal(await page.locator('.field-note-card p').innerText(),notes[0].text);assert.deepEqual(errors,[]);
});
