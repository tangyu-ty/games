import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CampaignEngine} from '../campaign-engine.js';
function mission(damage){const g={player:{x:900,y:680,r:16,hp:120,maxHp:120,damage,fireRate:1,multishot:1,crit:0,invuln:0},kills:0,islands:[],difficulty:'normal',makeIslands(){},toast(){}};const engine=new CampaignEngine(g);engine.startChapter(11);return engine;}
test('a stronger story build defeats comparable enemies faster across missions',()=>{const ordinary=mission(250),strong=mission(500);assert.ok(strong.legDps/ordinary.legDps<1.8,'Doubling player DPS does not double enemy health');assert.ok(strong.legDps/500<ordinary.legDps/250,'Power upgrades improve actual time to kill');});
test('defensive low-damage builds do not encounter disproportionate late-story health scaling',()=>{const defensive=mission(40);assert.ok(defensive.legDps<=48.001,'Difficulty adaptation cannot exceed 120% of a slow build');assert.equal(defensive.chapter,11);assert.equal(defensive.kind,'rescue');});
