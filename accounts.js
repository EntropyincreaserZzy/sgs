'use strict';

// 账号 / 会话 / 战绩的轻量持久化存储。
// 只使用 Node 内置模块，数据保存在 DATA_DIR/db.json（Docker 部署时挂载到 /data）。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const USERNAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fa5]{3,20}$/;
const MAX_DISPLAY = 12;

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}
function safeEqualHex(a, b) {
  const ba = Buffer.from(String(a || ''), 'hex');
  const bb = Buffer.from(String(b || ''), 'hex');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

class AccountStore {
  constructor(dir) {
    this.dir = dir || path.join(__dirname, 'data');
    this.file = path.join(this.dir, 'db.json');
    this.data = { users: [], sessions: {}, games: [] };
    this.load();
  }

  load() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data = {
          users: Array.isArray(raw.users) ? raw.users : [],
          sessions: raw.sessions && typeof raw.sessions === 'object' ? raw.sessions : {},
          games: Array.isArray(raw.games) ? raw.games : [],
        };
      }
    } catch (e) {
      console.error('账号数据读取失败：', e.message);
    }
  }

  save() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('账号数据保存失败：', e.message);
    }
  }

  clean() {
    const t = Date.now();
    let changed = false;
    for (const [token, s] of Object.entries(this.data.sessions)) {
      if (!s || !s.expires || s.expires < t) { delete this.data.sessions[token]; changed = true; }
    }
    if (changed) this.save();
  }

  publicUser(user) {
    if (!user) return null;
    const games = this.data.games.filter(g => g.userId === user.id);
    const wins = games.filter(g => g.result === 'win').length;
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      createdAt: user.createdAt,
      stats: {
        games: games.length,
        wins,
        winRate: games.length ? Math.round((wins / games.length) * 100) : 0,
        lastPlayed: games.length ? games[games.length - 1].at : null,
      },
      history: games.slice(-20).reverse(),
    };
  }

  register(username, password, displayName) {
    username = String(username || '').trim();
    password = String(password || '');
    displayName = String(displayName || username).trim().slice(0, MAX_DISPLAY);
    if (!USERNAME_RE.test(username)) return { error: '用户名需 3-20 位，只能包含中文、字母、数字、下划线' };
    if (password.length < 6 || password.length > 64) return { error: '密码需 6-64 位' };
    if (!displayName) return { error: '请输入昵称' };
    const lower = username.toLowerCase();
    if (this.data.users.some(u => u.usernameLower === lower)) return { error: '用户名已存在' };
    const salt = crypto.randomBytes(16).toString('hex');
    const user = {
      id: 'u_' + crypto.randomBytes(8).toString('hex'),
      username,
      usernameLower: lower,
      displayName,
      salt,
      hash: hashPassword(password, salt),
      createdAt: Date.now(),
    };
    this.data.users.push(user);
    this.save();
    return { user: this.publicUser(user) };
  }

  login(username, password) {
    const lower = String(username || '').trim().toLowerCase();
    const user = this.data.users.find(u => u.usernameLower === lower);
    if (!user) return { error: '用户名或密码错误' };
    if (!safeEqualHex(user.hash, hashPassword(String(password || ''), user.salt))) return { error: '用户名或密码错误' };
    const token = crypto.randomBytes(32).toString('hex');
    this.data.sessions[token] = { userId: user.id, expires: Date.now() + SESSION_MS };
    this.clean();
    this.save();
    return { user: this.publicUser(user), token };
  }

  logout(token) {
    if (token && this.data.sessions[token]) {
      delete this.data.sessions[token];
      this.save();
    }
  }

  userByToken(token) {
    if (!token) return null;
    const s = this.data.sessions[token];
    if (!s) return null;
    if (!s.expires || s.expires < Date.now()) {
      delete this.data.sessions[token];
      this.save();
      return null;
    }
    return this.data.users.find(u => u.id === s.userId) || null;
  }

  recordGame(userId, record) {
    const user = this.data.users.find(u => u.id === userId);
    if (!user) return;
    this.data.games.push({ userId, at: Date.now(), ...record });
    if (this.data.games.length > 5000) this.data.games.splice(0, this.data.games.length - 5000);
    this.save();
  }

  cleanup() { this.clean(); }
}

module.exports = { AccountStore, SESSION_MS };
