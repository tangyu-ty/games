// Eighteen individually authored tactical spaces. Shared helpers construct geometry,
// never a repeated map template: each operation below has a different route graph.
import {circleRect,clamp,movementObstacles} from './geometry.js';

const META=[
 ['灰线转运站','被指定的目标','station',4,'交叉月台与穿站侧翼','取回身份钥匙；离开时别沿原路返回。'],
 ['封锁商业街','封锁不是一道门','street',5,'穿店路线与车辆断控','切断装甲路障，查清谁把居民列成了目标。'],
 ['仁济急诊楼','不要把人留在系统里','hospital',6,'双通行网与伤员撤离','恢复救护坡道供电，给无法翻窗的人留一条宽路。'],
 ['北行货运列车','车门外的城市','train',5,'车顶／车厢双路径','在七节车厢中寻找原始记录，切断追兵车厢。'],
 ['第七码头冷库','保存温度，也保存证词','coldstore',6,'阀门蒸汽与冷链选择','改变蒸汽流向，找到未被覆写的芯片与失温幸存者。'],
 ['广告塔顶','第一次说出真相','rooftop',6,'三塔连桥与广播接力','夺回三处发射平台，让全城听见安保协议的原文。'],
 ['四号排洪闸','城市不是战场模型','floodgate',6,'双闸改道与低位救援','手动改变闸室水位，救出被封在下游的工班。'],
 ['地下竞价厅','每个人都有价格吗','auction',6,'门禁环路与证据取证','从交易厅夺取买方密钥，保留足以追责的证据。'],
 ['铸枪流水线','拆掉一份错误的订单','factory',7,'传送带与移动掩体','控制生产线，取得能识别医疗信号的非致命识别批次。'],
 ['环城高架','先让救护车通过','highway',7,'双层匝道与分段护送','清理前方路障，允许医疗车停下等待安全路线。'],
 ['市域交换站','关掉的不是一盏灯','server',6,'门禁与照明电力取舍','从三条隔离服务器翼中取出签名，选择什么时候断电。'],
 ['七街防线','没人是诱饵','residential',7,'巷道贯通与分散救援','打通两座庭院，从三条被切断的街道带出居民。'],
 ['露天采掘场','地底也有第二条路','quarry',7,'阶梯采坑与吊桥重排','操作吊机搭起通路，从高低两条路线夺取独立电源。'],
 ['西区配电枢纽','把命令和电分开','power',6,'九个供电岛与主动隔离','按自己的顺序隔离追踪电网，别让照明和医疗一起熄灭。'],
 ['城市战争博物馆','相同制服，不同的人','museum',7,'长视线、玻璃与人质辨识','听完证词，再决定在哪一扇门后采取行动。'],
 ['原始备份库','我们究竟带走什么','archive',8,'螺旋档案与负重返程','取回原始证据箱，出口将在入侵后改变，准备第二条路。'],
 ['无人机起降场','发令之前','airfield',8,'开阔机坪与节点拆解','主动切断识别与发射节点，削弱最后的无人平台。'],
 ['中央发令庭','让武器失去命令','command',9,'转向隔板与三段核心','逐层切断外部签名，抵达发令核心，留下城市的选择。']
];
export const LEVELS=META.map((m,id)=>({id,title:m[0],subtitle:m[1],act:id<6?'第一幕 · 被指定的目标':id<12?'第二幕 · 城市不是战场模型':'第三幕 · 让武器失去命令',theme:m[2],minutes:m[3],mechanic:m[4],briefing:m[5]}));

function base(id,width,height,spawn,exit){
 const meta=LEVELS[id];
 const l={...meta,name:meta.title,width,height,spawn:{x:spawn[0],y:spawn[1]},exit:{x:exit[0],y:exit[1],r:100},walls:[],covers:[],doors:[],props:[],enemies:[],objects:[],stages:[],optional:[],floorZones:[],links:[]};
 wall(l,'edge-n',0,0,width,32);wall(l,'edge-s',0,height-32,width,32);wall(l,'edge-w',0,0,32,height);wall(l,'edge-e',width-32,0,32,height);
 return l;
}
function wall(l,id,x,y,w,h,material='concrete',extra={}){const a={id,x,y,w,h,material,active:true,...extra};l.walls.push(a);return a;}
function cover(l,id,x,y,w,h,material='metal',extra={}){const a={id,x,y,w,h,low:true,hp:material==='wood'?100:240,material,active:true,...extra};l.covers.push(a);return a;}
function door(l,id,x,y,w,h,locked=false){const a={id,x,y,w,h,open:false,locked,hp:90,material:'metal',active:true,name:locked?'锁闭门':'通行门'};l.doors.push(a);return a;}
function room(l,id,x,y,w,h,side='s',locked=false){
 const t=26,gap=160;
 for(const s of ['n','s','w','e']){
  if(s===side){
   if(s==='n'||s==='s'){const yy=s==='n'?y:y+h-t,half=(w-gap)/2;wall(l,id+'-'+s+'1',x,yy,half,t);wall(l,id+'-'+s+'2',x+half+gap,yy,half,t);door(l,id+'-door',x+half,yy,gap,t,locked);}
   else{const xx=s==='w'?x:x+w-t,half=(h-gap)/2;wall(l,id+'-'+s+'1',xx,y,t,half);wall(l,id+'-'+s+'2',xx,y+half+gap,t,half);door(l,id+'-door',xx,y+half,t,gap,locked);}
  }else if(s==='n'||s==='s')wall(l,id+'-'+s,x,s==='n'?y:y+h-t,w,t);
  else wall(l,id+'-'+s,s==='w'?x:x+w-t,y,t,h);
 }
 zone(l,id+'-floor','interior',x+t,y+t,w-t*2,h-t*2);
 return id+'-door';
}
function zone(l,id,type,x,y,w,h,extra={}){l.floorZones.push({id,type,x,y,w,h,active:true,...extra});}
function prop(l,type,x,y,w=80,h=64,label=''){l.props.push({type,x,y,w,h,label});}
function label(l,text,x,y){prop(l,'label',x,y,0,0,text);}
function obj(l,id,type,name,x,y,stage,extra={}){const a={id,type,name,x,y,r:24,stage,interaction:1.5,optional:false,active:true,requires:[],...extra};l.objects.push(a);return a;}
function optional(l,id,type,name,x,y,extra={}){obj(l,id,type,name,x,y,-1,{optional:true,...extra});l.optional.push(id);}
function stages(l,defs){l.stages=defs.map((s,i)=>({id:i,title:s[0],description:s[1],targets:s[2],checkpoint:true,reinforcements:s[3]||[]}));}
function enemy(l,type,x,y,extra={}){l.enemies.push({id:'m'+l.id+'-e'+l.enemies.length,type,x,y,wave:0,...extra});}
function squad(l,x,y,types=['patrol','assault','patrol'],spacing=100){types.forEach((type,i)=>enemy(l,type,x+(i%3)*spacing,y+Math.floor(i/3)*spacing,{patrol:[{x:x+(i%3)*spacing,y:y+Math.floor(i/3)*spacing},{x:x+(i%3)*spacing+130,y:y+Math.floor(i/3)*spacing+90}]}));}
function supplies(l,locations){locations.forEach(([x,y],i)=>optional(l,'supply-'+i,'supply','现场补给',x,y,{interaction:.5}));}
function barricade(l,id,x,y,horizontal=true){cover(l,id,x,y,horizontal?200:62,horizontal?62:200,'metal');}
function terminal(l,id,name,x,y,stage,effect={}){return obj(l,id,'terminal',name,x,y,stage,{interaction:2,effect});}

const AUTHORS=[
// 01: three longitudinal platforms; two passages cross beneath the station.
()=>{
 const l=base(0,4200,2500,[200,1920],[3860,350]);
 zone(l,'south-platform','road',160,1700,3880,540);zone(l,'north-platform','road',160,280,3880,530);zone(l,'track-bed','interior',180,1040,3850,420);
 for(const [i,x] of [650,1510,2370,3230].entries()){wall(l,'train-body-'+i,x,1070,560,230,'metal');prop(l,'train',x+20,1090,520,190,'停运货列');}
 room(l,'station-house',1580,300,1000,540,'s');room(l,'signal-office',3100,1740,650,450,'n');
 wall(l,'ticket-bank',520,590,600,60,'glass',{hp:70});wall(l,'platform-barrier',1640,1540,1090,44,'metal');
 [450,1260,2690,3550].forEach((x,i)=>{cover(l,'bench-'+i,x,1860,150,50,'wood');prop(l,'bench',x,1860,150,50);});
 terminal(l,'routing','开放维修通道',720,760,0,{openDoors:['station-house-door']});
 obj(l,'key','evidence','战术身份钥匙',2070,510,1,{requires:['routing']});
 terminal(l,'dispatch','复制调度原始记录',3440,1950,2,{openDoors:['signal-office-door']});
 optional(l,'worker','rescue','被困站务员',2750,780,{flag:'stationWorker'});
 supplies(l,[[400,2100],[2800,1810],[1300,820]]);
 squad(l,740,1780,['patrol','patrol']);squad(l,1550,1460,['assault','radio','patrol']);squad(l,2680,670,['walker','walker','runner']);squad(l,3200,1600,['patrol','shield','patrol']);squad(l,2100,880,['walker','walker']);
 stages(l,[['穿过转运站','从月台与维修通道接近站房。',['routing']],['取回钥匙','站房的钥匙记录着尚未发布的身份变更。',['key'],[{type:'assault',x:2350,y:900},{type:'runner',x:1380,y:1250}]],['离开原来的路线','复制南侧调度记录，再从北侧月台撤离。',['dispatch']]]);
 label(l,'灰线 / 末班车已停运',300,2010);label(l,'维修通道',1160,1500);label(l,'北侧月台',3200,480);return l;
},
// 02: a cross street, four independently enterable shops and an alley loop.
()=>{
 const l=base(1,4600,3300,[260,2830],[4230,380]);
 zone(l,'boulevard','road',1850,120,760,3060);zone(l,'cross-street','road',120,1330,4360,650);
 room(l,'pharmacy',350,370,1100,700,'e');room(l,'market',2930,370,1180,700,'s');room(l,'repair-shop',390,2190,1060,680,'n');room(l,'bakery',2950,2230,1120,650,'w');
 wall(l,'north-block',1600,180,70,810);wall(l,'east-block',2750,2110,60,900);
 cover(l,'armored-a',1940,2180,200,92,'metal',{low:false});cover(l,'armored-b',2350,910,200,92,'metal',{low:false});
 prop(l,'car',1940,2180,200,92,'封路车 A');prop(l,'car',2350,910,200,92,'封路车 B');
 for(const [i,p] of [[700,1480],[1350,1660],[3010,1530],[3550,1760]].entries())barricade(l,'street-cover-'+i,...p);
 terminal(l,'car-a','断开南路障控制',2220,2250,0,{moveCover:[{id:'armored-a',x:1620,y:2460}]});
 terminal(l,'car-b','断开北路障控制',2250,780,1,{moveCover:[{id:'armored-b',x:2740,y:760}]});
 obj(l,'roster','evidence','查收未签约居民名单',3520,620,2);
 optional(l,'roller-switch','switch','开放商铺穿行卷帘门',1100,2460,{effect:{openDoors:['repair-shop-door','pharmacy-door','bakery-door']}});
 optional(l,'shopkeeper','rescue','躲在药房的店主',800,710,{flag:'shopkeeperSaved'});
 supplies(l,[[620,2700],[3570,2580],[1740,1110]]);
 squad(l,1730,2560,['patrol','assault','radio']);squad(l,2600,1560,['shield','patrol','patrol','medic']);squad(l,1950,550,['patrol','sniper','assault']);squad(l,3250,1250,['walker','walker','runner','walker']);squad(l,700,1800,['walker','runner','walker']);squad(l,3650,500,['patrol','assault']);
 stages(l,[['拆开南侧封锁','路障后的控制器比正面装甲脆弱。',['car-a']],['绕向北侧','街道、商铺与后巷都能接近第二辆封锁车。',['car-b']],['取走名单','安保把拒绝签约的住户列进了同一份名单。',['roster']]]);
 label(l,'拒绝签约 ≠ 敌区',1700,1680);label(l,'后巷 / 商铺穿行',770,1180);return l;
},
// 03: central cross corridor; patient routes are wider than the window flank.
()=>{
 const l=base(2,4100,3300,[350,2820],[3770,2840]);
 zone(l,'hospital-main','interior',200,200,3700,2900);
 room(l,'west-ward',340,360,1170,800,'e');room(l,'east-ward',2650,360,1110,800,'w');room(l,'theatre',2650,1750,1120,820,'w',true);room(l,'power-room',390,2020,1030,650,'n');
 wall(l,'ward-north-divider',1630,260,690,72);wall(l,'ward-south-divider',1660,2140,640,72);
 for(const [i,p] of [[660,630],[1100,860],[2940,620],[3380,890],[2930,2020],[3370,2260]].entries()){cover(l,'bed-'+i,p[0],p[1],150,72,'metal');prop(l,'bed',p[0],p[1],150,72);}
 for(const [i,y] of [1300,1630,1940].entries())cover(l,'hall-cart-'+i,1840,y,240,65,'metal');
 terminal(l,'backup-power','接通救护坡道备用电源',900,2360,0,{openDoors:['theatre-door'],disableHazards:['sparks']});
 obj(l,'stretcher','rescue','护送担架上的病人',3160,2170,1,{interaction:2.2,escort:true,route:[{x:2460,y:2200},{x:2450,y:2820},{x:3770,y:2840}]});
 terminal(l,'ambulance-gate','解锁救护车出口',3570,2840,2,{setFlag:{hospitalExitPowered:true}});
 zone(l,'sparks','electric',1550,2560,650,220,{damage:6});
 optional(l,'clinical-note','evidence','污染事故最早的病历',840,680,{flag:'medicalEvidence'});optional(l,'nurse','rescue','受困护士',3210,660,{flag:'nurseSaved'});
 supplies(l,[[520,2810],[2360,1270],[3560,2520]]);
 squad(l,1450,2700,['patrol','radio','patrol']);squad(l,2280,1710,['assault','shield','medic']);squad(l,1640,760,['walker','walker','runner','spitter']);squad(l,3300,1400,['walker','walker','climber']);squad(l,2600,2740,['assault','patrol']);squad(l,520,1340,['walker','walker','runner']);
 stages(l,[['恢复宽路','病人无法翻越窗台。先恢复能让担架通过的救护坡道。',['backup-power']],['不要留下病人','打开手术区，将病人带离正在失守的病区。',['stretcher']],['给救护车开门','沿宽走廊抵达出口控制台，确保撤离继续。',['ambulance-gate']]]);
 label(l,'急诊 / 请勿丢下无法奔跑的人',1710,1470);return l;
},
// 04: seven narrow carriages and an exterior maintenance route.
()=>{
 const l=base(3,5600,1800,[180,900],[5360,890]);
 zone(l,'rail-side','road',120,1170,5350,360);zone(l,'roof-route','roof',120,320,5350,280);
 for(let i=0;i<7;i++){
  const x=270+i*740;zone(l,'car-floor-'+i,'interior',x,640,640,420);
  wall(l,'car-top-'+i,x,610,640,26,'metal');wall(l,'car-bottom-left-'+i,x,1060,240,26,'metal');wall(l,'car-bottom-right-'+i,x+400,1060,240,26,'metal');door(l,'car-access-'+i,x+240,1060,160,26);
  if(i>0){wall(l,'car-end-top-'+i,x,640,24,120,'metal');wall(l,'car-end-bottom-'+i,x,920,24,140,'metal');}
  prop(l,'train',x+30,670,570,350,'货厢 '+(i+1));
  if(i!==1&&i!==5)cover(l,'car-cargo-'+i,x+310,740,150,95,'wood');
 }
 wall(l,'roof-divider-a',950,300,30,290,'metal');wall(l,'roof-divider-b',3150,300,30,290,'metal');
 terminal(l,'brake-override','解除货列紧急制动',1260,890,0,{openDoors:['car-access-1','car-access-2']});
 obj(l,'sealed-log','evidence','取出未联网的货运记录',3490,880,1);
 terminal(l,'uncouple','切断追兵联结器',5010,1260,2,{closeDoors:['car-access-4'],openDoors:['car-access-6'],setFlag:{trainDetached:true}});
 optional(l,'conductor','rescue','被困检修员',2040,1340,{flag:'conductorSaved'});
 supplies(l,[[500,1410],[2790,1350],[4470,830]]);
 squad(l,1000,1240,['patrol','patrol','assault'],80);squad(l,1930,770,['walker','runner','walker'],75);squad(l,2720,1260,['shield','radio','patrol'],85);squad(l,3650,760,['walker','climber','walker'],75);squad(l,4500,1270,['assault','sniper','patrol'],85);squad(l,5150,690,['drone','patrol'],70);
 stages(l,[['让列车继续前进','进入第二节车厢，找到独立制动器。',['brake-override']],['越过车顶和车内','选择狭窄车厢或暴露的外侧通道取回记录。',['sealed-log']],['切断追兵','到尾部手动解开联结器，从尾端检修平台撤离。',['uncouple']]]);
 label(l,'北行 07 / 高架货运',2200,440);return l;
},
// 05: long refrigeration racks form alternating loops, not a generic square maze.
()=>{
 const l=base(4,4300,3500,[280,3040],[3900,330]);
 zone(l,'cold-floor','interior',200,200,3900,3100);room(l,'control',300,350,900,600,'e');room(l,'drug-store',3000,2280,950,750,'w',true);
 const racks=[[1450,420,260,870],[2200,720,260,1060],[2950,350,260,940],[780,1360,260,1180],[1450,1740,260,1120],[2200,2130,260,1000],[2940,1320,260,620]];
 racks.forEach((r,i)=>{wall(l,'rack-'+i,...r,'metal');prop(l,'cabinet',r[0]+15,r[1]+15,r[2]-30,r[3]-30,'冷藏架');});
 zone(l,'steam-west','fog',1110,1030,580,580,{opacity:.7});zone(l,'steam-east','fog',2700,1880,550,620,{opacity:.75});
 terminal(l,'valve-a','把低温蒸汽导向空管廊',630,730,0,{disableHazards:['steam-west'],enableHazards:['steam-east'],openDoors:['drug-store-door']});
 obj(l,'original-chip','evidence','取回未覆写识别芯片',2690,370,1);
 obj(l,'cold-patient','rescue','救出冷库检修员',3470,2660,2,{interaction:2,escort:true});
 optional(l,'cold-chain','switch','保住药品冷链',3480,2940,{effect:{disableHazards:['steam-east'],setFlag:{medicinePreserved:true}}});
 optional(l,'batch-label','evidence','事故前的运输批次标签',1900,1530,{flag:'coldEvidence'});
 supplies(l,[[420,3180],[1870,3010],[3660,1450]]);
 squad(l,1180,2740,['patrol','assault','radio']);squad(l,1790,1450,['walker','walker','runner','spitter']);squad(l,2580,1820,['walker','brute','walker']);squad(l,3320,800,['patrol','shield','assault']);squad(l,3440,2040,['climber','runner','walker']);squad(l,1420,330,['patrol','medic']);
 stages(l,[['改变蒸汽流向','先接近控制室，打开可以看清的穿行路线。',['valve-a']],['芯片没有被改写','穿过交错冷藏架，夺取独立存储的身份副本。',['original-chip']],['把活人带出冷库','检修员在药品区等到现在，不再让他继续等待。',['cold-patient']]]);
 label(l,'冷链也是生命线',3290,2460);return l;
},
// 06: three roof masses linked at alternating bridge positions.
()=>{
 const l=base(5,4500,3500,[330,3080],[4120,470]);
 zone(l,'roof-west','roof',150,200,1150,3100);zone(l,'roof-mid','roof',1640,200,1150,3100);zone(l,'roof-east','roof',3130,200,1180,3100);
 wall(l,'gap-one-top',1320,200,270,1940,'concrete',{roofGap:true});wall(l,'gap-one-bottom',1320,2470,270,830,'concrete',{roofGap:true});
 wall(l,'gap-two-top',2810,200,270,590,'concrete',{roofGap:true});wall(l,'gap-two-bottom',2810,1130,270,2170,'concrete',{roofGap:true});
 zone(l,'bridge-one','road',1270,2160,380,290);zone(l,'bridge-two','road',2760,820,400,280);
 for(const [i,p] of [[500,700],[790,2030],[1850,1350],[2340,2580],[3390,740],[3720,2240]].entries()){cover(l,'roof-vent-'+i,p[0],p[1],190,110,'metal');prop(l,'vent',p[0],p[1],190,110);}
 door(l,'east-lift',3090,820,30,280,true);
 terminal(l,'relay-one','校准西塔发射方向',790,470,0,{openDoors:['east-lift']});
 terminal(l,'relay-two','接通中塔独立电源',2210,2900,1,{setFlag:{towerPower:true}});
 terminal(l,'broadcast','向城市广播原始协议',3890,480,2,{blackout:true,setFlag:{broadcastTruth:true}});
 optional(l,'roof-fugitive','rescue','藏在广告板后的安装工',3450,2910,{flag:'roofWorker'});
 supplies(l,[[400,2700],[1770,2340],[3700,1390]]);
 squad(l,600,1280,['patrol','assault','radio']);squad(l,1080,2360,['walker','climber','walker']);squad(l,1830,1980,['shield','sniper','patrol']);squad(l,2380,520,['drone','assault','patrol']);squad(l,3460,1640,['runner','climber','runner']);squad(l,3540,390,['sniper','heavy','radio']);
 stages(l,[['夺回发射方向','西塔控制器将开放东塔升降平台。',['relay-one']],['不依赖安保供电','穿过第一座桥，到中塔接通独立电源。',['relay-two']],['给全城一个副本','穿过北侧桥，抵达东塔广播台。',['broadcast']]]);
 label(l,'单向索道 / 撤离端',3880,700);return l;
},
// 07: two vertical channels and three bridges controlled from separate banks.
()=>{
 const l=base(6,4700,3500,[320,2940],[4290,430]);
 zone(l,'lower-water','water',1400,300,450,2850,{slow:.58});zone(l,'upper-water','water',2950,300,450,2850,{slow:.58});
 wall(l,'canal-a-top',1450,320,330,760);wall(l,'canal-a-mid',1450,1400,330,1030);wall(l,'canal-a-end',1450,2870,330,350);
 wall(l,'canal-b-top',3010,320,330,1400);wall(l,'canal-b-end',3010,2180,330,1030);
 door(l,'west-sluice',1450,1110,330,200,true);door(l,'east-sluice',3010,1830,330,250,true);
 zone(l,'west-bridge','road',1370,1080,520,300);zone(l,'east-bridge','road',2900,1780,550,360);zone(l,'lower-crossing','road',1370,2480,520,320);
 room(l,'pump-control',350,430,850,660,'e');room(l,'workshop',3580,2220,820,740,'w');
 terminal(l,'west-valve','降下西闸检修桥',850,760,0,{openDoors:['west-sluice'],disableHazards:['lower-water']});
 terminal(l,'east-valve','切换东闸排洪方向',2440,740,1,{openDoors:['east-sluice'],enableHazards:['lower-water'],disableHazards:['upper-water']});
 obj(l,'workers','rescue','救出下游检修工班',3970,2610,2,{escort:true,interaction:2.2});
 optional(l,'pump-log','evidence','带签字的排洪指令',2150,2800,{flag:'floodEvidence'});
 supplies(l,[[590,2720],[2350,1670],[3850,1900]]);
 for(const [i,p] of [[850,1710],[2220,1150],[2520,2470],[3770,1130]].entries())cover(l,'gate-cover-'+i,...p,170,80);
 squad(l,790,2120,['patrol','assault','radio']);squad(l,2180,2360,['walker','spitter','walker','runner']);squad(l,2050,1060,['shield','patrol','medic']);squad(l,3580,1800,['walker','brute','climber']);squad(l,3860,700,['assault','sniper','drone']);squad(l,3480,2840,['walker','runner']);
 stages(l,[['先搭一条路','西闸控制室在另一条高位检修路上。',['west-valve']],['水该往哪里走','穿过中岛，主动切换东闸的排水方向。',['east-valve']],['工班还在下游','沿新开放的桥抵达维修车间，将工人带出来。',['workers']]]);
 label(l,'低位设备区 / 洪水可控',2000,3050);return l;
},
// 08: a ring of backstage rooms around a central auction floor.
()=>{
 const l=base(7,4300,3500,[330,3000],[3900,500]);
 zone(l,'auction-hall','interior',1100,720,2100,1960);
 room(l,'kitchen',350,430,800,660,'s');room(l,'vip',3150,380,820,760,'w',true);room(l,'vault',3160,2390,820,690,'w',true);room(l,'security',350,2340,2200,720,'n');
 wall(l,'stage-back',1550,640,1100,36,'wood');wall(l,'hall-north-left',1180,830,36,420);wall(l,'hall-south-left',1180,1910,36,630);wall(l,'hall-east',3100,1370,40,610);
 for(let i=0;i<8;i++){const a=i*Math.PI/4;cover(l,'auction-table-'+i,2150+Math.cos(a)*650,1700+Math.sin(a)*600,180,95,'wood');}
 terminal(l,'guest-list','取得交易厅访客门禁',800,2660,0,{openDoors:['vip-door']});
 obj(l,'buyer-key','evidence','确认买方身份并复制密钥',3580,760,1,{requires:['guest-list']});
 terminal(l,'vault-cut','解除后台金库警报',2780,2670,2,{openDoors:['vault-door'],disableEnemies:['auction-turret']});
 obj(l,'ledger','evidence','封存军械与医疗交易账本',3570,2730,3,{requires:['vault-cut']});
 optional(l,'kitchen-staff','rescue','后厨员工',750,790,{flag:'auctionStaff'});optional(l,'alarm-off','switch','切断场内监控',2080,450,{effect:{blackout:true,disableEnemies:['auction-turret']}});
 supplies(l,[[480,3150],[1450,2810],[3620,1670]]);
 squad(l,1530,2750,['patrol','radio','patrol']);squad(l,1560,1540,['shield','assault','medic']);squad(l,2570,1140,['patrol','sniper','assault']);squad(l,3310,1970,['walker','runner','walker']);squad(l,620,1470,['walker','spitter','walker']);enemy(l,'turret',2780,1930,{id:'auction-turret'});squad(l,3440,2600,['heavy','patrol']);
 stages(l,[['拿到门禁','从警卫室或外围后厨接近访客登记器。',['guest-list']],['确认是谁在购买','贵宾厅的密钥会给账本上的名字一个主人。',['buyer-key']],['开一条干净的取证路','解除后台金库的警报，保住原始记录。',['vault-cut']],['带走交易账本','进入金库取证，再沿外环撤离。',['ledger']]]);
 label(l,'今晚的拍品：一座城的安全',1760,1860);return l;
},
// 09: three moving conveyor lanes joined by a maintenance crosswalk.
()=>{
 const l=base(8,4700,3500,[300,3020],[4270,450]);
 zone(l,'factory-floor','interior',200,220,4280,3000);
 for(let i=0;i<3;i++){
  const x=1030+i*1130;zone(l,'belt-'+i,'belt',x,500,390,2350,{dx:0,dy:i===1?-55:55});
  for(let j=0;j<3;j++){const yy=700+j*820;wall(l,'machine-'+i+'-'+j,x+470,yy,370,350,'metal');prop(l,'generator',x+495,yy+30,320,290);}
 }
 zone(l,'press-a','electric',860,1300,710,180,{damage:9});zone(l,'press-b','electric',2000,2120,710,180,{damage:9});
 cover(l,'movable-crate',1620,1710,230,110,'wood');cover(l,'moving-stack',2770,930,180,180,'metal');
 terminal(l,'line-stop','暂停南侧冲压机',590,2510,0,{disableHazards:['press-a'],moveCover:[{id:'movable-crate',x:1620,y:1460}]});
 terminal(l,'batch-medical','封存医疗识别生产批次',2460,540,1,{disableHazards:['press-b'],setFlag:{medicalBatch:true}});
 terminal(l,'exit-power','切断军用识别流水线',4060,2560,2,{blackout:true,disableHazards:['belt-0','belt-1','belt-2'],moveCover:[{id:'moving-stack',x:2910,y:1190}]});
 optional(l,'prototype','crate','工匠的拆解工具箱',730,720,{reward:'attachment'});optional(l,'work-order','evidence','被追加的军用订单',4090,720,{flag:'factoryEvidence'});
 supplies(l,[[530,3170],[1840,3000],[4030,1870]]);
 squad(l,810,2090,['patrol','assault','shield']);squad(l,1760,2700,['walker','runner','spitter','walker']);squad(l,2100,1090,['assault','radio','medic']);squad(l,2960,1730,['walker','brute','climber']);squad(l,3610,540,['heavy','drone','patrol']);squad(l,3760,2780,['patrol','assault','sniper']);
 stages(l,[['机器也是掩体','停下南侧冲压机，挪动输送箱形成侧翼路线。',['line-stop']],['拿到另一份订单','穿过三条方向不同的传送带，封存医疗识别批次。',['batch-medical']],['不要再生产敌人','切断军用批次的总电，从北侧质检出口撤离。',['exit-power']]]);
 label(l,'三线生产 / 请看清方向',1680,330);return l;
},
// 10: highway S-bend, split ramps and an independent pedestrian flank.
()=>{
 const l=base(9,5400,3300,[330,2780],[5060,550]);
 zone(l,'motorway-south','road',180,2300,5000,700);zone(l,'motorway-middle','road',1880,1250,3040,780);zone(l,'motorway-north','road',330,300,4880,650);
 wall(l,'island-a',400,1120,1330,1020);wall(l,'island-b',3100,2070,1800,120);wall(l,'island-c',1920,1010,2700,100);
 for(const [i,p] of [[1200,2540],[2300,2700],[3310,1500],[4100,1710],[1370,560],[3790,650]].entries()){cover(l,'wreck-'+i,p[0],p[1],210,100,'metal',{low:false});prop(l,'car',p[0],p[1],210,100,'废弃车辆');}
 wall(l,'blocked-ramp',1870,1840,240,100,'metal',{hp:260});
 obj(l,'medical-car','vehicle','呼叫医疗车前进',650,2690,0,{route:[{x:1850,y:2680},{x:2380,y:2320},{x:2550,y:1640},{x:4730,y:1640},{x:4800,y:600}],escort:true});
 terminal(l,'ramp-switch','开放高架内侧匝道',2560,2820,1,{removeWalls:['blocked-ramp'],setFlag:{highwayRamp:true}});
 terminal(l,'roadblock-control','解除桥头远程路障',4510,1410,2,{moveCover:[{id:'wreck-5',x:3940,y:820}]});
 obj(l,'medical-arrival','relay','引导医疗车进入安全区',4870,660,3,{requires:['roadblock-control']});
 optional(l,'stranded-driver','rescue','桥下被困司机',750,890,{flag:'driverSaved'});
 supplies(l,[[480,3020],[2860,2160],[4570,900]]);
 squad(l,1310,2690,['patrol','assault','radio']);squad(l,2200,2210,['walker','brute','walker']);squad(l,2760,1590,['shield','medic','patrol']);squad(l,3740,1870,['runner','climber','walker','spitter']);squad(l,4230,1230,['sniper','heavy','drone']);squad(l,3200,450,['patrol','assault','radio']);
 stages(l,[['车可以等，人不能丢','与医疗车同步行动，先清理前方路段。',['medical-car']],['先走步行捷径','打开内侧匝道，让医疗车不必绕回火线。',['ramp-switch']],['拆掉桥头控制','从维修步道或车道接近路障控制台。',['roadblock-control']],['把撤离线接上','确认医疗车抵达北端安全区。',['medical-arrival']]]);
 label(l,'高架维修步道 / 行人可先行',420,830);return l;
},
// 11: three isolated server wings around a central hub.
()=>{
 const l=base(10,4500,3500,[360,2980],[4130,510]);
 zone(l,'server-floor','interior',220,200,4050,3100);
 room(l,'west-wing',300,430,1120,1060,'e');room(l,'north-wing',1720,250,1080,1060,'s',true);room(l,'east-wing',3100,430,1080,1060,'w',true);
 // Losing northern door power opens a different emergency return route.
 l.walls.find(w=>w.id==='north-wing-e').h=600;wall(l,'north-wing-e-south',2774,1050,26,260);door(l,'north-emergency',2774,850,26,200,true);
 wall(l,'hub-bottom-left',970,1900,800,40);wall(l,'hub-bottom-right',2700,1900,800,40);
 for(const [i,p] of [[550,670],[1080,670],[1930,480],[2440,480],[3330,670],[3830,670]].entries()){wall(l,'server-rack-'+i,p[0],p[1],160,430,'metal');prop(l,'cabinet',p[0]+10,p[1]+15,140,400,'服务器');}
 terminal(l,'power-router','切换门禁备用电源',1010,2690,0,{openDoors:['north-wing-door'],disableEnemies:['server-turret-west']});
 obj(l,'network-signature','evidence','取出北翼原始签名',2240,960,1,{effect:{openDoors:['east-wing-door','north-emergency'],closeDoors:['north-wing-door']}});
 terminal(l,'civilian-routing','解除东翼民用流量追踪',3590,1190,2,{blackout:true,openDoors:['north-wing-door'],disableEnemies:['server-turret-east']});
 optional(l,'engineer','rescue','守着设备的工程师',800,1230,{flag:'serverEngineer'});optional(l,'network-map','evidence','物理网络拓扑备份',2670,2660,{flag:'networkMap'});
 enemy(l,'turret',1490,1300,{id:'server-turret-west'});enemy(l,'turret',2990,1300,{id:'server-turret-east'});
 supplies(l,[[500,3150],[2250,2260],[3870,2800]]);
 [600,1500,3100,3750].forEach((x,i)=>cover(l,'server-cover-'+i,x,2340,170,90));
 squad(l,1240,2660,['assault','radio','patrol']);squad(l,1750,1560,['shield','medic','patrol']);squad(l,2900,2300,['walker','spitter','runner','walker']);squad(l,3450,1750,['heavy','drone','assault']);squad(l,2130,650,['patrol','assault']);
 stages(l,[['先分配一条路的电','关闭西侧炮塔，开放北翼门禁。',['power-router']],['签名必须离线带走','进入北翼，得到原始签名后门禁将切向东翼。',['network-signature']],['给民用流量自由','切断追踪但留下医疗与生活通信。',['civilian-routing']]]);
 label(l,'交换站 / 开哪一扇门，都要付电费',1620,1760);return l;
},
// 12: a winding residential network with two destructible garden shortcuts.
()=>{
 const l=base(11,4700,3700,[300,3270],[4290,490]);
 const houses=[[460,350,980,680,'s'],[1840,350,900,680,'s'],[3240,300,960,740,'w'],[500,1640,960,760,'e'],[2060,1660,850,760,'s'],[3400,1700,850,760,'w'],[1570,2900,1100,500,'n']];
 houses.forEach((r,i)=>room(l,'home-'+i,...r));
 wall(l,'garden-wall-a',1480,1110,32,680,'wood',{hp:160});wall(l,'garden-wall-b',2950,2410,32,850,'wood',{hp:160});
 zone(l,'garden-a','interior',1540,1150,500,440);zone(l,'garden-b','interior',2960,2690,400,550);
 terminal(l,'courtyard-a','打开西院防火通道',1710,1430,0,{removeWalls:['garden-wall-a'],openDoors:['home-3-door']});
 obj(l,'residents-west','rescue','带出西街居民',900,1990,1,{escort:true});obj(l,'residents-north','rescue','带出北街居民',2290,730,1,{escort:true});
 terminal(l,'courtyard-b','打通东院撤离线',3110,2950,2,{removeWalls:['garden-wall-b'],openDoors:['home-5-door']});
 obj(l,'residents-east','rescue','带出东街孩子与老人',3820,2110,3,{escort:true});
 optional(l,'rooftop-radio','relay','给社区留下自用电台',3810,700,{flag:'communityRadio'});
 supplies(l,[[530,3400],[1800,2510],[3990,1350]]);
 squad(l,1100,2830,['walker','runner','walker','spitter']);squad(l,1720,1960,['patrol','assault','radio']);squad(l,1630,720,['walker','climber','brute']);squad(l,2700,1400,['shield','patrol','medic']);squad(l,3390,2850,['walker','runner','spitter','walker']);squad(l,3840,1190,['heavy','drone','assault']);squad(l,550,1230,['walker','runner']);
 stages(l,[['给第一条街开口','防火通道能把死巷变成环路。',['courtyard-a']],['谁也不是诱饵','西街与北街各有一组居民，选择你的先后顺序。',['residents-west','residents-north']],['接通最后一段撤离线','从东院打开跨街通道。',['courtyard-b']],['最后一组居民','抵达东街，带上那些没能自己跑来的人。',['residents-east']]]);
 label(l,'七街 / 有人正在这里生活',1900,1250);return l;
},
// 13: stepped quarry, a low inspection tunnel and a movable crane barrier.
()=>{
 const l=base(12,5000,3700,[350,3250],[4610,450]);
 zone(l,'quarry-low','interior',1800,1200,1900,1800);zone(l,'quarry-road','road',250,2900,4400,520);
 wall(l,'terrace-west',1120,330,100,2320);wall(l,'terrace-east',3830,900,100,2470);wall(l,'terrace-north',1300,1020,2380,100);wall(l,'terrace-south',1300,2700,1450,100);
 wall(l,'low-tunnel-left',1440,1450,70,890);wall(l,'low-tunnel-right',1750,1540,70,810);
 wall(l,'crane-lock',2790,2700,860,100,'metal',{hp:350});
 cover(l,'crane-load',3190,1850,320,180,'metal',{low:false});prop(l,'generator',3320,1380,210,130,'独立供电设备');
 terminal(l,'crane-west','把吊臂转向低位平台',690,750,0,{removeWalls:['crane-lock'],moveCover:[{id:'crane-load',x:3420,y:2190}]});
 terminal(l,'crane-power','接通检修洞照明',1570,2600,1,{setFlag:{quarryTunnelLit:true},disableHazards:['quarry-fog']});
 obj(l,'independent-cell','power','取回独立供电设备',3430,1530,2,{interaction:2.5});
 zone(l,'quarry-fog','fog',1350,1300,500,1300,{opacity:.7});
 optional(l,'quarry-workers','rescue','采坑里的两位工人',2290,2140,{flag:'quarryWorkers'});optional(l,'geological-map','evidence','通向核心区的旧检修图',4310,2780,{flag:'quarryMap'});
 supplies(l,[[520,3400],[2400,3100],[4360,1690]]);
 for(const [i,p] of [[620,1810],[2160,1390],[2900,2300],[4210,960]].entries()){cover(l,'quarry-rock-'+i,...p,190,120,'concrete');prop(l,'crate',p[0],p[1],190,120,'矿料箱');}
 squad(l,700,2590,['walker','runner','spitter']);squad(l,1880,2930,['assault','radio','sniper']);squad(l,2140,1770,['walker','brute','climber','runner']);squad(l,3280,1210,['heavy','patrol','drone']);squad(l,4100,2410,['shield','assault','medic']);squad(l,4250,620,['runner','climber','walker']);
 stages(l,[['吊桥能改变战场','先控制高位吊机，重排低位出口与掩体。',['crane-west']],['地底的第二条路','接通检修洞照明，也可以从暴露的高位绕行。',['crane-power']],['带走一块不受命令的电源','从中心采坑取出设备，沿东侧高位撤离。',['independent-cell']]]);
 label(l,'吊臂不属于任何一支队伍',1870,660);return l;
},
// 14: nine power islands, active hazardous strips and an outer safe loop.
()=>{
 const l=base(13,4600,3700,[300,3280],[4220,450]);
 for(let y=0;y<3;y++)for(let x=0;x<3;x++){
  const xx=780+x*1050,yy=520+y*940;
  cover(l,'transformer-'+x+'-'+y,xx,yy,280,210,'metal',{low:false});prop(l,'generator',xx+20,yy+20,240,170,'配电岛 '+(y*3+x+1));
  if(x<2)zone(l,'electric-'+x+'-'+y,'electric',xx+350,yy-30,440,170,{damage:8});
 }
 zone(l,'insulated-west','road',180,220,430,3200);zone(l,'insulated-south','road',200,3160,4150,320);
 wall(l,'north-switch-wall',1820,220,60,680);wall(l,'south-switch-wall',2630,2630,60,480);
 terminal(l,'grid-west','隔离西侧追踪电源',620,2490,0,{disableHazards:['electric-0-0','electric-0-1','electric-0-2'],disableEnemies:['power-turret-west']});
 terminal(l,'grid-east','隔离东侧追踪电源',3540,2380,1,{disableHazards:['electric-1-0','electric-1-1','electric-1-2'],disableEnemies:['power-turret-east']});
 terminal(l,'medical-feed','把医疗馈线切到独立电源',2750,420,2,{blackout:true,setFlag:{hospitalPowerSaved:true}});
 optional(l,'grid-note','evidence','安保与市政电网的分割图',2220,1600,{flag:'gridEvidence'});
 enemy(l,'turret',1360,1800,{id:'power-turret-west'});enemy(l,'turret',3480,850,{id:'power-turret-east'});
 supplies(l,[[460,3420],[2400,3000],[3950,1670]]);
 squad(l,790,2890,['assault','shield','radio']);squad(l,1410,1180,['walker','spitter','brute']);squad(l,2330,2130,['patrol','medic','heavy']);squad(l,3130,2900,['runner','climber','walker','spitter']);squad(l,3530,1230,['drone','assault','sniper']);squad(l,2180,630,['patrol','radio']);
 stages(l,[['切断追踪，不切断生活','西侧隔离器会关闭一组带电地面和炮塔。',['grid-west']],['自己决定电流的路线','从安全外圈或配电岛之间抵达东侧隔离器。',['grid-east']],['保留医院的那一盏灯','将医疗馈线接入独立电源，再撤出追踪电网。',['medical-feed']]]);
 label(l,'绝缘检修道 / 外圈始终可通行',340,2240);return l;
},
// 15: long galleries, breakable glass and two separated hostage rooms.
()=>{
 const l=base(14,4600,3700,[320,3270],[4230,430]);
 zone(l,'museum-floor','interior',200,220,4200,3200);
 room(l,'screening',350,500,1120,790,'s');room(l,'gallery-north',1900,350,2250,790,'s');room(l,'staff-west',350,2210,1090,820,'e',true);room(l,'staff-east',3150,2240,1050,800,'w',true);
 wall(l,'glass-gallery-a',1700,1390,35,880,'glass',{hp:85});wall(l,'glass-gallery-b',2870,1530,35,1100,'glass',{hp:85});
 for(const [i,p] of [[2050,1480],[2540,1860],[3590,1430],[650,1710],[2240,2720]].entries()){cover(l,'exhibit-'+i,...p,180,95,'metal');prop(l,'statue',p[0]+40,p[1]-20,100,100,'展品');}
 obj(l,'testimony','evidence','听取放映室的完整证词',870,870,0,{interaction:2,effect:{openDoors:['staff-west-door','staff-east-door'],setFlag:{hostagesIdentified:true}}});
 obj(l,'hostages-west','hostage','解救西侧维修人员',870,2630,1,{requires:['testimony'],escort:true});
 obj(l,'hostages-east','hostage','解救东侧临床人员',3670,2650,1,{requires:['testimony'],escort:true});
 obj(l,'archive-photo','evidence','取走展览背后的原始影像',3150,730,2);
 optional(l,'museum-guide','rescue','不肯离开展馆的讲解员',2280,3010,{flag:'museumGuide'});
 supplies(l,[[490,3410],[2260,1240],[4010,1790]]);
 squad(l,1490,2830,['patrol','radio','shield']);squad(l,1780,1530,['walker','climber','runner']);squad(l,3060,1810,['assault','medic','heavy']);squad(l,3680,1180,['walker','spitter','brute']);squad(l,2370,760,['sniper','patrol','drone']);squad(l,830,1410,['walker','runner']);
 stages(l,[['先听完，再开门','放映室的证词能区分被囚者与抓捕者。',['testimony']],['相同制服，不同的人','在两侧工作人员区实施救援。',['hostages-west','hostages-east']],['影像不能留给删改者','进入北侧长展厅，取走原始影像。',['archive-photo']]]);
 label(l,'城市战争博物馆 / 展品请勿触碰，证据除外',1570,3200);return l;
},
// 16: asymmetrical archive spiral; taking cargo changes the way out.
()=>{
 const l=base(15,4700,3900,[340,3470],[4310,420]);
 zone(l,'archive-floor','interior',230,220,4230,3450);
 wall(l,'spiral-west',850,700,50,2290);wall(l,'spiral-north',850,700,2790,50);wall(l,'spiral-east',3590,700,50,2290);wall(l,'spiral-south',850,2940,1960,50);
 wall(l,'inner-west',1470,1260,50,1190);wall(l,'inner-north',1470,1260,1540,50);wall(l,'inner-east',2960,1260,50,1190);wall(l,'inner-south',1470,2400,1040,50);
 door(l,'archive-shortcut',850,2990,50,240,true);door(l,'archive-return',3590,2990,50,260,true);
 for(const [i,p] of [[1130,1000],[2040,970],[3270,1110],[3260,2010],[2460,2680],[1150,2300],[2050,1650]].entries()){cover(l,'archive-stack-'+i,...p,130,200,'wood');prop(l,'cabinet',p[0],p[1],130,200,'离线档案');}
 terminal(l,'archive-map','取得档案架物理索引',550,950,0,{openDoors:['archive-shortcut']});
 obj(l,'root-backup','evidence','取出原始证据箱',2270,2030,1,{interaction:3,effect:{openDoors:['archive-return'],closeDoors:['archive-shortcut'],setFlag:{carryingEvidence:true}}});
 terminal(l,'fire-release','解除返程防火门',3940,3070,2,{openDoors:['archive-return'],removeWalls:['spiral-east'],setFlag:{archiveSafeRoute:true}});
 optional(l,'civilian-records','evidence','民用身份登记原始页',1810,2050,{flag:'civilianRecords'});optional(l,'military-root','evidence','军用根密钥副本',3260,2510,{flag:'militaryRoot'});
 supplies(l,[[490,3610],[3940,2050],[2180,3230]]);
 squad(l,1250,3330,['patrol','assault','radio']);squad(l,1140,1600,['walker','climber','spitter']);squad(l,2600,1030,['shield','heavy','medic']);squad(l,2640,2040,['brute','runner','walker']);squad(l,3260,3210,['assault','sniper','drone']);squad(l,4000,1330,['walker','spitter','runner']);
 stages(l,[['纸张也需要路线图','先拿到物理索引，开放档案架侧面的检修门。',['archive-map']],['带走一份不可再改的过去','进入内侧档案区取证。负重会影响冲刺，可以放下证据再战。',['root-backup']],['回程不会重复去程','防火门已经改变路线，使用东侧手动释放器开辟返程。',['fire-release']]]);
 label(l,'原始备份 / 删改权限：无',1770,1850);return l;
},
// 17: open apron, separated hangars and underground service perimeter.
()=>{
 const l=base(16,5400,4000,[350,3560],[4960,490]);
 zone(l,'apron','road',400,600,4550,2700);zone(l,'fuel-corridor','interior',300,3400,4700,360);
 room(l,'hangar-west',550,500,1130,980,'s');room(l,'hangar-mid',2140,540,1100,940,'s');room(l,'hangar-east',3820,520,1100,960,'s');
 wall(l,'fuel-divider-west',550,3140,1420,50);wall(l,'fuel-divider-east',2700,3140,2170,50);
 for(const [i,p] of [[940,2070],[1880,2430],[3180,2090],[4210,2580]].entries()){cover(l,'airfield-container-'+i,...p,280,130,'metal',{low:false});prop(l,'container',p[0],p[1],280,130,'无人机运输箱');}
 terminal(l,'launch-west','断开西侧发射签名',1100,1030,0,{disableEnemies:['launch-drone-west'],setFlag:{launchWestDisabled:true}});
 terminal(l,'launch-east','断开东侧敌我识别',4330,1080,1,{disableEnemies:['launch-drone-east'],setFlag:{launchEastDisabled:true}});
 terminal(l,'fuel-isolation','隔离地下燃料馈送',2440,3570,2,{disableHazards:['fuel-leak'],setFlag:{fuelSafe:true}});
 terminal(l,'tower-override','夺取塔台平台撤销权',2700,1050,3,{disableEnemies:['airfield-turret'],blackout:true,setFlag:{platformsRevoked:true}});
 zone(l,'fuel-leak','fire',3700,3270,620,180,{damage:8});
 optional(l,'maintenance-team','rescue','不肯执行发射令的维护组',1460,3530,{flag:'maintenanceTeam'});
 enemy(l,'drone',1700,1930,{id:'launch-drone-west'});enemy(l,'drone',3720,1800,{id:'launch-drone-east'});enemy(l,'turret',2700,1670,{id:'airfield-turret'});
 supplies(l,[[530,3730],[2250,2870],[4660,2100]]);
 squad(l,1000,2880,['assault','shield','radio','patrol']);squad(l,1770,1690,['walker','brute','climber','spitter']);squad(l,2900,2560,['heavy','medic','drone']);squad(l,4110,2990,['runner','climber','walker','brute']);squad(l,4400,1660,['sniper','assault','radio']);squad(l,2400,740,['heavy','patrol','assault']);
 stages(l,[['发射前先拆掉签名','西机库负责无人平台的发射授权。',['launch-west']],['识别不能等于屠杀','东机库掌握敌我识别，把它从追踪网络中隔离。',['launch-east']],['保住维护人员的退路','由地下检修廊隔离燃料，关闭泄漏火区。',['fuel-isolation']],['把平台撤销权拿回来','抵达中央塔台，使待发平台失去进攻命令。',['tower-override']]]);
 label(l,'未经人员确认，不得自动发射',2160,1840);return l;
},
// 18: nested command rings with offset breaches and rotating defensive shutters.
()=>{
 const l=base(17,4900,4100,[350,3640],[4510,470]);
 zone(l,'command-floor','interior',200,210,4500,3650);
 wall(l,'outer-west',1040,660,60,2510);wall(l,'outer-north',1040,660,2820,60);wall(l,'outer-east',3800,660,60,2510);wall(l,'outer-south-a',1040,3110,1050,60);wall(l,'outer-south-b',2580,3110,1280,60);
 door(l,'ring-one',2090,3110,490,60,true);
 wall(l,'inner-west',1750,1310,50,1170);wall(l,'inner-north',1750,1310,1300,50);wall(l,'inner-east',3000,1310,50,1170);wall(l,'inner-south-a',1750,2430,450,50);wall(l,'inner-south-b',2540,2430,510,50);
 door(l,'ring-two',2200,2430,340,50,true);
 cover(l,'shutter-a',2270,1810,300,80,'metal',{low:false});cover(l,'shutter-b',3210,2220,80,350,'metal',{low:false});
 terminal(l,'external-signature','切断外部指令签名',700,840,0,{openDoors:['ring-one'],disableEnemies:['command-turret-west']});
 terminal(l,'local-consent','以本地人工确认替代自动授权',3330,2780,1,{openDoors:['ring-two'],moveCover:[{id:'shutter-a',x:1940,y:2000},{id:'shutter-b',x:3300,y:1640}]});
 obj(l,'central-core','evidence','接管中央发令核心',2440,1710,2,{interaction:3,effect:{blackout:true,disableEnemies:['command-turret-east'],removeWalls:['outer-east'],setFlag:{coreControlled:true}}});
 terminal(l,'safe-release','为所有仍在城里的人开放撤离',4230,3140,3,{openDoors:['ring-one','ring-two'],setFlag:{cityExitOpen:true}});
 optional(l,'commander-order','evidence','邵渡保留的书面拒绝令',1260,2730,{flag:'commanderRefusal'});optional(l,'city-record','evidence','没有被清除的市民登记',3300,980,{flag:'cityRecord'});
 enemy(l,'commander',1470,1270,{id:'final-commander'});
 enemy(l,'turret',1400,1470,{id:'command-turret-west'});enemy(l,'turret',3510,1200,{id:'command-turret-east'});
 supplies(l,[[570,3790],[2360,3410],[4080,1940]]);
 squad(l,730,2400,['assault','shield','radio','medic']);squad(l,1500,2830,['heavy','patrol','sniper']);squad(l,3210,2400,['walker','brute','climber','spitter']);squad(l,2150,2110,['heavy','assault','medic']);squad(l,4030,1230,['drone','sniper','radio']);squad(l,3500,3480,['runner','brute','walker']);
 stages(l,[['不再接收远方的敌人名单','先到外环签名站，开放第一道人工通行门。',['external-signature']],['让武器等待人的确认','夺取内环授权台，转动隔板改变火线。',['local-consent']],['抵达命令产生的地方','核心就在内环，不必消灭所有人才能结束一场错误。',['central-core']],['让出口不再区分敌我','接通全城人工撤离令，带着决定离开发令庭。',['safe-release']]]);
 label(l,'命令必须有人负责',2070,1530);return l;
}
];

// Each expansion is a hand-authored four-part operation, with distinct
// rescue/verification/logistics tasks rather than a repeated switch objective.
const EXPANSIONS=[
 {
  tasks:[['civilian-exit','gate','恢复站内民用出口',1190,2070,{effect:{setFlag:{stationCivilianExit:true}}}],['identity-verify','relay','核验钥匙上的双重身份签名',2240,690,{requires:['key']}],['track-power','power','隔离失控轨道供电',530,1390,{effect:{disableHazards:['rail-sparks']}}],['evac-staff','rescue','接出北月台滞留乘客',3550,870,{escort:true}],['manual-exit','gate','向末班车司机发出人工撤离信号',3850,610,{requires:['evac-staff']}]],
  chain:[['恢复站内通行','调度命令正在把乘客封在月台；同时恢复出口与维修通道。',['routing','civilian-exit']],['核验被盗身份','取回钥匙，并在独立校验器上确认它的真实签名。',['key','identity-verify']],['从错误名单下断电','复制原始调度记录，隔离不受控制的带电轨道。',['dispatch','track-power']],['接上最后一趟撤离','把乘客带到北月台，向司机发出人工确认。',['evac-staff','manual-exit']]],
  response:[[1900,1370],[2810,1700],[3130,540]],
  zones:[['rail-sparks','electric',1180,1370,420,100,{damage:5}]]
 },
 {
  tasks:[['evac-signal','relay','接通临时街区撤离电台',640,2490,{}],['side-street','switch','打开东侧商铺通路',3300,2450,{effect:{openDoors:['bakery-door','market-door']}}],['record-copy','evidence','封存商铺终端的删改副本',3520,2690,{requires:['roster']}],['market-survivor','rescue','救出被路障分开的送货员',3620,1510,{escort:true}],['evac-road','gate','开放北侧人行撤离线',4020,700,{requires:['market-survivor']}]],
  chain:[['给街区留下联络','先解除南侧装甲车控制，同时恢复民用求援电台。',['car-a','evac-signal']],['穿过封锁的另一面','解除北侧车辆，并打开不会让居民暴露在主街的商铺通道。',['car-b','side-street']],['两份记录互相作证','取出名单与商铺终端副本，证明名单是在封锁后才被改写。',['roster','record-copy']],['让撤离穿过路障','接回送货员，为街区开放人行安全路线。',['market-survivor','evac-road']]],response:[[2100,1350],[3050,2050],[3650,650]]
 },
 {
  tasks:[['triage-list','evidence','核对仍在住院的分诊名单',2250,1300,{}],['isolation-sample','evidence','封存最早的污染检测样本',1030,790,{}],['oxygen','power','接通氧气转运泵',3240,830,{effect:{setFlag:{oxygenTransfer:true}}}],['last-staff','rescue','接出急诊走廊最后一位护工',3500,1450,{escort:true}],['lift-release','switch','放下无障碍转运坡道',2300,2750,{effect:{disableHazards:['sparks']}}]],
  chain:[['恢复救护宽路','核对名单并启动备用电源，确保每一张担架都有出口。',['backup-power','triage-list']],['把污染当成疾病调查','封存最早样本，接通移动氧气，避免把病人变成靶子。',['isolation-sample','oxygen']],['先把活人带走','担架与护工都需要有人带离，不只取回一份文件。',['stretcher','last-staff']],['给救护车开门','放下转运坡道，再确认救护出口，完成这次交接。',['lift-release','ambulance-gate']]],response:[[1900,1600],[2980,1490],[2440,2460]]
 },
 {
  tasks:[['roof-access','switch','开放检修车顶攀行口',2010,1390,{effect:{openDoors:['car-access-2','car-access-3']}}],['cargo-seal','evidence','核对货舱封签与记录序号',2770,820,{}],['passenger','rescue','接出藏在尾厢的检修员',3940,1370,{escort:true}],['quarantine-power','power','切断尾厢错误的隔离命令',4310,850,{effect:{openDoors:['car-access-5'],setFlag:{trainQuarantineEnded:true}}}],['tail-signal','relay','发出人工尾部撤离信号',5260,1290,{requires:['uncouple']}]],
  chain:[['列车不是封闭容器','解除制动，开放车顶检修口形成双层路线。',['brake-override','roof-access']],['取证需要一份封签','将独立货运记录与货舱封签相互核对。',['sealed-log','cargo-seal']],['把隔离命令留在车上','接回检修员，切断尾厢被错误标记的隔离电源。',['passenger','quarantine-power']],['让追兵留在后面','手动切断联结器，向下一站发送人工撤离信号。',['uncouple','tail-signal']]],response:[[2240,1280],[3700,720],[4930,1260]]
 },
 {
  tasks:[['pressure-return','switch','释放高压回流管',3650,1510,{effect:{disableHazards:['steam-east']}}],['batch-confirm','evidence','用运输底单核对芯片批次',610,520,{}],['medical-pack','crate','装好检修员需要的保温医疗包',3470,2810,{reward:'medical'}],['release-power','power','让冷库出口脱离远程封锁',1850,3110,{effect:{setFlag:{coldExitIndependent:true}}}],['cold-exit','gate','向码头地勤确认安全接驳',3880,820,{requires:['cold-patient']}]],
  chain:[['让通路重新可见','改变主蒸汽流向，再释放另一条回流管中的压力。',['valve-a','pressure-return']],['批次必须对得上','取得原始芯片，并回查底单，确定它不是另一份覆盖副本。',['original-chip','batch-confirm']],['救援不是带着空手','把人带离冷库，准备足够支撑撤离的保温包。',['cold-patient','medical-pack']],['保住出口的人工控制','切出独立出口电源，通知码头地勤准备接驳。',['release-power','cold-exit']]],response:[[1290,2670],[2680,1420],[3380,810]]
 },
 {
  tasks:[['mast-west','power','接通西塔线缆避雷接地',910,2870,{effect:{setFlag:{mastGrounded:true}}}],['signal-check','relay','用独立接收器核验中塔信号',1870,470,{}],['antenna-east','switch','锁定东塔机械天线俯角',3730,2660,{effect:{setFlag:{antennaAligned:true}}}],['roof-tech','rescue','接回被火力切断的安装员',3360,1390,{escort:true}],['downlink','relay','确认三个街区收到原始广播',4020,670,{requires:['broadcast']}]],
  chain:[['第一根线先接地','西塔需要电源与发射方向同时恢复，才能跨过第一座桥。',['relay-one','mast-west']],['把信号送过第二座桥','接通中塔独立电源，并用接收器验证内容没有再次被替换。',['relay-two','signal-check']],['东塔不只有一个控制台','锁定机械天线角度，将安装员带离暴露的平台。',['antenna-east','roof-tech']],['让广播有人接收','公布协议原文，然后确认街区真的听见了。',['broadcast','downlink']]],response:[[1180,2240],[2040,1230],[3450,1800]]
 },
 {
  tasks:[['pump-lock','power','切换西岸排水泵为人工控制',730,2710,{effect:{disableHazards:['lower-water']}}],['flood-gauge','relay','核验中岛与下游水位差',2560,2520,{}],['medical-crate','crate','取出工班的急救与防滑装备',4000,2790,{reward:'medical'}],['levee-release','switch','解除下游堤门的远程锁',3790,700,{effect:{disableHazards:['upper-water'],setFlag:{leveeManual:true}}}],['gate-status','relay','通知两岸居民安全渡口位置',2420,3300,{requires:['workers']}]],
  chain:[['人工控制比盲目关闸重要','恢复西岸桥路，切换排水泵，避免下一次远程命令改变水位。',['west-valve','pump-lock']],['看见水去了哪里','切换东闸后实地核验中岛水位，别把危险推给下游。',['east-valve','flood-gauge']],['救援需要一条能走的路','接回检修工班，给他们带上急救与防滑装备。',['workers','medical-crate']],['把安全渡口留给两岸','解除堤门远程锁，并将可走路线广播给居民。',['levee-release','gate-status']]],response:[[2290,1710],[3650,1860],[3530,700]]
 },
 {
  tasks:[['kitchen-pass','evidence','取得后厨目击者的访客凭据',760,790,{}],['buyer-terminal','terminal','封存中央交易终端的授权链',2470,1690,{effect:{disableEnemies:['auction-turret']}}],['courier-rescue','rescue','接出被当作担保品的信使',690,1510,{escort:true}],['payment-root','evidence','找到支付根账号的纸面备份',3730,2880,{requires:['ledger']}]],
  chain:[['凭据不是只听一个人的话','访客登记与后厨证词交叉确认，避免被另一份假名单牵走。',['guest-list','kitchen-pass']],['是谁购买了这座城','取回买方密钥，并封存交易终端的授权链。',['buyer-key','buyer-terminal']],['取证也要保护证人','解除金库警报，把被扣押的信使接出来。',['vault-cut','courier-rescue']],['让账本上的名字可以追责','带走交易账本与支付根账号，再从外环撤离。',['ledger','payment-root']]],response:[[1460,2220],[2850,1280],[3350,2110]]
 },
 {
  tasks:[['crate-control','switch','将运输箱送到检修横桥',1790,3120,{effect:{moveCover:[{id:'movable-crate',x:1640,y:2020}]}}],['feed-sample','evidence','取得医疗识别批次的输入样本',690,810,{}],['line-worker','rescue','接回被困质检员',4140,1950,{escort:true}],['production-stop','terminal','从北端撤销军用订单',3450,470,{effect:{disableHazards:['press-a','press-b'],setFlag:{militaryOrderCancelled:true}}}],['shipping-log','evidence','封存仓储区的出货时间表',560,1440,{}]],
  chain:[['把生产线变成自己的通路','暂停冲压机，借运输箱改变横桥附近的掩体。',['line-stop','crate-control']],['另一种识别结果确实存在','医疗批次与输入样本必须一起保留，才能重现正确结果。',['batch-medical','feed-sample']],['人不属于生产批次','切断军用流水线，将质检员从另一侧带出。',['exit-power','line-worker']],['给每一件武器留下去向','撤销订单并封存出货表，让追责能走出这间工厂。',['production-stop','shipping-log']]],response:[[1560,1910],[2690,2810],[3650,1790]]
 },
 {
  tasks:[['north-scout','relay','与前方步行侦察点建立联络',2720,2850,{}],['fuel-check','evidence','核对医疗车独立供油确认单',3450,2550,{}],['underpass-release','switch','开启北侧步行接驳线',700,740,{effect:{moveCover:[{id:'wreck-4',x:1390,y:770}]}}],['paramedic','rescue','接回被分隔的随车急救员',4370,740,{escort:true}]],
  chain:[['让车等在能保护它的位置','呼叫医疗车前进，同时用步行侦察给下一段路找出口。',['medical-car','north-scout']],['不能让车停在半座桥上','开放匝道，核对供油，保证护送不会在中途失去动力。',['ramp-switch','fuel-check']],['车走车道，人走捷径','解除桥头控制，并为步行的支援人员开放北侧通路。',['roadblock-control','underpass-release']],['交接不是到达一个坐标','确认医疗车到站，接上最后一位随车急救员。',['medical-arrival','paramedic']]],response:[[2010,2640],[3700,1640],[4290,540]]
 },
 {
  tasks:[['airgap','power','将西翼设备切到离线电源',610,1240,{effect:{disableEnemies:['server-turret-west']}}],['security-audit','evidence','封存北翼手写权限审计',2020,480,{}],['failover','power','为东翼医疗通信建立旁路',3650,630,{effect:{setFlag:{medicalNetworkBypass:true}}}],['network-exit','relay','向街区发出不受追踪的路由表',3290,2670,{}],['trapped-tech','rescue','接出留下关闭设备的技术员',920,2720,{escort:true}]],
  chain:[['先让一组设备离线','重新分配门禁电力，并把西翼设备从远程授权中切出来。',['power-router','airgap']],['签名与权限不是同一回事','北翼留下了原始签名和手写权限审计，两份都要取走。',['network-signature','security-audit']],['不能为了追踪而断掉医院','解除东翼民用流量追踪，再给医疗通信接一条旁路。',['civilian-routing','failover']],['最后一个人可以下班了','广播干净的路由表，接回坚持手动关机的技术员。',['network-exit','trapped-tech']]],response:[[1700,2190],[2750,1670],[3440,2270]]
 },
 {
  tasks:[['west-clear','gate','标记西侧居民能通行的防火口',640,2760,{}],['roof-line','relay','恢复跨楼撤离联络线',2190,3190,{effect:{setFlag:{residentialLink:true}}}],['school-bus','vehicle','指引社区车辆接应居民',4190,640,{route:[{x:4180,y:1280},{x:4180,y:2750},{x:4320,y:490}],escort:true}]],
  chain:[['让死巷变成可以选择的路','打通西院，并标记老人孩子可以经过的防火口。',['courtyard-a','west-clear']],['别把任何一组人当成诱饵','西街与北街同时等待救援，自己决定先走哪一条路。',['residents-west','residents-north']],['把跨街的声音接起来','打通东院，恢复屋顶之间的联络。',['courtyard-b','roof-line']],['最后一组人与最后一辆车','接回东街居民，引导社区车辆完成撤离接应。',['residents-east','school-bus']]],response:[[1730,2580],[2640,1280],[3510,2860]]
 },
 {
  tasks:[['counterweight','switch','调整东侧吊机配重位置',4270,3190,{effect:{moveCover:[{id:'crane-load',x:3150,y:2300}]}}],['low-workers','rescue','接出检修洞尽头的工人',2130,2150,{escort:true}],['power-cable','crate','拆下适配医疗电源的转接线',3380,1930,{reward:'attachment'}],['battery-lift','gate','开放重型电池搬运台',4210,830,{effect:{setFlag:{batteryLiftReady:true}}}],['high-level-radio','relay','通知高位支援接收独立电源',2120,480,{}]],
  chain:[['一根吊臂能给两条路让位','转动西侧吊机，并调整东侧配重，让高低位都有可用通路。',['crane-west','counterweight']],['地底不是空白地图','接通洞内照明，把仍在低位等待的工人带出来。',['crane-power','low-workers']],['电源也需要能接上的线','取回独立设备与医疗转接线，避免带走一块无法使用的重物。',['independent-cell','power-cable']],['把重物送上去','开放搬运台，联络高位支援准备接收。',['battery-lift','high-level-radio']]],response:[[2000,2810],[3030,1330],[4230,2430]]
 },
 {
  tasks:[['city-feed','power','把西侧民用馈线转入安全回路',570,870,{effect:{disableHazards:['electric-0-0']}}],['hospital-line','evidence','核对医院独立馈线编号',3550,3410,{}],['technician','rescue','接回手动维护电网的技师',2230,2700,{escort:true}],['grid-airgap','terminal','切断最后一条远程追踪接口',1380,1590,{effect:{blackout:true,setFlag:{gridAirgapped:true}}}],['manual-map','evidence','带走可由人工接管的供电图',3870,430,{}]],
  chain:[['隔离不是一起熄灭','关闭西侧追踪，把民用馈线切到绝缘回路。',['grid-west','city-feed']],['让医院的那一条线能被认出来','隔离东侧追踪并核对医院馈线，避免错切。',['grid-east','hospital-line']],['电网还在依靠一个人','接好医疗电源，把一直手动维护它的技师带回去。',['medical-feed','technician']],['未来不需要再次求一个总开关','切断远程追踪接口，留下人工供电图。',['grid-airgap','manual-map']]],response:[[1660,2650],[2870,1800],[3500,1070]]
 },
 {
  tasks:[['witness-list','evidence','核对被调换制服的证人名单',2300,2980,{}],['control-room','terminal','停止展馆内的伪造警报广播',770,700,{effect:{disableHazards:[],setFlag:{museumAlarmEnded:true}}}],['third-witness','rescue','接回从玻璃廊逃出的证人',2310,1910,{escort:true}],['museum-exit','relay','向撤离队发送已核实的人质身份',4170,1370,{requires:['third-witness']}]],
  chain:[['让证词先于枪声','听取完整证词，再核对被调换制服的人名。',['testimony','witness-list']],['两扇门后面都是活人','对东西两处同时被扣押的人实施救援。',['hostages-west','hostages-east']],['谁在替展馆讲述历史','带走原始影像，停止会把证人引向火线的伪造广播。',['archive-photo','control-room']],['名单要交到能接住它的人手里','接回第三位证人，向撤离队确认真实身份。',['third-witness','museum-exit']]],response:[[1580,2410],[2780,1570],[3430,1270]]
 },
 {
  tasks:[['fire-plan','evidence','查清防火门的人工回程图',4150,2760,{}],['witness-packet','evidence','保留证据箱关联的证人索引',1970,2040,{}],['freight-cart','vehicle','接通负重证据的搬运车',4070,3020,{route:[{x:4120,y:2500},{x:4230,y:1200},{x:4310,y:420}],escort:true}],['archive-airgap','power','让原始备份脱离远程销毁电路',3260,1120,{effect:{setFlag:{archiveAirgapped:true}}}],['courier-handshake','relay','向独立保管者确认交接',4390,650,{}]],
  chain:[['进去之前，先看怎么出来','取得物理索引和防火门的手动回程图。',['archive-map','fire-plan']],['证据背后还有证人','取出原始箱与关联索引，保留能说明它来自何处的链条。',['root-backup','witness-packet']],['重物不能只靠一个人抱着跑','解除返程门禁，接通搬运车形成新的退路。',['fire-release','freight-cart']],['让保管不再等于远程删除','切断销毁电路，把证据交给已经确认的独立保管者。',['archive-airgap','courier-handshake']]],response:[[1260,2800],[3210,2710],[3920,1480]]
 },
 {
  tasks:[['ground-crew','rescue','接出西机库拒绝发射的地勤',1040,1230,{escort:true}],['identification-sample','evidence','封存平台原始识别白名单',4360,760,{}],['purge-valve','switch','排空地下馈送管的危险余压',3960,3550,{effect:{disableHazards:['fuel-leak']}}],['ground-launch-off','power','从地面切断备用发射触发器',2020,3030,{effect:{disableEnemies:['launch-drone-west','launch-drone-east'],setFlag:{launchBackupOff:true}}}]],
  chain:[['拒绝发射的人需要一条退路','断开西侧签名，同时接出拒绝执行的地勤。',['launch-west','ground-crew']],['别让白名单成为另一份敌人名单','断开东侧识别，保留用于核验的原始版本。',['launch-east','identification-sample']],['让地下通路也能带人走','隔离燃料并排尽余压，给维护队留出退路。',['fuel-isolation','purge-valve']],['平台需要失去所有进攻命令','从塔台撤销授权，再切断地面备用发射器。',['tower-override','ground-launch-off']]],response:[[1900,2250],[3670,2020],[2890,1780]]
 },
 {
  tasks:[['city-repeater','relay','让人工撤离命令可以传出内城',720,3140,{}],['officer-ledger','evidence','取回拒绝执行命令的军官记录',1440,1010,{effect:{disableEnemies:['final-commander'],setFlag:{commanderRefusal:true}}}],['medical-consent','terminal','将医疗与民用识别交给人工核验',2480,2180,{effect:{setFlag:{civilianConsent:true}}}],['last-broadcast','relay','向全城确认自动敌区判定已经终止',4310,1090,{requires:['safe-release']}]],
  chain:[['每一份命令都要能追到人','切断外部签名，接通人工撤离的城内中继。',['external-signature','city-repeater']],['有人曾经拒绝过','取得本地确认权限与军官的书面记录，打开通往核心的路。',['local-consent','officer-ledger']],['把最后的识别权交还给人','接管发令核心，并确认医疗与民用身份不再由武器自动裁定。',['central-core','medical-consent']],['不是只有你们要离开这里','开放撤离，向全城确认这场自动战争已经停止。',['safe-release','last-broadcast']]],response:[[1530,2720],[3210,1760],[4060,2760]]
 }
];

function expandOperation(level){
 const expansion=structuredClone(EXPANSIONS[level.id]);
 for(const [id,type,name,x,y,extra] of expansion.tasks)obj(level,id,type,name,x,y,0,{interaction:type==='evidence'?1.8:1.5,...extra});
 for(const [id,type,x,y,w,h,extra] of expansion.zones||[])zone(level,id,type,x,y,w,h,extra);
 // Response locations are separately authored for each route graph. They are
 // triggered by progress, never by an unavoidable idle countdown.
 const security=['assault','patrol','radio','shield','medic'];
 const infected=['runner','walker','spitter','climber','walker','brute'];
 const late=['heavy','assault','drone','sniper','patrol','shield'];
 level.stages=expansion.chain.map((definition,index)=>{
  const response=index===0?[]:(()=>{
   const [x,y]=expansion.response[index-1];
   const types=index===1?security:index===2?infected:late;
   const count=level.id<2?3:level.id<8?4:5;
   const batch=Array.from({length:count},(_,i)=>({id:`m${level.id}-s${index}-r${i}`,type:types[i%types.length],x:x+(i%3)*92,y:y+Math.floor(i/3)*96,wave:index}));
   if(level.id>=8&&index===3)batch.push({id:`m${level.id}-s${index}-r-mixed`,type:level.id>=16?'warden':'runner',x:x-110,y:y+150,wave:index});
   return batch;
  })();
  const [title,description,targets]=definition;
  for(const id of targets){const object=level.objects.find(o=>o.id===id);if(!object)throw Error('Missing authored operation target '+id);object.stage=index;}
  return{id:index,title,description,targets,checkpoint:true,reinforcements:response};
 });
}

function tacticalFurniture(level,id,type,x,y,w,h,material='metal',low=true){
 const rect={x,y,w,h};
 const overlap=o=>rect.x<o.x+o.w+24&&rect.x+rect.w+24>o.x&&rect.y<o.y+o.h+24&&rect.y+rect.h+24>o.y;
 if(movementObstacles(level).some(overlap))return;
 if(level.objects.some(o=>circleRect({...o,r:78},rect))||circleRect({...level.spawn,r:100},rect)||circleRect({...level.exit,r:100},rect))return;
 cover(level,id,x,y,w,h,material,{low});prop(level,type,x,y,w,h);
}

function refineArchitecture(l){
 const furniture=(id,type,x,y,w,h,material='metal',low=true)=>tacticalFurniture(l,id,type,x,y,w,h,material,low);
 if(l.id===0){
  for(const [i,x]of[400,1050,2770,3480].entries()){furniture('ticket-kiosk-'+i,'console',x,900,110,90);furniture('station-crate-'+i,'crate',x+190,1570,105,70,'wood');}
  label(l,'检票厅',1750,720);
 }
 if(l.id===1){
  for(const [i,p]of[[1710,1080],[2630,2030],[2840,1210],[1200,1170],[3650,2070],[1460,2760]].entries())furniture('street-parked-'+i,'car',...p,180,85,'metal',false);
  for(const [i,p]of[[430,470],[3050,470],[470,2300],[3810,2650]].entries())furniture('shop-counter-'+i,'cabinet',...p,130,180,'wood');
 }
 if(l.id===2){
  // Ward subdivisions with generous wheelchair access, plus a central L nurse desk.
  for(const [i,x]of[720,1080].entries())wall(l,'ward-curtain-west-'+i,x,400,22,265,'wood',{hp:80});
  for(const [i,x]of[2980,3340].entries())wall(l,'ward-curtain-east-'+i,x,400,22,265,'wood',{hp:80});
  wall(l,'nurse-spine-west',1590,1510,26,300);wall(l,'nurse-spine-north',1590,1510,610,26);
  wall(l,'sterile-corridor',2610,1230,27,330,'glass',{hp:90});
  for(const [i,p]of[[430,470],[800,470],[1160,470],[440,900],[1040,960],[2740,470],[3110,470],[3470,470],[2760,940],[3440,970],[2770,1900],[3450,2370]].entries())furniture('ward-bed-'+i,'bed',...p,140,65);
  furniture('nurse-desk','console',1740,1730,250,80);furniture('medical-cart-a','crate',2380,1510,95,65);furniture('medical-cart-b','crate',1570,2290,110,65);
  label(l,'分诊 / 护理岛',1840,1610);label(l,'负压观察室',2930,1800);
 }
 if(l.id===4){
  for(const [i,p]of[[1160,1820],[1830,2060],[2650,2420],[3420,1680],[3300,2090],[480,1200],[1920,1030],[2520,400]].entries())furniture('cold-crate-'+i,'crate',...p,145,90,'wood');
 }
 if(l.id===5){
  for(const [i,p]of[[440,1120],[830,1620],[1870,2020],[2430,980],[3430,1940],[3920,1110]].entries())furniture('roof-hvac-'+i,'vent',...p,200,125,'metal',false);
 }
 if(l.id===7){
  // A proper raised stage and an asymmetric backstage corridor, rather than four boxes.
  cover(l,'auction-stage',1760,1020,790,145,'wood',{low:true,hp:500});prop(l,'console',1800,1040,700,100,'竞价台');
  wall(l,'backstage-baffle',1210,1120,30,530,'wood',{hp:130});
  wall(l,'service-partition',1620,2400,26,260,'wood',{hp:100});
  for(const [i,p]of[[1310,1800],[2700,1900],[1780,2180],[2030,1350],[520,2750],[1740,2740]].entries())furniture('auction-extra-'+i,i<4?'bench':'crate',...p,i<4?180:130,80,'wood');
  label(l,'竞价台 / 保留原始报价',1780,1250);label(l,'后台证据封存通道',1110,2910);
 }
 if(l.id===8){
  for(const [i,p]of[[610,1190],[1670,2440],[2830,2780],[3970,1510],[3080,370],[1840,1760],[3850,3020]].entries())furniture('factory-workbench-'+i,i%2?'crate':'console',...p,170,85,i%2?'wood':'metal');
 }
 if(l.id===11){
  for(const [i,p]of[[1580,2720],[2940,1100],[3160,1580],[1600,1070],[3150,3050],[740,2590],[4270,2000],[1810,2610]].entries())furniture('resident-cover-'+i,i%3===0?'car':i%3===1?'bench':'crate',...p,i%3===0?185:135,i%3===0?85:60,i%3===2?'wood':'metal',i%3!==0);
  for(const [i,p]of[[1710,1440],[3120,2800],[1020,1100]].entries())prop(l,'tree',...p,90,100,'庭院');
 }
 if(l.id===14){
  // Galleries extend into each other; staggered glass partitions create long sight
  // lines and optional breachable shortcuts, while cases give short hard cover.
  l.walls.find(w=>w.id==='gallery-north-w').h=310;
  wall(l,'gallery-north-w-return',1900,950,26,190);
  for(const [i,p]of[[2140,1310,28,650],[2500,1790,28,860],[3240,1320,28,590],[1000,1410,430,24]].entries())wall(l,'display-glass-'+i,...p,'glass',{hp:85});
  for(const [i,p]of[[2180,490],[2640,490],[3100,490],[3570,490],[2070,2130],[2690,1450],[3380,2010],[860,1920],[2000,2770]].entries())furniture('museum-case-'+i,'cabinet',...p,i<4?140:170,85,'metal');
  label(l,'城市交通记忆长廊',2200,880);label(l,'当代冲突 / 原始影像',1960,2580);
 }
 if(l.id===15){
  for(const [i,p]of[[1160,1850],[2160,2770],[3300,1500],[3900,900],[2630,1780]].entries())furniture('archive-return-cover-'+i,'cabinet',...p,140,180,'wood');
 }
 if(l.id===16){
  for(const [i,p]of[[720,740],[1290,920],[2310,750],[2840,1060],[4030,790],[4560,1080],[1730,2730],[3290,3100],[4490,1920]].entries())furniture('hangar-crate-'+i,i<6?'generator':'crate',...p,160,110,'metal',i>=6);
 }
 if(l.id===17){
  for(const [i,p]of[[1210,1640],[1640,2780],[3080,1030],[3330,2920],[2110,1430],[2690,2110],[4080,2330]].entries())furniture('command-workstation-'+i,'console',...p,170,85);
 }
}

// Resolve an occasional formation offset against exact walls, keeping authored
// encounter anchors while guaranteeing that no actor starts inside geometry.
function relocate(point,level,r=17){
 const obstacles=movementObstacles(level,{ignoreDoors:true});
 const clear=p=>p.x>r+32&&p.y>r+32&&p.x<level.width-r-32&&p.y<level.height-r-32&&!obstacles.some(o=>circleRect({...p,r},o));
 if(clear(point))return point;
 for(let radius=48;radius<=720;radius+=48)for(let step=0;step<20;step++){
  const p={x:clamp(point.x+Math.cos(step*Math.PI/10)*radius,64,level.width-64),y:clamp(point.y+Math.sin(step*Math.PI/10)*radius,64,level.height-64)};
  if(clear(p))return{...point,...p};
 }
 throw Error('No safe authored position in level '+level.id);
}

export function createLevel(id){
 if(!Number.isInteger(id)||id<0||id>=AUTHORS.length)throw new RangeError('Unknown operation: '+id);
 const level=AUTHORS[id]();
 expandOperation(level);
 refineArchitecture(level);
 const radius=type=>({warden:35,brute:29,heavy:22,shield:20,turret:20,spitter:19,commander:20}[type]||18);
 level.enemies=level.enemies.map(e=>relocate(e,level,radius(e.type)));
 for(const stage of level.stages)stage.reinforcements=stage.reinforcements.map(e=>relocate(e,level,radius(e.type)));
 level.objects=level.objects.map(o=>relocate(o,level,24));
 level.spawn=relocate(level.spawn,level,18);level.exit={...relocate(level.exit,level,24),r:100};
 level.topologySignature=topologySignature(level);
 return level;
}

export function topologySignature(level){
 // Stable structural fingerprint includes every physical route, not art or labels.
 let value=2166136261;
 const structure=JSON.stringify([level.width,level.height,level.walls.map(({x,y,w,h})=>[x,y,w,h]),level.doors.map(({x,y,w,h})=>[x,y,w,h]),level.spawn,level.exit]);
 for(const char of structure){value^=char.charCodeAt(0);value=Math.imul(value,16777619);}
 return(value>>>0).toString(16).padStart(8,'0');
}
