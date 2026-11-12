/** Treat browser storage as fallible input, preserving only supported, finite game state. */
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const number=(v,min,max,fallback)=>Number.isFinite(v)&&v>=min&&v<=max?v:fallback;
const integer=(v,min,max,fallback)=>Number.isInteger(v)&&v>=min&&v<=max?v:fallback;
const ids=['first','keeper','hundred','collector','untouched','storm'];
export function loadProfile(v){v=record(v)?v:{};return{best:integer(v.best,0,1e12,0),runs:integer(v.runs,0,1e9,0),wins:integer(v.wins,0,1e9,0),kills:integer(v.kills,0,1e12,0),letters:[...new Set(Array.isArray(v.letters)?v.letters.filter(n=>Number.isInteger(n)&&n>=0&&n<=4):[])],achievements:[...new Set(Array.isArray(v.achievements)?v.achievements.filter(id=>ids.includes(id)):[])]};}
export function loadSettings(v){v=record(v)?v:{};return{mute:v.mute===true,reduced:v.reduced===true,aim:v.aim!==false};}
export function loadVoyage(v){
 if(!record(v)||v.version!==1||!Number.isInteger(v.stage)||v.stage<0||v.stage>4||!record(v.player))return null;
 const p=v.player;
 for(const key of ['x','y','hp','maxHp','speed','damage','fireRate'])if(!Number.isFinite(p[key]))return null;
 if(p.maxHp<=0||p.hp<=0||p.hp>p.maxHp||p.fireRate<=0||p.damage<=0||p.speed<=0)return null;
 if(!Array.isArray(v.enemies)||!Array.isArray(v.pickups)||!Array.isArray(v.beacons)||v.beacons.length!==1)return null;
 const player={x:number(p.x,0,1800,900),y:number(p.y,0,1200,680),r:16,angle:number(p.angle,-1e6,1e6,0),hp:number(p.hp,.001,1e6,120),maxHp:number(p.maxHp,1,1e6,120),speed:number(p.speed,1,2000,205),damage:number(p.damage,1,1e6,20),fireRate:number(p.fireRate,.001,10,.48),dashCD:number(p.dashCD,0,30,0),dashMax:number(p.dashMax,.001,30,2.3),dashTime:0,dashX:number(p.dashX,-1,1,0),dashY:number(p.dashY,-1,1,-1),pulseCD:number(p.pulseCD,0,60,0),pulseMax:number(p.pulseMax,.001,60,9),invuln:2,multishot:integer(p.multishot,1,4,1),pierce:integer(p.pierce,0,3,0),magnet:number(p.magnet,1,1e6,110),crit:number(p.crit,0,.9,.05)};
 const enemies=[];
 for(const e of v.enemies.slice(0,40)){
  if(!record(e)||!['skiff','ray','gunner','brute','boss'].includes(e.type)||!['x','y','hp','maxHp','r','speed'].every(k=>Number.isFinite(e[k]))||e.hp<=0||e.maxHp<=0)continue;
  enemies.push({x:number(e.x,0,1800,900),y:number(e.y,0,1200,300),type:e.type,hp:Math.min(e.hp,e.maxHp),maxHp:e.maxHp,r:number(e.r,1,100,16),speed:number(e.speed,0,1000,70),angle:number(e.angle,-1e6,1e6,0),flash:0,attack:number(e.attack,-1,10,1.5),age:number(e.age,0,1e9,0),windup:0});
 }
 const pickups=v.pickups.slice(0,500).filter(i=>record(i)&&['xp','heal','shell'].includes(i.type)&&Number.isFinite(i.x)&&Number.isFinite(i.y)&&Number.isFinite(i.value)&&i.value>0).map(i=>({x:number(i.x,0,1800,900),y:number(i.y,0,1200,680),r:i.type==='xp'?5:8,type:i.type,value:Math.min(i.value,1000),magnet:i.magnet===true}));
 const beacon=v.beacons[0];if(!record(beacon)||!Number.isFinite(beacon.x)||!Number.isFinite(beacon.y))return null;
 const upgradeCounts={};const upgrades=['damage','rate','speed','hull','heal','multishot','pierce','magnet','pulse','dash','crit','regen'];if(record(v.upgradeCounts))for(const id of upgrades){const count=integer(v.upgradeCounts[id],0,100,0);if(count)upgradeCounts[id]=count;}
 const s={version:1,difficulty:['story','normal','storm'].includes(v.difficulty)?v.difficulty:'normal',ship:['breeze','swift','stone'].includes(v.ship)?v.ship:'breeze',stage:v.stage,player,enemies,pickups,beacons:[{x:number(beacon.x,30,1770,900),y:number(beacon.y,30,1170,290),r:45,active:beacon.active===true}],upgradeCounts,salvaged:[!!v.salvaged?.[0],!!v.salvaged?.[1]]};
 for(const key of ['score','shells','kills','level','xp','nextXp','stageKills','stageHits','dashCount','pendingLevel','combo','salvageCount'])s[key]=integer(v[key],0,1e12,key==='level'?1:key==='nextXp'?12:0);
 s.level=Math.max(1,s.level);s.nextXp=Math.max(1,s.nextXp);s.pendingLevel=Math.min(s.pendingLevel,10);
 for(const key of ['runTime','stageTime','spawnTimer','fireTimer','comboTimer','regen'])s[key]=number(v[key],-1,1e9,0);
 s.bossActive=enemies.some(e=>e.type==='boss');s.bossDefeated=v.bossDefeated===true;s.eliteSpawned=v.eliteSpawned===true;s.cleared=v.cleared===true;s.phase=s.cleared?'letter':'combat';return s;
}
