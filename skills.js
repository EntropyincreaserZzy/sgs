'use strict';

const { isRed, isBlack } = require('./data');

// 说明：部分复杂技能做了简化（观星、鬼才、反间、拼点、流离、离魂、无懈链等），
// 但都保留了核心收益，保证 32 名武将都能实际参与对局。

const yesNo = (g, p, prompt) => g.askChoice(p, [{ value: 'yes', label: '发动' }, { value: 'no', label: '不发动' }], prompt);

async function pickFrom(g, chooser, owner, prompt, n = 1) {
  const ans = await g.ask(chooser, {
    type: 'cards', prompt, count: n,
    validCards: owner.hand.map(c => g.choiceCard(owner, c)),
  });
  const ids = (ans && ans.cardIds) || [];
  return ids.map(id => owner.hand.find(c => c.id === id)).filter(Boolean);
}

function colorOf(c) { return c && (c.suit === '♥' || c.suit === '♦') ? 'red' : 'black'; }

async function doZhiheng(g, p) {
  if (!p.hand.length) return;
  const max = Math.min(p.hand.length, p.maxHp);
  const n = await g.askChoice(p, Array.from({ length: max + 1 }, (_, i) => ({ value: i, label: `弃置 ${i} 张` })), '制衡：弃置几张？');
  if (!n) return;
  const cs = await g.askCards(p, n, '制衡：选择弃置的牌');
  if (!cs.length) return;
  g.discardCards(p, cs);
  g.draw(p, cs.length);
}

async function doGuanxing(g, p, extra = false) {
  const n = g.alive().length < 4 ? 3 : 5;
  const cards = [];
  for (let i = 0; i < n; i++) { const c = g.topCard(); if (c) cards.push(c); }
  if (!cards.length) return;
  const ans = await g.ask(p, {
    type: 'arrange', mode: 'guanxing',
    cards: cards.map(c => g.publicCard(c)),
    prompt: `观星：观看牌堆顶 ${cards.length} 张（仅你可见），拖动调整顺序；置于牌堆底的牌会放到牌堆底部。`,
  });
  const topIds = (ans && Array.isArray(ans.top)) ? ans.top : cards.map(c => c.id);
  const bottomIds = (ans && Array.isArray(ans.bottom)) ? ans.bottom : [];
  const top = [], bottom = [], seen = new Set();
  for (const id of topIds) {
    if (seen.has(id)) continue;
    const c = cards.find(x => x.id === id);
    if (c) { seen.add(id); top.push(c); }
  }
  for (const id of bottomIds) {
    if (seen.has(id)) continue;
    const c = cards.find(x => x.id === id);
    if (c) { seen.add(id); bottom.push(c); }
  }
  for (const c of cards) if (!seen.has(c.id)) { seen.add(c.id); bottom.push(c); }
  for (let i = top.length - 1; i >= 0; i--) g.deck.push(top[i]);
  g.deck = bottom.slice().reverse().concat(g.deck);
  if (bottom.length === cards.length && !extra) p.flags.guanxingAgain = true;
  g.log(`${p.name} 观星：${top.length} 张置顶，${bottom.length} 张置底`);
}

async function doTuxi(g, p, gained) {
  if (p.used.tuxi) return;
  const usable = (gained || []).filter(c => p.hand.includes(c));
  if (!usable.length) return;
  if (!(await yesNo(g, p, `是否发动【突袭】？可从刚获得的 ${usable.length} 张牌中弃置任意张，并获得等量其他角色区域内的牌`))) return;
  const opts = [];
  for (let i = 0; i <= usable.length; i++) opts.push({ value: String(i), label: i === 0 ? '不弃置' : `弃置 ${i} 张` });
  const nAns = await g.askChoice(p, opts, '突袭：弃置几张刚获得的牌？');
  const n = Math.max(0, Math.min(usable.length, parseInt(nAns, 10) || 0));
  if (!n) return;
  p.used.tuxi = true;
  const chosen = n >= usable.length
    ? usable.slice()
    : await g.askCards(p, n, '突袭：选择要弃置的获得牌', { validCards: usable });
  if (chosen.length < n) return;
  for (const c of chosen) { g.removeFromHand(p, c); g.toDiscard(c); }
  let got = 0;
  for (let i = 0; i < n; i++) {
    const valid = g.alive().filter(q => q !== p && g.allCardsOf(q).length);
    if (!valid.length) break;
    const t = await g.askTarget(p, valid, `突袭：选择获得第 ${i + 1} 张牌的角色`, { harmful: false });
    if (!t) break;
    const cards = g.allCardsOf(t);
    const ans = await g.ask(p, { type: 'cards', prompt: `突袭：获得 ${t.name} 一张牌`, count: 1, validCards: cards.map(c => g.choiceCard(t, c)) });
    const pick = (ans && ans.cardIds && ans.cardIds[0]) ? cards.find(c => c.id === ans.cardIds[0]) : cards[0];
    if (pick) { g.removeCardFrom(t, pick); await g.gain(p, [pick], 'tuxi'); got++; }
  }
  g.log(`${p.name} 突袭：弃置 ${n} 张刚获得的牌，获得 ${got} 张其他角色的牌`);
}

const TRIGGERS = {
  // ================= 蜀 =================
  rende: { turnStart: (g, p) => { p.marks.rendeTargets = []; } },
  zhangwu: {},
  lizhong: {},
  yishi: {
    gameStart: (g, p) => { for (const q of g.players) if (q !== p) q.marks.yi = 1; },
  },
  paoxiao: {
    shaDodged: (g, p) => { p.flags.paoxiaoBuff = true; g.log(`${p.name} 的下一张【杀】不可被闪避且伤害+1`); },
  },
  tishen: {
    turnStart: async (g, p) => {
      if (p.limitedUsed.tishen) return;
      if (p.isBot && p.hp > 2) return;
      if (!(await yesNo(g, p, '是否发动【替身】？'))) return;
      p.limitedUsed.tishen = true;
      const healed = p.maxHp - p.hp;
      p.hp = p.maxHp;
      g.draw(p, Math.max(0, healed));
      const targets = g.enemies(p).slice(0, Math.max(0, healed));
      for (const t of targets) t.flags.disabled = true;
      g.log(`${p.name} 发动替身，回复 ${healed} 点体力，封印 ${targets.map(t => t.name).join('、') || '0'} 人`);
    },
  },
  guanxing: {
    turnStart: async (g, p) => {
      if (await yesNo(g, p, '是否发动【观星】？')) await doGuanxing(g, p);
    },
    turnEnd: async (g, p) => {
      if (!p.flags.guanxingAgain) return;
      delete p.flags.guanxingAgain;
      if (await yesNo(g, p, '观星：是否再次发动【观星】？')) await doGuanxing(g, p, true);
    },
  },
  kongcheng: {
    turnStart: async (g, p) => {
      if (p.marks.kongcheng && p.marks.kongcheng.length) {
        const cs = p.marks.kongcheng.splice(0);
        p.hand.push(...cs);
        g.log(`${p.name} 获得空城牌 ${cs.length} 张`);
      }
    },
  },
  jizhi: {
    useCard: async (g, p, ctx) => {
      if (ctx.card.type !== 'trick' || ctx.card.name !== ctx.as) return;
      if ((p.used.jizhi || 0) >= 3) return;
      p.used.jizhi = (p.used.jizhi || 0) + 1;
      g.draw(p, 1);
      const last = p.hand[p.hand.length - 1];
      if (last && last.type === 'basic') {
        if (await yesNo(g, p, `是否弃置刚摸到的【${last.name}】令集智次数+1、手牌上限+1？`)) {
          g.removeFromHand(p, last); g.toDiscard(last);
          p.used.jizhi = Math.max(0, p.used.jizhi - 1);
          p.flags.handLimitBonus = (p.flags.handLimitBonus || 0) + 1;
        }
      }
    },
  },
  qicai: {},
  kanpo: {},
  longdan: {
    shaDodged: async (g, p, ctx) => {
      if (!ctx.card || ctx.card.kind !== 'shan') return;
      const valid = g.alive().filter(q => q !== p);
      const t = await g.askTarget(p, valid, '龙胆：对一名角色造成1点伤害', { optional: true });
      if (t) await g.damage(t, 1, p, ctx.card);
    },
  },
  yajiao: {
    cardUsed: async (g, p, ctx) => {
      if (g.turnPlayer === p || p.used.yajiao) return;
      p.used.yajiao = true;
      const c1 = g.topCard(), c2 = g.topCard();
      const cards = [c1, c2].filter(Boolean);
      if (!cards.length) return;
      const t = await g.askTarget(p, g.alive(), '涯角：将一张牌交给一名角色', { optional: true });
      if (t) {
        let give = cards[0];
        if (cards.length > 1) {
          const ans = await g.ask(p, { type: 'cards', prompt: '涯角：选择交给的牌', count: 1, validCards: cards.map(c => g.publicCard(c)) });
          if (ans && ans.cardIds && ans.cardIds[0]) give = cards.find(c => c.id === ans.cardIds[0]) || give;
        }
        cards.splice(cards.indexOf(give), 1);
        await g.gain(t, [give], 'yajiao');
        for (const c of cards) g.toDiscard(c);
        g.log(`涯角：${p.name} 将【${give.name}】交给 ${t.name}`);
        if (t === p) {
          const hand = await g.askCards(p, 1, '涯角：弃置一张手牌');
          g.discardCards(p, hand);
        }
      } else {
        for (const c of cards) g.toDiscard(c);
      }
    },
  },
  tieji: {
    turnEnd: (g, p) => {
      if (!p.marks.tiejiReturn || !p.marks.tiejiReturn.length) return;
      for (const id of p.marks.tiejiReturn) {
        const idx = g.discardPile.findIndex(c => c.id === id);
        if (idx >= 0) {
          const c = g.discardPile.splice(idx, 1)[0];
          p.hand.push(c);
          g.log(`${p.name} 铁骑：收回【${c.name}】`);
        }
      }
      delete p.marks.tiejiReturn;
    },
  },
  shushen: {
    turnStart: async (g, p) => {
      if (!(await yesNo(g, p, '是否发动【淑慎】？'))) return;
      const max = p.hand.length;
      const n = await g.askChoice(p, Array.from({ length: max + 1 }, (_, i) => ({ value: i, label: `弃置 ${i} 张` })), '淑慎：弃置几张？');
      if (!n) return;
      const cs = await g.askCards(p, n, '淑慎：选择弃置的牌');
      if (!cs.length) return;
      g.discardCards(p, cs);
      if (cs.length >= p.hp) { await g.heal(p, 1); }
      else { g.draw(p, cs.length); }
    },
  },
  shenzhi: {
    heal: async (g, p, ctx) => {
      const t = await g.askTarget(p, g.alive().filter(q => q !== p), '神智：与一名角色各摸一张牌', { optional: true, harmful: false });
      if (t) { g.draw(p, 1); g.draw(t, 1); }
    },
    loseCards: async (g, p, ctx) => {
      if (!ctx.cards || ctx.cards.length < p.hp) return;
      const t = await g.askTarget(p, g.alive().filter(q => q !== p), '神智：与一名角色各摸一张牌', { optional: true, harmful: false });
      if (t) { g.draw(p, 1); g.draw(t, 1); }
    },
  },

  // ================= 魏 =================
  jianxiong: {
    damaged: async (g, p, ctx) => {
      if (!ctx.card && !ctx.element) return;
      const real = ctx.card && ctx.card.id;
      const v = await g.askChoice(p, [
        ...(real ? [{ value: 'gain', label: `获得【${ctx.card.name}】` }] : []),
        { value: 'draw', label: '摸一张牌' },
      ], '奸雄：选择一项');
      if (v === 'gain' && real) {
        if (g.discardPile.some(c => c.id === ctx.card.id)) { g.reclaim(ctx.card); p.hand.push(ctx.card); }
        else { ctx.card._claimed = true; p.hand.push(ctx.card); }
        g.log(`${p.name} 获得【${ctx.card.name}】`);
      } else g.draw(p, 1);
    },
  },
  huibian: {},
  hujia: {
    beforeDamage: async (g, p, ctx) => {
      if (p.identity !== 'lord') return;
      if (p.used.hujia) return;
      const allies = g.alive().filter(q => q !== p && q.general.faction === 'wei');
      if (!allies.length) return;
      const t = await g.askTarget(p, allies, '护驾：是否将伤害转移给一名魏势力角色？', { optional: true });
      if (t) { p.used.hujia = true; ctx.transfer = t; g.draw(t, 2); g.log(`${p.name} 护驾，转移给 ${t.name}`); }
    },
  },
  fankui: {
    damaged: async (g, p, ctx) => {
      if (!ctx.source) return;
      const cards = g.allCardsOf(ctx.source);
      if (!cards.length) return;
      if (!(await yesNo(g, p, '是否发动【反馈】？'))) return;
      const ans = await g.ask(p, { type: 'cards', prompt: `反馈：获得 ${ctx.source.name} 的一张牌`, count: 1, validCards: cards.map(c => g.choiceCard(ctx.source, c)) });
      const pick = (ans && ans.cardIds && ans.cardIds[0]) ? cards.find(c => c.id === ans.cardIds[0]) : null;
      if (!pick) return;
      g.removeCardFrom(ctx.source, pick);
      await g.gain(p, [pick], 'fankui');
      const j = await g.judge(p, '反馈');
      if (j.card) {
        ctx.source.flags.fankuiSuit = j.card.suit;
        g.log(`${ctx.source.name} 本回合不能使用或打出${j.card.suit}牌`);
      }
    },
  },
  guicai: {},
  ganglie: {
    damaged: async (g, p, ctx) => {
      if (!ctx.source) return;
      if (!(await yesNo(g, p, '是否发动【刚烈】？'))) return;
      const src = ctx.source;
      const valid = g.alive().filter(q => q === src || g.distance(src, q) <= 1);
      const t = await g.askTarget(p, valid, '刚烈：选择判定目标', { harmful: true });
      if (!t) return;
      const j = await g.judge(p, '刚烈');
      if (!j.card) return;
      if (isRed(j.card)) { await g.damage(t, 1, p, { name: '刚烈' }); }
      else {
        const cards = g.allCardsOf(t);
        if (cards.length) {
          const cs = await pickFrom(g, p, t, '刚烈：弃置一张牌');
          if (cs.length) g.discardCards(t, cs);
        }
      }
    },
  },
  qingjian: {
    gainCards: async (g, p, ctx) => {
      if (!ctx.cards || !ctx.cards.length) return;
      if (ctx.from === 'draw') return;
      const pooled = ctx.cards.filter(c => p.hand.some(h => h.id === c.id));
      if (!pooled.length) return;
      if (!(await yesNo(g, p, '是否发动【清俭】将获得的牌交给其他角色？'))) return;
      const nAns = await g.askChoice(p, Array.from({ length: pooled.length }, (_, i) => ({ value: String(i + 1), label: `交给 ${i + 1} 张` })), '清俭：交给几张？');
      const n = Math.max(1, Math.min(pooled.length, parseInt(nAns, 10) || 1));
      const cs = n >= pooled.length ? pooled.slice() : await g.askCards(p, n, '清俭：选择交给的牌', { validCards: pooled });
      if (!cs.length) return;
      const t = await g.askTarget(p, g.alive().filter(q => q !== p), '清俭：选择一名角色', { harmful: false });
      if (!t) return;
      for (const c of cs) g.removeFromHand(p, c);
      await g.gain(t, cs, 'qingjian');
      g.log(`${p.name} 清俭：将 ${cs.length} 张牌交给 ${t.name}`);
    },
  },
  tuxi: {
    afterDraw: async (g, p) => { await doTuxi(g, p, p.flags.lastDrawn || []); },
    gainCards: async (g, p, ctx) => {
      if (!ctx || !ctx.cards || ctx.from === 'tuxi') return;
      await doTuxi(g, p, ctx.cards);
    },
  },
  luoyi: {
    drawPhase: async (g, p, ctx) => {
      if (!(await yesNo(g, p, '是否发动【裸衣】？'))) return;
      const cards = [];
      for (let i = 0; i < 3; i++) { const c = g.topCard(); if (c) cards.push(c); }
      const keep = cards.filter(c => c.type === 'basic' || (c.type === 'equip' && c.subtype === 'weapon') || c.name === '决斗');
      for (const c of cards) { if (!keep.includes(c)) g.toDiscard(c); }
      await g.gain(p, keep, 'luoyi');
      ctx.skip = true;
      p.flags.luoyi = true;
      g.log(`${p.name} 裸衣：获得 ${keep.length} 张牌，本回合杀/决斗伤害+1`);
    },
  },
  xiechan: {
    damaged: async (g, p, ctx) => {
      if (p.used.xiechan) return;
      p.used.xiechan = true;
      g.draw(p, 2);
      if (ctx.source) await g.resolveDuel(ctx.source, p, ctx.card || { name: '决斗' });
    },
  },
  yingcai: {},
  yiji: {
    damaged: async (g, p, ctx) => {
      g.draw(p, 2);
      if (!p.hand.length) return;
      if (!(await yesNo(g, p, '是否发动【遗计】将两张手牌交给一名角色？'))) return;
      const t = await g.askTarget(p, g.alive().filter(q => q !== p), '遗计：选择一名角色', { harmful: false });
      if (!t) return;
      const cs = await g.askCards(p, Math.min(2, p.hand.length), '遗计：选择交给的牌');
      for (const c of cs) g.removeFromHand(p, c);
      await g.gain(t, cs, 'yiji');
    },
  },
  luoshen: {
    turnStart: async (g, p) => {
      if (!(await yesNo(g, p, '是否发动【洛神】？'))) return;
      const x = Math.max(1, p.charge);
      let red = 0;
      for (let i = 0; i < x; i++) {
        const { card } = await g.judge(p, '洛神');
        if (!card) break;
        if (isBlack(card)) await g.gain(p, [g.reclaim(card)], 'luoshen');
        else red++;
      }
      p.charge = Math.min(7, p.charge + red);
      g.log(`${p.name} 洛神：${x} 次判定，红色 ${red} 张，充能 ${p.charge}`);
    },
    turnEnd: async (g, p) => {
      if (p.qingguoLevel >= 3 || p.charge < 2) return;
      if (!(await yesNo(g, p, `是否消耗2点充能升级【倾国】？（当前 ${p.charge} 点，等级 ${p.qingguoLevel}）`))) return;
      p.charge -= 2; p.qingguoLevel++;
      g.log(`${p.name} 倾国升级至 ${p.qingguoLevel} 级`);
    },
  },
  qingguo: {},
  xiaoguo: {
    otherTurnEnd: async (g, p, ctx) => {
      const t = ctx.player;
      if (!t || t === p) return;
      if (p.flags.xianjianSource === t.id) return;
      const basics = p.hand.filter(c => c.type === 'basic');
      if (!basics.length) return;
      if (!(await yesNo(g, p, `骁果：是否对 ${t.name} 发动？`))) return;
      const cs = await g.askCards(p, 1, '骁果：弃置一张基本牌', { validCards: basics });
      if (!cs.length) return;
      g.discardCards(p, cs);
      const equip = Object.values(t.equip).filter(Boolean);
      const opts = [{ value: 'damage', label: '受到1点伤害' }];
      if (equip.length) opts.unshift({ value: 'equip', label: '弃置一张装备牌并令乐进摸一张' });
      const v = await g.askChoice(t, opts, '骁果：选择一项');
      if (v === 'equip') {
        const ans = await g.ask(t, { type: 'cards', prompt: '骁果：弃置一张装备牌', count: 1, validCards: equip.map(c => g.publicCard(c)) });
        const pick = (ans && ans.cardIds && ans.cardIds[0]) ? equip.find(c => c.id === ans.cardIds[0]) : equip[0];
        if (pick) g.discardCards(t, [pick]);
        g.draw(p, 1);
      } else await g.damage(t, 1, p, { name: '骁果' });
    },
  },
  xianjian: {
    damaged: async (g, p, ctx) => {
      if (!ctx.source) return;
      if (!(await yesNo(g, p, '是否发动【陷坚】？'))) return;
      ctx.source.flags.xianjian = p.id;
      p.flags.xianjianSource = ctx.source.id;
      g.log(`${ctx.source.name} 本回合不能对 ${p.name} 使用牌`);
    },
  },
  zhiheng: {},
  tongye: {
    turnEnd: async (g, p) => {
      const count = Object.values(p.equip).filter(Boolean).length;
      if (p.marks.lastEquip === count && count > 0 && !p.used.tongye) {
        if (await yesNo(g, p, '统业：是否发动一次【制衡】？')) { p.used.tongye = true; await doZhiheng(g, p); }
      }
      p.marks.lastEquip = count;
    },
  },
  jiuyuan: {},
  qixi: {},
  fenwei: {},
  keji: {
    discardLimit: (g, p, ctx) => {
      const colors = new Set();
      if (p.used.suits) for (const s of p.used.suits) colors.add(s === '♥' || s === '♦' ? 'red' : 'black');
      if (colors.size <= 1) { ctx.limit += 4; g.draw(p, 1); g.log(`${p.name} 克己：手牌上限+4，摸一张牌`); }
    },
  },
  qinxue: {
    turnStart: async (g, p) => {
      if (p.limitedUsed.qinxue) return;
      if (p.hand.length < g.alive().length) return;
      if (!(await yesNo(g, p, '是否发动【勤学】觉醒？'))) return;
      p.limitedUsed.qinxue = true;
      p.maxHp = Math.max(1, p.maxHp - 1);
      if (p.hp > p.maxHp) p.hp = p.maxHp;
      g.draw(p, 2);
      if (!p.skills.includes('botu')) p.skills.push('botu');
      g.log(`${p.name} 勤学觉醒，获得【博图】`);
    },
  },
  botu: {
    turnEnd: (g, p) => {
      if (g.isExtraTurn) return;
      const suits = p.used.suits ? p.used.suits.size : 0;
      const cats = p.used.categories ? p.used.categories.size : 0;
      if (suits >= 4 || cats >= 3) { g.extraTurn = true; g.log(`${p.name} 博图：获得一个额外回合`); }
    },
  },
  kurou: {},
  zhaxiang: {
    loseHp: async (g, p) => {
      const x = Math.max(0, p.maxHp - p.hp);
      if (!x) return;
      const cards = [];
      for (let i = 0; i < x; i++) { const c = g.topCard(); if (c) cards.push(c); }
      const keep = cards.filter(c => c.type === 'trick' || c.type === 'equip');
      await g.gain(p, keep, 'zhaxiang');
      for (const c of cards) if (!keep.includes(c)) g.toDiscard(c);
      g.log(`${p.name} 诈降：亮出 ${x} 张，获得 ${keep.length} 张`);
    },
  },
  yingzi: {
    drawPhase: (g, p, ctx) => { ctx.n += Math.max(1, (p.marks.jian || []).length); },
    discardLimit: (g, p, ctx) => { ctx.limit = p.maxHp; },
    playStart: async (g, p) => {
      if ((p.marks.jian || []).length < 3) return;
      const cards = p.marks.jian.splice(0);
      for (const c of cards) g.toDiscard(c);
      const valid = g.alive().filter(q => q !== p && g.inAttackRange(p, q));
      const t = await g.askTarget(p, valid, '英姿：令一名角色失去1点体力', { harmful: true });
      if (t) await g.loseHp(t, 1, p);
    },
  },
  fanjian: { turnStart: (g, p) => { p.marks.fanjianTargets = []; p.marks.fanjianSuits = []; } },
  guose: {},
  liuli: {
    targeted: async (g, p, ctx) => {
      if (g.turnPlayer === p) return;
      if (p.used.liuli) return;
      const isSha = ['杀', '火杀', '雷杀'].includes(ctx.as) || (ctx.card && ctx.card.kind === 'sha');
      const isTrick = ctx.card && ctx.card.type === 'trick' && !ctx.card.delay;
      if (!isSha && !isTrick) return;
      if (ctx.targets && ctx.targets.length !== 1) return;
      const valid = g.alive().filter(q => q !== p && q !== ctx.source && g.inAttackRange(p, q));
      if (!valid.length) return;
      if (!(await yesNo(g, p, '是否发动【流离】转移目标？'))) return;
      p.used.liuli = true;
      const t = await g.askTarget(p, valid, '流离：选择转移目标', { harmful: true });
      if (!t) return;
      ctx.redirect = t;
      if (ctx.card.suit === '♦') ctx.card._liuliGain = p.id;
      else {
        const cs = await g.askCards(p, 1, '流离：弃置一张牌');
        g.discardCards(p, cs);
      }
    },
  },
  dushi: {
    playStart: async (g, p) => {
      if (!(await yesNo(g, p, '是否发动【度势】？'))) return;
      g.draw(p, 2);
      const cs = await g.askCards(p, Math.min(2, p.hand.length), '度势：弃置两张牌');
      g.discardCards(p, cs);
      const t = await g.askTarget(p, g.alive().filter(q => q !== p), '度势：令一名角色弃两张摸两张', { optional: true, harmful: false });
      if (!t) return;
      const tc = await g.askCards(t, Math.min(2, t.hand.length), '度势：弃置两张牌');
      g.discardCards(t, tc);
      g.draw(t, tc.length);
    },
  },
  lianying: {
    damageDealt: async (g, p, ctx) => {
      if (!p.used.lianying || p.used.lianyingExtra) return;
      if (!ctx.card || ctx.element !== 'fire') return;
      const t = ctx.target;
      if (!t || !t.alive) return;
      const n = g.players.length;
      const prev = g.players[(t.seat - 1 + n) % n];
      const next = g.players[(t.seat + 1) % n];
      const valid = [prev, next].filter(q => q && q.alive && q !== p && q !== t);
      if (!valid.length) return;
      const target = await g.askTarget(p, valid, '连营：对上家或下家造成1点火焰伤害', { optional: true, harmful: true });
      if (!target) return;
      p.used.lianyingExtra = true;
      g.log(`${p.name} 连营：对 ${target.name} 造成1点火焰伤害`);
      await g.damage(target, 1, p, { name: '连营', element: 'fire' }, 'fire');
    },
  },
  jieyin: {},
  xiaoji: {
    equipLost: (g, p) => {
      g.draw(p, 1);
      if (g.turnPlayer !== p) g.draw(p, 2);
    },
  },
  tianming: {
    targeted: async (g, p, ctx) => {
      const isSha = ctx && (['杀', '火杀', '雷杀'].includes(ctx.as) || (ctx.card && ctx.card.kind === 'sha'));
      if (!isSha) return;
      g.draw(p, 1);
      g.log(`${p.name} 天命：摸一张牌并展示手牌`);
    },
  },
  mizhao: {
    playEnd: async (g, p) => {
      if (!p.marks.mizhao) return;
      const { a, b } = p.marks.mizhao;
      delete p.marks.mizhao;
      const pa = g.players.find(x => x.id === a);
      const pb = g.players.find(x => x.id === b);
      if (!pa || !pb || !pa.alive || !pb.alive) return;
      if (!pa.hand.length || !pb.hand.length) {
        g.log('密诏拼点：有一方没有手牌，拼点取消');
        return;
      }
      const ca = pa.hand.length ? await g.askCards(pa, 1, '密诏拼点：选择一张手牌') : [];
      const cb = pb.hand.length ? await g.askCards(pb, 1, '密诏拼点：选择一张手牌') : [];
      const va = ca[0] ? g.rankNum(ca[0].rank) : 0;
      const vb = cb[0] ? g.rankNum(cb[0].rank) : 0;
      if (ca[0]) { g.removeFromHand(pa, ca[0]); g.toDiscard(ca[0]); }
      if (cb[0]) { g.removeFromHand(pb, cb[0]); g.toDiscard(cb[0]); }
      g.log(`密诏拼点：${pa.name} ${va} 点 vs ${pb.name} ${vb} 点`);
      if (va === vb) return;
      const winner = va > vb ? pa : pb;
      const loser = va > vb ? pb : pa;
      g.log(`${winner.name} 拼点获胜，视为对 ${loser.name} 使用【杀】`);
      await g.resolveSha(winner, { name: '杀', ignoreArmor: true }, '杀', [loser]);
    },
  },
  xiezhi: {
    otherTurnEnd: async (g, p, ctx) => {
      const t = ctx.player;
      if (!t || t === p) return;
      const counts = {};
      for (const q of g.alive()) counts[q.general.faction] = (counts[q.general.faction] || 0) + 1;
      const max = Math.max(...Object.values(counts));
      if (counts[t.general.faction] !== max) return;
      if (!t.hand.length) return;
      if (!(await yesNo(g, t, `挟制：是否交给 ${p.name} 一张手牌并摸一张？`))) return;
      const cs = await g.askCards(t, 1, '挟制：交给刘协一张手牌');
      if (!cs.length) return;
      g.removeFromHand(t, cs[0]); await g.gain(p, cs[0] ? [cs[0]] : [], 'xiezhi'); g.draw(t, 1);
    },
  },
  wushuang: {},
  shenji: {},
  liyu: {
    damageDealt: async (g, p, ctx) => {
      const t = ctx.target;
      if (!t || !t.alive) return;
      const card = ctx.card;
      if (!card || card.kind !== 'sha') return;
      const equips = ['weapon', 'armor', 'horsePlus', 'horseMinus'].map(k => t.equip[k]).filter(Boolean);
      if (!equips.length) return;
      if (!(await yesNo(g, t, `利驭：是否交给 ${p.name} 一张装备牌？`))) return;
      const ans = await g.ask(t, { type: 'cards', prompt: '利驭：选择交给吕布的装备牌', count: 1, validCards: equips.map(c => g.publicCard(c)) });
      const give = (ans && ans.cardIds && ans.cardIds[0]) ? equips.find(c => c.id === ans.cardIds[0]) : equips[0];
      if (!give) return;
      g.removeCardFrom(t, give);
      await g.gain(p, [give], 'liyu');
      g.log(`${t.name} 交给 ${p.name}【${give.name}】`);
      const valid = g.alive().filter(q => q !== p && q !== t);
      const other = await g.askTarget(p, valid, '利驭：选择【决斗】的目标', { harmful: true });
      if (other) {
        g.log(`${p.name} 利驭：视为对 ${other.name} 使用【决斗】`);
        await g.resolveDuel(p, other, { name: '决斗' });
      }
    },
  },
  lijian: {},
  lihun: {
    playEnd: async (g, p) => {
      if (!p.marks.lihun) return;
      const { target } = p.marks.lihun;
      const t = g.players.find(x => x.id === target);
      delete p.marks.lihun;
      if (!t) return;
      const n = Math.min(Math.max(0, t.hp), p.hand.length);
      if (!n) return;
      const cs = await g.askCards(p, n, `离魂：交还 ${n} 张牌给 ${t.name}`);
      for (const c of cs) g.removeFromHand(p, c);
      await g.gain(t, cs, 'lihun');
      g.log(`${p.name} 离魂：交还 ${cs.length} 张牌给 ${t.name}`);
    },
  },
  biyue: {
    turnEnd: (g, p) => { g.draw(p, 1); },
  },
  chuli: {},
  liaodu: {
    turnStart: (g, p) => { p.marks.liaodu = {}; },
    dying: async (g, p, ctx) => {
      if (g.turnPlayer === p) return;
      const dying = ctx.player;
      if (!dying || dying === p) return;
      p.marks.liaodu = p.marks.liaodu || {};
      if (p.marks.liaodu[dying.id]) return;
      p.marks.liaodu[dying.id] = true;
      let reds = p.hand.filter(isRed);
      if (!reds.length) reds = dying.hand.filter(isRed);
      if (!reds.length) return;
      if (!(await yesNo(g, p, `疗毒：是否弃置一张红色手牌救 ${dying.name}？`))) return;
      const owner = p.hand.includes(reds[0]) ? p : dying;
      g.removeFromHand(owner, reds[0]); g.toDiscard(reds[0]);
      await g.heal(dying, 1);
      g.log(`${p.name} 疗毒，视为对 ${dying.name} 使用【桃】`);
    },
  },
  xiongyi: {},
  luannian: {},
  shiyong: {
    damaged: async (g, p, ctx) => {
      const c = ctx.card;
      if (!c) return;
      if (!isRed(c) && !p.limitedUsed.yaowu) g.draw(p, 1);
      if (!isBlack(c) && p.limitedUsed.yaowu && ctx.source) g.draw(ctx.source, 1);
    },
  },
  yaowu: {
    playStart: async (g, p) => {
      if (p.limitedUsed.yaowu) return;
      if (!(await yesNo(g, p, '是否发动【耀武】？'))) return;
      p.limitedUsed.yaowu = true;
      const used = new Set();
      const virtual = { name: '杀', suit: '♠', kind: 'sha' };
      while (true) {
        const valid = g.alive().filter(q => q !== p && !used.has(q.id) && !(q.skills.includes('kongcheng') && q.hand.length === 0));
        if (!valid.length) break;
        const t = await g.askTarget(p, valid, '耀武：选择【杀】的目标（可取消）', { optional: true });
        if (!t) break;
        used.add(t.id);
        if (t.equip.armor && t.equip.armor.name === '仁王盾') {
          g.log(`${t.name} 的【仁王盾】使黑色【杀】无效`);
          break;
        }
        if (t.equip.armor && t.equip.armor.name === '藤甲') {
          g.log(`${t.name} 的【藤甲】使普通【杀】无效`);
          break;
        }
        const before = t.hp;
        const ok = await g.askShan(t, p, virtual);
        if (!ok) await g.damage(t, 1, p, virtual);
        if (t.hp < before) await g.heal(p, 1);
        else break;
      }
    },
  },
  xiongsuan: {
    turnEnd: (g, p) => {
      if (!p.marks.xiongsuan) return;
      const { target, skill } = p.marks.xiongsuan;
      if (target) { target.limitedUsed[skill] = false; g.log(`${p.name} 凶算重置 ${target.name} 的限定技`); }
      delete p.marks.xiongsuan;
    },
  },
  huoluan: {
    discardEnd: async (g, p, ctx) => {
      const x = Math.min(5, ctx.count || 0);
      if (!x) return;
      const valid = g.alive().filter(q => q !== p && g.inAttackRange(p, q));
      const t = await g.askTarget(p, valid, '祸乱：选择一名角色', { optional: true });
      if (!t) return;
      const opts = [{ value: 'damage', label: '受到1点火焰伤害' }];
      const all = g.allCardsOf(t);
      if (all.length) opts.unshift({ value: 'discard', label: `弃置 ${Math.min(x, all.length)} 张牌` });
      const v = await g.askChoice(t, opts, '祸乱：选择一项');
      if (v === 'discard') {
        const n = Math.min(x, all.length);
        const ans = await g.ask(t, { type: 'cards', prompt: `祸乱：弃置 ${n} 张牌`, count: n, validCards: all.map(c => g.choiceCard(t, c)) });
        const picked = ((ans && ans.cardIds) || []).map(id => all.find(c => c.id === id)).filter(Boolean);
        g.discardCards(t, picked);
      } else await g.damage(t, 1, p, { name: '祸乱' }, 'fire');
    },
  },
  mouzhu: {},
  yanhuo: {
    death: async (g, p, ctx) => {
      const x = ctx.handCount || 0;
      for (const q of g.alive()) {
        if (q === p) continue;
        g.discardCards(q, g.allCardsOf(q).slice(0, x));
      }
      if (ctx.source) await g.loseHp(ctx.source, 1, p);
    },
  },
};

const ACTIVE = {
  rende: {
    canUse: (g, p) => !p.used.rende && p.hand.length > 0 && g.alive().some(q => q !== p && !(p.marks.rendeTargets || []).includes(q.id)),
    use: async (g, p) => {
      const valid = g.alive().filter(q => q !== p && !(p.marks.rendeTargets || []).includes(q.id));
      const t = await g.askTarget(p, valid, '仁德：选择一名角色', { harmful: false });
      if (!t) return;
      const nAns = await g.askChoice(p, Array.from({ length: p.hand.length }, (_, i) => ({ value: String(i + 1), label: `交给 ${i + 1} 张` })), '仁德：交给几张手牌？');
      const n = Math.max(1, Math.min(p.hand.length, parseInt(nAns, 10) || 1));
      const cs = await g.askCards(p, n, '仁德：选择交给的牌');
      if (!cs.length) return;
      p.used.rende = true;
      for (const c of cs) g.removeFromHand(p, c);
      await g.gain(t, cs, 'rende');
      t.marks.rende = (t.marks.rende || 0) + 1;
      p.marks.rendeTargets = p.marks.rendeTargets || [];
      p.marks.rendeTargets.push(t.id);
      if (cs.length >= 2) g.draw(p, 1);
      g.log(`${p.name} 仁德：交给 ${t.name} ${cs.length} 张牌，获得仁德标记`);
    },
  },
  zhangwu: {
    canUse: (g, p) => !p.used.zhangwu && g.alive().some(q => q !== p && (q.marks.rende || 0) > 0),
    use: async (g, p) => {
      const valid = g.alive().filter(q => q !== p && (q.marks.rende || 0) > 0);
      const t = await g.askTarget(p, valid, '章武：选择一名有仁德标记的角色', { harmful: false });
      if (!t) return;
      const opts = [{ value: 'virtual', label: '视为刘备使用一张基本牌' }];
      if (t.hand.length >= 2) opts.push({ value: 'cards', label: '交给刘备两张手牌' });
      const v = await g.askChoice(t, opts, '章武：选择一项');
      if (v === 'cards') {
        const cs = await g.askCards(t, 2, '章武：交给刘备两张手牌');
        for (const c of cs) g.removeFromHand(t, c);
        await g.gain(p, cs, 'zhangwu');
      } else {
        const kind = await g.askChoice(p, [{ value: 'sha', label: '虚拟【杀】' }, { value: 'tao', label: '虚拟【桃】' }], '章武：选择基本牌');
        if (kind === 'tao') await g.heal(p, 1);
        else {
          const ts = g.alive().filter(q => q !== p && g.inAttackRange(p, q));
          const target = await g.askTarget(p, ts, '章武：选择【杀】的目标');
          if (target) await g.resolveSha(p, { name: '杀' }, '杀', [target]);
        }
      }
      t.marks.rende = Math.max(0, (t.marks.rende || 0) - 1);
      if (p.identity === 'lord' && t.general.faction === 'shu') {
        t.marks.rende = (t.marks.rende || 0) + 1;
        p.used.zhangwu = false;
        g.log('励众：返还仁德标记，章武视为未发动');
      } else p.used.zhangwu = true;
    },
  },
  yijue: {
    canUse: (g, p) => p.hand.length > 0 && !p.used.yijue,
    use: async (g, p) => {
      const cs = await g.askCards(p, 1, '义绝：弃置一张手牌');
      if (!cs.length) return;
      g.discardCards(p, cs);
      const t = await g.askTarget(p, g.alive().filter(q => q !== p), '义绝：选择一名角色');
      if (!t) return;
      const reds = t.hand.filter(isRed);
      const opts = [{ value: 'debuff', label: '本回合不能使用红色牌且受到伤害+1' }];
      if (reds.length) opts.unshift({ value: 'give', label: '交给关羽一张红色手牌' });
      const v = await g.askChoice(t, opts, '义绝：选择一项');
      if (v === 'give') {
        const give = await g.askCards(t, 1, '义绝：选择交给关羽的红色牌', { validCards: reds });
        if (give.length) { g.removeFromHand(t, give[0]); await g.gain(p, [give[0]], 'yijue'); }
        if (await yesNo(g, p, '是否令其回复1点体力？')) await g.heal(t, 1);
      } else {
        t.flags.yijue = true;
        t.flags.nonLockDisabled = true;
        t.marks.yi = 0;
        g.log(`${t.name} 受到义绝影响：红牌失效、非锁定技失效、受伤+1`);
      }
      p.used.yijue = true;
    },
  },
  huibian: {
    canUse: (g, p) => !p.used.huibian,
    use: async (g, p) => {
      const t = await g.askTarget(p, g.alive(), '挥鞭：选择一名角色');
      if (!t) return;
      p.used.huibian = true;
      await g.heal(t, 1);
      await g.damage(t, 1, p, { name: '挥鞭' });
    },
  },
  zhiheng: {
    canUse: (g, p) => !p.used.zhiheng && p.hand.length > 0,
    use: async (g, p) => { p.used.zhiheng = true; await doZhiheng(g, p); },
  },
  kurou: {
    canUse: (g, p) => !p.used.kurou && p.hp > 1,
    use: async (g, p) => {
      p.used.kurou = true;
      p.flags.extraSha = (p.flags.extraSha || 0) + 1;
      p.flags.kurouRed = true;
      await g.loseHp(p, 1);
      g.draw(p, 2);
    },
  },
  fanjian: {
    canUse: (g, p) => {
      const suits = p.marks.fanjianSuits || [];
      return p.hand.some(c => !suits.includes(c.suit)) && g.alive().some(q => q !== p && !(p.marks.fanjianTargets || []).includes(q.id));
    },
    use: async (g, p) => {
      const suits = p.marks.fanjianSuits || [];
      const avail = p.hand.filter(c => !suits.includes(c.suit));
      const cs = await g.askCards(p, 1, '反间：扣置一张本回合未扣置花色的手牌', { validCards: avail });
      if (!cs.length) return;
      const c = cs[0]; g.removeFromHand(p, c);
      p.marks.fanjianSuits = suits.concat(c.suit);
      const valid = g.alive().filter(q => q !== p && !(p.marks.fanjianTargets || []).includes(q.id));
      const t = await g.askTarget(p, valid, '反间：选择一名角色');
      if (!t) { await g.gain(p, [c]); return; }
      p.marks.fanjianTargets = p.marks.fanjianTargets || [];
      const v = await g.askChoice(t, [{ value: 'guess', label: '猜测花色' }, { value: 'lose', label: '失去1点体力' }], '反间：选择一项');
      if (v === 'lose') {
        await g.loseHp(t, 1);
        t.hand.push(c);
        p.marks.fanjianTargets.push(t.id);
        g.log(`${t.name} 获得【间】`);
        return;
      }
      const suit = await g.askSuit(t, '猜测【间】的花色');
      if (suit === c.suit) {
        t.hand.push(c);
        p.marks.fanjianTargets.push(t.id);
        g.log(`${t.name} 猜对，获得【间】`);
      } else {
        p.marks.jian = p.marks.jian || [];
        p.marks.jian.push(c);
        g.log(`${t.name} 猜错，受到1点伤害`);
        await g.damage(t, 1, p, { name: '反间' });
      }
    },
  },
  guose: {
    canUse: (g, p) => !p.used.guoseRemove && g.alive().some(q => q.judge.some(c => c.kind === 'le')),
    use: async (g, p) => {
      const holders = g.alive().filter(q => q.judge.some(c => c.kind === 'le'));
      const t = await g.askTarget(p, holders, '国色：弃置哪名角色判定区的【乐不思蜀】', { harmful: false });
      if (!t) return;
      const idx = t.judge.findIndex(c => c.kind === 'le');
      if (idx < 0) return;
      const c = t.judge.splice(idx, 1)[0];
      g.toDiscard(c);
      g.draw(p, 1);
      p.used.guoseRemove = true;
      g.log(`${p.name} 国色：弃置 ${t.name} 的【乐不思蜀】并摸一张牌`);
    },
  },
  lijian: {
    canUse: (g, p) => !p.used.lijian && g.allCardsOf(p).length > 0,
    use: async (g, p) => {
      const cs = await g.askCardsFromAll(p, 1, '离间：弃置一张牌');
      if (!cs.length) return;
      g.removeCardFrom(p, cs[0]);
      g.toDiscard(cs[0]);
      const males = g.alive().filter(q => q !== p && q.general.gender !== 'female');
      const a = await g.askTarget(p, males, '离间：选择第一名男性角色');
      if (!a) return;
      const b = await g.askTarget(p, males.filter(q => q !== a), '离间：选择第二名男性角色');
      if (!b) return;
      p.used.lijian = true;
      g.log(`${p.name} 离间：${a.name} 对 ${b.name} 使用【决斗】`);
      await g.resolveDuel(a, b, { name: '决斗' });
    },
  },
  lihun: {
    canUse: (g, p) => !p.limitedUsed.lihun && p.hand.length >= 0,
    use: async (g, p) => {
      const valid = g.alive().filter(q => q !== p && q.hand.length);
      const t = await g.askTarget(p, valid, '离魂：选择一名角色');
      if (!t) return;
      p.limitedUsed.lihun = true;
      const cards = t.hand.splice(0);
      p.hand.push(...cards);
      p.marks.lihun = { target: t.id, count: t.hp };
      p.flags.flipped = true;
      g.log(`${p.name} 离魂：获得 ${t.name} 全部手牌 ${cards.length} 张`);
    },
  },
  mizhao: {
    canUse: (g, p) => !p.used.mizhao && p.hand.length > 0,
    use: async (g, p) => {
      const cs = await g.askCards(p, 1, '密诏：选择交给的牌');
      if (!cs.length) return;
      const others = g.alive().filter(q => q !== p);
      const a = await g.askTarget(p, others, '密诏：选择获得手牌的角色', { harmful: false });
      if (!a) return;
      g.removeFromHand(p, cs[0]); await g.gain(a, [cs[0]], 'mizhao');
      const b = await g.askTarget(p, others.filter(q => q !== a && q.hand.length > 0), '密诏：选择拼点对手', { harmful: true });
      if (!b) return;
      p.used.mizhao = true;
      p.marks.mizhao = { a: a.id, b: b.id };
      g.log(`${p.name} 密诏：${a.name} 与 ${b.name} 将在出牌阶段结束时拼点`);
    },
  },
  shenji: {
    canUse: (g, p) => !p.limitedUsed.shenji && p.hand.length > 0,
    use: async (g, p) => {
      const cs = await g.askCards(p, 1, '神戟：选择一张手牌');
      if (!cs.length) return;
      g.removeFromHand(p, cs[0]);
      p.limitedUsed.shenji = true;
      const targets = [];
      for (let i = 0; i < 3; i++) {
        const valid = g.alive().filter(q => q !== p && !targets.includes(q));
        const t = await g.askTarget(p, valid, `神戟：选择第 ${i + 1} 个目标（可取消）`, { optional: true });
        if (!t) break;
        targets.push(t);
      }
      for (const t of targets) {
        const before = t.hp;
        await g.resolveDuel(p, t, cs[0]);
        if (t.hp < before) g.draw(p, 1);
      }
      g.toDiscard(cs[0]);
    },
  },
  chuli: {
    canUse: (g, p) => !p.used.chuli && p.hand.length > 0,
    use: async (g, p) => {
      p.used.chuli = true;
      const factions = new Set(g.alive().map(q => q.general.faction));
      const x = factions.size;
      const discarded = [];
      const own = await g.askCards(p, 1, '除疠：弃置自己一张手牌');
      for (const c of own) { discarded.push({ who: p, suit: c.suit }); g.removeFromHand(p, c); g.toDiscard(c); }
      const targets = [];
      for (let i = 0; i < x; i++) {
        const valid = g.alive().filter(q => q !== p && q.hand.length && !targets.includes(q));
        if (!valid.length) break;
        const t = await g.askTarget(p, valid, `除疠：选择第 ${i + 1} 名角色（可取消）`, { optional: true });
        if (!t) break;
        targets.push(t);
        const cs = await pickFrom(g, p, t, `除疠：弃置 ${t.name} 一张手牌`);
        if (cs.length) { g.removeFromHand(t, cs[0]); g.toDiscard(cs[0]); discarded.push({ who: t, suit: cs[0].suit }); }
      }
      const suit = await g.askSuit(p, '除疠：选择一种花色，弃置此花色的角色各摸一张');
      for (const d of discarded) {
        if (d.suit !== suit) continue;
        g.draw(d.who, 1);
        g.log(`${d.who.name} 除疠：弃置了${suit}牌，摸一张`);
      }
    },
  },
  xiongyi: {
    canUse: (g, p) => !p.limitedUsed.xiongyi,
    use: async (g, p) => {
      p.limitedUsed.xiongyi = true;
      g.draw(p, 3);
      const mount = p.equip.horsePlus || p.equip.horseMinus;
      if (mount) {
        const slot = p.equip.horsePlus === mount ? 'horsePlus' : 'horseMinus';
        const t = await g.askTarget(p, g.alive().filter(q => q !== p), '雄异：选择获得坐骑的角色', { harmful: false });
        if (t) {
          p.equip[slot] = null;
          if (t.equip[slot]) {
            const old = t.equip[slot];
            t.equip[slot] = null;
            g.toDiscard(old);
            g.trigger('equipLost', t, { card: old });
            g.log(`${t.name} 弃置原坐骑【${old.name}】`);
          }
          t.equip[slot] = mount;
          if (!t.skills.includes('xiongyi')) t.skills.push('xiongyi');
          t.limitedUsed.xiongyi = false;
          g.log(`${p.name} 雄异：将【${mount.name}】交给 ${t.name}，其获得【雄异】`);
        }
      }
      if (p.identity === 'lord') await g.heal(p, 1);
      const lord = g.players.find(q => q.alive && q.identity === 'lord' && q.general.id === 'mateng' && g.hasSkill(q, 'luannian'));
      if (lord && p !== lord && p.general.faction === 'qun') {
        g.draw(lord, 1);
        g.log(`${lord.name} 乱年：${p.name} 发动【雄异】，摸一张牌`);
      }
    },
  },
  xiongsuan: {
    canUse: (g, p) => !p.limitedUsed.xiongsuan && p.hand.length > 0,
    use: async (g, p) => {
      const cs = await g.askCards(p, 1, '凶算：弃置一张手牌');
      if (!cs.length) return;
      g.discardCards(p, cs);
      p.limitedUsed.xiongsuan = true;
      const t = await g.askTarget(p, g.alive(), '凶算：选择受到1点伤害的角色', { harmful: false });
      if (!t) return;
      await g.damage(t, 1, p, { name: '凶算' });
      g.draw(p, 3);
      const used = Object.keys(t.limitedUsed).filter(k => {
        if (!t.limitedUsed[k]) return false;
        if (t === p && k === 'xiongsuan') return false;
        const skill = (t.general.skills || []).find(s => s.id === k);
        return !!skill && skill.type === 'limited';
      });
      if (used.length) {
        const opts = used.map(k => {
          const skill = (t.general.skills || []).find(s => s.id === k);
          return { value: k, label: skill ? skill.name : k };
        });
        const skillId = used.length === 1 ? used[0] : await g.askChoice(p, opts, '凶算：选择要重置的限定技');
        p.marks.xiongsuan = { target: t, skill: skillId };
        const skill = (t.general.skills || []).find(s => s.id === skillId);
        g.log(`凶算：回合结束时重置 ${t.name} 的【${skill ? skill.name : skillId}】`);
      }
    },
  },
  mouzhu: {
    canUse: (g, p) => (p.used.mouzhu || 0) < 2 && g.alive().some(q => q !== p && q.hand.length),
    use: async (g, p) => {
      const valid = g.alive().filter(q => q !== p && q.hand.length);
      const t = await g.askTarget(p, valid, '谋诛：选择一名角色');
      if (!t) return;
      const cs = await pickFrom(g, p, t, `谋诛：获得 ${t.name} 一张手牌`);
      if (!cs.length) return;
      g.removeFromHand(t, cs[0]); await g.gain(p, [cs[0]], 'mouzhu');
      p.used.mouzhu = (p.used.mouzhu || 0) + 1;
      if (t.hand.length < p.hand.length) {
        if (await yesNo(g, p, `谋诛：是否令 ${t.name} 对你使用【决斗】？`)) await g.resolveDuel(t, p, { name: '决斗' });
      }
    },
  },
  jieyin: {
    canUse: (g, p) => !p.used.jieyin && p.hand.length > 0 && g.alive().some(q => q !== p && q.general.gender !== 'female'),
    use: async (g, p) => {
      const cs = await g.askCards(p, 1, '结姻：选择交给的牌');
      if (!cs.length) return;
      const males = g.alive().filter(q => q !== p && q.general.gender !== 'female');
      const t = await g.askTarget(p, males, '结姻：选择一名男性角色', { harmful: false });
      if (!t) return;
      p.used.jieyin = true;
      const c = cs[0]; g.removeFromHand(p, c);
      if (c.type === 'equip') {
        if (await yesNo(g, t, `是否使用【${c.name}】？`)) g.equipCard(t, c);
        else await g.gain(t, [c], 'jieyin');
      } else await g.gain(t, [c], 'jieyin');
      if (p.hp !== t.hp) {
        const lower = p.hp < t.hp ? p : t;
        const higher = lower === p ? t : p;
        await g.heal(lower, 1);
        g.draw(higher, 2);
      } else {
        // 1.1.1：结姻双方体力相等时各摸一张
        g.draw(p, 1);
        g.draw(t, 1);
        g.log(`【结姻】：${p.name} 与 ${t.name} 体力相等，各摸一张牌`);
      }
    },
  },
};

module.exports = { TRIGGERS, ACTIVE };
