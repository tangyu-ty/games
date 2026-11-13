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
