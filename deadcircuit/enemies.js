// Every role has a recognisable silhouette and a separate tactical behaviour.
// Security and its machines cooperate; infected attack either faction on sound/sight.
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const enemy=(name,faction,hp,speed,r,range,damage,fireRate,vision,hearing,color,role,description,extra={})=>({name,faction,hp,speed,r,range,damage,fireRate,vision,hearing,color,role,description,...extra});
export const ENEMY_TYPES=freeze({
 patrol:enemy('安保巡逻员','security',72,115,15,560,10,.62,650,620,'#b1c5cf','patrol','按固定路线巡逻，发现异常先观察，再通报队友。',{ammo:15,reload:1.8,spread:.085}),
 assault:enemy('安保突击手','security',95,148,16,510,12,.22,700,680,'#df996e','assault','用短点射压制并试图绕到侧翼，换弹时会退到掩体。',{ammo:24,reload:2,burst:3,spread:.11}),
 shield:enemy('防暴盾兵','security',150,82,19,220,16,.9,590,650,'#a9b8c8','shield','正面盾牌削减来弹；绕侧、投掷和穿透武器更有效。',{ammo:8,reload:2.8,frontArmor:.85,turnSpeed:1.8,spread:.09}),
 sniper:enemy('楼顶狙击手','security',68,82,15,1200,34,2.3,1380,500,'#e3bd7b','sniper','长时间激光预警后射击，近身时撤离原射击点。',{ammo:5,reload:3,telegraph:1.15,spread:.018}),
 medic:enemy('战地急救员','security',88,122,15,430,8,.65,650,680,'#8dd9c0','medic','寻找受伤安保并施救，治疗时无法射击；可优先压制。',{ammo:12,reload:1.7,healRate:18,healRange:120,spread:.1}),
 radio:enemy('通讯协调员','security',82,105,15,480,10,.55,820,900,'#b4a2df','radio','需要持续通报后才能让远处安保知道玩家位置。',{ammo:15,reload:1.9,radioTime:2.5,radioCooldown:15,spread:.1}),
 heavy:enemy('重装机枪手','security',210,66,21,790,13,.15,840,800,'#c09b77','heavy','持续火力封锁通道，启动扫射和重新装填都有窗口。',{ammo:55,reload:4.1,windup:.8,frontArmor:.3,spread:.14}),
 drone:enemy('侦察旋翼机','machine',48,182,13,510,7,.4,760,700,'#82d4e5','drone','越过低掩体追踪目标，遭命中后短暂停滞，惧怕线圈武器。',{ammo:18,reload:1.8,flying:true,spread:.12}),
 turret:enemy('固定警戒塔','machine',130,0,19,880,12,.26,950,500,'#e8b566','turret','不会移动，转向速度有限；切断所属电路即可停机。',{ammo:30,reload:3,turnSpeed:1.35,spread:.08}),
 walker:enemy('徘徊感染者','infected',65,92,16,29,14,1.05,420,1100,'#a7c98a','walker','听觉敏锐，朝枪声聚拢；安静绕行比正面扫射节省资源。',{melee:true,smell:160}),
 runner:enemy('疾行感染者','infected',44,202,14,27,10,.7,520,1280,'#d9bc7e','runner','直线冲刺很快，转弯较笨；门、掩体和滑步能拉开距离。',{melee:true,turnSpeed:3.1}),
 climber:enemy('攀越感染者','infected',62,138,15,31,15,.95,510,1050,'#b8a6d5','climber','能够越过低矮掩体，靠近后扑击，需要保持侧向移动。',{melee:true,vault:true,pounceRange:145,pounceCooldown:4.5}),
 spitter:enemy('腐蚀喷吐体','infected',76,86,18,480,12,2.5,610,980,'#bad56f','spitter','保持距离投射酸液，落点提前显示，酸池会暂时封住路线。',{projectile:'acid',telegraph:.65,areaRadius:62,areaTime:4,spread:.06}),
 brute:enemy('重型变异体','infected',320,68,28,43,29,1.5,620,1450,'#be9b82','brute','正面耐打，蓄力后冲撞；撞上坚硬障碍会出现长硬直。',{melee:true,frontArmor:.24,chargeRange:450,chargeCooldown:6,telegraph:1.1}),
 warden:enemy('守望者 · 重型平台','machine',680,62,34,900,16,.2,1150,1000,'#f2b576','warden','方向装甲保护核心；侧翼供能模块失效后暴露弱点，攻击带清晰预警。',{ammo:40,reload:4,frontArmor:.65,turnSpeed:.95,telegraph:1.3,boss:true}),
 commander:enemy('安保指挥官','security',350,140,19,800,17,.28,1000,900,'#d6c2dc','commander','交替使用短点射与掩体转移；证据齐备时可用任务互动迫使其停火。',{ammo:21,reload:2,frontArmor:.18,boss:true,spread:.055})
});
export const FACTION_NAMES=freeze({security:'城市安保',infected:'感染者',machine:'无人平台'});
export function factionsHostile(a,b){
 if(!a||!b||a===b)return false;
 if(a==='player'||b==='player')return a!=='civilian'&&b!=='civilian';
 if(a==='civilian'||b==='civilian')return false;
 return (a==='infected')!==(b==='infected');
}
