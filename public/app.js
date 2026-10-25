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
  guicaiTopIndex: null, guicaiHandId: null,
  arrange: null, arrangeKey: null, dragId: null, thinkTimer: null,
  lastPlaySeq: 0, lastPlayRoom: null,
  lastDrawSeq: 0, lastDrawRoom: null,
  tableCard: null, tableCardAt: 0, tableCardTimer: null, tableCardRoom: null,
  zhangba: null, zhangbaSel: [],
  account: null, authView: 'auth', authTab: 'login', authError: '', authBusy: false,
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
  bindAuth();
  loadAccount();
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
  $('#input-name').addEventListener('input', e => { if (!S.account) localStorage.setItem('sgs_name', e.target.value); });
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
  $('#nav-account').addEventListener('click', () => { if (S.account) openProfile(); else openAuth('login'); });
}

function bindAuth() {
  const modal = $('#auth-modal');
  if (!modal) return;
  modal.addEventListener('keydown', e => {
    if (e.key === 'Enter' && S.authView === 'auth') { e.preventDefault(); doAuth(); }
  });
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

// ---------- 账号 ----------
async function loadAccount() {
  try {
    const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (r.ok) { const j = await r.json(); S.account = j.user || null; }
    else S.account = null;
  } catch (e) { S.account = null; }
  renderAccount();
}

function renderAccount() {
  const btn = $('#nav-account');
  if (btn) {
    btn.textContent = S.account ? S.account.displayName : '登录 / 注册';
    btn.classList.toggle('logged-in', !!S.account);
    btn.title = S.account ? `已登录：@${S.account.username}` : '登录或注册账号';
  }
  const name = $('#input-name');
  if (name) {
    if (S.account) { name.value = S.account.displayName; name.readOnly = true; name.classList.add('locked'); }
    else { name.readOnly = false; name.classList.remove('locked'); if (!name.value) name.value = localStorage.getItem('sgs_name') || ''; }
  }
  const hint = $('#home-account-hint');
  if (hint) hint.innerHTML = S.account
    ? `已登录：<b>${esc(S.account.displayName)}</b> · <button class="link-btn" data-act="open-profile">我的账号 / 战绩</button>`
    : '登录后可跨设备使用同一账号并保存战绩：<button class="link-btn" data-act="open-auth" data-tab="login">登录</button> · <button class="link-btn" data-act="open-auth" data-tab="register">注册</button>';
}

function openAuth(tab) {
  S.authView = 'auth';
  S.authTab = tab === 'register' ? 'register' : 'login';
  S.authError = '';
  renderAuth();
  $('#auth-modal')?.classList.remove('hidden');
  const u = $('#auth-username');
  if (u) setTimeout(() => u.focus(), 30);
}

function openProfile() {
  if (!S.account) return openAuth('login');
  S.authView = 'profile';
  S.authError = '';
  renderAuth();
  $('#auth-modal')?.classList.remove('hidden');
}

function closeAuth() { $('#auth-modal')?.classList.add('hidden'); }

function renderAuth() {
  const root = $('#auth-content');
  if (!root) return;
  if (S.authView === 'profile' && S.account) { root.innerHTML = profileHtml(); return; }
  const isReg = S.authTab === 'register';
  root.innerHTML = `
    <div class="auth-title">${isReg ? '注册账号' : '登录账号'}</div>
    <div class="auth-sub">${isReg ? '注册后自动登录，可在任何设备继续游戏。' : '登录后可在任何设备继续游戏并保存战绩。'}</div>
    <div class="auth-tabs">
      <button class="auth-tab ${!isReg ? 'active' : ''}" data-act="auth-tab" data-tab="login">登录</button>
      <button class="auth-tab ${isReg ? 'active' : ''}" data-act="auth-tab" data-tab="register">注册</button>
    </div>
    <div class="auth-form">
      <label class="field-label">用户名</label>
      <input id="auth-username" class="input" maxlength="20" autocomplete="username" placeholder="3-20 位中文 / 字母 / 数字 / 下划线">
      <label class="field-label">昵称</label>
      ${isReg ? '<input id="auth-display" class="input" maxlength="12" placeholder="游戏中显示的名字">' : '<div class="auth-note">使用注册时设置的昵称</div>'}
      <label class="field-label">密码</label>
      <input id="auth-password" class="input" type="password" maxlength="64" autocomplete="${isReg ? 'new-password' : 'current-password'}" placeholder="至少 6 位">
      <div id="auth-error" class="auth-error"></div>
      <button class="btn primary auth-submit" data-act="do-auth">${isReg ? '注册并登录' : '登录'}</button>
    </div>
    <div class="auth-switch">${isReg ? '已有账号？<button class="link-btn" data-act="auth-tab" data-tab="login">直接登录</button>' : '还没有账号？<button class="link-btn" data-act="auth-tab" data-tab="register">免费注册</button>'}</div>`;
}

function profileHtml() {
  const a = S.account;
  const stats = a.stats || { games: 0, wins: 0, winRate: 0 };
  const history = (a.history || []).map(g => `<div class="history-row">
    <span class="history-result ${g.result === 'win' ? 'win' : 'lose'}">${g.result === 'win' ? '胜' : '负'}</span>
    <span class="history-mode">${g.mode === 5 ? '5人' : '8人'}</span>
    <span class="history-ident">${esc(identName(g.identity))}</span>
    <span class="history-general">${esc(g.generalName || '')}</span>
    <span class="history-time">${new Date(g.at).toLocaleDateString('zh-CN')}</span>
  </div>`).join('');
  return `<div class="auth-title">我的账号</div>
    <div class="profile-head"><span class="profile-name">${esc(a.displayName)}</span><span class="profile-username">@${esc(a.username)}</span></div>
    <div class="profile-stats">
      <div class="stat"><b>${stats.games}</b><span>对局</span></div>
      <div class="stat"><b>${stats.wins}</b><span>胜场</span></div>
      <div class="stat"><b>${stats.winRate}%</b><span>胜率</span></div>
    </div>
    <div class="profile-section-title">最近战绩</div>
    <div class="profile-history">${history || '<div class="profile-empty">还没有战绩，创建房间来一局吧。</div>'}</div>
    <div class="profile-actions">
      <button class="btn ghost" data-act="logout">退出登录</button>
      <button class="btn small" data-act="close-auth">关闭</button>
    </div>`;
}

async function doAuth() {
  if (S.authBusy) return;
  const isReg = S.authTab === 'register';
  const username = ($('#auth-username')?.value || '').trim();
  const password = $('#auth-password')?.value || '';
  const displayName = ($('#auth-display')?.value || '').trim();
  const showErr = m => { const e = $('#auth-error'); if (e) e.textContent = m; };
  if (!username || !password) return showErr('请输入用户名和密码');
  if (isReg && !displayName) return showErr('请输入昵称');
  S.authBusy = true;
  const btn = $('[data-act="do-auth"]');
  if (btn) { btn.disabled = true; btn.textContent = '请稍候…'; }
  try {
    const r = await fetch('/api/auth/' + (isReg ? 'register' : 'login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username, password, displayName }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showErr(j.error || '操作失败'); return; }
    S.account = j.user;
    S.authView = 'profile';
    S.authTab = 'login';
    S.authError = '';
    renderAccount();
    renderAuth();
    toast(isReg ? '注册成功，已登录' : '登录成功');
  } catch (e) { showErr('网络错误，请稍后再试'); }
  finally { S.authBusy = false; }
}

async function logout() {
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) { }
  S.account = null;
  S.authView = 'auth';
  S.authTab = 'login';
  S.authError = '';
  renderAccount();
  renderAuth();
  toast('已退出登录');
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
    S.guicaiTopIndex = null; S.guicaiHandId = null;
    S.zhangba = null; S.zhangbaSel = [];
    const m = $('#modal'); if (m) m.classList.add('hidden');
  }
  const pending = st.game && st.game.pending;
  if (pending && pending.type === 'arrange') {
    const key = pending.reqId + ':' + pending.mode + ':' + (pending.cards || []).map(c => c.id).join(',');
    if (S.arrangeKey !== key) {
      S.arrangeKey = key;
      S.arrange = pending.mode === 'guanxing'
        ? { mode: 'guanxing', top: (pending.cards || []).map(c => c.id), bottom: [] }
        : { mode: 'guicai', order: (pending.cards || []).map(c => c.id) };
    }
  } else {
    S.arrangeKey = null;
    S.arrange = null;
  }
  if (S.view !== 'enc') {
    if (st.phase === 'lobby' || st.phase === 'draft') showScreen('room');
    else if (st.phase === 'playing' || st.phase === 'over') showScreen('game');
  }
  handleTableCard(st);
  render();
  handlePlayAnim(st);
  handleDrawAnim(st);
}

function showScreen(name) {
  S.view = name;
  if (name !== 'game') stopThinkClock();
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
    if (s.identity) tags.push(`<span class="tag ident ${s.identity}">${identName(s.identity)}</span>`);
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
        ${st.youIdentity ? `<div class="you-identity">你的身份 <b>${identName(st.youIdentity)}</b> · ${st.youSeat + 1}号位</div>` : ''}
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
    ${st.youIdentity ? `<div class="draft-identity">你的身份：<b>${identName(st.youIdentity)}</b> · ${st.youSeat + 1}号位。请根据身份选择武将。</div>` : ''}
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
  const lordOpts = d.phase === 'lord' ? opts.filter(g => g.lord) : [];
  const otherOpts = d.phase === 'lord' ? opts.filter(g => !g.lord) : [];
  const pickCards = (list) => list.map(g => generalCard(g, { selected: g.id === selected, act: 'select-general' })).join('');
  const grid = d.phase === 'lord'
    ? `<div class="draft-section">
         <div class="draft-section-title">主公武将 <span>${lordOpts.length} 名</span></div>
         <div class="general-grid">${pickCards(lordOpts)}</div>
       </div>
       <div class="draft-section">
         <div class="draft-section-title">非主公武将 <span>${otherOpts.length} 名</span></div>
         <div class="general-grid">${pickCards(otherOpts)}</div>
       </div>`
    : `<div class="general-grid">${pickCards(opts)}</div>`;
  return `<div class="draft-wrap">
    <div class="draft-head"><div class="draft-title">${title}</div><div class="draft-sub">${sub}</div></div>
    ${grid}
    <div class="draft-actions">
      <button class="btn primary" data-act="pick-general" ${selected ? '' : 'disabled'}>确定选择</button>
      <span class="draft-sub">${selected ? '已选中：' + esc((opts.find(x => x.id === selected) || {}).name || '') : '请点击一张武将牌'}</span>
    </div>
  </div>`;
}

const SKILL_TYPES = { lock: '锁定技', limited: '限定技', active: '主动技', trigger: '触发技', lord: '主公技', awaken: '觉醒技' };
function skillTypeName(type) { return SKILL_TYPES[type] || '技能'; }

function skillPanelHtml(g, you) {
  const list = (you && you.skillList) || [];
  if (!list.length) return '';
  const items = list.map(s => {
    const available = s.active !== false;
    const usable = !!s.usable;
    const locked = !!s.locked;
    const activeSkill = s.type === 'active';
    const act = usable ? `data-act="use-skill" data-skill="${s.id}"` : '';
    return `<div class="my-skill ${activeSkill ? 'active-skill' : ''} ${usable ? 'usable' : ''} ${s.special ? 'special' : ''} ${available ? '' : 'inactive'} ${locked ? 'locked' : ''}" data-skill-id="${s.id}" ${act} title="${locked ? '非锁定技已被封印，无法发动' : usable ? '左键发动，右键查看详情' : '右键查看详情'}">
      <span class="my-skill-name">${esc(s.name)}</span>
      <span class="my-skill-type">${skillTypeName(s.type)}</span>
      ${locked ? '<span class="skill-locked">🔒 封印</span>' : usable ? '<span class="skill-ready">可发动</span>' : ''}
      ${s.special ? `<span class="skill-special">${esc(s.acquire || '获得')}</span>` : ''}
      ${locked ? '' : available ? '' : '<span class="skill-cond">未满足</span>'}
    </div>`;
  }).join('');
  return `<div class="my-skills"><div class="my-skills-head">我的技能 <span>右键查看详情</span></div>${items}</div>`;
}

function showSkillDetail(id) {
  const g = S.state && S.state.game;
  const you = g && g.you;
  const s = you && (you.skillList || []).find(x => x.id === id);
  const modal = $('#skill-modal');
  if (!s || !modal) return;
  $('#skill-modal-title').textContent = s.name;
  const special = s.special ? `<span class="skill-special">${esc(s.acquire || '获得')}</span>` : '';
  const cond = s.active === false ? '<span class="skill-cond">当前条件未满足</span>' : '';
  const usable = (s.type === 'active' || s.type === 'limited')
    ? (s.usable ? '<span class="skill-ready">当前可发动</span>' : '<span class="skill-cond">当前时机不可发动</span>')
    : '';
  $('#skill-modal-body').innerHTML = `<div class="skill-detail-meta">${skillTypeName(s.type)}${special}${cond}${usable}</div><div class="skill-detail-desc">${esc(s.desc)}</div>`;
  modal.classList.remove('hidden');
}

async function ensureData() {
  if (S.data && S.data.generals) return S.data;
  try {
    const r = await fetch('/api/data');
    S.data = await r.json();
  } catch (e) { /* 离线时返回空 */ }
  return S.data;
}

async function showPlayerSkills(pid) {
  const g = S.state && S.state.game;
  const p = g && (g.players || []).find(x => x.id === pid);
  if (!p) return;
  const data = await ensureData();
  const gen = data && data.generals ? data.generals.find(x => x.id === p.general.id) : null;
  const skills = (gen && gen.skills) || [];
  const rows = skills.map(s => {
    const badge = s.derived ? `<span class="skill-special">${esc(s.acquire || '获得')}</span>` : '';
    const locked = p.nonLockDisabled && s.type !== 'lock';
    return `<div class="other-skill ${locked ? 'locked' : ''}"><div class="other-skill-head"><span class="other-skill-name">${esc(s.name)}</span><span class="my-skill-type">${skillTypeName(s.type)}</span>${badge}${locked ? '<span class="skill-locked">🔒 已封印</span>' : ''}</div><div class="skill-desc">${esc(s.desc)}</div></div>`;
  }).join('');
  const modal = $('#skill-modal');
  if (!modal) return;
  $('#skill-modal-title').textContent = `${p.name} · ${p.general.name} · ${(p.seat ?? 0) + 1}号位`;
  $('#skill-modal-body').innerHTML = rows ? `<div class="other-skill-list">${rows}</div>` : '<div class="skill-detail-desc">该武将没有技能数据</div>';
  modal.classList.remove('hidden');
}

async function showCardDetail(name, suit, rank) {
  const data = await ensureData();
  const def = data && data.cards ? data.cards[name] : null;
  const modal = $('#skill-modal');
  if (!modal) return;
  $('#skill-modal-title').textContent = name;
  const type = def ? (def.type === 'basic' ? '基本牌' : def.type === 'trick' ? '锦囊牌' : '装备牌') : '';
  const meta = [suit && rank ? `${suit}${rank}` : '', type].filter(Boolean).join(' · ');
  $('#skill-modal-body').innerHTML = `<div class="skill-detail-meta">${meta}</div><div class="skill-detail-desc">${esc(def ? def.desc : '暂无牌面说明')}</div>`;
  modal.classList.remove('hidden');
}

function generalCard(g, opts = {}) {
  const act = opts.act ? `data-act="${opts.act}" data-general="${g.id}"` : '';
  return `<div class="general-card ${opts.selected ? 'selected' : ''}" ${act} style="--fac:${FCOLOR[g.faction] || '#c9a45c'}">
    ${g.lord ? '<div class="general-lord">主公将</div>' : ''}
    <div class="general-portrait"><img src="/portraits/${g.id}.jpg" alt="${esc(g.name)}" loading="lazy"></div>
    <div class="general-top">
      <div class="general-name">${esc(g.name)}</div>
      <div class="general-faction ${factionClass(g.faction)}">${FACTION[g.faction] || '群'}</div>
    </div>
    <div class="general-hp">${pips(g.hp, g.maxHp || g.hp)}</div>
    ${(g.skills || []).map(s => `<div class="skill-line"><div class="skill-name">${esc(s.name)}${s.type === 'lord' ? ' · 主公技' : ''}${s.derived ? `<span class="skill-derived">${esc(s.acquire || '获得')}</span>` : ''}</div><div class="skill-desc">${esc(s.desc)}</div></div>`).join('')}
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
  const currentCard = S.tableCard ? `<div class="table-current">
      ${cardHtml(S.tableCard.card)}
      <div class="table-current-label">${esc(S.tableCard.sourceName || '')}${(S.tableCard.targetNames || []).length ? ' 对 ' + esc(S.tableCard.targetNames.join('、')) : ''}${S.tableCard.as && S.tableCard.card && S.tableCard.as !== S.tableCard.card.name ? `（当【${esc(S.tableCard.as)}】）` : ''}</div>
    </div>` : '';
  const center = `<div class="table-center">
    <div class="turn-info">${g.winner ? '对局结束' : (g.turn === (you && you.id) ? '<b>轮到你</b>' : (g.turnName ? '当前：<b>' + esc(g.turnName) + '</b>' : '等待开始'))}</div>
    <div class="table-center-main">
      <div class="table-card-slot">${currentCard}</div>
      <div class="piles">
        <div class="pile"><div class="pile-stack"></div><div class="pile-label">牌堆 ${g.deckCount}</div></div>
        <div class="pile" ${g.discardTop ? `title="弃牌堆顶：${esc(g.discardTop.suit + g.discardTop.rank + g.discardTop.name)}"` : ''}><div class="pile-stack"></div><div class="pile-label">弃牌 ${g.discardCount}</div></div>
      </div>
    </div>
  </div>`;

  const handOverlap = you ? (you.hand.length > 16 ? -38 : you.hand.length > 12 ? -32 : you.hand.length > 8 ? -24 : -18) : -18;
  const handHtml = you ? you.hand.map((c, idx) => {
    let cls = 'hand-card';
    let disabled = false;
    if (pending) {
      if (pending.type === 'card') disabled = !(pending.validCards || []).some(x => x.id === c.id);
      else if (pending.type === 'cards') disabled = !(pending.validCards || []).some(x => x.id === c.id);
      else if (pending.type === 'target') disabled = true;
      else if (pending.type === 'action') disabled = S.zhangba ? false : !playMap[c.id];
      else disabled = true;
    } else disabled = true;
    if (disabled) cls += ' disabled';
    if (pending && pending.type === 'action' && (S.zhangba || !disabled)) cls += ' playable';
    if (S.sel && S.sel.opt.cardId === c.id) cls += ' choosing';
    if (S.zhangba && S.zhangbaSel.includes(c.id)) cls += ' choosing';
    if (S.pendingSel.includes(c.id)) cls += ' selected';
    if (pending && pending.type === 'card' && !disabled) cls += ' card-pending';
    return `<div class="${cls}" style="margin-left:${idx === 0 ? 0 : handOverlap}px" data-act="card" data-card-id="${c.id}">${cardHtml(c)}</div>`;
  }).join('') : '';

  const prompt = promptHtml(g);
  const action = actionHtml(g, pending, you);
  const mySkills = skillPanelHtml(g, you);
  const log = renderLog(g);
  const picker = pickerHtml(g, pending, you);
  const special = specialHtml(g, pending);
  const thinkClock = pending && pending.deadline ? `<div id="think-clock" class="think-clock"><span id="think-sec">30</span><small>秒</small></div>` : '';
  const overlay = g.winner ? overlayHtml(g) : '';

  $('#game-root').innerHTML = `<div class="game-stage">
    <div class="game-table">${seats}${center}</div>
    <div class="hand-area"><div class="hand-inner">${handHtml || (you && you.alive === false ? '<div class="waiting-box">你已阵亡，观战中</div>' : '')}</div></div>
    ${action}
    ${mySkills}
    ${prompt}
    ${log}
    ${picker}
    ${special}
    ${thinkClock}
    ${overlay}
  </div>`;
  const lb = document.querySelector('.log-body');
  if (lb) lb.scrollTop = lb.scrollHeight;
  startThinkClock(pending);
}

function startThinkClock(pending) {
  if (S.thinkTimer) { clearInterval(S.thinkTimer); S.thinkTimer = null; }
  const clock = $('#think-clock');
  if (!clock || !pending || !pending.deadline) return;
  const tick = () => {
    const left = Math.max(0, Math.ceil((pending.deadline - Date.now()) / 1000));
    const sec = $('#think-sec');
    if (sec) sec.textContent = String(left);
    clock.classList.toggle('urgent', left > 0 && left <= 10);
    clock.classList.toggle('expired', left <= 0);
  };
  tick();
  S.thinkTimer = setInterval(tick, 250);
}

function stopThinkClock() {
  if (S.thinkTimer) { clearInterval(S.thinkTimer); S.thinkTimer = null; }
}

function handleTableCard(st) {
  if (!st || !st.game) { S.tableCard = null; return; }
  if (S.tableCardRoom !== st.code) {
    S.tableCardRoom = st.code;
    S.tableCard = null;
    if (S.tableCardTimer) { clearTimeout(S.tableCardTimer); S.tableCardTimer = null; }
  }
  const tc = st.game.tableCard;
  if (tc) {
    if (!S.tableCard || S.tableCard.seq !== tc.seq) {
      S.tableCard = tc;
      S.tableCardAt = Date.now();
      if (S.tableCardTimer) { clearTimeout(S.tableCardTimer); S.tableCardTimer = null; }
    }
    return;
  }
  if (!S.tableCard) return;
  const remain = 900 - (Date.now() - (S.tableCardAt || 0));
  if (remain > 0) {
    if (!S.tableCardTimer) {
      S.tableCardTimer = setTimeout(() => {
        S.tableCard = null;
        S.tableCardTimer = null;
        if (S.state && S.state.game && (S.state.phase === 'playing' || S.state.phase === 'over')) renderGame();
      }, remain);
    }
  } else {
    S.tableCard = null;
  }
}

function handlePlayAnim(st) {
  if (!st || !st.game || !st.game.lastPlay) return;
  if (S.lastPlayRoom !== st.code) { S.lastPlayRoom = st.code; S.lastPlaySeq = 0; }
  const ev = st.game.lastPlay;
  if (ev.seq === S.lastPlaySeq) return;
  S.lastPlaySeq = ev.seq;
  if (S.view === 'game') showPlayAnim(ev);
}

function showPlayAnim(ev) {
  const old = document.getElementById('play-anim');
  if (old) old.remove();
  if (!ev || !ev.card) return;
  const wrap = document.createElement('div');
  wrap.id = 'play-anim';
  wrap.className = 'play-anim' + (ev.equip ? ' equip' : '');
  const as = ev.as && ev.as !== ev.card.name ? `<div class="play-anim-as">当作【${esc(ev.as)}】</div>` : '';
  wrap.innerHTML = `<div class="play-anim-inner"><div class="play-anim-who">${esc(ev.playerName || '')}</div><div class="play-anim-card">${cardHtml(ev.card)}</div>${as}</div>`;
  document.body.appendChild(wrap);
  if (ev.equip) {
    const seat = document.querySelector(`.seat[data-pid="${ev.playerId}"] .seat-equip`);
    if (seat) {
      const r = seat.getBoundingClientRect();
      const dx = (r.left + r.width / 2) - window.innerWidth / 2;
      const dy = (r.top + r.height / 2) - window.innerHeight / 2;
      wrap.style.setProperty('--fly-x', dx + 'px');
      wrap.style.setProperty('--fly-y', dy + 'px');
    }
  }
  setTimeout(() => wrap.remove(), ev.equip ? 1500 : 1100);
}

function handleDrawAnim(st) {
  if (!st || !st.game || !st.game.lastDraw) return;
  if (S.lastDrawRoom !== st.code) { S.lastDrawRoom = st.code; S.lastDrawSeq = 0; }
  const ev = st.game.lastDraw;
  if (ev.seq === S.lastDrawSeq) return;
  S.lastDrawSeq = ev.seq;
  if (S.view === 'game') showDrawAnim(ev);
}

function showDrawAnim(ev) {
  const old = document.getElementById('draw-anim');
  if (old) old.remove();
  if (!ev || !ev.count) return;
  const deck = document.querySelector('.pile');
  const target = (ev.playerId === (S.state && S.state.game && S.state.game.you ? S.state.game.you.id : null))
    ? document.querySelector('.hand-area')
    : document.querySelector(`.seat[data-pid="${ev.playerId}"]`);
  if (!deck || !target) return;
  const d = deck.getBoundingClientRect();
  const t = target.getBoundingClientRect();
  const sx = d.left + d.width / 2;
  const sy = d.top + d.height / 2;
  const dx = (t.left + t.width / 2) - sx;
  const dy = (t.top + t.height / 2) - sy;
  const wrap = document.createElement('div');
  wrap.id = 'draw-anim';
  wrap.className = 'draw-anim';
  const n = Math.min(4, ev.count);
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'draw-anim-card';
    c.style.left = (sx - 21 + i * 12) + 'px';
    c.style.top = (sy - 29 - i * 9) + 'px';
    c.style.setProperty('--dx', dx + 'px');
    c.style.setProperty('--dy', dy + 'px');
    c.style.setProperty('--delay', (i * 0.06) + 's');
    wrap.appendChild(c);
  }
  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), 1200);
}

function seatHtml(p, n, i, g, youIndex) {
  const rel = youIndex >= 0 ? (i - youIndex + n) % n : i;
  const ang = (90 + rel * 360 / n) * Math.PI / 180;
  const x = 50 + 41 * Math.cos(ang);
  const y = 50 + 32 * Math.sin(ang);
  let cls = 'seat';
  if (n === 8) cls += ' seat-8';
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
  const equipDefs = [['weapon', '武器'], ['armor', '防具'], ['horsePlus', '+1马'], ['horseMinus', '-1马']];
  const equipSlots = equipDefs.map(([k, label]) => {
    const c = p.equip && p.equip[k];
    if (!c) return `<span class="equip-slot empty">${label}</span>`;
    return `<span class="equip-slot filled" data-equip-name="${esc(c.name)}" data-equip-suit="${c.suit || ''}" data-equip-rank="${c.rank || ''}" title="右键查看牌面效果">${esc(c.name)}</span>`;
  }).join('');
  const judges = (p.judge || []).map(c => `<span class="mini-tag judge">${esc(c.name)}</span>`).join('');
  const marks = [];
  if (p.marks) {
    if (p.marks.rende) marks.push(`<span class="mini-tag mark">仁德×${p.marks.rende}</span>`);
    if (p.marks.yi) marks.push(`<span class="mini-tag mark">义</span>`);
    if (p.marks.jian) marks.push(`<span class="mini-tag mark">间×${p.marks.jian}</span>`);
    if (p.marks.kongcheng) marks.push(`<span class="mini-tag mark">空城×${p.marks.kongcheng}</span>`);
  }
  if (p.chained) marks.push(`<span class="mini-tag judge">横置</span>`);
  if (p.flipped) marks.push(`<span class="mini-tag judge">翻面</span>`);
  if (p.charge !== undefined) marks.push(`<span class="mini-tag mark">充能${p.charge}</span>`);
  if (p.qingguoLevel) marks.push(`<span class="mini-tag mark">倾国${p.qingguoLevel}</span>`);
  return `<div class="${cls}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%" data-act="seat" data-pid="${p.id}">
    <div class="seat-top">
      <div class="avatar ${factionClass(p.general.faction)}" data-avatar-pid="${p.id}" title="右键查看技能"><img src="/portraits/${p.general.id}.jpg" alt="${esc(p.general.name)}" onerror="this.remove()"><span class="avatar-letter">${esc(p.general.name[0] || '?')}</span></div>
      <div class="seat-namebox">
        <div class="seat-name" title="${esc(p.name)}">${esc(p.name)}</div>
        <div class="seat-general">${esc(p.general.name)}${p.identity === 'lord' ? ' · 主公' : ''}</div>
        <div class="seat-pos">${(p.seat ?? 0) + 1}号位</div>
      </div>
      ${ident}
    </div>
    <div class="seat-hp">${pips(p.hp, p.maxHp)}</div>
    <div class="seat-meta"><span>手牌 <b class="seat-handcount">${p.handCount}</b> <em class="hand-hidden">暗置</em></span><span>${p.alive ? (p.id === g.turn ? '行动中' : '') : '阵亡'}</span></div>
    <div class="seat-equip">${equipSlots}</div>
    <div class="seat-cards">${judges}${marks.join('')}</div>
  </div>`;
}

const CARD_ICONS = {
  basic: '<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  sha: '<path d="M4 20 20 4M14 4h6v6"/><path d="M4 20l4-1-3-3z"/>',
  shan: '<path d="M12 3 20 6v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/>',
  tao: '<path d="M12 21c-6-5-7-10-4-13 2-2 4 0 4 2 0-2 2-4 4-2 3 3 2 8-4 13z"/><path d="M12 8v7"/>',
  jiu: '<path d="M8 3h8l-1 6c0 4 3 6 3 9H6c0-3 3-5 3-9z"/><path d="M7 18h10"/>',
  trick: '<path d="M6 3h12v18H6z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  delay: '<path d="M6 3h12v18H6z"/><path d="M9 7h6M9 11h6M9 15h3"/><circle cx="17" cy="17" r="2"/>',
  bolt: '<path d="M13 2 5 14h6l-1 8 8-12h-6z"/>',
  fire: '<path d="M12 22c-4-3-6-7-4-11 1-2 3-3 3-5 3 2 4 5 3 7 2-1 3-3 3-5 3 3 3 9-1 12-1 1-2 2-4 2z"/>',
  chain: '<circle cx="7" cy="7" r="3"/><circle cx="17" cy="17" r="3"/><path d="M9 9l6 6"/>',
  shield: '<path d="M12 3 20 6v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  duel: '<path d="M3 21 21 3M15 3h6v6M3 3l18 18M3 15v6h6"/>',
  aoe: '<path d="M4 20 20 4M4 4l16 16"/><circle cx="12" cy="12" r="3"/>',
  heal: '<path d="M12 4v16M4 12h16"/>',
  draw: '<path d="M5 4h11v16H5z"/><path d="M9 8h4M9 12h4M9 16h2"/><path d="M17 7l3 3-3 3"/>',
  weapon: '<path d="M14 3l7 7-4 4-7-7zM9 12l-5 5 3 3 5-5"/>',
  armor: '<path d="M12 3 20 6v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/>',
  horse: '<path d="M4 18c1-5 4-9 9-10l3-4 2 3 2 1-2 3h-3l-1 4 3 3M4 18h16"/>',
};

function cardArt(c) {
  let key = 'basic';
  if (c.type === 'basic') key = ({ '杀': 'sha', '闪': 'shan', '桃': 'tao', '酒': 'jiu' })[c.name] || 'basic';
  else if (c.type === 'equip') key = c.subtype === 'weapon' ? 'weapon' : c.subtype === 'armor' ? 'armor' : 'horse';
  else if (c.name === '闪电') key = 'bolt';
  else if (c.name === '火攻') key = 'fire';
  else if (c.name === '铁索连环') key = 'chain';
  else if (c.name === '无懈可击') key = 'shield';
  else if (c.name === '决斗') key = 'duel';
  else if (c.name === '南蛮入侵' || c.name === '万箭齐发') key = 'aoe';
  else if (c.name === '桃园结义') key = 'heal';
  else if (c.name === '无中生有' || c.name === '五谷丰登') key = 'draw';
  else if (c.name === '乐不思蜀' || c.name === '兵粮寸断') key = 'delay';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">${CARD_ICONS[key] || CARD_ICONS.trick}</svg>`;
}

function cardHtml(c) {
  if (c.hidden) {
    return `<div class="card card-back">
      <div class="card-name">手牌</div>
      <div class="card-sub">暗置</div>
    </div>`;
  }
  const red = c.suit === '♥' || c.suit === '♦';
  return `<div class="card ${red ? 'suit-red' : 'suit-black'}">
    <div class="card-art">${cardArt(c)}</div>
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
    if ((pending.options || []).some(o => o.mode === 'zhangba')) {
      html += `<button class="skill-btn" data-act="zhangba" title="将两张手牌当【杀】使用">丈八蛇矛</button>`;
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
  if (S.zhangba) {
    return `<div class="prompt-bar"><div class="prompt-text">丈八蛇矛：选择两张手牌当【杀】（已选 ${S.zhangbaSel.length} / 2）</div>
      <div class="prompt-actions"><button class="btn ghost small" data-act="cancel-zhangba">取消</button></div></div>`;
  }
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
  if (p && (p.type === 'guicai-replace' || p.type === 'arrange')) {
    return `<div class="prompt-bar"><div class="prompt-text">${esc(p.prompt || '请操作')}</div></div>`;
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
      <div class="prompt-actions">${p.zhangba ? '<button class="btn small" data-act="zhangba-response">丈八蛇矛</button>' : ''}${p.optional ? '<button class="btn ghost small" data-act="cancel">放弃</button>' : ''}</div></div>`;
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

function specialHtml(g, p) {
  if (!p) return '';
  if (p.type === 'guicai-replace') return guicaiReplaceHtml(g, p);
  if (p.type === 'arrange') return arrangeHtml(g, p);
  return '';
}

function guicaiReplaceHtml(g, p) {
  const cards = p.cards || [];
  const hand = p.hand || [];
  const target = (g.players || []).find(x => x.id === p.judgeTargetId);
  const topSel = S.guicaiTopIndex;
  const handSel = S.guicaiHandId;
  return `<div class="overlay special-overlay">
    <div class="overlay-card special-card" data-act="noop">
      <div class="modal-title">鬼才 · 观看牌堆顶 ${cards.length} 张</div>
      <div class="special-sub">判定：${esc(p.reason || '')}${target ? ' · 目标：' + esc(target.name) : ''}。牌堆顶仅你可见：先选一张牌堆顶的牌，再选一张手牌替换；也可以不换牌直接调整顺序。</div>
      <div class="guicai-panels">
        <div class="guicai-section">
          <div class="arrange-zone-title">牌堆顶 <span>先选要替换的牌</span></div>
          <div class="arrange-list">${cards.map((c, i) => `<div class="arrange-item ${topSel === i ? 'selected' : ''}" data-act="guicai-top" data-index="${i}">${cardHtml(c)}</div>`).join('') || '<div class="arrange-empty">无</div>'}</div>
        </div>
        <div class="guicai-section">
          <div class="arrange-zone-title">你的手牌 <span>再选替换的手牌</span></div>
          <div class="arrange-list">${hand.map(c => `<div class="arrange-item ${handSel === c.id ? 'selected' : ''}" data-act="guicai-hand" data-id="${c.id}">${cardHtml(c)}</div>`).join('') || '<div class="arrange-empty">无手牌</div>'}</div>
        </div>
      </div>
      <div class="special-actions">
        <button class="btn small" data-act="guicai-replace" ${topSel == null || !handSel ? 'disabled' : ''}>换牌</button>
        <button class="btn small" data-act="guicai-arrange">不换牌，调整顺序</button>
        <button class="btn ghost small" data-act="guicai-skip">不发动</button>
      </div>
    </div>
  </div>`;
}

function arrangeHtml(g, p) {
  const cards = p.cards || [];
  const byId = {};
  for (const c of cards) byId[c.id] = c;
  let arr = S.arrange;
  if (!arr || arr.mode !== p.mode) {
    arr = p.mode === 'guanxing'
      ? { mode: 'guanxing', top: cards.map(c => c.id), bottom: [] }
      : { mode: 'guicai', order: cards.map(c => c.id) };
    S.arrange = arr;
  }
  const item = (id) => {
    const c = byId[id];
    if (!c) return '';
    return `<div class="arrange-item" draggable="true" data-arrange-id="${id}">${cardHtml(c)}</div>`;
  };
  const guicai = p.mode !== 'guanxing';
  return `<div class="overlay special-overlay">
    <div class="overlay-card special-card" data-act="noop">
      <div class="modal-title">${guicai ? '鬼才 · 调整牌堆顶' : '观星 · 牌堆顶 ' + cards.length + ' 张'}</div>
      <div class="special-sub">${guicai ? '第一张为本次判定牌。拖动卡牌调整顺序。' : '仅你可见。拖动卡牌调整顺序；把牌拖到「牌堆底」就会放到牌堆底部，顶部第一张为下一张摸到。'}</div>
      ${guicai
        ? `<div class="arrange-zone"><div class="arrange-zone-title">牌堆顶 <span>第一张为判定牌</span></div><div class="arrange-list" data-arrange-list="order">${arr.order.map(item).join('')}</div></div>`
        : `<div class="arrange-columns">
            <div class="arrange-zone"><div class="arrange-zone-title">牌堆顶 <span>先摸到</span></div><div class="arrange-list" data-arrange-list="top">${arr.top.map(item).join('')}</div></div>
            <div class="arrange-zone"><div class="arrange-zone-title">牌堆底 <span>后摸到</span></div><div class="arrange-list" data-arrange-list="bottom">${arr.bottom.map(item).join('')}</div></div>
          </div>`}
      <div class="special-actions"><button class="btn" data-act="arrange-confirm">确认</button></div>
    </div>
  </div>`;
}

function moveArrangeCard(id, zone, beforeId) {
  const arr = S.arrange;
  if (!arr) return;
  if (arr.mode === 'guanxing') {
    for (const k of ['top', 'bottom']) {
      const i = arr[k].indexOf(id);
      if (i >= 0) arr[k].splice(i, 1);
    }
    const list = arr[zone === 'bottom' ? 'bottom' : 'top'];
    const idx = beforeId ? list.indexOf(beforeId) : -1;
    if (idx < 0) list.push(id); else list.splice(idx, 0, id);
  } else {
    const i = arr.order.indexOf(id);
    if (i >= 0) arr.order.splice(i, 1);
    const idx = beforeId ? arr.order.indexOf(beforeId) : -1;
    if (idx < 0) arr.order.push(id); else arr.order.splice(idx, 0, id);
  }
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
  if (S.zhangba) {
    if (!g.you || !(g.you.hand || []).some(c => c.id === cardId)) return;
    const i = S.zhangbaSel.indexOf(cardId);
    if (i >= 0) S.zhangbaSel.splice(i, 1);
    else {
      S.zhangbaSel.push(cardId);
      if (S.zhangbaSel.length >= 2) {
        const first = S.zhangbaSel[0];
        const second = S.zhangbaSel[1];
        S.sel = { opt: { ...S.zhangba, cardId: first, extraCardId: second }, targets: [] };
        S.zhangba = null;
        S.zhangbaSel = [];
        render();
        return;
      }
    }
    render();
    return;
  }
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
    if (p.type !== 'action') return;
  }
  if (!g.you) return;
  if (S.sel) {
    if (S.sel.opt.cardId === cardId) { S.sel = null; render(); return; }
    S.sel = null;
  }
  const opts = (g.you.playOptions || []).filter(o => o.cardId === cardId);
  if (!opts.length) { render(); return toast('现在不能使用这张牌'); }
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
    if (!(opt.targets || []).includes(pid)) return toast('该目标不能使用这张牌');
    if ((opt.maxTargets || 1) === 1) {
      S.sel = null;
      send({ action: 'play', cardId: opt.cardId, as: opt.as, targets: [pid], extraCardId: opt.extraCardId });
      return;
    }
    const i = targets.indexOf(pid);
    if (i >= 0) targets.splice(i, 1);
    else if (targets.length < (opt.maxTargets || 1)) targets.push(pid);
    render();
    return;
  }
  const p = g.pending;
  if (p && p.type === 'target') {
    if ((p.valid || []).includes(pid)) send({ targetId: pid });
    else toast('该目标不合法');
  }
}

function exitGame() {
  send({ action: 'exit' });
  setTimeout(clearSession, 120);
}
function leaveRoom() {
  send({ action: 'leave' });
  setTimeout(clearSession, 120);
}

document.addEventListener('contextmenu', (e) => {
  const skill = e.target.closest('[data-skill-id]');
  if (skill) { e.preventDefault(); showSkillDetail(skill.dataset.skillId); return; }
  const avatar = e.target.closest('[data-avatar-pid]');
  if (avatar) { e.preventDefault(); showPlayerSkills(avatar.dataset.avatarPid); return; }
  const equip = e.target.closest('[data-equip-name]');
  if (equip) { e.preventDefault(); showCardDetail(equip.dataset.equipName, equip.dataset.equipSuit, equip.dataset.equipRank); return; }
});

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'noop') return;
  if (act === 'open-auth') return openAuth(el.dataset.tab || 'login');
  if (act === 'open-profile') return openProfile();
  if (act === 'close-auth') return closeAuth();
  if (act === 'auth-tab') { S.authTab = el.dataset.tab === 'register' ? 'register' : 'login'; S.authError = ''; renderAuth(); return; }
  if (act === 'do-auth') return doAuth();
  if (act === 'logout') return logout();
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
  if (act === 'use-skill') return send({ action: 'skill', skill: el.dataset.skill });
  if (act === 'end') return send({ action: 'end' });
  if (act === 'zhangba-response') return send({ zhangba: true });
  if (act === 'zhangba') {
    const p = S.state && S.state.game && S.state.game.pending;
    const o = (p && p.options || []).find(x => x.mode === 'zhangba');
    if (!o) return toast('现在不能发动丈八蛇矛');
    S.zhangba = o; S.zhangbaSel = []; S.sel = null; render(); return;
  }
  if (act === 'cancel-zhangba') { S.zhangba = null; S.zhangbaSel = []; render(); return; }
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
    return send({ action: 'play', cardId: opt.cardId, as: opt.as, targets, extraCardId: opt.extraCardId });
  }
  if (act === 'confirm-cards') {
    const ids = S.pendingSel.slice();
    S.pendingSel = [];
    return send({ cardIds: ids });
  }
  if (act === 'guicai-top') { S.guicaiTopIndex = Number(el.dataset.index); render(); return; }
  if (act === 'guicai-hand') { S.guicaiHandId = el.dataset.id; render(); return; }
  if (act === 'guicai-replace') {
    if (S.guicaiTopIndex == null || !S.guicaiHandId) return;
    return send({ action: 'replace', topIndex: S.guicaiTopIndex, handCardId: S.guicaiHandId });
  }
  if (act === 'guicai-arrange') return send({ action: 'arrange' });
  if (act === 'guicai-skip') return send({ action: 'skip' });
  if (act === 'arrange-confirm') {
    if (!S.arrange) return;
    if (S.arrange.mode === 'guanxing') return send({ top: S.arrange.top.slice(), bottom: S.arrange.bottom.slice() });
    return send({ order: (S.arrange.order || []).slice() });
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
  if (act === 'close-skill-modal') { $('#skill-modal')?.classList.add('hidden'); return; }
  if (act === 'tab') { S.encTab = el.dataset.tab; renderEncyclopedia(); return; }
  if (act === 'filter') { S.encFilter = el.dataset.filter; renderEncyclopedia(); return; }
});

$('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) $('#modal').classList.add('hidden'); });

// 观星 / 鬼才：拖动排序
document.addEventListener('dragstart', (e) => {
  const el = e.target.closest('[data-arrange-id]');
  if (!el || !S.arrange) return;
  S.dragId = el.dataset.arrangeId;
  try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', S.dragId); } catch (_) {}
  el.classList.add('dragging');
});
document.addEventListener('dragend', (e) => {
  const el = e.target.closest('[data-arrange-id]');
  if (el) el.classList.remove('dragging');
  S.dragId = null;
  document.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
});
document.addEventListener('dragover', (e) => {
  if (!S.arrange) return;
  const list = e.target.closest('[data-arrange-list]');
  if (!list) return;
  e.preventDefault();
  try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
  list.classList.add('drag-over');
});
document.addEventListener('dragleave', (e) => {
  const list = e.target.closest('[data-arrange-list]');
  if (list && (!e.relatedTarget || !list.contains(e.relatedTarget))) list.classList.remove('drag-over');
});
document.addEventListener('drop', (e) => {
  if (!S.arrange) return;
  const list = e.target.closest('[data-arrange-list]');
  if (!list) return;
  e.preventDefault();
  const id = S.dragId || (e.dataTransfer ? e.dataTransfer.getData('text/plain') : null);
  if (!id) return;
  const target = e.target.closest('[data-arrange-id]');
  moveArrangeCard(id, list.dataset.arrangeList, target ? target.dataset.arrangeId : null);
  S.dragId = null;
  document.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
  render();
});

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
