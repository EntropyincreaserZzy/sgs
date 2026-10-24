'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const FACTION = { shu: '蜀', wei: '魏', wu: '吴', qun: '群' };
const IDENT = { lord: '主公', loyal: '忠臣', rebel: '反贼', spy: '内奸' };
const FCOLOR = { shu: '#d1685a', wei: '#6f9cc4', wu: '#6cb28a', qun: '#a996c4' };

const S = {
  session: null, state: null, es: null, mode: 8,
  sel: null, pendingSel: [], selectedGeneral: null,
  data: null, encTab: 'generals', encFilter: 'all', encQuery: '',
  modalOptions: [], retry: 0, lastReq: null, view: 'home',
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function attrChoice(v) { return esc(encodeURIComponent(JSON.stringify(v))); }
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2400);
}
function pips(hp, max) {
  let s = '';
  for (let i = 0; i < max; i++) s += `<span class="hp-pip ${i < hp ? 'full' : 'empty'}"></span>`;
  return s;
}
function factionClass(f) { return 'faction-' + (f || 'qun'); }
function identName(id) { return IDENT[id] || ''; }

// ---------- 初始化 ----------
function init() {
  bindHome();
  const saved = sessionStorage.getItem('sgs_session');
  if (saved) {
    try { S.session = JSON.parse(saved); $('#input-name').value = S.session.name || ''; connect(); } catch (e) { }
  }
  setInterval(() => {
    const el = $('#swap-timer');
    if (!el || !S.state || !S.state.game) return;
    const left = Math.max(0, Math.ceil((S.state.game.swapEnds - Date.now()) / 1000));
    el.textContent = left;
  }, 300);
}

function bindHome() {
  $('#input-name').value = localStorage.getItem('sgs_name') || '';
  $('#input-name').addEventListener('input', e => localStorage.setItem('sgs_name', e.target.value));
  $$('.mode-btn').forEach(b => b.addEventListener('click', () => {
    S.mode = Number(b.dataset.mode);
    $$('.mode-btn').forEach(x => x.classList.toggle('active', x === b));
  }));
  $('#btn-create').addEventListener('click', () => join('create'));
  $('#btn-match').addEventListener('click', () => join('match'));
  $('#btn-join').addEventListener('click', () => join('join'));
  $('#input-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  $('#input-code').addEventListener('keydown', e => { if (e.key === 'Enter') join('join'); });
  $('#input-name').addEventListener('keydown', e => { if (e.key === 'Enter') join('create'); });
  $('#brand').addEventListener('click', () => goHome());
  $('#nav-home').addEventListener('click', () => goHome());
  $('#nav-encyclopedia').addEventListener('click', () => { showScreen('enc'); renderEncyclopedia(); });
}

async function join(action) {
  const name = $('#input-name').value.trim();
  if (!name) return toast('请先输入昵称');
  const body = { name, mode: S.mode, action };
  if (action === 'join') {
    const code = $('#input-code').value.trim().toUpperCase();
    if (code.length !== 8) return toast('请输入 8 位房间码');
    body.code = code;
  }
  const btn = action === 'create' ? $('#btn-create') : action === 'match' ? $('#btn-match') : $('#btn-join');
  btn.disabled = true;
  try {
    const r = await fetch('/api/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) { toast(j.error || '进入失败'); return; }
    S.session = { room: j.room, pid: j.pid, token: j.token, name, mode: j.mode };
    sessionStorage.setItem('sgs_session', JSON.stringify(S.session));
    connect();
  } catch (e) { toast('网络错误'); }
  finally { btn.disabled = false; }
}

function connect() {
  if (!S.session) return;
  if (S.es) { S.es.close(); S.es = null; }
  const { room, pid, token } = S.session;
  const url = `/api/events?room=${encodeURIComponent(room)}&pid=${encodeURIComponent(pid)}&token=${encodeURIComponent(token)}`;
  const es = new EventSource(url);
  S.es = es;
  es.onopen = () => { S.retry = 0; };
  es.onmessage = (e) => {
    try {
      const d = JSON.parse(e.data);
      if (d.type === 'state' && d.state) applyState(d.state);
    } catch (_) { }
  };
  es.onerror = () => {
    es.close();
    if (S.retry < 5) { S.retry++; setTimeout(connect, 1200); }
    else { toast('连接已断开'); }
  };
}

function applyState(st) {
  S.state = st;
  S.retry = 0;
  const reqId = st.game && st.game.pending ? st.game.pending.reqId : null;
  if (reqId !== S.lastReq) {
    S.lastReq = reqId; S.sel = null; S.pendingSel = []; S.modalOptions = [];
    const m = $('#modal'); if (m) m.classList.add('hidden');
  }
  if (S.view !== 'enc') {
    if (st.phase === 'lobby' || st.phase === 'draft') showScreen('room');
    else if (st.phase === 'playing' || st.phase === 'over') showScreen('game');
  }
  render();
}

function showScreen(name) {
  S.view = name;
  for (const id of ['home', 'room', 'game', 'enc']) {
    const el = $('#screen-' + id);
    if (el) el.classList.toggle('hidden', id !== name);
  }
}

function goHome() {
  if (S.session && S.state) {
    if (S.state.phase === 'playing' || S.state.phase === 'over') showScreen('game');
    else showScreen('room');
  } else showScreen('home');
}

function clearSession() {
  sessionStorage.removeItem('sgs_session');
  if (S.es) { S.es.close(); S.es = null; }
  S.session = null; S.state = null; S.sel = null; S.pendingSel = [];
  showScreen('home');
}

function render() {
  if (!S.state) { showScreen('home'); return; }
  if (S.state.phase === 'lobby' || S.state.phase === 'draft') renderRoom();
  else if (S.state.phase === 'playing' || S.state.phase === 'over') renderGame();
}

// ---------- 房间 / 选将 ----------
function renderRoom() {
  const st = S.state;
  if (!st) return;
  const isHost = st.isHost;
  const emptyCount = st.seats.filter(s => !s.id).length;
  const seatHtml = st.seats.map((s, i) => {
    if (!s.id) {
      return `<div class="seat-card empty" ${isHost ? 'data-act="add-bot"' : ''}>
        <div class="seat-num">${i + 1}号位</div>
        <div>空位</div>
        <div class="seat-tags">${isHost ? '<span class="tag">点击添加机器人</span>' : '<span class="tag">等待玩家</span>'}</div>
      </div>`;
    }
    const tags = [];
    if (s.id === st.host) tags.push('<span class="tag host">房主</span>');
    if (s.isBot) tags.push('<span class="tag bot">机器人</span>');
    if (s.id === st.you) tags.push('<span class="tag you">你</span>');
    if (!s.connected && !s.isBot) tags.push('<span class="tag">离线</span>');
    return `<div class="seat-card ${s.id === st.you ? 'is-you' : ''}" data-act="${s.isBot && isHost ? 'remove-bot' : 'noop'}" data-seat="${i}">
      <div class="seat-num">${i + 1}号位</div>
      <div class="seat-name">${esc(s.name)}</div>
      <div class="seat-tags">${tags.join('')}</div>
    </div>`;
  }).join('');

  const draftHtml = st.draft ? renderDraft(st.draft) : '';
  $('#room-root').innerHTML = `<div class="room-wrap">
    <div class="room-head">
      <div>
        <div class="room-code-label">房间码</div>
        <div class="room-code">${esc(st.code)}</div>
        <div class="room-meta">${st.mode} 人军争 · ${st.phase === 'lobby' ? '等待玩家' : '选将阶段'}</div>
      </div>
      <div class="room-actions">
        <button class="btn small" data-act="copy-code">复制房间码</button>
        ${isHost && st.phase === 'lobby' ? `<button class="btn small" data-act="add-bot">添加机器人</button>` : ''}
        ${isHost && st.phase === 'lobby' ? `<button class="btn primary small" data-act="start" ${st.canStart ? '' : 'disabled'}>开始游戏</button>` : ''}
        <button class="btn ghost small" data-act="leave">离开</button>
      </div>
    </div>
    <div class="seats-grid">${seatHtml}</div>
    ${isHost && st.phase === 'lobby' && !st.canStart ? `<p class="home-hint">还差 ${emptyCount} 人，可点击空位添加机器人补位。</p>` : ''}
    ${draftHtml}
  </div>`;
  bindRoom();
}

function bindRoom() { }

function renderDraft(d) {
  if (!d) return '';
  const opts = d.options || [];
  if (S.selectedGeneral && !opts.some(g => g.id === S.selectedGeneral)) S.selectedGeneral = null;
  const selected = S.selectedGeneral;
  if (d.phase === 'done') {
    return `<div class="draft-wrap"><div class="draft-head"><div class="draft-title">选将完成</div><div class="draft-sub">正在发牌，准备进入对局…</div></div><div class="waiting-box">所有玩家已选将，游戏即将开始</div></div>`;
  }
  if (!opts.length) {
    return `<div class="draft-wrap"><div class="draft-head"><div class="draft-title">选将阶段</div><div class="draft-sub">${d.phase === 'lord' ? '主公正在选将' : '等待其他玩家选将'}</div></div>
      <div class="waiting-box">${d.phase === 'lord' ? `等待主公 ${esc(d.lordName || '')} 选择武将…` : '等待其他玩家选将…'}</div></div>`;
  }
  if (d.chosen) {
    const g = opts.find(x => x.id === d.chosen);
    return `<div class="draft-wrap"><div class="draft-head"><div class="draft-title">已选武将</div><div class="draft-sub">${d.pickedCount || 0} / ${d.totalCount || 0} 人已选</div></div>
      <div class="general-grid">${g ? generalCard(g, {}) : ''}</div>
      <div class="waiting-box">等待其他玩家选将…</div></div>`;
  }
  const title = d.phase === 'lord' ? '主公选将' : '选择你的武将';
  const sub = d.phase === 'lord' ? '主公可从全部主公将及三名随机非主公将中选择' : `从以下三名武将中选择一名 · 已选 ${d.pickedCount || 0}/${d.totalCount || 0}`;
  return `<div class="draft-wrap">
    <div class="draft-head"><div class="draft-title">${title}</div><div class="draft-sub">${sub}</div></div>
    <div class="general-grid">${opts.map(g => generalCard(g, { selected: g.id === selected, act: 'select-general' })).join('')}</div>
    <div class="draft-actions">
      <button class="btn primary" data-act="pick-general" ${selected ? '' : 'disabled'}>确定选择</button>
      <span class="draft-sub">${selected ? '已选中：' + esc((opts.find(x => x.id === selected) || {}).name || '') : '请点击一张武将牌'}</span>
    </div>
  </div>`;
}

function generalCard(g, opts = {}) {
  const act = opts.act ? `data-act="${opts.act}" data-general="${g.id}"` : '';
  return `<div class="general-card ${opts.selected ? 'selected' : ''}" ${act} style="--fac:${FCOLOR[g.faction] || '#c9a45c'}">
    ${g.lord ? '<div class="general-lord">主公将</div>' : ''}
    <div class="general-top">
      <div class="general-name">${esc(g.name)}</div>
      <div class="general-faction ${factionClass(g.faction)}">${FACTION[g.faction] || '群'}</div>
    </div>
    <div class="general-hp">${pips(g.hp, g.maxHp || g.hp)}</div>
    ${(g.skills || []).map(s => `<div class="skill-line"><div class="skill-name">${esc(s.name)}${s.type === 'lord' ? ' · 主公技' : ''}</div><div class="skill-desc">${esc(s.desc)}</div></div>`).join('')}
  </div>`;
}

// ---------- 对局 ----------
function renderGame() {
  const st = S.state;
  const g = st && st.game;
  if (!g) { $('#game-root').innerHTML = '<div class="waiting-box">加载对局中…</div>'; return; }
  const you = g.you;
  const pending = g.pending;
  const opts = (pending && pending.type === 'action') ? (pending.options || []) : (you ? (you.playOptions || []) : []);
  const isPlayPhase = pending && pending.type === 'action';
  const playMap = {};
  for (const o of opts) (playMap[o.cardId] = playMap[o.cardId] || []).push(o);

  const n = g.players.length;
  const youIndex = g.players.findIndex(p => you && p.id === you.id);
  const seats = g.players.map((p, i) => seatHtml(p, n, i, g, youIndex)).join('');
  const center = `<div class="table-center">
    <div class="turn-info">${g.winner ? '对局结束' : (g.turn === (you && you.id) ? '<b>轮到你</b>' : (g.turnName ? '当前：<b>' + esc(g.turnName) + '</b>' : '等待开始'))}</div>
    <div class="piles">
      <div class="pile"><div class="pile-stack"></div><div class="pile-label">牌堆 ${g.deckCount}</div></div>
      <div class="pile"><div class="pile-stack"></div><div class="pile-label">弃牌 ${g.discardCount}</div></div>
    </div>
    ${g.discardTop ? `<div class="turn-info">弃牌堆顶：${esc(g.discardTop.suit + g.discardTop.rank + g.discardTop.name)}</div>` : ''}
  </div>`;

  const handOverlap = you ? (you.hand.length > 16 ? -38 : you.hand.length > 12 ? -32 : you.hand.length > 8 ? -24 : -18) : -18;
  const handHtml = you ? you.hand.map((c, idx) => {
    let cls = 'hand-card';
    let disabled = false;
    if (pending) {
      if (pending.type === 'card') disabled = !(pending.validCards || []).some(x => x.id === c.id);
      else if (pending.type === 'cards') disabled = !(pending.validCards || []).some(x => x.id === c.id);
      else if (pending.type === 'target') disabled = true;
      else if (pending.type === 'action') disabled = !playMap[c.id];
      else disabled = true;
    } else disabled = true;
    if (disabled) cls += ' disabled';
    if (S.pendingSel.includes(c.id)) cls += ' selected';
    if (pending && pending.type === 'card' && !disabled) cls += ' card-pending';
    return `<div class="${cls}" style="margin-left:${idx === 0 ? 0 : handOverlap}px" data-act="card" data-card-id="${c.id}">${cardHtml(c)}</div>`;
  }).join('') : '';

  const prompt = promptHtml(g);
  const action = actionHtml(g, pending, you);
  const log = renderLog(g);
  const picker = pickerHtml(g, pending, you);
  const overlay = g.winner ? overlayHtml(g) : '';

  $('#game-root').innerHTML = `<div class="game-stage">
    <div class="game-table">${seats}${center}</div>
    <div class="hand-area"><div class="hand-inner">${handHtml || (you && you.alive === false ? '<div class="waiting-box">你已阵亡，观战中</div>' : '')}</div></div>
    ${action}
    ${prompt}
    ${log}
    ${picker}
    ${overlay}
  </div>`;
  const lb = document.querySelector('.log-body');
  if (lb) lb.scrollTop = lb.scrollHeight;
}

function seatHtml(p, n, i, g, youIndex) {
  const rel = youIndex >= 0 ? (i - youIndex + n) % n : i;
  const ang = (90 + rel * 360 / n) * Math.PI / 180;
  const x = 50 + 42 * Math.cos(ang);
  const y = 50 + 32 * Math.sin(ang);
  let cls = 'seat';
  if (p.id === g.you?.id) cls += ' is-you';
  if (p.id === g.turn) cls += ' is-turn';
  if (!p.alive) cls += ' is-dead';
  if (S.sel && (S.sel.opt.targets || []).includes(p.id)) {
    cls += ' is-selectable';
    if (S.sel.targets.includes(p.id)) cls += ' is-targeted';
  }
  let pendingTarget = false;
  if (g.pending && g.pending.type === 'target' && (g.pending.valid || []).includes(p.id)) pendingTarget = true;
  if (pendingTarget) cls += ' is-selectable';
  const ident = p.identity ? `<span class="seat-ident ${p.identity}">${identName(p.identity)}</span>` : '';
  const equips = [];
  for (const k of ['weapon', 'armor', 'horsePlus', 'horseMinus']) {
    const c = p.equip && p.equip[k];
    if (c) equips.push(`<span class="mini-tag">${esc(c.name)}</span>`);
  }
  const judges = (p.judge || []).map(c => `<span class="mini-tag judge">${esc(c.name)}</span>`).join('');
  const marks = [];
  if (p.marks) {
    if (p.marks.rende) marks.push(`<span class="mini-tag mark">仁德×${p.marks.rende}</span>`);
    if (p.marks.yi) marks.push(`<span class="mini-tag mark">义</span>`);
    if (p.marks.jian) marks.push(`<span class="mini-tag mark">间×${p.marks.jian}</span>`);
    if (p.marks.kongcheng) marks.push(`<span class="mini-tag mark">空城×${p.marks.kongcheng}</span>`);
  }
  if (p.chained) marks.push(`<span class="mini-tag judge">横置</span>`);
  if (p.charge !== undefined) marks.push(`<span class="mini-tag mark">充能${p.charge}</span>`);
  if (p.qingguoLevel) marks.push(`<span class="mini-tag mark">倾国${p.qingguoLevel}</span>`);
  return `<div class="${cls}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%" data-act="seat" data-pid="${p.id}">
    <div class="seat-top">
      <div class="avatar ${factionClass(p.general.faction)}">${esc(p.general.name[0] || '?')}</div>
      <div class="seat-namebox">
        <div class="seat-name" title="${esc(p.name)}">${esc(p.name)}</div>
        <div class="seat-general">${esc(p.general.name)}${p.identity === 'lord' ? ' · 主公' : ''}</div>
      </div>
      ${ident}
    </div>
    <div class="seat-hp">${pips(p.hp, p.maxHp)}</div>
    <div class="seat-meta"><span>手牌 <b class="seat-handcount">${p.handCount}</b></span><span>${p.alive ? (p.id === g.turn ? '行动中' : '') : '阵亡'}</span></div>
    <div class="seat-cards">${equips.join('')}${judges}${marks.join('')}</div>
  </div>`;
}

function cardHtml(c) {
  const red = c.suit === '♥' || c.suit === '♦';
  return `<div class="card ${red ? 'suit-red' : 'suit-black'}">
    <div class="card-corner"><span class="suit">${c.suit}</span><span class="rank">${c.rank}</span></div>
    <div class="card-name">${esc(c.name)}</div>
    <div class="card-sub">${cardTypeLabel(c)}</div>
    ${c.marked ? '<div class="card-mark">英</div>' : ''}
  </div>`;
}

function cardTypeLabel(c) {
  if (c.type === 'basic') return '基本';
  if (c.type === 'trick') return c.kind === 'le' || c.kind === 'bingliang' || c.kind === 'shandian' ? '延时锦囊' : '锦囊';
  if (c.type === 'equip') return c.subtype === 'weapon' ? '武器' : c.subtype === 'armor' ? '防具' : '坐骑';
  return '';
}

function actionHtml(g, pending, you) {
  if (g.winner || !you) return '';
  let html = '';
  if (g.phase === 'swap' && you.canSwap) {
    html += `<button class="end-btn swap-btn" data-act="swap">换牌（限一次）</button>`;
  }
  if (pending && pending.type === 'action') {
    for (const s of (pending.skills || [])) {
      html += `<button class="skill-btn" data-act="skill" data-skill="${s.id}" title="${esc(s.desc || '')}">${esc(s.name)}</button>`;
    }
    html += `<button class="end-btn" data-act="end">结束出牌</button>`;
  }
  if (!html) return '';
  return `<div class="action-bar">${html}</div>`;
}

function promptHtml(g) {
  if (g.winner) return '';
  const p = g.pending;
  const you = g.you;
  if (S.sel) {
    const { opt, targets } = S.sel;
    const max = opt.maxTargets || 1;
    const min = opt.minTargets || (max === 1 ? 1 : 0);
    return `<div class="prompt-bar"><div class="prompt-text">选择目标：已选 ${targets.length} / 最多 ${max}${targets.length < min ? '（至少 ' + min + '）' : ''}</div>
      <div class="prompt-actions">
        <button class="btn small" data-act="confirm-targets" ${targets.length < min ? 'disabled' : ''}>确认</button>
        <button class="btn ghost small" data-act="cancel-targets">取消</button>
      </div></div>`;
  }
  if (p && p.type === 'cards') {
    const need = p.count || 0;
    return `<div class="prompt-bar"><div class="prompt-text">${esc(p.prompt || '选择牌')}（已选 ${S.pendingSel.length} / ${need}）</div>
      <div class="prompt-actions">
        <button class="btn small" data-act="confirm-cards" ${S.pendingSel.length === need ? '' : 'disabled'}>确认</button>
        ${p.optional ? '<button class="btn ghost small" data-act="cancel">取消</button>' : ''}
      </div></div>`;
  }
  if (p && p.type === 'card') {
    return `<div class="prompt-bar"><div class="prompt-text">${esc(p.prompt || ('请打出【' + (p.need || '') + '】'))}</div>
      <div class="prompt-actions">${p.optional ? '<button class="btn ghost small" data-act="cancel">放弃</button>' : ''}</div></div>`;
  }
  if (p && p.type === 'target') {
    return `<div class="prompt-bar"><div class="prompt-text">${esc(p.prompt || '选择目标')}</div>
      <div class="prompt-actions">${p.optional ? '<button class="btn ghost small" data-act="cancel">取消</button>' : ''}</div></div>`;
  }
  if (p && p.type === 'choice') {
    const opts = (p.options || []).map(o => {
      const v = o && typeof o === 'object' ? o.value : o;
      const label = o && typeof o === 'object' ? o.label : String(o);
      return `<button class="btn small" data-act="choice" data-choice="${attrChoice(v)}">${esc(label)}</button>`;
    }).join('');
    return `<div class="prompt-bar"><div class="prompt-text">${esc(p.prompt || '请选择')}</div><div class="prompt-actions">${opts}</div></div>`;
  }
  if (p && p.type === 'suit') {
    const opts = (p.options || ['♠', '♥', '♣', '♦']).map(s => `<button class="btn small" data-act="suit" data-suit="${s}">${s}</button>`).join('');
    return `<div class="prompt-bar"><div class="prompt-text">${esc(p.prompt || '选择花色')}</div><div class="prompt-actions">${opts}</div></div>`;
  }
  if (g.phase === 'swap') {
    const left = Math.max(0, Math.ceil((g.swapEnds - Date.now()) / 1000));
    return `<div class="prompt-bar"><div class="prompt-text">看牌阶段：<b>5 秒</b>内可换一次牌，剩余 <b id="swap-timer">${left}</b> 秒</div>
      <div class="prompt-actions">${you && you.canSwap ? '<button class="btn small" data-act="swap">换牌</button>' : '<span class="tag">已换牌</span>'}</div></div>`;
  }
  if (p && p.type === 'action') {
    return `<div class="prompt-bar"><div class="prompt-text">出牌阶段：点击手牌使用，或点击「结束出牌」</div></div>`;
  }
  if (you && !you.alive) {
    return `<div class="prompt-bar"><div class="prompt-text">你已阵亡，观战中</div></div>`;
  }
  return `<div class="prompt-bar"><div class="prompt-text">等待 <b>${esc(g.turnName || '其他玩家')}</b> 操作…</div></div>`;
}

function renderLog(g) {
  const lines = (g.logs || []).map(l => {
    let cls = 'log-line';
    if (/受到|阵亡|濒死/.test(l.msg)) cls += ' dmg';
    if (/回合|游戏开始|胜利|判定/.test(l.msg)) cls += ' hl';
    return `<div class="${cls}">${esc(l.msg)}</div>`;
  }).join('');
  return `<div class="log-panel"><div class="log-head">战 报</div><div class="log-body">${lines}</div></div>`;
}

function pickerHtml(g, p, you) {
  if (!p || p.type !== 'cards' || !you) return '';
  const cards = p.validCards || [];
  if (!cards.length) return '';
  const ids = cards.map(c => c.id);
  const inHand = ids.every(id => (you.hand || []).some(c => c.id === id));
  if (inHand) return '';
  const count = p.count || 1;
  return `<div class="overlay card-picker">
    <div class="overlay-card" data-act="noop">
      <div class="modal-title">${esc(p.prompt || '选择一张牌')}</div>
      <div class="picker-grid">${cards.map(c => `<div class="picker-card ${S.pendingSel.includes(c.id) ? 'selected' : ''}" data-act="pick-card" data-id="${c.id}">${cardHtml(c)}</div>`).join('')}</div>
      <div class="draft-sub">已选 ${S.pendingSel.length} / ${count}</div>
      ${count > 1 ? `<div style="margin-top:12px"><button class="btn small" data-act="confirm-cards" ${S.pendingSel.length === count ? '' : 'disabled'}>确认</button></div>` : ''}
      ${p.optional ? `<div style="margin-top:10px"><button class="btn ghost small" data-act="cancel">取消</button></div>` : ''}
    </div>
  </div>`;
}

function overlayHtml(g) {
  const title = g.winner === 'lord' ? '主忠胜利' : g.winner === 'rebel' ? '反贼胜利' : '内奸胜利';
  const cls = g.winner === 'lord' ? 'lord' : g.winner === 'rebel' ? 'rebel' : 'spy';
  const hands = {};
  for (const h of (g.allHands || [])) hands[h.id] = h.hand || [];
  const identMap = {};
  for (const x of (g.identities || [])) identMap[x.id] = x.identity;
  const reveal = (g.players || []).map(p => {
    const hs = hands[p.id] || [];
    const ident = identMap[p.id] || p.identity;
    return `<div class="reveal-player">
      <div class="reveal-name">${esc(p.name)} · ${esc(p.general.name)}<span class="reveal-ident">${identName(ident)}</span></div>
      <div class="reveal-hand">${hs.length ? hs.map(c => `<span class="reveal-card">${c.suit}${c.rank}${esc(c.name)}</span>`).join('') : '<span class="reveal-card">无手牌</span>'}</div>
    </div>`;
  }).join('');
  return `<div class="overlay" data-act="overlay-exit">
    <div class="overlay-card" data-act="noop">
      <div class="winner-title ${cls}">${title}</div>
      <div class="winner-sub">身份与剩余手牌</div>
      <div class="reveal-grid">${reveal}</div>
      <div class="overlay-hint">点击空白处退出</div>
      <div style="margin-top:14px"><button class="btn small" data-act="exit">退出房间</button></div>
    </div>
  </div>`;
}

// ---------- 交互 ----------
async function send(action) {
  if (!S.session) return;
  if (action && S.state && S.state.game && S.state.game.pending && !action.reqId) action.reqId = S.state.game.pending.reqId;
  const body = { room: S.session.room, pid: S.session.pid, token: S.session.token, action };
  try {
    const r = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) toast(j.error || '操作失败');
  } catch (e) { toast('网络错误'); }
  S.sel = null; S.pendingSel = [];
  render();
}

function onCard(cardId) {
  const g = S.state && S.state.game;
  if (!g) return;
  const p = g.pending;
  if (p) {
    if (p.type === 'card') {
      if ((p.validCards || []).some(c => c.id === cardId)) send({ cardId });
      else toast('这张牌不能响应');
      return;
    }
    if (p.type === 'cards') {
      if (!(p.validCards || []).some(c => c.id === cardId)) return;
      const i = S.pendingSel.indexOf(cardId);
      if (i >= 0) S.pendingSel.splice(i, 1); else S.pendingSel.push(cardId);
      if (p.count === 1) { const id = S.pendingSel[0]; S.pendingSel = []; send({ cardIds: [id] }); }
      else render();
      return;
    }
    return;
  }
  if (!g.you) return;
  if (S.sel) { S.sel = null; render(); return; }
  const opts = (g.you.playOptions || []).filter(o => o.cardId === cardId);
  if (!opts.length) return toast('现在不能使用这张牌');
  if (opts.length === 1) chooseOption(opts[0]);
  else showOptionModal(opts);
}

function chooseOption(opt) {
  if (!opt) return;
  if (opt.targetMode === 'none') return send({ action: 'play', cardId: opt.cardId, as: opt.as, targets: [] });
  if (opt.targetMode === 'self') return send({ action: 'play', cardId: opt.cardId, as: opt.as, targets: [S.state.game.you.id] });
  S.sel = { opt, targets: [] };
  render();
}

function showOptionModal(opts) {
  S.modalOptions = opts;
  const html = opts.map((o, i) => `<button class="btn" data-act="modal-option" data-index="${i}">${esc(optionLabel(o))}</button>`).join('');
  $('#modal').innerHTML = `<div class="modal-card" data-act="noop"><div class="modal-title">选择使用方式</div><div class="modal-options">${html}</div><button class="btn ghost small modal-close" data-act="close-modal">取消</button></div>`;
  $('#modal').classList.remove('hidden');
}

function optionLabel(o) {
  const t = o.as === o.name ? '' : `（当【${o.as}】）`;
  if (o.type === 'equip' && o.as === o.name) return `装备【${o.name}】`;
  if (o.targetMode === 'self') return `使用【${o.as}】`;
  if (o.targetMode === 'none') return `使用【${o.as}】`;
  return `使用【${o.as}】${t}`;
}

function onSeat(pid) {
  const g = S.state && S.state.game;
  if (!g) return;
  if (S.sel) {
    const { opt, targets } = S.sel;
    if (!(opt.targets || []).includes(pid)) return;
    if ((opt.maxTargets || 1) === 1) {
      S.sel = null;
      send({ action: 'play', cardId: opt.cardId, as: opt.as, targets: [pid] });
      return;
    }
    const i = targets.indexOf(pid);
    if (i >= 0) targets.splice(i, 1);
    else if (targets.length < (opt.maxTargets || 1)) targets.push(pid);
    render();
    return;
  }
  const p = g.pending;
  if (p && p.type === 'target' && (p.valid || []).includes(pid)) send({ targetId: pid });
}

function exitGame() {
  send({ action: 'exit' });
  setTimeout(clearSession, 120);
}
function leaveRoom() {
  send({ action: 'leave' });
  setTimeout(clearSession, 120);
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'noop') return;
  if (act === 'card') return onCard(el.dataset.cardId);
  if (act === 'pick-card') {
    const p = S.state && S.state.game && S.state.game.pending;
    if (!p || p.type !== 'cards') return;
    const id = el.dataset.id;
    const i = S.pendingSel.indexOf(id);
    if (i >= 0) S.pendingSel.splice(i, 1); else S.pendingSel.push(id);
    if ((p.count || 1) === 1) { const x = S.pendingSel[0]; S.pendingSel = []; return send({ cardIds: [x] }); }
    render();
    return;
  }
  if (act === 'seat') return onSeat(el.dataset.pid);
  if (act === 'choice') { try { return send({ value: JSON.parse(decodeURIComponent(el.dataset.choice)) }); } catch (_) { return; } }
  if (act === 'suit') return send({ suit: el.dataset.suit });
  if (act === 'skill') return send({ action: 'skill', skill: el.dataset.skill });
  if (act === 'end') return send({ action: 'end' });
  if (act === 'swap') return send({ action: 'swap' });
  if (act === 'cancel') {
    const p = S.state?.game?.pending;
    if (!p) return;
    if (p.type === 'card') return send({ cardId: null });
    if (p.type === 'target') return send({ targetId: null });
    if (p.type === 'cards') return send({ cardIds: [] });
    S.pendingSel = []; render();
    return;
  }
  if (act === 'cancel-targets') { S.sel = null; render(); return; }
  if (act === 'cancel-cards') { S.pendingSel = []; render(); return; }
  if (act === 'confirm-targets') {
    if (!S.sel) return;
    const { opt, targets } = S.sel;
    S.sel = null;
    return send({ action: 'play', cardId: opt.cardId, as: opt.as, targets });
  }
  if (act === 'confirm-cards') {
    const ids = S.pendingSel.slice();
    S.pendingSel = [];
    return send({ cardIds: ids });
  }
  if (act === 'modal-option') { const o = S.modalOptions[Number(el.dataset.index)]; $('#modal').classList.add('hidden'); return chooseOption(o); }
  if (act === 'close-modal') { $('#modal').classList.add('hidden'); return; }
  if (act === 'select-general') { S.selectedGeneral = el.dataset.general; renderRoom(); return; }
  if (act === 'pick-general') {
    if (!S.selectedGeneral) return toast('请先选择一名武将');
    const id = S.selectedGeneral; S.selectedGeneral = null;
    return send({ action: 'pick', generalId: id });
  }
  if (act === 'add-bot') return send({ action: 'addBot' });
  if (act === 'remove-bot') return send({ action: 'removeBot', seat: Number(el.dataset.seat) });
  if (act === 'start') return send({ action: 'start' });
  if (act === 'leave') return leaveRoom();
  if (act === 'copy-code') {
    if (!S.state) return;
    navigator.clipboard?.writeText(S.state.code).then(() => toast('房间码已复制')).catch(() => toast('复制失败'));
    return;
  }
  if (act === 'overlay-exit') { if (e.target === el) exitGame(); return; }
  if (act === 'exit') return exitGame();
  if (act === 'tab') { S.encTab = el.dataset.tab; renderEncyclopedia(); return; }
  if (act === 'filter') { S.encFilter = el.dataset.filter; renderEncyclopedia(); return; }
});

$('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) $('#modal').classList.add('hidden'); });

// ---------- 图鉴 ----------
async function renderEncyclopedia() {
  const root = $('#encyclopedia-root');
  if (!S.data) {
    root.innerHTML = '<div class="waiting-box">加载图鉴中…</div>';
    try { const r = await fetch('/api/data'); S.data = await r.json(); } catch (e) { root.innerHTML = '<div class="waiting-box">加载失败</div>'; return; }
  }
  const gens = S.data.generals || [];
  const cards = S.data.cards || {};
  const deck = S.data.deck || [];
  const tabs = `<div class="tabs"><button class="tab ${S.encTab === 'generals' ? 'active' : ''}" data-act="tab" data-tab="generals">武将（${gens.length}）</button><button class="tab ${S.encTab === 'cards' ? 'active' : ''}" data-act="tab" data-tab="cards">牌堆（${deck.reduce((a, b) => a + b[1], 0)}）</button></div>`;
  let body = '';
  if (S.encTab === 'generals') {
    const filters = [['all', '全部'], ['shu', '蜀'], ['wei', '魏'], ['wu', '吴'], ['qun', '群']]
      .map(([k, n]) => `<button class="filter-btn ${S.encFilter === k ? 'active' : ''}" data-act="filter" data-filter="${k}">${n}</button>`).join('');
    const q = S.encQuery.trim();
    const list = gens.filter(g => (S.encFilter === 'all' || g.faction === S.encFilter) && (!q || g.name.includes(q) || g.skills.some(s => s.name.includes(q) || s.desc.includes(q))));
    body = `<div class="enc-toolbar">${filters}<input id="enc-search" class="input" placeholder="搜索武将 / 技能" value="${esc(q)}"></div>
      <div class="general-grid">${list.map(g => generalCard(g, {})).join('')}</div>`;
  } else {
    const q = S.encQuery.trim();
    const typeName = t => t === 'basic' ? '基本牌' : t === 'trick' ? '锦囊牌' : '装备牌';
    const groups = { basic: [], trick: [], equip: [] };
    for (const [name, count] of deck) {
      const def = cards[name];
      if (!def) continue;
      if (q && !name.includes(q) && !(def.desc || '').includes(q)) continue;
      (groups[def.type] || (groups[def.type] = [])).push([name, count, def]);
    }
    body = `<div class="enc-toolbar"><input id="enc-search" class="input" placeholder="搜索牌名 / 描述" value="${esc(q)}"></div>`;
    for (const t of ['basic', 'trick', 'equip']) {
      if (!groups[t] || !groups[t].length) continue;
      body += `<h3 style="color:#c9a45c;letter-spacing:3px;margin:22px 0 10px">${typeName(t)}</h3>
        <div class="card-list">${groups[t].map(([name, count, def]) => `<div class="card-entry"><span class="card-entry-type">×${count}</span><div class="card-entry-name">${esc(name)}</div><div class="card-entry-desc">${esc(def.desc || '')}</div></div>`).join('')}</div>`;
    }
  }
  root.innerHTML = `<div class="enc-wrap"><h1 class="enc-title">武将 · 牌堆</h1><div class="enc-sub">三十二将 · 军争牌堆 · 点击上方标签切换</div>${tabs}${body}</div>`;
  const inp = $('#enc-search');
  if (inp) {
    inp.addEventListener('input', () => {
      S.encQuery = inp.value;
      renderEncyclopedia();
      const n = $('#enc-search');
      if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    });
  }
}

init();
