import {LEVELS,createLevel} from './levels.js';
import {clamp,distance,circleRect,lineOfSight,moveActor,pointWalkable} from './geometry.js';
import {WEAPONS,ATTACHMENTS,weaponStats,installAttachment,removeAttachment,createArmoryProfile,grantMissionRewards,normalizeArmoryProfile} from './armory.js';
import {ENEMY_TYPES} from './enemies.js';
import {CAMPAIGN,INTRO,ENDINGS} from './story.js';
import {AudioEngine} from './audio.js';
import {updateEnemies} from './ai.js';

const SAVE_KEY='dead-circuit-campaign-v1',SETTINGS_KEY='dead-circuit-settings-v1';
const clone=x=>JSON.parse(JSON.stringify(x));
const finite=(n,fallback=0)=>Number.isFinite(n)?n:fallback;
const angleDelta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const alive=a=>a&&!a.dead&&a.hp>0;
const rectHas=(p,z)=>p.x>=z.x&&p.x<=z.x+z.w&&p.y>=z.y&&p.y<=z.y+z.h;
const enemySnapshot=e=>Object.fromEntries(['id','type','faction','x','y','r','hp','maxHp','angle','state','awareness','ammo','cooldown','searchTime','suppression','dead','disabled','patrol','stunned','stunTime','training','reloadTime'].filter(k=>e[k]!==undefined).map(k=>[k,clone(e[k])]).concat([['radioCalls',e.ai?.radioCalls??e.radioCalls??0],['healCharges',e.ai?.healCharges??e.healCharges??2]]));
function rayRect(a,b,r){let lo=0,hi=1;for(const k of ['x','y']){const n=k==='x'?'w':'h',d=b[k]-a[k];if(Math.abs(d)<1e-9){if(a[k]<r[k]||a[k]>r[k]+r[n])return null;continue;}let p=(r[k]-a[k])/d,q=(r[k]+r[n]-a[k])/d;if(p>q)[p,q]=[q,p];lo=Math.max(lo,p);hi=Math.min(hi,q);if(lo>hi)return null;}return lo;}
function rayCircle(a,b,c,r){const dx=b.x-a.x,dy=b.y-a.y,ox=a.x-c.x,oy=a.y-c.y,A=dx*dx+dy*dy;if(!A)return null;const B=2*(ox*dx+oy*dy),C=ox*ox+oy*oy-r*r,D=B*B-4*A*C;if(C<=0)return 0;if(D<0)return null;const t=(-B-Math.sqrt(D))/(2*A);return t>=0&&t<=1?t:null;}
const WORLD_METRES=.02;
// The swept segment is clipped in all three dimensions. In particular a round
// descending into a cover's TOP must collide even when its XY entry was above it.
function rayPrism3D(a,b,rect,bottom,top,radius=0){
 let near=0,far=1;const verticalRadius=radius*WORLD_METRES;
 for(const [start,delta,min,max] of [[a.x,b.x-a.x,rect.x-radius,rect.x+rect.w+radius],[a.y,b.y-a.y,rect.y-radius,rect.y+rect.h+radius],[a.height,b.height-a.height,bottom-verticalRadius,top+verticalRadius]]){
  if(Math.abs(delta)<1e-10){if(start<min||start>max)return null;continue;}
  let t1=(min-start)/delta,t2=(max-start)/delta;if(t1>t2)[t1,t2]=[t2,t1];near=Math.max(near,t1);far=Math.min(far,t2);if(near>far)return null;
 }
 return near;
}
function rayCylinder3D(a,b,actor,radius,bottom,top,bulletRadius=0){
 const dx=b.x-a.x,dy=b.y-a.y,ox=a.x-actor.x,oy=a.y-actor.y,A=dx*dx+dy*dy,C=ox*ox+oy*oy-radius*radius;
 let near=0,far=1;
 if(A<1e-10){if(C>0)return null;}else{const B=2*(ox*dx+oy*dy),D=B*B-4*A*C;if(D<0)return null;const root=Math.sqrt(D);near=Math.max(near,(-B-root)/(2*A));far=Math.min(far,(-B+root)/(2*A));if(near>far)return null;}
 const dh=b.height-a.height,pad=bulletRadius*WORLD_METRES;
 if(Math.abs(dh)<1e-10){if(a.height<bottom-pad||a.height>top+pad)return null;}
 else{let t1=(bottom-pad-a.height)/dh,t2=(top+pad-a.height)/dh;if(t1>t2)[t1,t2]=[t2,t1];near=Math.max(near,t1);far=Math.min(far,t2);if(near>far)return null;}
 return near;
}

export class Game {
 constructor(canvas){
  this.canvas=canvas;this.mode='menu';this.audio=new AudioEngine();this.settings={difficulty:'standard',mute:false,reducedMotion:false,reduced:false,screenShake:true,deadzone:.18,aimAssist:true,subtitles:true,minimap:true,largeText:false,mouseSensitivity:.0026,touchSensitivity:.0052,lookSensitivity:1,invertY:false};
  this.profile=this.freshProfile();this.campaign=this.freshCampaign();this.level=null;this.player=null;this.enemies=[];this.bullets=[];this.effects=[];this.pickups=[];this.throwables=[];this.sounds=[];this.messages=[];this.camera={x:1500,y:1000,zoom:1};this.controls={x:0,y:0};this.elapsed=0;this.totalKills=0;this.missionKills=0;this.time=0;this.saveClock=0;this.nextId=1;this.dialogueState=null;this.interactionProgress=0;this.grenadeType='frag';this.practice=false;this.resumeMode='playing';this.backMode='menu';this.storageError=false;this.actionHeld=false;this.completedObjectIds=new Set();
  try{const s=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'null');if(s&&typeof s==='object'){for(const k of ['mute','reducedMotion','screenShake','aimAssist','subtitles','largeText','minimap','reduced','invertY'])if(typeof s[k]==='boolean')this.settings[k]=s[k];if(['story','standard','tactical'].includes(s.difficulty))this.settings.difficulty=s.difficulty;if(['story','standard','tactical'].includes(s.preferredDifficulty))this.settings.preferredDifficulty=s.preferredDifficulty;if(Number.isFinite(s.deadzone))this.settings.deadzone=clamp(s.deadzone,.08,.4);for(const [key,min,max]of[['mouseSensitivity',.0005,.012],['touchSensitivity',.001,.02],['lookSensitivity',.25,3]])if(Number.isFinite(s[key]))this.settings[key]=clamp(s[key],min,max);}}catch{}
  // A detected save is not yet the resident campaign. The menu may be opened
  // and closed repeatedly without consenting to replace that saved campaign.
  this.campaignLoaded=false;this.audio.setMuted(this.settings.mute);this.loadAvailable=this.readSave()!=null;
 }
 freshProfile(){return{...createArmoryProfile(),medkits:3,grenades:{frag:3,smoke:3,flash:3},scrap:0};}
 freshCampaign(){return{mission:0,stage:0,phase:'intro',sceneIndex:0,completed:[],choices:{},flags:{},journal:[],fieldNotes:[],deaths:0,totalPlay:0,optional:0,difficulty:'standard'};}
 normalizeCampaign(raw){
  const c=this.freshCampaign();if(!raw||typeof raw!=='object')return c;
  c.mission=clamp(Math.floor(finite(raw.mission)),0,17);c.stage=clamp(Math.floor(finite(raw.stage)),0,8);c.sceneIndex=clamp(Math.floor(finite(raw.sceneIndex)),0,500);
  const phases=['intro','briefing','opening','playing','interlude','choice','reply','closing','letter','complete','ending','won','dead','fieldnote'];c.phase=phases.includes(raw.phase)?raw.phase:'briefing';
  c.completed=[...new Set((Array.isArray(raw.completed)?raw.completed:[]).filter(n=>Number.isInteger(n)&&n>=0&&n<18))];
  c.choices=Object.fromEntries(Object.entries(raw.choices&&typeof raw.choices==='object'?raw.choices:{}).filter(([k,v])=>/^(?:[0-9]|1[0-7])$/.test(k)&&(v===0||v===1)));
  c.flags=Object.fromEntries(Object.entries(raw.flags&&typeof raw.flags==='object'?raw.flags:{}).filter(([k,v])=>/^[a-zA-Z][a-zA-Z0-9]{0,60}$/.test(k)&&!['constructor','prototype'].includes(k)&&(typeof v==='boolean'||Number.isFinite(v))).map(([k,v])=>[k,typeof v==='boolean'?v:clamp(v,0,100)]));
  c.journal=(Array.isArray(raw.journal)?raw.journal:[]).filter(l=>l&&typeof l.id==='string'&&typeof l.text==='string').slice(-2500).map(l=>({id:l.id.slice(0,160),mission:clamp(Math.floor(finite(l.mission)),0,17),speaker:String(l.speaker||'行动记录').slice(0,100),text:l.text.slice(0,7000),portrait:String(l.portrait||'narrator').slice(0,40)}));
  c.fieldNotes=(Array.isArray(raw.fieldNotes)?raw.fieldNotes:[]).filter(n=>n&&typeof n.id==='string'&&typeof n.text==='string'&&Number.isInteger(n.mission)&&n.mission>=0&&n.mission<18).slice(0,36).map(n=>({id:n.id.slice(0,160),mission:n.mission,title:String(n.title||'现场文档').slice(0,100),text:n.text.slice(0,5000)}));
  c.activeFieldNote=c.fieldNotes.find(n=>n.id===raw.activeFieldNote?.id)||null;if(c.phase==='fieldnote'&&!c.activeFieldNote)c.phase='playing';
  c.deaths=clamp(finite(raw.deaths),0,100000);c.totalPlay=clamp(finite(raw.totalPlay),0,10000000);c.optional=clamp(finite(raw.optional),0,1000);c.difficulty=['story','standard','tactical'].includes(raw.difficulty)?raw.difficulty:'standard';return c;
 }
 get hasSave(){return this.loadAvailable;}
 get menuCampaign(){if(this.campaignLoaded)return this.campaign;const saved=this.readSave();return saved?this.normalizeCampaign(saved.campaign):this.campaign;}
 get menuDifficulty(){if(this.settings.preferredDifficulty)return this.settings.preferredDifficulty;if(this.campaignLoaded)return this.campaign.difficulty||this.settings.difficulty;const saved=this.readSave();return saved?this.normalizeCampaign(saved.campaign).difficulty:this.settings.difficulty;}
 get friendlies(){return(this.level?.objects||[]).filter(o=>o.following&&!o.delivered&&o.hp>0);}
 get difficulty(){return this.settings.difficulty;}
 get objectiveText(){return this.extractionReady?'抵达绿色撤离点 · 按住 F / A 互动':this.currentObjective()?.description||this.currentObjective()?.title||'选择路线，谨慎推进';}
 get weapon(){return this.profile.loadout[this.player?.weaponIndex||0];}
 get weaponState(){const id=this.weapon;return this.profile.ammo[id]||(this.profile.ammo[id]={mag:0,reserve:0});}
 weaponStats(id=this.weapon){return weaponStats(id,this.profile.fittings[id]||{});}
 setMode(mode){this.mode=mode;this.controls={x:0,y:0};this.input?.clear();this.ui?.render(mode);}
 startNew(difficulty=this.settings.difficulty){
  this.campaignLoaded=true;this.journalCampaign=null;this.practice=false;this.profile=this.freshProfile();this.campaign=this.freshCampaign();this.setDifficulty(difficulty);this.campaign.difficulty=this.settings.difficulty;this.level=null;this.checkpoint=null;this.totalKills=0;this.playPhase('intro');
 }
 setDifficulty(id,{remember=true}={}){if(['story','standard','tactical'].includes(id)){this.settings.difficulty=id;if(this.campaignLoaded)this.campaign.difficulty=id;if(remember)this.settings.preferredDifficulty=id;this.saveSettings();}}
 setSetting(key,value){if(['mute','reducedMotion','screenShake','aimAssist','subtitles','largeText','minimap','reduced','invertY'].includes(key))this.settings[key]=!!value;else if(key==='deadzone')this.settings.deadzone=clamp(Number(value)||.18,.08,.4);else if(['mouseSensitivity','touchSensitivity','lookSensitivity'].includes(key)){const limits={mouseSensitivity:[.0005,.012],touchSensitivity:[.001,.02],lookSensitivity:[.25,3]};this.settings[key]=clamp(finite(Number(value),this.settings[key]),...limits[key]);}else if(key==='difficulty')this.setDifficulty(value);if(key==='reduced')this.settings.reducedMotion=!!value;this.audio.setMuted(this.settings.mute);this.saveSettings();}
 saveSettings(){try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(this.settings));}catch{this.reportStorage();}}
 reportStorage(){if(!this.storageError){this.storageError=true;this.toast('浏览器未能保存进度。请检查存储权限；当前仍可继续游玩。');}}
 prepareMission(id=this.campaign.mission){if(!Number.isInteger(id)||id<0||id>=LEVELS.length)return;this.campaign.mission=id;this.backMode='briefing';this.setMode('briefing');}
 showBriefing(){this.setMode('briefing');}
 showLoadout(){this.backMode=this.mode;if(this.mode==='playing')this.save();this.setMode('loadout');}
 showJournal(){this.journalCampaign=null;if(!this.campaignLoaded&&this.mode==='menu'){const saved=this.readSave();if(!saved){this.toast('尚无可阅读的行动档案。');return;}this.journalCampaign=this.normalizeCampaign(saved.campaign);}this.backMode=this.mode;if(this.mode==='playing')this.save();this.setMode('journal');}
 showMenu(){if(this.practice){this.finishPractice();return;}if(this.player&&this.mode!=='menu')this.save();this.setMode('menu');}
 pause(){if(!['playing','dialogue'].includes(this.mode))return;this.resumeMode=this.mode;this.save();this.setMode('pause');}
 resume(){if(this.resumeMode==='dialogue'){this.mode='dialogue';this.input?.clear();this.renderDialogue();}else{this.setMode('playing');this.campaign.phase='playing';}}
 back(){if(this.mode==='pause')this.resume();else if(this.mode==='dialogue')this.pause();else if(['guide','settings'].includes(this.mode)&&this.ui?.back)this.ui.back();else if(['loadout','journal','chapters'].includes(this.mode)){const previous=this.backMode||'menu';this.journalCampaign=null;if(previous==='dialogue'){this.mode=previous;this.input?.clear();this.renderDialogue();}else this.setMode(previous);}else if(this.mode==='briefing')this.showMenu();}
 startMission(id=this.campaign.mission){
  if(!Number.isInteger(id)||id<0||id>=LEVELS.length)return;
  if(!this.practice)this.campaignLoaded=true;
  this.campaign.mission=id;this.campaign.stage=0;this.campaign.sceneIndex=0;this.campaign.phase='opening';this.level=this.decorateLevel(createLevel(id));this.aiDirector={reinforcements:0};this.extractionReady=false;this.completedObjectIds.clear();this.enemies=[];this.bullets=[];this.effects=[];this.pickups=[];this.throwables=[];this.sounds=[];this.elapsed=0;this.missionKills=0;this.nextId=1;this.spawnedStages=new Set();this.missionOptional=0;this.lastInteract=null;
  this.player={x:this.level.spawn.x,y:this.level.spawn.y,r:15,hp:100,maxHp:100,armor:60,maxArmor:60,stamina:100,angle:-Math.PI/2,pitch:0,stance:'stand',coverId:null,weaponIndex:0,action:null,invulnerable:1,fireCooldown:0,exposed:0,slideTime:0,healCooldown:0,dead:false};
  this.aimPoint3D=null;this.muzzle3D=null;
  this.camera={x:this.player.x,y:this.player.y,zoom:1};for(const w of this.profile.ownedWeapons){const stats=this.weaponStats(w),ammo=this.profile.ammo[w]||(this.profile.ammo[w]={mag:stats.mag,reserve:stats.mag*4});ammo.mag=Math.min(stats.mag,ammo.mag+ammo.reserve);ammo.reserve=Math.max(ammo.reserve,stats.mag*(this.difficulty==='story'?6:4));}
  this.profile.medkits=Math.max(this.profile.medkits,this.difficulty==='story'?4:this.difficulty==='tactical'?1:2);for(const type of ['frag','smoke','flash'])this.profile.grenades[type]=Math.max(this.difficulty==='story'?3:this.difficulty==='tactical'?1:2,this.profile.grenades[type]||0);
  for(const spawn of this.level.enemies||[])if(!spawn.wave)this.spawnEnemy(spawn);
  this.applyCampaignConsequences();this.checkpoint=this.makeSnapshot();this.playPhase('opening');
 }
 applyCampaignConsequences(){const f=this.campaign.flags||{};if(f.savedMedicine||f.care>=3)this.profile.medkits=Math.max(this.profile.medkits,4);if(f.public>=4)this.profile.grenades.smoke=Math.max(this.profile.grenades.smoke,4);if(f.contain>=4){this.player.armor=75;this.player.maxArmor=75;};}
 startPractice(){this.practiceReturn={profile:clone(this.profile),campaign:clone(this.campaign),snapshot:this.level?this.makeSnapshot():null,checkpoint:this.checkpoint};this.practice=true;this.profile=this.freshProfile();this.profile.ownedWeapons=WEAPONS.map(w=>w.id);for(const a of ATTACHMENTS)this.profile.ownedAttachments[a.id]=3;for(const w of WEAPONS)this.profile.ammo[w.id]={mag:w.mag,reserve:999};this.startMission(0);this.practice=true;this.campaign.phase='playing';this.level.enemies=[];this.enemies=[];this.level.stages=[{title:'自由试射与战术演练',description:'所有武器与配件已开放。Tab 整备；F 可补给，暂停可返回。',targets:['practice-refill']}];this.level.objects=[{id:'practice-refill',type:'supply',name:'训练补给（可重复）',x:this.player.x+120,y:this.player.y,r:26,active:true,interaction:.3,stage:0}];for(let i=0;i<6;i++)this.spawnEnemy({type:['patrol','shield','walker','runner','drone','brute'][i],x:this.player.x+420+(i%3)*150,y:this.player.y-200+Math.floor(i/3)*350,training:true});this.setMode('playing');this.toast('训练场：Tab 开军械库；暂停可返回战役，训练不写入故事存档。');}
 finishPractice(){const old=this.practiceReturn;this.practice=false;if(old){this.profile=old.profile;this.campaign=old.campaign;if(old.snapshot)this.restoreSnapshot(old.snapshot);else{this.level=null;this.player=null;}this.checkpoint=old.checkpoint;}this.practiceReturn=null;this.setMode('menu');}
 decorateLevel(level){
  const notes=CAMPAIGN[level.id]?.fieldNotes||[],anchors=level.objects.filter(o=>o.optional&&o.type!=='supply');
  const fallback=level.objects.filter(o=>o.optional);if(!anchors.length)anchors.push(...fallback);
  for(let i=0;i<notes.length;i++){
   const anchor=anchors[i%Math.max(1,anchors.length)]||level.spawn;let point=null;
   for(const radius of [45,85,125,175]){for(let step=0;step<8;step++){const angle=step*Math.PI/4,candidate={x:anchor.x+Math.cos(angle)*radius,y:anchor.y+Math.sin(angle)*radius};if(pointWalkable(candidate,level,20)&&!level.objects.some(o=>distance(o,candidate)<40)){point=candidate;break;}}if(point)break;}
   if(!point)point={x:level.spawn.x+50+i*60,y:level.spawn.y};
   level.objects.push({id:'field-note-'+i,type:'evidence',name:'现场文档 · '+notes[i].title,...point,r:18,stage:-1,interaction:.5,optional:true,active:true,requires:[],fieldNote:i});
  }
  return level;
 }
 collectFieldNote(object){
  const note=CAMPAIGN[this.campaign.mission]?.fieldNotes?.[object.fieldNote];if(!note)return;
  this.campaign.fieldNotes||=[];const id=this.campaign.mission+':'+object.id;
  if(this.campaign.fieldNotes.some(n=>n.id===id))return;
  const item={id,mission:this.campaign.mission,title:note.title,text:note.text};this.campaign.fieldNotes.push(item);this.campaign.activeFieldNote=item;this.playPhase('fieldnote');
 }
 currentObjective(){return this.level?.stages?.[this.campaign.stage];}
 sceneLines(phase=this.campaign.phase){const c=CAMPAIGN[this.campaign.mission];if(phase==='fieldnote'){const note=this.campaign.activeFieldNote;return note?[{speaker:note.title,portrait:'narrator',text:note.text}]:[];}if(phase==='intro')return INTRO;if(phase==='opening')return c?.opening||[];if(phase==='interlude')return c?.interlude||[];if(phase==='reply'){const n=this.campaign.choices[this.campaign.mission]??0;return c?.choice?.options?.[n]?.reply||[];}if(phase==='closing')return c?.closing||[];if(phase==='letter')return[{speaker:c?.letterTitle||'行动记录',portrait:'xu',text:c?.letter||'行动结束，所有人都将记住你的选择。'}];if(phase==='ending'){this.endingKey=this.determineEnding();return ENDINGS[this.endingKey]||Object.values(ENDINGS)[0]||[];}return[];}
 playPhase(phase){this.campaign.phase=phase;this.campaign.sceneIndex=0;this.dialogueState={lines:this.sceneLines(phase),index:0};this.mode='dialogue';this.controls={x:0,y:0};this.input?.clear();this.renderDialogue();this.save();if(!this.dialogueState.lines.length)this.finishScene();}
 renderDialogue(){const lines=this.sceneLines();this.dialogueState={lines,index:Math.min(this.campaign.sceneIndex||0,Math.max(0,lines.length-1))};if(this.campaign.phase==='choice')this.dialogueState.choice=CAMPAIGN[this.campaign.mission]?.choice;this.dialogue=this.dialogueState;this.ui?.dialogue(lines,this.dialogueState.index,this.dialogueState.choice);}
 recordLine(line){if(!line?.text)return;const id=`${this.campaign.mission}:${this.campaign.phase}:${this.campaign.phase==='fieldnote'?(this.campaign.activeFieldNote?.id||'note')+':':''}${this.campaign.sceneIndex}`;if(!this.campaign.journal.some(l=>l.id===id))this.campaign.journal.push({id,mission:this.campaign.mission,speaker:line.speaker,text:line.text,portrait:line.portrait});}
 advanceDialogue(choiceIndex){
  if(this.mode!=='dialogue')return;const c=CAMPAIGN[this.campaign.mission];
  if(this.campaign.phase==='choice'){if(choiceIndex!==0&&choiceIndex!==1)return;const o=c.choice.options[choiceIndex];if(this.campaign.choices[this.campaign.mission]===undefined){this.campaign.choices[this.campaign.mission]=choiceIndex;const axis=o.axis||(['public','care','contain'].includes(o.flag)?o.flag:['care','public','contain'][(this.campaign.mission+choiceIndex)%3]);this.campaign.flags[axis]=(Number(this.campaign.flags[axis])||0)+1;if(o.flag&&o.flag!==axis)this.campaign.flags[o.flag]=true;this.rewardChoice();this.campaign.journal.push({id:`choice:${this.campaign.mission}`,mission:this.campaign.mission,speaker:'你的决定',text:o.label+(o.text?' · '+o.text:'')});}this.playPhase('reply');return;}
  const lines=this.sceneLines();this.recordLine(lines[this.campaign.sceneIndex]);this.campaign.sceneIndex++;if(this.campaign.sceneIndex>=lines.length)this.finishScene();else{this.renderDialogue();this.save();}
 }
 skipDialogue(){if(this.mode!=='dialogue'||this.campaign.phase==='choice')return;const lines=this.sceneLines();for(let i=this.campaign.sceneIndex;i<lines.length;i++){this.campaign.sceneIndex=i;this.recordLine(lines[i]);}this.finishScene();}
 finishScene(){const phase=this.campaign.phase;this.campaign.sceneIndex=0;if(phase==='fieldnote'){this.campaign.phase='playing';this.campaign.activeFieldNote=null;this.setMode('playing');this.save();}else if(phase==='intro'){this.campaign.phase='briefing';this.save();this.prepareMission(0);}else if(phase==='opening'||phase==='reply'){this.campaign.phase='playing';this.setMode('playing');this.startStage();}else if(phase==='interlude'){this.campaign.phase='choice';this.mode='dialogue';this.renderDialogue();this.save();}else if(phase==='closing')this.playPhase('letter');else if(phase==='letter'){this.campaign.phase='complete';this.save();this.setMode('missionComplete');}else if(phase==='ending'){this.campaign.phase='won';this.save();this.setMode('ending');}}
 rewardChoice(){const a=ATTACHMENTS[(this.campaign.mission*3+(this.campaign.choices[this.campaign.mission]||0))%ATTACHMENTS.length];if(a){this.profile.ownedAttachments[a.id]=(this.profile.ownedAttachments[a.id]||0)+1;this.toast('后勤收到行动记录 · 获得 '+a.name);}}
 determineEnding(campaign=this.campaign){const f=campaign.flags||{},scores={public:Number(f.public)||0,care:Number(f.care)||0,contain:Number(f.contain)||0};return Object.keys(scores).sort((a,b)=>scores[b]-scores[a])[0];}
 startStage(){
  if(!this.level)return;const stage=this.currentObjective();if(!stage){this.extractionReady=true;this.checkpoint=this.makeSnapshot();this.save();return;}
  if(!this.spawnedStages.has(this.campaign.stage)){this.spawnedStages.add(this.campaign.stage);for(const e of stage.reinforcements||[])this.spawnEnemy(e);for(const e of this.level.enemies||[])if(e.wave===this.campaign.stage+1)this.spawnEnemy(e);this.stageStartKills=this.missionKills;const radio=CAMPAIGN[this.campaign.mission]?.radio?.[this.campaign.stage];if(radio){const line=typeof radio==='string'?{speaker:'行动通讯',text:radio}:radio;this.toast(line.speaker+'：'+line.text,8);this.campaign.journal.push({...line,id:`radio:${this.campaign.mission}:${this.campaign.stage}`,mission:this.campaign.mission});}}
  this.checkpoint=this.makeSnapshot();this.save();this.toast(stage.title||stage.description,4);
 }
 completeStage(){if(this.practice)return;const completed=this.campaign.stage;this.campaign.stage++;this.interactionProgress=0;this.spawnEffect('checkpoint',this.player.x,this.player.y);this.audio.sfx('objective');this.toast('目标完成 · 检查点已保存');this.checkpoint=this.makeSnapshot();if(completed===0&&this.campaign.choices[this.campaign.mission]===undefined)this.playPhase('interlude');else this.startStage();}
 completeMission(){if(this.practice)return;if(this.campaign.completed.includes(this.campaign.mission)){this.campaign.phase='complete';this.setMode('missionComplete');return;}this.campaign.completed.push(this.campaign.mission);this.campaign.optional+=this.missionOptional;this.profile.scrap+=25+this.missionOptional*10;const newly=WEAPONS.filter(w=>w.unlockedAt<=this.campaign.completed.length&&!this.profile.ownedWeapons.includes(w.id));grantMissionRewards(this.profile,this.campaign.mission);for(const w of newly){if(!this.profile.ownedWeapons.includes(w.id))this.profile.ownedWeapons.push(w.id);this.profile.ammo[w.id]={mag:w.mag,reserve:w.mag*4};}const a=ATTACHMENTS[(this.campaign.mission*2+7)%ATTACHMENTS.length];if(a)this.profile.ownedAttachments[a.id]=(this.profile.ownedAttachments[a.id]||0)+1;this.lastResult={mission:this.campaign.mission,title:LEVELS[this.campaign.mission].title,kills:this.missionKills,seconds:this.elapsed,optional:this.missionOptional,letter:CAMPAIGN[this.campaign.mission]?.letter,newWeapons:newly.map(w=>w.name)};this.playPhase('closing');}
 nextMission(){if(this.practice){this.finishPractice();return;}if(this.campaign.mission>=LEVELS.length-1){this.playPhase('ending');return;}this.campaign.mission++;this.campaign.stage=0;this.campaign.phase='briefing';this.level=null;this.player=null;this.checkpoint=null;this.save();this.prepareMission();}
 equipWeapon(slot,id){if((slot!==0&&slot!==1)||!this.profile.ownedWeapons.includes(id))return{ok:false,message:'这件武器尚未获得。'};if(this.profile.loadout[1-slot]===id)[this.profile.loadout[slot],this.profile.loadout[1-slot]]=[this.profile.loadout[1-slot],this.profile.loadout[slot]];else this.profile.loadout[slot]=id;if(this.player){this.player.action=null;this.player.burst=null;this.player.fireCooldown=.2;}this.save();return{ok:true,message:'装备已更新'};}
 installAttachment(wid,aid){const result=installAttachment(this.profile,wid,aid);if(result.ok)this.save();this.toast(result.message||'配件已安装');return result;}
 removeAttachment(wid,slot){const result=removeAttachment(this.profile,wid,slot);if(result.ok)this.save();this.toast(result.message||'配件已拆回库存');return result;}
 switchWeapon(slot){if(!this.player)return;this.player.weaponIndex=slot===0||slot===1?slot:1-this.player.weaponIndex;this.player.action=null;this.player.fireCooldown=.2;this.player.burst=null;this.audio.sfx('equip');}
 toggleCrouch(){if(!this.player)return;this.player.stance=this.player.stance==='crouch'?'stand':'crouch';this.player.coverId=null;}
 toggleCover(){const p=this.player;if(!p)return;if(p.coverId){p.coverId=null;this.toast('离开掩体');return;}const nearest=(this.level.covers||[]).filter(c=>c.active!==false&&c.low!==false&&distance(p,{x:clamp(p.x,c.x,c.x+c.w),y:clamp(p.y,c.y,c.y+c.h)})<65).sort((a,b)=>distance(p,{x:a.x+a.w/2,y:a.y+a.h/2})-distance(p,{x:b.x+b.w/2,y:b.y+b.h/2}))[0];if(nearest){p.coverId=nearest.id;p.stance='crouch';this.toast('进入掩体 · 瞄准开火探身，Z / X 侧探，Space 翻越');}else this.toast('靠近矮墙、箱堆或护栏后按 C 进入掩体');}
 dodge(x=0,y=0){
  const p=this.player;if(!p||p.stamina<28||p.slideTime>0)return;
  const cover=(this.level.covers||[]).find(c=>c.id===p.coverId&&c.low!==false);p.action=null;
  let angle=x||y?Math.atan2(y,x):p.angle;p.vaulting=false;
  if(cover){
   const sides=[['left',Math.abs(p.x-cover.x)],['right',Math.abs(p.x-cover.x-cover.w)],['top',Math.abs(p.y-cover.y)],['bottom',Math.abs(p.y-cover.y-cover.h)]].sort((a,b)=>a[1]-b[1]);
   const target={x:p.x,y:p.y};const side=sides[0][0];
   if(side==='left')target.x=cover.x+cover.w+p.r+8;else if(side==='right')target.x=cover.x-p.r-8;else if(side==='top')target.y=cover.y+cover.h+p.r+8;else target.y=cover.y-p.r-8;
   if(distance(p,target)<=245&&pointWalkable(target,this.level,p.r)){
    p.stamina-=28;p.invulnerable=.18;p.slideTime=.3;p.vaulting=true;p.slideVX=(target.x-p.x)/.3;p.slideVY=(target.y-p.y)/.3;p.coverId=null;this.audio.sfx('vault');return;
   }
   this.toast('这侧无法安全翻越，沿掩体移动到有落脚的位置。');return;
  }
  p.stamina-=28;p.invulnerable=.22;p.slideTime=.3;p.slideVX=Math.cos(angle)*510;p.slideVY=Math.sin(angle)*510;p.coverId=null;this.audio.sfx('slide');
 }

 reload(){const p=this.player,a=this.weaponState,w=this.weaponStats();if(!p||p.action||a.mag>=w.mag||a.reserve<=0)return;p.action={type:'reload',duration:w.reload,remaining:w.reload,weaponId:this.weapon};this.audio.sfx('reload');}
 heal(){const p=this.player;if(!p||p.action||p.hp>=p.maxHp||this.profile.medkits<=0)return;p.action={type:'heal',duration:2.1,remaining:2.1};this.toast('正在治疗 · 移动或开火会中断');}
 cycleGrenade(){const types=['frag','smoke','flash'];this.grenadeType=types[(types.indexOf(this.grenadeType)+1)%types.length];this.toast({frag:'破片手雷',smoke:'烟雾弹',flash:'闪光弹'}[this.grenadeType]);}
 throwGrenade(type=this.grenadeType){const p=this.player;if(!p||p.throwCooldown>0||(this.profile.grenades[type]||0)<=0)return;this.profile.grenades[type]--;p.throwCooldown=.65;p.action=null;const range=650,angle=p.angle;this.throwables.push({type,x:p.x,y:p.y,vx:Math.cos(angle)*range,vy:Math.sin(angle)*range,life:1.05,maxLife:1.05,r:5});this.audio.sfx('throw');this.noise(p.x,p.y,180);}
 firePlayer(extraBurst=false){
  const p=this.player,a=this.weaponState,w=this.weaponStats();if(!p||p.slideTime>0||(!extraBurst&&(p.fireCooldown>0||p.burst)))return;if(p.action){if(p.action.type==='heal')p.action=null;else return;}if(a.mag<=0){this.reload();return;}
  a.mag--;p.fireCooldown=60/w.rpm;p.exposed=.24;
  const is3D=this.renderer?.is3D===true;
  if(is3D){const aim=this.renderer.prepareAim?.(this);if(aim&&Number.isFinite(aim.x)&&Number.isFinite(aim.y)&&Number.isFinite(aim.height))this.aimPoint3D=aim;}
  const origin=is3D?this.muzzleOrigin3D(p):this.aimOrigin(p);let angle=p.angle,pitch=is3D?clamp(finite(p.pitch),-1.5,1.5):0;
  const point=this.aimPoint3D;
  if(is3D&&point&&Number.isFinite(point.x)&&Number.isFinite(point.y)&&Number.isFinite(point.height)){
   const dx=point.x-origin.x,dy=point.y-origin.y,flat=Math.hypot(dx,dy);
   if(flat>1e-5)angle=Math.atan2(dy,dx);
   pitch=Math.atan2(point.height-origin.height,Math.max(.00001,flat*WORLD_METRES));
  }
  const velocity=Math.hypot(this.controls.x||0,this.controls.y||0),stance=p.stance==='crouch'?.72:1,aim=1-.5*(p.aimBlend||0),spread=(w.spread+(p.recoil||0)*.4)*stance*aim*(velocity>.1?1.65:1);
  // A skyward 3D crosshair must never be silently redirected onto a ground enemy.
  if(!is3D&&this.input?.lastDevice==='gamepad'&&this.settings.aimAssist){const target=this.enemies.filter(alive).filter(e=>this.hasSight(p,e)&&distance(p,e)<w.range&&Math.abs(angleDelta(Math.atan2(e.y-p.y,e.x-p.x),angle))<.12).sort((a,b)=>distance(p,a)-distance(p,b))[0];if(target)angle+=angleDelta(Math.atan2(target.y-p.y,target.x-p.x),angle)*.25;}
  for(let i=0;i<(w.pellets||1);i++){
   const yaw=angle+(Math.random()-.5)*spread,elevation=is3D?clamp(pitch+(Math.random()-.5)*spread*.65,-Math.PI/2+.0001,Math.PI/2-.0001):0,horizontal=w.projectileSpeed*Math.cos(elevation);
   this.bullets.push({x:origin.x,y:origin.y,px:origin.x,py:origin.y,vx:Math.cos(yaw)*horizontal,vy:Math.sin(yaw)*horizontal,...(is3D?{height:origin.height,previousHeight:origin.height,vz:Math.sin(elevation)*w.projectileSpeed*WORLD_METRES,ballistic3D:true}:{}),damage:w.damage,family:w.family,suppression:w.suppression,vsMachine:w.vsMachine,travel:0,life:w.range/w.projectileSpeed,r:2,faction:'player',owner:'player',ignoreCover:is3D?null:p.coverId,penetration:w.penetration||0,color:w.color||'#ffcf78'});
  }
  if(w.burst>1&&!extraBurst)p.burst={remaining:w.burst-1,timer:60/w.rpm};this.spawnEffect('muzzle',origin.x,origin.y,{angle,pitch,...(is3D?{height:origin.height}:{}),color:w.color});this.noise(p.x,p.y,w.noise||700);this.audio.sfx(w.noise<300?'suppressed':w.family||'rifle');if(this.settings.screenShake)this.shake=Math.min(5,(w.damage||20)/20);p.recoil=Math.min(.4,(p.recoil||0)+w.recoil*.24);this.missionShots=(this.missionShots||0)+1;
 }
 aimOrigin(actor){const p=actor,reach=p.coverId?36:22,lean=(this.controls.lean||0)*18;return{x:p.x+Math.cos(p.angle)*reach-Math.sin(p.angle)*lean,y:p.y+Math.sin(p.angle)*reach+Math.cos(p.angle)*lean};}
 solidHeight3D(rect,kind='cover'){return Number.isFinite(rect?.height3D)&&rect.height3D>0?rect.height3D:kind==='cover'?(rect.low===false?2.3:1.05):3.2;}
 heightBounds3D(actor){
  const tops={heavy:1.95,shield:1.85,walker:1.65,runner:1.5,climber:1.45,spitter:1.8,brute:2.4,turret:1.55,warden:2.5};
  let bottom=actor.type==='drone'?1.5:0,top=actor.type==='drone'?2.05:tops[actor.type]||1.75;
  if(actor===this.player){const scale=actor.slideTime>0?.58:actor.stance==='crouch'?.72:1;top*=scale;if(actor.coverId&&actor.exposed>0)top=Math.max(top,1.65);}
  if(Number.isFinite(actor.baseHeight3D))bottom=actor.baseHeight3D;
  if(Number.isFinite(actor.height3D)&&actor.height3D>0)top=bottom+actor.height3D;
  return{bottom,top};
 }
 muzzleOrigin3D(actor=this.player){
  if(actor===this.player&&this.muzzle3D&&Number.isFinite(this.muzzle3D.x)&&Number.isFinite(this.muzzle3D.y)&&Number.isFinite(this.muzzle3D.height))return{...this.muzzle3D};
  const origin=this.aimOrigin(actor),scale=actor.slideTime>0?.58:actor.stance==='crouch'?.72:1;
  return{...origin,height:actor.coverId&&actor.exposed>0?1.35:1.35*scale};
 }
 spawnEnemy(def){const type=ENEMY_TYPES[def.type]?def.type:'patrol',d=ENEMY_TYPES[type];if(!d||this.enemies.filter(alive).length>100)return null;const scale=this.settings.difficulty==='story'?.8:this.settings.difficulty==='tactical'?1.12:1;const enemy={...clone(d),...clone(def),id:def.id||'enemy-'+this.nextId++,type,faction:d.faction,x:finite(def.x,300),y:finite(def.y,300),r:d.r||16,hp:d.hp*scale,maxHp:d.hp*scale,angle:def.angle||0,state:'patrol',awareness:0,ammo:d.ammo||12,cooldown:Math.random()*.4,searchTime:0,suppression:0,dead:false};if(type==='commander'&&this.campaign.flags.commanderRefusal){enemy.disabled=true;enemy.state='surrendered';}this.enemies.push(enemy);return enemy;}
 hostile(a,b){const af=typeof a==='string'?a:a?.faction,bf=typeof b==='string'?b:b?.faction;if(!af||!bf)return false;if(af==='player'||bf==='player')return af!==bf;if(af==='infected'||bf==='infected')return af!==bf;return false;}
 getHostileTarget(enemy){let candidates=this.enemies.filter(e=>e!==enemy&&alive(e)&&this.hostile(enemy,e));if(alive(this.player))candidates.push(this.player);return candidates.filter(e=>distance(enemy,e)<(enemy.vision||750)*1.3).sort((a,b)=>distance(enemy,a)-distance(enemy,b))[0]||null;}
 hasSight(a,b){if(!this.level)return false;if(!lineOfSight(a,b,this.level))return false;for(const smoke of this.effects)if(smoke.type==='smoke'&&smoke.life>0&&rayCircle(a,b,smoke,smoke.radius||150)!==null)return false;return true;}
 moveEnemy(e,dx,dy){return moveActor(e,dx,dy,this.level,{ignoreCovers:!!e.vaulting});}
 noise(x,y,radius,faction='player'){this.sounds.push({x,y,radius,faction,life:1.1});if(this.sounds.length>45)this.sounds.shift();}
 fireEnemy(enemy,target,options={}){if(!alive(enemy)||!target)return;const speed=options.speed||570,origin={x:enemy.x+Math.cos(enemy.angle)*22,y:enemy.y+Math.sin(enemy.angle)*22},spread=options.spread??.11,angle=Math.atan2(target.y-origin.y,target.x-origin.x)+(Math.random()-.5)*spread;this.bullets.push({x:origin.x,y:origin.y,px:origin.x,py:origin.y,height:(this.heightBounds3D(enemy).bottom+this.heightBounds3D(enemy).top)*.5,previousHeight:(this.heightBounds3D(enemy).bottom+this.heightBounds3D(enemy).top)*.5,vz:0,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,damage:options.damage||enemy.damage||8,life:options.life||(options.range||enemy.range||800)/speed,r:options.projectile==='acid'?7:3,faction:enemy.faction,owner:enemy.id,ignoreCover:(this.level.covers.find(c=>c.low!==false&&c.active!==false&&distance(enemy,{x:clamp(enemy.x,c.x,c.x+c.w),y:clamp(enemy.y,c.y,c.y+c.h)})<55)||{}).id,projectile:options.projectile||'bullet',color:options.projectile==='acid'?'#9bec65':enemy.faction==='machine'?'#8cd7ff':'#ff8279'});this.spawnEffect('muzzle',origin.x,origin.y,{angle});this.noise(enemy.x,enemy.y,500,enemy.faction);this.audio.sfx(options.projectile==='acid'?'acid':'enemyShot');}
 damageActor(actor,damage,source={}){
  if(!alive(actor)||damage<=0)return;if(actor===this.player&&actor.invulnerable>0)return;
  if(actor!==this.player&&(actor.frontArmor||0)>0&&!actor.stunned&&!actor.stunTime&&!(actor.type==='warden'&&this.campaign.flags.platformsRevoked)){const from=Number.isFinite(source.x)?Math.atan2(source.y-actor.y,source.x-actor.x):actor.angle+Math.PI;if(Math.abs(angleDelta(from,actor.angle))<1.05){damage*=1-clamp(actor.frontArmor||0,0,.9);this.spawnEffect('shield',actor.x,actor.y);}}
  if(actor===this.player){const factor=this.settings.difficulty==='story'?.55:this.settings.difficulty==='tactical'?1.2:.8;damage*=factor;const absorbed=Math.min(actor.armor,damage*.65);actor.armor-=absorbed;damage-=absorbed;actor.hp=Math.max(0,actor.hp-damage);actor.invulnerable=.11;if(actor.action?.type==='heal')actor.action=null;this.shake=this.settings.screenShake?5:0;this.audio.sfx('hurt');this.damageFlash=.2;}else{actor.hp=Math.max(0,actor.hp-damage);actor.lastDamageSource={x:finite(source.x),y:finite(source.y),faction:source.faction||'player'};actor.suppression=Math.min(1,(actor.suppression||0)+.35);actor.awareness=1;actor.lastKnownPosition={x:this.player?.x||source.x,y:this.player?.y||source.y};this.spawnEffect('hit',actor.x,actor.y,{height:Number.isFinite(source.height)?source.height:undefined,color:actor.faction==='infected'?'#accc8d':'#f4ba7c'});}
  if(actor.hp<=0){actor.dead=true;if(actor===this.player||actor.friendly){this.campaign.deaths++;this.campaign.phase='dead';this.save();this.setMode('dead');this.audio.sfx('down');}else{this.missionKills++;this.totalKills++;this.spawnEffect('body',actor.x,actor.y,{angle:actor.angle,color:actor.color,life:20});this.audio.sfx('kill');if(Math.random()<.6)this.pickups.push({type:Math.random()<.18?'armor':'ammo',x:actor.x,y:actor.y,r:11,amount:actor.faction==='infected'?12:22,life:80});}}
 }
 spawnEffect(type,x,y,extra={}){const life=extra.life??({muzzle:.08,hit:.2,shield:.18,explosion:.65,flash:.5,smoke:13,checkpoint:1.2,body:20,acid:7}[type]||.5);this.effects.push({type,x,y,life,maxLife:life,...extra});if(this.effects.length>250)this.effects.shift();}
 toast(text,seconds=4){this.messages.push({text:String(text),life:seconds});if(this.messages.length>5)this.messages.shift();this.ui?.toast?.(String(text));}
 update(dt){
  this.time+=dt;for(const m of this.messages)m.life-=dt;this.messages=this.messages.filter(m=>m.life>0);this.input?.update(dt);if(this.mode!=='playing'||!this.player||!this.level){this.ui?.update();return;}
  dt=Math.min(dt,.05);this.elapsed+=dt;this.campaign.totalPlay+=dt;this.saveClock+=dt;const p=this.player,c=this.controls,w=this.weaponStats();p.fireCooldown=Math.max(0,p.fireCooldown-dt);p.recoil=Math.max(0,(p.recoil||0)-dt*.3);p.aimBlend=clamp((p.aimBlend||0)+(c.aim?dt/(.18*w.ads):-dt/.1),0,1);p.throwCooldown=Math.max(0,(p.throwCooldown||0)-dt);p.invulnerable=Math.max(0,p.invulnerable-dt);p.exposed=Math.max(0,p.exposed-dt);p.exposure=p.exposed>0;this.shake=Math.max(0,(this.shake||0)-dt*20);this.damageFlash=Math.max(0,(this.damageFlash||0)-dt);
  if(p.action){p.action.remaining-=dt;if(p.action.type==='heal'&&(Math.hypot(c.x||0,c.y||0)>.2||c.fire))p.action=null;else if(p.action.remaining<=0){const action=p.action;p.action=null;if(action.type==='reload'&&action.weaponId===this.weapon){const a=this.weaponState,n=Math.min(w.mag-a.mag,a.reserve);a.mag+=n;a.reserve-=n;this.audio.sfx('reloadDone');}else if(action.type==='heal'&&this.profile.medkits>0){this.profile.medkits--;p.hp=Math.min(p.maxHp,p.hp+65);this.audio.sfx('heal');}}}
  if(p.slideTime>0){p.slideTime-=dt;moveActor(p,p.slideVX*dt,p.slideVY*dt,this.level,{ignoreCovers:p.vaulting});if(p.slideTime<=0)p.vaulting=false;}else{
   let speed=185*(w.move||1);if(p.stance==='crouch')speed*=.62;if(c.aim)speed*=.72;if(c.sprint&&p.stamina>0&&Math.hypot(c.x||0,c.y||0)>.1&&!c.fire){speed*=1.45;p.stamina=Math.max(0,p.stamina-dt*20);p.coverId=null;this.noise(p.x,p.y,220);}else p.stamina=Math.min(100,p.stamina+dt*21);if(p.coverId)speed*=.65;if(p.carrying)speed*=.72;
   let dx=(c.x||0)*speed*dt,dy=(c.y||0)*speed*dt;for(const z of this.level.floorZones||[])if(z.active!==false&&rectHas(p,z)){if(z.type==='water'){dx*=.62;dy*=.62;}if(z.type==='belt'){dx+=(z.dx||45)*dt;dy+=(z.dy||0)*dt;}if(z.type==='electric'||z.type==='fire'){if(!p.hazardCooldown){this.damageActor(p,z.damage||9,{faction:'environment'});p.hazardCooldown=.75;}}}p.hazardCooldown=Math.max(0,(p.hazardCooldown||0)-dt);moveActor(p,dx,dy,this.level);
   if(p.coverId){const cover=this.level.covers.find(x=>x.id===p.coverId);if(!cover||distance(p,{x:clamp(p.x,cover.x,cover.x+cover.w),y:clamp(p.y,cover.y,cover.y+cover.h)})>80)p.coverId=null;}
  }
  if(c.fire)this.firePlayer();if(p.burst){p.burst.timer-=dt;if(p.burst.timer<=0){if(this.weaponState.mag>0)this.firePlayer(true);p.burst.remaining--;p.burst.timer=60/w.rpm;if(p.burst.remaining<=0){p.burst=null;p.fireCooldown=Math.max(p.fireCooldown,.27);}}}
  this.updateInteraction(dt);if(this.mode!=='playing')return;updateEnemies(this,dt);if(this.mode!=='playing')return;this.updateBullets(dt);if(this.mode!=='playing')return;this.updateThrowables(dt);this.updateObjects(dt);this.updatePickups(dt);
  for(const e of this.effects){e.life-=dt;if(e.type==='acid'&&e.life>0&&distance(p,e)<(e.radius||75)&&!p.acidCooldown){this.damageActor(p,6,{faction:'infected'});p.acidCooldown=1;}}p.acidCooldown=Math.max(0,(p.acidCooldown||0)-dt);this.effects=this.effects.filter(e=>e.life>0);for(const s of this.sounds)s.life-=dt;this.sounds=this.sounds.filter(s=>s.life>0);this.enemies=this.enemies.filter(e=>!e.dead||((e.deadAge=(e.deadAge||0)+dt)<2));
  const look=c.aim?120:50,targetX=p.x+Math.cos(p.angle)*look,targetY=p.y+Math.sin(p.angle)*look;this.camera.x+=(targetX-this.camera.x)*Math.min(1,dt*8);this.camera.y+=(targetY-this.camera.y)*Math.min(1,dt*8);this.camera.zoom=clamp(Math.min(innerWidth/1100,innerHeight/720),.66,1.22);this.camera.x=clamp(this.camera.x,0,this.level.width);this.camera.y=clamp(this.camera.y,0,this.level.height);
  this.audio.update?.(this,dt);this.ui?.update();if(this.saveClock>7){this.saveClock=0;this.save();}
 }
 updateBullets(dt){
  const solids=[...this.level.walls.map(rect=>({rect,height:this.solidHeight3D(rect,'wall')})),...this.level.doors.filter(d=>!d.open).map(rect=>({rect,height:this.solidHeight3D(rect,'door')})),...this.level.covers.map(rect=>({rect,height:this.solidHeight3D(rect,'cover')}))];
  for(const b of this.bullets){
   if(b.life<=0)continue;b.life-=dt;
   const spatial=b.ballistic3D===true&&Number.isFinite(b.height),height=finite(b.height,1.1),dh=finite(b.vz)*dt;
   const a={x:b.x,y:b.y,height},end={x:b.x+b.vx*dt,y:b.y+b.vy*dt,height:height+dh};
   b.px=b.x;b.py=b.y;if(Number.isFinite(b.height))b.previousHeight=b.height;
   b.travel=(b.travel||0)+Math.hypot(b.vx*dt,b.vy*dt,spatial?dh/WORLD_METRES:0);let nearest=1,hit=null;
   if(spatial&&end.height<Math.max(.005,(b.r||2)*WORLD_METRES)){const t=height<=0?0:(height-Math.max(.005,(b.r||2)*WORLD_METRES))/(height-end.height);if(t>=0&&t<=nearest){nearest=t;hit={ground:true};}}
   for(const solid of solids){
    const wall=solid.rect;if(wall.active===false||wall.destroyed||wall.id===b.ignoreCover)continue;
    const bottom=finite(wall.baseHeight3D),t=spatial?rayPrism3D(a,end,wall,bottom,bottom+solid.height,b.r||2):rayRect(a,end,wall);
    if(t!==null&&t<nearest){nearest=t;hit={wall};}
   }
   const targets=this.enemies.filter(e=>alive(e)&&e.id!==b.owner&&this.hostile(b.faction,e.faction));if(b.faction!=='player'&&alive(this.player))targets.push(this.player);if(b.faction!=='player')targets.push(...this.friendlies);
   for(const actor of targets){
    const target=actor===this.player&&actor.coverId&&actor.exposed>0?this.aimOrigin(actor):actor,bounds=spatial?this.heightBounds3D(actor):null;
    const t=spatial?rayCylinder3D(a,end,target,actor.r+(b.r||2),bounds.bottom,bounds.top,b.r||2):rayCircle(a,end,target,actor.r+(b.r||2));
    if(t!==null&&t<nearest){nearest=t;hit={actor};}
    if(actor!==this.player&&distance(end,actor)<65&&(!spatial||(end.height>=bounds.bottom-.35&&end.height<=bounds.top+.35)))actor.suppression=Math.min(1,(actor.suppression||0)+dt*.5*(b.suppression||1));
   }
   b.x=a.x+(end.x-a.x)*nearest;b.y=a.y+(end.y-a.y)*nearest;if(Number.isFinite(b.height))b.height=a.height+(end.height-a.height)*nearest;
   if(hit){
    if(hit.actor){this.damageActor(hit.actor,b.damage*(hit.actor.faction==='machine'?(b.vsMachine||1):1)*(b.family==='shotgun'?Math.max(.35,1-(b.travel||0)/700):1),{x:a.x,y:a.y,height:spatial?b.height:undefined,faction:b.faction});b.life=0;}
    else if(hit.ground){b.life=0;this.spawnEffect('spark',b.x,b.y,{height:b.height});}
    else{
     const wall=hit.wall;
     if(['glass','wood'].includes(wall.material)){
      wall.hp=finite(wall.hp,wall.material==='glass'?22:65)-b.damage;
      if(wall.hp<=0){wall.active=false;wall.destroyed=true;this.spawnEffect('debris',b.x,b.y,{height:spatial?b.height:undefined,color:wall.material==='glass'?'#bfe9e7':'#c99c68'});}
      if(b.penetration>0){b.penetration--;b.damage*=.7;b.x+=b.vx*dt*.08;b.y+=b.vy*dt*.08;if(spatial)b.height+=finite(b.vz)*dt*.08;}else b.life=0;
     }else b.life=0;
     this.spawnEffect('spark',b.x,b.y,{height:spatial?b.height:undefined});
    }
    if(b.projectile==='acid'&&b.life<=0){this.spawnEffect('acid',b.x,b.y,{radius:75});b.splashed=true;}
   }
  }
  for(const b of this.bullets)if(b.projectile==='acid'&&b.life<=0&&!b.splashed)this.spawnEffect('acid',b.x,b.y,{radius:75});
  this.bullets=this.bullets.filter(b=>b.life>0&&b.x>0&&b.y>0&&b.x<this.level.width&&b.y<this.level.height);
 }
 updateThrowables(dt){for(const t of this.throwables){t.life-=dt;const next={x:t.x+t.vx*dt,y:t.y+t.vy*dt,r:5};if(this.level.walls.some(w=>w.active!==false&&circleRect(next,w))||this.level.doors.some(d=>!d.open&&circleRect(next,d))){t.vx*=-.35;t.vy*=-.35;}else{t.x=next.x;t.y=next.y;}t.vx*=Math.pow(.4,dt);t.vy*=Math.pow(.4,dt);if(t.life<=0){const radius=t.type==='frag'?185:t.type==='flash'?330:180;if(t.type==='smoke')this.spawnEffect('smoke',t.x,t.y,{radius});else if(t.type==='flash'){this.spawnEffect('flash',t.x,t.y,{radius});for(const e of this.enemies)if(alive(e)&&distance(e,t)<radius&&this.hasSight(t,e)){e.stunTime=4;e.suppression=1;}this.audio.sfx('flash');}else{this.spawnEffect('explosion',t.x,t.y,{radius});this.noise(t.x,t.y,1500);for(const e of [this.player,...this.enemies])if(alive(e)&&distance(e,t)<radius&&lineOfSight(t,e,this.level))this.damageActor(e,Math.max(25,180*(1-distance(e,t)/radius)),{...t,faction:'player'});for(const c of this.level.covers)if(distance(t,{x:c.x+c.w/2,y:c.y+c.h/2})<radius&&c.material==='wood'){c.active=false;c.destroyed=true;}this.audio.sfx('explosion');}}}this.throwables=this.throwables.filter(t=>t.life>0);}
 updatePickups(dt){for(const pickup of this.pickups){pickup.life-=dt;if(distance(this.player,pickup)<40){if(pickup.type==='armor')this.player.armor=Math.min(this.player.maxArmor,this.player.armor+20);else{for(const id of this.profile.loadout){const a=this.profile.ammo[id],w=this.weaponStats(id);a.reserve=Math.min(w.mag*12,a.reserve+Math.round(pickup.amount*(w.pellets>1?.25:1)));}}pickup.life=0;this.audio.sfx('pickup');}}this.pickups=this.pickups.filter(p=>p.life>0);}
 availableObjects(){if(!this.level)return[];const targets=new Set(this.currentObjective()?.targets||[]);return this.level.objects.filter(o=>o.active!==false&&(!o.completed||(o.following&&o.type==='vehicle'&&!o.delivered))&&(o.optional||targets.has(o.id)||o.stage===undefined||o.stage<=this.campaign.stage));}
 updateInteraction(dt){
  const p=this.player,c=this.controls;const nearby=this.availableObjects().filter(o=>distance(p,o)<(o.r||24)+62&&lineOfSight(p,o,this.level)).sort((a,b)=>distance(p,a)-distance(p,b));const door=this.level.doors.filter(d=>d.active!==false&&distance(p,{x:clamp(p.x,d.x,d.x+d.w),y:clamp(p.y,d.y,d.y+d.h)})<65&&lineOfSight(p,{x:clamp(p.x,d.x,d.x+d.w),y:clamp(p.y,d.y,d.y+d.h)},{...this.level,doors:this.level.doors.filter(other=>other!==d)})).sort((a,b)=>distance(p,a)-distance(p,b))[0];let target=nearby[0];
  if(this.extractionReady&&distance(p,this.level.exit)<(this.level.exit.r||55)+50&&lineOfSight(p,this.level.exit,this.level))target={...this.level.exit,id:'__exit',type:'exit',name:'撤离行动区域',interaction:1};if(!target&&door)target={...door,id:'door:'+door.id,type:'door',door,interaction:c.sprint?.65:.25,name:door.open?'关闭通道':door.locked?'踹开锁门（按住 Shift + F）':'打开通道'};
  this.interactionTarget=target||null;if(!c.interact)this.interactionLatch=null;if(c.interact&&target&&this.interactionLatch===target.id)return;if(!c.interact||!target){this.interactionProgress=Math.max(0,this.interactionProgress-dt*2);this.lastInteract=null;return;}
  if(this.lastInteract!==target.id){this.lastInteract=target.id;this.interactionProgress=0;}if(p.action){this.interactionProgress=0;return;}
  if(target.type==='door'){if(target.door.locked&&!c.sprint){this.interactionHint='门已锁定 · 按住 Shift + F / 冲刺 + 互动破门';return;}}
  else if((target.requires||[]).some(id=>!this.completedObjectIds.has(id))){this.interactionHint='先完成前置目标';return;}
  const threat=this.enemies.some(e=>alive(e)&&!e.disabled&&distance(e,target)<180&&this.hasSight(e,p)&&!(target.effect?.disableEnemies||[]).includes(e.id));if(threat&&!['supply','switch','gate','power','door'].includes(target.type)){this.interactionHint='清除目标附近威胁后继续';this.interactionProgress=Math.max(0,this.interactionProgress-dt);return;}
  this.interactionHint='';this.interactionProgress+=dt/Math.max(.2,target.interaction||1.6);if(this.interactionProgress>=1){this.interactionLatch=target.id;this.interactionProgress=0;this.lastInteract=null;if(target.type==='exit'){if((this.level.objects||[]).some(o=>o.following&&!o.delivered&&distance(o,this.level.exit)>140)){this.interactionLatch=null;this.interactionHint='还有随行人员未到撤离点';this.toast('还有随行人员或医疗车未到撤离点，请靠近带领他们。');return;}this.completeMission();}else if(target.type==='door'){target.door.open=!target.door.open;if(target.door.locked){target.door.locked=false;this.noise(p.x,p.y,900);this.audio.sfx('breach');}else this.audio.sfx('door');}else this.interactObject(target);}
 }
 interactObject(object){
  const o=this.level.objects.find(x=>x.id===object.id);if(!o)return;if(o.type==='vehicle'&&o.following){o.stopped=!o.stopped;this.toast(o.stopped?'医疗车已停下等待':'医疗车继续前进');return;}if(o.completed)return;
  if(o.type==='supply'||o.type==='crate'){for(const id of this.profile.loadout){const w=this.weaponStats(id);this.profile.ammo[id].reserve=Math.min(w.mag*12,this.profile.ammo[id].reserve+w.mag*3);}this.profile.medkits=Math.min(8,this.profile.medkits+1);this.player.armor=Math.min(this.player.maxArmor,this.player.armor+30);this.profile.grenades.frag=Math.min(6,this.profile.grenades.frag+1);this.toast('补给：弹药、医疗包、护甲与手雷');if(this.practice){this.player.hp=100;return;}}
  if(o.type==='rescue'||o.type==='hostage'||o.type==='vehicle'){o.following=true;o.friendly=true;o.faction='player';if(o.id==='freight-cart')this.player.carrying=null;o.r=o.type==='vehicle'?34:20;o.maxHp=o.type==='vehicle'?260:180;o.hp=o.hp||o.maxHp;o.routeIndex=0;this.toast(o.type==='vehicle'?'医疗车启动 · 靠近引导，可再次互动叫停':'已救出 · 会跟随你前往撤离点，注意保护');}
  if(o.type==='evidence'&&o.heavy){this.player.carrying=o.id;this.toast('已携带证据箱 · 冲刺速度下降');}
  this.applyEffect(o.effect);if(o.flag){this.campaign.flags[o.flag]=true;if(o.flag==='commanderRefusal')for(const enemy of this.enemies)if(enemy.type==='commander'){enemy.disabled=true;enemy.state='surrendered';this.toast('书面拒绝令已获核验 · 指挥官停止开火');}}if(o.reward==='attachment'){const candidates=ATTACHMENTS.filter(a=>(a.unlockedAt||0)<=this.campaign.mission+1),a=candidates[(this.campaign.mission+o.id.length)%candidates.length];if(a){this.profile.ownedAttachments[a.id]=(this.profile.ownedAttachments[a.id]||0)+1;this.toast('回收配件：'+a.name);}}else if(o.reward==='medical'){this.profile.medkits=Math.min(10,this.profile.medkits+2);}else if(o.reward){if(o.reward.medkits)this.profile.medkits+=o.reward.medkits;if(o.reward.scrap)this.profile.scrap+=o.reward.scrap;if(o.reward.attachment)this.profile.ownedAttachments[o.reward.attachment]=(this.profile.ownedAttachments[o.reward.attachment]||0)+1;}o.completed=true;o.active=o.following?true:false;this.completedObjectIds.add(o.id);if(o.optional){this.missionOptional++;this.profile.scrap+=10;}this.audio.sfx('interact');this.checkObjective();this.checkpoint=this.makeSnapshot();this.save();if(Number.isInteger(o.fieldNote))this.collectFieldNote(o);
 }
 applyEffect(effect){if(!effect)return;for(const id of effect.openDoors||[]){const d=this.level.doors.find(x=>x.id===id);if(d){d.open=true;d.locked=false;}}for(const id of effect.closeDoors||[]){const d=this.level.doors.find(x=>x.id===id);if(d)d.open=false;}for(const id of effect.disableHazards||[]){const z=this.level.floorZones.find(x=>x.id===id);if(z)z.active=false;}for(const id of effect.enableHazards||[]){const z=this.level.floorZones.find(x=>x.id===id);if(z)z.active=true;}for(const change of effect.moveCover||[]){const c=this.level.covers.find(x=>x.id===change.id);if(c){c.x=change.x;c.y=change.y;}}for(const id of effect.removeWalls||[]){const w=this.level.walls.find(x=>x.id===id);if(w)w.active=false;}for(const id of effect.disableEnemies||[]){const e=this.enemies.find(x=>x.id===id);if(e){e.disabled=true;e.stunned=999;if(e.type==='commander')e.state='surrendered';}}if(effect.blackout)this.level.blackout=true;if(effect.setFlag?.carryingEvidence)this.player.carrying='root-backup';if(effect.setFlag)Object.assign(this.campaign.flags,effect.setFlag);for(const e of effect.spawn||[])this.spawnEnemy(e);}
 checkObjective(){const stage=this.currentObjective();if(!stage||this.practice)return;const targets=stage.targets||[];if(targets.every(id=>this.completedObjectIds.has(id))&&(!stage.requiredKills||this.missionKills-(this.stageStartKills||0)>=stage.requiredKills))this.completeStage();}
 updateObjects(dt){for(const o of this.level.objects){if(!o.following||o.delivered||o.stopped)continue;if(o.hp<=0){o.following=false;this.toast(o.name+'受伤，返回检查点可重新救援。');this.campaign.phase='dead';this.campaign.deaths++;this.save();this.setMode('dead');return;}if(distance(o,this.level.exit)<110){o.delivered=true;this.toast(o.name+'已抵达撤离点');continue;}const d=distance(o,this.player);if(d>85&&d<850){o.pathTimer=(o.pathTimer||0)-dt;if(o.pathTimer<=0){o.path=this.pathTo?.(o,this.player)||[];o.pathTimer=1;}const point=o.path?.[0]||this.player;if(distance(o,point)<40)o.path?.shift();const a=Math.atan2(point.y-o.y,point.x-o.x),speed=o.type==='vehicle'?125:145;moveActor(o,Math.cos(a)*speed*dt,Math.sin(a)*speed*dt,this.level);}if(d<120&&!this.enemies.some(e=>alive(e)&&!e.disabled&&distance(e,o)<240))o.hp=Math.min(o.maxHp,o.hp+dt*7);}this.checkObjective();}
 makeSnapshot(){if(!this.level||!this.player)return null;return{mission:this.campaign.mission,stage:this.campaign.stage,elapsed:this.elapsed,missionKills:this.missionKills,missionOptional:this.missionOptional,extractionReady:this.extractionReady,player:clone(this.player),ammo:clone(this.profile.ammo),medkits:this.profile.medkits,grenades:clone(this.profile.grenades),enemies:this.enemies.map(enemySnapshot),aiReinforcements:this.aiDirector?.reinforcements||0,objects:clone(this.level.objects),doors:clone(this.level.doors),covers:clone(this.level.covers),walls:clone(this.level.walls),floorZones:clone(this.level.floorZones),blackout:!!this.level.blackout,completedObjectIds:[...this.completedObjectIds],spawnedStages:[...(this.spawnedStages||[])],stageStartKills:this.stageStartKills||0,nextId:this.nextId};}
 restoreSnapshot(s){
  if(!s||!Number.isInteger(s.mission)||s.mission<0||s.mission>=LEVELS.length)return false;
  const level=this.decorateLevel(createLevel(s.mission)),p=s.player;
  if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||!Number.isFinite(p.hp))return false;
  this.level=level;this.campaign.mission=s.mission;this.campaign.stage=clamp(Math.floor(finite(s.stage)),0,level.stages.length);
  for(const key of ['objects','doors','covers','walls','floorZones']){
   const entries=Array.isArray(s[key])?s[key]:[],saved=new Map(entries.filter(x=>x&&typeof x.id==='string').map(x=>[x.id,x]));
   level[key]=level[key].map(original=>{
    const o={...original},change=saved.get(o.id);if(!change)return o;
    for(const field of ['active','destroyed','open','locked','completed','following','delivered','stopped'])if(typeof change[field]==='boolean')o[field]=change[field];
    if(Number.isFinite(change.hp))o.hp=clamp(change.hp,0,2000);
    if(o.following){o.friendly=true;o.faction='player';o.maxHp=o.type==='vehicle'?260:180;o.r=o.type==='vehicle'?34:20;o.hp=clamp(finite(change.hp,o.maxHp),0,o.maxHp);}
    if(key==='covers'||(key==='objects'&&o.following)){if(Number.isFinite(change.x)&&Number.isFinite(change.y)){o.x=clamp(change.x,32,level.width-32);o.y=clamp(change.y,32,level.height-32);}}
    return o;
   });
  }
  level.blackout=!!s.blackout;
  this.player={x:clamp(p.x,16,level.width-16),y:clamp(p.y,16,level.height-16),r:15,hp:clamp(p.hp,0,100),maxHp:100,armor:clamp(finite(p.armor),0,100),maxArmor:(Number(this.campaign.flags?.contain)||0)>=4?75:60,stamina:clamp(finite(p.stamina,100),0,100),angle:finite(p.angle),pitch:clamp(finite(p.pitch),-1.08,1.08),stance:p.stance==='crouch'?'crouch':'stand',coverId:level.covers.some(c=>c.id===p.coverId&&c.low!==false)?p.coverId:null,weaponIndex:p.weaponIndex===1?1:0,action:null,invulnerable:.7,fireCooldown:0,burst:null,exposed:0,slideTime:0,dead:!!p.dead,carrying:typeof p.carrying==='string'?p.carrying:null};
  if(!pointWalkable(this.player,level,15)){this.player.x=level.spawn.x;this.player.y=level.spawn.y;this.player.coverId=null;}
  const scale=this.settings.difficulty==='story'?.8:this.settings.difficulty==='tactical'?1.12:1;
  this.enemies=(Array.isArray(s.enemies)?s.enemies:[]).filter(e=>e&&ENEMY_TYPES[e.type]&&Number.isFinite(e.x)&&Number.isFinite(e.y)&&Number.isFinite(e.hp)).slice(0,120).map(e=>{const d=ENEMY_TYPES[e.type];return{...clone(d),id:typeof e.id==='string'?e.id:'enemy-'+this.nextId++,type:e.type,faction:d.faction,x:clamp(e.x,20,level.width-20),y:clamp(e.y,20,level.height-20),r:d.r||16,hp:clamp(e.hp,0,d.hp*scale),maxHp:d.hp*scale,angle:finite(e.angle),awareness:clamp(finite(e.awareness),0,1),ammo:clamp(finite(e.ammo,12),0,200),cooldown:clamp(finite(e.cooldown),0,5),suppression:clamp(finite(e.suppression),0,1),dead:!!e.dead,disabled:!!e.disabled,stunTime:clamp(finite(e.stunTime),0,999),reloadTime:clamp(finite(e.reloadTime),0,8),radioCalls:clamp(Math.floor(finite(e.radioCalls)),0,2),healCharges:clamp(Math.floor(finite(e.healCharges,2)),0,2),patrol:(Array.isArray(e.patrol)?e.patrol:[]).filter(v=>Number.isFinite(v.x)&&Number.isFinite(v.y)).slice(0,12).map(v=>({x:clamp(v.x,32,level.width-32),y:clamp(v.y,32,level.height-32)}))};});
  this.profile.ammo=normalizeArmoryProfile({...this.profile,ammo:s.ammo||this.profile.ammo}).ammo;
  this.profile.medkits=clamp(finite(s.medkits,2),0,30);this.profile.grenades=Object.fromEntries(['frag','smoke','flash'].map(k=>[k,clamp(finite(s.grenades?.[k],2),0,20)]));
  this.completedObjectIds=new Set((Array.isArray(s.completedObjectIds)?s.completedObjectIds:[]).filter(id=>level.objects.some(o=>o.id===id)));
  this.spawnedStages=new Set((Array.isArray(s.spawnedStages)?s.spawnedStages:[]).filter(n=>Number.isInteger(n)&&n>=0&&n<level.stages.length));
  this.elapsed=Math.max(0,finite(s.elapsed));this.missionKills=Math.max(0,finite(s.missionKills));this.missionOptional=Math.max(0,finite(s.missionOptional));this.extractionReady=!!s.extractionReady;this.stageStartKills=finite(s.stageStartKills);this.nextId=Math.max(1000,finite(s.nextId,1000));this.aiDirector={reinforcements:clamp(finite(s.aiReinforcements),0,2)};this.bullets=[];this.effects=[];this.pickups=[];this.throwables=[];this.sounds=[];this.camera={x:this.player.x,y:this.player.y,zoom:1};return true;
 }

 save(){if(this.practice||!this.campaignLoaded)return;try{const data={version:1,campaign:this.campaign,profile:this.profile,current:this.makeSnapshot(),checkpoint:this.checkpoint,lastResult:this.lastResult||null,updatedAt:new Date().toISOString()};localStorage.setItem(SAVE_KEY,JSON.stringify(data));this.loadAvailable=true;}catch{this.reportStorage();}}
 readSave(){try{const s=JSON.parse(localStorage.getItem(SAVE_KEY)||'null');if(s?.version!==1||!s.campaign||!s.profile||!Array.isArray(s.campaign.completed)||!Number.isInteger(s.campaign.mission)||s.campaign.mission<0||s.campaign.mission>=LEVELS.length||!Array.isArray(s.profile.ownedWeapons)||!Array.isArray(s.profile.loadout))return null;if(!s.profile.loadout.every(id=>WEAPONS.some(w=>w.id===id))||s.profile.loadout.length!==2)return null;return s;}catch{return null;}}
 continueGame(){const s=this.readSave();if(!s){this.toast('未找到可恢复的完整存档。');this.loadAvailable=false;return;}this.campaignLoaded=true;this.journalCampaign=null;this.practice=false;this.campaign=this.normalizeCampaign(s.campaign);this.campaign.completed=[...new Set(this.campaign.completed.filter(i=>Number.isInteger(i)&&i>=0&&i<18))];this.campaign.journal=Array.isArray(this.campaign.journal)?this.campaign.journal.slice(-2500):[];this.profile={...this.freshProfile(),...normalizeArmoryProfile(s.profile),medkits:clamp(finite(s.profile.medkits,2),0,30),grenades:Object.fromEntries(['frag','smoke','flash'].map(k=>[k,clamp(finite(s.profile.grenades?.[k],2),0,20)])),scrap:clamp(finite(s.profile.scrap),0,100000)};this.profile.ownedWeapons=this.profile.ownedWeapons.filter(id=>WEAPONS.some(w=>w.id===id));this.profile.fittings=this.profile.fittings||{};this.profile.grenades=this.profile.grenades||{frag:2,smoke:2,flash:2};this.checkpoint=s.checkpoint;this.lastResult=s.lastResult;this.setDifficulty(this.settings.preferredDifficulty||this.campaign.difficulty||this.settings.difficulty,{remember:false});const restored=s.current?this.restoreSnapshot(s.current):false;const phase=this.campaign.phase;if(phase==='won'){this.endingKey=this.determineEnding();this.setMode('ending');}else if(phase==='complete')this.setMode('missionComplete');else if(['intro','opening','interlude','choice','reply','closing','letter','ending','fieldnote'].includes(phase)){this.mode='dialogue';this.input?.clear();this.renderDialogue();}else if(phase==='dead')this.setMode('dead');else if(restored){this.campaign.phase='playing';this.setMode('playing');}else this.prepareMission();}
 retry(){if(!this.checkpoint||!this.restoreSnapshot(this.checkpoint)){this.startMission();return;}this.player.dead=false;this.player.hp=Math.max(65,this.player.hp);this.player.armor=Math.max(25,this.player.armor);this.player.invulnerable=1.5;for(const npc of this.level.objects.filter(o=>o.following&&!o.delivered)){npc.hp=Math.max(npc.hp,(npc.maxHp||180)*.7);npc.dead=false;}for(const id of this.profile.loadout){const w=this.weaponStats(id),a=this.profile.ammo[id]||(this.profile.ammo[id]={mag:0,reserve:0});a.mag=Math.max(a.mag,w.mag);a.reserve=Math.max(a.reserve,w.mag*2);}this.profile.medkits=Math.max(this.profile.medkits,1);this.campaign.phase='playing';this.setMode('playing');this.startStage();}
}
