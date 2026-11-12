import {installCampaign} from './campaign.js';
import {loadProfile,loadSettings,loadVoyage} from './storage.js';
import {Renderer} from './render.js';
import {AudioManager} from './audio.js';
import {STAGES,INTRO,ENDING,UPGRADES,portraitSVG} from './content.js';
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const TAU=Math.PI*2;
const storage={get(k,f){try{return JSON.parse(localStorage.getItem(k))??f;}catch{return f;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true;}catch{return false;}},remove(k){try{localStorage.removeItem(k);}catch{}}};
const SHIPS=[{id:'breeze',name:'信风号',desc:'均衡可靠 · 120 船体',hp:120,speed:205,rate:.48,damage:20},{id:'swift',name:'浪隼号',desc:'轻盈迅捷 · 90 船体',hp:90,speed:250,rate:.40,damage:17},{id:'stone',name:'磐石号',desc:'重装火力 · 160 船体',hp:160,speed:170,rate:.58,damage:27}];
const ACHIEVEMENTS=[['first','初次启航','完成第一次远航（无论成败）'],['keeper','点灯人','重燃第五座灯塔'],['hundred','破浪者','累计击退 100 个敌人'],['collector','收信人','收集全部 5 封信'],['untouched','完美海域','在一片海域中没有受到伤害'],['storm','风暴之心','在风暴难度完成远航']];
class Game {
 constructor(){
  this.renderer=new Renderer($('gameCanvas'));this.audio=new AudioManager();
  this.profile=loadProfile(storage.get('tidekeeper-profile-v1',null));
  this.settings=loadSettings(storage.get('tidekeeper-settings-v1',null));this.audio.setMuted(this.settings.mute);this.reducedMotion=this.settings.reduced;
  this.ship='breeze';this.keys=new Set();this.pointer={x:0,y:0,down:false,active:false};this.pad={x:0,y:0,ax:0,ay:0};this.oldButtons=[];this.padNavTime=0;this.time=0;this.mode='menu';this.stage=0;this.shake=0;this.camera={x:900,y:600};this.player={x:900,y:600,r:16,angle:-.6,hp:120,maxHp:120};this.resetArrays();this.makeIslands();this.bind();this.setupMenu();$('startBtn').focus();this.last=performance.now();
  requestAnimationFrame(t=>this.frame(t));
 }
 resetArrays(){this.enemies=[];this.bullets=[];this.particles=[];this.pickups=[];this.effects=[];this.floaters=[];this.beacons=[];}
 makeIslands(){this.islands=[{x:145,y:190,r:90,seed:3,kind:'island'},{x:1540,y:200,r:135,seed:8,kind:'island'},{x:250,y:1000,r:130,seed:11,kind:'island'},{x:1610,y:1010,r:95,seed:17,kind:'island'},{x:1050,y:175,r:55,seed:6,kind:'wreck'},{x:550,y:430,r:62,seed:9,kind:'island'},{x:1250,y:810,r:65,seed:13,kind:'island'},{x:940,y:1050,r:45,seed:4,kind:'wreck'}];if(this.stage>0){for(const i of this.islands){i.seed+=this.stage*7;i.y=clamp(i.y+Math.sin(i.seed)*90,110,1090);i.r*=1+this.stage*.035;}}if(this.campaignActive){const chapter=this.campaignState?.chapter||0;for(const island of this.islands){island.seed+=chapter*13;island.x=clamp(island.x+Math.sin(island.seed)*60,100,1700);island.y=clamp(island.y+Math.cos(island.seed)*45,100,1100);}}this.islands.push({x:900,y:175,r:72,seed:31+this.stage*4,kind:'lighthouse',name:STAGES[this.stage].name,lit:this.mode==='menu'});}
 setupMenu(){
  const record=this.profile.best?`最佳航程 ${this.profile.best.toLocaleString()} 分 · 已点灯 ${this.profile.wins} 次`:'五片海域 · 五封来信 · 一盏等待重燃的灯';$('menuRecord').textContent=record;
  const saved=loadVoyage(storage.get('tidekeeper-voyage-v1',null));$('continueBtn').classList.toggle('hidden',!saved);
  let fleet=$('fleetSelect');if(!fleet){fleet=document.createElement('div');fleet.id='fleetSelect';fleet.className='fleet-select';$('startBtn').before(fleet);}
  fleet.innerHTML='<div class="eyebrow fleet-label">选择你的船 / YOUR VESSEL</div><div class="fleet-options">'+SHIPS.map(s=>`<button class="fleet-card ${s.id===this.ship?'selected':''}" data-ship="${s.id}" aria-pressed="${s.id===this.ship}"><strong>${s.name}</strong><small>${s.desc}</small></button>`).join('')+'</div>';
  fleet.querySelectorAll('[data-ship]').forEach(b=>b.onclick=()=>{this.ship=b.dataset.ship;this.audio.sfx('click');this.setupMenu();document.querySelector(`[data-ship="${this.ship}"]`)?.focus();});
  $('soundBtn').textContent=this.settings.mute?'♩':'♪';$('soundBtn').setAttribute('aria-label',this.settings.mute?'开启声音':'关闭声音');$('soundBtn').title=this.settings.mute?'声音：关':'声音：开';
 }
 bind(){
  $('startBtn').onclick=()=>{this.audio.init();this.newRun();};$('continueBtn').onclick=()=>{this.audio.init();this.resumeSaved();};
  $('guideBtn').onclick=()=>this.guide();$('archiveBtn').onclick=()=>this.archive();$('settingsBtn').onclick=()=>this.showSettings();
  $('pauseBtn').onclick=()=>this.pause();$('soundBtn').onclick=()=>{this.audio.init();this.settings.mute=!this.settings.mute;this.saveSettings();};
  window.addEventListener('keydown',e=>{
   if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)&&document.activeElement?.tagName!=='SELECT')e.preventDefault();
   if(e.code==='Tab'&&!$('modal').classList.contains('hidden')){e.preventDefault();this.nav(e.shiftKey?-1:1);return;}
   this.keys.add(e.code);if(e.repeat)return;
   this.audio.init();
   if(e.code==='Escape'){if(this.mode==='playing')this.pause();else if(this.mode==='paused')this.resume();else if(this.mode==='menu'&&!$('modal').classList.contains('hidden'))this.closeModal();return;}
   if(this.mode==='playing'){if(e.code==='Space'||e.code==='ShiftLeft')this.dash();if(e.code==='KeyE'||e.code==='KeyJ')this.pulse();if(e.code==='KeyP')this.pause();}
   else if(['ArrowDown','ArrowUp','KeyW','KeyS'].includes(e.code)&&document.activeElement?.tagName!=='SELECT')this.nav(e.code==='ArrowDown'||e.code==='KeyS'?1:-1);
   else if(e.code==='Space')this.activate();
  });window.addEventListener('keyup',e=>this.keys.delete(e.code));
  window.addEventListener('blur',()=>{this.keys.clear();this.pointer.down=false;if(this.mode==='playing')this.pause();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&this.mode==='playing')this.pause();});
  const c=$('gameCanvas');c.addEventListener('pointermove',e=>{this.pointer.x=e.clientX;this.pointer.y=e.clientY;this.pointer.active=true;});c.addEventListener('pointerdown',e=>{this.pointer.x=e.clientX;this.pointer.y=e.clientY;if(e.button===0)this.pointer.down=true;this.audio.init();if(e.button===2)this.pulse();});window.addEventListener('pointerup',()=>this.pointer.down=false);c.addEventListener('contextmenu',e=>e.preventDefault());
  window.addEventListener('gamepadconnected',()=>this.toast('手柄已连接 · 左摇杆航行，A 闪避，X 共鸣'));window.addEventListener('gamepaddisconnected',()=>{this.pad={x:0,y:0,ax:0,ay:0};if(this.mode==='playing')this.pause();});
  document.querySelectorAll('[data-dir]').forEach(b=>{const key={up:'KeyW',down:'KeyS',left:'KeyA',right:'KeyD'}[b.dataset.dir];b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);this.keys.add(key);});for(const ev of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(ev,()=>this.keys.delete(key));});
  $('touchDash').onpointerdown=e=>{e.preventDefault();this.dash();};$('touchPulse').onpointerdown=e=>{e.preventDefault();this.pulse();};
  if(matchMedia('(pointer: coarse)').matches)$('touchControls').classList.remove('hidden');
 }
 saveSettings(){storage.set('tidekeeper-settings-v1',this.settings);this.reducedMotion=this.settings.reduced;this.audio.setMuted(this.settings.mute);this.setupMenu();}
 focusables(){const root=$('modal').classList.contains('hidden')?$('menu'):$('modal');return [...root.querySelectorAll('button,select,input,summary')].filter(e=>!e.disabled&&e.getClientRects().length);}
 nav(direction){const list=this.focusables();if(!list.length)return;let i=list.indexOf(document.activeElement);list[(i+direction+list.length)%list.length].focus();this.audio.sfx('click');}
 activate(){const list=this.focusables();if(document.activeElement?.tagName==='SELECT'){const s=document.activeElement;s.selectedIndex=(s.selectedIndex+1)%s.options.length;s.dispatchEvent(new Event('change'));}else if(list.includes(document.activeElement))document.activeElement.click();else list[0]?.click();}
 pollPad(dt){
  let gp;try{gp=[...(navigator.getGamepads?.()||[])].find(p=>p?.connected);}catch{gp=null;}if(!gp){this.oldButtons=[];this.pad={x:0,y:0,ax:0,ay:0};$('padStatus').textContent='键鼠航行';return;}
  const dz=v=>Math.abs(v||0)>.18?v:0;this.pad={x:dz(gp.axes[0]),y:dz(gp.axes[1]),ax:dz(gp.axes[2]),ay:dz(gp.axes[3])};
  $('padStatus').textContent='● 手柄已连接';const b=gp.buttons.map(v=>v.pressed);const press=i=>b[i]&&!this.oldButtons[i];
  if(press(9)){this.audio.init();if(this.mode==='playing')this.pause();else if(this.mode==='paused')this.resume();}
  else if(this.mode==='playing'){if(press(0)||press(4))this.dash();if(press(2)||press(7)||press(5))this.pulse();}
  else{this.padNavTime-=dt;const axis=this.pad.y;const horizontal=this.pad.x; if((press(13)||press(15)||((axis>.6||horizontal>.6)&&this.padNavTime<=0))){this.nav(1);this.padNavTime=.24;}if((press(12)||press(14)||((axis<-.6||horizontal<-.6)&&this.padNavTime<=0))){this.nav(-1);this.padNavTime=.24;}if(press(0)){this.audio.init();this.activate();}if(press(1)){if(this.mode==='paused')this.resume();else if(this.mode==='menu')this.closeModal();}}
  this.oldButtons=b;
 }
 modal(html,mode){if(mode)this.mode=mode;$('modalContent').innerHTML=html;$('modal').classList.remove('hidden');requestAnimationFrame(()=>this.focusables()[0]?.focus());}
 closeModal(){$('modal').classList.add('hidden');if(this.mode==='menu')$('startBtn').focus();}
 toast(text){$('toast').textContent=text;$('toast').classList.remove('hidden');$('toast').classList.add('visible');clearTimeout(this.toastTimer);this.toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3400);}
 newRun({campaign=false}={}){
  this.campaignActive=campaign;if(!campaign)storage.remove('tidekeeper-voyage-v1');this.difficulty=$('difficulty').value;const s=SHIPS.find(s=>s.id===this.ship);this.runTime=0;this.score=0;this.combo=0;this.comboTimer=0;this.salvageCount=0;this.shells=0;this.kills=0;this.level=1;this.xp=0;this.nextXp=12;this.stage=0;this.upgradeCounts={};this.stageKills=0;this.stageTime=0;this.stageHits=0;this.dashCount=0;this.pendingLevel=0;this.spawnTimer=1;this.autosave=0;this.bossActive=false;this.bossDefeated=false;this.cleared=false;this.regen=0;this.fireTimer=.2;
  this.player={x:900,y:620,r:16,angle:-Math.PI/2,hp:s.hp,maxHp:s.hp,speed:s.speed,damage:s.damage,fireRate:s.rate,dashCD:0,dashMax:2.3,dashTime:0,dashX:0,dashY:-1,pulseCD:0,pulseMax:9,invuln:0,multishot:1,pierce:0,magnet:110,crit:.05};this.resetArrays();this.makeIslands();this.beacons=[{x:900,y:340,r:45,active:false}];this.camera={x:900,y:600};this.target=null;this.beginUI();if(!campaign)this.dialog(INTRO,()=>this.beginStage());
 }
 beginUI(){$('menu').classList.add('hidden');$('hud').classList.remove('hidden');$('controlsHint').classList.remove('hidden');}
 beginStage(){
  this.mode='playing';this.closeModal();this.makeIslands();this.eliteSpawned=false;this.stageKills=0;this.stageTime=0;this.stageHits=0;this.spawnTimer=1;this.bossActive=false;this.bossDefeated=false;this.cleared=false;this.enemies=[];this.bullets=[];this.pickups=[];this.beacons=[{x:900,y:290,r:45,active:false}];
  this.player.x=900;this.player.y=680;this.player.invuln=2;this.camera={x:900,y:680};this.toast(`${STAGES[this.stage].name} · ${this.stage===4?'击败深海守望者':'击退迷雾舰队，点亮航标'}`);this.saveVoyage();
 }
 dialog(lines,done,index=0){
  if(index>=lines.length){done();return;}const line=lines[index];
  this.modal(`<div class="dialogue-layout"><div class="dialogue-portrait">${portraitSVG(line.portrait||'keeper')}</div><div><div class="eyebrow">海上来信 / VOICES OF THE TIDE</div><h2 class="dialogue-speaker">${line.speaker}</h2><p class="dialogue-text">${line.text}</p><div class="dialogue-progress">${lines.map((_,i)=>`<i class="${i===index?'active':''}"></i>`).join('')}</div></div></div><div class="actions"><span class="muted">${index+1} / ${lines.length} · Enter / A 继续</span><button class="primary" id="nextDialogue">${index===lines.length-1?'扬帆启航':'继续'} <span>→</span></button></div>`,'dialog');
  $('nextDialogue').onclick=()=>{this.audio.sfx('click');this.dialog(lines,done,index+1);};
 }
 addAchievement(id){if(!this.profile.achievements.includes(id)){this.profile.achievements.push(id);storage.set('tidekeeper-profile-v1',this.profile);const a=ACHIEVEMENTS.find(a=>a[0]===id);this.toast(`航海成就 · ${a[1]}`);}}
 receiveLetter(){const s=this.stage;if(!this.profile.letters.includes(s))this.profile.letters.push(s);if(this.profile.letters.length===5)this.addAchievement('collector');storage.set('tidekeeper-profile-v1',this.profile);}
 clearStage(){
  if(this.cleared)return;this.cleared=true;this.receiveLetter();this.audio.sfx('beacon');if(this.stageHits===0)this.addAchievement('untouched');this.score+=500+Math.round(this.player.hp*2);this.player.hp=Math.min(this.player.maxHp,this.player.hp+30);this.enemies=[];this.bullets=[];this.saveVoyage();this.showDelivery();
 }
 showDelivery(){
  this.dialog(STAGES[this.stage].dialogue,()=>{
   this.modal(`<div class="eyebrow">LETTER ${String(this.stage+1).padStart(2,'0')} / 已送达</div><h2>${STAGES[this.stage].letterTitle}</h2><blockquote class="letter-text">${STAGES[this.stage].letter}</blockquote><p class="muted">航标的光穿过了雾。船体已修复 30 点。下一片海域有新的风。</p><div class="actions"><button class="primary" id="nextSea">${this.stage===4?'点亮归潮灯塔 →':'驶向 '+STAGES[this.stage+1].name+' →'}</button></div>`,'dialog');
   $('nextSea').onclick=()=>{if(this.stage===4)this.dialog(ENDING,()=>this.finish(true));else{this.stage++;this.beginStage();}};
  });
 }
 chooseUpgrade(){
  this.mode='upgrade';const pool=UPGRADES.filter(u=>(!this.campaignCanUpgrade||this.campaignCanUpgrade(u.id))).filter(u=>!['multishot','pierce','regen'].includes(u.id)||(this.upgradeCounts[u.id]||0)<(u.id==='multishot'?3:u.id==='pierce'?3:2));
  const choices=[];while(choices.length<3&&pool.length){choices.push(pool.splice(Math.floor(Math.random()*pool.length),1)[0]);}
  this.modal(`<div class="eyebrow">SALVAGED RELICS / 航海遗物</div><h2>风，带来新的可能。</h2><p class="muted">等级 ${this.level} · 选择一件遗物。本次航程永久生效，可叠加。</p><div class="upgrade-grid">${choices.map((u,i)=>`<button class="upgrade-card" id="upgrade${i}"><div class="card-icon">${u.icon}</div><span class="eyebrow">${u.rarity||'航海遗物'}</span><h3 class="card-title">${u.name}</h3><p class="card-description">${u.description}</p><span class="card-foot">${this.upgradeCounts[u.id]?'已拥有 ×'+this.upgradeCounts[u.id]:'全新发现'}　 ↗</span></button>`).join('')}</div><p class="muted">方向键 / 左摇杆选择 · Enter / A 确认</p>`,'upgrade');
  choices.forEach((u,i)=>$('upgrade'+i).onclick=()=>{this.applyUpgrade(u.id);this.audio.sfx('upgrade');this.pendingLevel--;if(this.pendingLevel>0)this.chooseUpgrade();else {this.mode='playing';this.closeModal();this.saveVoyage();}});
 }
 applyUpgrade(id){const p=this.player;this.upgradeCounts[id]=(this.upgradeCounts[id]||0)+1;switch(id){case'damage':p.damage*=1.25;break;case'rate':p.fireRate*=.85;break;case'speed':p.speed*=1.12;break;case'hull':p.maxHp+=25;p.hp=Math.min(p.maxHp,p.hp+25);break;case'heal':p.hp=Math.min(p.maxHp,p.hp+60);break;case'multishot':p.multishot++;break;case'pierce':p.pierce++;break;case'magnet':p.magnet*=1.55;break;case'pulse':p.pulseMax*=.8;break;case'dash':p.dashMax*=.8;break;case'crit':p.crit=Math.min(.9,p.crit+.12);break;case'regen':this.regen+=2;break;}}
 moveInput(){let x=(this.keys.has('KeyD')||this.keys.has('ArrowRight')?1:0)-(this.keys.has('KeyA')||this.keys.has('ArrowLeft')?1:0)+this.pad.x;let y=(this.keys.has('KeyS')||this.keys.has('ArrowDown')?1:0)-(this.keys.has('KeyW')||this.keys.has('ArrowUp')?1:0)+this.pad.y;const l=Math.hypot(x,y);if(l>1){x/=l;y/=l;}return{x,y};}
 dash(){if(this.mode!=='playing'||this.player.dashCD>0)return;const p=this.player,m=this.moveInput();let l=Math.hypot(m.x,m.y);p.dashX=l>.1?m.x/l:Math.cos(p.angle);p.dashY=l>.1?m.y/l:Math.sin(p.angle);p.dashTime=.22;p.invuln=.42;p.dashCD=p.dashMax;this.dashCount++;this.audio.sfx('dash');this.effect(p.x,p.y,50,'dash',.3);}
 pulse(){if(this.mode!=='playing'||this.player.pulseCD>0)return;const p=this.player;p.pulseCD=p.pulseMax;this.effect(p.x,p.y,285,'pulse',.7);this.shake=this.settings.reduced?0:6;this.audio.sfx('pulse');this.bullets=this.bullets.filter(b=>!b.enemy||dist(b,p)>300);for(const e of [...this.enemies])if(dist(e,p)<285+e.r){this.damageEnemy(e,p.damage*3);const a=Math.atan2(e.y-p.y,e.x-p.x);e.x+=Math.cos(a)*55;e.y+=Math.sin(a)*55;}for(const item of this.pickups)if(dist(item,p)<400)item.magnet=true;}
 effect(x,y,r,type,life,color){this.effects.push({x,y,r,type,life,maxLife:life,color});}
 burst(x,y,color,n=10){if(this.settings.reduced)n=Math.ceil(n/3);for(let i=0;i<n;i++){const a=Math.random()*TAU,s=25+Math.random()*100,life=.3+Math.random()*.5;this.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,r:2+Math.random()*3,life,maxLife:life,color});}}
 float(x,y,text,color='#f7ecd3'){this.floaters.push({x,y,text:String(text),life:.9,maxLife:.9,color});}
 hurt(n){const p=this.player;if(p.invuln>0||this.mode!=='playing')return;const mult=this.difficulty==='story'?.58:this.difficulty==='storm'?1.35:1;p.hp-=n*mult;p.invuln=1;this.stageHits++;this.combo=0;this.comboTimer=0;this.shake=this.settings.reduced?0:9;this.audio.sfx('hurt');this.burst(p.x,p.y,'#f1a188',12);this.float(p.x,p.y-30,'−'+Math.round(n*mult),'#ffba9a');if(p.hp<=0){p.hp=0;this.finish(false);}}
 damageEnemy(e,n){if(e.dead)return;const crit=Math.random()<this.player.crit;n=Math.round(n*(crit?1.9:1));e.hp-=n;e.flash=.1;this.float(e.x,e.y-e.r,n,crit?'#f6cc75':'#f5e9cc');this.burst(e.x,e.y,'#d9c79e',3);this.audio.sfx('hit');if(e.hp<=0){e.dead=true;this.kills++;this.stageKills++;this.combo=(this.combo||0)+1;this.comboTimer=4;const base=e.type==='boss'?2000:e.type==='brute'?100:40;this.score+=Math.round(base*(1+Math.min(this.combo-1,20)*.1));if(this.combo>=3)this.float(e.x,e.y-e.r-20,'连击 ×'+this.combo,'#f1d18b');const value=e.type==='boss'?40:e.type==='brute'?9:3;this.pickups.push({x:e.x,y:e.y,r:5,type:'xp',value});if(Math.random()<.24)this.pickups.push({x:e.x+15,y:e.y,r:6,type:'shell',value:1+Math.floor(Math.random()*3)});if(Math.random()<.12||e.type==='brute')this.pickups.push({x:e.x-15,y:e.y,r:8,type:'heal',value:12});this.burst(e.x,e.y,'#e7b275',20);if(e.type==='boss'){this.bossDefeated=true;this.bossActive=false;}this.audio.sfx('pickup');}}
 spawn(type,angle){
  const p=this.player,a=angle??Math.random()*TAU;let x=clamp(p.x+Math.cos(a)*650,50,1750),y=clamp(p.y+Math.sin(a)*520,50,1150);
  if(Math.hypot(x-p.x,y-p.y)<280){x=p.x<900?1720:80;y=clamp(p.y+Math.sin(a)*350,60,1140);}
  const stats={skiff:[40,69,16],ray:[26,113,14],gunner:[52,40,20],brute:[160,47,29],boss:[2800,38,70]}[type];const scale=1+this.stage*.24;const hp=stats[0]*(type==='boss'?(this.difficulty==='story'?.75:1):scale);
  const e={x,y,r:stats[2],type,hp,maxHp:hp,speed:stats[1]*(1+this.stage*.06),angle:a+Math.PI,flash:0,attack:1.5+Math.random(),age:0,windup:0};
  if(type==='boss'){e.x=900;e.y=250;this.bossActive=true;this.toast('深海守望者醒来了 · 共鸣可以消除弹幕');}this.enemies.push(e);this.effect(e.x,e.y,e.r+20,'warning',1.2,'#d88d72');return e;
 }
 shoot(){const p=this.player;let angle=p.angle;let enemy=null,nearest=650;for(const e of this.enemies){const d=dist(e,p);if(!e.dead&&d<nearest){enemy=e;nearest=d;}}
  const aim=Math.hypot(this.pad.ax,this.pad.ay)>.3;
  if(aim)angle=Math.atan2(this.pad.ay,this.pad.ax);else if(this.pointer.down){const t=this.renderer.screenToWorld(this.pointer.x,this.pointer.y);angle=Math.atan2(t.y-p.y,t.x-p.x);}else if(enemy)angle=Math.atan2(enemy.y-p.y,enemy.x-p.x);else return;
  p.angle=angle;for(let i=0;i<p.multishot;i++){const a=angle+(i-(p.multishot-1)/2)*.13;this.bullets.push({x:p.x+Math.cos(a)*22,y:p.y+Math.sin(a)*22,vx:Math.cos(a)*520,vy:Math.sin(a)*520,r:4,enemy:false,damage:p.damage,pierce:p.pierce,life:1.6,hit:[]});}this.audio.sfx('shoot');this.burst(p.x+Math.cos(angle)*26,p.y+Math.sin(angle)*26,'#ffe2a5',3);
 }
 enemyBullet(e,a,s=170){this.bullets.push({x:e.x+Math.cos(a)*(e.r+5),y:e.y+Math.sin(a)*(e.r+5),vx:Math.cos(a)*s,vy:Math.sin(a)*s,r:e.type==='boss'?7:5,enemy:true,life:7});}
 update(dt){
  const p=this.player;this.runTime+=dt;this.stageTime+=dt;this.comboTimer=Math.max(0,(this.comboTimer||0)-dt);if(this.comboTimer<=0)this.combo=0;this.fireTimer-=dt;this.spawnTimer-=dt;this.autosave+=dt;p.invuln=Math.max(0,p.invuln-dt);p.dashCD=Math.max(0,p.dashCD-dt);p.pulseCD=Math.max(0,p.pulseCD-dt);p.hp=Math.min(p.maxHp,p.hp+this.regen*dt+(this.difficulty==='story'?.7*dt:0));
  const m=this.moveInput();if(p.dashTime>0){p.dashTime-=dt;p.x+=p.dashX*820*dt;p.y+=p.dashY*820*dt;this.burst(p.x,p.y,'#b9e6d6',1);}else{p.x+=m.x*p.speed*dt;p.y+=m.y*p.speed*dt;if(Math.hypot(m.x,m.y)>.15)p.angle=Math.atan2(m.y,m.x);}
  p.x=clamp(p.x,30,1770);p.y=clamp(p.y,30,1170);
  for(const island of this.islands){if(island.kind==='wreck')continue;const r=island.r*.72+p.r,d=dist(p,island);if(d<r){const a=Math.atan2(p.y-island.y,p.x-island.x);p.x=island.x+Math.cos(a)*r;p.y=island.y+Math.sin(a)*r;}}
  for(const wreck of this.islands.filter(i=>i.kind==='wreck'&&!i.salvaged)){
   if(dist(p,wreck)<85){wreck.salvageProgress=(wreck.salvageProgress||0)+dt;if(wreck.salvageProgress>=1.4){wreck.salvaged=true;this.salvageCount=(this.salvageCount||0)+1;this.shells+=4;this.score+=180;this.pickups.push({x:wreck.x,y:wreck.y,r:9,type:'xp',value:8},{x:wreck.x+14,y:wreck.y,r:8,type:'heal',value:15});this.burst(wreck.x,wreck.y,'#eed39a',18);this.audio.sfx('beacon');this.toast('打捞成功 · 旧船里仍藏着星光与补给');}}else wreck.salvageProgress=Math.max(0,(wreck.salvageProgress||0)-dt*.5);
  }
  if(this.fireTimer<=0){this.shoot();this.fireTimer=Math.max(.09,p.fireRate);}
  if(!this.campaignActive){
  const quota=[16,23,30,36,0][this.stage];const active=this.beacons[0].active;
  if(this.stage>0&&this.stage<4&&!this.eliteSpawned&&this.stageKills>=Math.floor(quota/2)){this.eliteSpawned=true;this.spawn('brute');this.toast('迷雾重舰进入航道 · 留意环形弹幕');}
  if(this.stage===4&&this.stageTime>3&&!this.bossActive&&!this.bossDefeated)this.spawn('boss');
  if(!active&&this.spawnTimer<=0&&this.enemies.length<(this.stage===4?16:22)){
   const count=this.stage>=2?2:1;for(let i=0;i<count;i++){const r=Math.random();this.spawn(r<.18+.03*this.stage?'gunner':r<.43?'ray':r>.92&&this.stage>0?'brute':'skiff');}
   this.spawnTimer=Math.max(.8,1.6-this.stage*.14-(this.difficulty==='storm'?.25:0));
  }
  if((this.stage<4&&this.stageKills>=quota)||(this.stage===4&&this.bossDefeated)){if(!active){this.beacons[0].active=true;this.islands.filter(i=>i.kind==='lighthouse').forEach(i=>i.lit=true);this.bullets=this.bullets.filter(b=>!b.enemy);this.toast('航标已唤醒 · 驶入金色光环送达信件');this.audio.sfx('beacon');}if(dist(p,this.beacons[0])<65){this.clearStage();return;}}
  }
  for(const e of this.enemies){
   if(e.dead)continue;e.age+=dt;e.flash=Math.max(0,e.flash-dt);e.attack-=dt;if(e.age<1.2){e.windup=0;continue;}const enemyTarget=this.campaignActive?(this.campaignMission?.enemyTarget?.(e)||p):p;const d=dist(e,enemyTarget),a=Math.atan2(enemyTarget.y-e.y,enemyTarget.x-e.x);e.angle=a;let vx=Math.cos(a),vy=Math.sin(a);
   if(e.type==='gunner'&&d<300){vx=-vx*.6;vy=-vy*.6;}
   if(e.type==='ray'){const zig=Math.sin(e.age*3)*.5;vx=Math.cos(a+zig);vy=Math.sin(a+zig);}
   if(e.type==='boss'){
    e.windup=e.attack<.65?1-e.attack/.65:0;const phase=e.hp<e.maxHp*.5;
    if(d<240){vx*=-.3;vy*=-.3;}
    if(e.attack<=0){if(phase&&Math.floor(e.age/8)%2===0){for(let k=0;k<16;k++)this.enemyBullet(e,e.age*.5+k*TAU/16,130);}else {for(let k=-2;k<=2;k++)this.enemyBullet(e,a+k*.21,phase?195:160);}e.attack=phase?1.2:1.65;}
   }else if(e.type==='gunner'&&e.attack<=0&&d<700){this.enemyBullet(e,a,150+this.stage*12);if(this.stage>=2){this.enemyBullet(e,a-.2,155);this.enemyBullet(e,a+.2,155);}e.attack=2.5;}
   else if(e.type==='brute'){e.windup=e.attack<.6?1:0;if(e.attack<=0){for(let k=0;k<8;k++)this.enemyBullet(e,k*TAU/8,120);e.attack=3.3;}}
   if(e.age>.8){e.x+=vx*e.speed*dt;e.y+=vy*e.speed*dt;}
   e.x=clamp(e.x,25,1775);e.y=clamp(e.y,25,1175);
   // Separate vessels to keep crowds legible.
   for(const other of this.enemies){if(other===e||other.dead)continue;const od=dist(e,other),rr=e.r+other.r;if(od<rr&&od>.01){e.x+=(e.x-other.x)/od*35*dt;e.y+=(e.y-other.y)/od*35*dt;}}
   if(dist(e,p)<e.r+p.r-3){if(p.dashTime>0)this.damageEnemy(e,p.damage*dt*5);else this.hurt(e.type==='boss'?30:e.type==='brute'?24:16);if(this.mode!=='playing')return;}
  }
  for(const b of this.bullets){b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;if(b.enemy){if(dist(b,p)<b.r+p.r-3){this.hurt(13);b.life=0;if(this.mode!=='playing')return;}}else for(const e of this.enemies){if(!e.dead&&!b.hit.includes(e)&&dist(e,b)<e.r+b.r){b.hit.push(e);this.damageEnemy(e,b.damage);if(b.hit.length>b.pierce){b.life=0;break;}}}}
  this.bullets=this.bullets.filter(b=>b.life>0&&b.x>-60&&b.x<1860&&b.y>-60&&b.y<1260);this.enemies=this.enemies.filter(e=>!e.dead);
  for(const item of this.pickups){const d=dist(item,p);if(d<p.magnet||item.magnet){const s=320+this.player.speed;const step=Math.min(d,s*dt);item.x+=(p.x-item.x)/Math.max(d,1)*step;item.y+=(p.y-item.y)/Math.max(d,1)*step;}if(dist(item,p)<25){item.taken=true;if(item.type==='xp'){this.xp+=item.value;while(this.xp>=this.nextXp){this.xp-=this.nextXp;this.level++;this.nextXp=Math.round(this.nextXp*1.18+3);this.pendingLevel++;}}else if(item.type==='heal'){p.hp=Math.min(p.maxHp,p.hp+item.value);this.float(p.x,p.y-20,'+'+item.value,'#a4e2b9');}else{this.shells+=item.value;this.score+=item.value*25;}this.audio.sfx('pickup');}}
  this.pickups=this.pickups.filter(i=>!i.taken);if(this.pendingLevel>0){this.chooseUpgrade();return;}if(this.autosave>8){this.autosave=0;this.saveVoyage();}
 }
 updateCosmetics(dt){for(const e of this.effects)e.life-=dt;this.effects=this.effects.filter(e=>e.life>0);for(const f of this.floaters){f.life-=dt;f.y-=24*dt;}this.floaters=this.floaters.filter(f=>f.life>0);for(const v of this.particles){v.life-=dt;v.x+=v.vx*dt;v.y+=v.vy*dt;v.vx*=1-dt*2;v.vy*=1-dt*2;}this.particles=this.particles.filter(v=>v.life>0);if(this.particles.length>450)this.particles.splice(0,this.particles.length-450);this.shake*=Math.pow(.015,dt);}
 updateHUD(){const p=this.player;$('regionLabel').textContent=STAGES[this.stage].name;$('objectiveLabel').textContent=this.beacons[0]?.active?'驶入金色航标 · 送达信件':this.stage===4?'击败守望者 · 闪避预警，使用共鸣清弹':'击退迷雾舰队 · 收集星光升级';$('hpFill').style.width=clamp(p.hp/p.maxHp*100,0,100)+'%';$('hpText').textContent=`${Math.ceil(p.hp)} / ${p.maxHp}`;$('xpFill').style.width=(this.xp/this.nextXp*100)+'%';$('levelText').textContent='LV. '+this.level;$('shellText').textContent=this.shells;$('scoreText').textContent=this.score.toLocaleString();$('waveText').textContent=this.stage===4?(this.bossDefeated?'守望者已安息':'终章 · 深海守望者'):`航标进度 ${Math.min(this.stageKills,[16,23,30,36][this.stage])} / ${[16,23,30,36][this.stage]}`;$('dashFill').style.width=((1-p.dashCD/p.dashMax)*100)+'%';$('pulseFill').style.width=((1-p.pulseCD/p.pulseMax)*100)+'%';$('abilityHint').textContent=p.pulseCD<=0?'共鸣已就绪 · 清除弹幕':`共鸣充能 ${p.pulseCD.toFixed(1)}s`;}
 frame(now){$('touchControls').classList.toggle('hidden',!matchMedia('(pointer: coarse)').matches||this.mode!=='playing');const dt=Math.min((now-this.last)/1000,.04);this.last=now;this.pollPad(dt);if(this.mode==='playing'){this.time+=dt;if(this.campaignActive)this.updateCampaign(dt);if(this.mode==='playing')this.update(dt);this.updateHUD();this.audio.update(dt,this.bossActive?1:.3);}else if(this.mode==='menu'){this.time+=dt;this.player.x=900+Math.sin(this.time*.08)*110;this.player.y=600+Math.cos(this.time*.1)*70;this.player.angle=-.5+Math.sin(this.time*.1)*.2;}
  if(this.campaignActive&&this.mode!=='playing')this.updateCampaign(dt);if(this.mode!=='paused')this.updateCosmetics(dt);this.renderer.render(this,dt);requestAnimationFrame(t=>this.frame(t));}
 pause(){if(this.mode!=='playing')return;const saved=this.saveVoyage();this.modal(`<div class="eyebrow">A MOMENT IN THE TIDE</div><h2>把风停在这一刻。</h2><p class="muted">${STAGES[this.stage].name} · 已航行 ${this.formatTime(this.runTime)} · ${saved?'航程已自动保存':'浏览器未能保存，请保持此页开启'}</p><div class="actions vertical"><button class="primary" id="resumeBtn">继续航行 <span>Esc / Start</span></button><button class="secondary" id="pauseGuide">航行指南</button><button class="secondary" id="quitBtn">保存并回到港口</button></div>`,'paused');$('resumeBtn').onclick=()=>this.resume();$('quitBtn').onclick=()=>this.toMenu();$('pauseGuide').onclick=()=>this.guide(true);}
 resume(){this.mode='playing';this.keys.clear();this.closeModal();}
 toMenu(){clearTimeout(this.toastTimer);$('toast').classList.remove('visible');this.mode='menu';this.closeModal();$('hud').classList.add('hidden');$('controlsHint').classList.add('hidden');$('menu').classList.remove('hidden');this.resetArrays();this.player={x:900,y:600,r:16,angle:-.5,hp:120,maxHp:120};this.setupMenu();$('startBtn').focus();}
 formatTime(t){return Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0');}
 saveVoyage(){if(!this.player.fireRate)return;const fields=['difficulty','ship','runTime','score','shells','kills','level','xp','nextXp','stage','upgradeCounts','stageKills','stageTime','stageHits','dashCount','pendingLevel','spawnTimer','bossActive','bossDefeated','cleared','regen','fireTimer','eliteSpawned','combo','comboTimer','salvageCount','player','enemies','pickups','beacons'];const data={version:1,phase:this.cleared?'letter':'combat',salvaged:this.islands.filter(i=>i.kind==='wreck').map(i=>!!i.salvaged)};for(const k of fields)data[k]=this[k];const ok=storage.set('tidekeeper-voyage-v1',data);if(!ok&&!this.saveFailedNotified){this.toast('浏览器未能保存进度，请保持此页开启。');this.saveFailedNotified=true;}if(ok)this.saveFailedNotified=false;return ok;}
 resumeSaved(){const s=loadVoyage(storage.get('tidekeeper-voyage-v1',null));if(!s){storage.remove('tidekeeper-voyage-v1');this.setupMenu();this.toast('这份航程无法恢复，可以从港口重新启航。');return;}this.resetArrays();Object.assign(this,s);this.mode='playing';this.bullets=[];this.autosave=0;this.camera={x:this.player.x,y:this.player.y};this.makeIslands();this.islands.filter(i=>i.kind==='lighthouse').forEach(i=>i.lit=!!this.beacons[0]?.active);this.islands.filter(i=>i.kind==='wreck').forEach((w,i)=>w.salvaged=!!s.salvaged?.[i]);this.beginUI();this.closeModal();if(s.phase==='letter')this.showDelivery();else this.toast('航程已恢复 · 海风还在等你');}
 finish(won){
  if(this.mode==='won'||this.mode==='lost')return;storage.remove('tidekeeper-voyage-v1');this.profile.runs++;this.profile.kills+=this.kills;this.profile.best=Math.max(this.profile.best,this.score);this.addAchievement('first');if(this.profile.kills>=100)this.addAchievement('hundred');if(won){this.profile.wins++;this.addAchievement('keeper');if(this.difficulty==='storm')this.addAchievement('storm');}storage.set('tidekeeper-profile-v1',this.profile);this.audio.sfx(won?'win':'lose');
  this.modal(`<div class="eyebrow">${won?'ALL LETTERS DELIVERED / 远航完成':'EVERY VOYAGE LEAVES A LIGHT / 航程结束'}</div><div class="end-emblem">${won?'☼':'⚓'}</div><h2>${won?'灯亮了。有人在等你回家。':'海会记得，每一个出发的人。'}</h2><p>${won?'五封信抵达了岸边。那些以为失散的人，终于看到了彼此的灯火。':'船停在了雾里，信件却被海鸟送回港口。重新搭配遗物，下一次你会走得更远。'}</p><div class="stat-grid"><div class="stat"><strong>${this.score.toLocaleString()}</strong><span>航程得分</span></div><div class="stat"><strong>${this.kills}</strong><span>击退敌人</span></div><div class="stat"><strong>${this.formatTime(this.runTime)}</strong><span>航行时间</span></div><div class="stat"><strong>${this.level}</strong><span>最终等级</span></div></div><div class="actions"><button class="secondary" id="endPort">返回港口</button><button class="primary" id="againBtn">再一次，向海而行 →</button></div>`,won?'won':'lost');$('endPort').onclick=()=>this.toMenu();$('againBtn').onclick=()=>this.newRun();
 }
 guide(paused=false){this.modal(`<div class="eyebrow">CAPTAIN’S HANDBOOK / 航行指南</div><h2>跟随灯光，把信送到。</h2><p>自动舰炮会瞄准最近的敌人。你只需要掌舵、闪避，并在危险逼近时释放共鸣。收集击沉敌人留下的星光，选择遗物组成你的航海流派。</p><div class="guide-grid"><div><h3>⌨ 键盘与鼠标</h3><p><kbd>WASD</kbd> / <kbd>方向键</kbd> 航行<br><kbd>Space</kbd> / <kbd>Shift</kbd> 无敌闪避<br><kbd>E</kbd> / 鼠标右键 共鸣清弹<br>按住鼠标左键 手动瞄准<br><kbd>Esc</kbd> / <kbd>P</kbd> 暂停</p></div><div><h3>◉ 标准手柄</h3><p>左摇杆 航行 · 右摇杆 瞄准<br><kbd>A / ✕</kbd> 或 <kbd>LB / L1</kbd> 闪避<br><kbd>X / □</kbd> 或 <kbd>RT / R2</kbd> 共鸣<br><kbd>Start / Options</kbd> 暂停<br>摇杆/十字键 选项 · A 确认 · B 返回</p></div></div><p class="muted">靠近沉船停留片刻可以打捞星光与补给。连续击退敌人可获得连击加分，受伤会中断连击。潮贝会转化为航程得分。金色航标出现后驶入光环送信；每个航标修复 30 船体。共鸣伤害附近敌人、清除周围弹幕并吸引战利品。迷雾没有时间限制，保持移动，先处理远程炮艇。</p><div class="actions"><button class="primary" id="guideClose">明白了，船长 →</button></div>`);$('guideClose').onclick=()=>paused?this.pauseFromGuide():this.closeModal();}
 pauseFromGuide(){this.mode='playing';this.pause();}
 archive(){const letters=this.profile.letters;this.modal(`<div class="eyebrow">LETTERS & MEMORIES / 航海档案</div><h2>有些话，值得漂洋过海。</h2><div class="archive-list">${STAGES.map((s,i)=>`<details ${letters.includes(i)?'':'class="locked"'}><summary>${letters.includes(i)?'✉':'◇'}　${letters.includes(i)?s.letterTitle:`第 ${i+1} 封信 · 尚未送达`}</summary>${letters.includes(i)?`<p class="letter-text">${s.letter}</p>`:'<p>完成对应海域，即可将这封信带回港口。</p>'}</details>`).join('')}</div><h3>航海成就 · ${this.profile.achievements.length} / ${ACHIEVEMENTS.length}</h3><div class="achievement-grid">${ACHIEVEMENTS.map(([id,n,d])=>`<div class="achievement ${this.profile.achievements.includes(id)?'unlocked':''}"><strong>${this.profile.achievements.includes(id)?'✦':'◇'} ${n}</strong><small>${d}</small></div>`).join('')}</div><div class="actions"><button class="primary" id="archiveClose">回到港口 →</button></div>`);$('archiveClose').onclick=()=>this.closeModal();}
 showSettings(){this.modal(`<div class="eyebrow">SET YOUR SAIL / 航行设置</div><h2>按你的节奏，听海。</h2><label class="setting-row"><span>音乐与音效<small>原创合成器海上旋律</small></span><input type="checkbox" id="audioCheck" ${!this.settings.mute?'checked':''}></label><label class="setting-row"><span>减少动态效果<small>降低镜头震动与粒子数量</small></span><input type="checkbox" id="reduceCheck" ${this.settings.reduced?'checked':''}></label><p class="muted">进度保存在当前浏览器中。航行中每 8 秒自动存档，也可暂停后保存回港。声音需要首次点击后启用。</p><div class="actions"><button class="primary" id="settingsClose">保存设置 →</button></div>`);$('settingsClose').onclick=()=>{this.audio.init();this.settings.mute=!$('audioCheck').checked;this.settings.reduced=$('reduceCheck').checked;this.saveSettings();this.closeModal();};}
}
const game=new Game();installCampaign(game);
if(new URLSearchParams(location.search).has('test'))window.__game=game;
