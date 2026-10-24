'use strict';
const http = require('http');
const BASE = 'http://127.0.0.1:3000';
const delay = ms => new Promise(r => setTimeout(r, ms));

async function post(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(path + ' ' + r.status + ' ' + JSON.stringify(j));
  return j;
}
let latest = null;
function waitFor(pred, ms = 12000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      if (latest && pred(latest)) return resolve(latest);
      if (Date.now() - t0 > ms) return reject(new Error('timeout waiting'));
      setTimeout(tick, 60);
    };
    tick();
  });
}
(async () => {
  const join = await post('/api/join', { name: 'HTTP测试', mode: 8, action: 'create' });
  console.log('JOIN', join.room, join.pid.slice(0, 8), 'host=', join.host);
  const { room, pid, token } = join;
  const req = http.get(`${BASE}/api/events?room=${room}&pid=${pid}&token=${token}`, res => {
    let buf = '';
    res.on('data', d => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        for (const line of block.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const obj = JSON.parse(line.slice(6));
              if (obj.type === 'state') latest = obj.state;
            } catch (_) { }
          }
        }
      }
    });
  });
  await waitFor(s => s.phase === 'lobby' && s.seats.length === 8);
  console.log('LOBBY seats', latest.seats.filter(x => x.id).length);
  for (let i = 0; i < 7; i++) await post('/api/action', { room, pid, token, action: { action: 'addBot' } });
  await waitFor(s => s.phase === 'lobby' && s.seats.every(x => x.id));
  console.log('FULL seats', latest.seats.length);
  await post('/api/action', { room, pid, token, action: { action: 'start' } });
  await waitFor(s => s.phase === 'draft');
  console.log('DRAFT lord', latest.draft.lordName, 'youAreLord', latest.draft.lordId === pid, 'options', latest.draft.options.length);
  // 若主公是真人，选第一个；否则等机器人主公选完，轮到自己
  if (latest.draft.lordId === pid) {
    await post('/api/action', { room, pid, token, action: { action: 'pick', generalId: latest.draft.options[0].id } });
  }
  await waitFor(s => s.phase === 'draft' && s.draft.options.length && !s.draft.chosen, 15000);
  console.log('YOUR OPTIONS', latest.draft.options.map(g => g.name).join(','));
  await post('/api/action', { room, pid, token, action: { action: 'pick', generalId: latest.draft.options[0].id } });
  await waitFor(s => s.phase === 'playing' && s.game, 15000);
  console.log('PLAYING phase', latest.game.phase, 'players', latest.game.players.length, 'hand', latest.game.you.hand.length);
  console.log('generals', latest.game.players.map(p => p.general.name).join(','));
  await delay(6000);
  console.log('AFTER SWAP phase', latest.game.phase, 'turn', latest.game.turnName, 'pending', latest.game.pending && latest.game.pending.type);
  req.destroy();
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
