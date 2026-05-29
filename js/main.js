// main.js – UI wiring and initialisation

let engine, board, game;

// ── DOM refs ──────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const ui = {
  statusText:     $('status-text'),
  turnIndicator:  $('turn-indicator'),
  btnNewGame:     $('btn-new-game'),
  btnReview:      $('btn-review-game'),
  selectColor:    $('select-color'),
  strengthSlider: $('strength-slider'),
  strengthVal:    $('strength-value'),
  modeBtns:       document.querySelectorAll('.mode-btn'),
  partialOptions: $('partial-options'),
  revealOptions:  $('reveal-options'),
  hideMine:       $('hide-mine'),
  hideOpponent:   $('hide-opponent'),
  revealDur:      $('reveal-duration'),
  moveList:       $('move-list'),
  reviewControls: $('review-controls'),
  reviewPos:      $('review-position'),
  btnPrev:        $('btn-prev'),
  btnNext:        $('btn-next'),
  drillSection:   $('drill-section'),
  btnDrill:       $('btn-drill'),
  drillStatus:    $('drill-status'),
  analysisSection:$('analysis-section'),
  analysisProg:   $('analysis-progress'),
  footerStatus:   $('footer-status'),
};

// ── Boot ──────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  setFooter('Loading Stockfish engine…');

  engine = new StockfishEngine();
  try {
    await engine.init();
    setFooter('Engine ready. Start a new game.');
  } catch (err) {
    setFooter('Engine failed: ' + err.message + '. Is stockfish.js in the project root folder?');
    console.error(err);
    return;
  }

  board = new ChessBoard('board');
  game  = new ChessGame(engine, board);

  // Board → game
  board.onMoveAttempt = (from, to) => game.attemptMove(from, to);

  // Game → UI
  game.onState   = (state, extra) => onStateChange(state, extra);
  game.onHistory = (hist, revIdx) => renderMoveList(hist, revIdx);
  game.onAnalysis = (info)        => onAnalysis(info);

  wireControls();
});

// ── Controls ──────────────────────────────────────────────────────
function wireControls() {
  ui.btnNewGame.addEventListener('click', () => {
    game.newGame(ui.selectColor.value);
  });

  ui.strengthSlider.addEventListener('input', () => {
    const v = parseInt(ui.strengthSlider.value);
    ui.strengthVal.textContent = v;
    if (game) game.skillLevel = v;
    if (engine) engine.setSkillLevel(v);
  });

  ui.modeBtns.forEach(btn => btn.addEventListener('click', () => {
    ui.modeBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const mode = btn.dataset.mode;
    ui.partialOptions.style.display = mode === 'partial' ? 'flex' : 'none';
    ui.revealOptions.style.display  = mode === 'reveal'  ? 'flex' : 'none';
    applyVisionMode(mode);
  }));

  ui.hideMine.addEventListener('change',     () => applyVisionMode('partial'));
  ui.hideOpponent.addEventListener('change', () => applyVisionMode('partial'));

  ui.revealDur.addEventListener('change', () => {
    board.revealDuration = parseFloat(ui.revealDur.value) * 1000;
  });

  ui.btnReview.addEventListener('click', () => {
    ui.analysisSection.style.display = 'block';
    game.startReview();
  });

  ui.btnPrev.addEventListener('click', () => game.reviewPrev());
  ui.btnNext.addEventListener('click', () => game.reviewNext());

  ui.btnDrill.addEventListener('click', () => {
    const idx = game.reviewIdx - 1;
    if (idx >= 0) game.startDrill(idx);
  });
}

function applyVisionMode(mode) {
  if (!board) return;
  if (mode === 'partial') {
    board.setBlindMode('partial', {
      hideMine:     ui.hideMine.checked,
      hideOpponent: ui.hideOpponent.checked,
    });
  } else {
    board.setBlindMode(mode);
  }
}

// ── State → UI ────────────────────────────────────────────────────
function onStateChange(state, extra = {}) {
  // Reset dynamic sections
  ui.reviewControls.style.display = 'none';
  ui.drillSection.style.display   = 'none';
  ui.btnReview.style.display      = 'none';
  ui.turnIndicator.textContent    = '';
  ui.drillStatus.textContent      = '';

  switch (state) {
    case 'idle':
      ui.statusText.textContent = 'Press "New Game" to start.';
      break;

    case 'playing':
      const t = game.chess.turn();
      ui.statusText.textContent = t === game.playerColor ? 'Your turn' : 'Thinking…';
      ui.turnIndicator.textContent = t === 'w' ? '⬜ White to move' : '⬛ Black to move';
      break;

    case 'thinking':
      ui.statusText.innerHTML = '<span class="thinking">Engine thinking…</span>';
      ui.turnIndicator.textContent = game.chess.turn() === 'w' ? '⬜ White to move' : '⬛ Black to move';
      break;

    case 'game_over':
      const result = game.getResult();
      const term   = game.getTermination();
      const label  = result === 'win' ? 'You won!' : result === 'loss' ? 'You lost.' : 'Draw.';
      ui.statusText.textContent = label + (term ? ' ' + term + '.' : '');
      ui.btnReview.style.display = 'block';
      break;

    case 'reviewing':
      ui.statusText.textContent = 'Review mode';
      ui.reviewControls.style.display = 'flex';
      ui.drillSection.style.display   = 'block';
      updateReviewUI();
      break;

    case 'drilling':
      ui.statusText.textContent = 'Drill — find the best move';
      if (extra.drillResult === 'correct') {
        ui.drillStatus.textContent = 'Correct! Continuing game…';
      } else if (extra.drillResult === 'wrong') {
        const cf = extra.correctFrom, ct = extra.correctTo;
        ui.drillStatus.textContent =
          `Best move: ${cf}${ct} — shown on board.`;
      }
      break;
  }
}

// ── Move list ────────────────────────────────────────────────────
function renderMoveList(history, reviewIdx) {
  ui.moveList.innerHTML = '';

  for (let i = 0; i < history.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'move-row';

    const numEl = document.createElement('span');
    numEl.className = 'move-num';
    numEl.textContent = (i / 2 + 1) + '.';
    row.appendChild(numEl);

    for (let j = i; j <= i + 1 && j < history.length; j++) {
      const m   = history[j];
      const san = document.createElement('span');
      san.className = 'move-san';
      if (m.classification && m.classification !== 'good') san.classList.add(m.classification);
      if (game.state === 'reviewing' && j === reviewIdx - 1) san.classList.add('current');

      let label = m.san;
      if (m.classification === 'blunder')   label += ' ??';
      else if (m.classification === 'mistake')   label += ' ?';
      else if (m.classification === 'inaccuracy') label += ' ?!';
      san.textContent = label;

      if (m.cpLoss !== null) {
        san.title = (m.cpLoss > 0 ? '−' : '+') + Math.abs(m.cpLoss) + ' cp';
      }

      if (game.state === 'reviewing') {
        san.addEventListener('click', () => game.reviewGoTo(j + 1));
      }

      row.appendChild(san);
    }

    ui.moveList.appendChild(row);
  }

  // Auto-scroll
  ui.moveList.scrollTop = ui.moveList.scrollHeight;

  if (game.state === 'reviewing') updateReviewUI();
}

// ── Review UI helpers ────────────────────────────────────────────
function updateReviewUI() {
  const total = game.history.length;
  const cur   = game.reviewIdx;
  ui.reviewPos.textContent   = `${cur} / ${total}`;
  ui.btnPrev.disabled = cur <= 0;
  ui.btnNext.disabled = cur >= total;

  // Show drill button only on player's blundered/mistaken moves
  ui.btnDrill.style.display = 'none';
  if (cur > 0) {
    const m = game.history[cur - 1];
    const isPlayerMove = (cur % 2 === 1) === (game.playerColor === 'w');
    if (isPlayerMove && m.classification &&
        (m.classification === 'blunder' || m.classification === 'mistake')) {
      ui.btnDrill.style.display = 'block';
    }
  }
}

// ── Analysis progress ─────────────────────────────────────────────
function onAnalysis(info) {
  if (info.phase === 'start') {
    ui.analysisProg.textContent = 'Analysing…';
  } else if (info.phase === 'progress') {
    const pct = Math.round(info.current / info.total * 100);
    ui.analysisProg.textContent = `Analysing… ${pct}%`;
  } else if (info.phase === 'done') {
    ui.analysisProg.textContent = 'Analysis complete.';
    // Refresh move list with classifications
    renderMoveList(game.history, game.reviewIdx);
  }
}

// ── Footer ────────────────────────────────────────────────────────
function setFooter(msg) {
  ui.footerStatus.textContent = msg;
}
