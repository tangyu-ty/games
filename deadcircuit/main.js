import {Game} from './game.js';
import {Input} from './input.js';
import {UI} from './ui.js';
import {Renderer} from './render.js';
import {findPath} from './geometry.js';

const canvas=document.getElementById('game');
const game=new Game(canvas);
game.renderer=new Renderer(canvas);
game.ui=new UI(game);
game.input=new Input(game,canvas);
game.pathTo=(a,b)=>findPath(a,b,game.level,a.r||15);
game.ui.render('menu');
if(new URLSearchParams(location.search).has('test'))window.__dc=game;
let last=performance.now(),accumulator=0;
function frame(now){const delta=Math.min(.2,(now-last)/1000);last=now;accumulator+=delta;let steps=0;while(accumulator>=1/60&&steps<8){game.update(1/60);accumulator-=1/60;steps++;}if(steps===8)accumulator=0;game.renderer.draw(game,delta);requestAnimationFrame(frame);}
requestAnimationFrame(frame);
window.addEventListener('pagehide',()=>game.save());
