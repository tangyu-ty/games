// All weapon figures are fictional game values. Modifiers multiply their named
// stat; keys ending in Add are added after multiplication. Magazines use whole rounds.
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const weapon=(id,name,family,caliber,damage,rpm,mag,reload,spread,recoil,range,noise,weight,unlockedAt,description,extra={})=>({id,name,family,caliber,damage,rpm,mag,reload,spread,recoil,range,noise,weight,unlockedAt,description,pellets:1,penetration:0,color:'#e5b46d',burst:1,...extra});

export const WEAPONS=freeze([
 weapon('kestrel9','隼 9 · 制式手枪','pistol','9mm',24,340,15,1.25,.035,.065,700,430,1.05,0,'轻巧、可靠，适合跑动与缺弹时的精确补枪。',{color:'#ccd9dc',penetration:.08}),
 weapon('hush45','无声者 · 重型手枪','pistol','.45',37,260,9,1.5,.028,.105,670,410,1.35,2,'重弹头与较慢射速；装上消声器后适合逐个处理哨兵。',{color:'#849da5',penetration:.12}),
 weapon('burst9','隼 9B · 三连发手枪','pistol','9mm',20,720,21,1.55,.045,.09,620,470,1.35,5,'每次扣扳机三发连射，近距离抢先手，注意弹药消耗。',{burst:3,color:'#ccad77'}),
 weapon('needle','针蜂 · 轻型冲锋枪','smg','9mm',15,840,30,1.75,.055,.055,640,580,2.35,0,'高射速与快速转向，医院和车厢内的可靠选择。',{color:'#b7c6c8',penetration:.04}),
 weapon('vector45','短剑 · 重型冲锋枪','smg','.45',23,660,24,1.95,.045,.075,710,610,2.85,3,'较低射速换取单发威力，长点射比扫射更稳定。',{color:'#ce936a',penetration:.12}),
 weapon('breach12','门槌 · 泵动霰弹枪','shotgun','12g',12,90,7,2.5,.17,.25,430,920,3.25,1,'近距离七枚弹丸形成强力散布；远距离伤害会迅速衰减。',{pellets:7,color:'#c59c6b',penetration:.03}),
 weapon('cyclone12','旋风 · 半自动霰弹枪','shotgun','12g',9,225,10,2.9,.2,.19,380,950,3.8,8,'短时间清理多个近身目标，装填和弹药储量需要提前安排。',{pellets:6,color:'#b0b8b7',penetration:.02}),
 weapon('arclight','弧光 · 突击步枪','rifle','5.56',29,600,30,2.05,.034,.075,1050,820,3.15,2,'中距离通用步枪，稳定性、装填与穿透均衡。',{color:'#d6b981',penetration:.25}),
 weapon('bullpup','回声 · 无托步枪','rifle','5.56',25,750,35,2.4,.042,.068,940,800,3.35,6,'紧凑枪身保持移动能力，大弹匣适合连续转移。',{color:'#8fb4a1',penetration:.2}),
 weapon('trident','三叉戟 · 点射卡宾','rifle','6.5',33,720,24,2.15,.025,.095,1120,850,3.45,7,'三发受控点射，善于从掩体探身时集中火力。',{burst:3,color:'#bdac88',penetration:.3}),
 weapon('sentinel','哨兵 · 精确射手步枪','dmr','7.62',58,240,14,2.35,.015,.15,1420,980,4.2,4,'高伤害半自动步枪，可以压制长街和塔台上的远程威胁。',{color:'#b8c4b1',penetration:.48}),
 weapon('longwatch','长望 · 栓动狙击枪','sniper','7.62',118,52,5,3.1,.006,.3,1780,1120,5.1,10,'精准、强穿透，每发后的拉栓窗口需要安全位置。',{color:'#d1be96',penetration:.8}),
 weapon('tempest','暴雨 · 轻机枪','lmg','5.56',25,720,80,4.1,.075,.09,1180,1100,6.6,9,'持续火力会让安保低头寻找掩体，沉重枪身减慢转移。',{color:'#a1aa96',penetration:.35,suppression:1.7}),
 weapon('coil','弦电 · 线圈精确步枪','energy','cell',80,150,8,2.6,.012,.11,1510,710,4.55,13,'小容量储能弹仓，对机械目标更有效，无法使用火药枪口件。',{color:'#6cd5d3',penetration:.65,vsMachine:1.45,projectileSpeed:1800})
]);

const all=['pistol','smg','shotgun','rifle','dmr','sniper','lmg','energy'];
const long=['smg','shotgun','rifle','dmr','sniper','lmg','energy'];
const powder=['pistol','smg','shotgun','rifle','dmr','sniper','lmg'];
const attachment=(id,name,slot,allowedFamilies,modifiers,description,unlockedAt=0,extra={})=>({id,name,slot,allowedFamilies,modifiers,description,unlockedAt,...extra});
export const ATTACHMENTS=freeze([
 attachment('suppressor','织雾消声器','muzzle',['pistol','smg','rifle','dmr','sniper'],{noise:.36,damage:.94,range:.92,weightAdd:.18},'大幅降低枪声传播，略减伤害和射程。',1),
 attachment('compensator','分流制退器','muzzle',['smg','rifle','dmr','lmg'],{recoil:.68,noise:1.18,spread:.94,weightAdd:.12},'压低连续射击后坐力，枪声更容易招来感染者。',2),
 attachment('flashHider','遮焰器','muzzle',powder,{recoil:.9,noise:.88,weightAdd:.08},'隐藏部分枪口闪光，略微降低枪声和后坐力。',0),
 attachment('choke','聚束喉缩','muzzle',['shotgun'],{spread:.6,range:1.2,weightAdd:.14},'收紧霰弹散布并延长有效射程，近战容错更小。',3),
 attachment('coilShunt','线圈分流器','muzzle',['energy'],{damage:1.13,rpm:.86,noise:.8,weightAdd:.22},'提高线圈单发输出，但储能循环变慢。',13),
 attachment('redDot','反射红点','optic',all,{spread:.82,ads:1.06,weightAdd:.1},'清晰的近中距离瞄准点，改善基础精度。',0),
 attachment('holo','全息战术镜','optic',all,{spread:.74,recoil:.95,ads:1.12,weightAdd:.16},'兼顾近距跟枪与精确射击，瞄准略慢。',2),
 attachment('scope3','三倍棱镜','optic',['rifle','dmr','sniper','lmg','energy'],{spread:.61,range:1.12,ads:1.28,move:.97,weightAdd:.28},'远距离更精准，移动和进入精瞄略慢。',4),
 attachment('scope6','六倍观察镜','optic',['dmr','sniper','energy'],{spread:.42,range:1.24,ads:1.5,move:.94,weightAdd:.44},'长视线优势明显，狭窄房间转移笨重。',9),
 attachment('nightSight','微光瞄具','optic',['smg','rifle','dmr','sniper','energy'],{spread:.75,range:1.06,ads:1.22,weightAdd:.31,nightVision:1},'暗区目标轮廓更清楚，镜体较重。',6),
 attachment('verticalGrip','垂直握把','underbarrel',long,{recoil:.76,ads:1.08,weightAdd:.17},'适合连续压制，进入精瞄稍慢。',1),
 attachment('angledGrip','斜角握把','underbarrel',long,{recoil:.9,ads:.85,weightAdd:.1},'快速举枪、短点射，控枪提升较小。',3),
 attachment('handstop','短护手挡','underbarrel',['smg','shotgun','rifle','dmr','energy'],{spread:.91,move:1.04,weightAdd:.06},'保持转移速度，适合穿插和近距战。',2),
 attachment('bipod','折叠两脚架','underbarrel',['rifle','dmr','sniper','lmg','energy'],{recoil:.58,spread:.74,move:.9,ads:1.18,weightAdd:.42},'明显稳定射击，代价是移动迟缓。',5),
 attachment('extendedMag','扩容弹匣','magazine',['pistol','smg','rifle','dmr'],{mag:1.5,reload:1.2,weightAdd:.27},'增加一半弹量，装填较慢。',2),
 attachment('quickMag','快换弹匣','magazine',['pistol','smg','rifle','dmr','energy'],{reload:.75,mag:.86,weightAdd:.05},'牺牲部分容量，显著缩短换弹时间。',0),
 attachment('drum','高容量供弹鼓','magazine',['smg','rifle','lmg'],{mag:1.9,reload:1.42,move:.95,weightAdd:.63},'适合持续射击，增加重量与装填时间。',7),
 attachment('shellCarrier','弹壳快取架','magazine',['shotgun'],{reload:.76,weightAdd:.18},'将备用弹放在触手可及处，缩短装填。',4),
 attachment('capacitor','高密度储能匣','magazine',['energy'],{mag:1.5,reload:1.18,weightAdd:.25},'增加线圈弹容量，充能装填更久。',13),
 attachment('lightStock','轻量枪托','stock',long,{move:1.075,ads:.87,recoil:1.13,weightAdd:-.18},'加快移动与举枪，降低持续射击稳定性。',1),
 attachment('heavyStock','稳固枪托','stock',long,{recoil:.72,spread:.92,move:.96,weightAdd:.34},'稳定射击平台，略降转移速度。',3),
 attachment('foldStock','折叠枪托','stock',['smg','shotgun','rifle'],{move:1.11,ads:.8,recoil:1.25,spread:1.12,weightAdd:-.28},'紧凑迅捷，连续射击更难控制。',5),
 attachment('cheekRest','可调托腮板','stock',['rifle','dmr','sniper','lmg','energy'],{spread:.76,ads:1.07,weightAdd:.14},'改善精确射击的一致性。',4),
 attachment('laser','红色激光器','rail',all,{spread:.84,ads:.92,noise:1.02,weightAdd:.09},'近距离快速瞄准更稳，装置略增轮廓暴露。',0),
 attachment('light','白光战术灯','rail',all,{spread:.95,nightVision:1,weightAdd:.15},'照亮暗处的近距离敌人。可从装备页拆下。',1),
 attachment('rangefinder','激光测距仪','rail',['rifle','dmr','sniper','lmg','energy'],{range:1.16,spread:.92,ads:1.14,weightAdd:.21},'便于判断远距离弹道，瞄准略慢。',6),
 attachment('brace','运动稳定器','rail',['pistol','smg','rifle','energy'],{recoil:.85,spread:.92,move:.98,weightAdd:.2},'降低移动后的抖动，略增负担。',8),
 attachment('bioSensor','生命迹象探头','rail',all,{range:1.05,nightVision:1,ads:1.12,weightAdd:.24},'在近距离显示感染者活动提示，不能穿墙射击。',10)
]);

export const ATTACHMENT_SLOTS=freeze(['muzzle','optic','underbarrel','magazine','stock','rail']);
export const SLOT_NAMES=freeze({muzzle:'枪口',optic:'瞄具',underbarrel:'下导轨',magazine:'弹匣',stock:'枪托',rail:'侧导轨'});
const weaponMap=new Map(WEAPONS.map(w=>[w.id,w]));
const attachmentMap=new Map(ATTACHMENTS.map(a=>[a.id,a]));
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object||{},key);
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const count=value=>Number.isSafeInteger(value)&&value>=0;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));

export function compatible(weaponId,attachmentId){
 const w=weaponMap.get(weaponId&&typeof weaponId==='object'?weaponId.id:weaponId),a=attachmentMap.get(attachmentId&&typeof attachmentId==='object'?attachmentId.id:attachmentId);
 return Boolean(w&&a&&a.allowedFamilies.includes(w.family)&&(!a.calibers||a.calibers.includes(w.caliber))&&(!a.weapons||a.weapons.includes(w.id)));
}

export function weaponStats(id,fittings={}){
 const base=weaponMap.get(id&&typeof id==='object'?id.id:id);
 if(!base)return null;
 const stats={...base,move:1,ads:1,suppression:base.suppression||1,vsMachine:base.vsMachine||1,projectileSpeed:base.projectileSpeed||1380,nightVision:0};
 const selected=record(fittings?.[base.id])?fittings[base.id]:fittings;
 const adds={};
 for(const slot of ATTACHMENT_SLOTS){
  const a=attachmentMap.get(selected?.[slot]);if(!a||a.slot!==slot||!compatible(base.id,a.id))continue;
  for(const [key,value] of Object.entries(a.modifiers)){
   if(key.endsWith('Add')){const stat=key.slice(0,-3);adds[stat]=(adds[stat]||0)+value;}
   else if(key==='nightVision')stats.nightVision=Math.max(stats.nightVision,value);
   else if(typeof stats[key]==='number')stats[key]*=value;
  }
 }
 for(const [key,value] of Object.entries(adds))if(typeof stats[key]==='number')stats[key]+=value;
 stats.weight=clamp(stats.weight,.5,12);
 stats.move*=clamp(1.055-stats.weight*.024,.73,1.035);
 stats.move=clamp(stats.move,.6,1.2);stats.ads=clamp(stats.ads,.45,2.4);
 stats.mag=clamp(Math.floor(stats.mag),1,200);stats.reload=clamp(stats.reload,.5,8);
 stats.spread=clamp(stats.spread,.002,.5);stats.recoil=clamp(stats.recoil,.01,.6);
 stats.noise=clamp(stats.noise,90,1800);stats.range=clamp(stats.range,180,2400);
 return stats;
}

function validateProfile(profile,weaponId){
 if(!record(profile)||!Array.isArray(profile.ownedWeapons)||!profile.ownedWeapons.includes(weaponId)||!weaponMap.has(weaponId))return'尚未拥有这把武器。';
 for(const key of ['ownedAttachments','fittings','ammo'])if(!record(profile[key]))return'装备记录不完整，请返回军械库。';
 const fit=profile.fittings[weaponId];if(fit!==undefined&&!record(fit))return'武器配件记录无效。';
 if(fit)for(const [slot,id] of Object.entries(fit))if(!ATTACHMENT_SLOTS.includes(slot)||!compatible(weaponId,id)||attachmentMap.get(id)?.slot!==slot)return'武器配件记录无效。';
 for(const [id,n] of Object.entries(profile.ownedAttachments))if(!attachmentMap.has(id)||!count(n))return'配件库存记录无效。';
 const ammo=profile.ammo[weaponId];
 if(ammo!==undefined&&(!record(ammo)||!count(ammo.mag)||!count(ammo.reserve)))return'弹药记录无效。';
 return null;
}
function resizeAmmo(profile,weaponId,newFittings){
 const ammo=profile.ammo[weaponId];if(!ammo)return null;
 const limit=weaponStats(weaponId,newFittings).mag;
 const overflow=Math.max(0,ammo.mag-limit);
 if(ammo.reserve>Number.MAX_SAFE_INTEGER-overflow)return false;
 return{mag:Math.min(ammo.mag,limit),reserve:ammo.reserve+overflow};
}
function inventoryRoom(profile,id){return (profile.ownedAttachments[id]||0)<Number.MAX_SAFE_INTEGER;}

export function installAttachment(profile,weaponId,attachmentId){
 const invalid=validateProfile(profile,weaponId);if(invalid)return{ok:false,message:invalid};
 const a=attachmentMap.get(attachmentId);
 if(!a||!compatible(weaponId,attachmentId))return{ok:false,message:'这个配件与当前武器不兼容。'};
 const current=profile.fittings[weaponId]||{},old=current[a.slot];
 if(old===attachmentId)return{ok:true,message:'这个配件已经装好。'};
 if(!own(profile.ownedAttachments,attachmentId)||profile.ownedAttachments[attachmentId]<1)return{ok:false,message:'库存中没有这个配件。'};
 if(old&&!inventoryRoom(profile,old))return{ok:false,message:'配件库存已满。'};
 const next={...current,[a.slot]:attachmentId},ammo=resizeAmmo(profile,weaponId,next);
 if(ammo===false)return{ok:false,message:'备用弹药记录超出范围。'};
 // Validate everything before the first write: rejected transactions change nothing.
 const inventory={...profile.ownedAttachments,[attachmentId]:profile.ownedAttachments[attachmentId]-1};
 if(old)inventory[old]=(inventory[old]||0)+1;
 profile.ownedAttachments=inventory;profile.fittings={...profile.fittings,[weaponId]:next};
 if(ammo)profile.ammo={...profile.ammo,[weaponId]:ammo};
 return{ok:true,message:`已安装${a.name}${old?'，旧配件已返回库存':''}。`};
}

export function removeAttachment(profile,weaponId,slot){
 const invalid=validateProfile(profile,weaponId);if(invalid)return{ok:false,message:invalid};
 if(!ATTACHMENT_SLOTS.includes(slot))return{ok:false,message:'未知的配件插槽。'};
 const current=profile.fittings[weaponId]||{},id=current[slot];
 if(!id)return{ok:true,message:'这个插槽已经是空的。'};
 if(!inventoryRoom(profile,id))return{ok:false,message:'配件库存已满。'};
 const next={...current};delete next[slot];
 const ammo=resizeAmmo(profile,weaponId,next);if(ammo===false)return{ok:false,message:'备用弹药记录超出范围。'};
 profile.ownedAttachments={...profile.ownedAttachments,[id]:(profile.ownedAttachments[id]||0)+1};
 profile.fittings={...profile.fittings,[weaponId]:next};
 if(ammo)profile.ammo={...profile.ammo,[weaponId]:ammo};
 return{ok:true,message:`已拆下${attachmentMap.get(id).name}并放回库存。`};
}

export function createArmoryProfile({all=false}={}){
 const weapons=WEAPONS.filter(w=>all||w.unlockedAt===0).map(w=>w.id);
 return{ownedWeapons:weapons,ownedAttachments:Object.fromEntries(ATTACHMENTS.filter(a=>all||a.unlockedAt===0).map(a=>[a.id,all?3:1])),fittings:{},ammo:Object.fromEntries(weapons.map(id=>{const w=weaponStats(id);return[id,{mag:w.mag,reserve:w.mag*4}];})),loadout:['needle','kestrel9'],claimedArmoryRewards:[]};
}

export function grantMissionRewards(profile,mission){
 if(!record(profile)||!Array.isArray(profile.ownedWeapons)||!record(profile.ownedAttachments)||!record(profile.ammo)||!Number.isInteger(mission)||mission<0||mission>17)return[];
 const claimed=Array.isArray(profile.claimedArmoryRewards)?profile.claimedArmoryRewards:[];
 if(claimed.includes(mission))return[];
 const unlocked=[],next=mission+1;
 for(const w of WEAPONS)if(w.unlockedAt===next&&!profile.ownedWeapons.includes(w.id)){
  profile.ownedWeapons.push(w.id);profile.ammo[w.id]={mag:w.mag,reserve:w.mag*4};unlocked.push(w.name);
 }
 for(const a of ATTACHMENTS)if(a.unlockedAt===next){profile.ownedAttachments[a.id]=(profile.ownedAttachments[a.id]||0)+1;unlocked.push(a.name);}
 profile.claimedArmoryRewards=[...claimed,mission];return unlocked;
}

// Save imports are whitelisted and clamped. Unknown keys never reach the live game.
export function normalizeArmoryProfile(raw){
 const clean=createArmoryProfile();if(!record(raw))return clean;
 clean.ownedWeapons=[...new Set([...clean.ownedWeapons,...(Array.isArray(raw.ownedWeapons)?raw.ownedWeapons.filter(id=>weaponMap.has(id)):[])])];
 clean.ownedAttachments={};
 for(const a of ATTACHMENTS)if(count(raw.ownedAttachments?.[a.id]))clean.ownedAttachments[a.id]=Math.min(raw.ownedAttachments[a.id],999);
 clean.fittings={};
 for(const id of clean.ownedWeapons){
  const fit={};for(const slot of ATTACHMENT_SLOTS){const a=raw.fittings?.[id]?.[slot];if(attachmentMap.get(a)?.slot===slot&&compatible(id,a))fit[slot]=a;}
  if(Object.keys(fit).length)clean.fittings[id]=fit;
  const w=weaponStats(id,fit),ammo=raw.ammo?.[id];
  const mag=count(ammo?.mag)?Math.min(ammo.mag,10000):w.mag;
  const reserve=count(ammo?.reserve)?Math.min(ammo.reserve,10000):w.mag*4;
  clean.ammo[id]={mag:Math.min(mag,w.mag),reserve:Math.min(10000,reserve+Math.max(0,mag-w.mag))};
 }
 const loadout=Array.isArray(raw.loadout)?raw.loadout.filter(id=>clean.ownedWeapons.includes(id)):[];
 clean.loadout=[loadout[0]||'needle',loadout[1]||'kestrel9'];
 clean.claimedArmoryRewards=[...new Set((Array.isArray(raw.claimedArmoryRewards)?raw.claimedArmoryRewards:[]).filter(n=>Number.isInteger(n)&&n>=0&&n<18))];
 return clean;
}
