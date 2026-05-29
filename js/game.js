// game.js – Game state machine

const STATE = {
  IDLE:      'idle',
  PLAYING:   'playing',
  THINKING:  'thinking',   // engine thinking
  GAME_OVER: 'game_over',
  REVIEWING: 'reviewing',
  DRILLING:  'drilling',
};

class ChessGame {
  constructor(engine, board) {
    this.engine = engine;
    this.board  = board;

    this.chess       = new Chess();
    this.state       = STATE.IDLE;
    this.playerColor = 'w';
    this.skillLevel  = 10;
    this.thinkMs     = 1500;

    // Array of { san, from, to, fenBefore, fenAfter, cpLoss, classification }
    this.history = [];

    // Review
    this.reviewIdx = 0;   // position index in review (0 = starting pos)

    // Drill
    this.drillIdx      = null; // index in history of the move being drilled
    this.drillAttempts = 0;

    // Post-game analysis
    this.analysing = false;

    // Callbacks (set by main.js)
    this.onState   = null;   // (state, extra) => void
    this.onHistory = null;   // (history, reviewIdx) => void
    this.onAnalysis = null;  // ({ phase, current, total }) => void
  }

  // ── New game ─────────────────────────────────────────────────────
  newGame(colorChoice) {
    this.engine.stop();
    this.chess   = new Chess();
    this.history = [];
    this.reviewIdx = 0;
    this.analysing = false;

    if (colorChoice === 'r') {
      this.playerColor = Math.random() < 0.5 ? 'w' : 'b';
    } else {
      this.playerColor = colorChoice;
    }

    this.engine.setSkillLevel(this.skillLevel);
    this.board.myColor = this.playerColor;
    this.board.setFlipped(this.playerColor === 'b');
    this.board.clearHighlights();
    this.board.render(this.chess);

    this._setState(STATE.PLAYING);
    this._emit();

    if (this.playerColor === 'b') this._engineTurn();
  }

  // ── Player move attempt ──────────────────────────────────────────
  async attemptMove(from, to) {
    if (this.state !== STATE.PLAYING && this.state !== STATE.DRILLING) return;
    if (this.state === STATE.PLAYING && this.chess.turn() !== this.playerColor) return;

    const promotion = this._promoIfNeeded(from, to);
    const fenBefore = this.chess.fen();
    const move = this.chess.move({ from, to, promotion });

    if (!move) {
      this.board.flashError(from, to);
      return;
    }

    const fenAfter = this.chess.fen();

    if (this.state === STATE.DRILLING) {
      await this._handleDrillAttempt(move, from, to, fenBefore);
      return;
    }

    this.history.push({ san: move.san, from, to, fenBefore, fenAfter,
                        cpLoss: null, classification: null });
    this._afterMove(from, to);
  }

  _afterMove(from, to) {
    this.board.render(this.chess);
    this.board.markLastMove(from, to);
    if (this.board.blindMode === 'reveal') this.board.revealAll();
    this._emit();
    if (this.chess.game_over()) { this._gameOver(); return; }
    this._engineTurn();
  }

  // ── Engine turn ──────────────────────────────────────────────────
  async _engineTurn() {
    this._setState(STATE.THINKING);
    const fen     = this.chess.fen();
    const moveStr = await this.engine.getBestMove(fen, this.thinkMs);
    if (!moveStr || this.state !== STATE.THINKING) return;

    const from = moveStr.slice(0, 2);
    const to   = moveStr.slice(2, 4);
    const promo = moveStr.length > 4 ? moveStr[4] : undefined;

    const fenBefore = this.chess.fen();
    const move = this.chess.move({ from, to, promotion: promo });
    if (!move) return;

    const fenAfter = this.chess.fen();
    this.history.push({ san: move.san, from, to, fenBefore, fenAfter,
                        cpLoss: null, classification: null });

    this.board.render(this.chess);
    this.board.markLastMove(from, to);
    if (this.board.blindMode === 'reveal') this.board.revealAll();
    this._emit();
    if (this.chess.game_over()) { this._gameOver(); return; }
    this._setState(STATE.PLAYING);
  }

  _gameOver() {
    this._setState(STATE.GAME_OVER);
    this._emit();
  }

  getResult() {
    if (!this.chess.game_over()) return null;
    if (this.chess.in_checkmate()) return this.chess.turn() === this.playerColor ? 'loss' : 'win';
    return 'draw';
  }

  getTermination() {
    if (this.chess.in_checkmate()) return 'Checkmate';
    if (this.chess.in_stalemate()) return 'Stalemate';
    if (this.chess.in_threefold_repetition()) return 'Threefold repetition';
    if (this.chess.insufficient_material()) return 'Insufficient material';
    if (this.chess.in_draw()) return 'Draw';
    return '';
  }

  // ── Review mode ──────────────────────────────────────────────────
  startReview() {
    this._setState(STATE.REVIEWING);
    this.reviewIdx = 0;
    this._renderReview();
    this._analyseGame();   // async
  }

  reviewGoTo(idx) {
    if (this.state !== STATE.REVIEWING) return;
    this.reviewIdx = Math.max(0, Math.min(this.history.length, idx));
    this._renderReview();
  }

  reviewPrev() { this.reviewGoTo(this.reviewIdx - 1); }
  reviewNext() { this.reviewGoTo(this.reviewIdx + 1); }

  _renderReview() {
    const tmp = new Chess();
    for (let i = 0; i < this.reviewIdx; i++) {
      const m = this.history[i];
      tmp.move({ from: m.from, to: m.to, promotion: this._promoFromSan(m.san) });
    }
    this.board.setFullVisibility();
    this.board.render(tmp);
    if (this.reviewIdx > 0) {
      const last = this.history[this.reviewIdx - 1];
      this.board.markLastMove(last.from, last.to);
    } else {
      this.board.clearHighlights();
    }
    this._emit();
  }

  // ── Post-game analysis ───────────────────────────────────────────
  async _analyseGame() {
    if (this.analysing) return;
    this.analysing = true;

    const fens = [];
    const tmp  = new Chess();
    fens.push(tmp.fen());
    for (const m of this.history) {
      tmp.move({ from: m.from, to: m.to, promotion: this._promoFromSan(m.san) });
      fens.push(tmp.fen());
    }

    const total = fens.length;
    if (this.onAnalysis) this.onAnalysis({ phase: 'start', total });

    const evals = [];
    for (let i = 0; i < total; i++) {
      const ev = await this.engine.evaluatePosition(fens[i], 300);
      evals.push(ev);
      if (this.onAnalysis) this.onAnalysis({ phase: 'progress', current: i + 1, total });
    }

    // Classify each move
    for (let i = 0; i < this.history.length; i++) {
      const E1 = this._rawScore(evals[i]);
      const E2 = this._rawScore(evals[i + 1]);
      // Centipawn loss = E1 + E2
      // (E1 from mover's perspective, E2 from opponent's; loss = E1 - (-E2) = E1 + E2)
      const loss = E1 + E2;
      this.history[i].cpLoss = loss;
      if      (loss >= 300) this.history[i].classification = 'blunder';
      else if (loss >= 100) this.history[i].classification = 'mistake';
      else if (loss >=  50) this.history[i].classification = 'inaccuracy';
      else                  this.history[i].classification = 'good';
    }

    this.analysing = false;
    if (this.onAnalysis) this.onAnalysis({ phase: 'done' });
    this._emit();
  }

  _rawScore(ev) {
    if (!ev) return 0;
    if (ev.mate !== null) return ev.mate > 0 ? 10000 : -10000;
    return ev.score || 0;
  }

  // ── Drill mode ───────────────────────────────────────────────────
  startDrill(histIdx) {
    if (histIdx < 0 || histIdx >= this.history.length) return;
    this.drillIdx      = histIdx;
    this.drillAttempts = 0;

    // Rebuild position up to (but not including) the drilled move
    const tmp = new Chess();
    for (let i = 0; i < histIdx; i++) {
      const m = this.history[i];
      tmp.move({ from: m.from, to: m.to, promotion: this._promoFromSan(m.san) });
    }
    this.chess = tmp;

    this.board.setFullVisibility();
    this.board.render(this.chess);
    this.board.clearHighlights();
    this._setState(STATE.DRILLING, { drillResult: null });
  }

  async _handleDrillAttempt(move, from, to, fenBefore) {
    this.drillAttempts++;

    // Undo so we can ask engine for the best move from fenBefore
    this.chess.undo();
    const bestStr = await this.engine.getBestMove(fenBefore, 2000);
    // Re-apply player's move
    this.chess.move({ from, to, promotion: this._promoIfNeeded(from, to) });

    const playerStr  = from + to;
    const isCorrect  = bestStr && playerStr === bestStr.slice(0, 4);

    this.board.render(this.chess);

    if (isCorrect) {
      this._setState(STATE.DRILLING, { drillResult: 'correct' });
      // Continue playing from this position
      this._setState(STATE.PLAYING);
      this._engineTurn();
    } else {
      // Show correct answer after first wrong try
      this.chess.undo();
      const correctFrom = bestStr ? bestStr.slice(0, 2) : null;
      const correctTo   = bestStr ? bestStr.slice(2, 4) : null;
      this.board.render(this.chess);
      if (correctFrom) this.board.markCorrectMove(correctFrom, correctTo);
      this._setState(STATE.DRILLING, { drillResult: 'wrong', correctFrom, correctTo });
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────
  _promoIfNeeded(from, to) {
    const piece = this.chess.get(from);
    if (!piece || piece.type !== 'p') return undefined;
    const rank = parseInt(to[1]);
    if ((piece.color === 'w' && rank === 8) || (piece.color === 'b' && rank === 1)) return 'q';
    return undefined;
  }

  _promoFromSan(san) {
    if (!san) return undefined;
    const m = san.match(/=([QRBN])/i);
    return m ? m[1].toLowerCase() : undefined;
  }

  _setState(s, extra = {}) {
    this.state = s;
    if (this.onState) this.onState(s, extra);
  }

  _emit() {
    if (this.onHistory) this.onHistory(this.history, this.reviewIdx);
  }
}
