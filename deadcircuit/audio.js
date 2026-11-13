/** Original procedural audio. No recordings, network, or external sound fonts. */
export class AudioEngine {
 constructor(){this.context=null;this.master=null;this.music=null;this.effects=null;this.muted=false;this.step=0;this.nextBeat=0;this.lastMode='';this.noiseBuffer=null;this.lastSounds=new Map();this.disposed=false;}
 unlock(){
  if(this.disposed)return;
  try{
   if(!this.context){
    const AudioContext=globalThis.AudioContext||globalThis.webkitAudioContext;if(!AudioContext)return;
    this.context=new AudioContext();this.master=this.context.createGain();this.master.gain.value=this.muted?0:.44;this.master.connect(this.context.destination);
    this.music=this.context.createGain();this.music.gain.value=.12;this.music.connect(this.master);
    this.effects=this.context.createGain();this.effects.gain.value=.6;this.effects.connect(this.master);
    const length=this.context.sampleRate*2;this.noiseBuffer=this.context.createBuffer(1,length,this.context.sampleRate);const channel=this.noiseBuffer.getChannelData(0);let seed=193273;
    for(let i=0;i<length;i++){seed=(Math.imul(seed,1664525)+1013904223)|0;channel[i]=((seed>>>0)/4294967296)*2-1;}
    this.nextBeat=this.context.currentTime;
   }
   if(this.context.state==='suspended')this.context.resume().catch(()=>{});
  }catch{/* Audio failure must never block input or gameplay. */}
 }
 setMuted(value){this.muted=Boolean(value);if(this.context&&this.master)this.master.gain.setTargetAtTime(this.muted?0:.44,this.context.currentTime,.045);}
 tone(frequency,duration=.1,{type='sine',volume=.2,slide=0,delay=0,destination}={}){
  const c=this.context;if(!c||c.state!=='running'||this.muted)return;
  const t=c.currentTime+delay,osc=c.createOscillator(),gain=c.createGain();osc.type=type;osc.frequency.setValueAtTime(Math.max(15,frequency),t);
  if(slide)osc.frequency.exponentialRampToValueAtTime(Math.max(15,frequency+slide),t+duration);
  gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(Math.max(.001,volume),t+.004);gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
  osc.connect(gain);gain.connect(destination||this.effects);osc.start(t);osc.stop(t+duration+.015);osc.onended=()=>{osc.disconnect();gain.disconnect();};
 }
 noise(duration=.12,{volume=.3,low=500,high=8000,delay=0,destination}={}){
  const c=this.context;if(!c||c.state!=='running'||this.muted||!this.noiseBuffer)return;
  const t=c.currentTime+delay,source=c.createBufferSource(),filter=c.createBiquadFilter(),gain=c.createGain();source.buffer=this.noiseBuffer;filter.type='bandpass';filter.frequency.value=(low+high)/2;filter.Q.value=Math.max(.3,(low+high)/(2*Math.max(1,high-low)));
  gain.gain.setValueAtTime(Math.max(.001,volume),t);gain.gain.exponentialRampToValueAtTime(.0001,t+duration);source.connect(filter);filter.connect(gain);gain.connect(destination||this.effects);source.start(t,(this.step%7)*.17,duration+.01);source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
 }
 sfx(name,options={}){
  if(!this.context||this.context.state!=='running'||this.muted)return;
  const now=this.context.currentTime,key=String(name).toLowerCase(),last=this.lastSounds.get(key)||-10;
  const interval=/fire|shot|rifle|smg|pistol|lmg/.test(key)?.018:/hit/.test(key)?.035:.025;if(now-last<interval)return;this.lastSounds.set(key,now);
  const family=String(typeof options==='string'?options:options.family||key).toLowerCase();
  if(/suppressed|silenced|hush/.test(key)||options.suppressed){this.noise(.045,{volume:.13,low:900,high:4200});this.tone(230,.045,{volume:.12,slide:-110});}
  else if(/shotgun|scatter/.test(family)){this.noise(.24,{volume:.78,low:160,high:6900});this.tone(102,.17,{type:'triangle',volume:.52,slide:-66});}
  else if(/sniper|marksman|precision|dmr/.test(family)){this.noise(.22,{volume:.65,low:900,high:10500});this.tone(155,.2,{type:'triangle',volume:.4,slide:-105});this.noise(.06,{volume:.11,low:2200,high:9000,delay:.19});}
  else if(/lmg|machinegun|heavy/.test(family)){this.noise(.16,{volume:.53,low:300,high:7200});this.tone(125,.11,{type:'triangle',volume:.32,slide:-70});}
  else if(/smg|pdw/.test(family)){this.noise(.08,{volume:.32,low:1400,high:7700});this.tone(220,.065,{type:'triangle',volume:.2,slide:-120});}
  else if(/pistol|revolver/.test(family)){this.noise(.105,{volume:.38,low:900,high:8200});this.tone(190,.09,{type:'triangle',volume:.23,slide:-112});}
  else if(/energy|coil/.test(family)){this.tone(970,.14,{type:'sine',volume:.2,slide:-760});this.tone(1940,.075,{type:'triangle',volume:.07,slide:-1200});this.noise(.06,{volume:.13,low:2300,high:9600});}
  else if(/fire|shot|shoot|rifle/.test(key)){this.noise(.13,{volume:.45,low:600,high:8800});this.tone(160,.105,{type:'triangle',volume:.28,slide:-94});}
  else if(/reload/.test(key)){this.noise(.055,{volume:.17,low:1600,high:6000});this.noise(.08,{volume:.22,low:2500,high:9500,delay:.18});this.tone(350,.045,{type:'square',volume:.035,slide:-90,delay:.28});}
  else if(/empty|dry/.test(key)){this.noise(.025,{volume:.12,low:2500,high:10000});}
  else if(/grenade|explosion|blast/.test(key)){this.noise(.58,{volume:.8,low:60,high:5500});this.tone(65,.42,{volume:.65,slide:-44});}
  else if(/flash/.test(key)){this.noise(.1,{volume:.52,low:3600,high:12000});this.tone(1800,.17,{volume:.045,slide:-900});}
  else if(/smoke/.test(key)){this.noise(.65,{volume:.25,low:2400,high:8500});}
  else if(/infected|growl|zombie/.test(key)){this.noise(.36,{volume:.21,low:80,high:1000});this.tone(85,.32,{type:'sawtooth',volume:.06,slide:-32});this.tone(123,.26,{type:'triangle',volume:.055,slide:-60,delay:.055});}
  else if(/scream|howl/.test(key)){this.tone(440,.48,{type:'sawtooth',volume:.06,slide:-190});this.noise(.4,{volume:.15,low:400,high:2100});}
  else if(/drone|alarm/.test(key)){this.tone(720,.12,{type:'triangle',volume:.12,slide:160});this.tone(520,.12,{type:'triangle',volume:.1,delay:.14});}
  else if(/hit|hurt|damage/.test(key)){this.noise(.09,{volume:.26,low:100,high:1600});this.tone(70,.1,{volume:.16,slide:-35});}
  else if(/shield|armor|metal/.test(key)){this.tone(880,.11,{type:'triangle',volume:.1,slide:-490});this.noise(.05,{volume:.14,low:3500,high:10000});}
  else if(/dodge|slide|vault/.test(key)){this.noise(.16,{volume:.16,low:300,high:3300});}
  else if(/door|breach/.test(key)){this.noise(.22,{volume:.36,low:100,high:4000});this.tone(90,.12,{type:'triangle',volume:.12,slide:-40});}
  else if(/heal|repair/.test(key)){this.tone(420,.12,{volume:.09});this.tone(630,.17,{volume:.08,delay:.12});this.noise(.14,{volume:.07,low:2300,high:6000});}
  else if(/attach|equip|pickup|switch/.test(key)){this.noise(.045,{volume:.12,low:1800,high:7000});this.tone(680,.055,{type:'triangle',volume:.07});}
  else if(/complete|win|success/.test(key)){[0,4,7,12].forEach((n,i)=>this.tone(220*2**(n/12),.34,{volume:.12,delay:i*.11}));}
  else if(/fail|death/.test(key)){[0,-3,-7].forEach((n,i)=>this.tone(180*2**(n/12),.44,{type:'triangle',volume:.12,delay:i*.14}));}
  else if(/radio/.test(key)){this.noise(.055,{volume:.08,low:1800,high:5000});this.tone(1300,.035,{volume:.045,delay:.04});}
  else if(/step/.test(key)){this.noise(.055,{volume:.065,low:120,high:1800});}
  else {this.tone(560,.055,{type:'triangle',volume:.065,slide:100});}
 }
 update(g,dt){
  const c=this.context;if(!c||c.state!=='running'||this.muted||this.disposed)return;
  const active=g?.mode==='playing',threat=active?Math.min(1,(g.enemies||[]).filter(e=>!e.dead&&['combat','chase','attack','engage'].includes(e.state)).length/6):0;
  if(this.nextBeat<c.currentTime-1)this.nextBeat=c.currentTime;
  if(this.nextBeat>c.currentTime+.08)return;
  const beat=active?.38:.58,step=this.step++,root=[55,55,65.406,48.999][Math.floor(step/16)%4];this.nextBeat=c.currentTime+beat;
  const destination=this.music;
  if(step%4===0){this.tone(root,beat*3.6,{type:'sine',volume:.25,destination});this.tone(root*2,beat*2.5,{type:'triangle',volume:.055,destination});}
  const notes=[0,7,10,14,7,3,12,10],frequency=root*4*2**(notes[step%8]/12);
  if(step%2===0||threat>.4)this.tone(frequency,beat*.65,{type:'sine',volume:active?.05:.075,destination});
  if(active&&step%2===0){this.noise(.045,{volume:.055+threat*.05,low:4000,high:11000,destination});this.tone(48,.08,{volume:.11+threat*.08,destination});}
  if(threat>.65&&step%4===2)this.tone(root*2,.09,{type:'triangle',volume:.1,destination});
  const theme=g?.level?.theme||'';if(active&&step%16===0){if(/rain|street|roof|tower/.test(theme))this.noise(1.4,{volume:.065,low:1000,high:6500,destination});else if(/hospital|server|archive|power/.test(theme))this.tone(110,1.7,{volume:.025,destination});else if(/flood|water|dam/.test(theme))this.noise(1.3,{volume:.07,low:100,high:1700,destination});}
 }
 dispose(){this.disposed=true;this.lastSounds.clear();if(this.context){this.context.close().catch(()=>{});this.context=null;}this.master=null;this.music=null;this.effects=null;this.noiseBuffer=null;}
}
