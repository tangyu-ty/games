const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hash = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
const palettes = [
  { deep:'#103e49', sea:'#24747b', light:'#4d9e96', foam:'#a0d5bf', land:'#c9b986', grass:'#5d8773', sky:'#7fc3b3' },
  { deep:'#142d42', sea:'#285768', light:'#517e83', foam:'#a6c5b3', land:'#c7b78d', grass:'#607c74', sky:'#83a49b' },
  { deep:'#162f3c', sea:'#285e68', light:'#4a9390', foam:'#a1c7ad', land:'#d0be93', grass:'#648773', sky:'#88b0a8' },
  { deep:'#28333e', sea:'#586165', light:'#89918a', foam:'#c8c8ae', land:'#d1b994', grass:'#7c8875', sky:'#c4ac95' },
  { deep:'#202b42', sea:'#364b68', light:'#5b798a', foam:'#a8c3c2', land:'#c4b59b', grass:'#5d7b7b', sky:'#aabfb8' }
];
function path(c, pts, close = true) { c.beginPath(); pts.forEach(([x,y], i) => i ? c.lineTo(x,y) : c.moveTo(x,y)); if (close) c.closePath(); }
function ellipse(c,x,y,rx,ry,color) { c.beginPath(); c.ellipse(x,y,rx,ry,0,0,TAU); c.fillStyle=color; c.fill(); }
function line(c, pts, color, width = 1) { path(c,pts,false); c.strokeStyle=color;c.lineWidth=width;c.stroke(); }
function ring(c,x,y,r,color,width=1) { c.beginPath();c.arc(x,y,r,0,TAU);c.strokeStyle=color;c.lineWidth=width;c.stroke(); }

/** Original procedural nautical artwork. No remote assets or runtime dependencies. */
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', {alpha:false});
    this.camera={x:900,y:600};
    this.scale=1; this.elapsed=0; this.lastStage=-1;
    this.makeGrain(); this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  makeGrain() {
    const noise=document.createElement('canvas'); noise.width=128; noise.height=128;
    const n=noise.getContext('2d'); const data=n.createImageData(128,128);
    for(let i=0;i<data.data.length;i+=4) { const v=hash(i)*255; data.data[i]=v;data.data[i+1]=v;data.data[i+2]=v;data.data[i+3]=hash(i+1)*13; }
    n.putImageData(data,0,0);this.grain=noise;
    const tile=document.createElement('canvas');tile.width=220;tile.height=180;
    const q=tile.getContext('2d');q.strokeStyle='rgba(190,230,208,.13)';q.lineWidth=.7;
    for(let k=0;k<12;k++) { const x=hash(k+70)*220,y=hash(k+100)*180;q.beginPath();q.moveTo(x,y);q.quadraticCurveTo(x+5,y+3,x+13,y);q.stroke(); }
    this.wavePattern=tile;
  }
  resize() {
    this.width=this.canvas.clientWidth || innerWidth; this.height=this.canvas.clientHeight || innerHeight;
    // Bound raster work on retina displays; DOM text keeps native screen resolution.
    this.dpr=Math.max(.75,Math.min(devicePixelRatio||1,2,Math.sqrt(2_000_000/(this.width*this.height))));
    this.canvas.width=Math.round(this.width*this.dpr);this.canvas.height=Math.round(this.height*this.dpr);
    this.scale=Math.max(this.width/1400,this.height/950);
    this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
  }
  screenToWorld(x,y) {
    const rect=this.canvas.getBoundingClientRect();
    return {x:(x-rect.left-this.width/2)/this.scale+this.camera.x,y:(y-rect.top-this.height/2)/this.scale+this.camera.y};
  }
  render(g,dt=1/60) {
    const c=this.ctx,w=this.width,h=this.height;
    this.elapsed+=Math.min(dt,.05);const t=this.elapsed;
    const p=g.player||{x:900,y:600,angle:0};
    const pal=palettes[clamp(g.stage||0,0,4)];
    const menu=g.mode==='menu';this.menu=menu;
    const bossActive=String(Boolean(g.bossActive));if(this.canvas.dataset.bossActive!==bossActive)this.canvas.dataset.bossActive=bossActive;
    const focus={x:p.x-(menu?w/this.scale*.21:0),y:p.y+(menu?30:0)};
    const blend=1-Math.exp(-dt*(menu?4:7));
    this.camera.x+=(focus.x-this.camera.x)*blend; this.camera.y+=(focus.y-this.camera.y)*blend;
    c.setTransform(this.dpr,0,0,this.dpr,0,0);
    c.fillStyle=pal.deep;c.fillRect(0,0,w,h);
    const glow=c.createRadialGradient(w*.59,h*.36,0,w*.5,h*.45,w*.7);
    glow.addColorStop(0,pal.light);glow.addColorStop(.48,pal.sea);glow.addColorStop(1,pal.deep);
    c.fillStyle=glow;c.fillRect(0,0,w,h);
    c.save();
    const shake=(!g.reducedMotion && g.shake) ? g.shake : 0;
    c.translate(w/2+(hash(t*40)-.5)*shake,h/2+(hash(t*31)-.5)*shake);
    c.scale(this.scale,this.scale);c.translate(-this.camera.x,-this.camera.y);
    this.ocean(c,g,pal,t);
    for(const island of g.islands||[]) this.island(c,island,pal,t);
    this.border(c,pal);
    if(g.campaignActive){for(const a of g.campaignHazards||[])this.campaignHazard(c,a,t);for(const a of g.missionObjects||[])this.missionObject(c,a,t);}
    for(const b of g.beacons||[]) this.beacon(c,b,t);
    for(const a of g.pickups||[]) this.pickup(c,a,t);
    for(const a of g.effects||[]) this.effect(c,a,t);
    const actors=[...(g.enemies||[]).map(a=>({...a,isEnemy:true})),{...p,isEnemy:false}].sort((a,b)=>a.y-b.y);
    for(const a of actors) { if(a.isEnemy) this.enemy(c,a,t); else this.ship(c,a,t,menu); }
    for(const b of g.bullets||[]) this.bullet(c,b,t);
    for(const a of g.particles||[]) {c.globalAlpha=clamp(a.life/(a.maxLife||1),0,1);ellipse(c,a.x,a.y,a.r||2,a.r||2,a.color||'#f8dfaa');}c.globalAlpha=1;
    for(const f of g.floaters||[]) {const alpha=clamp(f.life/(f.maxLife||1),0,1);c.globalAlpha=alpha;c.textAlign='center';c.font=`600 ${f.big?24:17}px system-ui,sans-serif`;c.fillStyle='#17333b';c.fillText(f.text,f.x+1,f.y+1);c.fillStyle=f.color||'#fff1bd';c.fillText(f.text,f.x,f.y);}c.globalAlpha=1;
    this.offscreenIndicators(c,g);
    c.restore();
    const vignette=c.createRadialGradient(w/2,h/2,Math.min(w,h)*.27,w/2,h/2,Math.max(w,h)*.68);
    vignette.addColorStop(0,'rgba(5,28,38,0)');vignette.addColorStop(1,'rgba(4,22,32,.44)');c.fillStyle=vignette;c.fillRect(0,0,w,h);
    c.save();c.globalAlpha=.36;c.fillStyle=c.createPattern(this.grain,'repeat');c.fillRect(0,0,w,h);c.restore();
    if(menu) this.menuDecoration(c,w,h,t);
    if(!menu) {this.minimap(c,g,w,h,pal);this.bossBar(c,g,w,h);}
    if(g.stage===4 && !menu && !g.reducedMotion) this.storm(c,w,h,t);
  }
  ocean(c,g,pal,t) {
    const left=this.camera.x-this.width/this.scale/2,top=this.camera.y-this.height/this.scale/2;
    c.save();c.globalAlpha=.68;c.translate(Math.sin(t*.14)*4,Math.cos(t*.1)*4);c.fillStyle=c.createPattern(this.wavePattern,'repeat');c.fillRect(left-12,top-12,this.width/this.scale+24,this.height/this.scale+24);c.restore();
    // Gentle cartographic currents, distributed deterministically across the world.
    c.strokeStyle='rgba(174,220,202,.075)';c.lineWidth=1;
    for(let i=0;i<15;i++) {
      const y=70+i*83;
      c.beginPath();c.moveTo(-300,y);c.bezierCurveTo(340,y-80+Math.sin(t*.2+i)*12,1040,y+80,2100,y-35);c.stroke();
    }
    c.strokeStyle='rgba(174,220,202,.085)';c.lineWidth=.7;c.setLineDash([2,9]);
    for(let x=100;x<1800;x+=200){c.beginPath();c.moveTo(x,0);c.lineTo(x,1200);c.stroke();}
    for(let y=100;y<1200;y+=200){c.beginPath();c.moveTo(0,y);c.lineTo(1800,y);c.stroke();}c.setLineDash([]);
    for(let i=0;i<34;i++){
      const x=hash(i+51)*1800,y=hash(i+77)*1200;
      const flicker=Math.max(0,Math.sin(t*.8+i*7))*.45;
      if(flicker>.1){c.globalAlpha=flicker;line(c,[[x-3,y],[x+3,y]],'#c6ecd3',.8);line(c,[[x,y-3],[x,y+3]],'#c6ecd3',.8);}
    }c.globalAlpha=1;
  }
  border(c,pal) {
    c.save();c.strokeStyle='rgba(213,227,192,.2)';c.lineWidth=2;c.setLineDash([4,12]);c.strokeRect(30,30,1740,1140);c.setLineDash([]);
    for(const [x,y,a] of [[35,35,0],[1765,35,Math.PI/2],[1765,1165,Math.PI],[35,1165,-Math.PI/2]]) {c.save();c.translate(x,y);c.rotate(a);line(c,[[0,30],[0,0],[30,0]],'rgba(216,221,180,.4)',1);c.restore();}
    c.restore();
  }
  island(c,a,pal,t) {
    const x=a.x,y=a.y,r=a.r||60,seed=a.seed||x+y;
    if(a.kind==='wreck'){this.wreck(c,a,t);return;}
    c.save();c.translate(x,y);
    const points=[];
    for(let i=0;i<22;i++){const ang=i/22*TAU,rad=r*(.83+hash(seed+i)*.3);points.push([Math.cos(ang)*rad,Math.sin(ang)*rad*.78]);}
    // Shallows, foam and warm beach terraces.
    c.save();c.scale(1.26,1.26);path(c,points);c.fillStyle='rgba(111,181,161,.22)';c.fill();c.restore();
    for(let z=0;z<2;z++){c.save();c.scale(1.13+z*.15+Math.sin(t*.7+seed)*.012,1.13+z*.15);path(c,points);c.strokeStyle=`rgba(185,222,191,${.28-z*.12})`;c.lineWidth=.9;c.stroke();c.restore();}
    c.save();c.translate(3,7);path(c,points);c.fillStyle='rgba(6,42,49,.27)';c.fill();c.restore();
    path(c,points);c.fillStyle=pal.land;c.fill();c.strokeStyle='rgba(238,220,171,.65)';c.lineWidth=1.5;c.stroke();
    c.save();c.scale(.79,.74);path(c,points);c.fillStyle=pal.grass;c.fill();c.restore();
    c.save();c.scale(.64,.61);path(c,points);c.fillStyle='rgba(43,94,81,.4)';c.fill();c.restore();
    const count=Math.max(3,Math.floor(r/9));
    for(let i=0;i<count;i++) {
      const ang=hash(seed+i*3+2)*TAU,rr=hash(seed+i*4+3)*r*.62;
      const tx=Math.cos(ang)*rr,ty=Math.sin(ang)*rr*.67;
      if(a.kind==='lighthouse' && Math.hypot(tx,ty)<24)continue;
      if(hash(seed+i*11)>.3)this.tree(c,tx,ty,8+hash(seed+i+20)*7,seed+i);
      else {ellipse(c,tx+2,ty+3,6,3,'rgba(20,57,55,.3)');path(c,[[tx-5,ty+1],[tx-3,ty-5],[tx+3,ty-6],[tx+7,ty+1],[tx+2,ty+4]]);c.fillStyle='#a5aa8c';c.fill();line(c,[[tx-3,ty-3],[tx+2,ty-5],[tx+5,ty]],'#d0ceab',1);}
    }
    // A few beach tufts and scattered shell stones.
    for(let i=0;i<6;i++){const an=hash(seed+i+90)*TAU;const tx=Math.cos(an)*r*.8,ty=Math.sin(an)*r*.6;ellipse(c,tx,ty,1.8,.8,'#e6d8ad');}
    if(a.kind==='lighthouse')this.lighthouse(c,0,-3,t,a.lit??true);
    if(r>70){c.font='italic 10px Georgia, serif';c.textAlign='center';c.fillStyle='rgba(220,232,205,.55)';c.fillText(a.name||'无人之岸',0,r*.89+20);}
    c.restore();
  }
  tree(c,x,y,r,s) {
    ellipse(c,x+3,y+5,r*.8,r*.43,'rgba(15,50,43,.24)');
    c.save();c.translate(x,y);c.rotate(hash(s)*.5);
    path(c,[[-r*.4,r*.3],[-r*.8,-r*.1],[-r*.6,-r*.57],[-r*.05,-r],[r*.55,-r*.65],[r*.73,-r*.2],[r*.35,r*.3]]);
    c.fillStyle=hash(s)>.5?'#376b58':'#427960';c.fill();
    path(c,[[-r*.4,-r*.1],[-r*.4,-r*.5],[-r*.02,-r*.81],[r*.4,-r*.5],[r*.27,-r*.2]]);c.fillStyle='#73977a';c.fill();
    line(c,[[0,r*.4],[0,-r*.3]],'#315c4c',1);c.restore();
  }
  lighthouse(c,x,y,t,lit=true) {
    c.save();c.translate(x,y);ellipse(c,5,17,17,7,'rgba(13,43,43,.3)');
    path(c,[[-13,14],[-9,-22],[7,-22],[12,14]]);c.fillStyle='#eee1bb';c.fill();
    path(c,[[3,-22],[7,-22],[12,14],[5,14]]);c.fillStyle='#bbbd9c';c.fill();
    path(c,[[-11,-1],[10,-1],[10,6],[-12,6]]);c.fillStyle='#a66c55';c.fill();
    c.fillStyle='#274e51';c.fillRect(-11,-31,20,10);c.fillStyle=lit?'#ebca80':'#677c7b';c.fillRect(-7,-29,12,5);
    path(c,[[-15,-31],[-2,-41],[13,-31]]);c.fillStyle='#555c54';c.fill();
    line(c,[[-16,-21],[15,-21]],'#d6c797',2);
    c.fillStyle='#3d5c54';c.fillRect(-3,5,5,9);
    if(lit){const glow=c.createRadialGradient(-1,-26,1,-1,-26,43);glow.addColorStop(0,'rgba(255,220,139,.55)');glow.addColorStop(1,'rgba(255,220,139,0)');c.fillStyle=glow;c.fillRect(-44,-69,86,86);}
    c.restore();
  }
  wreck(c,a,t) {
    c.save();c.translate(a.x,a.y);c.rotate(a.seed||.5);c.globalAlpha=.72;
    ellipse(c,4,5,37,18,'rgba(12,38,45,.35)');
    path(c,[[-33,-10],[-12,-16],[27,-10],[39,0],[20,12],[-29,10],[-21,4],[-30,1]]);c.fillStyle='#766c53';c.fill();c.strokeStyle='#b2a782';c.lineWidth=2;c.stroke();
    for(let i=0;i<5;i++){line(c,[[-21+i*11,-10],[-17+i*11,9]],'#444f49',3);}
    line(c,[[0,1],[17,-26]],'#c4b18a',3);line(c,[[13,-21],[30,-18],[16,-12]],'#a4a995',1);
    c.restore();
    if(!a.salvaged&&!this.menu){
      c.save();const glow=.5+Math.sin(t*2+a.x)*.2;ring(c,a.x,a.y,52,'rgba(235,211,152,'+(glow*.3)+')',1);this.star(c,a.x,a.y-39,5+Math.sin(t*3),2,'#e8d29b');
      c.textAlign='center';c.font='10px system-ui';c.fillStyle='#d6d7b1';c.fillText('残骸 · 靠近打捞',a.x,a.y+49);
      if(a.salvageProgress>0){c.beginPath();c.arc(a.x,a.y,56,-Math.PI/2,-Math.PI/2+TAU*Math.min(a.salvageProgress/1.4,1));c.lineWidth=3;c.strokeStyle='#edd69d';c.stroke();}c.restore();
    }
  }
  ship(c,p,t,menu) {
    if(!Number.isFinite(p.x)||!Number.isFinite(p.y))return;
    c.save();c.translate(p.x,p.y);if(menu)c.scale(2.7,2.7);c.rotate((p.angle||0)+Math.sin(t*2)*.018);
    const dash=p.dashTime>0;
    // Broad feathery bow wave gives the ship a visible heading.
    for(let i=0;i<5;i++) {const d=(t*30+i*13)%66;const alpha=(1-d/66)*.23;c.strokeStyle=`rgba(200,241,215,${alpha})`;c.lineWidth=1.4;c.beginPath();c.moveTo(-18-d,-8-d*.2);c.quadraticCurveTo(-6-d,0,-18-d,8+d*.2);c.stroke();}
    if(dash) {c.save();c.globalAlpha=.3;path(c,[[10,-14],[-100,-4],[-130,0],[-100,4],[10,14]]);c.fillStyle='#b9eed1';c.fill();c.restore();}
    ellipse(c,2,9,28,15,'rgba(7,31,40,.35)');
    if(p.invuln>0 && Math.floor(t*17)%2)c.globalAlpha=.55;
    // Hull: polished teal timber and gilded gunwales.
    path(c,[[-25,-10],[-12,-17],[18,-12],[34,0],[18,12],[-12,17],[-25,10]]);c.fillStyle='#143c40';c.fill();c.lineWidth=2.8;c.strokeStyle='#d5b777';c.stroke();
    path(c,[[-22,-8],[-10,-13],[17,-9],[27,0],[17,9],[-10,13],[-22,8]]);c.fillStyle='#467f74';c.fill();
    for(let i=-16;i<18;i+=7)line(c,[[i,-10],[i,10]],'rgba(17,57,56,.4)',1);
    c.fillStyle='#b59765';c.fillRect(-19,-7,5,14);
    // Mast, stays, and two billowing cream sails.
    line(c,[[-22,0],[32,0]],'#b69d70',2);line(c,[[0,-25],[0,24]],'#c6aa74',2);
    line(c,[[-22,0],[0,-25],[30,0],[0,24],[-22,0]],'rgba(236,220,174,.55)',.7);
    path(c,[[0,-24],[19,-15],[22,-3],[0,-3]]);c.fillStyle='#f1e4be';c.fill();c.strokeStyle='#d4c28e';c.lineWidth=.9;c.stroke();
    path(c,[[0,0],[22,2],[16,16],[0,23]]);c.fillStyle='#ffefc5';c.fill();c.stroke();
    path(c,[[2,2],[19,3],[12,15],[2,20]]);c.fillStyle='rgba(211,190,143,.25)';c.fill();
    line(c,[[4,-21],[5,-6]],'#fff3d5',1);
    // Tidekeeper insignia.
    c.save();c.translate(9,9);c.scale(.45,.45);this.star(c,0,0,8,4,'#5d9785');c.restore();
    line(c,[[0,-26],[0,-34]],'#d6be8b',1);path(c,[[0,-34],[-11,-30],[0,-27]]);c.fillStyle='#dd8e69';c.fill();
    c.globalAlpha=1;
    if(p.invuln>0){c.strokeStyle='rgba(170,227,215,.45)';c.lineWidth=1.3;c.setLineDash([4,5]);c.beginPath();c.arc(0,0,41,0,TAU);c.stroke();c.setLineDash([]);}
    c.restore();
  }
  enemy(c,e,t) {
    c.save();c.translate(e.x,e.y);const r=e.r||15;c.rotate(e.angle||0);
    const flash=e.flash>0;
    if(e.windup>0){const a=clamp(e.windup,0,1);c.fillStyle=`rgba(246,124,97,${.08+.07*Math.sin(t*15)})`;c.beginPath();c.arc(0,0,r+18,0,TAU);c.fill();ring(c,0,0,r+18,'rgba(253,150,113,.4)',1);}
    ellipse(c,3,7,r*1.3,r*.8,'rgba(8,24,35,.26)');
    if(e.type==='ray'){
      const flap=Math.sin(t*6+e.x)*4;
      path(c,[[r+7,0],[r*.2,-r*.5],[-r*.8,-r-flap],[-r*.4,-r*.2],[-r-10,0],[-r*.4,r*.2],[-r*.8,r+flap],[r*.2,r*.5]]);c.fillStyle=flash?'#ffe5c9':'#604f71';c.fill();c.strokeStyle='#b89cba';c.lineWidth=1.3;c.stroke();
      path(c,[[r*.6,0],[-r*.1,-r*.24],[-r*.4,0],[-r*.1,r*.24]]);c.fillStyle='#a792ac';c.fill();ellipse(c,r*.48,-4,2,1.5,'#ffd4a5');ellipse(c,r*.48,4,2,1.5,'#ffd4a5');
    } else if(e.type==='boss') {
      // The Drowned Bell: a huge mechanical nautilus with sweeping fins.
      const breath=Math.sin(t*2.8)*3;
      for(let side of [-1,1]){path(c,[[r*.4,side*r*.3],[-r*.25,side*(r+12+breath)],[-r*.95,side*r*.65],[-r*1.25,side*(r+23)],[-r*.9,side*r*.1]]);c.fillStyle=flash?'#f0d2b0':'#47435d';c.fill();c.strokeStyle='#b0a0a3';c.lineWidth=1.5;c.stroke();}
      path(c,[[r+15,0],[r*.6,-r*.6],[-r*.45,-r*.7],[-r*.9,0],[-r*.45,r*.7],[r*.6,r*.6]]);c.fillStyle=flash?'#f9e7c6':'#383e51';c.fill();c.strokeStyle='#c7ad83';c.lineWidth=2;c.stroke();
      for(let q=0;q<4;q++){ring(c,-r*.1,0,r*(.56-q*.12),q%2?'#a68c79':'#6e6c74',2);}
      ellipse(c,r*.55,0,13,8,'#cf856d');ellipse(c,r*.61,0,6,4,'#ffe0a3');
      for(let side of [-1,1]){line(c,[[-r*.6,side*r*.35],[-r-24,side*r*.4],[-r-41,side*(r*.1+Math.sin(t*3)*10)]],'#b4a3a0',4);}
    } else {
      const brute=e.type==='brute',gun=e.type==='gunner';
      path(c,[[-r,-r*.6],[-r*.4,-r*.9],[r*.65,-r*.55],[r+8,0],[r*.65,r*.55],[-r*.4,r*.9],[-r,r*.6]]);c.fillStyle=flash?'#ffe8c9':brute?'#78515a':gun?'#63586c':'#834f50';c.fill();c.strokeStyle='#cca08a';c.lineWidth=1.5;c.stroke();
      path(c,[[-r*.6,-r*.35],[r*.5,-r*.3],[r*.7,0],[r*.5,r*.3],[-r*.6,r*.35]]);c.fillStyle='#363f47';c.fill();
      if(gun){ring(c,0,0,r*.45,'#b8a392',2);line(c,[[0,0],[r+10,0]],'#c6b6a0',5);}
      else{line(c,[[-r*.1,-r],[r*.2,r]],'#ab9380',1.5);path(c,[[0,-r*.8],[r*.5,-r*.2],[0,r*.7],[-r*.1,0]]);c.fillStyle=brute?'#a99789':'#c4a092';c.fill();}
      if(brute){for(let side of [-1,1])line(c,[[r*.5,side*r*.55],[r*.9,side*r]],'#bda78c',3);}
      ellipse(c,r*.5,0,2.5,2.5,'#edbe8d');
    }
    c.restore();
    if(e.hp<e.maxHp && e.type!=='boss') {c.fillStyle='rgba(9,29,39,.65)';c.fillRect(e.x-18,e.y-r-15,36,3);c.fillStyle='#e1ac87';c.fillRect(e.x-18,e.y-r-15,36*clamp(e.hp/e.maxHp,0,1),3);}
  }
  bullet(c,b,t) {
    c.save();c.translate(b.x,b.y);c.rotate(Math.atan2(b.vy||0,b.vx||1));
    const r=b.r||3;
    // Layered halos preserve projectile contrast without a costly blur per shot.
    ellipse(c,0,0,r*2.3,r*2.3,b.enemy?'rgba(237,148,121,.08)':'rgba(255,235,174,.06)');
    ellipse(c,0,0,r*1.65,r*1.65,b.enemy?'rgba(237,148,121,.13)':'rgba(255,235,174,.10)');
    if(b.enemy){ellipse(c,0,0,r+1,r+1,b.color||'#f4ab88');ellipse(c,-1,-1,r*.45,r*.45,'#fff1cf');}
    else {line(c,[[-12,0],[2,0]],'rgba(253,233,168,.65)',r*.8);ellipse(c,0,0,r*1.7,r*.7,'#fff1ba');}
    c.restore();
  }
  pickup(c,a,t) {
    c.save();c.translate(a.x,a.y+Math.sin(t*3+a.x)*2);
    const sz=a.r||5;
    if(a.type==='heal') {ring(c,0,0,10,'rgba(174,231,181,.4)',1);c.fillStyle='#bce5b6';c.fillRect(-2,-6,4,12);c.fillRect(-6,-2,12,4);}
    else if(a.type==='shell'){c.save();c.rotate(-Math.PI/4);path(c,[[-5,3],[-6,-2],[-3,-6],[3,-6],[6,-2],[5,3],[0,6]]);c.fillStyle='#f3cd88';c.fill();line(c,[[0,5],[0,-4]],'#b79160',.8);c.restore();}
    else {this.star(c,0,0,sz+1,sz*.48,'#bee9d5');}
    c.restore();
  }
  beacon(c,b,t) {
    const r=b.r||35;
    c.save();c.translate(b.x,b.y);
    const col=b.active?'#e9ce8d':'#82bdb2';
    const grad=c.createRadialGradient(0,0,3,0,0,r*2.5);grad.addColorStop(0,b.active?'rgba(245,217,150,.17)':'rgba(142,223,205,.12)');grad.addColorStop(1,'rgba(150,220,200,0)');c.fillStyle=grad;c.fillRect(-r*3,-r*3,r*6,r*6);
    c.save();c.rotate(t*.08);c.setLineDash([3,7]);ring(c,0,0,r+8,col,.9);c.setLineDash([]);c.restore();
    ring(c,0,0,r*.75,'rgba(204,221,185,.25)',1);
    for(let i=0;i<4;i++){c.save();c.rotate(i*Math.PI/2);path(c,[[0,-r-3],[-3,-r+5],[3,-r+5]]);c.fillStyle=col;c.fill();c.restore();}
    this.star(c,0,0,15+Math.sin(t*2)*1.5,6,col);
    c.textAlign='center';c.font='11px system-ui,sans-serif';c.fillStyle=b.active?'#f2deb3':'#b8d7c7';c.fillText(b.active?'靠近 · 递送信件':'灯塔回声',0,r+28);
    c.restore();
  }
  effect(c,e,t) {
    const alpha=clamp(e.life/(e.maxLife||1),0,1);
    if(e.type==='pulse'){
      c.save();c.globalAlpha=alpha;const r=(e.r||100)*(1-alpha*.85);ring(c,e.x,e.y,r,e.color||'#bfead7',3);ring(c,e.x,e.y,r-8,'rgba(234,244,209,.45)',1);
      for(let i=0;i<10;i++){const a=i/10*TAU;line(c,[[e.x+Math.cos(a)*(r-14),e.y+Math.sin(a)*(r-14)],[e.x+Math.cos(a)*(r+6),e.y+Math.sin(a)*(r+6)]],'#ecedc9',1);}c.restore();
    } else if(e.type==='warning') {c.save();c.globalAlpha=.35+Math.sin(t*15)*.1;c.fillStyle='rgba(234,130,101,.15)';c.beginPath();c.arc(e.x,e.y,e.r||40,0,TAU);c.fill();ring(c,e.x,e.y,e.r||40,'#e29b7c',1.5);c.restore();}
    else {c.save();c.globalAlpha=alpha;ring(c,e.x,e.y,(e.r||20)*(1.3-alpha*.3),e.color||'#d6e8c5',1);c.restore();}
  }
  missionObject(c,a,t) {
    if(!Number.isFinite(a.x)||!Number.isFinite(a.y))return;
    const r=Math.max(12,a.r||26),active=a.active===true,complete=a.completed===true;
    const progress=clamp(Number(a.progress)||0,0,1),hostile=Boolean(a.followRole),col=hostile?'#edbc97':complete?'#b7ccb1':active?'#b8e8d1':'#9dbaad';
    c.save();c.translate(a.x,a.y);c.globalAlpha=complete?.55:1;
    if(active){ring(c,0,0,r+15+Math.sin(t*2+a.x)*2,hostile?'rgba(232,177,141,.35)':'rgba(178,230,205,.3)',1);}
    if(hostile){c.setLineDash([4,8]);ring(c,0,0,r+21,col,1);c.setLineDash([]);for(let i=0;i<4;i++){const angle=i*TAU/4;line(c,[[Math.cos(angle)*(r+24),Math.sin(angle)*(r+24)],[Math.cos(angle)*(r+31),Math.sin(angle)*(r+31)]],col,1.5);}}
    else if(a.type==='convoy'){
      c.save();c.rotate(a.angle||0);c.scale(clamp(r/29,.7,1.5),clamp(r/29,.7,1.5));
      for(let i=0;i<3;i++){const d=(t*24+i*20)%65;line(c,[[-35-d,-10-d*.15],[-46-d,0],[-35-d,10+d*.15]],'rgba(187,231,213,'+((1-d/65)*.22)+')',1.4);}
      ellipse(c,4,10,44,21,'rgba(8,33,42,.3)');
      path(c,[[-42,-15],[-24,-22],[28,-17],[49,0],[28,17],[-24,22],[-42,15]]);c.fillStyle='#245064';c.fill();c.strokeStyle='#d5c28d';c.lineWidth=2.5;c.stroke();
      path(c,[[-34,-12],[24,-13],[37,0],[24,13],[-34,12]]);c.fillStyle='#5e938f';c.fill();
      for(let x=-27;x<28;x+=9)line(c,[[x,-12],[x,12]],'rgba(21,63,68,.5)',1.2);
      line(c,[[-27,0],[44,0]],'#bbab79',2);line(c,[[-7,-29],[-7,27]],'#cdbb8e',2);
      path(c,[[-7,-29],[20,-22],[26,-4],[-7,-3]]);c.fillStyle='#eee6c6';c.fill();c.strokeStyle='#b8c4af';c.lineWidth=1;c.stroke();
      path(c,[[-7,1],[25,3],[18,23],[-7,27]]);c.fillStyle='#fcf0cc';c.fill();c.stroke();
      c.fillStyle='#3c7a88';c.fillRect(-5,-22,7,13);c.fillRect(-11,-18,19,5);
      path(c,[[-10,-33],[-29,-30],[-10,-24]]);c.fillStyle='#b4e7d5';c.fill();line(c,[[-10,-24],[-10,-36]],'#ceb887',1.2);c.restore();
    }else if(a.type==='survivor'){
      c.save();c.rotate(Math.sin(t*1.7+a.x)*.06);ellipse(c,2,8,27,16,'rgba(10,36,40,.28)');
      for(let i=0;i<4;i++){path(c,[[-24,-15+i*9],[24,-13+i*9],[23,-8+i*9],[-24,-9+i*9]]);c.fillStyle=i%2?'#8c7550':'#aa8b5a';c.fill();}
      line(c,[[-17,-16],[-18,19]],'#d6ba84',2);line(c,[[16,-15],[17,20]],'#d6ba84',2);
      ellipse(c,0,-2,12,10,'#edcf8c');ellipse(c,0,-2,6,5,'#40777b');
      path(c,[[-6,1],[-8,-10],[0,-15],[7,-9],[6,1]]);c.fillStyle='#567d89';c.fill();ellipse(c,0,-19,6,6,'#e2b58e');
      line(c,[[4,-9],[12,-19],[15+Math.sin(t*5)*3,-29]],'#e2b58e',3);
      line(c,[[21,-9],[21,-41]],'#c8ba8c',1.5);path(c,[[21,-41],[38,-36],[21,-31]]);c.fillStyle='#df9c73';c.fill();c.restore();
    }else if(a.type==='cache'){
      c.save();c.rotate(Math.sin(t*1.2+a.y)*.04);ellipse(c,4,11,25,13,'rgba(8,37,40,.3)');
      path(c,[[-24,-8],[-14,-20],[21,-17],[29,-6],[16,4],[-18,5]]);c.fillStyle='#d3b175';c.fill();c.strokeStyle='#e9d39a';c.lineWidth=1.5;c.stroke();
      path(c,[[-24,-8],[-18,15],[17,18],[16,4]]);c.fillStyle='#8f734b';c.fill();path(c,[[16,4],[29,-6],[26,12],[17,18]]);c.fillStyle='#b39459';c.fill();
      line(c,[[-12,-18],[-8,-1],[-5,16]],'#ead49d',4);line(c,[[10,-18],[12,3],[12,17]],'#ead49d',4);
      path(c,[[-4,-2],[5,-2],[5,8],[-4,8]]);c.fillStyle='#f0cf84';c.fill();ellipse(c,1,3,1.7,2,'#4e6355');
      this.star(c,2,-33,7+Math.sin(t*3),3,col);c.restore();
    }else if(a.type==='signal'){
      ellipse(c,3,17,31,17,'rgba(8,36,40,.3)');path(c,[[-30,10],[-18,-6],[24,-4],[33,14],[16,28],[-22,25]]);c.fillStyle='#6e8a7c';c.fill();c.strokeStyle='#cad4ae';c.lineWidth=1.5;c.stroke();
      path(c,[[-13,15],[-7,-29],[8,-29],[15,15]]);c.fillStyle='#c7c7a4';c.fill();line(c,[[-11,4],[11,4],[-8,-17],[8,-17]],'#6b8477',2);
      c.save();c.translate(0,-31);c.rotate(-.6);path(c,[[-18,-14],[-16,11],[-4,18],[4,12],[1,-6]]);c.fillStyle='#e3d4a3';c.fill();c.strokeStyle='#8e9f87';c.lineWidth=1.3;c.stroke();line(c,[[0,0],[21,-13]],'#c5b985',2);ellipse(c,21,-13,3,3,col);c.restore();
      for(let i=0;i<3;i++)ellipse(c,-8+i*8,14,2,2,progress>(i+1)/3?'#c4efca':'#486b64');
      if(active){const sweep=(t*.5)%1;ring(c,0,-30,30+sweep*22,'rgba(184,228,204,'+((1-sweep)*.3)+')',1);}
    }else if(a.type==='gate'){
      const radius=Math.max(32,r);c.save();c.rotate(a.angle||0);c.setLineDash([5,8]);ring(c,0,0,radius,col,2);c.setLineDash([]);ring(c,0,0,radius+8,'rgba(195,226,204,.18)',1);
      for(const side of [-1,1]){ellipse(c,side*radius,3,10,6,'rgba(6,39,43,.3)');path(c,[[side*radius-7,1],[side*radius-5,-10],[side*radius+5,-10],[side*radius+7,1]]);c.fillStyle=active?'#deb777':'#90aaa0';c.fill();line(c,[[side*radius,-9],[side*radius,-27]],'#bcc9ad',1.3);path(c,[[side*radius,-27],[side*radius+12,-23],[side*radius,-18]]);c.fillStyle=active?'#f1dfad':'#afc1b3';c.fill();}
      path(c,[[-9,-9],[10,0],[-9,9],[-3,0]]);c.fillStyle=col;c.fill();c.restore();
    }else{this.star(c,0,0,18,7,col);}
    c.globalAlpha=1;
    if(progress>0&&progress<1){c.save();c.beginPath();c.arc(0,0,r+21,-Math.PI/2,-Math.PI/2+TAU*progress);c.strokeStyle='#e7d59d';c.lineWidth=3;c.stroke();c.restore();}
    const label=a.name||{convoy:'护航补给船',survivor:'等待救援',cache:'漂流物资',signal:'海上信号站',gate:'航道门'}[a.type]||'航海目标';
    c.font=`500 ${clamp(11/this.scale,10,18)}px system-ui,sans-serif`;c.textAlign='center';const textWidth=c.measureText(label).width;const labelY=r+31;
    c.fillStyle='rgba(9,39,46,.78)';c.fillRect(-textWidth/2-8,labelY-13,textWidth+16,20);c.fillStyle=col;c.fillText(label,0,labelY);
    let offset=labelY+13;
    if(Number.isFinite(a.hp)&&a.maxHp>0){const bw=Math.max(50,Math.min(90,r*2));c.fillStyle='rgba(7,28,37,.8)';c.fillRect(-bw/2,offset,bw,4);c.fillStyle=a.hp/a.maxHp<.3?'#eaa084':'#a8ddbc';c.fillRect(-bw/2,offset,bw*clamp(a.hp/a.maxHp,0,1),4);offset+=13;}
    if(active&&progress>0&&progress<1){c.font='10px system-ui';c.fillStyle='#e9d7a7';c.fillText(Math.round(progress*100)+'%',0,offset+6);}
    c.restore();
  }
  missionMapIcon(c,a,x,y){
    if(!Number.isFinite(x)||!Number.isFinite(y)||a.completed)return;
    const col=a.followRole?'#e7ad8c':a.active===true?'#b8ead0':'#7aab9f';c.save();c.strokeStyle=col;c.fillStyle=col;c.lineWidth=1.2;
    if(a.type==='cache'){c.fillStyle=a.active===true?'#eed093':'#b3aa83';c.fillRect(x-2.5,y-2.5,5,5);}
    else if(a.type==='survivor'){ring(c,x,y,3,col,1.2);line(c,[[x-1.5,y],[x+1.5,y]],col,1);}
    else if(a.type==='gate'){ring(c,x,y,4,col,1);}
    else if(a.type==='convoy'){path(c,[[x+4,y],[x-3,y-3],[x-1,y],[x-3,y+3]]);c.fill();}
    else{path(c,[[x,y-4],[x+3,y],[x,y+4],[x-3,y]]);c.fill();}
    c.restore();
  }
  campaignHazard(c,a,t){
    if(!Number.isFinite(a.x)||!Number.isFinite(a.y))return;const r=Math.max(10,a.r||24),warning=clamp(1-(Number(a.windup)||0)/2.8,0,1),armed=Number(a.windup)<=0;
    c.save();c.translate(a.x,a.y);
    if(a.type==='mine'){
      const core=Math.min(18,r*.55);c.setLineDash([3,6]);ring(c,0,0,r,'rgba(222,153,124,'+(.22+warning*.35)+')',1);c.setLineDash([]);
      ellipse(c,0,0,r,r,'rgba(232,143,110,'+(.025+warning*.07)+')');c.beginPath();c.arc(0,0,r,-Math.PI/2,-Math.PI/2+TAU*warning);c.strokeStyle=armed?'#f0b08b':'#dba07e';c.lineWidth=armed?2.2:1.4;c.stroke();
      ellipse(c,3,7,core*.85,core*.55,'rgba(7,29,38,.3)');
      for(let i=0;i<8;i++){const angle=i*TAU/8+t*.1;line(c,[[Math.cos(angle)*core*.6,Math.sin(angle)*core*.6],[Math.cos(angle)*core*.95,Math.sin(angle)*core*.95]],'#c3a07a',3);}
      ellipse(c,0,0,core*.65,core*.65,'#354956');ring(c,0,0,core*.52,'#b89a78',1.4);ellipse(c,0,-2,core*.19,core*.19,warning>.6?'#edaf86':'#c59d70');
      line(c,[[-core*.3,core*.1],[core*.3,core*.1]],'#6d807e',1);
    }else if(a.type==='storm'){
      const color=warning>.5?'rgba(215,162,144,.36)':'rgba(177,200,211,.3)';
      ellipse(c,0,0,r,r,'rgba(19,37,59,.13)');c.setLineDash([6,10]);c.beginPath();c.arc(0,0,r,0,TAU);c.strokeStyle=color;c.lineWidth=1.2;c.stroke();c.setLineDash([]);
      for(let i=0;i<4;i++){const angle=t*(i%2?-.25:.2)+i*1.7;const radius=r*(.28+i*.15);c.beginPath();c.ellipse(0,0,radius,radius*.65,angle,angle,angle+Math.PI*1.2);c.strokeStyle='rgba(166,195,208,'+(.22-i*.025)+')';c.lineWidth=3-i*.5;c.stroke();}
      for(let i=0;i<5;i++){const angle=i*TAU/5+t*.15;const x=Math.cos(angle)*r*.65,y=Math.sin(angle)*r*.43;line(c,[[x,y],[x-5,y+11]],'rgba(187,213,218,.35)',1);}
      path(c,[[4,-15],[-7,2],[2,2],[-5,17],[12,-3],[3,-3]]);c.fillStyle=warning>.3?'#e0c48c':'#9fbcc5';c.fill();
    }
    c.restore();
  }
  offscreenIndicators(c,g) {
    const halfW=Math.max(45,this.width/this.scale/2-55),halfH=Math.max(60,this.height/this.scale/2-100);
    const targets=(g.beacons||[]).filter(b=>b.active).map(b=>({...b,color:'#eedba4',label:'信件投递点'}));
    if(g.campaignActive){const p=g.player||this.camera;const objectives=(g.missionObjects||[]).filter(a=>a.active===true&&!a.completed&&Number.isFinite(a.x)&&Number.isFinite(a.y)&&(Math.abs(a.x-this.camera.x)>=halfW||Math.abs(a.y-this.camera.y)>=halfH)).sort((a,b)=>Number(Boolean(a.optional))-Number(Boolean(b.optional))||Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y)).slice(0,3);targets.unshift(...objectives.map(a=>({...a,color:a.followRole?'#edbc97':a.optional?'#e5ca8e':a.type==='survivor'?'#d9d5a1':'#a9e5ce',label:a.name||{convoy:'护航船',survivor:'待救船员',cache:'物资箱',signal:'信号塔',gate:'航道门'}[a.type]||'任务目标'})));}
    if(g.bossActive&&!targets.some(a=>a.followRole==='campaign-boss')){const boss=(g.enemies||[]).find(e=>e.type==='boss');if(boss)targets.push({...boss,color:'#efbc98',label:boss.name||'沉钟'});}
    const occupied=[];
    for(const target of targets){
      const dx=target.x-this.camera.x,dy=target.y-this.camera.y;
      if(Math.abs(dx)<halfW&&Math.abs(dy)<halfH)continue;
      const ratio=Math.min(halfW/Math.max(1,Math.abs(dx)),halfH/Math.max(1,Math.abs(dy)));
      const x=this.camera.x+dx*ratio;let y=this.camera.y+dy*ratio;
      if(g.campaignActive){const baseY=y;for(let i=0;i<5&&occupied.some(p=>Math.abs(p.x-x)<100&&Math.abs(p.y-y)<28);i++)y=clamp(baseY+(i%2?-1:1)*(Math.floor(i/2)+1)*30,this.camera.y-halfH,this.camera.y+halfH);occupied.push({x,y});}
      c.save();c.translate(x,y);c.rotate(Math.atan2(dy,dx));path(c,[[11,0],[-6,-6],[-3,0],[-6,6]]);c.fillStyle=target.color;c.fill();c.restore();
      c.save();c.font=`${g.campaignActive?clamp(11/this.scale,10,18):10}px system-ui,sans-serif`;c.textAlign='center';let labelX=x;if(g.campaignActive){const width=c.measureText(target.label).width,viewHalf=this.width/this.scale/2;labelX=clamp(x,this.camera.x-viewHalf+width/2+9,this.camera.x+viewHalf-width/2-9);c.fillStyle='rgba(10,36,43,.8)';c.fillRect(labelX-width/2-6,y+8,width+12,19);}c.fillStyle=target.color;c.fillText(target.label,labelX,y+21);c.restore();
    }
  }
  star(c,x,y,r,inner,color) {
    c.beginPath();for(let i=0;i<8;i++){const a=i*Math.PI/4-Math.PI/2,rr=i%2?inner:r;const xx=x+Math.cos(a)*rr,yy=y+Math.sin(a)*rr;i?c.lineTo(xx,yy):c.moveTo(xx,yy);}c.closePath();c.fillStyle=color;c.fill();
  }
  minimap(c,g,w,h,pal) {
    if(w<650||h<440)return;
    const mw=124,mh=83,x=w-mw-24,y=112;
    c.save();c.fillStyle='rgba(12,36,44,.68)';c.fillRect(x,y,mw,mh);c.strokeStyle='rgba(199,220,191,.3)';c.lineWidth=1;c.strokeRect(x+.5,y+.5,mw,mh);
    const toX=v=>x+v/1800*mw,toY=v=>y+v/1200*mh;
    for(const a of g.islands||[])ellipse(c,toX(a.x),toY(a.y),Math.max(2,a.r/1800*mw),Math.max(1.5,a.r/1200*mh*.7),'#859e87');
    for(const b of g.beacons||[])this.star(c,toX(b.x),toY(b.y),4,2,b.active?'#f3d397':'#84aaa3');
    if(g.campaignActive){for(const a of g.missionObjects||[])this.missionMapIcon(c,a,toX(a.x),toY(a.y));for(const a of g.campaignHazards||[]){if(Number.isFinite(a.x)&&Number.isFinite(a.y)){if(a.type==='mine')ellipse(c,toX(a.x),toY(a.y),1.7,1.7,'#d28f79');else ring(c,toX(a.x),toY(a.y),Math.max(3,(a.r||80)/1800*mw),'rgba(204,171,164,.5)',.7);}}}
    for(const e of g.enemies||[])if(e.type==='boss')ellipse(c,toX(e.x),toY(e.y),3,3,'#e19d87');
    const p=g.player||{x:900,y:600};c.save();c.translate(toX(p.x),toY(p.y));c.rotate(p.angle||0);path(c,[[5,0],[-3,-3],[-1,0],[-3,3]]);c.fillStyle='#f4e4b6';c.fill();c.restore();
    c.fillStyle='rgba(214,228,202,.55)';c.font='8px system-ui';c.textAlign='left';c.fillText('海  图',x,y-7);c.restore();
  }
  bossBar(c,g,w,h) {
    const boss=(g.enemies||[]).find(e=>e.type==='boss'&&!e.dead);if(!boss)return;
    const bw=Math.min(360,w-54),x=(w-bw)/2,y=w<700?142:116;
    c.save();c.fillStyle='rgba(13,27,44,.86)';c.fillRect(x-15,y-32,bw+30,67);
    c.textAlign='center';c.fillStyle='#f0ccad';c.font='14px Georgia,serif';c.fillText(boss.name||'深海守望者 · 沉钟',w/2,y-9);
    c.fillStyle='#182637';c.fillRect(x,y,bw,6);c.fillStyle=boss.hp<boss.maxHp*.5?'#ef9877':'#d3b08c';c.fillRect(x,y,bw*clamp(boss.hp/boss.maxHp,0,1),6);
    c.fillStyle='#a5bdb9';c.font='9px system-ui';c.fillText(boss.hp<boss.maxHp*.5?'II · 怒潮 / 共鸣可以清除弹幕':'I · 深海回响 / 注意炮口预警',w/2,y+23);c.restore();
  }
  menuDecoration(c,w,h,t) {
    // Print-like compass and wide decorative latitude marks on the unobscured sea.
    if(w<760)return;
    const x=w-80,y=100;
    c.save();c.translate(x,y);c.globalAlpha=.65;
    ring(c,0,0,34,'rgba(223,231,195,.38)',1);ring(c,0,0,29,'rgba(223,231,195,.25)',.6);
    for(let i=0;i<16;i++){const a=i/16*TAU;line(c,[[Math.cos(a)*30,Math.sin(a)*30],[Math.cos(a)*(i%4?33:37),Math.sin(a)*(i%4?33:37)]],'#c6d7b9',.8);}
    this.star(c,0,0,26,4,'#d7dfb7');this.star(c,0,0,19,3,'#367d78');
    c.fillStyle='#d8dfb9';c.font='11px Georgia,serif';c.textAlign='center';c.fillText('N',0,-46);c.fillText('S',0,52);c.restore();
    c.save();c.fillStyle='rgba(226,235,206,.48)';c.font='italic 11px Georgia,serif';c.textAlign='right';c.fillText('Some letters are worth crossing the sea.',w-35,h-53);c.font='9px system-ui,sans-serif';c.fillText('34° 07′ N    /    127° 32′ E',w-35,h-32);c.restore();
  }
  storm(c,w,h,t) {
    c.save();c.strokeStyle='rgba(191,216,220,.1)';c.lineWidth=.7;
    for(let i=0;i<50;i++){const x=(hash(i)*w+t*70)%w,y=(hash(i+100)*h+t*330)%h;line(c,[[x,y],[x-5,y+14]],'rgba(193,215,224,.12)',.7);}c.restore();
  }
}
