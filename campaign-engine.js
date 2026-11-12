/** Story campaign objectives. All time advances through the normal game update loop. */
const TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const finite=(v,min,max,fallback)=>Number.isFinite(v)&&v>=min&&v<=max?v:fallback;
const integer=(v,min,max,fallback)=>Number.isInteger(v)&&v>=min&&v<=max?v:fallback;
const copy=v=>JSON.parse(JSON.stringify(v));
const POINTS=[{x:360,y:300},{x:1400,y:370},{x:1450,y:960},{x:480,y:900}];
const ROUTE=[{x:390,y:680},{x:390,y:280},{x:1380,y:280},{x:1450,y:600},{x:1380,y:930},{x:480,y:900},{x:480,y:580},{x:1150,y:580},{x:900,y:330}];
const M=(type,title,extra={})=>Object.freeze({type,title,...extra});
const PLANS=Object.freeze([
 [M('rescue','雾中的求救', {sites:3,quota:20}),M('salvage','找回失踪的邮袋',{sites:4,quota:24}),M('defend','守住盐花渡的灯',{duration:90,quota:30})],
 [M('escort','第一支补给船队',{speed:56}),M('rescue','把落水的人带回来',{sites:4,quota:26}),M('hunt','截断掠夺者航线',{captains:3})],
 [M('salvage','铜铃工坊的零件',{sites:4,quota:30}),M('defend','让炉火再亮一次',{duration:105,quota:36}),M('hunt','追踪无声的炮艇',{captains:3})],
 [M('rescue','纸船没有停在岸边',{sites:4,quota:28}),M('race','穿过回声航道',{laps:2,quota:32}),M('escort','送孩子们回家',{speed:58})],
 [M('escort','老船长的最后一班渡船',{speed:55}),M('hunt','追上黑帆的见证人',{captains:3}),M('boss','沉钟第一次回响',{boss:'bell',quota:20})],
 [M('salvage','水下档案馆',{sites:4,quota:32}),M('rescue','不能留在黑暗里的名字',{sites:4,quota:32}),M('defend','护住被改写的航海日志',{duration:120,quota:44})],
 [M('escort','暴风前的撤离',{speed:54}),M('race','追赶退潮的缺口',{laps:2,quota:36}),M('defend','直到最后一个人上船',{duration:135,quota:48})],
 [M('defend','灯火节的第一盏灯',{duration:125,quota:46}),M('rescue','把散落的灯火带回来',{sites:4,quota:34}),M('escort','一艘船也不能少',{speed:54})],
 [M('salvage','沉船仍然记得',{sites:4,quota:36}),M('hunt','迷雾舰队的证词',{captains:3}),M('boss','白骨礁的守门人',{boss:'reef',quota:24})],
 [M('escort','送往议会的证据',{speed:52}),M('defend','守住不同的声音',{duration:140,quota:50}),M('race','让十二座浮标同时亮起',{laps:2,quota:40})],
 [M('race','没有星图的航道',{laps:2,quota:42}),M('hunt','深海之门的三把钥匙',{captains:3}),M('boss','风暴中留出的路',{boss:'storm',quota:28})],
 [M('rescue','把最后的名字喊回来',{sites:4,quota:38}),M('defend','归航以前，灯不能灭',{duration:150,quota:54}),M('boss','归潮：向海发出邀请',{boss:'heart',quota:32})],
].map(legs=>Object.freeze(legs)));
const LABELS={rescue:'海上救援',salvage:'遗迹打捞',defend:'灯塔防线',escort:'护航任务',hunt:'追猎重舰',race:'穿越航道',boss:'首领战'};
const OBJECT_TYPES=new Set(['convoy','survivor','cache','signal','gate']);
const ENEMY_TYPES=new Set(['skiff','ray','gunner','brute','boss']);

export class CampaignEngine {
 static plans=PLANS;
 constructor(game){this.game=game;this.chapter=0;this.leg=0;this.completed=false;this.transitioning=true;this.ui={label:'远航准备',objective:'',progress:'',type:'rescue'};this.elapsed=0;this.clock=finite(game.campaignClock,0,1e8,0);this.state={};}
 get spec(){return PLANS[this.chapter][this.leg];}
 get kind(){return this.spec.type;}
 protectedObject(){
  if(!['escort','defend'].includes(this.spec.type))return null;
  return (this.game.missionObjects||[]).find(o=>!o.optional&&o.active&&Number.isFinite(o.hp)&&o.hp>0&&(o.type==='convoy'||o.type==='signal'))||null;
 }
 enemyTarget(enemy){return enemy?.missionRole==='assault'?(this.protectedObject()||this.game.player):this.game.player;}
 navigationTargets(){
  const g=this.game,targets=[];
  for(const o of g.missionObjects||[]){if(!o.active)continue;let priority=o.optional?(g.player.hp<g.player.maxHp*.55?2:20):1;if(o.followRole&&!g.enemies.some(e=>!e.dead&&e.missionRole===o.followRole))continue;targets.push({x:o.x,y:o.y,r:o.r,type:o.type,priority,name:o.name,preferredRange:o.followRole?220:o.type==='convoy'?110:o.type==='signal'&&this.spec.type==='defend'?150:0,optional:!!o.optional});}
  return targets.sort((a,b)=>a.priority-b.priority||distance(a,g.player)-distance(b,g.player));
 }
 startChapter(index,{checkpoint}={}){
  this.chapter=integer(index,0,11,0);this.leg=0;this.completed=false;this.transitioning=false;
  const g=this.game;g.campaignActive=true;g.campaignMission=this;g.stage=Math.min(4,Math.floor(this.chapter*5/12));g.makeIslands?.();
  if(checkpoint&&this.restore(checkpoint))return true;
  this.setupLeg();return true;
 }
 nextLeg(){if(this.completed||this.leg>=2)return false;this.leg++;this.transitioning=false;this.setupLeg();return true;}
 retryLeg(){this.completed=false;this.transitioning=false;this.setupLeg();return true;}
 safePoint(point,padding=35){
  const result={x:clamp(point.x,110,1690),y:clamp(point.y,110,1090)};
  for(let pass=0;pass<3;pass++)for(const island of this.game.islands||[]){
   if(island.kind==='wreck')continue;const r=island.r*.75+padding,d=distance(result,island);
   if(d<r){const a=Math.atan2(result.y-island.y,result.x-island.x);result.x=island.x+Math.cos(a)*r;result.y=island.y+Math.sin(a)*r;}
  }
  result.x=clamp(result.x,85,1715);result.y=clamp(result.y,85,1115);return result;
 }
 object(type,point,name,extra={}){return{...this.safePoint(point,type==='convoy'?45:30),id:type+'-'+(this.objectSequence++),type,name,r:type==='convoy'?25:21,active:true,progress:0,...extra};}
 setupLeg({quiet=false,resetPlayer=true}={}){
  const g=this.game,spec=this.spec,p=g.player;
  this.transitioning=false;this.elapsed=0;this.objectSequence=0;this.spawnTimer=2.2;this.hazardTimer=12;this.baseKills=Number(g.kills)||0;this.completed=false;
  const rawDps=p.damage/Math.max(.14,p.fireRate)*(1+.35*(Math.min(4,p.multishot||1)-1))*(1+.6*(p.crit||0));const baseline=45+this.chapter*8;this.legDps=clamp(Math.min(rawDps*.45+baseline*.55,rawDps*1.2),25,1600);
  this.state={collected:0,routeIndex:0,laps:0,captainsDefeated:0,captainSerial:0,bossSpawned:false,bossPhase:0,bossAttackTimer:5,extraPressure:0,remaining:spec.duration||0,previousPulseCD:p.pulseCD||0,legKills:0};
  g.enemies=[];g.bullets=[];g.pickups=[];g.effects=[];g.campaignHazards=[];g.missionObjects=[];g.bossActive=false;g.bossDefeated=false;g.beacons=[{x:900,y:290,r:45,active:false}];g.cleared=false;
  if(resetPlayer){p.x=900;p.y=680;p.invuln=Math.max(p.invuln||0,3);p.dashTime=0;g.camera={x:p.x,y:p.y};}
  if(spec.type==='rescue'||spec.type==='salvage'){
   const count=spec.sites||4;
   for(let i=0;i<count;i++){
    const point=POINTS[(i+this.chapter)%POINTS.length];
    g.missionObjects.push(this.object(spec.type==='rescue'?'survivor':'cache',point,spec.type==='rescue'?['漂流的渔船','求救的信号','受困的旅人','返航的水手'][i]:['密封的邮袋','铜制航海箱','搁浅的资料柜','遗落的补给'][i],{channel:spec.type==='rescue'?7:8}));
   }
  }else if(spec.type==='defend'){
   const hp=220+this.chapter*8;g.missionObjects.push(this.object('signal',{x:900,y:490},'需要守护的灯火',{r:34,hp,maxHp:hp,hitCD:3}));
  }else if(spec.type==='escort'){
   const hp=250+this.chapter*10;g.missionObjects.push(this.object('convoy',{x:900,y:680},this.chapter===3?'孩子们的渡船':this.chapter===7?'灯火船队':'归航的补给船',{hp,maxHp:hp,hitCD:3,angle:Math.PI,channel:0}));
  }else if(spec.type==='race'){
   this.state.totalGates=ROUTE.length*(spec.laps||2);g.missionObjects.push(this.object('gate',ROUTE[0],'航道浮标 1',{r:34,progress:0}));
  }else if(spec.type==='hunt'){
   this.spawnCaptain(quiet);
  }else if(spec.type==='boss'){
   g.missionObjects.push(this.object('signal',{x:900,y:300},'深海回声',{r:35}));
  }
  // Every mission includes an optional off-route supply cache, making exploration useful without blocking progress.
  if(spec.type!=='salvage')g.missionObjects.push(this.object('cache',{x:this.chapter%2?1500:320,y:this.chapter%2?980:850},'可选补给 · 靠近打捞',{optional:true,channel:4}));
  this.updateUI();if(!quiet)g.toast?.(`${LABELS[spec.type]} · ${spec.title}`);
 }
 spawn(type,role='wave',point){
  const g=this.game,e=g.spawn(type);
  const factors={skiff:.72,ray:.5,gunner:.9,brute:3.2,boss:72};
  const hp=clamp(this.legDps*factors[type]*(1+this.chapter*.025),type==='boss'?2000:type==='brute'?110:26,type==='boss'?160000:type==='brute'?9500:2600);
  e.hp=e.maxHp=hp;e.missionRole=role;e.speed=Math.min(e.speed*(1+this.chapter*.018),type==='ray'?145:type==='boss'?48:100);e.age=0;e.attack=Math.max(e.attack,1.8);
  if(point){const pos=this.safePoint(point,30);e.x=pos.x;e.y=pos.y;g.effect?.(e.x,e.y,e.r+25,'warning',1.4,'#d88d72');}
  return e;
 }
 spawnCaptain(quiet=false){
  const serial=this.state.captainSerial++,point=POINTS[(serial+this.chapter)%4];
  const e=this.spawn('brute','captain-'+serial,point);e.hp=e.maxHp=clamp(this.legDps*(17+this.chapter*.5),700,45000);e.speed=44;
  this.state.currentCaptainRole=e.missionRole;
  this.game.missionObjects=this.game.missionObjects.filter(o=>o.optional);
  this.game.missionObjects.unshift(this.object('signal',point,'重舰 '+(serial+1)+' / '+this.spec.captains,{followRole:e.missionRole,r:32}));
  if(!quiet)this.game.toast?.('黑帆重舰现身 · 共鸣清弹，保持侧向航行');
 }
 spawnWave(){
  const g=this.game,spec=this.spec,cap=spec.type==='defend'?16:spec.type==='boss'?12:14;
  if(g.enemies.filter(e=>!e.dead).length>=cap)return;
  let type='skiff';const roll=Math.random();
  if(roll<.22)type='ray';else if(roll<.43&&this.chapter>0)type='gunner';else if(roll>.94&&this.chapter>2)type='brute';
  const main=this.protectedObject(),role=main&&Math.random()<.4?'assault':'wave';
  let point;
  if(main&&Math.random()<.48){const a=Math.random()*TAU;point={x:main.x+Math.cos(a)*430,y:main.y+Math.sin(a)*370};if(distance(point,g.player)<250)point=undefined;}
  this.spawn(type,role,point);
  if(this.chapter>=5&&Math.random()<.3&&g.enemies.length<cap)this.spawn(Math.random()<.5?'ray':'skiff',main&&Math.random()<.4?'assault':'wave');
 }
 channelObject(o,dt){
  const g=this.game;
  if(!o.active)return;
  const near=distance(g.player,o)<76;
  const danger=g.enemies.some(e=>!e.dead&&e.age>=1.2&&distance(e,o)<95+e.r);
  const old=o.progress||0;
  if(near&&!danger)o.progress=Math.min(1,old+dt/(o.channel||7));
  else if(!near)o.progress=Math.max(0,old-dt*.055);
  o.blocked=near&&danger;
  if(o.progress<1)return;
  o.active=false;
  if(o.optional){g.shells=(g.shells||0)+5;g.score=(g.score||0)+200;g.player.hp=Math.min(g.player.maxHp,g.player.hp+22);g.toast?.('旧航海箱：修复 22 船体，获得 5 枚潮贝');}
  else{this.state.collected++;g.player.hp=Math.min(g.player.maxHp,g.player.hp+7);g.toast?.(o.type==='survivor'?'救援成功 · 信号已传回港口':'打捞成功 · 记录已妥善保存');}
  g.burst?.(o.x,o.y,'#c8e6c4',15);g.audio?.sfx('beacon');g.saveVoyage?.();
 }
 moveConvoy(o,dt){
  const route=ROUTE,target=this.safePoint(route[this.state.routeIndex],46);
  if(distance(o,target)<37){this.state.routeIndex++;gSafeProgress(o,this.state.routeIndex/route.length);return;}
  let dx=target.x-o.x,dy=target.y-o.y,d=Math.hypot(dx,dy)||1,vx=dx/d,vy=dy/d;
  // Look ahead and steer around the solid islands rather than cutting through their artwork.
  for(const island of this.game.islands||[]){
   if(island.kind==='wreck')continue;
   const ix=island.x-o.x,iy=island.y-o.y,rad=island.r*.75+o.r+24,range=Math.hypot(ix,iy)||1,along=ix*vx+iy*vy,lateral=ix*(-vy)+iy*vx;
   if(along>0&&along<rad+125&&Math.abs(lateral)<rad+25){const side=lateral===0?(this.chapter%2?1:-1):-Math.sign(lateral),weight=(1-Math.abs(lateral)/(rad+25))*2.2;const ox=vx;vx+=-vy*side*weight;vy+=ox*side*weight;}
   if(range<rad){vx-=ix/range*(rad-range)/rad*3;vy-=iy/range*(rad-range)/rad*3;}
  }
  d=Math.hypot(vx,vy)||1;vx/=d;vy/=d;const nearby=distance(this.game.player,o)<380,speed=(this.spec.speed||55)*(nearby?1:.48);
  o.x=clamp(o.x+vx*speed*dt,70,1730);o.y=clamp(o.y+vy*speed*dt,70,1130);o.angle=Math.atan2(vy,vx);o.waiting=!nearby;
  for(const island of this.game.islands||[]){if(island.kind==='wreck')continue;const rr=island.r*.72+o.r,dd=distance(o,island);if(dd<rr){const a=Math.atan2(o.y-island.y,o.x-island.x);o.x=island.x+Math.cos(a)*rr;o.y=island.y+Math.sin(a)*rr;}}
 }
 protectObject(o,dt){
  if(!Number.isFinite(o.hp))return;
  const g=this.game;o.hitCD=Math.max(0,(o.hitCD||0)-dt);
  const danger=g.enemies.filter(e=>!e.dead&&e.age>=1.2&&distance(e,o)<o.r+e.r+25);
  let bulletHits=0;
  // Friendly hulls absorb hostile projectiles, including during their short damage cooldown.
  // Remove them now: the regular game loop must not process an already absorbed shot afterward.
  g.bullets=g.bullets.filter(b=>{if(b.enemy&&b.life>0&&distance(b,o)<o.r+(b.r||4)){bulletHits++;return false;}return true;});
  const safe=!g.enemies.some(e=>!e.dead&&distance(e,o)<180)&&bulletHits===0;
  o.repairing=distance(g.player,o)<170&&safe&&o.hp<o.maxHp;
  if(o.repairing)o.hp=Math.min(o.maxHp,o.hp+dt);
  if(o.hitCD>0||this.elapsed<3||(!danger.length&&!bulletHits))return;
  const baseDamage=Math.min(20,(bulletHits?10:0)+Math.min(14,danger.length*5));
  const damage=baseDamage*(g.difficulty==='story'?.65:g.difficulty==='storm'?1.15:1);
  o.hp=Math.max(0,o.hp-damage);o.hitCD=1;o.repairing=false;g.burst?.(o.x,o.y,'#e7a58d',5);
  if(o.hp<=0)this.fail(o.type==='convoy'?'护航船需要返港修整。重试当前任务，不会失去已完成章节。':'灯火被迷雾吞没了。可以重新布置防线，再试一次。');
 }

 spawnHazard(){
  const g=this.game,p=g.player,a=Math.random()*TAU;
  const pos=this.safePoint({x:p.x+Math.cos(a)*(100+Math.random()*180),y:p.y+Math.sin(a)*(100+Math.random()*150)},20);
  g.campaignHazards.push({...pos,r:this.spec.type==='race'?62:85,type:this.chapter>=6?'storm':'mine',windup:2.8,life:5.2,hit:false});
 }
 updateHazards(dt){
  const g=this.game,p=g.player,pulsed=(p.pulseCD||0)>(this.state.previousPulseCD||0)+Math.max(.005,(p.pulseMax||9)*.1);this.state.previousPulseCD=p.pulseCD||0;
  for(const h of g.campaignHazards){h.windup=Math.max(0,h.windup-dt);h.life-=dt;if(pulsed&&distance(h,p)<300){h.life=0;g.score=(g.score||0)+35;g.burst?.(h.x,h.y,'#badfd2',7);continue;}if(h.windup<=0&&!h.hit&&distance(h,p)<h.r+p.r){h.hit=true;g.hurt(10);}}
  g.campaignHazards=g.campaignHazards.filter(h=>h.life>0);
 }
 spawnBoss(){
  const g=this.game,e=this.spawn('boss','campaign-boss',{x:900,y:290});
  const multiplier={bell:.86,reef:1.03,storm:1.14,heart:1.34}[this.spec.boss]||1;e.hp=e.maxHp=Math.min(190000,e.maxHp*multiplier);e.name={bell:'沉钟 · 未说出的告别',reef:'白骨礁 · 遗忘的守门人',storm:'暴风眼 · 无人归航',heart:'潮汐之心 · 漫长的等待'}[this.spec.boss];
  this.state.bossSpawned=true;this.state.bossPhase=1;this.state.bossAttackTimer=6;g.missionObjects=g.missionObjects.filter(o=>o.optional);g.missionObjects.unshift(this.object('signal',{x:e.x,y:e.y},e.name,{followRole:'campaign-boss',r:42}));
 }
 updateBoss(dt){
  const g=this.game;
  if(!this.state.bossSpawned){if(this.elapsed>=3)this.spawnBoss();return;}
  const boss=g.enemies.find(e=>!e.dead&&e.missionRole==='campaign-boss');
  if(!boss)return;
  const fraction=boss.hp/boss.maxHp,phase=fraction<.32?3:fraction<.66?2:1;
  if(phase>this.state.bossPhase){this.state.bossPhase=phase;g.bullets=g.bullets.filter(b=>!b.enemy);g.toast?.(phase===2?'回声转为怒潮 · 注意两侧增援':'潮心显露 · 沿弹幕空隙前进');for(let i=0;i<2;i++)this.spawn(phase===3?'gunner':'brute');this.state.bossAttackTimer=3;}
  this.state.bossAttackTimer-=dt;
  if(this.state.bossAttackTimer<=0&&boss.age>2){
   const aim=Math.atan2(g.player.y-boss.y,g.player.x-boss.x);
   if(this.spec.boss==='reef'){for(let k=0;k<12;k++)if(k%4!==phase%4)g.enemyBullet(boss,k*TAU/12+this.elapsed*.16,115+phase*10);}
   else if(this.spec.boss==='storm'){for(let k=-4;k<=4;k++)g.enemyBullet(boss,aim+k*.17,125+phase*16);this.spawnHazard();}
   else if(this.spec.boss==='heart'){for(let k=0;k<14;k++)if(k%7!==phase)g.enemyBullet(boss,k*TAU/14+this.elapsed*.13,105+phase*12);if(phase>=2)this.spawnHazard();}
   else{for(let k=-3;k<=3;k++)if(k!==0)g.enemyBullet(boss,aim+k*.22,120+phase*12);}
   this.state.bossAttackTimer=Math.max(3.6,7-phase*.9);
  }
 }
 update(dt){
  const g=this.game;if(this.completed||this.transitioning||g.mode!=='playing'||!Number.isFinite(dt)||dt<=0)return;
  dt=Math.min(dt,.1);this.elapsed+=dt;this.clock+=dt;g.campaignClock=(g.campaignClock||0)+dt;
  this.state.legKills=Math.max(0,(Number(g.kills)||0)-this.baseKills);
  this.spawnTimer-=dt;this.hazardTimer-=dt;
  if(this.spawnTimer<=0){this.spawnWave();const type=this.spec.type;this.spawnTimer=(type==='defend'?1.75:type==='boss'?2.5:2.05)-(Math.min(10,this.chapter)*.045);}
  if(this.chapter>=2&&this.hazardTimer<=0){this.spawnHazard();this.hazardTimer=this.spec.type==='race'?10:17;}
  this.updateHazards(dt);if(g.mode!=='playing')return;
  for(const object of g.missionObjects){
   if(object.optional||(this.spec.type==='rescue'||this.spec.type==='salvage'))this.channelObject(object,dt);
   if(object.type==='convoy'){if(this.state.routeIndex<ROUTE.length)this.moveConvoy(object,dt);this.protectObject(object,dt);}
   else if(this.spec.type==='defend'&&!object.optional)this.protectObject(object,dt);
   if(object.followRole){const target=g.enemies.find(e=>!e.dead&&e.missionRole===object.followRole);if(target){object.x=target.x;object.y=target.y;object.hp=target.hp;object.maxHp=target.maxHp;}}
   if(this.transitioning)return;
  }
  const spec=this.spec;
  if(spec.type==='defend')this.state.remaining=Math.max(0,spec.duration-this.elapsed);
  else if(spec.type==='race'){
   const gate=g.missionObjects.find(o=>!o.optional);
   if(gate&&this.state.routeIndex<this.state.totalGates&&distance(g.player,gate)<65){this.state.routeIndex++;this.state.laps=Math.floor(this.state.routeIndex/ROUTE.length);if(this.state.routeIndex<this.state.totalGates){const p=this.safePoint(ROUTE[this.state.routeIndex%ROUTE.length]);gate.x=p.x;gate.y=p.y;gate.name='航道浮标 '+(this.state.routeIndex+1);gate.progress=this.state.routeIndex/this.state.totalGates;g.audio?.sfx('pickup');}}
  }else if(spec.type==='hunt'){
   if(!g.enemies.some(e=>!e.dead&&e.missionRole===this.state.currentCaptainRole)){
    this.state.captainsDefeated++;if(this.state.captainsDefeated<spec.captains)this.spawnCaptain();
   }
  }else if(spec.type==='boss')this.updateBoss(dt);
  this.updateUI();
  const kills=this.state.legKills;
  const done=spec.type==='rescue'||spec.type==='salvage'?this.state.collected>=spec.sites&&kills>=spec.quota:
   spec.type==='defend'?this.elapsed>=spec.duration&&kills>=spec.quota:
   spec.type==='escort'?this.state.routeIndex>=ROUTE.length:
   spec.type==='race'?this.state.routeIndex>=this.state.totalGates&&kills>=spec.quota:
   spec.type==='hunt'?this.state.captainsDefeated>=spec.captains:
   this.state.bossSpawned&&!g.enemies.some(e=>!e.dead&&e.missionRole==='campaign-boss')&&kills>=spec.quota;
  if(done)this.finishLeg();
 }
 updateUI(){
  const spec=this.spec,s=this.state,g=this.game,kills=s.legKills||0;let objective='',progress='';
  if(spec.type==='rescue'||spec.type==='salvage'){objective='靠近目标停留，击退周围敌人后完成'+(spec.type==='rescue'?'救援':'打捞');progress=`${spec.type==='rescue'?'获救':'记录'} ${s.collected} / ${spec.sites} · 击退 ${Math.min(kills,spec.quota)} / ${spec.quota}`;}
  else if(spec.type==='defend'){const o=g.missionObjects.find(o=>!o.optional);objective='守住灯火，迎击逼近的迷雾舰队';progress=`坚守 ${Math.ceil(s.remaining)}s · 灯火 ${Math.ceil(o?.hp||0)} · 击退 ${Math.min(kills,spec.quota)} / ${spec.quota}`;}
  else if(spec.type==='escort'){const o=g.missionObjects.find(o=>o.type==='convoy');objective=o?.waiting?'靠近护航船，它正在等待你的掩护':'伴随船队穿过九段航道，拦截接近的敌人';progress=`航线 ${Math.min(s.routeIndex,ROUTE.length)} / ${ROUTE.length} · 护航船 ${Math.ceil(o?.hp||0)} / ${o?.maxHp||0}`;}
  else if(spec.type==='race'){objective='依次穿过发光浮标，清除追击者；共鸣可以消除雷区';progress=`浮标 ${s.routeIndex} / ${s.totalGates} · 击退 ${Math.min(kills,spec.quota)} / ${spec.quota}`;}
  else if(spec.type==='hunt'){objective='追踪金色信号，逐个击退黑帆重舰';progress=`重舰 ${Math.min(s.captainsDefeated,spec.captains)} / ${spec.captains}`;}
  else{objective=s.bossSpawned&&!g.enemies.some(e=>!e.dead&&e.missionRole==='campaign-boss')?'守望者已经平息，清除剩余迷雾增援':'击败守望者并清除迷雾增援，注意阶段变化';progress=`${s.bossSpawned?'回响阶段 '+s.bossPhase:'深海正在苏醒'} · 击退 ${Math.min(kills,spec.quota)} / ${spec.quota}`;}
  this.ui={label:`第 ${this.chapter+1} 章 · ${this.leg+1} / 3 · ${spec.title}`,objective,progress,type:spec.type};
 }
 finishLeg(){
  if(this.transitioning)return;const g=this.game;this.transitioning=true;g.enemies=[];g.bullets=[];g.campaignHazards=[];g.bossActive=false;g.score=(g.score||0)+500+this.chapter*60;g.shells=(g.shells||0)+8;g.player.hp=Math.min(g.player.maxHp,g.player.hp+20);g.audio?.sfx('beacon');
  if(this.leg===2){this.completed=true;g.onCampaignChapterComplete?.();}else g.onCampaignLegComplete?.(this.leg);
 }
 fail(reason){if(this.transitioning)return;this.transitioning=true;this.game.bullets=[];this.game.onCampaignMissionFailed?.(reason);}
 snapshot(){
  const g=this.game;return{version:1,chapter:this.chapter,leg:this.leg,elapsed:this.elapsed,clock:this.clock,baseKills:this.baseKills,legDps:this.legDps,completed:this.completed,transitioning:this.transitioning,spawnTimer:this.spawnTimer,hazardTimer:this.hazardTimer,objectSequence:this.objectSequence,state:copy(this.state),objects:copy(g.missionObjects||[]),hazards:copy(g.campaignHazards||[]),hostiles:(g.enemies||[]).filter(e=>!e.dead).slice(0,40).map(e=>({x:e.x,y:e.y,r:e.r,type:e.type,hp:e.hp,maxHp:e.maxHp,speed:e.speed,angle:e.angle,age:e.age,attack:e.attack,missionRole:e.missionRole||'wave',name:e.name||''}))};
 }
 restore(v){
  if(!v||v.version!==1||!Number.isInteger(v.chapter)||v.chapter<0||v.chapter>11||!Number.isInteger(v.leg)||v.leg<0||v.leg>2||!Number.isFinite(v.elapsed)||v.elapsed<0||v.elapsed>20000||!v.state||typeof v.state!=='object'||!Array.isArray(v.objects)||v.objects.length>8||!Array.isArray(v.hazards)||v.hazards.length>40||!Array.isArray(v.hostiles)||v.hostiles.length>40)return false;
  const spec=PLANS[v.chapter][v.leg],required=spec.type==='rescue'||spec.type==='salvage'?spec.sites:1;
  if(v.objects.filter(o=>o&&!o.optional).length<required||v.objects.some(o=>!o||!OBJECT_TYPES.has(o.type)||!Number.isFinite(o.x)||!Number.isFinite(o.y)))return false;
  if(!Number.isInteger(v.baseKills)||v.baseKills<0||!Number.isFinite(v.legDps)||v.legDps<=0)return false;
  const routeMax=spec.type==='race'?ROUTE.length*(spec.laps||2):ROUTE.length;
  if((spec.type==='race'||spec.type==='escort')&&(!Number.isInteger(v.state.routeIndex)||v.state.routeIndex<0||v.state.routeIndex>routeMax))return false;
  if((spec.type==='rescue'||spec.type==='salvage')&&(!Number.isInteger(v.state.collected)||v.state.collected<0||v.state.collected>spec.sites))return false;
  if(spec.type==='hunt'&&(!Number.isInteger(v.state.captainsDefeated)||v.state.captainsDefeated<0||v.state.captainsDefeated>spec.captains||typeof v.state.currentCaptainRole!=='string'||!/^captain-\d{1,4}$/.test(v.state.currentCaptainRole)))return false;
  const preservedPickups=this.game.pickups;this.game.campaignActive=true;this.game.campaignMission=this;this.chapter=v.chapter;this.leg=v.leg;this.game.stage=Math.min(4,Math.floor(this.chapter*5/12));this.game.makeIslands?.();this.setupLeg({quiet:true,resetPlayer:false});this.game.pickups=preservedPickups;
  const g=this.game,defaults=this.state,state={};
  for(const key of ['collected','routeIndex','laps','captainsDefeated','captainSerial','bossPhase','extraPressure','legKills'])state[key]=integer(v.state[key],0,1000000,defaults[key]||0);
  for(const key of ['remaining','bossAttackTimer','previousPulseCD'])state[key]=finite(v.state[key],-1,100000,defaults[key]||0);
  state.bossSpawned=v.state.bossSpawned===true;
  if(typeof v.state.currentCaptainRole==='string'&&/^captain-\d{1,4}$/.test(v.state.currentCaptainRole))state.currentCaptainRole=v.state.currentCaptainRole;
  if(this.spec.type==='race')state.totalGates=ROUTE.length*(this.spec.laps||2);
  const objects=[];
  for(const o of v.objects){const base=g.missionObjects.find(d=>d.id===o.id)||{name:LABELS[this.spec.type],r:25};objects.push({id:String(o.id||'object').slice(0,40),type:o.type,x:clamp(o.x,50,1750),y:clamp(o.y,50,1150),r:finite(o.r,5,80,base.r),name:base.name,active:o.active===true,optional:o.optional===true,progress:finite(o.progress,0,1,0),channel:finite(o.channel,.1,30,7),hp:Number.isFinite(o.hp)?finite(o.hp,0,10000,0):undefined,maxHp:Number.isFinite(o.maxHp)?finite(o.maxHp,1,10000,250):undefined,hitCD:finite(o.hitCD,0,5,2),angle:finite(o.angle,-1e6,1e6,0),waiting:o.waiting===true,followRole:typeof o.followRole==='string'&&/^(campaign-boss|captain-\d{1,4})$/.test(o.followRole)?o.followRole:undefined});}
  const hostiles=[];
  for(const e of v.hostiles){if(!e||!ENEMY_TYPES.has(e.type)||!['x','y','hp','maxHp','speed','r'].every(k=>Number.isFinite(e[k]))||e.hp<=0||e.maxHp<=0)continue;hostiles.push({x:clamp(e.x,20,1780),y:clamp(e.y,20,1180),type:e.type,r:finite(e.r,5,90,16),hp:Math.min(e.hp,finite(e.maxHp,1,200000,100)),maxHp:finite(e.maxHp,1,200000,100),speed:finite(e.speed,0,250,70),angle:finite(e.angle,-1e6,1e6,0),age:finite(e.age,0,20000,0),attack:finite(e.attack,-1,20,1.5),flash:0,windup:0,missionRole:typeof e.missionRole==='string'&&/^(wave|assault|campaign-boss|captain-\d{1,4})$/.test(e.missionRole)?e.missionRole:'wave'});}
  this.state=state;this.elapsed=v.elapsed;this.clock=finite(v.clock,0,1e8,this.clock);this.baseKills=integer(v.baseKills,0,1e9,g.kills||0);this.legDps=finite(v.legDps,25,2100,this.legDps);this.spawnTimer=finite(v.spawnTimer,-1,60,1);this.hazardTimer=finite(v.hazardTimer,-1,60,8);this.objectSequence=integer(v.objectSequence,0,1000,10);this.completed=v.completed===true;this.transitioning=v.transitioning===true;g.missionObjects=objects;g.campaignHazards=v.hazards.filter(h=>h&&Number.isFinite(h.x)&&Number.isFinite(h.y)).map(h=>({x:clamp(h.x,20,1780),y:clamp(h.y,20,1180),r:finite(h.r,10,150,60),type:h.type==='storm'?'storm':'mine',windup:finite(h.windup,0,5,2),life:finite(h.life,0,10,3),hit:h.hit===true}));g.enemies=hostiles;g.bossActive=hostiles.some(e=>e.type==='boss');g.campaignClock=Math.max(g.campaignClock||0,this.clock);this.updateUI();return true;
 }
}
function gSafeProgress(object,progress){object.progress=clamp(progress,0,1);}
