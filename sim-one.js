'use strict';
// 单局：行为推理 bot，只知道自己身份，主公公开。
const { Game } = require('./engine');
const { GENERALS } = require('./data');
const { BOT_DEFS } = require('./rooms');

const IDENTS = {
  5: ['lord', 'loyal', 'rebel', 'rebel', 'spy'],
  8: ['lord', 'loyal', 'loyal', 'rebel', 'rebel', 'rebel', 'rebel', 'spy'],
};

const origBotAction = Game.prototype.botAction;
Game.prototype.botAction = function (p, req) {
  const opts = (req.options || []).filter(o => (o.cardId !== undefined || o.action) && o.mode !== 'zhangba');
  const lord = this.players.find(q => q.alive && q.identity === 'lord');
  const targeted = (o, id) => (o.targets || []).includes(id);

  // 反贼优先进攻主公
  if (p.identity === 'rebel' && lord) {
    const sha = opts.find(o => o.as === '杀' && targeted(o, lord.id));
    if (sha && Math.random() < 0.92) return { action: 'play', cardId: sha.cardId, as: sha.as, targets: [lord.id] };
    const trick = opts.find(o => ['决斗', '火攻', '顺手牵羊', '过河拆桥', '借刀杀人'].includes(o.as) && targeted(o, lord.id));
    if (trick && Math.random() < 0.85) return { action: 'play', cardId: trick.cardId, as: trick.as, targets: [lord.id] };
  }

  const r = origBotAction.call(this, p, req);
  // 没有明确敌人时提高试探意愿
  if (r && r.action === 'end') {
    const off = opts.filter(o => o.cardId !== undefined && (o.targets || []).length &&
      (o.as === '杀' || ['决斗', '火攻', '顺手牵羊', '过河拆桥', '借刀杀人'].includes(o.as)));
    if (off.length && Math.random() < 0.65) {
      const o = off[Math.floor(Math.random() * off.length)];
      let tid;
      if (p.identity === 'rebel' && lord && targeted(o, lord.id)) tid = lord.id;
      else {
        const m = this._bel.get(p.id) || new Map();
        const cand = o.targets.filter(id => id !== p.id && (m.get(id) || 0) >= 0);
        const pool = cand.length ? cand : o.targets.filter(id => id !== p.id);
        if (!pool.length) return r;
        tid = pool[Math.floor(Math.random() * pool.length)];
      }
      return { action: 'play', cardId: o.cardId, as: o.as, targets: [tid] };
    }
  }
  return r;
};

function makeGame(mode) {
  const idents = IDENTS[mode].slice();
  const botPool = BOT_DEFS.slice();
  for (let i = botPool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [botPool[i], botPool[j]] = [botPool[j], botPool[i]];
  }
  const seats = idents.map((identity, i) => {
    const g = GENERALS[Math.floor(Math.random() * GENERALS.length)];
    const b = botPool[i];
    return { id: 'p' + i, name: b.name, isBot: true, identity, generalId: g.id, botId: b.id, botPersona: b.persona };
  });
  const room = { broadcast() { }, onGameOver() { } };
  const g = new Game(room, seats, mode);
  g.botView = 'blind';
  g.botDelay = false;
  g._bel = new Map();
  g._obsSeq = 0;
  return g;
}

async function runLimited(g, maxTurns) {
  let guard = 0;
  while (!g.winner) {
    if (++guard > maxTurns) {
      // 模拟用的僵持判定：主公还活着算主忠胜，否则反贼/内奸按存活
      const alive = g.alive();
      if (alive.some(p => p.identity === 'lord')) g.winner = 'lord';
      else if (alive.some(p => p.identity === 'rebel')) g.winner = 'rebel';
      else g.winner = 'spy';
      g.log('模拟回合上限，按僵持判定：' + g.winner);
      break;
    }
    if (!g.alive().length) { g.winner = g.winner || 'lord'; break; }
    const p = g.players[g.turnIndex];
    if (!p.alive) { g.turnIndex = g.nextAlive(g.turnIndex); await new Promise(r => setImmediate(r)); continue; }
    g.isExtraTurn = g._extra;
    await g.takeTurn(p);
    if (g.winner) break;
    if (g.extraTurn && !g.isExtraTurn) { g.extraTurn = false; g._extra = true; continue; }
    g._extra = false;
    g.turnIndex = g.nextAlive(g.turnIndex);
  }
  g.over = true;
  g.phase = 'over';
}

(async () => {
  const mode = Number(process.argv[2]) === 5 ? 5 : 8;
  const g = makeGame(mode);
  g.log('=== 游戏开始 ===');
  for (const p of g.players) await g.trigger('gameStart', p, {});
  for (const p of g.players) g.draw(p, 4);
  g.phase = 'start';
  await runLimited(g, mode === 8 ? 70 : 60);
  console.log(JSON.stringify({ winner: g.winner, players: g.players.map(p => ({ identity: p.identity, general: p.general.name, botId: p.botId || 'unknown', botName: p.name })) }));
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
