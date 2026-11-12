/** Original writing and vector illustrations for TIDEKEEPER. */
export const INTRO = [
  { speaker: '灯塔守望者 · 阿砾', portrait: 'keeper', text: '七夜了，归潮灯塔一直没有亮。雾吃掉了航线，也把每一座岛变成了一座孤岛。' },
  { speaker: '信使 · 米拉', portrait: 'mira', text: '邮袋还在，五封信一封也没湿。只要还有人等信，这条路就不算断。' },
  { speaker: '灯塔守望者 · 阿砾', portrait: 'keeper', text: '那就启航吧。把信交给岸上的人，收回他们的灯火。船会自动开火；别让雾里的东西把你围住。' },
];

export const STAGES = [
  {
    name: '盐花渡', subtitle: '01 / SALTFLOWER LANDING', color: '#a7dec9',
    objective: '驱散雾群，唤醒盐花渡的航标',
    letterTitle: '第一封信 · 写给等船的人',
    letter: '小满：\n\n今年海上的盐花开得晚。别数日子，数厨房窗台上的豆芽吧。等它们爬上绳子，我就回家。\n\n你教我的纸船，我一直带着。\n\n——爸爸',
    dialogue: [
      { speaker: '小满', portrait: 'child', text: '我就知道邮船会来！他们说大雾里什么都不剩了，可爸爸的字明明还在。' },
      { speaker: '信使 · 米拉', portrait: 'mira', text: '还有你的纸船。留一盏灯吧，让他从海上就能看见家。' },
      { speaker: '小满', portrait: 'child', text: '好！我把最亮的贝壳灯借给你。下一座岛的姐姐，也一定在等信。' },
    ],
  },
  {
    name: '铜铃工坊', subtitle: '02 / BELLMAKER’S REACH', color: '#d7d9a0',
    objective: '击退巡雾船，重新敲响工坊的铜铃',
    letterTitle: '第二封信 · 一张没有寄出的订单',
    letter: '铃：\n\n想订一只铜铃，旧船上那种。声音不用好听，只要我一听见，你就知道我回来了。\n\n上回吵架，是我不对。修好船以后，我想先修好我们的那句话。\n\n——哥哥',
    dialogue: [
      { speaker: '铸铃师 · 铃', portrait: 'mechanic', text: '这笨蛋……铃我早打好了，一直没舍得敲。原来他也在等我先开口。' },
      { speaker: '信使 · 米拉', portrait: 'mira', text: '雾里的船会循声靠近。敲响吧，这一次我替你守着。' },
      { speaker: '铸铃师 · 铃', portrait: 'mechanic', text: '记住线圈的回声。灯塔不缺火，它缺的是一条回家的路。' },
    ],
  },
  {
    name: '眠鲸湾', subtitle: '03 / SLEEPING WHALE COVE', color: '#b8b9df',
    objective: '穿过鲸骨水域，护住湾口的星灯',
    letterTitle: '第三封信 · 海从不催人长大',
    letter: '老船长：\n\n我没有接你的船。我在岛上开了间小书屋，孩子们总问我，海的另一边是什么。\n\n我照着你讲过的故事回答。你教我认识的那些星星，一颗也没浪费。\n\n有空来坐坐吧，给你留了靠窗的位置。\n\n——你的学生',
    dialogue: [
      { speaker: '老船长 · 伏恩', portrait: 'captain', text: '我总以为，不肯出海的人就没学会航行。可他把整片海带进了一间书屋。' },
      { speaker: '信使 · 米拉', portrait: 'mira', text: '也许每个人都有自己的港口。你的学生只是先找到了他的。' },
      { speaker: '老船长 · 伏恩', portrait: 'captain', text: '去吧，小信使。我把归航的星位标在信封上了。我也该上岸，去听一个新故事了。' },
    ],
  },
  {
    name: '暮色浮岛', subtitle: '04 / THE LAST LIGHT', color: '#e9b7a4',
    objective: '突破深雾封锁，点亮最后一座航标',
    letterTitle: '第四封信 · 寄往明天',
    letter: '未来的米拉：\n\n如果你真的成了信使，记得常常回头看看。小时候的你，连桥下的水都怕，却总替别人捡落水的风筝。\n\n勇敢不是不害怕。勇敢是知道有一封信，只有你能送到。\n\n——十二岁的米拉',
    dialogue: [
      { speaker: '信使 · 米拉', portrait: 'mira', text: '这封……是我写给自己的。我竟然把它也装进邮袋了。' },
      { speaker: '灯塔守望者 · 阿砾', portrait: 'keeper', text: '有人等了一辈子才听见鼓励。你看，曾经的自己也能把你送得很远。' },
      { speaker: '信使 · 米拉', portrait: 'mira', text: '最后一封，收件地址是归潮灯塔。好，我们把这趟航线走完。' },
    ],
  },
  {
    name: '归潮灯塔', subtitle: '05 / WHERE THE TIDE RETURNS', color: '#a8dcd7',
    objective: '击碎缚潮之心，把最后一封信送进灯塔',
    letterTitle: '最后一封信 · 致每一个归航的人',
    letter: '亲爱的归航者：\n\n灯塔从来没有忘记你。\n\n它只是听见太多人说“别回来了”，便以为熄灭自己，可以让离别少一些。\n\n现在，五座岛的灯都亮了。你看，有人愿意等，有人愿意道歉，有人终于学会告别。\n\n回来吧。即使没有目的地，也有一盏灯愿意为你亮着。\n\n——岸上的人们',
    dialogue: [
      { speaker: '潮汐之灵', portrait: 'sea', text: '我留下每一条船，便不会再有人离开。为什么……他们仍然想回到海上？' },
      { speaker: '信使 · 米拉', portrait: 'mira', text: '因为相聚不是把人留住。是有人走得再远，也知道该往哪里回来。' },
      { speaker: '潮汐之灵', portrait: 'sea', text: '原来灯光不是锁。原来，是邀请。请替我……把灯重新点亮。' },
    ],
  },
];

export const ENDING = [
  { speaker: '灯塔守望者 · 阿砾', portrait: 'keeper', text: '天亮前，第一艘渔船回到了盐花渡。接着是第二艘，第三艘。海面又有了细小的灯。' },
  { speaker: '信使 · 米拉', portrait: 'mira', text: '五封信都送到了。可是，工坊的回信、小满的纸船、船长给学生的新故事……邮袋反而更满了。' },
  { speaker: '潮汐之灵', portrait: 'sea', text: '那么，就明天见。愿每次离岸，都有归航。' },
];

export const UPGRADES = [
  { id: 'damage', name: '燧光炮芯', icon: '✦', rarity: '精良', description: '炮弹伤害提高 25%。让每一束光都更有分量。' },
  { id: 'rate', name: '铜铃快机', icon: '⏱', rarity: '精良', description: '射击间隔缩短 15%。铃声未落，下一发已启程。' },
  { id: 'speed', name: '顺风帆', icon: '➶', rarity: '精良', description: '航速提高 12%。把风留在帆里。' },
  { id: 'hull', name: '鲸骨船肋', icon: '⛨', rarity: '精良', description: '生命上限增加 25，同时恢复 25 点生命。' },
  { id: 'heal', name: '热姜茶', icon: '♨', rarity: '补给', description: '立即恢复 60 点生命。风再冷，也有一口暖。' },
  { id: 'multishot', name: '双生星火', icon: '✧', rarity: '稀有', description: '每次射击增加 1 发炮弹，以扇形覆盖前方。' },
  { id: 'pierce', name: '穿雾针', icon: '➳', rarity: '稀有', description: '炮弹可额外穿透 1 个敌人。光也能缝合迷雾。' },
  { id: 'magnet', name: '拾星罗盘', icon: '⌖', rarity: '精良', description: '拾取范围扩大 55%。散落的星光会找到你。' },
  { id: 'pulse', name: '潮汐线圈', icon: '◎', rarity: '稀有', description: '共鸣脉冲冷却缩短 20%，更频繁地击退敌群。' },
  { id: 'dash', name: '燕尾舵', icon: '↠', rarity: '精良', description: '闪避冷却缩短 20%。在浪尖留下一道白线。' },
  { id: 'crit', name: '黎明星镜', icon: '✴', rarity: '稀有', description: '暴击概率增加 12%。偶尔，星星会替你瞄准。' },
  { id: 'regen', name: '长明灯', icon: '☼', rarity: '稀有', description: '每秒恢复 2 点生命。慢慢地，也能走过整片海。' },
];

const palettes = {
  mira: ['#1f5d5b', '#bfd9bd', '#e9b58d', '#403c38', '#f4ead1'],
  keeper: ['#303e5a', '#a6bcc8', '#c59273', '#ddd7c8', '#d4ac69'],
  mechanic: ['#824f45', '#e6b687', '#b87951', '#352d36', '#c9d6bb'],
  child: ['#537e78', '#cce6ca', '#efbd98', '#463d38', '#e6b85d'],
  captain: ['#344b5e', '#afc7c8', '#b68668', '#eee0ba', '#d6cbb0'],
  sea: ['#174652', '#6db9ae', '#c8e6ca', '#2d777c', '#eee4bc'],
};
/** Self-contained original cut-paper portraits. No external image/font requests. */
export function portraitSVG(name = 'mira') {
  const id = Object.hasOwn(palettes, name) ? name : 'mira';
  const [bg, halo, skin, hair, cloth] = palettes[id];
  const common = `<circle cx="80" cy="74" r="55" fill="${halo}" opacity=".35"/><path d="M0 128 Q38 108 80 128 T160 128 V160 H0Z" fill="${halo}" opacity=".13"/><path d="M15 24H38M26 13V36M126 125H145M136 116V136" stroke="${cloth}" opacity=".35"/>`;
  let drawing = '';
  if (id === 'sea') {
    drawing = `<path d="M38 140Q16 116 35 84Q22 48 53 44Q61 8 87 26Q126 15 124 51Q152 60 132 89Q151 125 120 145Z" fill="${hair}"/><path d="M48 82Q41 49 70 45Q98 32 112 65L105 112Q81 137 57 111Z" fill="${skin}"/><path d="M45 70Q74 74 94 38Q111 47 118 70Q130 28 88 24Q48 20 39 56Z" fill="${halo}"/><path d="M58 85Q67 80 74 85M89 85Q98 80 105 85" stroke="${bg}" stroke-width="3" fill="none"/><path d="M73 105Q81 109 90 104" stroke="${hair}" stroke-width="2" fill="none"/><path d="M24 151Q32 119 59 113Q81 130 105 113Q136 125 143 151" fill="${halo}"/><path d="M33 42Q16 37 24 23Q32 39 44 34M125 42Q148 35 139 23Q135 37 121 33" stroke="${cloth}" stroke-width="2" fill="none"/><circle cx="80" cy="63" r="4" fill="${cloth}"/>`;
  } else {
    const old = id === 'keeper' || id === 'captain';
    drawing = `<path d="M24 160Q27 120 58 114H102Q134 122 138 160Z" fill="${cloth}"/><path d="M65 100H95V127Q80 141 65 127Z" fill="${skin}"/><path d="M47 68Q42 29 81 27Q119 27 115 72L108 103Q97 121 80 123Q62 119 52 103Z" fill="${skin}"/><ellipse cx="48" cy="83" rx="7" ry="10" fill="${skin}"/><ellipse cx="113" cy="83" rx="7" ry="10" fill="${skin}"/><path d="M45 72Q35 32 67 26Q104 17 119 49L115 79L107 62Q83 67 68 43Q61 63 45 72Z" fill="${hair}"/><path d="M58 80L72 78M89 78L102 81" stroke="${hair}" stroke-width="3" stroke-linecap="round"/><circle cx="66" cy="86" r="2.5" fill="${bg}"/><circle cx="95" cy="86" r="2.5" fill="${bg}"/><path d="M80 86L77 98H84" stroke="${bg}" opacity=".35" fill="none" stroke-width="2"/><path d="M72 106Q80 112 90 105" stroke="${hair}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    if (id === 'mira') drawing += `<path d="M41 56Q36 26 73 22Q107 16 120 48L99 56L82 37L63 57Z" fill="${cloth}"/><path d="M42 52L117 44L120 54L42 64Z" fill="${bg}"/><path d="M51 122L80 143L109 122L116 137L83 157L49 140Z" fill="#bc644d"/><path d="M108 138L124 160H110L95 145Z" fill="#bc644d"/><path d="M35 154L51 141" stroke="${bg}" stroke-width="10"/><circle cx="92" cy="146" r="4" fill="#f3d58f"/>`;
    if (old) drawing += `<path d="M53 92Q59 108 73 106L80 111L87 106Q101 108 108 92L103 119L80 137L58 119Z" fill="${hair}"/><path d="M73 111Q80 114 87 111" stroke="${bg}" opacity=".5" fill="none"/><path d="M36 49L44 27L111 25L124 48Z" fill="${bg}"/><path d="M33 46H125V58H33Z" fill="${cloth}"/><path d="M58 134L80 154L105 134" stroke="${bg}" stroke-width="9" fill="none"/>`;
    if (id === 'keeper') drawing += `<path d="M39 74H75V92H51ZM86 74H116L108 92H86Z" fill="none" stroke="${bg}" stroke-width="2.5"/><path d="M75 81H86" stroke="${bg}" stroke-width="2"/><path d="M78 35L84 35L86 44H76Z" fill="${cloth}"/>`;
    if (id === 'captain') drawing += `<path d="M69 32L80 27L92 32L88 43H74Z" fill="${cloth}"/><path d="M80 30V40M75 36H85" stroke="${bg}" stroke-width="2"/>`;
    if (id === 'mechanic') drawing += `<path d="M44 53L50 33L113 34L122 55Z" fill="#a35b40"/><circle cx="64" cy="50" r="11" fill="#cda66c" stroke="${bg}" stroke-width="4"/><circle cx="94" cy="48" r="11" fill="#cda66c" stroke="${bg}" stroke-width="4"/><path d="M75 49H83M55 120L59 160M105 120L101 160" stroke="${bg}" stroke-width="6"/><path d="M57 147H104V160H57Z" fill="${bg}"/><path d="M105 30Q126 28 128 52L117 94L108 65Z" fill="${hair}"/>`;
    if (id === 'child') drawing += `<path d="M38 58Q31 34 45 30L55 51M110 42Q130 28 131 51L116 64" fill="${hair}"/><path d="M59 123L80 139L103 122L109 135L81 150L52 136Z" fill="#d77b58"/><path d="M77 143L70 160H91L85 143" fill="#d77b58"/><circle cx="57" cy="96" r="5" fill="#e9947a" opacity=".6"/><circle cx="103" cy="96" r="5" fill="#e9947a" opacity=".6"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" role="img" aria-label="${id}" width="160" height="160"><defs><clipPath id="p-${id}"><rect x="3" y="3" width="154" height="154" rx="76"/></clipPath></defs><g clip-path="url(#p-${id})"><rect width="160" height="160" fill="${bg}"/>${common}${drawing}</g><circle cx="80" cy="80" r="76" stroke="${cloth}" stroke-opacity=".4" stroke-width="2" fill="none"/></svg>`;
}
