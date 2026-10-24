'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RoomManager } = require('./rooms');
const { GENERALS, CARD_DEFS, DECK_COUNTS } = require('./data');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');
const manager = new RoomManager();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise(resolve => {
    let s = '';
    req.on('data', d => { s += d; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch (e) { resolve({}); } });
  });
}

function newPlayer(name) {
  return { id: 'p_' + crypto.randomBytes(8).toString('hex'), name: String(name || '玩家').slice(0, 12), token: crypto.randomBytes(16).toString('hex') };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  if (p === '/api/data' && req.method === 'GET') {
    return json(res, 200, { generals: GENERALS, cards: CARD_DEFS, deck: DECK_COUNTS });
  }

  if (p === '/api/join' && req.method === 'POST') {
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    if (!name) return json(res, 400, { error: '请输入昵称' });
    const mode = Number(body.mode) === 5 ? 5 : 8;
    const action = body.action;
    const player = newPlayer(name);
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
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    room.attachStream(pid, res);
    const timer = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 20000);
    req.on('close', () => { clearInterval(timer); room.detachStream(pid); });
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
  let file = p === '/' ? '/index.html' : decodeURIComponent(p);
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC)) return json(res, 403, { error: 'forbidden' });
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404');
      return;
    }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(full).pipe(res);
  });
});

setInterval(() => manager.cleanup(), 10 * 60 * 1000).unref();

server.listen(PORT, HOST, () => {
  console.log(`三国杀·军争 运行于 http://${HOST === '0.0.0.0' ? '本机局域网IP' : HOST}:${PORT}`);
  if (HOST === '0.0.0.0') console.log(`局域网模式：手机用 http://<本机局域网IP>:${PORT} 打开（需同一 Wi-Fi 且防火墙放行）`);
});
