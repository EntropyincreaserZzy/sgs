'use strict';

const crypto = require('crypto');
const { GENERALS, GENERAL_MAP, LORD_GENERALS } = require('./data');
const { Game, IDENT_NAMES } = require('./engine');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode() {
  let s = '';
  for (let i = 0; i < 8; i++) s += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return s;
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const BOT_NAMES = ['电脑·卧龙', '电脑·凤雏', '电脑·仲达', '电脑·公瑾', '电脑·孟德', '电脑·玄德', '电脑·云长', '电脑·翼德', '电脑·子龙', '电脑·伯符'];

class Room {
  constructor(code, mode, host, manager) {
    this.code = code;
    this.mode = mode;
    this.capacity = mode === 5 ? 5 : 8;
    this.host = host.id;
    this.manager = manager;
    this.phase = 'lobby';
    this.seats = new Array(this.capacity).fill(null);
    this.players = new Map();
    this.streams = new Map();
    this.game = null;
    this.draft = null;
    this.gameOrder = null;
    this.winner = null;
    this.createdAt = Date.now();
    this.addPlayer(host);
  }

  addPlayer(p) {
    if (this.seats.includes(null) === false) return { error: '房间已满' };
    if (this.players.has(p.id)) return { error: '已在房间中' };
    const seat = this.seats.indexOf(null);
    const player = { id: p.id, name: p.name, isBot: false, token: p.token, seat, connected: true, accountId: p.accountId || null };
    this.seats[seat] = player;
    this.players.set(p.id, player);
    return { seat };
  }

  addBot() {
    if (this.phase !== 'lobby') return { error: '游戏已开始' };
    const seat = this.seats.indexOf(null);
    if (seat < 0) return { error: '房间已满' };
    const id = 'bot_' + crypto.randomBytes(4).toString('hex');
    const name = BOT_NAMES[this.players.size % BOT_NAMES.length] + (this.players.size > 9 ? this.players.size : '');
    const player = { id, name, isBot: true, token: 'bot', seat, connected: true };
    this.seats[seat] = player;
    this.players.set(id, player);
    this.broadcast();
    return { ok: true };
  }

  removeBot(seat) {
    if (this.phase !== 'lobby') return { error: '游戏已开始' };
    const p = this.seats[seat];
    if (!p || !p.isBot) return { error: '该座位不是机器人' };
    this.seats[seat] = null;
    this.players.delete(p.id);
    this.broadcast();
    return { ok: true };
  }

  removePlayer(pid) {
    const p = this.players.get(pid);
    if (!p) return;
    if (this.phase === 'lobby') {
      this.seats[p.seat] = null;
      this.players.delete(pid);
      this.streams.delete(pid);
      if (this.host === pid) this.transferHost();
      this.broadcast();
    } else {
      p.connected = false;
      this.streams.delete(pid);
      this.broadcast();
    }
  }

  transferHost() {
    const next = this.seats.find(p => p && !p.isBot);
    if (next) this.host = next.id;
  }

  attachStream(pid, res) {
    this.streams.set(pid, res);
    const p = this.players.get(pid);
    if (p) p.connected = true;
    this.sendTo(pid, { type: 'state', state: this.getView(pid) });
    this.broadcast();
  }

  detachStream(pid) {
    this.streams.delete(pid);
    const p = this.players.get(pid);
    if (p) p.connected = false;
    if (this.game) this.game.broadcast();
  }

  sendTo(pid, obj) {
    const res = this.streams.get(pid);
    if (!res) return;
    try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch (e) { this.streams.delete(pid); }
  }

  broadcast() {
    for (const [pid, res] of this.streams) {
      try { res.write(`data: ${JSON.stringify({ type: 'state', state: this.getView(pid) })}\n\n`); } catch (e) { this.streams.delete(pid); }
    }
  }

  getView(pid) {
    const me = this.players.get(pid);
    const useGameOrder = !!this.gameOrder && this.phase !== 'lobby';
    const ordered = useGameOrder ? this.gameOrder.map(id => this.players.get(id)).filter(Boolean) : this.seats;
    const seatIndex = {};
    ordered.forEach((p, i) => { if (p) seatIndex[p.id] = i; });
    const mySeat = me ? (useGameOrder && seatIndex[me.id] != null ? seatIndex[me.id] : me.seat) : null;
    return {
      code: this.code,
      mode: this.mode,
      capacity: this.capacity,
      phase: this.phase,
      host: this.host,
      you: pid,
      youSeat: mySeat,
      youIdentity: me ? me.identity : null,
      seats: ordered.map((p, i) => p ? {
        seat: i, id: p.id, name: p.name, isBot: p.isBot, connected: p.connected,
        identity: p.id === pid ? p.identity : (p.identity === 'lord' ? 'lord' : null),
      } : { seat: i, id: null, name: '空位', isBot: false, connected: false }),
      canStart: this.phase === 'lobby' && this.seats.every(Boolean) && this.host === pid,
      draft: this.draft ? this.draftView(pid) : null,
      game: this.game ? this.game.getState(pid) : null,
      winner: this.winner,
      identities: this.phase === 'over' && this.game ? this.game.players.map(p => ({ id: p.id, name: p.name, identity: p.identity })) : null,
      isHost: this.host === pid,
      isBot: me ? me.isBot : false,
    };
  }

  draftView(pid) {
    const d = this.draft;
    const base = { phase: d.phase, lordId: d.lordId, lordName: (this.players.get(d.lordId) || {}).name || '', allPicked: d.phase === 'done' };
    if (d.phase === 'lord') {
      return { ...base, options: pid === d.lordId ? d.lordOptions.map(id => this.generalView(id)) : [], chosen: null, waiting: pid !== d.lordId };
    }
    const pick = d.picks[pid];
    if (!pick) return { ...base, options: [], chosen: null, waiting: true };
    return {
      ...base,
      options: pick.options.map(id => this.generalView(id)),
      chosen: pick.chosen,
      waiting: false,
      pickedCount: Object.values(d.picks).filter(x => x.chosen).length,
      totalCount: Object.keys(d.picks).length,
    };
  }

  generalView(id) {
    const g = GENERAL_MAP[id];
    if (!g) return null;
    return { id: g.id, name: g.name, faction: g.faction, hp: g.hp, maxHp: g.maxHp || g.hp, lord: !!g.lord, skills: g.skills };
  }

  start() {
    if (this.phase !== 'lobby') return { error: '游戏已开始' };
    if (!this.seats.every(Boolean)) return { error: '人未齐，请先补满座位或添加机器人' };
    this.phase = 'draft';
    const players = this.seats.filter(Boolean);
    const ids = { 5: ['lord', 'loyal', 'rebel', 'rebel', 'spy'], 8: ['lord', 'loyal', 'loyal', 'rebel', 'rebel', 'rebel', 'rebel', 'spy'] }[this.mode];
    const shuffled = shuffle(ids.slice());
    for (let i = 0; i < players.length; i++) players[i].identity = shuffled[i];
    const lord = players.find(p => p.identity === 'lord');
    const nonLords = players.filter(p => p !== lord);
    // 实际座次：主公固定 1 号位，其余玩家随机
    this.gameOrder = [lord, ...shuffle(nonLords.slice())].map(p => p.id);
    const lordPool = shuffle(LORD_GENERALS.map(g => g.id));
    const others = shuffle(GENERALS.filter(g => !g.lord).map(g => g.id)).slice(0, 3);
    const lordOptions = [...lordPool, ...others];
    this.available = GENERALS.map(g => g.id);
    // 主公选项中的非主公将若未被选中，仍留在池中
    this.draft = {
      phase: 'lord', lordId: lord.id, lordOptions: shuffle(lordOptions),
      picks: {}, available: this.available,
    };
    for (const p of players) if (p.isBot) p.identity = p.identity;
    this.broadcast();
    this.autoBotDraft();
    return { ok: true };
  }

  autoBotDraft() {
    if (!this.draft) return;
    if (this.draft.phase === 'lord') {
      const lord = this.players.get(this.draft.lordId);
      if (lord && lord.isBot) {
        setTimeout(() => {
          if (!this.draft || this.draft.phase !== 'lord') return;
          const opts = this.draft.lordOptions;
          const lordGenerals = opts.filter(id => GENERAL_MAP[id].lord);
          const pick = (lordGenerals.length ? lordGenerals : opts)[crypto.randomInt((lordGenerals.length ? lordGenerals : opts).length)];
          this.handleAction(lord.id, { action: 'pick', generalId: pick });
        }, 900);
      }
    } else if (this.draft.phase === 'others') {
      for (const [pid, pick] of Object.entries(this.draft.picks)) {
        const p = this.players.get(pid);
        if (p && p.isBot && !pick.chosen) {
          setTimeout(() => {
            if (!this.draft || this.draft.phase !== 'others') return;
            const cur = this.draft.picks[pid];
            if (!cur || cur.chosen) return;
            const id = cur.options[crypto.randomInt(cur.options.length)];
            this.handleAction(pid, { action: 'pick', generalId: id });
          }, 700 + Math.random() * 600);
        }
      }
    }
  }

  handleAction(pid, action) {
    if (!action) return { error: '无效操作' };
    if (!action.action && this.phase !== 'playing') return { error: '无效操作' };
    if (action.action === 'leave' || action.action === 'exit') {
      this.removePlayer(pid);
      return { ok: true };
    }
    const me = this.players.get(pid);
    if (!me) return { error: '不在房间中' };

    if (this.phase === 'lobby') {
      if (action.action === 'addBot') {
        if (this.host !== pid) return { error: '只有房主可以添加机器人' };
        return this.addBot();
      }
      if (action.action === 'removeBot') {
        if (this.host !== pid) return { error: '只有房主可以移除机器人' };
        return this.removeBot(action.seat);
      }
      if (action.action === 'start') {
        if (this.host !== pid) return { error: '只有房主可以开始游戏' };
        return this.start();
      }
      return { error: '未知操作' };
    }

    if (this.phase === 'draft') {
      if (action.action === 'pick') return this.pickGeneral(pid, action.generalId);
      return { error: '选将阶段' };
    }

    if (this.phase === 'playing' && this.game) {
      if (action.action === 'swap') {
        const ok = this.game.swap(pid);
        return ok ? { ok: true } : { error: '现在不能换牌' };
      }
      const ok = this.game.resolveAction(pid, action);
      return ok ? { ok: true } : { error: '现在不需要你操作' };
    }

    if (this.phase === 'over') {
      if (action.action === 'exit') { this.removePlayer(pid); return { ok: true }; }
      return { error: '游戏已结束' };
    }
    return { error: '未知操作' };
  }

  pickGeneral(pid, generalId) {
    const d = this.draft;
    if (!d) return { error: '不在选将阶段' };
    if (!GENERAL_MAP[generalId]) return { error: '无效武将' };
    if (d.phase === 'lord') {
      if (pid !== d.lordId) return { error: '等待主公选将' };
      if (!d.lordOptions.includes(generalId)) return { error: '该武将不在你的选择中' };
      d.lordPick = generalId;
      d.phase = 'others';
      d.available = d.available.filter(id => id !== generalId);
      const nonLords = this.seats.filter(p => p && p.id !== d.lordId);
      const pool = shuffle(d.available.slice());
      let idx = 0;
      for (const p of nonLords) {
        const options = pool.slice(idx, idx + 3);
        idx += 3;
        d.picks[p.id] = { options, chosen: null };
      }
      this.broadcast();
      this.autoBotDraft();
      return { ok: true };
    }
    if (d.phase === 'others') {
      const pick = d.picks[pid];
      if (!pick) return { error: '你不在选将名单中' };
      if (pick.chosen) return { error: '已经选好' };
      if (!pick.options.includes(generalId)) return { error: '该武将不在你的选择中' };
      pick.chosen = generalId;
      this.broadcast();
      this.checkDraftDone();
      return { ok: true };
    }
    return { error: '选将已结束' };
  }

  checkDraftDone() {
    const d = this.draft;
    const all = Object.values(d.picks).every(p => p.chosen);
    if (!all) { this.autoBotDraft(); return; }
    d.phase = 'done';
    const lord = this.players.get(d.lordId);
    const ordered = (this.gameOrder || []).map(id => this.players.get(id)).filter(Boolean);
    const basePlayers = ordered.length === this.seats.filter(Boolean).length ? ordered : this.seats.filter(Boolean);
    const seats = basePlayers.map(p => {
      const generalId = p.id === d.lordId ? d.lordPick : d.picks[p.id].chosen;
      return { id: p.id, name: p.name, isBot: p.isBot, identity: p.identity, generalId, accountId: p.accountId };
    });
    this.phase = 'playing';
    this.game = new Game(this, seats, this.mode);
    this.broadcast();
    this.game.start().catch(e => { console.error('game error', e); });
  }

  onGameOver(winner) {
    this.winner = winner;
    this.phase = 'over';
    this.broadcast();
  }

  isEmpty() {
    return ![...this.players.values()].some(p => !p.isBot);
  }
}

class RoomManager {
  constructor() { this.rooms = new Map(); }
  create(mode, host) {
    let code;
    do { code = makeCode(); } while (this.rooms.has(code));
    const room = new Room(code, mode, host, this);
    this.rooms.set(code, room);
    return room;
  }
  get(code) { return this.rooms.get((code || '').toUpperCase()); }
  findPublic(mode) {
    for (const room of this.rooms.values()) {
      if (room.mode !== mode || room.phase !== 'lobby') continue;
      if (room.seats.some(s => !s)) return room;
    }
    return null;
  }
  cleanup() {
    for (const [code, room] of this.rooms) {
      if (room.isEmpty() && Date.now() - room.createdAt > 60 * 60 * 1000) this.rooms.delete(code);
    }
  }
}

module.exports = { Room, RoomManager, IDENT_NAMES };
