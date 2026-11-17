import * as THREE from './vendor/three.js';

// Shared authored geometry keeps rounded silhouettes economical when instanced.
function shapes(r){
 if(r.artShapes)return r.artShapes;
 const box=new THREE.BoxGeometry(1,1,1,2,2,2),p=box.attributes.position;
 const a=new THREE.Vector3(),b=new THREE.Vector3();
 for(let i=0;i<p.count;i++){a.fromBufferAttribute(p,i);b.copy(a).clampScalar(-.40,.40);a.sub(b).normalize().multiplyScalar(.10).add(b);p.setXYZ(i,a.x,a.y,a.z);}box.computeVertexNormals();
 return r.artShapes={box,capsule:new THREE.CapsuleGeometry(1,1,4,12),sphere:new THREE.SphereGeometry(1,16,12),tube:new THREE.CylinderGeometry(1,1,1,16),ring:new THREE.TorusGeometry(1,.16,6,16)};
}
function material(r,color,kind='metal'){
 r.artMaterials||=new Map();const key=color+kind;if(r.artMaterials.has(key))return r.artMaterials.get(key);
 const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const c=canvas.getContext('2d');c.fillStyle=color;c.fillRect(0,0,128,128);
 let n=137;const random=()=>((n=Math.imul(n,1664525)+1013904223)>>>0)/4294967296;
 for(let i=0;i<1400;i++){c.fillStyle=random()>.5?'#ffffff0b':'#00000012';c.fillRect(random()*128,random()*128,kind==='cloth'?1:5,1);}
 if(kind==='cloth'){c.strokeStyle='#00000018';c.lineWidth=1;for(let i=0;i<128;i+=4){c.beginPath();c.moveTo(i,0);c.lineTo(i,128);c.moveTo(0,i);c.lineTo(128,i);c.stroke();}}
 const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;
 const props={map,color:'#ffffff'};let m;
 if(r.softwareGPU)m=new THREE.MeshLambertMaterial(props);
 else m=new THREE.MeshStandardMaterial({...props,metalness:kind==='metal'?.65:.04,roughness:kind==='metal'?.37:kind==='rubber'?.88:.75,bumpMap:map,bumpScale:kind==='skin'?.0004:.0015});
 r.artMaterials.set(key,m);return m;
}
function part(r,parent,shape,color,kind,x,y,z,sx,sy,sz){const geometry=shape==='box'&&r.softwareGPU&&r.appliedGraphicsQuality!=='high'?r.geometries.box:shapes(r)[shape];const m=new THREE.Mesh(geometry,material(r,color,kind));m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
const box=(r,p,x,y,z,w,h,d,col,kind='metal')=>part(r,p,'box',col,kind,x,y,z,w,h,d);
const ball=(r,p,x,y,z,sx,sy,sz,col,kind='skin')=>part(r,p,'sphere',col,kind,x,y,z,sx,sy,sz);
function barrel(r,p,x,y,z,length,radius,color){const m=part(r,p,'tube',color,'metal',x,y,z,radius,length,radius);m.rotation.z=Math.PI/2;return m;}
function limb(r,parent,from,to,radius,color){const a=new THREE.Vector3(...from),b=new THREE.Vector3(...to),length=a.distanceTo(b);const m=part(r,parent,'capsule',color,'cloth',0,0,0,radius,length/3,radius);m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),b.sub(a).normalize());return m;}

export function detailedWeapon(r,id='arclight',fit={}){
 const family={kestrel9:'pistol',hush45:'pistol',burst9:'pistol',needle:'smg',vector45:'smg',breach12:'shotgun',cyclone12:'shotgun',arclight:'rifle',bullpup:'bullpup',trident:'rifle',sentinel:'dmr',longwatch:'sniper',tempest:'lmg',coil:'energy'}[id]||'rifle';
 const pistol=family==='pistol',long=['sniper','dmr','lmg'].includes(family),length=pistol?.29:family==='smg'?.52:long?.96:.76;
 const gun=new THREE.Group(),dark='#242e34',steel='#697478',poly=family==='shotgun'?'#746347':family==='energy'?'#497078':'#414d4b';
 const B=(x,y,z,w,h,d,c=dark,k='metal')=>box(r,gun,x,y,z,w,h,d,c,k),T=(x,y,z,l,rad,c=steel)=>barrel(r,gun,x,y,z,l,rad,c);
 gun.userData.family=family;gun.userData.artRevision=2;
 B(length*.23,0,0,length*.48,.105,.085,poly);B(length*.29,.05,0,length*.40,.04,.072,steel);
 B(length*.19,-.065,0,.14,.045,.082,dark);const grip=B(length*.13,-.145,0,.063,.17,.061,dark,'rubber');grip.rotation.z=.22;
 // Trigger guard, trigger, ejection port, charging handle, selector and screws.
 B(length*.24,-.105,0,.10,.012,.049);B(length*.285,-.079,0,.012,.055,.049);B(length*.21,-.078,0,.012,.036,.015,steel);
 B(length*.29,.017,.046,.095,.033,.008,'#111b21');B(length*.29,.032,.052,.076,.006,.012,steel);
 B(length*.20,.014,-.057,.045,.018,.03,steel);B(length*.13,-.028,.049,.034,.009,.01,steel);
 for(const x of [length*.08,length*.36])for(const z of [-.048,.048]){const pin=T(x,-.02,z,.006,.008,'#a5aaa3');pin.rotation.set(Math.PI/2,0,0);}
 for(let i=0;i<4;i++)B(length*.13,-.095-i*.022,.032,.051,.006,.005,'#65716b','rubber');
 const magX=family==='bullpup'?-.07:length*.39,magH=fit.magazine==='extendedMag'?.29:fit.magazine==='quickMag'?.15:pistol?.11:.21;
 const magazine=B(magX,-.07-magH/2,0,pistol?.055:.082,magH,.058,'#46504e');magazine.rotation.z=pistol?0:-.1;
 for(let i=0;i<3;i++)B(magX-.027+i*.027,-.09-magH/2,.031,.007,magH*.68,.005,'#252f30');
 B(magX,-.073-magH,0,pistol?.062:.092,.018,.069,'#202b2f','rubber');
 if(fit.magazine==='drum'||family==='lmg'||id==='cyclone12')T(magX,-.19,0,.13,.105,poly).rotation.set(Math.PI/2,0,0);
 if(!pistol){B(-.12,-.007,0,.24,.08,.07,poly,'rubber');B(-.235,-.023,0,.05,.15,.10,dark,'rubber');B(-.11,-.067,0,.16,.025,.065,steel);}
 if(pistol){B(length*.21,.035,0,length*.68,.065,.075,steel);for(let i=0;i<5;i++)B(.025+i*.012,.033,.04,.004,.05,.004,dark);}
 else{
  B(length*.61,0,0,length*.33,.085,.09,poly);for(let i=0;i<5;i++)for(const z of [-.048,.048])B(length*(.49+i*.044),.008,z,.018,.027,.005,'#17232a');
  for(let i=0;i<9;i++)B(length*(.13+i*.072),.079,0,.017,.018,.105,steel);
 }
 T(length*.81,.008,0,length*.27,pistol?.016:.02,steel);T(length*.945,.008,0,.055,.029,dark);T(length*.975,.008,0,.005,.019,'#0b1114');
 let muzzleX=length*.98;
 if(fit.muzzle==='suppressor'||id==='hush45'){T(muzzleX+.11,.008,0,.23,.041,dark);for(const d of [.02,.18])T(muzzleX+d,.008,0,.012,.043,steel);muzzleX+=.23;T(muzzleX,.008,0,.007,.023,'#090f13');}
 else if(fit.muzzle){T(muzzleX,.008,0,.07,.036,steel);for(let i=0;i<3;i++)B(muzzleX-.02+i*.017,.038,0,.008,.008,.023,'#0e191d');muzzleX+=.035;}
 if(family==='shotgun'){T(length*.68,-.045,0,length*.45,.019,steel);B(length*.58,-.07,0,.20,.07,.105,'#79664c','rubber');for(let i=0;i<7;i++)B(length*.46+i*.024,-.072,.054,.009,.055,.006,dark);}
 if(family==='energy')for(let i=0;i<5;i++){B(length*.53+i*.052,0,0,.018,.12,.11,'#6cb7b7');B(length*.53+i*.052,.065,0,.012,.008,.075,'#bee9dc');}
 // Open iron sights and hollow red-dot housing retain an actual sight line.
 for(const x of [length*.10,length*.80]){B(x,.10,-.028,.023,.05,.012);B(x,.10,.028,.023,.05,.012);B(x,.076,0,.025,.012,.07);}
 const optic=fit.optic||(['sniper','dmr'].includes(family)?'scope3':null);
 if(optic){B(length*.29,.10,0,.15,.035,.078,dark);if(['scope3','scope6'].includes(optic)||['sniper','dmr'].includes(family)){T(length*.31,.16,0,.22,.035,dark);for(const x of [length*.20,length*.43]){T(x,.16,0,.02,.043,steel);T(x+.011,.16,0,.003,.031,'#385f68');}}else{B(length*.30,.145,-.043,.075,.09,.013);B(length*.30,.145,.043,.075,.09,.013);B(length*.30,.193,0,.075,.012,.094);}}
 if(fit.underbarrel){if(fit.underbarrel==='bipod'){for(const z of [-1,1]){const leg=B(length*.70,-.15,z*.065,.018,.22,.018,steel);leg.rotation.x=z*.3;}}else{const fore=B(length*.61,-.14,0,.043,.15,.05,dark,'rubber');fore.rotation.z=-.08;}}
 if(fit.rail){B(length*.63,.01,.078,.12,.049,.048,dark);T(length*.69,.01,.078,.01,.017,'#cad7bb');}
 const muzzle=new THREE.Object3D();muzzle.position.set(muzzleX,.008,0);gun.add(muzzle);gun.userData.muzzle=muzzle;gun.userData.length=length;return gun;
}

export function detailedHuman(r,group,parts,{type,infected,player,friendly}){
 group.userData.artRevision=2;const uniform=infected?'#6d7563':friendly?'#8c9b91':type==='heavy'?'#6f6955':'#455b65',armor='#29383f',skin=infected?'#a3ab90':'#b19a81';
 const B=(p,x,y,z,w,h,d,c=uniform,k='cloth')=>box(r,p,x,y,z,w,h,d,c,k),S=(p,x,y,z,sx,sy,sz,c=skin)=>ball(r,p,x,y,z,sx,sy,sz,c);
 B(group,0,.88,0,.26,.23,.39,armor);S(group,0,1.15,0,.165,.28,.245,uniform);B(group,.12,1.18,0,.12,.36,.36,armor);B(group,-.155,1.20,0,.075,.32,.32,armor);
 for(const side of [-1,1]){B(group,.03,1.18,side*.195,.045,.36,.035,'#77847c');for(let i=0;i<3;i++)B(group,.194,1.08+i*.065,side*.09,.05,.045,.068,'#5d6f6c');B(group,.04,.91,side*.225,.14,.14,.08,'#4f5e59');}
 // Neck, jaw and face features are separate from the skull silhouette.
 S(group,.0,1.46,0,.065,.09,.07);S(group,0,1.61,0,.13,.168,.125);S(group,.065,1.54,0,.083,.085,.09);S(group,.137,1.615,0,.036,.043,.031);
 for(const side of [-1,1]){S(group,.005,1.61,side*.127,.035,.055,.02);B(group,.119,1.641,side*.056,.018,.011,.036,'#303531','rubber');B(group,.122,1.663,side*.056,.012,.008,.044,'#635b4e','rubber');}B(group,.142,1.553,0,.009,.009,.045,'#6b5c50','rubber');
 if(!infected&&type!=='civilian'){S(group,-.018,1.725,0,.151,.104,.15,armor);B(group,.025,1.735,0,.24,.025,.22,armor);for(const side of [-1,1]){B(group,-.01,1.65,side*.142,.09,.10,.035,armor);B(group,.09,1.64,side*.13,.025,.12,.014,'#8c9b8b');}B(group,-.1,1.744,0,.05,.022,.095,'#6f827c');}
 if(infected){B(group,.14,1.59,.085,.013,.035,.025,'#687661');S(group,-.035,1.27,.17,.08,.12,.1,'#90987d');}
 for(const side of [-1,1]){
  const leg=new THREE.Group();leg.position.set(0,.84,side*.13);group.add(leg);limb(r,leg,[0,0,0],[.015,-.36,0],.082,uniform);limb(r,leg,[.015,-.36,0],[-.025,-.68,0],.065,uniform);B(leg,.084,-.36,0,.058,.16,.14,armor);B(leg,.055,-.74,0,.27,.13,.16,'#222e32','rubber');B(leg,.055,-.806,0,.28,.025,.17,'#111d22','rubber');parts.legs.push(leg);
  const arm=new THREE.Group();arm.position.set(0,1.37,side*.245);group.add(arm);const elbow=[-.025,-.23,side*.035],hand=infected?[.34,-.31,0]:[side>0?.30:.49,-.12,.30-side*.245];limb(r,arm,[0,0,0],elbow,.072,uniform);limb(r,arm,elbow,hand,.059,uniform);S(arm,0,0,0,.085,.11,.095,uniform);B(arm,-.025,-.23,side*.045,.10,.10,.10,armor);S(arm,...hand,.067,.06,.06,infected?skin:'#35443f');parts.arms.push(arm);
 }
 if(type==='shield'){B(group,.56,1,0,.09,1.35,.72,'#687476','metal');B(group,.61,1.34,0,.02,.21,.45,'#365a63','metal');B(group,.615,.62,0,.015,.09,.56,'#d4b47d');}
 if(type==='radio'||type==='commander'){B(group,-.24,1.2,0,.13,.38,.30,armor);limb(r,group,[-.25,1.40,-.1],[-.25,1.95,-.1],.009,'#667d80');}
 if(type==='medic'||friendly){B(group,-.19,1.18,.08,.08,.25,.22,'#7d9e90');B(group,-.235,1.2,.08,.01,.14,.04,'#e4e4ce');B(group,-.236,1.2,.08,.01,.04,.14,'#e4e4ce');}
 if(type==='brute'){B(group,.20,1.2,0,.10,.50,.43,'#7c8870');S(group,-.12,1.32,0,.19,.27,.29,'#7e8a72');}
 if(type==='spitter')S(group,-.19,1.24,0,.12,.23,.22,'#9aa67c');
 if(!infected&&type!=='civilian'){const weapon=r.buildWorldWeapon(player?'arclight':type==='sniper'?'longwatch':type==='heavy'?'tempest':'arclight');weapon.position.set(.23,1.2,.3);group.add(weapon);parts.weapon=weapon;}
}

export function detailedViewArms(r){
 const arms=new THREE.Group(),cloth='#4c6268',glove='#35433f';
 for(const [elbow,hand] of [[[.46,-.47,-.16],[.28,-.29,-.48]],[[-.34,-.45,-.20],[.11,-.30,-.77]]]){
  limb(r,arms,elbow,hand,.065,cloth);
  const mid=new THREE.Vector3(...elbow).lerp(new THREE.Vector3(...hand),.82);
  const cuff=box(r,arms,mid.x,mid.y,mid.z,.14,.07,.12,'#293a3e','cloth');cuff.rotation.z=.15;
  ball(r,arms,...hand,.066,.048,.075,glove,'rubber');
  box(r,arms,hand[0],hand[1]+.025,hand[2],.09,.025,.10,'#59665c','rubber');
  for(let i=0;i<4;i++){const finger=box(r,arms,hand[0]-.04+i*.025,hand[1]-.018,hand[2]-.042,.022,.042,.065,glove,'rubber');finger.rotation.x=-.3;}
  ball(r,arms,hand[0]-.055,hand[1]-.012,hand[2]+.022,.025,.033,.046,glove,'rubber');
 }
 return arms;
}

export const roundedGeometry=r=>shapes(r).box;

// Static subparts share one draw per geometry/material; their parent still
// carries weapon recoil/reload motion. Muzzle anchors remain independent.
export function compactViewModel(group){
 group.updateMatrixWorld(true);const inverse=group.matrixWorld.clone().invert(),buckets=new Map(),originals=[];
 group.traverse(mesh=>{if(!mesh.isMesh)return;const key=mesh.geometry.uuid+':'+mesh.material.uuid;let b=buckets.get(key);if(!b){b={geometry:mesh.geometry,material:mesh.material,matrices:[]};buckets.set(key,b);}b.matrices.push(inverse.clone().multiply(mesh.matrixWorld));originals.push(mesh);});
 for(const mesh of originals)mesh.parent.remove(mesh);
 for(const b of buckets.values()){const mesh=new THREE.InstancedMesh(b.geometry,b.material,b.matrices.length);b.matrices.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}return group;
}

export function disposeViewModel(group){group?.traverse(mesh=>{if(mesh.isInstancedMesh)mesh.dispose();});}
