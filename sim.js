'use strict';
// 行为推理机器人模拟：每名 bot 只知道自己身份，主公公开；其余靠出牌行为建立敌意/好感表。
const { Game } = require('./engine');
const { GENERALS } = require('./data');

const IDENTS = {
  5: ['lord', 'loyal', 'rebel', 'rebel', 'spy'],
  8: ['lord', 'loyal', 'loyal', 'rebel', 'rebel', 'rebel', 'rebel', 'spy'],
};
const OFF = new Set(['杀', '决斗', '火攻', '顺手牵羊', '过河拆桥', '借刀杀人', '南蛮入侵', '万箭齐发', '乐不思蜀', '兵粮寸断', '铁索连环']);
const HELP = new Set(['桃', '桃园结义', '无中生有', '五谷丰登', '仁德', '遗计', '结姻', '淑慎', '青囊', '急救', '清俭']);

function bump(g, a, b, d) {
  const m = g._bel.get(a.id);
  if (!m) return;
  m.set(b.id, (m.get(b.id) || 0) + d);
}

Game.prototype.isEnemy = function (a, b) {
  if (a === b) return false;
  const m = this._bel && this._bel.get(a.id);
  if (!m) return false;
  const sc = m.get(b.id) || 0;
  if (a.identity === 'lord' || a.identity === 'loyal') {
    if (b.identity === 'lord') return false;
    return sc >= 1;
  }
  if (a.identity === 'rebel') {
    if (b.identity === 'lord') return true;
    return sc >= 1;
  }
  if (a.identity === 'spy') {
    if (b.identity === 'lord') return false; // 内奸先保主，残局再动
    return sc >= 2;
  }
  return false;
};

Game.prototype._observe = function () {
  const lp = this.lastPlay;
  if (!lp || !lp.seq || lp.seq <= (this._obsSeq || 0)) return;
  this._obsSeq = lp.seq;
  const a = this.players.find(p => p.id === lp.playerId);
  if (!a) return;
  const kind = lp.as || (lp.card && lp.card.name);
  for (const tid of lp.targets || []) {
    const b = this.players.find(p => p.id === tid);
    if (!b) continue;
    if (OFF.has(kind)) { bump(this, a, b, 2); bump(this, b, a, 2); }
    else if (HELP.has(kind)) { bump(this, a, b, -1); bump(this, b, a, -1); }
  }
};

Game.prototype.botAnswer = async function (p, req) {
  this._observe();
  return this.botDecide(p, req);
};

const origBotAction = Game.prototype.botAction;
Game.prototype.botAction = function (p, req) {
  const r = origBotAction.call(this, p, req);
  if (r && r.action === 'end') {
    // 没有明确敌人时随机试探，暴露行为供其他 bot 推理
    const opts = (req.options || []).filter(o => o.cardId !== undefined && o.targets && o.targets.length);
    const probe = opts.find(o => o.as === '杀' || ['决斗', '火攻', '顺手牵羊', '过河拆桥', '借刀杀人'].includes(o.as));
    if (probe && Math.random() < 0.35) {
      const t = probe.targets[Math.floor(Math.random() * probe.targets.length)];
      return { action: 'play', cardId: probe.cardId, as: probe.as, targets: [t] };
    }
  }
  return r;
};

function makeGame(mode, n) {
  const idents = IDENTS[mode].slice();
  const seats = idents.map((identity, i) => {
    const g = GENERALS[Math.floor(Math.random() * GENERALS.length)];
    return { id: 'p' + i, name: 'P' + i, isBot: true, identity, generalId: g.id };
  });
  // 主公体力 +1 在 Game 构造函数里处理
  const room = { broadcast() { }, onGameOver() { } };
  const g = new Game(room, seats, mode);
  g._bel = new Map();
  for (const p of g.players) {
    const m = new Map();
    for (const q of g.players) {
      if (q === p) continue;
      let v = 0;
      if (q.identity === 'lord') {
        if (p.identity === 'rebel') v = 100;
        else if (p.identity === 'lord' || p.identity === 'loyal') v = -100;
      }
      m.set(q.id, v);
    }
    g._bel.set(p.id, m);
  }
  g._obsSeq = 0;
  return g;
}

async function runOne(mode) {
  const g = makeGame(mode);
  const lord = g.players.find(p => p.identity === 'lord');
  g.log('=== 游戏开始 ===');
  for (const p of g.players) await g.trigger('gameStart', p, {});
  for (const p of g.players) g.draw(p, 4);
  g.phase = 'start';
  await g.run();
  return { winner: g.winner, players: g.players.map(p => ({ identity: p.identity, general: p.general.name, alive: p.alive })) };
}

(async () => {
  const stats = {};
  for (const mode of [5, 8]) {
    for (const id of IDENTS[mode]) stats[id] = stats[id] || { games: 0, wins: 0 };
    for (let i = 0; i < 50; i++) {
      let r;
      try { r = await runOne(mode); } catch (e) { console.error('game error', mode, e); continue; }
      const winners = new Set();
      if (r.winner === 'lord') { winners.add('lord'); winners.add('loyal'); }
      else if (r.winner === 'rebel') winners.add('rebel');
      else if (r.winner === 'spy') winners.add('spy');
      for (const p of r.players) {
        stats[p.identity].games++;
        if (winners.has(p.identity)) stats[p.identity].wins++;
      }
      if ((i + 1) % 10 === 0) console.log(`mode ${mode} done ${i + 1}/50`);
    }
  }
  console.log('RESULT', JSON.stringify(stats));
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
