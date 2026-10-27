'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RoomManager } = require('./rooms');
const { GENERALS, CARD_DEFS, DECK_COUNTS } = require('./data');
const { AccountStore, SESSION_MS } = require('./accounts');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const manager = new RoomManager();
const accounts = new AccountStore(DATA_DIR);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; media-src 'self' https://music.163.com https://*.music.163.com http://*.music.126.net https://*.music.126.net; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
function secHeaders(res) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
}

function json(res, code, obj, headers = {}) {
  secHeaders(res);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise(resolve => {
    let s = '';
    let tooLarge = false;
    req.on('data', d => {
      if (tooLarge) return;
      s += d;
      if (s.length > 1e6) { tooLarge = true; s = ''; }
    });
    req.on('end', () => {
      if (tooLarge) return resolve({});
      try { resolve(JSON.parse(s || '{}')); } catch (e) { resolve({}); }
    });
  });
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const raw = part.slice(i + 1).trim();
    try { out[key] = decodeURIComponent(raw); } catch { out[key] = raw; }
  }
  return out;
}

function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || 'unknown';
}

function isSecure(req) {
  return req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted
    || (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false');
}

function sessionCookie(req, token) {
  const maxAge = Math.floor(SESSION_MS / 1000);
  return `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${isSecure(req) ? '; Secure' : ''}`;
}

function clearSessionCookie(req) {
  return `sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${isSecure(req) ? '; Secure' : ''}`;
}

function accountFromReq(req) {
  const token = parseCookies(req.headers.cookie || '').sid;
  return token ? accounts.userByToken(token) : null;
}

const rateHits = new Map();
const sseByIp = new Map();
function rateOk(req, limit, windowMs = 60000) {
  const ip = clientIp(req);
  const now = Date.now();
  const arr = (rateHits.get(ip) || []).filter(t => now - t < windowMs);
  if (arr.length >= limit) { rateHits.set(ip, arr); return false; }
  arr.push(now);
  rateHits.set(ip, arr);
  return true;
}
function authRateOk(req) { return rateOk(req, 10); }

function newPlayer(name, accountId) {
  return {
    id: 'p_' + crypto.randomBytes(8).toString('hex'),
    name: String(name || '玩家').slice(0, 12),
    token: crypto.randomBytes(16).toString('hex'),
    accountId: accountId || null,
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  if (p.startsWith('/api/') && !rateOk(req, 300)) {
    return json(res, 429, { error: '请求太频繁，请稍后再试' });
  }

  if (p === '/api/data' && req.method === 'GET') {
    return json(res, 200, { generals: GENERALS, cards: CARD_DEFS, deck: DECK_COUNTS });
  }

  if (p === '/api/auth/register' && req.method === 'POST') {
    if (!authRateOk(req)) return json(res, 429, { error: '操作太频繁，请稍后再试' });
    const body = await readBody(req);
    const reg = accounts.register(body.username, body.password, body.displayName);
    if (reg.error) return json(res, 400, { error: reg.error });
    const login = accounts.login(body.username, body.password);
    if (login.error) return json(res, 400, { error: login.error });
    return json(res, 200, { user: login.user }, { 'Set-Cookie': sessionCookie(req, login.token) });
  }

  if (p === '/api/auth/login' && req.method === 'POST') {
    if (!authRateOk(req)) return json(res, 429, { error: '操作太频繁，请稍后再试' });
    const body = await readBody(req);
    const login = accounts.login(body.username, body.password);
    if (login.error) return json(res, 400, { error: login.error });
    return json(res, 200, { user: login.user }, { 'Set-Cookie': sessionCookie(req, login.token) });
  }

  if (p === '/api/auth/logout' && req.method === 'POST') {
    const token = parseCookies(req.headers.cookie || '').sid;
    if (token) accounts.logout(token);
    return json(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(req) });
  }

  if (p === '/api/auth/me' && req.method === 'GET') {
    const user = accountFromReq(req);
    if (!user) return json(res, 401, { error: '未登录' });
    return json(res, 200, { user: accounts.publicUser(user) });
  }

  if (p === '/api/join' && req.method === 'POST') {
    const body = await readBody(req);
    const account = accountFromReq(req);
    const name = account ? account.displayName : String(body.name || '').trim();
    if (!name) return json(res, 400, { error: account ? '账号昵称异常' : '请输入昵称' });
    const mode = Number(body.mode) === 5 ? 5 : 8;
    const action = body.action;
    const player = newPlayer(name, account ? account.id : null);
    let room = null;
    let already = false;
    if (action === 'join') {
      room = manager.get(body.code);
      if (!room) return json(res, 404, { error: '房间不存在，请检查房间码' });
      if (room.mode !== mode) return json(res, 400, { error: '房间模式不匹配' });
      if (room.phase !== 'lobby') return json(res, 400, { error: '该房间已经开始游戏' });
    } else if (action === 'match') {
      room = manager.findPublic(mode);
      if (!room) { room = manager.create(mode, player); already = true; }
    } else {
      room = manager.create(mode, player);
      already = true;
    }
    if (!already && !room.players.has(player.id)) {
      const r = room.addPlayer(player);
      if (r.error) return json(res, 400, { error: r.error });
    }
    return json(res, 200, { room: room.code, pid: player.id, token: player.token, mode: room.mode, host: room.host === player.id });
  }

  if (p === '/api/events' && req.method === 'GET') {
    const code = (url.searchParams.get('room') || '').toUpperCase();
    const pid = url.searchParams.get('pid');
    const token = url.searchParams.get('token');
    const room = manager.get(code);
    if (!room) return json(res, 404, { error: '房间不存在' });
    const player = room.players.get(pid);
    if (!player || player.token !== token) return json(res, 403, { error: '身份校验失败' });
    const ip = clientIp(req);
    const n = sseByIp.get(ip) || 0;
    if (n >= 5) return json(res, 429, { error: '连接数过多' });
    sseByIp.set(ip, n + 1);
    secHeaders(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    room.attachStream(pid, res);
    const timer = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 20000);
    req.on('close', () => {
      clearInterval(timer);
      room.detachStream(pid);
      sseByIp.set(ip, Math.max(0, (sseByIp.get(ip) || 1) - 1));
    });
    return;
  }

  if (p === '/api/action' && req.method === 'POST') {
    const body = await readBody(req);
    const room = manager.get(body.room);
    if (!room) return json(res, 404, { error: '房间不存在' });
    const player = room.players.get(body.pid);
    if (!player || player.token !== body.token) return json(res, 403, { error: '身份校验失败' });
    const r = room.handleAction(body.pid, body.action || {});
    if (r && r.error) return json(res, 400, r);
    return json(res, 200, { ok: true });
  }

  // 静态文件
  let file;
  try { file = p === '/' ? '/index.html' : decodeURIComponent(p); }
  catch { return json(res, 400, { error: 'bad request' }); }
  const full = path.join(PUBLIC, file);
  const rel = path.relative(PUBLIC, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return json(res, 403, { error: 'forbidden' });
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404');
      return;
    }
    const ext = path.extname(full).toLowerCase();
    secHeaders(res);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(full).pipe(res);
  });
});

setInterval(() => manager.cleanup(), 10 * 60 * 1000).unref();
setInterval(() => accounts.cleanup(), 60 * 60 * 1000).unref();

// 对局结束后把战绩写入账号（每局只记一次）
setInterval(() => {
  for (const room of manager.rooms.values()) {
    if (room.phase !== 'over' || !room.winner || !room.game || room.historyRecorded) continue;
    room.historyRecorded = true;
    for (const gp of room.game.players) {
      if (!gp.accountId) continue;
      const win = (gp.identity === 'lord' || gp.identity === 'loyal')
        ? room.winner === 'lord'
        : gp.identity === 'rebel' ? room.winner === 'rebel' : room.winner === 'spy';
      accounts.recordGame(gp.accountId, {
        mode: room.mode,
        winner: room.winner,
        identity: gp.identity,
        result: win ? 'win' : 'lose',
        generalId: gp.general.id,
        generalName: gp.general.name,
        seat: gp.seat,
      });
    }
  }
}, 3000).unref();

server.headersTimeout = 10000;
server.requestTimeout = 30000;
server.keepAliveTimeout = 5000;
server.maxHeadersCount = 100;

server.listen(PORT, HOST, () => {
  console.log(`三国杀·军争 运行于 http://${HOST === '0.0.0.0' ? '本机局域网IP' : HOST}:${PORT}`);
  console.log(`账号数据目录：${DATA_DIR}`);
  if (HOST === '0.0.0.0') console.log(`局域网模式：手机用 http://<本机局域网IP>:${PORT} 打开（需同一 Wi-Fi 且防火墙放行）`);
});
