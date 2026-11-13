import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CAMPAIGN,INTRO,ENDINGS,CHARACTERS,FIELD_NOTES} from '../story.js';
import {LEVELS} from '../levels.js';
const han=text=>(String(text).match(/\p{Script=Han}/gu)||[]).length;
const allLines=()=>[...INTRO,...CAMPAIGN.flatMap(c=>[...c.opening,...c.interlude,...c.closing,...c.radio,...c.choice.options.flatMap(o=>o.reply)]),...Object.values(ENDINGS).flat()];

test('eighteen substantial authored chapters correspond to the actual locations and every portrait and narrative branch is complete',()=>{
 assert.equal(CAMPAIGN.length,18);assert.deepEqual(CAMPAIGN.map(c=>c.title),LEVELS.map(l=>l.title));assert.ok(INTRO.length>=5);
 for(const c of CAMPAIGN){assert.ok(c.opening.length>=5);assert.ok(c.interlude.length>=4);assert.ok(c.closing.length>=3);assert.equal(c.radio.length,4);assert.equal(c.choice.options.length,2);assert.ok(c.letter.length>=300&&han(c.letter)>=260);for(const o of c.choice.options){assert.ok(o.reply.length>=2);assert.ok(['public','care','contain'].includes(o.flag));}}
 for(const line of allLines()){assert.ok(CHARACTERS[line.portrait],line.portrait);assert.ok(line.speaker&&line.text);assert.ok(han(line.text)>=5);}
 assert.deepEqual(Object.keys(ENDINGS).sort(),['care','contain','public']);for(const ending of Object.values(ENDINGS))assert.ok(ending.length>=4);
});

test('optional field documents are individually written, substantial and tied to every location',()=>{
 assert.equal(FIELD_NOTES.length,18);const texts=[];
 for(let i=0;i<18;i++){assert.equal(FIELD_NOTES[i].length,2);assert.deepEqual(CAMPAIGN[i].fieldNotes,FIELD_NOTES[i]);for(const note of FIELD_NOTES[i]){assert.ok(note.title);const n=han(note.text);assert.ok(n>=180&&n<=260,`${i}: ${n}`);texts.push(note.text);}}
 assert.equal(new Set(texts).size,36);
 const dialogue=allLines().map(l=>l.text);assert.equal(new Set(dialogue).size,dialogue.length,'Distinct voices and scenes must not reuse whole dialogue paragraphs');
 const total=[...dialogue,...CAMPAIGN.map(c=>c.letter),...texts].reduce((n,t)=>n+han(t),0);assert.ok(total>=39000,total);
});
