// Third-person shoulder controls. World yaw remains the original game's angle:
// (cos(yaw), sin(yaw)) is forward, and positive pitch looks upward.
const MENU_MODES=new Set(['menu','briefing','loadout','dialogue','pause','journal','missionComplete','dead','ending','settings','guide','chapters']);
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const finite=(n,fallback=0)=>Number.isFinite(n)?n:fallback;
const wrap=n=>Math.atan2(Math.sin(n),Math.cos(n));
const editTarget=element=>!!element?.matches?.('input,select,textarea,[contenteditable="true"]');

export class Input3D{
 constructor(game,canvas){
  this.g=game;this.canvas=canvas;this.keys=new Set();this.pressed=new Set();this.released=new Set();
  this.mouse={x:0,y:0,down:false,aim:false,inside:false,lastX:null,lastY:null};
  this.pad=null;this.padPrevious=[];this.padEdges=[];this.blockedPadButtons=new Set();this.lastPadConnected=false;
  this.touchMove={x:0,y:0};this.touchAim=null;this.touchActions=new Set();this.touchBindings=new Map();this.stickPointer=null;
  this.lookDelta={mouseX:0,mouseY:0,touchX:0,touchY:0};this.handlers=[];this.lastDevice='keyboard';this.menuCooldown=0;
  this.lastMode=game.mode;this.wasPointerLocked=false;this.unlockPending=false;this.lockRequestPending=false;
  this.pointerLockDenied=false;this.disposed=false;this.lockTimeout=null;this.errorToastAt=-Infinity;this.escapePauseUntil=0;

  this.on(window,'keydown',event=>{
   if(event.code==='Escape'&&game.mode==='pause'&&performance.now()<this.escapePauseUntil){event.preventDefault();return;}
   if(editTarget(event.target)&&event.code!=='Escape')return;
   if(game.mode==='dialogue'&&['Enter','Space'].includes(event.code))event.preventDefault();
   if(game.mode==='playing'&&['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Tab'].includes(event.code))event.preventDefault();
   if(!this.keys.has(event.code))this.pressed.add(event.code);this.keys.add(event.code);this.lastDevice='keyboard';game.audio?.unlock();
  });
  this.on(window,'keyup',event=>{this.keys.delete(event.code);this.released.add(event.code);});
  this.on(window,'blur',()=>this.loseFocus());
  this.on(document,'visibilitychange',()=>{if(document.hidden)this.loseFocus();});
  this.on(document,'pointerlockchange',()=>this.pointerLockChanged());
  this.on(document,'pointerlockerror',()=>this.lockFailed());
  this.on(document,'mousemove',event=>this.mouseLook(event));
  this.on(canvas,'pointerdown',event=>{
   if(event.pointerType==='touch')this.startLook(event);
  });
  // Pointer Events emit one pointerdown for a mouse chord. Mouse events retain
  // independent left/right transitions, so firing while holding ADS works.
  this.on(canvas,'mousedown',event=>{
   if(game.mode!=='playing')return;
   game.audio?.unlock();
   this.lastDevice='mouse';this.mouse.inside=true;this.mouse.lastX=event.clientX;this.mouse.lastY=event.clientY;
   if(event.button===0){
    // Focusing the browser game should not accidentally fire into the world.
    if(this.pointerLocked||this.lookFallback){this.mouse.down=true;this.pressed.add('Fire');}
    if(!this.pointerLocked&&!this.lookFallback)this.captureMouse();
   }
   if(event.button===2)this.mouse.aim=true;
  });
  this.on(window,'mouseup',event=>{if(event.button===0)this.mouse.down=false;if(event.button===2)this.mouse.aim=false;});
  this.on(window,'pointerup',event=>{
   if(this.touchAim?.id===event.pointerId)this.endLook(event.pointerId);
  });
  this.on(canvas,'contextmenu',event=>event.preventDefault());
  this.on(canvas,'pointermove',event=>{if(event.pointerType==='touch')this.touchLook(event);});
  this.on(canvas,'pointercancel',event=>this.endLook(event.pointerId));
  this.on(window,'gamepaddisconnected',()=>this.padDisconnected());
  this.on(document,'pointerdown',event=>this.touchButton(event));
  this.installTouch();
 }

 get pointerLocked(){return document.pointerLockElement===this.canvas;}
 get lookFallback(){return this.pointerLockDenied||typeof this.canvas.requestPointerLock!=='function';}
 on(target,event,fn,options){target?.addEventListener(event,fn,options);this.handlers.push(()=>target?.removeEventListener(event,fn,options));}

 captureMouse(){
  if(this.disposed||this.g.mode!=='playing')return false;
  if(this.pointerLocked)return true;
  if(this.lockRequestPending||this.unlockPending)return false;
  if(typeof this.canvas.requestPointerLock!=='function'){this.lockFailed();return false;}
  this.lockRequestPending=true;this.lastDevice='mouse';
  clearTimeout(this.lockTimeout);this.lockTimeout=setTimeout(()=>{this.lockRequestPending=false;},1600);
  try{
   const pending=this.canvas.requestPointerLock();
   pending?.catch?.(()=>this.lockFailed());
   return true;
  }catch{this.lockFailed();return false;}
 }
 releaseMouse(){
  if(this.unlockPending)return;
  if(!this.pointerLocked&&!this.wasPointerLocked)return;
  this.unlockPending=true;this.mouse.down=false;this.mouse.aim=false;
  try{document.exitPointerLock?.();}catch{this.unlockPending=false;}
 }
 pointerLockChanged(){
  const locked=this.pointerLocked,previous=this.wasPointerLocked,intentional=this.unlockPending;
  this.wasPointerLocked=locked;this.lockRequestPending=false;this.unlockPending=false;clearTimeout(this.lockTimeout);
  document.body.classList.toggle('mouse-captured',locked);
  if(locked){this.pointerLockDenied=false;this.mouse.lastX=null;this.mouse.lastY=null;if(this.g.mode!=='playing')this.releaseMouse();return;}
  this.mouse.down=false;this.mouse.aim=false;this.lookDelta={mouseX:0,mouseY:0,touchX:0,touchY:0};
  if(previous&&!intentional&&!this.disposed&&this.g.mode==='playing'){this.escapePauseUntil=performance.now()+250;this.clear();this.g.pause();}
 }
 lockFailed(){
  if(this.disposed)return;
  this.lockRequestPending=false;this.pointerLockDenied=true;clearTimeout(this.lockTimeout);
  this.mouse.down=false;
  const now=performance.now();
  if(this.g.mode==='playing'&&now-this.errorToastAt>5000){this.errorToastAt=now;this.g.toast?.('浏览器未锁定鼠标：按住右键拖动视角，左键开火；Esc 暂停。');}
 }
 mouseLook(event){
  if(this.g.mode!=='playing'||!this.g.player)return;
  const b=this.canvas.getBoundingClientRect();this.mouse.x=event.clientX-b.left;this.mouse.y=event.clientY-b.top;
  const inside=event.target===this.canvas||this.canvas.contains?.(event.target);this.mouse.inside=!!inside;
  if(this.pointerLocked||(this.mouse.aim&&inside)){
   let dx=finite(event.movementX),dy=finite(event.movementY);
   if(!this.pointerLocked&&this.mouse.lastX!==null&&this.mouse.lastY!==null){dx=event.clientX-this.mouse.lastX;dy=event.clientY-this.mouse.lastY;}
   this.lookDelta.mouseX+=clamp(dx,-250,250);this.lookDelta.mouseY+=clamp(dy,-250,250);this.lastDevice='mouse';
  }
  this.mouse.lastX=event.clientX;this.mouse.lastY=event.clientY;
 }
 loseFocus(){this.clear();if(this.g.mode==='playing'||this.g.mode==='dialogue')this.g.pause();this.releaseMouse();}

 installTouch(){
  const root=document.getElementById('touchControls');if(!root)return;
  if(!root.querySelector('[data-stick]'))root.insertAdjacentHTML('afterbegin','<div class="move-stick" data-stick="move" aria-label="移动摇杆"><i></i></div>');
  const stick=root.querySelector('[data-stick]');this.stick=stick;
  const update=event=>{
   if(this.stickPointer!==event.pointerId||this.g.mode!=='playing')return;
   const rect=stick.getBoundingClientRect(),dx=event.clientX-(rect.x+rect.width/2),dy=event.clientY-(rect.y+rect.height/2),scale=1/Math.max(48,Math.hypot(dx,dy));
   this.touchMove={x:dx*scale,y:dy*scale};stick.style.setProperty('--sx',this.touchMove.x*35+'px');stick.style.setProperty('--sy',this.touchMove.y*35+'px');
  };
  this.on(stick,'pointerdown',event=>{if(this.g.mode!=='playing')return;event.preventDefault();this.stickPointer=event.pointerId;this.lastDevice='touch';this.g.audio?.unlock();try{stick.setPointerCapture(event.pointerId);}catch{}update(event);});
  this.on(stick,'pointermove',update);
  const end=event=>{if(this.stickPointer!==event.pointerId)return;this.stickPointer=null;this.touchMove={x:0,y:0};stick.style.setProperty('--sx','0px');stick.style.setProperty('--sy','0px');};
  this.on(stick,'pointerup',end);this.on(stick,'pointercancel',end);this.on(stick,'lostpointercapture',end);
  const look=document.querySelector('[data-look],#aimPad');
  if(look){this.on(look,'pointerdown',event=>this.startLook(event));this.on(look,'pointermove',event=>this.touchLook(event));this.on(look,'pointerup',event=>this.endLook(event.pointerId));this.on(look,'pointercancel',event=>this.endLook(event.pointerId));}
 }
 startLook(event){
  if(this.g.mode!=='playing'||event.pointerType!=='touch'||this.touchAim)return;
  const bounds=this.canvas.getBoundingClientRect();if(event.target===this.canvas&&event.clientX-bounds.left<bounds.width*.35)return;
  event.preventDefault();this.touchAim={id:event.pointerId,x:event.clientX,y:event.clientY,element:event.currentTarget||this.canvas};this.lastDevice='touch';this.g.audio?.unlock();
  try{this.touchAim.element.setPointerCapture?.(event.pointerId);}catch{}
 }
 touchLook(event){
  const look=this.touchAim;if(!look||look.id!==event.pointerId||this.g.mode!=='playing')return;
  event.preventDefault();this.lookDelta.touchX+=clamp(event.clientX-look.x,-200,200);this.lookDelta.touchY+=clamp(event.clientY-look.y,-200,200);look.x=event.clientX;look.y=event.clientY;this.lastDevice='touch';
 }
 endLook(id){
  if(this.touchAim?.id!==id)return;
  const look=this.touchAim;this.touchAim=null;
  try{if(look.element?.hasPointerCapture?.(id))look.element.releasePointerCapture(id);}catch{}
 }
 touchButton(event){
  const element=event.target?.closest?.('[data-touch]');if(!element||this.g.mode!=='playing')return;
  event.preventDefault();this.g.audio?.unlock();this.lastDevice='touch';
  const action=element.dataset.touch,id=event.pointerId;this.touchActions.add(action);this.pressed.add('Touch:'+action);
  try{element.setPointerCapture?.(id);}catch{}
  const end=up=>{if(up.pointerId!==id)return;this.touchActions.delete(action);this.released.add('Touch:'+action);cleanup();};
  const cleanup=()=>{element.removeEventListener('pointerup',end);element.removeEventListener('pointercancel',end);element.removeEventListener('lostpointercapture',end);this.touchBindings.delete(id);};
  element.addEventListener('pointerup',end);element.addEventListener('pointercancel',end);element.addEventListener('lostpointercapture',end);this.touchBindings.set(id,{element,cleanup});
 }

 clear(){
  this.keys.clear();this.pressed.clear();this.released.clear();this.mouse.down=false;this.mouse.aim=false;this.mouse.lastX=null;this.mouse.lastY=null;
  this.lookDelta={mouseX:0,mouseY:0,touchX:0,touchY:0};this.touchMove={x:0,y:0};this.touchActions.clear();
  if(this.touchAim)this.endLook(this.touchAim.id);
  if(this.stickPointer!==null){try{if(this.stick?.hasPointerCapture?.(this.stickPointer))this.stick.releasePointerCapture(this.stickPointer);}catch{}this.stickPointer=null;}
  this.stick?.style.setProperty('--sx','0px');this.stick?.style.setProperty('--sy','0px');
  for(const [id,binding]of [...this.touchBindings]){binding.cleanup();try{if(binding.element.hasPointerCapture?.(id))binding.element.releasePointerCapture(id);}catch{}}
  this.pad?.buttons.forEach((button,index)=>{if(button.pressed)this.blockedPadButtons.add(index);});
  this.g.controls={x:0,y:0,fire:false,aim:false,sprint:false,interact:false,lean:0};
  this.lastMode=this.g.mode;
  if(this.g.mode!=='playing')this.releaseMouse();
 }
 down(...codes){return codes.some(code=>this.keys.has(code));}
 hit(...codes){return codes.some(code=>this.pressed.has(code));}
 padDisconnected(){this.pad=null;this.padPrevious=[];this.padEdges=[];this.blockedPadButtons.clear();this.lastPadConnected=false;this.clear();if(this.g.mode==='playing')this.g.pause();}
 pollPad(){
  let pads=[];try{pads=navigator.getGamepads?.()||[];}catch{}
  const previous=this.lastPadConnected;this.pad=Array.from(pads).find(pad=>pad?.connected)||null;this.lastPadConnected=!!this.pad;
  if(!this.pad){this.padEdges=[];this.padPrevious=[];if(previous)this.padDisconnected();return;}
  this.pad.buttons.forEach((button,index)=>{if(!button.pressed)this.blockedPadButtons.delete(index);});
  this.padEdges=this.pad.buttons.map((button,index)=>button.pressed&&!this.padPrevious[index]);
  if(this.pad.buttons.some(button=>button.pressed)||this.pad.axes.some(value=>Math.abs(value)>.22))this.lastDevice='gamepad';
 }
 padDown(index){return !this.blockedPadButtons.has(index)&&!!this.pad?.buttons[index]?.pressed;}
 padHit(index){return !this.blockedPadButtons.has(index)&&!!this.padEdges[index];}
 axis(index){const value=clamp(finite(this.pad?.axes[index]),-1,1),deadzone=clamp(finite(this.g.settings?.deadzone,.18),.08,.4);return Math.abs(value)>deadzone?Math.sign(value)*(Math.abs(value)-deadzone)/(1-deadzone):0;}
 syncMode(){if(this.lastMode!==this.g.mode){this.clear();this.lastMode=this.g.mode;}if(this.g.mode!=='playing'&&this.pointerLocked)this.releaseMouse();}

 update(dt){
  if(this.disposed)return;
  dt=clamp(finite(dt,1/60),0,.1);this.pollPad();this.syncMode();this.menuCooldown=Math.max(0,this.menuCooldown-dt);
  if(this.padHit(9)||this.hit('Escape','KeyP')||this.hit('Touch:pause')){
   if(this.g.mode==='playing'||this.g.mode==='dialogue')this.g.pause();else if(this.g.mode==='pause')this.g.resume();else if(['loadout','journal','guide','settings'].includes(this.g.mode))this.g.back();
  }
  if(MENU_MODES.has(this.g.mode))this.menu(dt);else if(this.g.mode==='playing')this.combat(dt);
  this.syncMode();if(this.pad)this.padPrevious=this.pad.buttons.map(button=>button.pressed);this.pressed.clear();this.released.clear();
 }
 menu(dt){
  const overlay=document.getElementById('overlay');if(!overlay)return;
  const scroll=this.axis(3);
  if(Math.abs(scroll)>.12){const choices=[overlay.querySelector('.dialogue-text'),overlay.querySelector('.journal-content'),document.activeElement?.closest('.screen-scroll'),overlay.firstElementChild,overlay];const target=choices.find(element=>element&&element.scrollHeight>element.clientHeight+4);if(target)target.scrollTop+=scroll*480*dt;}
  if(this.padHit(1)){this.g.back();return;}
  if(this.g.mode==='dialogue'&&this.hit('Enter','Space')){if(this.g.dialogueState?.choice)document.activeElement?.click?.();else this.g.advanceDialogue();return;}
  const items=Array.from(overlay.querySelectorAll('button:not([disabled]),select,a[href],input')).filter(element=>element.getClientRects().length);
  let move=0;
  if(this.hit('ArrowDown','ArrowRight')||this.padHit(13)||this.padHit(15))move=1;
  if(this.hit('ArrowUp','ArrowLeft')||this.padHit(12)||this.padHit(14))move=-1;
  const axis=this.axis(1);if(Math.abs(axis)>.55&&this.menuCooldown===0){move=axis>0?1:-1;this.menuCooldown=.2;}
  if(move&&items.length){const current=items.indexOf(document.activeElement),next=items[(current+move+items.length)%items.length];next.focus();next.scrollIntoView({block:'nearest',inline:'nearest'});}
  if(this.padHit(0)){
   this.g.audio?.unlock();const active=document.activeElement;
   if(active?.tagName==='SELECT'){const options=Array.from(active.options).filter(option=>!option.disabled),index=options.findIndex(option=>option.value===active.value);active.value=options[(index+1)%options.length]?.value||active.value;active.dispatchEvent(new Event('change',{bubbles:true}));return;}
   if(items.includes(active))active.click();else{const next=items.find(element=>element.id==='dialogueNext')||items[0];next?.focus();next?.click();}
  }
 }
 combat(dt){
  const g=this.g,p=g.player;if(!p)return;
  const aim=this.mouse.aim||this.padDown(6)||this.touchActions.has('aim'),factor=aim?.55:1;
  const mouseSensitivity=clamp(finite(g.settings?.mouseSensitivity,.0026),.0005,.012),touchSensitivity=clamp(finite(g.settings?.touchSensitivity,.0052),.001,.02);
  const padSensitivity=clamp(finite(g.settings?.lookSensitivity,1),.25,3),invert=g.settings?.invertY?-1:1;
  const yawDelta=this.lookDelta.mouseX*mouseSensitivity+this.lookDelta.touchX*touchSensitivity+this.axis(2)*2.4*padSensitivity*dt;
  const pitchDelta=-(this.lookDelta.mouseY*mouseSensitivity+this.lookDelta.touchY*touchSensitivity+this.axis(3)*1.65*padSensitivity*dt)*invert;
  p.angle=wrap(finite(p.angle)+yawDelta*factor);p.pitch=clamp(finite(p.pitch)+pitchDelta*factor,-1.08,1.08);
  this.lookDelta={mouseX:0,mouseY:0,touchX:0,touchY:0};
  let side=(this.down('KeyD','ArrowRight')?1:0)-(this.down('KeyA','ArrowLeft')?1:0)+this.axis(0)+this.touchMove.x;
  let forward=(this.down('KeyW','ArrowUp')?1:0)-(this.down('KeyS','ArrowDown')?1:0)-this.axis(1)-this.touchMove.y;
  const length=Math.hypot(side,forward);if(length>1){side/=length;forward/=length;}
  const cos=Math.cos(p.angle),sin=Math.sin(p.angle),x=cos*forward-sin*side,y=sin*forward+cos*side;
  g.controls={x,y,fire:this.mouse.down||this.padDown(7)||this.touchActions.has('fire'),aim,sprint:this.down('ShiftLeft','ShiftRight')||this.padDown(10)||this.touchActions.has('sprint'),interact:this.down('KeyF')||this.padDown(0)||this.touchActions.has('interact'),lean:(this.down('KeyX')?1:0)-(this.down('KeyZ')?1:0)};
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
 dispose(){this.disposed=true;this.clear();this.releaseMouse();clearTimeout(this.lockTimeout);for(const remove of this.handlers)remove();this.handlers=[];document.body.classList.remove('mouse-captured');}
}

export const Input=Input3D;
