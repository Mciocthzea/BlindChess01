// engine.js – Stockfish 10 wrapper via Web Worker

class StockfishEngine {
  constructor() {
    this.worker  = null;
    this.ready   = false;
    this.onMsg   = null; // single active callback – enforces serial use
  }

  // ── Init ────────────────────────────────────────────────────────
  // Expects stockfish.js to be present in the same folder as index.html.
  // See download instructions in the README comment at the top of index.html.
  init() {
    return new Promise((resolve, reject) => {
      this.worker = new Worker('stockfish.js');

      this.worker.onerror = (e) => reject(new Error('Stockfish worker error: ' + e.message));

      this.worker.onmessage = (e) => {
        const msg = e.data;
        if (typeof msg !== 'string') return;

        if (this.onMsg) this.onMsg(msg);

        if (msg === 'uciok') {
          this._send('isready');
        }
        if (msg === 'readyok' && !this.ready) {
          this.ready = true;
          resolve();
        }
      };

      this._send('uci');
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────
  _send(cmd) {
    if (this.worker) this.worker.postMessage(cmd);
  }

  setSkillLevel(level) {
    level = Math.max(0, Math.min(20, Math.round(level)));
    this._send(`setoption name Skill Level value ${level}`);
    this._send('isready'); // flush
  }

  stop() {
    this._send('stop');
  }

  // ── Best move ────────────────────────────────────────────────────
  // Returns a promise → UCI move string e.g. "e2e4", or null
  getBestMove(fen, thinkMs = 1500) {
    return new Promise((resolve) => {
      this.onMsg = (msg) => {
        if (msg.startsWith('bestmove')) {
          this.onMsg = null;
          const token = msg.split(' ')[1];
          resolve((!token || token === '(none)') ? null : token);
        }
      };
      this._send(`position fen ${fen}`);
      this._send(`go movetime ${thinkMs}`);
    });
  }

  // ── Position evaluation ──────────────────────────────────────────
  // Returns { score: centipawns | null, mate: N | null }
  // score is from the perspective of the side to move (UCI standard)
  evaluatePosition(fen, thinkMs = 300) {
    return new Promise((resolve) => {
      let lastScore = 0;
      let lastMate  = null;

      this.onMsg = (msg) => {
        if (msg.startsWith('info') && msg.includes('score')) {
          const mateM = msg.match(/score mate (-?\d+)/);
          const cpM   = msg.match(/score cp (-?\d+)/);
          if (mateM) {
            lastMate  = parseInt(mateM[1], 10);
            lastScore = null;
          } else if (cpM) {
            lastScore = parseInt(cpM[1], 10);
            lastMate  = null;
          }
        }
        if (msg.startsWith('bestmove')) {
          this.onMsg = null;
          resolve({ score: lastScore, mate: lastMate });
        }
      };
      this._send(`position fen ${fen}`);
      this._send(`go movetime ${thinkMs}`);
    });
  }
}
