# Chess Trainer — Specs

## Overview

Browser-based chess training app. The player competes against a Stockfish engine opponent, with optional vision restrictions to train board visualization. After the game, Stockfish analyses every move and the player can review and drill their mistakes.

Requires a local HTTP server (e.g. VS Code Live Server) because Stockfish loads as a Web Worker.

---

## File Structure

```
index.html        — Layout and script loading order
css/style.css     — All styles
js/engine.js      — Stockfish Web Worker wrapper (UCI protocol)
js/board.js       — Board rendering, drag-and-drop, blind modes
js/game.js        — Game state machine
js/main.js        — UI wiring and initialisation
stockfish.js      — Stockfish engine (must be placed in project root)
```

**External dependencies (CDN):**
- `chess.js 0.10.3` — move validation, FEN/SAN handling
- Lichess cburnett SVG piece set (fetched from raw.githubusercontent.com)

---

## Architecture

### engine.js — `StockfishEngine`

Wraps Stockfish running in a Web Worker via the UCI protocol.

- `init()` — spawns the worker, sends `uci` / `isready`, resolves when `readyok`
- `setSkillLevel(0–20)` — sets Stockfish `Skill Level` option
- `getBestMove(fen, thinkMs)` → UCI move string (e.g. `"e2e4"`) or `null`
- `evaluatePosition(fen, thinkMs)` → `{ score: centipawns | null, mate: N | null }` from the perspective of the side to move
- `stop()` — sends `stop` to abort any current search
- Single active callback pattern (`this.onMsg`) enforces serial use of the worker

### board.js — `ChessBoard`

Renders the 8×8 board as 64 `<div>` elements. Handles all visual concerns.

- **Rendering** — `render(chess)` reads piece positions from a `chess.js` instance and sets SVG background images
- **Flip** — `setFlipped(bool)` rebuilds the board and re-attaches drag listeners; Black plays from the bottom when flipped
- **Coordinate system** — index 0 is always the visual top-left; `_squareOf(idx)` and `_idxOf(sq)` convert between index and algebraic notation accounting for flip
- **Drag-and-drop** — mousedown/mousemove/mouseup on `window`; a floating `#drag-ghost` element follows the cursor; fires `onMoveAttempt(from, to)` on drop
- **Highlights** — `markLastMove(from, to)` (yellow), `markCorrectMove(from, to)` (reuses yellow), `flashError(from, to)` (red flash + buzz sound via Web Audio API)
- **Resize** — corner drag handle resizes the board between 200px and 900px
- **Blind modes** — see Vision Modes section below

### game.js — `ChessGame`

State machine with six states: `idle → playing ↔ thinking → game_over → reviewing → drilling`

**States:**
| State | Description |
|---|---|
| `idle` | No game in progress |
| `playing` | Waiting for the player to move |
| `thinking` | Engine is calculating its reply |
| `game_over` | Game ended (checkmate, stalemate, draw) |
| `reviewing` | Stepping through the completed game |
| `drilling` | Re-practising a specific mistake position |

**Key methods:**
- `newGame(colorChoice)` — resets everything, flips board if playing Black, triggers engine move if player is Black
- `attemptMove(from, to)` — validates and applies the player's move; handles promotion (auto-queens); routes to drill handler if in drill state
- `_engineTurn()` — async; asks engine for best move, applies it, checks for game over
- `startReview()` — enters review state, kicks off `_analyseGame()` asynchronously
- `reviewGoTo(idx)` / `reviewPrev()` / `reviewNext()` — navigate the move history
- `startDrill(histIdx)` — rebuilds board to the position before the chosen move
- `_handleDrillAttempt(move, ...)` — compares player's move to engine's best; shows correct move on wrong answer
- `_analyseGame()` — evaluates every position sequentially, computes centipawn loss per move, classifies each move

**Callbacks set by main.js:**
- `onState(state, extra)` — fired on every state transition
- `onHistory(history, reviewIdx)` — fired after every move or review navigation
- `onAnalysis({ phase, current, total })` — fired during post-game analysis

**Move history entry shape:**
```js
{ san, from, to, fenBefore, fenAfter, cpLoss, classification }
// classification: 'good' | 'inaccuracy' | 'mistake' | 'blunder' | null
```

### main.js — UI wiring

Initialises engine → board → game on `window.load`. Wires all DOM controls to game/board/engine methods. Renders the move list and manages visibility of UI sections based on game state.

---

## Features

### Engine Strength
Stockfish Skill Level 0–20, controlled by a range slider. Applied immediately to the engine and stored on the game object.

### Vision Modes

Four modes selectable at any time during a game:

| Mode | Behaviour |
|---|---|
| **Full** | Normal view — all pieces visible |
| **Ghost** | All pieces hidden (blindfold chess) |
| **Partial** | Selectively hide your pieces, opponent's pieces, or both (two checkboxes) |
| **Reveal** | All pieces hidden; after each move they briefly flash visible for a configurable duration (0.1s–10s), then hide again |

Vision is always restored to full during review and drill.

### Post-game Analysis

Triggered automatically when the player clicks "Review Game". Evaluates every position (including start) sequentially using Stockfish at 300ms per position. Centipawn loss per move is computed as:

```
cpLoss = eval_before (mover's POV) + eval_after (opponent's POV)
```

Classification thresholds:
- `blunder` — cpLoss ≥ 300
- `mistake` — cpLoss ≥ 100
- `inaccuracy` — cpLoss ≥ 50
- `good` — cpLoss < 50

Annotations appear in the move list as `??`, `?`, `?!`. Hovering a move shows the exact centipawn loss as a tooltip.

### Review Mode

Step through the completed game move-by-move with prev/next buttons or by clicking any move in the move list. The current move is highlighted. Board shows full visibility in this mode.

### Drill Mode

Available from review on player moves classified as blunder or mistake. Rebuilds the board to the position just before that move and lets the player try to find the best move. Compares the player's move to the engine's best move (2s think time). On a wrong answer, shows the correct move highlighted on the board. On a correct answer, continues the game from that position with the engine.

### Color Selection

Dropdown to play as White, Black, or Random. The board flips when playing Black.

---

## Running Locally

1. Place `stockfish.js` in the project root (same folder as `index.html`)
2. Serve via a local HTTP server (e.g. VS Code Live Server, `npx serve`, Python `http.server`)
3. Open in a modern browser
