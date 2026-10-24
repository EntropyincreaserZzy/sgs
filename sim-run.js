'use strict';
const { execFile } = require('child_process');
const path = require('path');

const IDENTS = {
  5: ['lord', 'loyal', 'rebel', 'rebel', 'spy'],
  8: ['lord', 'loyal', 'loyal', 'rebel', 'rebel', 'rebel', 'rebel', 'spy'],
};
const stats = { generals: {} };
for (const mode of [5, 8]) {
  for (const id of IDENTS[mode]) {
    stats[id] = stats[id] || { m5g: 0, m5w: 0, m8g: 0, m8w: 0, games: 0, wins: 0, timeouts: 0 };
  }
}

function run(mode) {
  return new Promise(resolve => {
    execFile(process.execPath, [path.join(__dirname, 'sim-one.js'), String(mode)], { timeout: 8000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      try { resolve(JSON.parse(String(stdout).trim().split('\n').filter(Boolean).pop())); }
      catch (e) { resolve(null); }
    });
  });
}

(async () => {
  for (const mode of [5, 8]) {
    for (let i = 0; i < 100; i++) {
      const r = await run(mode);
      if (!r) {
        if (!stats._timeouts) stats._timeouts = 0; stats._timeouts++;
        console.error(`mode ${mode} game ${i + 1} timeout/error`);
        continue;
      }
      const winners = new Set();
      if (r.winner === 'lord') { winners.add('lord'); winners.add('loyal'); }
      else if (r.winner === 'rebel') winners.add('rebel');
      else if (r.winner === 'spy') winners.add('spy');
      for (const p of r.players) {
        const s = stats[p.identity];
        if (!s) continue;
        s.games++; s[mode === 5 ? 'm5g' : 'm8g']++;
        if (winners.has(p.identity)) { s.wins++; s[mode === 5 ? 'm5w' : 'm8w']++; }
        const gs = stats.generals[p.general] || (stats.generals[p.general] = { games: 0, wins: 0 });
        gs.games++;
        if (winners.has(p.identity)) gs.wins++;
      }
      if ((i + 1) % 10 === 0) console.log(`mode ${mode} done ${i + 1}/100`);
    }
  }
  console.log('RESULT ' + JSON.stringify(stats));
})();
