import {test} from 'node:test';
import assert from 'node:assert/strict';
import {UI} from '../ui.js';
import {WEAPONS,weaponStats,createArmoryProfile} from '../armory.js';

test('armory renders derived effective range in metres while keeping the world-unit range and gauge unchanged',()=>{
 const originalFrame=globalThis.requestAnimationFrame,catalog=JSON.stringify(WEAPONS);
 // Render the real armory template without a browser, animation or GPU context.
 globalThis.requestAnimationFrame=()=>0;
 try{
  for(const [fittings,metres,worldRange,gauge] of [[{},'21.0',1050,'65.625'],[{optic:'scope3'},'23.5',1176,'73.5']]){
   const profile=createArmoryProfile({all:true});profile.fittings.arclight=fittings;const savedProfile=JSON.stringify(profile);let html='';
   const ui={g:{profile},selectedWeapon:'arclight',selectedSlot:'muzzle',overlay:{querySelectorAll:()=>[]},mount(markup){html=markup;},on(){},stat:UI.prototype.stat};
   UI.prototype.loadout.call(ui);
   assert.ok(html.includes(`<span>有效射程 / 米</span><strong>${metres}</strong>`),'The visible value uses metres with one decimal place');
   assert.ok(html.includes(`<span>有效射程 / 米</span><strong>${metres}</strong><div class="stat-meter"><i style="width:${gauge}%">`),'The range gauge still uses the original world-unit scale');
   assert.equal(weaponStats('arclight',fittings).range,worldRange);assert.equal(JSON.stringify(profile),savedProfile,'Rendering does not change equipment or ammunition');
  }
  assert.equal(JSON.stringify(WEAPONS),catalog,'Rendering cannot rewrite weapon definitions');
 }finally{if(originalFrame===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=originalFrame;}
});

test('deferred modal autofocus preserves a newly selected control and ignores callbacks from an older modal',()=>{
 const previousDocument=globalThis.document,previousFrame=globalThis.requestAnimationFrame,frames=[],focuses=[];
 const body={classList:{toggle(){}}},hud={},overlay={members:new Set(),className:'',contains(element){return this.members.has(element);},querySelector(selector){if(selector==='[data-autofocus]'||selector==='.primary:not([disabled])'||selector==='button:not([disabled])')return this.primary;return null;}};
 const document={body,activeElement:body,getElementById:id=>id==='hud'?hud:null};
 const element=id=>({id,disabled:false,getClientRects:()=>[{}],focus(){document.activeElement=this;focuses.push(id);}});
 Object.defineProperty(overlay,'innerHTML',{set(){document.activeElement=body;this.members=new Set([this.primary,this.select]);}});
 globalThis.document=document;globalThis.requestAnimationFrame=callback=>{frames.push(callback);return frames.length;};
 const ui={g:{settings:{},renderer:{}},overlay};
 try{
  overlay.primary=element('settingsBack');overlay.select=element('deadzoneSetting');UI.prototype.mount.call(ui,'settings','settings');overlay.select.focus();frames.shift()();assert.equal(document.activeElement.id,'deadzoneSetting','A user/controller-selected select keeps focus when delayed autofocus finally runs');
  const count=focuses.length;overlay.primary=element('oldConfirm');UI.prototype.mount.call(ui,'first','menu');overlay.primary=element('dialogueNext');UI.prototype.mount.call(ui,'second','dialogue');frames.shift()();assert.equal(document.activeElement,body,'An old modal callback cannot focus controls in the new modal');assert.equal(focuses.length,count);frames.shift()();assert.equal(document.activeElement.id,'dialogueNext','Without a newer user selection, the normal confirm action still receives focus');
 }finally{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;if(previousFrame===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=previousFrame;}
});
