// board.js – Board rendering, drag-and-drop, blind modes

// ── Piece image URLs (Lichess cburnett set) ──────────────────────
const PIECE_IMG = {};
['w', 'b'].forEach(c =>
  ['K','Q','R','B','N','P'].forEach(t => {
    PIECE_IMG[c + t.toLowerCase()] =
      `https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/cburnett/${c}${t}.svg`;
  })
);

// ── Buzz sound via Web Audio API ─────────────────────────────────
function playBuzz() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.25);
    gain.gain.setValueAtTime(0.28, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.25);
  } catch (_) { /* audio unavailable */ }
}

// ── ChessBoard ───────────────────────────────────────────────────
class ChessBoard {
  constructor(containerId) {
    this.el       = document.getElementById(containerId);
    this.ghost    = document.getElementById('drag-ghost');
    this.squares  = [];   // 64 square DOM elements; index 0 = visual top-left
    this.flipped  = false;

    // Blind mode
    this.blindMode      = 'full';   // 'full' | 'ghost' | 'partial' | 'reveal'
    this.hideMine       = true;
    this.hideOpponent   = false;
    this.myColor        = 'w';
    this.revealDuration = 1000;     // ms
    this._revealTimer   = null;

    // Drag state
    this._dragging    = false;
    this._dragFromIdx = null;

    // Callback: called with (fromSquare, toSquare) on every drop
    this.onMoveAttempt = null;

    this._build();
    this._attachDrag();
  }

  // ── Build 64 squares ────────────────────────────────────────────
  _build() {
    this.el.innerHTML = '';
    this.squares = [];
    for (let i = 0; i < 64; i++) {
      const div = document.createElement('div');
      div.className = 'square ' + ((Math.floor(i / 8) + i) % 2 === 0 ? 'light' : 'dark');
      div.dataset.idx = i;

      // Rank label (left column only)
      if (i % 8 === 0) {
        const r = document.createElement('span');
        r.className = 'coord coord-rank';
        r.textContent = this._rankOf(i);
        div.appendChild(r);
      }
      // File label (bottom row only)
      if (Math.floor(i / 8) === 7) {
        const f = document.createElement('span');
        f.className = 'coord coord-file';
        f.textContent = this._fileOf(i);
        div.appendChild(f);
      }

      // Piece element
      const p = document.createElement('div');
      p.className = 'piece';
      div.appendChild(p);

      this.squares.push(div);
      this.el.appendChild(div);
    }
  }

  // ── Coordinate helpers ───────────────────────────────────────────
  // idx 0 = visual top-left
  _squareOf(idx) {
    const col = idx % 8;
    const row = Math.floor(idx / 8); // 0=top
    if (this.flipped) {
      return String.fromCharCode('h'.charCodeAt(0) - col) + (row + 1);
    }
    return String.fromCharCode('a'.charCodeAt(0) + col) + (8 - row);
  }

  _idxOf(sq) {
    const col = sq.charCodeAt(0) - 'a'.charCodeAt(0);
    const rank = parseInt(sq[1]) - 1;
    if (this.flipped) {
      return (rank) * 8 + (7 - col);
    }
    return (7 - rank) * 8 + col;
  }

  _rankOf(idx) {
    const row = Math.floor(idx / 8);
    return this.flipped ? String(row + 1) : String(8 - row);
  }

  _fileOf(idx) {
    const col = idx % 8;
    return this.flipped
      ? String.fromCharCode('h'.charCodeAt(0) - col)
      : String.fromCharCode('a'.charCodeAt(0) + col);
  }

  // ── Render a Chess.js board state ───────────────────────────────
  render(chess) {
    for (let i = 0; i < 64; i++) {
      const sq = this._squareOf(i);
      const piece = chess.get(sq);
      const pieceEl = this.squares[i].querySelector('.piece');

      if (piece) {
        const key = piece.color + piece.type;
        pieceEl.style.backgroundImage = `url('${PIECE_IMG[key]}')`;
        pieceEl.dataset.color = piece.color;
        pieceEl.dataset.type  = piece.type;
        pieceEl.classList.toggle('hidden', this._isHidden(piece.color));
      } else {
        pieceEl.style.backgroundImage = '';
        pieceEl.dataset.color = '';
        pieceEl.dataset.type  = '';
        pieceEl.classList.remove('hidden');
      }
    }
  }

  // ── Blind mode logic ─────────────────────────────────────────────
  _isHidden(color) {
    switch (this.blindMode) {
      case 'full':    return false;
      case 'ghost':   return true;
      case 'partial':
        if (color === this.myColor)  return this.hideMine;
        return this.hideOpponent;
      case 'reveal':  return true;
    }
    return false;
  }

  _reapplyVisibility() {
    this.squares.forEach(sq => {
      const p = sq.querySelector('.piece');
      if (p && p.dataset.color) {
        p.classList.toggle('hidden', this._isHidden(p.dataset.color));
      }
    });
  }

  setBlindMode(mode, opts = {}) {
    clearTimeout(this._revealTimer);
    this.blindMode = mode;
    if (opts.hideMine      !== undefined) this.hideMine      = opts.hideMine;
    if (opts.hideOpponent  !== undefined) this.hideOpponent  = opts.hideOpponent;
    if (opts.revealDuration !== undefined) this.revealDuration = opts.revealDuration;
    this._reapplyVisibility();
  }

  // Briefly show all pieces then re-hide
  revealAll() {
    clearTimeout(this._revealTimer);
    this.squares.forEach(sq => {
      const p = sq.querySelector('.piece');
      if (p) p.classList.remove('hidden');
    });
    this._revealTimer = setTimeout(() => this._reapplyVisibility(), this.revealDuration);
  }

  // Switch to full visibility (e.g. during review)
  setFullVisibility() {
    this.squares.forEach(sq => sq.querySelector('.piece').classList.remove('hidden'));
  }

  // ── Highlights ───────────────────────────────────────────────────
  clearHighlights() {
    this.squares.forEach(sq => {
      sq.classList.remove('last-move-from', 'last-move-to',
                          'show-valid', 'show-valid-capture', 'error-hl');
    });
  }

  markLastMove(from, to) {
    this.squares.forEach(sq => sq.classList.remove('last-move-from', 'last-move-to'));
    if (from) this.squares[this._idxOf(from)].classList.add('last-move-from');
    if (to)   this.squares[this._idxOf(to)].classList.add('last-move-to');
  }

  markCorrectMove(from, to) {
    this.markLastMove(from, to); // reuse yellow highlight
  }

  flashError(from, to) {
    const targets = [from, to].filter(Boolean).map(s => this.squares[this._idxOf(s)]);
    targets.forEach(el => el.classList.add('error-hl'));
    playBuzz();
    setTimeout(() => targets.forEach(el => el.classList.remove('error-hl')), 750);
  }

  // ── Drag & drop ──────────────────────────────────────────────────
  _attachDrag() {
    this.el.addEventListener('mousedown', e => this._onDown(e));
    window.addEventListener('mousemove', e => this._onMove(e));
    window.addEventListener('mouseup',   e => this._onUp(e));
  }

  _squareIdxAt(clientX, clientY) {
    const rect = this.el.getBoundingClientRect();
    const sqSize = rect.width / 8;
    const col = Math.floor((clientX - rect.left)  / sqSize);
    const row = Math.floor((clientY - rect.top) / sqSize);
    if (col < 0 || col > 7 || row < 0 || row > 7) return -1;
    return row * 8 + col;
  }

  _onDown(e) {
    if (!this.onMoveAttempt) return;
    e.preventDefault();
    const idx = this._squareIdxAt(e.clientX, e.clientY);
    if (idx < 0) return;

    this._dragging    = true;
    this._dragFromIdx = idx;

    // Ghost follows cursor
    const sqPx = this.el.getBoundingClientRect().width / 8;
    const pieceEl = this.squares[idx].querySelector('.piece');
    this.ghost.style.width  = sqPx + 'px';
    this.ghost.style.height = sqPx + 'px';
    this.ghost.style.backgroundImage = pieceEl.style.backgroundImage;
    this.ghost.style.left = e.clientX + 'px';
    this.ghost.style.top  = e.clientY + 'px';
    this.ghost.style.display = pieceEl.style.backgroundImage ? 'block' : 'none';

    pieceEl.classList.add('dragging');
  }

  _onMove(e) {
    if (!this._dragging) return;
    this.ghost.style.left = e.clientX + 'px';
    this.ghost.style.top  = e.clientY + 'px';
  }

  _onUp(e) {
    if (!this._dragging) return;
    this._dragging = false;
    this.ghost.style.display = 'none';

    const fromIdx = this._dragFromIdx;
    this._dragFromIdx = null;

    if (fromIdx !== null) {
      this.squares[fromIdx].querySelector('.piece').classList.remove('dragging');
    }

    const toIdx = this._squareIdxAt(e.clientX, e.clientY);
    if (toIdx >= 0 && toIdx !== fromIdx && this.onMoveAttempt) {
      this.onMoveAttempt(this._squareOf(fromIdx), this._squareOf(toIdx));
    }
  }

  // ── Board flip ───────────────────────────────────────────────────
  setFlipped(flipped) {
    this.flipped = flipped;
    this._build();
    this._attachDrag();
  }
}
