'use strict';

// ============ 基础数据：花色 / 点数 / 卡牌 ============
const SUITS = ['♠', '♥', '♣', '♦'];
const SUIT_NAMES = { '♠': '黑桃', '♥': '红桃', '♣': '梅花', '♦': '方块' };
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const isRed = (c) => c && (c.suit === '♥' || c.suit === '♦');
const isBlack = (c) => c && (c.suit === '♠' || c.suit === '♣');

const CARD_DEFS = {
  '杀': { type: 'basic', kind: 'sha', desc: '出牌阶段限一次，对攻击范围内一名角色使用。目标需打出【闪】，否则受到1点伤害。' },
  '火杀': { type: 'basic', kind: 'sha', element: 'fire', desc: '火属性【杀】。造成火焰伤害。' },
  '雷杀': { type: 'basic', kind: 'sha', element: 'thunder', desc: '雷属性【杀】。造成雷电伤害。' },
  '闪': { type: 'basic', kind: 'shan', desc: '抵消一张【杀】。' },
  '桃': { type: 'basic', kind: 'tao', desc: '回复1点体力；濒死时使用可脱离濒死。' },
  '酒': { type: 'basic', kind: 'jiu', desc: '出牌阶段使用：本回合下一张【杀】伤害+1；濒死时可当【桃】。' },

  '无中生有': { type: 'trick', kind: 'wuzhong', desc: '摸两张牌。' },
  '顺手牵羊': { type: 'trick', kind: 'shunshou', desc: '获得距离1以内一名角色的一张牌。' },
  '过河拆桥': { type: 'trick', kind: 'guohe', desc: '弃置一名角色的一张牌。' },
  '决斗': { type: 'trick', kind: 'juedou', desc: '与目标轮流打出【杀】，先不出者受到1点伤害。' },
  '南蛮入侵': { type: 'trick', kind: 'nanman', desc: '所有其他角色需打出【杀】，否则受到1点伤害。' },
  '万箭齐发': { type: 'trick', kind: 'wanjian', desc: '所有其他角色需打出【闪】，否则受到1点伤害。' },
  '桃园结义': { type: 'trick', kind: 'taoyuan', desc: '所有角色回复1点体力。' },
  '五谷丰登': { type: 'trick', kind: 'wugu', desc: '亮出等同存活人数的牌，每名角色依次获得一张。' },
  '乐不思蜀': { type: 'trick', kind: 'le', delay: true, desc: '判定：若结果不为红桃，跳过出牌阶段。' },
  '兵粮寸断': { type: 'trick', kind: 'bingliang', delay: true, desc: '判定：若结果不为梅花，跳过摸牌阶段。' },
  '闪电': { type: 'trick', kind: 'shandian', delay: true, desc: '判定：若为黑桃2-9，受到3点雷电伤害；否则移至下家。' },
  '火攻': { type: 'trick', kind: 'huogong', desc: '目标展示一张手牌，你可以弃置同花色牌对其造成1点火焰伤害。' },
  '铁索连环': { type: 'trick', kind: 'tiesuo', desc: '横置或重置至多两名角色；横置角色受到属性伤害时传导。' },
  '无懈可击': { type: 'trick', kind: 'wuxie', desc: '抵消一张锦囊牌的效果，或抵消另一张【无懈可击】。' },
  '借刀杀人': { type: 'trick', kind: 'jiedao', desc: '令一名装备武器的角色对其攻击范围内另一名角色使用【杀】，否则你获得其武器。' },

  '诸葛连弩': { type: 'equip', subtype: 'weapon', range: 1, desc: '出牌阶段你可以使用任意张【杀】。' },
  '青釭剑': { type: 'equip', subtype: 'weapon', range: 2, desc: '你的【杀】无视防具。' },
  '雌雄双股剑': { type: 'equip', subtype: 'weapon', range: 2, desc: '你的【杀】指定异性目标时，你可以摸一张牌。' },
  '青龙偃月刀': { type: 'equip', subtype: 'weapon', range: 3, desc: '你的【杀】被【闪】抵消后，你可以对同一目标再使用一张【杀】。' },
  '丈八蛇矛': { type: 'equip', subtype: 'weapon', range: 3, desc: '你可以将两张牌当【杀】使用或打出（不能包含丈八蛇矛本身）。' },
  '贯石斧': { type: 'equip', subtype: 'weapon', range: 3, desc: '你的【杀】被【闪】抵消后，你可以弃两张牌令此【杀】依然造成伤害。' },
  '方天画戟': { type: 'equip', subtype: 'weapon', range: 4, desc: '你使用最后一张手牌【杀】时，可以额外指定至多两个目标。' },
  '麒麟弓': { type: 'equip', subtype: 'weapon', range: 5, desc: '你的【杀】造成伤害时，可以弃置目标的一匹坐骑。' },
  '寒冰剑': { type: 'equip', subtype: 'weapon', range: 2, desc: '你的【杀】造成伤害时，可以防止此伤害，改为弃置目标两张牌。' },
  '古锭刀': { type: 'equip', subtype: 'weapon', range: 2, desc: '你的【杀】指定没有手牌的角色时，伤害+1。' },
  '朱雀羽扇': { type: 'equip', subtype: 'weapon', range: 4, desc: '你可以将【杀】当火【杀】使用。' },
  '八卦阵': { type: 'equip', subtype: 'armor', desc: '当你需要【闪】时，可以判定，红色视为打出【闪】。' },
  '仁王盾': { type: 'equip', subtype: 'armor', desc: '黑色【杀】对你无效。' },
  '藤甲': { type: 'equip', subtype: 'armor', desc: '【南蛮】【万箭】和普通【杀】对你无效；你受到火焰伤害+1。' },
  '白银狮子': { type: 'equip', subtype: 'armor', desc: '你受到大于1的伤害时，改为1；失去装备时回复1点体力。' },
  '赤兔': { type: 'equip', subtype: 'horse-1', desc: '你计算与其他角色的距离-1。' },
  '大宛': { type: 'equip', subtype: 'horse-1', desc: '你计算与其他角色的距离-1。' },
  '紫骍': { type: 'equip', subtype: 'horse-1', desc: '你计算与其他角色的距离-1。' },
  '的卢': { type: 'equip', subtype: 'horse+1', desc: '其他角色计算与你的距离+1。' },
  '绝影': { type: 'equip', subtype: 'horse+1', desc: '其他角色计算与你的距离+1。' },
  '爪黄飞电': { type: 'equip', subtype: 'horse+1', desc: '其他角色计算与你的距离+1。' },
  '骅骝': { type: 'equip', subtype: 'horse+1', desc: '其他角色计算与你的距离+1。' },
};

// 按给定牌表精确构建：基本 85 + 锦囊 50 + 装备 25 = 160 张。
// 说明：南蛮标题写“共3张”，按标题采用 ♣7、♠7、♠K；装备分项实列 12 武器 + 6 防具 + 7 坐骑 = 25。
const DECK_LIST = [];
const addCards = (name, suit, ranks) => {
  for (const rank of String(ranks).split(',')) DECK_LIST.push([name, suit, rank.trim()]);
};

// 基本牌 85
addCards('杀', '♦', '6,7,8,9,10,K');
addCards('杀', '♣', '2,3,4,5,6,7,8,8,9,9,10,10,J,J');
addCards('杀', '♥', '10,10,J');
addCards('杀', '♠', '7,8,8,9,9,10,10');
addCards('雷杀', '♣', '5,6,7,8');
addCards('雷杀', '♠', '4,5,6,7,8');
addCards('火杀', '♦', '4,5');
addCards('火杀', '♥', '4,7,10');
addCards('闪', '♦', '2,2,3,4,5,6,6,7,7,8,8,9,10,10,J,J,J');
addCards('闪', '♥', '2,2,8,9,J,Q,K');
addCards('桃', '♦', '2,3,Q');
addCards('桃', '♥', '3,4,5,6,6,7,8,9,Q');
addCards('酒', '♦', '9');
addCards('酒', '♣', '3,9');
addCards('酒', '♠', '3,9');

// 锦囊牌 50
addCards('桃园结义', '♥', 'A');
addCards('万箭齐发', '♥', 'A');
addCards('借刀杀人', '♣', 'Q,K');
addCards('五谷丰登', '♥', '3,4');
addCards('南蛮入侵', '♣', '7');
addCards('南蛮入侵', '♠', '7,K');
addCards('决斗', '♦', 'A');
addCards('决斗', '♣', 'A');
addCards('决斗', '♠', 'A');
addCards('火攻', '♦', 'Q');
addCards('火攻', '♥', '2,3');
addCards('无中生有', '♥', '7,8,9,J');
addCards('顺手牵羊', '♦', '3,4');
addCards('顺手牵羊', '♠', '3,4,J');
addCards('过河拆桥', '♣', '3,4');
addCards('过河拆桥', '♥', 'Q');
addCards('过河拆桥', '♠', '3,4,Q');
addCards('铁索连环', '♣', '10,J,Q,K');
addCards('铁索连环', '♠', 'J,Q');
addCards('无懈可击', '♦', 'Q');
addCards('无懈可击', '♣', 'Q,K');
addCards('无懈可击', '♥', 'A,K');
addCards('无懈可击', '♠', 'J,K');
addCards('闪电', '♥', 'Q');
addCards('闪电', '♠', 'A');
addCards('兵粮寸断', '♣', '4');
addCards('兵粮寸断', '♠', '10');
addCards('乐不思蜀', '♣', '6');
addCards('乐不思蜀', '♥', '6');
addCards('乐不思蜀', '♠', '6');

// 装备牌 25
addCards('诸葛连弩', '♦', 'A');
addCards('诸葛连弩', '♣', 'A');
addCards('青釭剑', '♠', '6');
addCards('寒冰剑', '♠', '2');
addCards('雌雄双股剑', '♠', '2');
addCards('古锭刀', '♠', 'A');
addCards('青龙偃月刀', '♠', '5');
addCards('丈八蛇矛', '♠', 'Q');
addCards('贯石斧', '♦', '5');
addCards('朱雀羽扇', '♦', 'A');
addCards('方天画戟', '♦', 'Q');
addCards('麒麟弓', '♥', '5');
addCards('白银狮子', '♣', 'A');
addCards('仁王盾', '♣', '2');
addCards('藤甲', '♣', '2');
addCards('藤甲', '♠', '2');
addCards('八卦阵', '♣', '2');
addCards('八卦阵', '♠', '2');
addCards('紫骍', '♦', 'K');
addCards('赤兔', '♥', '5');
addCards('大宛', '♠', 'K');
addCards('骅骝', '♦', 'K');
addCards('的卢', '♣', '5');
addCards('爪黄飞电', '♥', 'K');
addCards('绝影', '♠', '5');

const DECK_COUNTS = (() => {
  const map = new Map();
  for (const [name] of DECK_LIST) map.set(name, (map.get(name) || 0) + 1);
  return Array.from(map.entries());
})();

function buildDeck() {
  return DECK_LIST.map(([name, suit, rank], index) => {
    const def = CARD_DEFS[name];
    return {
      id: 'c' + index,
      name,
      suit,
      rank,
      type: def.type,
      kind: def.kind,
      subtype: def.subtype,
      element: def.element,
      range: def.range,
      delay: def.delay,
    };
  });
}

// ============ 武将 ============
// 技能字段：id / name / type(active|trigger|lock|awaken|limited|lord) / desc
const GENERALS = [
  // ---- 蜀 ----
  { id: 'liubei', name: '刘备', faction: 'shu', hp: 4, lord: true, skills: [
    { id: 'rende', name: '仁德', type: 'active', desc: '出牌阶段，你可以将至少一张手牌交给一名本轮未选择过的其他角色，令其获得1枚【仁德】标记；若你给出至少两张，你摸一张牌（每阶段限一次）。' },
    { id: 'zhangwu', name: '章武', type: 'active', desc: '每回合限一次，当你需要使用或打出一张基本牌时，可以移除一名其他角色的1枚【仁德】标记，令其选择：1.视为你虚拟使用或打出之；2.交给你两张手牌。' },
    { id: 'lizhong', name: '励众', type: 'lord', desc: '主公技，蜀势力角色在【章武】的选项中新增一项：代替你使用或打出相同牌名的基本牌，返还1枚【仁德】标记且【章武】视为本回合未发动过。' },
  ]},
  { id: 'guanyu', name: '关羽', faction: 'shu', hp: 4, skills: [
    { id: 'wusheng', name: '武圣', type: 'lock', desc: '你可以将一张红色牌当【杀】使用；你使用的♦【杀】无距离限制。' },
    { id: 'yijue', name: '义绝', type: 'active', desc: '出牌阶段限一次，弃置一张手牌并选择一名其他角色，其选择：1.展示并交给你一张红色手牌，然后你可以令其回复1点体力；2.本回合不能使用或打出红色牌，非锁定技和【义】标记失效，且受到的伤害+1。' },
    { id: 'yishi', name: '义释', type: 'lock', desc: '锁定技，游戏开始时所有其他角色获得【义】标记。当你令有【义】标记的角色进入濒死状态时，其回复1点体力并移除标记；当有【义】标记的角色令你进入濒死状态时，你回复1点体力并移除其标记。' },
  ]},
  { id: 'zhangfei', name: '张飞', faction: 'shu', hp: 4, skills: [
    { id: 'paoxiao', name: '咆哮', type: 'lock', desc: '锁定技，你使用【杀】无次数限制。当你使用的【杀】被【闪】抵消后，你本回合使用的下一张【杀】不可被【闪】响应且伤害+1；若此【杀】未使目标进入濒死状态，你失去1点体力。' },
    { id: 'tishen', name: '替身', type: 'limited', desc: '限定技，回合开始时，你可以回复所有体力并摸X张牌（X为回复的体力值），然后选择至多X名角色，使其本回合非锁定技失效。' },
  ]},
  { id: 'zhugeliang', name: '诸葛亮', faction: 'shu', hp: 3, skills: [
    { id: 'guanxing', name: '观星', type: 'trigger', desc: '准备阶段，你可以观看牌堆顶的5张牌（存活人数小于4时改为3张），将其中任意张以任意顺序置于牌堆顶，其余置于牌堆底。' },
    { id: 'kongcheng', name: '空城', type: 'lock', desc: '锁定技，当你没有手牌时，你不能成为【杀】和【决斗】的目标；你于回合外获得的牌置于武将牌上，回合开始时获得。' },
  ]},
  { id: 'huangyueying', name: '黄月英', faction: 'shu', hp: 3, gender: 'female', skills: [
    { id: 'jizhi', name: '集智', type: 'trigger', desc: '每回合限三次，当你使用一张非转化的锦囊牌时，你可以摸一张牌；若摸到基本牌，你可以弃置之，令本回合【集智】次数+1、手牌上限+1。' },
    { id: 'qicai', name: '奇才', type: 'lock', desc: '锁定技，你使用牌无距离限制；若你的手牌数不小于当前体力值且未装备其他防具，你视为装备【八卦阵】且拥有【看破】。' },
    { id: 'kanpo', name: '看破', type: 'lock', derived: true, acquire: '奇才', desc: '你可以将一张黑色牌当【无懈可击】使用。' },
  ]},
  { id: 'zhaoyun', name: '赵云', faction: 'shu', hp: 4, skills: [
    { id: 'longdan', name: '龙胆', type: 'lock', desc: '你可以将【杀】当【闪】、【闪】当【杀】使用或打出。以此法转化的【杀】被【闪】抵消时，你可以对一名角色造成1点伤害；以此法转化的【闪】抵消【杀】时，你可以令一名其他角色回复1点体力。' },
    { id: 'yajiao', name: '涯角', type: 'trigger', desc: '每回合限一次，当你于回合外使用或打出一张牌时，你可以展示牌堆顶两张牌，将其中一张交给一名角色，另一张置入弃牌堆；若交给你自己，你弃置一张手牌。' },
  ]},
  { id: 'machao', name: '马超', faction: 'shu', hp: 4, skills: [
    { id: 'mashu', name: '马术', type: 'lock', desc: '锁定技，你计算与其他角色的距离-1。' },
    { id: 'tieji', name: '铁骑', type: 'trigger', desc: '当你使用【杀】指定目标时，你可以令其本回合非锁定技失效，然后判定；若其不交给你一张与判定牌花色相同的牌，你可以先弃置其一张装备牌，然后此【杀】不可被【闪】响应，且回合结束时你收回此【杀】。' },
  ]},
  { id: 'ganfuren', name: '甘夫人', faction: 'shu', hp: 3, gender: 'female', skills: [
    { id: 'shushen', name: '淑慎', type: 'trigger', desc: '准备阶段，你可以弃置任意张手牌；若弃置数不小于当前体力值，你回复1点体力，否则你摸等量的牌。' },
    { id: 'shenzhi', name: '神智', type: 'trigger', desc: '当你回复体力或一次失去不小于X张牌时（X为当前体力值），你可以与一名其他角色各摸一张牌。' },
  ]},

  // ---- 魏 ----
  { id: 'caocao', name: '曹操', faction: 'wei', hp: 4, lord: true, skills: [
    { id: 'jianxiong', name: '奸雄', type: 'trigger', desc: '当你受到伤害时，你可以选择一项：1.获得对你造成伤害的牌；2.摸一张牌。' },
    { id: 'huibian', name: '挥鞭', type: 'active', desc: '出牌阶段限一次，你可以令一名角色回复1点体力，然后你对其造成1点伤害。' },
    { id: 'hujia', name: '护驾', type: 'lord', desc: '主公技，每轮限一次，当你即将受到伤害时，你可以将伤害转移给一名其他魏势力角色，然后你可以令其摸两张牌。' },
  ]},
  { id: 'simayi', name: '司马懿', faction: 'wei', hp: 3, skills: [
    { id: 'fankui', name: '反馈', type: 'trigger', desc: '当你受到1点伤害后，你可以获得伤害来源的一张牌，然后判定；伤害来源本回合不能使用或打出与判定牌花色相同的手牌。' },
    { id: 'guicai', name: '鬼才', type: 'trigger', desc: '任意角色判定前，你可以观看牌堆顶X张牌（X为你的当前体力），然后用一张手牌替换其中一张，其余以任意顺序置于牌堆顶。' },
  ]},
  { id: 'xiahoudun', name: '夏侯惇', faction: 'wei', hp: 4, skills: [
    { id: 'ganglie', name: '刚烈', type: 'trigger', desc: '当你受到1点伤害后，你可以令伤害来源或一名距离伤害来源不大于1的角色判定；红色则你对其造成1点伤害，黑色则弃置其一张牌。' },
    { id: 'qingjian', name: '清俭', type: 'trigger', desc: '当你在摸牌阶段外获得牌时，你可以将其中任意张交给其他角色。' },
  ]},
  { id: 'zhangliao', name: '张辽', faction: 'wei', hp: 4, skills: [
    { id: 'tuxi', name: '突袭', type: 'trigger', desc: '每回合限一次，当你不因此技能获得牌时，你可以弃置其中任意张牌，并获得等量的其他角色区域内的一张牌。' },
  ]},
  { id: 'xuchu', name: '许褚', faction: 'wei', hp: 4, skills: [
    { id: 'luoyi', name: '裸衣', type: 'trigger', desc: '摸牌阶段开始时，你可以展示牌堆顶3张牌，获得其中的基本牌、武器牌和【决斗】，若如此做，你放弃摸牌，且直到你的下个回合开始，你为伤害来源的【杀】和【决斗】伤害+1。' },
    { id: 'xiechan', name: '挟缠', type: 'trigger', desc: '每轮限一次，当你受到伤害时，你可以摸两张牌并视为伤害来源对你使用了一张【决斗】。' },
  ]},
  { id: 'guojia', name: '郭嘉', faction: 'wei', hp: 3, skills: [
    { id: 'yingcai', name: '英才', type: 'trigger', desc: '当你的判定牌生效时，你可以标记并获得之；有标记的牌不计入手牌上限，离开手牌时移除标记，可以当【无懈可击】使用。当你成为自己使用牌的目标时，你可以对自己造成1点伤害并判定。' },
    { id: 'yiji', name: '遗计', type: 'trigger', desc: '每当你受到1点伤害时，你可以摸两张牌，然后将两张手牌交给一名角色。' },
  ]},
  { id: 'zhenji', name: '甄姬', faction: 'wei', hp: 3, gender: 'female', skills: [
    { id: 'luoshen', name: '洛神', type: 'trigger', desc: '准备阶段，你可以进行X次判定（X为充能数且至少为1），获得其中黑色判定牌并弃置其余牌，然后获得等同于红色判定牌数量的充能（初始3点，最多7点）。结束阶段，你可以消耗2点充能升级【倾国】。' },
    { id: 'qingguo', name: '倾国', type: 'lock', desc: '你可以将黑色牌当【闪】使用。2级：若此牌为♣，可以交给一名其他角色。3级：该角色直到其回合开始前也可以将其当【闪】使用。' },
  ]},
  { id: 'lejin', name: '乐进', faction: 'wei', hp: 4, skills: [
    { id: 'xiaoguo', name: '骁果', type: 'trigger', desc: '其他角色的结束阶段，你可以弃置一张基本牌，令该角色选择：1.弃置一张装备牌并令你摸一张牌；2.受到你造成的1点伤害。' },
    { id: 'xianjian', name: '陷坚', type: 'trigger', desc: '当你受到伤害时，你可以令伤害来源本回合不能对你使用牌；若如此做，本回合你不能对其发动【骁果】。' },
  ]},

  // ---- 吴 ----
  { id: 'sunquan', name: '孙权', faction: 'wu', hp: 4, lord: true, skills: [
    { id: 'zhiheng', name: '制衡', type: 'active', desc: '出牌阶段限一次，你可以弃置至多X张牌（X为体力上限），然后摸等量的牌。' },
    { id: 'tongye', name: '统业', type: 'trigger', desc: '结束阶段，若你装备区内的牌数量与上个回合结束时相同且不为0，你可以发动一次【制衡】。' },
    { id: 'jiuyuan', name: '救援', type: 'lord', desc: '主公技，每个吴势力角色的回合内限一次，其可以弃置两张牌令你摸一张牌；若其中包含装备牌，你获得其中一张。' },
  ]},
  { id: 'ganning', name: '甘宁', faction: 'wu', hp: 4, skills: [
    { id: 'qixi', name: '奇袭', type: 'active', desc: '出牌阶段限三次，你可以将一张黑色牌当【过河拆桥】使用。黑色锦囊牌转化的【过河拆桥】使用时可摸一张牌；黑色装备牌转化的【过河拆桥】弃置目标最后一张手牌/装备牌时，重置【奋威】。' },
    { id: 'fenwei', name: '奋威', type: 'limited', desc: '限定技，当一张锦囊牌指定多个目标后，你可以令此牌对至多两个目标无效。' },
  ]},
  { id: 'lvmeng', name: '吕蒙', faction: 'wu', hp: 4, skills: [
    { id: 'keji', name: '克己', type: 'lock', desc: '锁定技，弃牌阶段，若你本回合未使用过颜色不同的牌，你摸一张牌且本回合手牌上限+4。' },
    { id: 'qinxue', name: '勤学', type: 'awaken', desc: '觉醒技，准备阶段，若你的手牌数不小于存活角色数，你减1点体力上限，摸两张牌并获得技能【博图】。' },
    { id: 'botu', name: '博图', type: 'trigger', derived: true, acquire: '勤学觉醒', desc: '结束阶段，若你本回合使用过四种花色或三种类别的牌，你获得一个额外回合；此技能不能在额外回合的结束阶段发动。' },
  ]},
  { id: 'huanggai', name: '黄盖', faction: 'wu', hp: 4, skills: [
    { id: 'kurou', name: '苦肉', type: 'active', desc: '出牌阶段限一次，你可以失去1点体力并摸两张牌；若如此做，本回合你可以多使用一张【杀】，你使用的红色【杀】无距离限制且不可被【闪】响应。' },
    { id: 'zhaxiang', name: '诈降', type: 'trigger', desc: '每当你失去1点体力时，你可以展示牌堆顶X张牌（X为已损失体力值），然后使用其中的锦囊牌或装备牌，未使用的牌置入弃牌堆。' },
  ]},
  { id: 'zhouyu', name: '周瑜', faction: 'wu', hp: 3, skills: [
    { id: 'yingzi', name: '英姿', type: 'lock', desc: '锁定技，摸牌阶段你多摸X张牌（X为【间】数且至少为1），手牌上限等于体力上限。出牌阶段开始时，若【间】不少于3，弃置全部【间】并令攻击范围内一名角色失去1点体力。' },
    { id: 'fanjian', name: '反间', type: 'active', desc: '出牌阶段，你可以将一张本回合未扣置过花色的手牌扣置为【间】，令一名其他角色选择猜测花色或失去1点体力；猜对或失去体力则其获得此牌且本回合不能再对其发动；猜错则你保留【间】并对其造成1点伤害。' },
  ]},
  { id: 'daqiao', name: '大乔', faction: 'wu', hp: 3, gender: 'female', skills: [
    { id: 'guose', name: '国色', type: 'active', desc: '出牌阶段各限一次，你可以将一张♦牌当【乐不思蜀】置于一名其他角色判定区，或弃置场上一张【乐不思蜀】并摸一张牌。' },
    { id: 'liuli', name: '流离', type: 'trigger', desc: '每回合限一次，当你成为一张基本牌或非延时锦囊牌的唯一目标时，你可以将目标转移给你攻击范围内的一名其他角色；若此牌为♦，结算后你获得之，否则你弃置一张牌。' },
  ]},
  { id: 'luxun', name: '陆逊', faction: 'wu', hp: 3, skills: [
    { id: 'dushi', name: '度势', type: 'trigger', desc: '出牌阶段开始时，你可以摸两张牌并弃两张牌，然后可以令一名其他角色弃两张牌并摸两张牌。' },
    { id: 'lianying', name: '连营', type: 'active', desc: '出牌阶段限一次，你可以将一张♦牌当火【杀】、一张♥牌当【火攻】使用；若对目标造成伤害，你可以对目标的上家或下家造成1点火焰伤害。' },
  ]},
  { id: 'sunshangxiang', name: '孙尚香', faction: 'wu', hp: 3, gender: 'female', skills: [
    { id: 'jieyin', name: '结姻', type: 'active', desc: '出牌阶段限一次，你可以将一张牌交给一名男性角色，若为装备牌其可使用；然后若你们体力值不等，较小的一方回复1点体力，较大的一方摸两张牌；若体力相等，双方各摸一张牌。' },
    { id: 'xiaoji', name: '枭姬', type: 'trigger', desc: '当你失去装备牌时，你可以摸一张牌；若此时是你的回合外，你额外摸两张牌。' },
  ]},

  // ---- 群 ----
  { id: 'liuxie', name: '刘协', faction: 'qun', hp: 3, lord: true, skills: [
    { id: 'tianming', name: '天命', type: 'lock', desc: '锁定技，一名角色成为【杀】的目标时，你观看其手牌；若该角色是你，你摸一张牌并展示所有手牌。' },
    { id: 'mizhao', name: '密诏', type: 'active', desc: '出牌阶段限一次，你可以将一张手牌交给一名其他角色并指定另一名角色；此阶段结束时，这两名角色拼点，赢的一方视为对没赢的一方使用一张无视防具的【杀】。' },
    { id: 'xiezhi', name: '挟制', type: 'lord', desc: '主公技，当前存活人数最多的势力成为大势力；大势力角色的回合结束时，可以交给你一张手牌并摸一张牌。' },
  ]},
  { id: 'lvbu', name: '吕布', faction: 'qun', hp: 6, skills: [
    { id: 'wushuang', name: '无双', type: 'lock', desc: '锁定技，你使用【杀】指定目标后，其需依次使用两张【闪】才能抵消；你使用【决斗】或成为【决斗】目标后，对方每次响应需依次打出两张【杀】。' },
    { id: 'shenji', name: '神戟', type: 'limited', desc: '限定技，你可以将一张手牌当【决斗】同时对三个目标使用；每以此法造成1点伤害，你摸一张牌。' },
    { id: 'liyu', name: '利驭', type: 'trigger', desc: '当你使用【杀】对一名角色造成伤害时，该角色可以交给你一张装备牌；若如此做，你视为对其指定的一名其他角色使用一张【决斗】。' },
  ]},
  { id: 'diaochan', name: '貂蝉', faction: 'qun', hp: 3, gender: 'female', skills: [
    { id: 'lijian', name: '离间', type: 'active', desc: '出牌阶段限一次，你可以弃置一张牌并选择两名男性角色，视为其中一名对另一名使用一张【决斗】。' },
    { id: 'lihun', name: '离魂', type: 'limited', desc: '限定技，出牌阶段，你可以翻面并获得一名其他角色的全部手牌；出牌阶段结束时依次交还X张牌（X为其当前体力值）。' },
    { id: 'biyue', name: '闭月', type: 'trigger', desc: '结束阶段，你可以摸一张牌。' },
  ]},
  { id: 'huatuo', name: '华佗', faction: 'qun', hp: 3, skills: [
    { id: 'chuli', name: '除疠', type: 'active', desc: '出牌阶段限一次，你可以弃置自己以及至多X名其他角色各一张手牌（X为存活势力数），然后选择一种花色，令因此弃置该花色牌的角色各摸一张。' },
    { id: 'liaodu', name: '疗毒', type: 'trigger', desc: '你的回合外，每回合对每名角色限一次，当一名角色进入濒死状态时，你可以弃置你或其一张手牌；若为红色，视为你对其使用一张【桃】。' },
  ]},
  { id: 'mateng', name: '马腾', faction: 'qun', hp: 4, lord: true, skills: [
    { id: 'mashu', name: '马术', type: 'lock', desc: '锁定技，你计算与其他角色的距离-1。' },
    { id: 'xiongyi', name: '雄异', type: 'limited', desc: '限定技，出牌阶段，你可以摸三张牌并移动你装备区内的一张坐骑牌；获得该坐骑牌的角色获得【雄异】，若其已有则重置使用次数。' },
    { id: 'luannian', name: '乱年', type: 'lord', desc: '主公技，锁定技，你发动【雄异】后回复1点体力；其他群势力角色发动【雄异】后，你摸一张牌。' },
  ]},
  { id: 'huaxiong', name: '华雄', faction: 'qun', hp: 6, maxHp: 8, skills: [
    { id: 'shiyong', name: '恃勇', type: 'lock', desc: '锁定技，当你受到伤害时，若造成伤害的牌不为红色且你未发动过【耀武】，你摸一张牌；若不为黑色且你已发动过【耀武】，伤害来源摸一张牌。' },
    { id: 'yaowu', name: '耀武', type: 'limited', desc: '限定技，出牌阶段开始时，你可以视为使用一张无距离限制的【杀】；若造成伤害，你回复1点体力并可以对一个未选择过的目标重复此流程。' },
  ]},
  { id: 'lijue', name: '李傕&郭汜', faction: 'qun', hp: 4, skills: [
    { id: 'xiongsuan', name: '凶算', type: 'limited', desc: '限定技，出牌阶段，你可以弃置一张手牌，对一名角色（可为自己）造成1点伤害并摸三张牌；若其有发动过的限定技，你选择其中一个，于回合结束时重置并视为未发动过。' },
    { id: 'huoluan', name: '祸乱', type: 'trigger', desc: '弃牌阶段结束时，你可以令攻击范围内一名其他角色选择：1.弃置X张牌（X为你此阶段弃置的手牌数，至多5）；2.受到你造成的1点火焰伤害。' },
  ]},
  { id: 'hejin', name: '何进', faction: 'qun', hp: 4, skills: [
    { id: 'mouzhu', name: '谋诛', type: 'active', desc: '出牌阶段限两次，你可以获得一名其他角色的一张手牌；若其手牌数小于你，你可以令其视为对你使用一张【决斗】。' },
    { id: 'yanhuo', name: '延祸', type: 'lock', desc: '锁定技，你死亡时，所有其他角色弃置X张牌（X为你死亡前的手牌数）；伤害来源失去1点体力。' },
  ]},
];

const GENERAL_MAP = Object.fromEntries(GENERALS.map(g => [g.id, g]));
const LORD_GENERALS = GENERALS.filter(g => g.lord);

module.exports = {
  SUITS, SUIT_NAMES, RANKS, isRed, isBlack,
  CARD_DEFS, DECK_COUNTS, DECK_LIST, buildDeck,
  GENERALS, GENERAL_MAP, LORD_GENERALS,
};
