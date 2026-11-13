const MENU_MODES=new Set(['menu','briefing','loadout','dialogue','pause','journal','missionComplete','dead','ending','settings','guide','chapters']);
export class Input {
 constructor(game,canvas){
  this.g=game;this.canvas=canvas;this.keys=new Set();this.pressed=new Set();this.released=new Set();this.mouse={x:0,y:0,down:false,aim:false,inside:false};this.pad=null;this.padPrevious=[];this.menuCooldown=0;this.touchMove={x:0,y:0};this.touchAim=null;this.touchActions=new Set();this.handlers=[];this.lastDevice='keyboard';this.lastPadConnected=false;
  this.on(window,'keydown',e=>{if(e.target?.matches('input,select,textarea')&&e.code!=='Escape')return;if(game.mode==='dialogue'&&['Enter','Space'].includes(e.code))e.preventDefault();if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Tab'].includes(e.code)&&game.mode==='playing')e.preventDefault();if(!this.keys.has(e.code))this.pressed.add(e.code);this.keys.add(e.code);this.lastDevice='keyboard';game.audio?.unlock();});
  this.on(window,'keyup',e=>{this.keys.delete(e.code);this.released.add(e.code);});
  this.on(window,'blur',()=>{this.clear();if(game.mode==='playing'||game.mode==='dialogue')game.pause();});
  this.on(document,'visibilitychange',()=>{if(document.hidden){this.clear();if(game.mode==='playing'||game.mode==='dialogue')game.pause();}});
  this.on(this.canvas,'pointermove',e=>{const b=canvas.getBoundingClientRect();this.mouse.x=e.clientX-b.left;this.mouse.y=e.clientY-b.top;this.mouse.inside=true;if(e.pointerType!=='touch')this.lastDevice='mouse';});
  this.on(this.canvas,'pointerdown',e=>{game.audio?.unlock();if(e.pointerType==='touch'){this.startAim(e);return;}if(e.button===0){this.mouse.down=true;this.pressed.add('Fire');}if(e.button===2)this.mouse.aim=true;});
  this.on(window,'pointerup',e=>{if(e.button===0)this.mouse.down=false;if(e.button===2)this.mouse.aim=false;if(e.pointerType==='touch'&&this.touchAim?.id===e.pointerId)this.touchAim=null;});
  this.on(this.canvas,'contextmenu',e=>e.preventDefault());
  this.on(window,'gamepaddisconnected',()=>{this.pad=null;this.padPrevious=[];this.clear();if(game.mode==='playing')game.pause();});
  this.on(document,'pointerdown',e=>{const el=e.target.closest('[data-touch]');if(!el)return;e.preventDefault();game.audio?.unlock();this.lastDevice='touch';const action=el.dataset.touch;this.touchActions.add(action);this.pressed.add('Touch:'+action);el.setPointerCapture?.(e.pointerId);const end=()=>{this.touchActions.delete(action);this.released.add('Touch:'+action);el.removeEventListener('pointerup',end);el.removeEventListener('pointercancel',end);};el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);});
  this.installTouch();
 }
 on(target,event,fn,options){target.addEventListener(event,fn,options);this.handlers.push(()=>target.removeEventListener(event,fn,options));}
 installTouch(){
  const root=document.getElementById('touchControls');if(!root)return;
  if(!root.querySelector('[data-stick]'))root.insertAdjacentHTML('afterbegin','<div class="move-stick" data-stick="move" aria-label="移动摇杆"><i></i></div>');
  const stick=root.querySelector('[data-stick]');let id=null,origin={x:0,y:0};
  const update=e=>{if(e.pointerId!==id)return;const dx=e.clientX-origin.x,dy=e.clientY-origin.y,len=Math.hypot(dx,dy),scale=1/Math.max(48,len);this.touchMove={x:dx*scale,y:dy*scale};stick.style.setProperty('--sx',this.touchMove.x*35+'px');stick.style.setProperty('--sy',this.touchMove.y*35+'px');};
  this.on(stick,'pointerdown',e=>{e.preventDefault();id=e.pointerId;const b=stick.getBoundingClientRect();origin={x:b.x+b.width/2,y:b.y+b.height/2};stick.setPointerCapture(id);this.lastDevice='touch';update(e);});this.on(stick,'pointermove',update);
  const end=e=>{if(e.pointerId===id){id=null;this.touchMove={x:0,y:0};stick.style.setProperty('--sx','0px');stick.style.setProperty('--sy','0px');}};this.on(stick,'pointerup',end);this.on(stick,'pointercancel',end);
  this.on(this.canvas,'pointermove',e=>{if(this.touchAim?.id===e.pointerId){this.touchAim.x=e.clientX;this.touchAim.y=e.clientY;}});this.on(this.canvas,'pointercancel',()=>{this.touchAim=null;});
 }
 startAim(e){const b=this.canvas.getBoundingClientRect();if(e.clientX-b.left<b.width*.36)return;this.touchAim={id:e.pointerId,x:e.clientX,y:e.clientY,originX:e.clientX,originY:e.clientY};this.canvas.setPointerCapture?.(e.pointerId);this.lastDevice='touch';}
 clear(){this.keys.clear();this.pressed.clear();this.released.clear();this.mouse.down=false;this.mouse.aim=false;this.touchMove={x:0,y:0};this.touchAim=null;this.touchActions.clear();}
 down(...codes){return codes.some(c=>this.keys.has(c));}
 hit(...codes){return codes.some(c=>this.pressed.has(c));}
 pollPad(){
  let pads=[];try{pads=navigator.getGamepads?.()||[];}catch{this.pad=null;return;}
  this.pad=Array.from(pads).find(p=>p?.connected)||null;const p=this.pad;
  if(!p){this.padPrevious=[];return;}
  this.padEdges=p.buttons.map((b,i)=>b.pressed&&!this.padPrevious[i]);if(p.buttons.some(b=>b.pressed)||p.axes.some(a=>Math.abs(a)>.22))this.lastDevice='gamepad';
 }
 padDown(i){return !!this.pad?.buttons[i]?.pressed;}
 padHit(i){return !!this.padEdges?.[i];}
 axis(i){const n=this.pad?.axes[i]||0,d=this.g.settings?.deadzone??.18;return Math.abs(n)>d?Math.sign(n)*(Math.abs(n)-d)/(1-d):0;}
 update(dt){
  this.pollPad();this.menuCooldown=Math.max(0,this.menuCooldown-dt);
  if(this.padHit(9)||this.hit('Escape','KeyP')||this.hit('Touch:pause')){if(this.g.mode==='playing'||this.g.mode==='dialogue')this.g.pause();else if(this.g.mode==='pause')this.g.resume();else if(this.g.mode==='loadout'||this.g.mode==='journal'||this.g.mode==='guide'||this.g.mode==='settings')this.g.back();}
  if(MENU_MODES.has(this.g.mode))this.menu(dt);else if(this.g.mode==='playing')this.combat(dt);
  if(this.pad)this.padPrevious=this.pad.buttons.map(b=>b.pressed);this.pressed.clear();this.released.clear();
 }
 menu(dt=1/60){
  const overlay=document.getElementById('overlay');if(!overlay)return;
  const scrollAxis=this.axis(3);if(Math.abs(scrollAxis)>.12){const choices=[overlay.querySelector('.dialogue-text'),overlay.querySelector('.journal-content'),document.activeElement?.closest('.screen-scroll'),overlay.firstElementChild,overlay];const scrollTarget=choices.find(el=>el&&el.scrollHeight>el.clientHeight+4);if(scrollTarget)scrollTarget.scrollTop+=scrollAxis*480*dt;}
  if(this.padHit(1)){this.g.back();return;}
  if(this.g.mode==='dialogue'&&this.hit('Enter','Space')){if(this.g.dialogueState?.choice)document.activeElement?.click?.();else this.g.advanceDialogue();return;}
  const items=Array.from(overlay.querySelectorAll('button:not([disabled]),select,a[href],input')).filter(e=>e.getClientRects().length);
  let move=0;if(this.hit('ArrowDown','ArrowRight')||this.padHit(13)||this.padHit(15))move=1;if(this.hit('ArrowUp','ArrowLeft')||this.padHit(12)||this.padHit(14))move=-1;
  const axis=this.axis(1);if(Math.abs(axis)>.55&&this.menuCooldown===0){move=axis>0?1:-1;this.menuCooldown=.2;}
  if(move&&items.length){const cur=items.indexOf(document.activeElement),next=items[(cur+move+items.length)%items.length];next.focus();next.scrollIntoView({block:'nearest',inline:'nearest'});}
  if(this.padHit(0)){this.g.audio?.unlock();const active=document.activeElement;if(active?.tagName==='SELECT'){const options=Array.from(active.options).filter(o=>!o.disabled);const index=options.findIndex(o=>o.value===active.value);active.value=options[(index+1)%options.length]?.value||active.value;active.dispatchEvent(new Event('change',{bubbles:true}));return;}if(items.includes(document.activeElement))document.activeElement.click();else{(items.find(x=>x.id==='dialogueNext')||items[0])?.focus();(items.find(x=>x.id==='dialogueNext')||items[0])?.click();}}
 }
 combat(dt){
  const g=this.g,p=g.player;let x=(this.down('KeyD','ArrowRight')?1:0)-(this.down('KeyA','ArrowLeft')?1:0)+this.axis(0)+this.touchMove.x,y=(this.down('KeyS','ArrowDown')?1:0)-(this.down('KeyW','ArrowUp')?1:0)+this.axis(1)+this.touchMove.y;
  const len=Math.hypot(x,y);if(len>1){x/=len;y/=len;}
  const rx=this.axis(2),ry=this.axis(3);let aim=null,fire=this.mouse.down||this.padDown(7)||this.touchActions.has('fire');
  if(Math.hypot(rx,ry)>.15)aim=Math.atan2(ry,rx);
  if(this.lastDevice==='mouse'&&this.mouse.inside){const b=this.canvas.getBoundingClientRect(),wx=g.camera.x+(this.mouse.x-b.width/2)/g.camera.zoom,wy=g.camera.y+(this.mouse.y-b.height/2)/g.camera.zoom;aim=Math.atan2(wy-p.y,wx-p.x);}
  if(this.touchAim){const dx=this.touchAim.x-this.touchAim.originX,dy=this.touchAim.y-this.touchAim.originY;if(Math.hypot(dx,dy)>12){aim=Math.atan2(dy,dx);fire=true;}}
  if(aim!==null)p.angle=aim;
  g.controls={x,y,fire,aim:this.mouse.aim||this.padDown(6)||this.touchActions.has('aim'),sprint:this.down('ShiftLeft','ShiftRight')||this.padDown(10)||this.touchActions.has('sprint'),interact:this.down('KeyF')||this.padDown(0)||this.touchActions.has('interact'),lean:(this.down('KeyX')?1:0)-(this.down('KeyZ')?1:0)};
  if(this.hit('Space','Touch:dodge')||this.padHit(1))g.dodge(x,y);
  if(this.hit('KeyC','Touch:cover')||this.padHit(5))g.toggleCover();
  if(this.hit('ControlLeft','ControlRight','Touch:crouch')||this.padHit(11))g.toggleCrouch();
  if(this.hit('KeyR','Touch:reload')||this.padHit(2))g.reload();
  if(this.hit('KeyQ','Touch:swap')||this.padHit(3))g.switchWeapon();
  if(this.hit('Digit1'))g.switchWeapon(0);if(this.hit('Digit2'))g.switchWeapon(1);
  if(this.hit('KeyG','Touch:grenade')||this.padHit(4))g.throwGrenade();
  if(this.hit('KeyT','Touch:grenadeType')||this.padHit(15))g.cycleGrenade();
  if(this.hit('KeyE','Touch:flash')||this.padHit(14))g.throwGrenade('flash');
  if(this.hit('KeyV','Touch:heal')||this.padHit(12))g.heal();
  if(this.hit('KeyM','KeyL','Touch:journal')||this.padHit(8))g.showJournal();
  if(this.hit('Tab','Touch:loadout'))g.showLoadout();
 }
 dispose(){this.handlers.forEach(f=>f());}
}
