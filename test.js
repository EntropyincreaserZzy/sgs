'use strict';
const { Room } = require('./rooms');
const { Game } = require('./engine');

// 测试模式：机器人立即决策
Game.prototype.botAnswer = async function (p, req) {
  try { return await this.botDecide(p, req); }
  catch (e) { console.error('bot err', e); return this.defaultAnswer(p, req); }
};

process.on('unhandledRejection', e => { console.error('UNHANDLED', e); process.exit(1); });

const mode = Number(process.argv[2] || 8);
const room = new Room('TEST' + mode, mode, { id: 'host', name: 'Host', token: 't' }, {});
for (let i = 0; i < (mode === 5 ? 4 : 7); i++) room.addBot();
room.seats[0].isBot = true;
room.players.get('host').isBot = true;
console.log('start', JSON.stringify(room.start()));
const t0 = Date.now();
const timer = setInterval(() => {
  if (room.phase === 'over' || (room.game && room.game.winner)) {
    clearInterval(timer);
    console.log('OVER', room.winner, 'ms', Date.now() - t0);
    console.log(room.game.logs.slice(-80).map(l => l.msg).join('\n'));
    process.exit(0);
  }
  if (Date.now() - t0 > 90000) {
    clearInterval(timer);
    console.log('TIMEOUT phase=', room.phase, 'gamePhase=', room.game && room.game.phase);
    if (room.game) {
      console.log('pending=', JSON.stringify(room.game.pending));
      console.log(room.game.logs.slice(-60).map(l => l.msg).join('\n'));
    }
    process.exit(2);
  }
}, 150);
