import {Game} from './game.js';
import {Input3D} from './input3d.js';
import {UI} from './ui.js';
import {Renderer3D} from './render3d.js';
import {findPath} from './geometry.js';

const canvas=document.getElementById('game');
const game=new Game(canvas);
game.renderer=new Renderer3D(canvas);
game.ui=new UI(game);
game.input=new Input3D(game,canvas);
game.pathTo=(a,b)=>findPath(a,b,game.level,a.r||15);
game.ui.render('menu');
if(new URLSearchParams(location.search).has('test'))window.__dc=game;
let last=performance.now(),accumulator=0,lastDraw=0,lastMode='',lastLevel=null;
function frame(now){
 const delta=Math.min(.2,(now-last)/1000);last=now;accumulator+=delta;let steps=0;
 while(accumulator>=1/60&&steps<8){game.update(1/60);accumulator-=1/60;steps++;}
 if(steps===8)accumulator=0;
 // Menus and dialogue do not advance the world. Keep input responsive while
 // avoiding a full WebGL redraw every frame behind an opaque interface.
 if(game.mode==='playing'||game.mode!==lastMode||game.level!==lastLevel||now-lastDraw>=200){
  game.renderer.draw(game,delta);lastDraw=now;lastMode=game.mode;lastLevel=game.level;
 }
 requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.addEventListener('pagehide',()=>game.save());
