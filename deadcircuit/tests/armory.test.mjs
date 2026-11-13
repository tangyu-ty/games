import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WEAPONS,ATTACHMENTS,ATTACHMENT_SLOTS,compatible,weaponStats,installAttachment,removeAttachment,createArmoryProfile,grantMissionRewards,normalizeArmoryProfile} from '../armory.js';
import {ENEMY_TYPES,factionsHostile} from '../enemies.js';

const clone=value=>JSON.parse(JSON.stringify(value));
const totalAmmo=(p,id)=>p.ammo[id].mag+p.ammo[id].reserve;
function totalAttachments(p,id){return(p.ownedAttachments[id]||0)+Object.values(p.fittings).filter(f=>Object.values(f).includes(id)).length;}

test('fourteen distinct weapons cover eight shooting families and offer meaningful tradeoffs',()=>{
 assert.equal(WEAPONS.length,14);assert.equal(new Set(WEAPONS.map(w=>w.id)).size,14);
 assert.equal(new Set(WEAPONS.map(w=>w.family)).size,8);
 for(const w of WEAPONS){for(const stat of ['damage','rpm','mag','reload','spread','recoil','range','noise','weight','pellets'])assert.ok(Number.isFinite(w[stat])&&w[stat]>0,w.id+' '+stat);assert.ok(w.description.length>15);assert.ok(Object.isFrozen(w));}
 assert.equal(weaponStats('trident').burst,3);assert.ok(weaponStats('breach12').pellets>1);
 assert.ok(weaponStats('longwatch').range>weaponStats('needle').range);
 assert.ok(weaponStats('tempest').move<weaponStats('kestrel9').move);
});

test('twenty-eight attachments have compatible hosts, six slots and stable immutable derived stats',()=>{
 assert.equal(ATTACHMENTS.length,28);assert.equal(new Set(ATTACHMENTS.map(a=>a.id)).size,28);
 assert.deepEqual(new Set(ATTACHMENTS.map(a=>a.slot)),new Set(ATTACHMENT_SLOTS));
 const before=JSON.stringify(WEAPONS);
 for(const a of ATTACHMENTS){assert.ok(WEAPONS.some(w=>compatible(w.id,a.id)),a.id);assert.ok(Object.isFrozen(a.modifiers));}
 for(const w of WEAPONS){const f={};for(const slot of ATTACHMENT_SLOTS){const a=ATTACHMENTS.find(a=>a.slot===slot&&compatible(w.id,a.id));if(a)f[slot]=a.id;}const s=weaponStats(w.id,f);assert.ok(s.mag>0&&s.reload>.1&&s.move>0);assert.notEqual(s,w);}
 assert.equal(JSON.stringify(WEAPONS),before);
 assert.equal(compatible('coil','suppressor'),false);assert.equal(compatible('needle','choke'),false);assert.equal(compatible(null,null),false);assert.equal(weaponStats(null),null);
 const suppressed=weaponStats('arclight',{muzzle:'suppressor'}),base=weaponStats('arclight');assert.ok(suppressed.noise<base.noise);assert.ok(suppressed.damage<base.damage);
});

test('install, replace, remove and reinstall preserve every attachment count',()=>{
 const p=createArmoryProfile({all:true}),ids=['redDot','holo','scope3'];const counts=Object.fromEntries(ids.map(id=>[id,totalAttachments(p,id)]));
 assert.equal(installAttachment(p,'arclight','redDot').ok,true);
 assert.equal(installAttachment(p,'arclight','holo').ok,true);
 assert.equal(installAttachment(p,'arclight','scope3').ok,true);
 assert.equal(removeAttachment(p,'arclight','optic').ok,true);
 const empty=JSON.stringify(p);assert.equal(removeAttachment(p,'arclight','optic').ok,true);assert.equal(JSON.stringify(p),empty);
 assert.equal(installAttachment(p,'arclight','holo').ok,true);
 const fitted=JSON.stringify(p);assert.equal(installAttachment(p,'arclight','holo').ok,true);assert.equal(JSON.stringify(p),fitted);
 for(const id of ids)assert.equal(totalAttachments(p,id),counts[id],id);
});

test('switching to a smaller magazine or removing an extended magazine returns rounds to reserve',()=>{
 const p=createArmoryProfile({all:true}),id='arclight';
 assert.equal(installAttachment(p,id,'extendedMag').ok,true);assert.equal(p.ammo[id].mag,30,'Attaching a larger magazine does not conjure rounds');
 p.ammo[id]={mag:45,reserve:87};const total=totalAmmo(p,id);
 assert.equal(installAttachment(p,id,'quickMag').ok,true);assert.equal(p.ammo[id].mag,25);assert.equal(p.ammo[id].reserve,107);assert.equal(totalAmmo(p,id),total);
 assert.equal(installAttachment(p,id,'extendedMag').ok,true);assert.equal(p.ammo[id].mag,25);
 p.ammo[id]={mag:45,reserve:27};assert.equal(removeAttachment(p,id,'magazine').ok,true);assert.deepEqual(p.ammo[id],{mag:30,reserve:42});assert.equal(totalAmmo(p,id),72);
});

test('incompatible, absent, malformed and overflowing transactions are atomic',()=>{
 const p=createArmoryProfile({all:true});
 const rejected=(fn,message)=>{const before=JSON.stringify(p);assert.equal(fn().ok,false,message);assert.equal(JSON.stringify(p),before,message);};
 rejected(()=>installAttachment(p,'kestrel9','choke'),'Wrong family');
 rejected(()=>installAttachment(p,'no-weapon','redDot'),'Unknown weapon');
 rejected(()=>installAttachment(p,'arclight','no-attachment'),'Unknown attachment');
 p.ownedAttachments.redDot=0;rejected(()=>installAttachment(p,'arclight','redDot'),'No item');
 p.ownedAttachments.redDot=3;p.ammo.arclight.reserve=-1;rejected(()=>installAttachment(p,'arclight','redDot'),'Invalid reserve');p.ammo.arclight.reserve=120;
 p.ownedAttachments.redDot=Number.MAX_SAFE_INTEGER;assert.equal(installAttachment(p,'arclight','holo').ok,true);
 p.fittings.arclight.optic='redDot';rejected(()=>removeAttachment(p,'arclight','optic'),'Cannot return overflowing item');
 p.ownedAttachments.redDot=3;p.fittings.arclight={magazine:'extendedMag'};p.ammo.arclight={mag:45,reserve:Number.MAX_SAFE_INTEGER};rejected(()=>removeAttachment(p,'arclight','magazine'),'Cannot return overflowing ammo');
 p.ammo.arclight={mag:30,reserve:120};p.fittings.arclight={optic:'choke'};rejected(()=>installAttachment(p,'arclight','holo'),'Malformed fit');
});

test('story progression grants every weapon and attachment without repeated rewards',()=>{
 const p=createArmoryProfile();assert.deepEqual(p.ownedWeapons,['kestrel9','needle']);
 const earned=[];for(let mission=0;mission<18;mission++){earned.push(...grantMissionRewards(p,mission));const before=JSON.stringify(p);assert.deepEqual(grantMissionRewards(p,mission),[]);assert.equal(JSON.stringify(p),before);}
 assert.equal(p.ownedWeapons.length,14);for(const a of ATTACHMENTS)assert.ok(totalAttachments(p,a.id)>=1,a.id);assert.equal(p.claimedArmoryRewards.length,18);assert.ok(earned.length>20);
});

test('save normalization whitelists state, bounds ammo and preserves legitimate fitted inventories',()=>{
 const p=createArmoryProfile({all:true});installAttachment(p,'arclight','extendedMag');p.ammo.arclight={mag:45,reserve:27};p.loadout=['arclight','hush45'];grantMissionRewards(p,3);
 const restored=normalizeArmoryProfile(JSON.parse(JSON.stringify(p)));
 assert.deepEqual(restored.fittings,p.fittings);assert.deepEqual(restored.ownedAttachments,p.ownedAttachments);assert.deepEqual(restored.loadout,p.loadout);assert.deepEqual(restored.ammo.arclight,p.ammo.arclight);
 const invalid=normalizeArmoryProfile({ownedWeapons:['__proto__','constructor','coil'],ownedAttachments:{redDot:-1,holo:Infinity,nope:400},fittings:{coil:{muzzle:'suppressor',optic:'scope6',rail:'constructor'}},ammo:{coil:{mag:999999,reserve:999999}},loadout:['not-owned','coil'],startMission:'overwritten'});
 assert.ok(!invalid.ownedWeapons.includes('__proto__'));assert.ok(!('startMission'in invalid));assert.deepEqual(invalid.fittings.coil,{optic:'scope6'});assert.ok(invalid.ammo.coil.mag<=weaponStats('coil',invalid.fittings.coil).mag);assert.ok(invalid.ammo.coil.reserve<=10000);assert.ok(!('nope'in invalid.ownedAttachments));
 for(const raw of [null,undefined,1,[],{}])assert.ok(normalizeArmoryProfile(raw).ownedWeapons.includes('needle'));
});

test('enemy roster offers separate security, infected and mechanical threats with faction conflict',()=>{
 const values=Object.values(ENEMY_TYPES);assert.ok(values.filter(e=>e.faction==='security').length>=6);assert.ok(values.filter(e=>e.faction==='infected').length>=5);assert.ok(values.filter(e=>e.faction==='machine').length>=3);
 for(const id of ['patrol','assault','shield','sniper','medic','radio','heavy','drone','turret','walker','runner','climber','spitter','brute'])assert.ok(ENEMY_TYPES[id]);
 assert.equal(ENEMY_TYPES.turret.speed,0);assert.ok(ENEMY_TYPES.runner.speed>ENEMY_TYPES.walker.speed);assert.ok(ENEMY_TYPES.brute.hp>ENEMY_TYPES.runner.hp*4);assert.ok(ENEMY_TYPES.shield.frontArmor>.7);
 assert.equal(factionsHostile('security','machine'),false);assert.equal(factionsHostile('infected','security'),true);assert.equal(factionsHostile('infected','machine'),true);assert.equal(factionsHostile('infected','infected'),false);assert.equal(factionsHostile('player','civilian'),false);assert.equal(factionsHostile('player','security'),true);
});
