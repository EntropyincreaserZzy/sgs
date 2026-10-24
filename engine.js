'use strict';

const { buildDeck, GENERAL_MAP, isRed, isBlack, SUITS } = require('./data');
const { TRIGGERS, ACTIVE } = require('./skills');

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const THINK_MS = 30000;
const IDENT_NAMES = { lord: '主公', loyal: '忠臣', rebel: '反贼', spy: '内奸' };
const ELEMENT_NAMES = { fire: '火焰', thunder: '雷电' };

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class Game {
  constructor(room, seats, mode) {
    this.room = room;
    this.mode = mode;
    this.players = seats.map((s, i) => {
      const g = GENERAL_MAP[s.generalId];
      return {
        id: s.id, name: s.name, seat: i, isBot: s.isBot, connected: true,
        accountId: s.accountId || null,
        identity: s.identity, general: g,
        hp: g.hp, maxHp: g.maxHp || g.hp,
        hand: [], equip: { weapon: null, armor: null, horsePlus: null, horseMinus: null },
        judge: [], alive: true, marks: {}, flags: {}, used: {},
        limitedUsed: {}, identityRevealed: false,
        charge: 3, qingguoLevel: 1, skills: g.skills.filter(x => !x.derived && (x.type !== 'lord' || s.identity === 'lord')).map(x => x.id),
      };
    });
    const lord = this.players.find(p => p.identity === 'lord');
    lord.maxHp += 1; lord.hp += 1;
    this.deck = shuffle(buildDeck());
    this.discardPile = [];
    this.logs = [];
    this.turnIndex = lord.seat;
    this.turnPlayer = null;
    this.phase = 'init';
    this.pending = null;
    this.reqSeq = 0;
    this._resolver = null;
    this.winner = null;
    this.extraTurn = false;
    this._extra = false;
    this.isExtraTurn = false;
    this.damageDepth = 0;
    this.startedAt = Date.now();
    this.over = false;
    this.playSeq = 0;
    this.lastPlay = null;
    this.tableCard = null;
    this.drawSeq = 0;
    this.lastDraw = null;
  }

  // ---------- 基础 ----------
  log(msg) {
    // 战报统一使用武将名，避免“电脑·XX”与武将名混在一起看不清
    if (this.players) {
      for (const p of this.players) {
        if (p.name && p.general && p.name !== p.general.name) {
          msg = msg.split(p.name).join(p.general.name);
        }
      }
    }
    this.logs.push({ t: Date.now(), msg });
    if (this.logs.length > 300) this.logs.shift();
  }

  broadcast() { if (this.room && this.room.broadcast) this.room.broadcast(); }

  alive() { return this.players.filter(p => p.alive); }

  orderFrom(seat) {
    const out = [];
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[(seat + i) % this.players.length];
      if (p.alive) out.push(p);
    }
    return out;
  }

  nextAlive(seat) {
    for (let i = 1; i <= this.players.length; i++) {
      const p = this.players[(seat + i) % this.players.length];
      if (p.alive) return p.seat;
    }
    return seat;
  }

  distance(a, b) {
    if (a === b) return 0;
    const list = this.players.filter(p => p.alive);
    const ia = list.indexOf(a), ib = list.indexOf(b);
    if (ia < 0 || ib < 0) return 99;
    let d = Math.min(Math.abs(ia - ib), list.length - Math.abs(ia - ib));
    if (b.equip.horsePlus) d += 1;
    if (a.equip.horseMinus) d -= 1;
    if (a.skills.includes('mashu')) d -= 1;
    return Math.max(1, d);
  }

  attackRange(a) {
    const w = a.equip.weapon;
    return w && w.range ? w.range : 1;
  }

  inAttackRange(a, b) { return this.distance(a, b) <= this.attackRange(a); }

  isEnemy(a, b) {
    if (!a || !b || a === b) return false;
    if (a.identity === 'lord' || a.identity === 'loyal') {
      return b.identity === 'rebel' || b.identity === 'spy';
    }
    if (a.identity === 'rebel') return b.identity === 'lord' || b.identity === 'loyal';
    if (a.identity === 'spy') return b.identity === 'lord' || b.identity === 'loyal' || b.identity === 'rebel';
    return false;
  }

  enemies(p) { return this.alive().filter(q => this.isEnemy(p, q)); }
  allies(p) { return this.alive().filter(q => q !== p && !this.isEnemy(p, q)); }

  hasSkill(p, sid) {
    if (!p || !p.skills.includes(sid)) return false;
    const flags = p.flags || {};
    if (flags.disabled) return false;
    if (flags.nonLockDisabled) {
      const def = (p.general.skills || []).find(s => s.id === sid);
      if (!def || def.type !== 'lock') return false;
    }
    return true;
  }

  publicCard(c) {
    if (!c) return null;
    return { id: c.id, name: c.name, suit: c.suit, rank: c.rank, type: c.type, kind: c.kind, subtype: c.subtype, element: c.element, marked: !!c.marked };
  }

  // 跨角色选牌时，手牌必须暗置；装备/判定区牌保持公开
  choiceCard(owner, c) {
    const pub = this.publicCard(c);
    if (owner && owner.hand && owner.hand.some(x => x.id === c.id)) {
      return { id: c.id, hidden: true, name: '手牌', suit: null, rank: null, type: 'hidden', kind: 'hidden' };
    }
    return pub;
  }

  // ---------- 牌堆 ----------
  reshuffle() {
    if (!this.discardPile.length) return;
    this.deck = shuffle(this.discardPile.splice(0));
    this.log('牌堆已洗牌');
  }

  topCard() {
    if (!this.deck.length) this.reshuffle();
    return this.deck.pop();
  }

  draw(p, n) {
    let got = 0;
    const drawn = [];
    for (let i = 0; i < n; i++) {
      const c = this.topCard();
      if (!c) break;
      p.hand.push(c); drawn.push(c); got++;
    }
    if (got) {
      p.flags.lastDrawn = drawn;
      this.lastDraw = { seq: ++this.drawSeq, playerId: p.id, playerName: p.general.name, count: got };
      this.log(`${p.name} 摸 ${got} 张牌`);
    }
    return got;
  }

  async gain(p, cards, from) {
    if (!cards || !cards.length) return;
    for (const c of cards) {
      if (this.hasSkill(p, 'kongcheng') && this.turnPlayer !== p) {
        p.marks.kongcheng = p.marks.kongcheng || [];
        p.marks.kongcheng.push(c);
        this.log(`${p.name} 将【${c.name}】置于武将牌上（空城）`);
      } else {
        p.hand.push(c);
      }
    }
    await this.trigger('gainCards', p, { cards, from });
  }

  removeFromHand(p, card) {
    const i = p.hand.findIndex(c => c.id === card.id);
    if (i >= 0) p.hand.splice(i, 1);
    if (card.marked) card.marked = false;
  }

  toDiscard(card) {
    if (card) this.discardPile.push(card);
  }

  reclaim(card) {
    const i = this.discardPile.findIndex(c => c.id === card.id);
    if (i >= 0) return this.discardPile.splice(i, 1)[0];
    return card;
  }

  discardCards(p, cards, from) {
    const lost = [];
    for (const c of cards) {
      if (!c) continue;
      let found = false;
      const hi = p.hand.findIndex(x => x.id === c.id);
      if (hi >= 0) { p.hand.splice(hi, 1); found = true; }
      for (const k of ['weapon', 'armor', 'horsePlus', 'horseMinus']) {
        if (p.equip[k] && p.equip[k].id === c.id) {
          p.equip[k] = null; found = true;
          if (c.name === '白银狮子') this.heal(p, 1);
          this.trigger('equipLost', p, { card: c });
        }
      }
      const ji = p.judge.findIndex(x => x.id === c.id);
      if (ji >= 0) { p.judge.splice(ji, 1); found = true; }
      if (found) { this.toDiscard(c); lost.push(c); }
    }
    if (lost.length) {
      this.log(`${p.name} 弃置 ${lost.map(c => c.name).join('、')}`);
      this.trigger('loseCards', p, { cards: lost, from });
    }
    return lost;
  }

  allCardsOf(p) {
    const out = [...p.hand];
    for (const k of ['weapon', 'armor', 'horsePlus', 'horseMinus']) if (p.equip[k]) out.push(p.equip[k]);
    out.push(...p.judge);
    return out;
  }

  removeCardFrom(t, card) {
    const hi = t.hand.findIndex(c => c.id === card.id);
    if (hi >= 0) { t.hand.splice(hi, 1); return card; }
    for (const k of ['weapon', 'armor', 'horsePlus', 'horseMinus']) {
      if (t.equip[k] && t.equip[k].id === card.id) {
        const c = t.equip[k];
        t.equip[k] = null;
        if (c.name === '白银狮子') this.heal(t, 1);
        this.trigger('equipLost', t, { card: c });
        return c;
      }
    }
    const ji = t.judge.findIndex(c => c.id === card.id);
    if (ji >= 0) return t.judge.splice(ji, 1)[0];
    return card;
  }

  equipCard(p, card) {
    const slot = card.subtype === 'weapon' ? 'weapon' : card.subtype === 'armor' ? 'armor' : card.subtype === 'horse+1' ? 'horsePlus' : 'horseMinus';
    const old = p.equip[slot];
    if (old) {
      p.equip[slot] = null;
      this.toDiscard(old);
      this.log(`${p.name} 弃置装备【${old.name}】`);
      if (old.name === '白银狮子') this.heal(p, 1);
      this.trigger('equipLost', p, { card: old });
    }
    p.equip[slot] = card;
    this.log(`${p.name} 装备【${card.name}】`);
    this.trigger('equipGain', p, { card });
  }

  // ---------- 询问 ----------
  ask(p, req) {
    if (!p) return Promise.resolve(null);
    req = this.maskHiddenReq(req);
    if (p.isBot || !p.connected) return this.botAnswer(p, req).then(a => this.unmaskHiddenAction(req, a));
    const reqId = ++this.reqSeq;
    return new Promise(resolve => {
      let done = false;
      this.pending = { pid: p.id, reqId, ...req, deadline: Date.now() + THINK_MS };
      this.broadcast();
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        if (this.pending && this.pending.reqId === reqId) this.pending = null;
        const def = this.unmaskHiddenAction(req, this.defaultAnswer(p, req));
        this.broadcast();
        resolve(def);
      }, THINK_MS);
      this._resolver = (action) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(this.unmaskHiddenAction(req, action));
      };
    });
  }

  // 把跨角色手牌的 id 换成随机不透明 id，客户端无法由 id 反推牌面
  maskHiddenReq(req) {
    if (!req || !Array.isArray(req.validCards)) return req;
    const map = {};
    const validCards = req.validCards.map((c, i) => {
      if (c && c.hidden) {
        const oid = 'h' + i + '_' + Math.random().toString(36).slice(2, 7);
        map[oid] = c.id;
        return { ...c, id: oid };
      }
      return c;
    });
    return { ...req, validCards, _hiddenMap: map };
  }

  unmaskHiddenAction(req, action) {
    if (!req || !req._hiddenMap || !action) return action;
    const out = { ...action };
    if (Array.isArray(out.cardIds)) out.cardIds = out.cardIds.map(id => req._hiddenMap[id] || id);
    if (out.cardId && req._hiddenMap[out.cardId]) out.cardId = req._hiddenMap[out.cardId];
    return out;
  }

  defaultAnswer(p, req) {
    switch (req.type) {
      case 'action': return { action: 'end' };
      case 'card': return { cardId: null };
      case 'target': return { targetId: null };
      case 'choice': return { value: req.options && req.options[0] ? (req.options[0].value ?? req.options[0]) : null };
      case 'cards': return { cardIds: (req.validCards || []).slice(0, req.count || 0).map(c => c.id) };
      case 'suit': return { suit: SUITS[Math.floor(Math.random() * 4)] };
      case 'guicai-replace': return { action: 'skip' };
      case 'arrange': {
        const cards = req.cards || [];
        if (req.mode === 'guanxing') return { top: cards.map(c => c.id), bottom: [] };
        return { order: cards.map(c => c.id) };
      }
      default: return {};
    }
  }

  resolveAction(pid, action) {
    if (!this.pending || this.pending.pid !== pid) return false;
    if (action && action.reqId && action.reqId !== this.pending.reqId) return false;
    const res = this._resolver;
    this.pending = null;
    this._resolver = null;
    this.broadcast();
    if (res) res(action || {});
    return true;
  }

  async botAnswer(p, req) {
    await delay(1800 + Math.random() * 400);
    try {
      return await this.botDecide(p, req);
    } catch (e) {
      console.error('bot error', e);
      return this.defaultAnswer(p, req);
    }
  }

  async botDecide(p, req) {
    if (req.type === 'guicai-replace') return { action: 'arrange' };
    if (req.type === 'arrange') {
      const cards = (req.cards || []).slice();
      if (req.mode === 'guanxing') {
        cards.sort((a, b) => this.botCardScore(b) - this.botCardScore(a));
        const topCount = Math.min(2, cards.length);
        return { top: cards.slice(0, topCount).map(c => c.id), bottom: cards.slice(topCount).map(c => c.id) };
      }
      cards.sort((a, b) => this.botJudgmentScore(b, p, req) - this.botJudgmentScore(a, p, req));
      return { order: cards.map(c => c.id) };
    }
    if (req.type === 'action') return this.botAction(p, req);
    if (req.type === 'card') {
      const cards = req.validCards || [];
      if (!cards.length) return { cardId: null };
      if (req.need === '无懈可击') {
        if (Math.random() < 0.35) return { cardId: cards[0].id };
        return { cardId: null };
      }
      if (req.need === '桃') {
        const dying = req.dyingId ? this.players.find(x => x.id === req.dyingId) : null;
        if (dying && (dying === p || !this.isEnemy(p, dying))) return { cardId: cards[0].id };
        return { cardId: null };
      }
      if (req.need === '闪') return { cardId: cards[0].id };
      if (req.need === '杀') {
        const opponent = req.opponentId ? this.players.find(x => x.id === req.opponentId) : null;
        if (opponent && this.isEnemy(p, opponent) && p.hand.length <= 1 && p.hp <= 2) return { cardId: null };
        return { cardId: cards[0].id };
      }
      return { cardId: cards[0].id };
    }
    if (req.type === 'target') {
      const valids = (req.valid || []).map(id => this.players.find(x => x.id === id)).filter(Boolean);
      if (!valids.length) return { targetId: null };
      if (req.harmful === false) {
        const scored = valids.map(t => ({ t, s: (this.isEnemy(p, t) ? 100 : 0) + (t === p ? -50 : 0) + t.hp * 5 })).sort((a, b) => a.s - b.s);
        return { targetId: scored[0].t.id };
      }
      const scored = valids.map(t => ({ t, s: (t.hp * 10) + t.hand.length + (this.isEnemy(p, t) ? -100 : 100) })).sort((a, b) => a.s - b.s);
      return { targetId: scored[0].t.id };
    }
    if (req.type === 'choice') {
      const opts = req.options || [];
      if (!opts.length) return { value: null };
      const o = opts[Math.floor(Math.random() * opts.length)];
      return { value: o.value ?? o };
    }
    if (req.type === 'cards') {
      const cards = (req.validCards || []).slice();
      const n = req.count || 0;
      cards.sort((a, b) => (a.type === 'basic' ? 1 : 0) - (b.type === 'basic' ? 1 : 0));
      return { cardIds: cards.slice(0, n).map(c => c.id) };
    }
    if (req.type === 'suit') return { suit: SUITS[Math.floor(Math.random() * 4)] };
    return {};
  }

  botAction(p, req) {
    const opts = (req.options || []).filter(o => (o.cardId !== undefined || o.action) && o.mode !== 'zhangba');
    const enemyOf = (id) => { const t = this.players.find(x => x.id === id); return t && this.isEnemy(p, t); };
    const enemyTarget = (o) => (o.targets || []).find(enemyOf);
    const tao = opts.find(o => o.as === '桃' && p.hp < p.maxHp);
    if (tao && p.hp <= 2) return { action: 'play', cardId: tao.cardId, as: '桃', targets: [] };
    const equip = opts.find(o => o.type === 'equip');
    if (equip) return { action: 'play', cardId: equip.cardId, as: equip.as, targets: [] };
    const wuzhong = opts.find(o => o.as === '无中生有');
    if (wuzhong) return { action: 'play', cardId: wuzhong.cardId, as: wuzhong.as, targets: [] };
    const wugu = opts.find(o => o.as === '五谷丰登');
    if (wugu && p.hand.length < 3) return { action: 'play', cardId: wugu.cardId, as: '五谷丰登', targets: [] };
    const sha = opts.find(o => o.as === '杀' && enemyTarget(o));
    if (sha && Math.random() < 0.9) { const t = enemyTarget(sha); return { action: 'play', cardId: sha.cardId, as: sha.as, targets: [t] }; }
    for (const kind of ['借刀杀人', '决斗', '火攻', '顺手牵羊', '过河拆桥', '乐不思蜀', '兵粮寸断']) {
      const o = opts.find(x => x.as === kind && enemyTarget(x));
      if (o) { const t = enemyTarget(o); return { action: 'play', cardId: o.cardId, as: o.as, targets: [t] }; }
    }
    const aoe = opts.find(o => o.as === '南蛮入侵' || o.as === '万箭齐发');
    if (aoe && this.enemies(p).length >= this.allies(p).length) return { action: 'play', cardId: aoe.cardId, as: aoe.as, targets: [] };
    const taoyuan = opts.find(o => o.as === '桃园结义');
    if (taoyuan && p.hp < p.maxHp) return { action: 'play', cardId: taoyuan.cardId, as: '桃园结义', targets: [] };
    const skills = req.skills || [];
    if (skills.length && Math.random() < 0.35) {
      return { action: 'skill', skill: skills[Math.floor(Math.random() * skills.length)].id };
    }
    return { action: 'end' };
  }

  botCardScore(c) {
    if (!c) return 0;
    const v = { '桃': 10, '杀': 8, '闪': 8, '无中生有': 9, '五谷丰登': 7, '决斗': 6, '顺手牵羊': 6, '过河拆桥': 6, '酒': 5 };
    if (v[c.name]) return v[c.name];
    if (c.type === 'equip') return 5;
    if (c.type === 'trick') return 4;
    return 3;
  }

  botJudgmentScore(c, guicai, req) {
    const target = this.players.find(x => x.id === req.judgeTargetId);
    const ally = target && !this.isEnemy(guicai, target);
    const red = !!c && (c.suit === '♥' || c.suit === '♦');
    const r = req.reason || '';
    let good = red ? 1 : -1;
    if (r.includes('乐不思蜀')) good = c && c.suit === '♥' ? 1 : -1;
    else if (r.includes('兵粮寸断')) good = c && c.suit === '♣' ? 1 : -1;
    else if (r.includes('闪电')) {
      const n = c ? this.rankNum(c.rank) : 0;
      const hit = c && c.suit === '♠' && n >= 2 && n <= 9;
      good = hit ? -1 : 1;
    } else if (r.includes('八卦')) good = red ? 1 : -1;
    return ally ? good * 10 : -good * 10;
  }

  // ---------- 转化 ----------
  qicaiActive(p) {
    return p.hand.length >= p.hp && !p.equip.armor;
  }

  hasKanpo(p) {
    return !!p && p.general.id === 'huangyueying' && this.hasSkill(p, 'qicai') && this.qicaiActive(p);
  }

  canUseAs(p, card, as, ctx) {
    if (!card) return false;
    if (p.flags.yijue && isRed(card)) return false;
    if (p.flags.fankuiSuit && card.suit === p.flags.fankuiSuit) return false;
    if (as === card.name) return true;
    if (as === '杀') {
      if (card.name === '火杀' || card.name === '雷杀') return true;
      if (this.hasSkill(p, 'wusheng') && isRed(card)) return true;
      if (this.hasSkill(p, 'longdan') && card.kind === 'shan') return true;
    }
    if (as === '闪') {
      if (this.hasSkill(p, 'longdan') && card.kind === 'sha') return true;
      if (this.hasSkill(p, 'qingguo') && isBlack(card)) return true;
      if (card._qingguoOwner === p.id && isBlack(card)) return true;
    }
    if (as === '过河拆桥' && this.hasSkill(p, 'qixi') && isBlack(card)) return (p.used.qixi || 0) < 3;
    if (as === '乐不思蜀' && this.hasSkill(p, 'guose') && card.suit === '♦') return !p.used.guose;
    if (as === '火杀' && this.hasSkill(p, 'lianying') && card.suit === '♦') return !p.used.lianying;
    if (as === '火攻' && this.hasSkill(p, 'lianying') && card.suit === '♥') return !p.used.lianying;
    if (as === '无懈可击') {
      if (this.hasKanpo(p) && isBlack(card)) return true;
      if (this.hasSkill(p, 'yingcai') && card.marked) return true;
    }
    if (as === '火杀' && card.kind === 'sha' && p.equip.weapon && p.equip.weapon.name === '朱雀羽扇') return true;
    return false;
  }

  isSha(as) { return as === '杀' || as === '火杀' || as === '雷杀'; }

  // ---------- 可用牌 ----------
  getPlayOptions(p) {
    const opts = [];
    const usedSha = p.used.sha || 0;
    const unlimited = p.skills.includes('paoxiao') || (p.equip.weapon && p.equip.weapon.name === '诸葛连弩') || (p.flags.extraSha || 0) > 0;
    for (const card of p.hand) {
      const asList = [card.name];
      for (const as of ['杀', '闪', '过河拆桥', '乐不思蜀', '火杀', '火攻', '无懈可击']) {
        if (as !== card.name && this.canUseAs(p, card, as)) asList.push(as);
      }
      for (const as of asList) {
        if (as === '闪' || as === '无懈可击') continue;
        if (this.isSha(as)) {
          if (!unlimited && usedSha >= 1) continue;
        }
        if (as === '桃' && p.hp >= p.maxHp) continue;
        if (as === '酒' && p.hp >= p.maxHp) { /* 酒可留，允许 */ }
        const targetMode = this.targetMode(as);
        let targets = targetMode === 'none' ? [] : this.validTargets(p, as, card).map(t => t.id);
        if (targetMode === 'self') targets = [p.id];
        if ((targetMode === 'single' || targetMode === 'multi') && targets.length === 0 && as !== '铁索连环') continue;
        let maxTargets = 1;
        if (as === '铁索连环') maxTargets = 2;
        if (this.isSha(as) && p.equip.weapon && p.equip.weapon.name === '方天画戟' && p.hand.length === 1) maxTargets = 3;
        opts.push({
          cardId: card.id, as, name: as,
          type: card.type, element: card.element, suit: card.suit, rank: card.rank,
          targetMode, targets, minTargets: targetMode === 'multi' ? 0 : (targetMode === 'none' || targetMode === 'self' ? 0 : 1),
          maxTargets,
        });
      }
    }
    // 丈八蛇矛：两张手牌当【杀】
    if (p.equip.weapon && p.equip.weapon.name === '丈八蛇矛' && p.hand.length >= 2 && (unlimited || usedSha < 1)) {
      const targets = this.validTargets(p, '杀', p.hand[0]).map(t => t.id);
      if (targets.length) {
        opts.push({
          mode: 'zhangba', cardId: null, as: '杀', name: '丈八蛇矛', type: 'weapon',
          targetMode: 'single', targets, minTargets: 1, maxTargets: 1, extra: true,
        });
      }
    }
    return opts;
  }

  targetMode(as) {
    if (['杀', '火杀', '雷杀', '顺手牵羊', '过河拆桥', '借刀杀人', '决斗', '火攻', '乐不思蜀', '兵粮寸断'].includes(as)) return 'single';
    if (as === '铁索连环') return 'multi';
    if (['桃', '酒'].includes(as)) return 'self';
    return 'none';
  }

  validTargets(p, as, card) {
    const all = this.alive().filter(t => t !== p && p.flags.xianjian !== t.id);
    const noDist = p.skills.includes('qicai') || (p.flags.kurouRed && card && isRed(card));
    if (this.isSha(as)) {
      const free = noDist || (p.skills.includes('wusheng') && card && card.suit === '♦');
      return all.filter(t => {
        if (t.skills.includes('kongcheng') && t.hand.length === 0) return false;
        return free || this.inAttackRange(p, t);
      });
    }
    if (as === '顺手牵羊') return all.filter(t => (noDist || this.distance(p, t) <= 1) && this.allCardsOf(t).length);
    if (as === '过河拆桥') return all.filter(t => this.allCardsOf(t).length);
    if (as === '决斗') return all.filter(t => !(t.skills.includes('kongcheng') && t.hand.length === 0));
    if (as === '借刀杀人') return all.filter(t => !!t.equip.weapon);
    if (as === '火攻') return all.filter(t => t.hand.length > 0);
    if (as === '乐不思蜀') return all.filter(t => !t.judge.some(c => c.kind === 'le'));
    if (as === '兵粮寸断') return all.filter(t => !t.judge.some(c => c.kind === 'bingliang'));
    if (as === '铁索连环') return this.alive().filter(t => p.flags.xianjian !== t.id);
    return [];
  }

  getActiveSkills(p) {
    const out = [];
    for (const sid of p.skills) {
      if (!this.hasSkill(p, sid)) continue;
      const a = ACTIVE[sid];
      if (!a) continue;
      try { if (a.canUse(this, p)) out.push({ id: sid, name: (p.general.skills.find(s => s.id === sid) || {}).name || sid, desc: (p.general.skills.find(s => s.id === sid) || {}).desc || '' }); } catch (e) {}
    }
    return out;
  }

  async useActive(p, sid, act) {
    const a = ACTIVE[sid];
    if (!a || !this.hasSkill(p, sid) || !a.canUse(this, p)) return;
    this.log(`${p.name} 发动【${(p.general.skills.find(s => s.id === sid) || {}).name || sid}】`);
    await a.use(this, p, act || {});
  }

  // ---------- 响应询问 ----------
  async askCard(p, need, prompt, opts = {}) {
    if (!p || !p.alive) return null;
    const valid = [];
    if (need === '任意') {
      valid.push(...p.hand);
    } else {
      for (const c of p.hand) {
        if (this.canUseAs(p, c, need, { response: true })) valid.push(c);
      }
      if (need === '桃' && opts.dying && opts.dying.hp <= 0) {
        for (const c of p.hand) if (c.name === '酒' && !valid.includes(c)) valid.push(c);
      }
    }
    if (!valid.length) return null;
    const req = {
      type: 'card', need, prompt,
      validCards: valid.map(c => this.publicCard(c)),
      optional: !!opts.optional, dyingId: opts.dying ? opts.dying.id : null,
      opponentId: opts.opponentId || null,
    };
    const ans = await this.ask(p, req);
    if (!ans || !ans.cardId) return null;
    const card = p.hand.find(c => c.id === ans.cardId);
    if (!card) return null;
    this.removeFromHand(p, card);
    this.lastPlay = {
      seq: ++this.playSeq,
      playerId: p.id, playerName: p.name,
      card: this.publicCard(card),
      as: need === '任意' ? card.name : need,
      equip: false,
      targets: opts.opponentId ? [opts.opponentId] : [],
    };
    if (!opts.raw) {
      this.toDiscard(card);
      this.log(`${p.name} 打出【${card.name}】${card.name !== need ? `（当【${need}】）` : ''}`);
      await this.trigger('cardUsed', p, { card, as: need });
    }
    return card;
  }

  async askTarget(p, valid, prompt, opts = {}) {
    if (!valid.length) return null;
    const ans = await this.ask(p, { type: 'target', prompt, valid: valid.map(t => t.id), optional: !!opts.optional, harmful: opts.harmful !== false });
    if (!ans || !ans.targetId) return null;
    return this.players.find(t => t.id === ans.targetId && valid.includes(t)) || null;
  }

  async askChoice(p, options, prompt) {
    const ans = await this.ask(p, { type: 'choice', prompt, options });
    if (!ans) return null;
    return ans.value;
  }

  async askCards(p, count, prompt, opts = {}) {
    const valid = opts.validCards || p.hand;
    if (valid.length < count) count = valid.length;
    if (count <= 0) return [];
    if (valid.length === p.hand.length && count === p.hand.length) return p.hand.slice();
    const ans = await this.ask(p, {
      type: 'cards', prompt, count,
      validCards: valid.map(c => this.publicCard(c)),
      optional: !!opts.optional,
    });
    if (!ans || !ans.cardIds) return [];
    return ans.cardIds.map(id => p.hand.find(c => c.id === id)).filter(Boolean);
  }

  async askSuit(p, prompt) {
    const ans = await this.ask(p, { type: 'suit', prompt, options: SUITS });
    return ans && ans.suit ? ans.suit : SUITS[Math.floor(Math.random() * 4)];
  }

  // ---------- 伤害 / 回复 / 濒死 ----------
  async damage(target, amount, source, card, element) {
    if (!target || !target.alive || this.winner) return;
    if (this.damageDepth > 8) return;
    this.damageDepth++;
    try {
      const ctx = { amount, source, card, element, prevent: false, transfer: null };
      await this.trigger('beforeDamage', target, ctx);
      if (ctx.prevent) { this.log(`${target.name} 防止了伤害`); return; }
      if (ctx.transfer) target = ctx.transfer;
      if (!target.alive) return;
      amount = ctx.amount;
      if (target.flags.yijue) amount += 1;
      if (target.equip.armor && target.equip.armor.name === '白银狮子' && amount > 1) amount = 1;
      if (element === 'fire' && target.equip.armor && target.equip.armor.name === '藤甲') amount += 1;
      const wasChained = !!target.flags.chained;
      if (wasChained) target.flags.chained = false;
      target.hp -= amount;
      this.log(`${target.name} 受到 ${amount} 点${element ? ELEMENT_NAMES[element] : ''}伤害（来源：${source ? source.name : '无'}）`);
      this.broadcast();
      await this.trigger('damaged', target, { source, card, amount, element });
      if (source && source.alive) await this.trigger('damageDealt', source, { target, card, amount, element });
      if (target.hp <= 0) await this.dying(target, source);
      if (element && wasChained) {
        const others = this.alive().filter(q => q.flags.chained);
        for (const q of others) {
          q.flags.chained = false;
          this.log(`铁索传导至 ${q.name}`);
          await this.damage(q, amount, source, card, element);
        }
      }
    } finally {
      this.damageDepth--;
    }
  }

  async heal(p, n, source) {
    if (!p || !p.alive && p.hp > 0) return;
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + n);
    if (p.hp !== before) {
      this.log(`${p.name} 回复 ${p.hp - before} 点体力`);
      await this.trigger('heal', p, { amount: p.hp - before, source });
    }
  }

  async loseHp(p, n, source) {
    if (!p || !p.alive) return;
    p.hp -= n;
    this.log(`${p.name} 失去 ${n} 点体力`);
    await this.trigger('loseHp', p, { amount: n, source });
    if (p.hp <= 0) await this.dying(p, source);
  }

  async dying(p, source) {
    if (this.winner || !p.alive) return;
    this.log(`【${p.name}】濒死！`);
    if (source && source.skills.includes('yishi') && p.marks.yi) {
      p.hp += 1; delete p.marks.yi;
      this.log(`义释：${p.name} 回复1点体力（若仍未脱离濒死则继续求桃）`);
    }
    if (p.skills.includes('yishi') && source && source.marks.yi) {
      p.hp += 1; delete source.marks.yi;
      this.log(`义释：${p.name} 回复1点体力`);
    }
    await this.triggerAll('dying', { player: p, source });
    const order = this.orderFrom(p.seat);
    let idx = 0;
    while (p.hp <= 0 && idx < order.length) {
      const q = order[idx];
      if (!q.alive) { idx++; continue; }
      const card = await this.askCard(q, '桃', `${p.name} 濒死，是否使用【桃】？`, { optional: true, dying: p });
      if (card) {
        p.hp += 1;
        this.log(`${q.name} 使用【${card.name}】救 ${p.name}`);
        await this.trigger('heal', p, { amount: 1, source: q });
      } else {
        idx++;
      }
    }
    if (p.hp <= 0) await this.die(p, source);
  }

  async die(p, source) {
    if (!p.alive) return;
    const handCount = p.hand.length;
    p.alive = false;
    p.identityRevealed = true;
    this.log(`【${p.name}】阵亡，身份：${IDENT_NAMES[p.identity]}`);
    await this.trigger('death', p, { source, handCount });
    // 弃置所有牌
    const all = this.allCardsOf(p);
    p.hand = []; p.judge = []; p.equip = { weapon: null, armor: null, horsePlus: null, horseMinus: null };
    for (const c of all) this.toDiscard(c);
    this.checkWin();
    this.broadcast();
  }

  checkWin() {
    if (this.winner) return;
    const lord = this.players.find(p => p.identity === 'lord');
    const alive = this.alive();
    if (!lord.alive) {
      if (alive.length === 1 && alive[0].identity === 'spy') this.winner = 'spy';
      else this.winner = 'rebel';
    } else if (alive.every(p => p.identity === 'lord' || p.identity === 'loyal')) {
      this.winner = 'lord';
    }
    if (this.winner) {
      this.over = true;
      this.log(`游戏结束：${this.winner === 'lord' ? '主忠胜' : this.winner === 'rebel' ? '反贼胜' : '内奸胜'}`);
      if (this.room && this.room.onGameOver) this.room.onGameOver(this.winner);
    }
  }

  // ---------- 判定 ----------
  async judge(p, reason) {
    // 鬼才：判定前观看牌堆顶 X 张，可先换一张手牌，再调整顺序
    const guicai = this.alive().find(q => q.skills.includes('guicai'));
    if (guicai) {
      const x = Math.max(1, guicai.maxHp);
      const top = [];
      for (let i = 0; i < x; i++) { const c = this.topCard(); if (c) top.push(c); }
      if (top.length) {
        const replace = await this.ask(guicai, {
          type: 'guicai-replace',
          cards: top.map(c => this.publicCard(c)),
          hand: guicai.hand.map(c => this.publicCard(c)),
          prompt: `鬼才：观看牌堆顶 ${top.length} 张（仅你可见）。先选一张牌堆顶的牌和一张手牌替换，或直接调整顺序。`,
          reason,
          judgeTargetId: p.id,
        });
        if (replace && replace.action === 'replace' && replace.topIndex != null && replace.handCardId) {
          const old = top[replace.topIndex];
          const handCard = guicai.hand.find(c => c.id === replace.handCardId);
          if (old && handCard) {
            this.removeFromHand(guicai, handCard);
            this.toDiscard(old);
            top[replace.topIndex] = handCard;
            this.log(`${guicai.name} 发动【鬼才】替换一张判定牌`);
          }
        }
        if (replace && replace.action !== 'skip') {
          const arr = await this.ask(guicai, {
            type: 'arrange',
            mode: 'guicai',
            cards: top.map(c => this.publicCard(c)),
            prompt: '鬼才：拖动调整牌堆顶顺序，第一张为本次判定牌',
            reason,
          });
          let order = top.slice();
          if (arr && Array.isArray(arr.order) && arr.order.length === top.length && new Set(arr.order).size === arr.order.length) {
            const mapped = arr.order.map(id => top.find(c => c.id === id)).filter(Boolean);
            if (mapped.length === top.length) order = mapped;
          }
          for (let i = order.length - 1; i >= 0; i--) this.deck.push(order[i]);
          this.log(`${guicai.name} 发动【鬼才】调整牌堆顶顺序`);
        } else {
          for (let i = top.length - 1; i >= 0; i--) this.deck.push(top[i]);
        }
      }
    }
    const card = this.topCard();
    if (!card) return { card: null, gained: false };
    this.log(`判定（${reason}）：${card.suit}${card.rank}【${card.name}】`);
    // 英才
    let gained = false;
    if (this.hasSkill(p, 'yingcai')) {
      const yes = await this.askChoice(p, [{ value: 'yes', label: '获得判定牌' }, { value: 'no', label: '不获得' }], '是否发动【英才】获得判定牌？');
      if (yes === 'yes') { card.marked = true; p.hand.push(card); gained = true; this.log(`${p.name} 获得判定牌【${card.name}】`); }
    }
    if (!gained) this.toDiscard(card);
    return { card, gained };
  }

  // ---------- 出牌 ----------
  async playCard(p, cardId, targets = [], as, extraCardId) {
    const card = p.hand.find(c => c.id === cardId);
    if (!card) return false;
    as = as || card.name;
    const zhangba = as === '杀' && !!extraCardId && p.equip.weapon && p.equip.weapon.name === '丈八蛇矛';
    if (!zhangba && !this.canUseAs(p, card, as, { targets })) return false;
    if (this.isSha(as)) {
      const used = p.used.sha || 0;
      const unlimited = p.skills.includes('paoxiao') || (p.equip.weapon && p.equip.weapon.name === '诸葛连弩') || (p.flags.extraSha || 0) > 0;
      if (!unlimited && used >= 1) return false;
      p.used.sha = used + 1;
      if (p.flags.extraSha > 0) p.flags.extraSha--;
    }
    if (as === '过河拆桥' && card.name !== '过河拆桥' && p.skills.includes('qixi')) p.used.qixi = (p.used.qixi || 0) + 1;
    if (as === '乐不思蜀' && card.name !== '乐不思蜀' && p.skills.includes('guose')) p.used.guose = 1;
    if ((as === '火杀' || as === '火攻') && p.skills.includes('lianying') && card.name !== as) p.used.lianying = 1;
    let usedCards = [card];
    if (extraCardId) {
      const c2 = p.hand.find(c => c.id === extraCardId && c.id !== cardId);
      if (c2) usedCards.push(c2);
      else if (zhangba) return false;
    }
    const targetObjs = targets.map(id => this.players.find(t => t.id === id)).filter(t => t && t.alive);
    for (const c of usedCards) this.removeFromHand(p, c);
    this.log(`${p.name} 使用 ${usedCards.map(c => `【${c.name}】`).join('+')}${as !== card.name ? `（当【${as}】）` : ''}${targetObjs.length ? ' → ' + targetObjs.map(t => t.name).join('、') : ''}`);
    this.lastPlay = {
      seq: ++this.playSeq,
      playerId: p.id, playerName: p.general.name,
      card: this.publicCard(card),
      as,
      equip: card.type === 'equip' && as === card.name,
      targets: targetObjs.map(t => t.id),
    };
    this.tableCard = {
      seq: this.lastPlay.seq,
      playerId: p.id,
      sourceName: p.general.name,
      targetNames: targetObjs.map(t => t.general.name),
      card: this.publicCard(card),
      as,
      equip: card.type === 'equip' && as === card.name,
    };
    this.broadcast();
    p.flags.lastColor = card.suit === '♥' || card.suit === '♦' ? 'red' : 'black';
    p.used.suits = p.used.suits || new Set();
    p.used.suits.add(card.suit);
    p.used.categories = p.used.categories || new Set();
    p.used.categories.add(card.type);
    if (this.hasSkill(p, 'yingcai') && targetObjs.includes(p)) {
      const yes = await this.askChoice(p, [{ value: 'yes', label: '发动英才' }, { value: 'no', label: '不发动' }], '【英才】：是否对自己造成1点伤害并判定？');
      if (yes === 'yes') {
        await this.damage(p, 1, p, { name: '英才' });
        if (p.alive) await this.judge(p, '英才');
      }
    }
    await this.trigger('useCard', p, { card, as, targets: targetObjs, cards: usedCards });
    await this.useCard(p, card, as, targetObjs, usedCards);
    for (const c of usedCards) {
      if (c._claimed) continue;
      if (c._liuliGain) {
        const owner = this.players.find(q => q.id === c._liuliGain);
        if (owner && owner.alive) {
          await this.gain(owner, [c], 'liuli');
          this.log(`【流离】：${owner.name} 获得【${c.name}】`);
          continue;
        }
      }
      if (!(c.type === 'equip' && as === c.name)) this.toDiscard(c);
    }
    this.tableCard = null;
    this.broadcast();
    return true;
  }

  async fenweiSkip(cardUser, as) {
    const skip = new Set();
    if (!['五谷丰登', '桃园结义', '南蛮入侵', '万箭齐发'].includes(as)) return skip;
    for (const q of this.alive()) {
      if (!q.skills.includes('fenwei') || q.limitedUsed.fenwei) continue;
      const yes = await this.askChoice(q, [{ value: 'yes', label: '发动奋威' }, { value: 'no', label: '不发动' }], `是否发动【奋威】令【${as}】对至多两名角色无效？`);
      if (yes !== 'yes') continue;
      q.limitedUsed.fenwei = true;
      const base = (as === '南蛮入侵' || as === '万箭齐发')
        ? this.alive().filter(x => x !== cardUser)
        : this.alive();
      const chosen = [];
      for (let i = 0; i < 2; i++) {
        const valid = base.filter(x => !chosen.includes(x));
        if (!valid.length) break;
        const t = await this.askTarget(q, valid, `奋威：选择第 ${i + 1} 个无效目标（可取消）`, { optional: true, harmful: false });
        if (!t) break;
        chosen.push(t);
      }
      for (const t of chosen) skip.add(t.id);
      this.log(`${q.name} 奋威：令 ${chosen.map(x => x.name).join('、') || '0'} 个目标无效`);
    }
    return skip;
  }

  async useCard(p, card, as, targets, usedCards) {
    // 装备
    if (card.type === 'equip' && as === card.name && targets.length === 0) {
      this.equipCard(p, card);
      return;
    }
    if (as === '闪' || as === '无懈可击') return;
    const trickAs = ['无中生有', '顺手牵羊', '过河拆桥', '借刀杀人', '决斗', '南蛮入侵', '万箭齐发', '桃园结义', '五谷丰登', '乐不思蜀', '兵粮寸断', '闪电', '火攻', '铁索连环'];
    if (trickAs.includes(as)) {
      if (await this.wuxieWindow(p, card, targets)) return;
    }
    if (as === '桃') { await this.heal(p, 1); return; }
    if (as === '酒') {
      if (p.phase === 'dying') { await this.heal(p, 1); return; }
      p.flags.jiu = true; this.log(`${p.name} 使用【酒】，下一张【杀】伤害+1`); return;
    }
    if (as === '无中生有') { this.draw(p, 2); return; }
    if (as === '桃园结义') {
      const skip = await this.fenweiSkip(p, as);
      for (const q of this.alive()) if (!skip.has(q.id)) await this.heal(q, 1);
      return;
    }
    if (as === '五谷丰登') {
      const skip = await this.fenweiSkip(p, as);
      const n = this.alive().length;
      const cards = [];
      for (let i = 0; i < n; i++) { const c = this.topCard(); if (c) cards.push(c); }
      this.log(`五谷丰登亮出：${cards.map(c => c.suit + c.rank + c.name).join('、')}`);
      for (const q of this.orderFrom(p.seat)) {
        if (skip.has(q.id)) continue;
        if (!cards.length) break;
        const ans = await this.ask(q, { type: 'cards', prompt: '五谷丰登：选择一张', count: 1, validCards: cards.map(c => this.publicCard(c)), optional: false });
        let pick = cards[0];
        if (ans && ans.cardIds && ans.cardIds[0]) pick = cards.find(c => c.id === ans.cardIds[0]) || cards[0];
        cards.splice(cards.indexOf(pick), 1);
        await this.gain(q, [pick], 'wugu');
      }
      for (const c of cards) this.toDiscard(c);
      return;
    }
    if (as === '南蛮入侵' || as === '万箭齐发') {
      const need = as === '南蛮入侵' ? '杀' : '闪';
      const skip = await this.fenweiSkip(p, as);
      for (const q of this.orderFrom(p.seat)) {
        if (q === p || !q.alive || skip.has(q.id)) continue;
        if (q.equip.armor && q.equip.armor.name === '藤甲') { this.log(`${q.name} 的【藤甲】免疫【${as}】`); continue; }
        const c = await this.askCard(q, need, `${p.name} 使用【${as}】，请打出【${need}】`, { optional: true, opponentId: p.id });
        if (!c) await this.damage(q, 1, p, card);
      }
      return;
    }
    if (as === '决斗') {
      let t = targets[0];
      if (t) t = await this.liuliTarget(p, t, card, as, targets);
      if (t) await this.resolveDuel(p, t, card);
      return;
    }
    if (as === '借刀杀人') {
      let t = targets[0];
      if (!t) return;
      t = await this.liuliTarget(p, t, card, as, targets);
      if (!t || !t.equip.weapon) return;
      const weapon = t.equip.weapon;
      const victims = this.alive().filter(q => q !== t && this.inAttackRange(t, q));
      const giveWeapon = async () => {
        this.removeCardFrom(t, weapon);
        await this.gain(p, [weapon], 'jiedao');
        this.log(`【借刀杀人】：${t.name} 未使用【杀】，${p.name} 获得【${weapon.name}】`);
      };
      if (!victims.length) { await giveWeapon(); return; }
      const victim = await this.askTarget(p, victims, '借刀杀人：令其使用【杀】的目标（可取消）', { optional: true, harmful: true });
      if (!victim) { await giveWeapon(); return; }
      const c = await this.askCard(t, '杀', `${p.name} 借刀杀人：对 ${victim.name} 使用一张【杀】`, { optional: true, opponentId: victim.id });
      if (c) await this.resolveSha(t, c, '杀', [victim]);
      else await giveWeapon();
      return;
    }
    if (as === '顺手牵羊' || as === '过河拆桥') {
      let t = targets[0];
      if (!t) return;
      t = await this.liuliTarget(p, t, card, as, targets);
      if (!t) return;
      const cards = this.allCardsOf(t);
      if (!cards.length) return;
      const ans = await this.ask(p, { type: 'cards', prompt: `选择 ${t.name} 的一张牌`, count: 1, validCards: cards.map(c => this.choiceCard(t, c)) });
      let pick = cards[0];
      if (ans && ans.cardIds && ans.cardIds[0]) pick = cards.find(c => c.id === ans.cardIds[0]) || cards[0];
      this.removeCardFrom(t, pick);
      if (as === '顺手牵羊') {
        await this.gain(p, [pick], 'shunshou');
      } else {
        this.toDiscard(pick);
        if (this.hasSkill(p, 'qixi')) {
          const srcCard = usedCards && usedCards[0];
          const black = srcCard && isBlack(srcCard);
          if (black && srcCard.type === 'trick') {
            this.draw(p, 1);
            this.log(`【奇袭】：黑色锦囊转化的【过河拆桥】摸一张牌`);
          }
          const wasLast = t.hand.length === 0 && !t.equip.weapon && !t.equip.armor && !t.equip.horsePlus && !t.equip.horseMinus;
          if (wasLast && black && srcCard.type === 'equip') {
            p.limitedUsed.fenwei = false;
            this.log(`【奇袭】：弃置最后一张手牌/装备牌，重置【奋威】`);
          }
        }
      }
      return;
    }
    if (as === '乐不思蜀' || as === '兵粮寸断' || as === '闪电') {
      const t = targets[0] || p;
      const delayCard = { ...card, id: card.id + '_d' + Math.random().toString(36).slice(2, 6), kind: as === '乐不思蜀' ? 'le' : as === '兵粮寸断' ? 'bingliang' : 'shandian', _from: p.id };
      t.judge.push(delayCard);
      this.log(`【${as}】置于 ${t.name} 的判定区`);
      return;
    }
    if (as === '火攻') {
      let t = targets[0];
      if (!t) return;
      t = await this.liuliTarget(p, t, card, as, targets);
      if (!t) return;
      if (!t.hand.length) return;
      const ans = await this.ask(t, { type: 'cards', prompt: '火攻：展示一张手牌', count: 1, validCards: t.hand.map(c => this.publicCard(c)) });
      let show = t.hand[0];
      if (ans && ans.cardIds && ans.cardIds[0]) show = t.hand.find(c => c.id === ans.cardIds[0]) || show;
      this.log(`${t.name} 展示【${show.name}】(${show.suit})`);
      const same = p.hand.filter(c => c.suit === show.suit);
      if (same.length) {
        const pick = await this.ask(p, { type: 'cards', prompt: `是否弃置一张${show.suit}牌造成火焰伤害？`, count: 1, validCards: same.map(c => this.publicCard(c)), optional: true });
        if (pick && pick.cardIds && pick.cardIds[0]) {
          const c = p.hand.find(x => x.id === pick.cardIds[0]);
          if (c) { this.removeFromHand(p, c); this.toDiscard(c); await this.damage(t, 1, p, card, 'fire'); }
        }
      }
      return;
    }
    if (as === '铁索连环') {
      const ts = [];
      for (const t0 of targets.slice(0, 2)) {
        const t = await this.liuliTarget(p, t0, card, as, targets);
        if (t) ts.push(t);
      }
      for (const t of ts) { t.flags.chained = !t.flags.chained; this.log(`${t.name} ${t.flags.chained ? '横置' : '重置'}`); }
      return;
    }
    if (this.isSha(as)) {
      await this.resolveSha(p, card, as, targets);
      return;
    }
  }

  async wuxieWindow(user, card, targets) {
    let negated = false;
    let depth = 0;
    while (depth < 20) {
      let played = null;
      for (const q of this.orderFrom(user.seat)) {
        if (!q.alive || q === user) continue;
        const has = q.hand.some(c => this.canUseAs(q, c, '无懈可击')) || (this.hasSkill(q, 'yingcai') && q.hand.some(c => c.marked));
        if (!has) continue;
        const prompt = depth === 0
          ? `是否对【${card.name}】使用【无懈可击】？`
          : '是否使用【无懈可击】抵消上一张【无懈可击】？';
        const c = await this.askCard(q, '无懈可击', prompt, { optional: true, opponentId: user.id });
        if (c) { played = { q, c }; break; }
      }
      if (!played) break;
      negated = !negated;
      depth++;
      this.log(`【无懈可击】${negated ? '抵消' : '反抵消'}了【${card.name}】`);
      if (played.q.general.id === 'huangyueying' && played.c && played.c.name !== '无懈可击' && isBlack(played.c)) {
        this.log('【看破】：此【无懈可击】不可被其他角色的【无懈可击】响应');
        break;
      }
    }
    return negated;
  }

  async askShan(t, source, card) {
    const ignoreArmor = !!(card && card.ignoreArmor) || !!(source.equip.weapon && source.equip.weapon.name === '青釭剑');
    // 八卦阵 / 奇才虚拟八卦
    const bagua = !ignoreArmor && ((t.equip.armor && t.equip.armor.name === '八卦阵') || (t.skills.includes('qicai') && this.qicaiActive(t)));
    if (bagua) {
      const yes = await this.askChoice(t, [{ value: 'yes', label: '发动八卦阵' }, { value: 'no', label: '不发动' }], '是否发动【八卦阵】？');
      if (yes === 'yes') {
        const j = await this.judge(t, '八卦阵');
        if (j.card && isRed(j.card)) { this.log(`${t.name} 的【八卦阵】判定为红色，视为打出【闪】`); return true; }
      }
    }
    const c = await this.askCard(t, '闪', `请打出【闪】抵消【${card.name}】`, { optional: true, opponentId: source.id });
    if (c && t.general.id === 'zhenji' && t.qingguoLevel >= 2 && c.suit === '♣' && this.hasSkill(t, 'qingguo')) {
      const others = this.alive().filter(q => q !== t);
      const giveTo = await this.askTarget(t, others, '倾国：是否将这张♣牌交给一名角色？', { optional: true, harmful: false });
      if (giveTo) {
        const card = this.reclaim(c);
        if (t.qingguoLevel >= 3) card._qingguoOwner = giveTo.id;
        await this.gain(giveTo, [card], 'qingguo');
        this.log(`倾国：${t.name} 将【${card.name}】交给 ${giveTo.name}`);
      }
    }
    if (c && t.skills.includes('longdan') && c.kind === 'sha') {
      const valid = this.alive().filter(q => q !== t);
      const target = await this.askTarget(t, valid, '龙胆：令一名其他角色回复1点体力', { optional: true, harmful: false });
      if (target) await this.heal(target, 1);
    }
    return !!c;
  }

  async liuliTarget(user, target, card, as, allTargets) {
    if (!target || !target.alive) return target;
    const ctx = { source: user, card, as, targets: allTargets || [target] };
    await this.trigger('targeted', target, ctx);
    if (ctx.redirect && ctx.redirect.alive) {
      this.log(`【流离】：${target.name} 将目标转移给 ${ctx.redirect.name}`);
      return ctx.redirect;
    }
    return target;
  }

  async resolveSha(user, card, as, targets) {
    for (let t of targets) {
      if (!t.alive) continue;
      const tctx = { source: user, card, as, targets };
      await this.trigger('targeted', t, tctx);
      if (tctx.redirect && tctx.redirect.alive) {
        this.log(`${t.name} 将目标转移给 ${tctx.redirect.name}`);
        t = tctx.redirect;
      }
      const element = as === '火杀' ? 'fire' : as === '雷杀' ? 'thunder' : card.element;
      const ignoreArmor = !!(card && card.ignoreArmor) || !!(user.equip.weapon && user.equip.weapon.name === '青釭剑');
      // 仁王盾
      if (t.equip.armor && t.equip.armor.name === '仁王盾' && isBlack(card) && !ignoreArmor) {
        this.log(`${t.name} 的【仁王盾】使黑色【杀】无效`); continue;
      }
      // 藤甲
      if (t.equip.armor && t.equip.armor.name === '藤甲' && !element && !ignoreArmor) {
        this.log(`${t.name} 的【藤甲】使普通【杀】无效`); continue;
      }
      const pao = !!user.flags.paoxiaoBuff;
      if (pao) user.flags.paoxiaoBuff = false;
      const kurouFree = !!(user.flags.kurouRed && isRed(card));
      // 雌雄双股剑：指定异性目标时摸一张
      if (user.equip.weapon && user.equip.weapon.name === '雌雄双股剑') {
        const uf = user.general.gender === 'female';
        const tf = t.general.gender === 'female';
        if (uf !== tf) {
          const yes = await this.askChoice(user, [{ value: 'yes', label: '发动雌雄双股剑' }, { value: 'no', label: '不发动' }], `是否发动【雌雄双股剑】对 ${t.general.name} 摸一张牌？`);
          if (yes === 'yes') { this.draw(user, 1); this.log(`【雌雄双股剑】：${user.general.name} 摸一张牌`); }
        }
      }
      // 铁骑
      if (this.hasSkill(user, 'tieji')) {
        const yes = await this.askChoice(user, [{ value: 'yes', label: '发动铁骑' }, { value: 'no', label: '不发动' }], '是否发动【铁骑】？');
        if (yes === 'yes') {
          t.flags.tieji = true;
          t.flags.nonLockDisabled = true;
          user.marks.tiejiReturn = user.marks.tiejiReturn || [];
          if (!user.marks.tiejiReturn.includes(card.id)) user.marks.tiejiReturn.push(card.id);
          const j = await this.judge(user, '铁骑');
          const jc = j.card;
          const pay = t.hand.find(c => c.suit === jc.suit);
          if (pay) {
            const give = await this.askChoice(t, [{ value: 'yes', label: `交给 ${user.name} 一张${jc.suit}牌` }, { value: 'no', label: '不交' }], `铁骑：是否交给 ${user.name} 一张${jc.suit}牌？`);
            if (give === 'yes') { this.removeFromHand(t, pay); await this.gain(user, [pay], 'tieji'); }
            else t.flags.undodgeable = true;
          } else t.flags.undodgeable = true;
        }
      }
      const need = user.skills.includes('wushuang') ? 2 : 1;
      let dodged = true;
      if (!t.flags.undodgeable && !pao && !kurouFree) {
        for (let i = 0; i < need; i++) {
          const ok = await this.askShan(t, user, card);
          if (!ok) { dodged = false; break; }
        }
      } else {
        dodged = false;
        if (t.flags.undodgeable) this.log(`【铁骑】：此【杀】不可被【闪】响应`);
        else if (pao) this.log(`【咆哮】：此【杀】不可被【闪】响应且伤害+1`);
        else this.log(`【苦肉】：红色【杀】不可被【闪】响应`);
      }
      if (dodged) {
        this.log(`${t.name} 抵消了【${as}】`);
        await this.trigger('shaDodged', user, { target: t, card });
        // 青龙偃月刀 / 贯石斧
        if (user.equip.weapon && user.equip.weapon.name === '青龙偃月刀') {
          const yes = await this.askChoice(user, [{ value: 'yes', label: '发动青龙偃月刀' }, { value: 'no', label: '不发动' }], '是否再使用一张【杀】？');
          if (yes === 'yes') {
            const c = await this.askCard(user, '杀', '选择一张【杀】', { optional: true });
            if (c) await this.resolveSha(user, c, '杀', [t]);
          }
        }
        if (user.equip.weapon && user.equip.weapon.name === '贯石斧' && user.hand.length >= 2) {
          const yes = await this.askChoice(user, [{ value: 'yes', label: '弃两张牌强制命中' }, { value: 'no', label: '不发动' }], '是否发动【贯石斧】？');
          if (yes === 'yes') {
            const cs = await this.askCards(user, 2, '弃置两张牌');
            this.discardCards(user, cs);
            await this.damage(t, 1 + (user.flags.jiu ? 1 : 0), user, card, element);
            user.flags.jiu = false;
          }
        }
        continue;
      }
      // 命中
      let dmg = 1;
      if (pao) dmg++;
      if (user.flags.jiu) { dmg++; user.flags.jiu = false; }
      if (user.equip.weapon && user.equip.weapon.name === '古锭刀' && t.hand.length === 0) dmg++;
      if (user.skills.includes('luoyi') && user.flags.luoyi) dmg++;
      if (user.equip.weapon && user.equip.weapon.name === '寒冰剑') {
        const yes = await this.askChoice(user, [{ value: 'yes', label: '发动寒冰剑' }, { value: 'no', label: '不发动' }], '是否发动【寒冰剑】？');
        if (yes === 'yes') { this.discardCards(t, this.allCardsOf(t).slice(0, 2)); continue; }
      }
      if (user.equip.weapon && user.equip.weapon.name === '麒麟弓' && (t.equip.horsePlus || t.equip.horseMinus)) {
        const yes = await this.askChoice(user, [{ value: 'yes', label: '发动麒麟弓' }, { value: 'no', label: '不发动' }], '是否弃置目标坐骑？');
        if (yes === 'yes') { this.discardCards(t, [t.equip.horsePlus || t.equip.horseMinus]); }
      }
      await this.damage(t, dmg, user, card, element);
      if (pao && t.alive) {
        this.log(`${user.name} 咆哮未击杀，失去1点体力`);
        await this.loseHp(user, 1);
      }
      if (user.skills.includes('lianying') && card.suit === '♦' && t.alive) {
        const order = this.orderFrom(t.seat);
        const neighbors = [order[1], order[order.length - 1]].filter(q => q && q !== user && q !== t);
        const t2 = await this.askTarget(user, neighbors, '连营：对目标的上家或下家造成1点火焰伤害', { optional: true });
        if (t2) await this.damage(t2, 1, user, card, 'fire');
      }
      // 利驭
      if (user.skills.includes('liyu') && t.alive) {
        const eq = t.hand.filter(c => c.type === 'equip');
        if (eq.length) {
          const yes = await this.askChoice(t, [{ value: 'yes', label: `交给 ${user.name} 一张装备牌` }, { value: 'no', label: '不交' }], '是否发动【利驭】？');
          if (yes === 'yes') {
            const c = eq[0];
            this.removeFromHand(t, c); await this.gain(user, [c], 'liyu');
            const other = await this.askTarget(t, this.alive().filter(x => x !== t && x !== user), '选择一名角色成为【决斗】目标', { harmful: true });
            if (other) await this.resolveDuel(user, other, card);
          }
        }
      }
    }
  }

  async resolveDuel(source, target, card) {
    let cur = target, other = source;
    while (cur.alive && other.alive) {
      const need = other.skills.includes('wushuang') ? 2 : 1;
      let ok = true;
      for (let i = 0; i < need; i++) {
        const c = await this.askCard(cur, '杀', `【决斗】：请打出【杀】`, { optional: true, opponentId: other.id });
        if (!c) { ok = false; break; }
      }
      if (!ok) { await this.damage(cur, 1, other, card); break; }
      [cur, other] = [other, cur];
    }
  }

  // ---------- 触发 ----------
  async trigger(event, p, ctx) {
    if (!p) return;
    for (const sid of p.skills) {
      if (!this.hasSkill(p, sid)) continue;
      const h = TRIGGERS[sid] && TRIGGERS[sid][event];
      if (h) {
        try { await h(this, p, ctx || {}); } catch (e) { console.error('skill error', sid, event, e); }
      }
    }
  }

  async triggerAll(event, ctx, filter) {
    for (const p of this.players.slice()) {
      if (!p.alive) continue;
      if (filter && !filter(p)) continue;
      await this.trigger(event, p, ctx);
    }
  }

  // ---------- 回合 ----------
  async start() {
    this.log('=== 游戏开始 ===');
    this.log(`${this.players.find(p => p.identity === 'lord').name} 是主公（体力上限+1）`);
    for (const p of this.players) await this.trigger('gameStart', p, {});
    for (const p of this.players) this.draw(p, 4);
    this.phase = 'swap';
    this.swapped = new Set();
    this.swapEnds = Date.now() + 5000;
    this.broadcast();
    await delay(5000);
    this.phase = 'start';
    this.broadcast();
    await this.run();
  }

  swap(pid) {
    if (this.phase !== 'swap') return false;
    const p = this.players.find(x => x.id === pid);
    if (!p || this.swapped.has(pid)) return false;
    const n = p.hand.length;
    for (const c of p.hand) this.deck.push(c);
    p.hand = [];
    shuffle(this.deck);
    this.draw(p, n);
    this.swapped.add(pid);
    this.log(`${p.name} 换牌`);
    this.broadcast();
    return true;
  }

  async run() {
    let guard = 0;
    while (!this.winner) {
      if (++guard > 300) { this.log('对局回合数异常，强制结束'); this.winner = this.winner || 'lord'; break; }
      if (!this.alive().length) { this.winner = this.winner || 'lord'; break; }
      const p = this.players[this.turnIndex];
      if (!p.alive) { this.turnIndex = this.nextAlive(this.turnIndex); await new Promise(r => setImmediate(r)); continue; }
      this.isExtraTurn = this._extra;
      await this.takeTurn(p);
      if (this.winner) break;
      if (this.extraTurn && !this.isExtraTurn) {
        this.extraTurn = false;
        this._extra = true;
        continue;
      }
      this._extra = false;
      this.turnIndex = this.nextAlive(this.turnIndex);
    }
    this.over = true;
    this.phase = 'over';
    this.broadcast();
  }

  async jiuyuan(p) {
    if (!p || !p.alive || p.hand.length < 2) return;
    const lord = this.players.find(q => q.alive && q.identity === 'lord' && q.general.id === 'sunquan' && this.hasSkill(q, 'jiuyuan'));
    if (!lord || p === lord || p.general.faction !== 'wu') return;
    const yes = await this.askChoice(p, [{ value: 'yes', label: '发动救援' }, { value: 'no', label: '不发动' }], `是否发动【救援】：弃置两张牌令 ${lord.general.name} 摸一张牌？`);
    if (yes !== 'yes') return;
    const cs = await this.askCards(p, 2, '救援：弃置两张牌');
    if (cs.length < 2) return;
    const equip = cs.find(c => c.type === 'equip');
    for (const c of cs) this.removeFromHand(p, c);
    if (equip) await this.gain(lord, [equip], 'jiuyuan');
    for (const c of cs) if (c !== equip) this.toDiscard(c);
    this.draw(lord, 1);
    this.log(`【救援】：${p.general.name} 弃置两张牌，${lord.general.name} 摸一张牌${equip ? `并获得【${equip.name}】` : ''}`);
  }

  async takeTurn(p) {
    this.turnPlayer = p;
    for (const c of p.hand) if (c._qingguoOwner === p.id) delete c._qingguoOwner;
    if (p.flags && p.flags.flipped) {
      delete p.flags.flipped;
      this.log(`${p.general.name} 翻面，跳过本回合`);
      this.broadcast();
      return;
    }
    const chained = !!p.flags.chained;
    p.flags = {};
    if (chained) p.flags.chained = true;
    p.used = {};
    this.log(`—— ${p.name} 的回合${this.isExtraTurn ? '（额外）' : ''} ——`);
    this.phase = 'start'; this.broadcast();
    await this.trigger('turnStart', p, {});
    if (this.winner || !p.alive) { this.cleanupTurnFlags(); this.broadcast(); return; }
    this.phase = 'judge'; this.broadcast();
    await this.judgePhase(p);
    if (this.winner || !p.alive) { this.cleanupTurnFlags(); this.broadcast(); return; }
    this.phase = 'draw'; this.broadcast();
    await this.drawPhase(p);
    if (this.winner || !p.alive) { this.cleanupTurnFlags(); this.broadcast(); return; }
    this.phase = 'play'; this.broadcast();
    await this.trigger('playStart', p, {});
    await this.jiuyuan(p);
    if (!p.flags.skipPlay) await this.playPhase(p);
    else this.log(`${p.name} 跳过出牌阶段`);
    await this.trigger('playEnd', p, {});
    if (this.winner || !p.alive) { this.cleanupTurnFlags(); this.broadcast(); return; }
    this.phase = 'discard'; this.broadcast();
    await this.discardPhase(p);
    if (!p.alive) { this.cleanupTurnFlags(); this.broadcast(); return; }
    this.phase = 'end'; this.broadcast();
    await this.trigger('turnEnd', p, {});
    await this.triggerAll('otherTurnEnd', { player: p }, q => q !== p);
    this.cleanupTurnFlags();
    this.broadcast();
  }

  cleanupTurnFlags() {
    for (const q of this.players) {
      delete q.flags.yijue; delete q.flags.fankuiSuit; delete q.flags.undodgeable;
      delete q.flags.tieji; delete q.flags.kurouRed; delete q.flags.paoxiaoBuff;
      delete q.flags.disabled; delete q.flags.nonLockDisabled; delete q.flags.xianjian; delete q.flags.xianjianSource; delete q.flags.jiu;
      delete q.flags.extraSha; delete q.flags.handLimitBonus;
    }
  }

  async judgePhase(p) {
    const cards = p.judge.slice();
    p.judge = [];
    for (const card of cards) {
      const cardUser = this.players.find(q => q.id === card._from) || p;
      const negated = await this.wuxieWindow(cardUser, card, [p]);
      if (negated) {
        this.log(`【无懈可击】抵消了【${card.name}】`);
        this.toDiscard(card);
        continue;
      }
      const { card: j } = await this.judge(p, card.name);
      if (!j) { this.toDiscard(card); continue; }
      if (card.kind === 'le') {
        if (j.suit !== '♥') { p.flags.skipPlay = true; this.log(`【乐不思蜀】生效，${p.name} 跳过出牌阶段`); }
        else this.log(`【乐不思蜀】判定为红桃，失效`);
        this.toDiscard(card);
      } else if (card.kind === 'bingliang') {
        if (j.suit !== '♣') { p.flags.skipDraw = true; this.log(`【兵粮寸断】生效，${p.name} 跳过摸牌阶段`); }
        else this.log(`【兵粮寸断】判定为梅花，失效`);
        this.toDiscard(card);
      } else if (card.kind === 'shandian') {
        const num = this.rankNum(j.rank);
        if (j.suit === '♠' && num >= 2 && num <= 9) {
          this.log(`【闪电】命中！`);
          this.toDiscard(card);
          await this.damage(p, 3, null, card, 'thunder');
        } else {
          const next = this.players[this.nextAlive(p.seat)];
          next.judge.push(card);
          this.log(`【闪电】移至 ${next.name} 的判定区`);
        }
      } else {
        this.toDiscard(card);
      }
    }
  }

  rankNum(r) {
    if (r === 'A') return 1;
    if (r === 'J') return 11;
    if (r === 'Q') return 12;
    if (r === 'K') return 13;
    return parseInt(r, 10) || 0;
  }

  async drawPhase(p) {
    if (p.flags.skipDraw) { this.log(`${p.name} 跳过摸牌阶段`); return; }
    const ctx = { n: 2, skip: false };
    await this.trigger('drawPhase', p, ctx);
    if (!ctx.skip) this.draw(p, ctx.n);
    await this.trigger('afterDraw', p, {});
    this.broadcast();
  }

  async playPhase(p) {
    while (!this.winner) {
      if (!p.alive) break;
      const options = this.getPlayOptions(p);
      const skills = this.getActiveSkills(p);
      const ans = await this.ask(p, {
        type: 'action', prompt: '出牌阶段，请选择要使用的牌或技能',
        options, skills, canEnd: true,
      });
      if (!ans || ans.action === 'end') break;
      if (ans.action === 'play') {
        await this.playCard(p, ans.cardId, ans.targets || [], ans.as, ans.extraCardId);
      } else if (ans.action === 'skill') {
        await this.useActive(p, ans.skill, ans);
      }
      this.broadcast();
    }
  }

  async discardPhase(p) {
    let limit = p.hp + (p.flags.handLimitBonus || 0) + p.hand.filter(c => c.marked).length;
    const ctx = { limit };
    await this.trigger('discardLimit', p, ctx);
    limit = ctx.limit;
    p.flags.discardedCount = 0;
    if (p.hand.length > limit) {
      const n = p.hand.length - limit;
      const cards = await this.askCards(p, n, `请弃置 ${n} 张手牌`);
      const lost = this.discardCards(p, cards);
      p.flags.discardedCount = lost.length;
    }
    await this.trigger('discardEnd', p, { count: p.flags.discardedCount || 0 });
  }

  // ---------- 状态 ----------
  publicEquip(p) {
    const out = {};
    for (const k of ['weapon', 'armor', 'horsePlus', 'horseMinus']) out[k] = this.publicCard(p.equip[k]);
    return out;
  }

  pendingView(p) {
    if (!this.pending) return null;
    const r = this.pending;
    const base = { reqId: r.reqId, type: r.type, prompt: r.prompt, need: r.need, optional: r.optional, deadline: r.deadline };
    if (r.type === 'action') return { ...base, options: r.options, skills: r.skills, canEnd: r.canEnd };
    if (r.type === 'card') return { ...base, validCards: r.validCards };
    if (r.type === 'target') return { ...base, valid: r.valid };
    if (r.type === 'choice') return { ...base, options: r.options };
    if (r.type === 'cards') return { ...base, count: r.count, validCards: r.validCards };
    if (r.type === 'suit') return { ...base, options: r.options };
    if (r.type === 'guicai-replace') return { ...base, cards: r.cards, hand: r.hand, reason: r.reason, judgeTargetId: r.judgeTargetId };
    if (r.type === 'arrange') return { ...base, mode: r.mode, cards: r.cards, reason: r.reason };
    return base;
  }

  skillList(p) {
    if (!p || !p.general) return [];
    const canAct = !!this.pending && this.pending.pid === p.id && this.pending.type === 'action'
      && this.phase === 'play' && this.turnPlayer === p;
    const activeNow = canAct ? new Set(this.getActiveSkills(p).map(x => x.id)) : new Set();
    const out = [];
    for (const s of p.general.skills) {
      const own = p.skills.includes(s.id);
      const conditionalKanpo = s.id === 'kanpo' && p.general.id === 'huangyueying';
      if (!own && !conditionalKanpo) continue;
      out.push({
        id: s.id, name: s.name, type: s.type, desc: s.desc,
        special: !!s.derived,
        acquire: s.acquire || '',
        active: s.id === 'kanpo' ? this.qicaiActive(p) : true,
        usable: activeNow.has(s.id),
      });
    }
    return out;
  }

  getState(pid) {
    const you = this.players.find(p => p.id === pid);
    return {
      mode: this.mode,
      phase: this.phase,
      turn: this.turnPlayer ? this.turnPlayer.id : null,
      turnName: this.turnPlayer ? this.turnPlayer.name : '',
      swapEnds: this.swapEnds || 0,
      players: this.players.map(p => ({
        id: p.id, name: p.name, seat: p.seat, isBot: p.isBot, connected: p.connected,
        alive: p.alive, hp: p.hp, maxHp: p.maxHp, handCount: p.hand.length,
        flipped: !!p.flags.flipped,
        general: { id: p.general.id, name: p.general.name, faction: p.general.faction, hp: p.general.hp },
        identity: (p.identity === 'lord' || p.identityRevealed || p.id === pid) ? p.identity : null,
        equip: this.publicEquip(p),
        judge: p.judge.map(c => this.publicCard(c)),
        marks: {
          rende: p.marks.rende || 0,
          yi: p.marks.yi ? 1 : 0,
          jian: (p.marks.jian || []).length,
          kongcheng: (p.marks.kongcheng || []).length,
        },
        skills: p.skills,
        charge: p.general.id === 'zhenji' ? p.charge : undefined,
        qingguoLevel: p.general.id === 'zhenji' ? p.qingguoLevel : undefined,
        chained: !!p.flags.chained,
      })),
      you: you ? {
        id: you.id, hand: you.hand.map(c => this.publicCard(c)),
        equip: this.publicEquip(you), skills: you.skills, marks: you.marks,
        identity: you.identity, alive: you.alive,
        skillList: this.skillList(you),
        playOptions: this.phase === 'play' && this.turnPlayer === you ? this.getPlayOptions(you) : [],
        activeSkills: this.phase === 'play' && this.turnPlayer === you ? this.getActiveSkills(you) : [],
        canSwap: this.phase === 'swap' && !this.swapped.has(you.id),
      } : null,
      pending: this.pending && this.pending.pid === pid ? this.pendingView(you) : null,
      logs: this.logs.slice(-80),
      deckCount: this.deck.length,
      discardCount: this.discardPile.length,
      discardTop: this.discardPile.length ? this.publicCard(this.discardPile[this.discardPile.length - 1]) : null,
      winner: this.winner,
      lastPlay: this.lastPlay,
      lastDraw: this.lastDraw,
      tableCard: this.tableCard,
      identities: this.winner ? this.players.map(p => ({ id: p.id, identity: p.identity })) : null,
      allHands: this.winner ? this.players.map(p => ({ id: p.id, hand: p.hand.map(c => this.publicCard(c)) })) : null,
    };
  }
}

module.exports = { Game, IDENT_NAMES, delay };
