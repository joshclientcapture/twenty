import { useCallback, useEffect, useRef, useState } from 'react';

const COLS = 60;
const ROWS = 44;
const CELL = 10;
const WIDTH = COLS * CELL;
const HEIGHT = ROWS * CELL;
const BEST_KEY = 'conversifi-tron-best';
const BOOSTS_PER_ROUND = 3;
const BOOST_TICKS = 6;

type Direction = 'up' | 'down' | 'left' | 'right';
type Point = { x: number; y: number };
type Level = 'easy' | 'medium' | 'hard' | 'insane';
type Phase = 'ready' | 'playing' | 'won' | 'lost' | 'draw';

// Speed is cells per second. Depth is how many half-moves the computer searches (both bikes move, so 2 per
// turn). Blunder is how often it throws the search away and picks any safe move.
const LEVELS: Record<Level, { label: string; speed: number; blunder: number; depth: number }> = {
  easy: { label: 'Easy', speed: 9, blunder: 0.25, depth: 0 },
  medium: { label: 'Medium', speed: 12, blunder: 0.08, depth: 2 },
  hard: { label: 'Hard', speed: 15, blunder: 0.02, depth: 4 },
  insane: { label: 'Insane', speed: 20, blunder: 0, depth: 6 },
};
const LEVEL_ORDER: Level[] = ['easy', 'medium', 'hard', 'insane'];

const DELTA: Record<Direction, Point> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const OPPOSITE: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const ALL: Direction[] = ['up', 'down', 'left', 'right'];
const STEPS = [-COLS, COLS, -1, 1];

type Bike = { head: Point; direction: Direction; trail: Point[]; boostsLeft: number; boostTicks: number };

const readBest = (): Record<Level, number> => {
  try {
    return { easy: 0, medium: 0, hard: 0, insane: 0, ...JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') };
  } catch {
    return { easy: 0, medium: 0, hard: 0, insane: 0 };
  }
};

const writeBest = (value: Record<Level, number>) => {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(value));
  } catch {
    // Private windows and blocked storage just lose the record.
  }
};

const inside = (p: Point) => p.x >= 0 && p.y >= 0 && p.x < COLS && p.y < ROWS;
const key = (p: Point) => p.y * COLS + p.x;
const stepOk = (from: number, step: number) => {
  const to = from + step;
  if (to < 0 || to >= COLS * ROWS) return false;
  if (step === -1 && from % COLS === 0) return false;
  if (step === 1 && from % COLS === COLS - 1) return false;
  return true;
};

const queue = new Int32Array(COLS * ROWS);
const distA = new Int32Array(COLS * ROWS);
const distB = new Int32Array(COLS * ROWS);

// Breadth-first distances from a head cell (the head itself is a wall, so it is the one wall we start on).
const fill = (walls: Uint8Array, start: number, dist: Int32Array) => {
  dist.fill(-1);
  dist[start] = 0;
  let readIndex = 0;
  let writeIndex = 0;
  queue[writeIndex++] = start;
  while (readIndex < writeIndex) {
    const current = queue[readIndex++];
    const next = dist[current] + 1;
    for (const step of STEPS) {
      if (!stepOk(current, step)) continue;
      const to = current + step;
      if (walls[to] || dist[to] >= 0) continue;
      dist[to] = next;
      queue[writeIndex++] = to;
    }
  }
  return writeIndex - 1;
};

// Cells the computer reaches before the player minus the reverse. When the bikes are walled off from each
// other it becomes plain room to move, which is what decides the endgame.
const evaluate = (walls: Uint8Array, computerHead: number, playerHead: number): number => {
  const mine = fill(walls, computerHead, distA);
  const theirs = fill(walls, playerHead, distB);
  let score = 0;
  let connected = false;
  for (let i = 0; i < distA.length; i++) {
    const a = distA[i];
    const b = distB[i];
    if (a < 0 && b < 0) continue;
    if (a >= 0 && b >= 0) connected = true;
    if (b < 0 || (a >= 0 && a < b)) score++;
    else if (a < 0 || a > b) score--;
  }
  return connected ? score : (mine - theirs) * 3;
};

const safeSteps = (walls: Uint8Array, head: number, direction: Direction): Direction[] =>
  ALL.filter((d) => d !== OPPOSITE[direction] && stepOk(head, STEPS[ALL.indexOf(d)]) && !walls[head + STEPS[ALL.indexOf(d)]]);

// Alternating-move minimax with alpha-beta: the computer moves, then the player, down to `depth` half-moves.
const search = (walls: Uint8Array, computerHead: number, computerDirection: Direction, playerHead: number, playerDirection: Direction, depth: number, alpha: number, beta: number, computerToMove: boolean): number => {
  if (depth === 0) return evaluate(walls, computerHead, playerHead);
  if (computerToMove) {
    const moves = safeSteps(walls, computerHead, computerDirection);
    if (moves.length === 0) return -10000 + (6 - depth);
    let best = -Infinity;
    for (const d of moves) {
      const to = computerHead + STEPS[ALL.indexOf(d)];
      walls[to] = 1;
      const value = search(walls, to, d, playerHead, playerDirection, depth - 1, alpha, beta, false);
      walls[to] = 0;
      if (value > best) best = value;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }
  const moves = safeSteps(walls, playerHead, playerDirection);
  if (moves.length === 0) return 10000 - (6 - depth);
  let best = Infinity;
  for (const d of moves) {
    const to = playerHead + STEPS[ALL.indexOf(d)];
    if (to === computerHead) return 0;
    walls[to] = 1;
    const value = search(walls, computerHead, computerDirection, to, d, depth - 1, alpha, beta, true);
    walls[to] = 0;
    if (value < best) best = value;
    if (best < beta) beta = best;
    if (alpha >= beta) break;
  }
  return best;
};

const chooseComputerMove = (walls: Uint8Array, computer: Bike, player: Bike, level: Level): Direction => {
  const config = LEVELS[level];
  const head = key(computer.head);
  const safe = safeSteps(walls, head, computer.direction);
  if (safe.length === 0) return computer.direction;
  if (safe.length === 1) return safe[0];
  if (Math.random() < config.blunder) return safe[Math.floor(Math.random() * safe.length)];
  let bestDirection = safe[0];
  let bestScore = -Infinity;
  for (const d of safe) {
    const to = head + STEPS[ALL.indexOf(d)];
    walls[to] = 1;
    let score = config.depth === 0 ? fill(walls, to, distA) : search(walls, to, d, key(player.head), player.direction, config.depth - 1, -Infinity, Infinity, false);
    walls[to] = 0;
    // Hug the wall in the endgame and keep straight on ties, so the computer fills space instead of wobbling.
    let openNeighbours = 0;
    for (const step of STEPS) if (stepOk(to, step) && !walls[to + step]) openNeighbours++;
    score = score * 8 - openNeighbours + (d === computer.direction ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestDirection = d;
    }
  }
  return bestDirection;
};

const startingBikes = (): { player: Bike; computer: Bike } => ({
  player: { head: { x: 8, y: Math.floor(ROWS / 2) }, direction: 'right', trail: [{ x: 8, y: Math.floor(ROWS / 2) }], boostsLeft: BOOSTS_PER_ROUND, boostTicks: 0 },
  computer: { head: { x: COLS - 9, y: Math.floor(ROWS / 2) }, direction: 'left', trail: [{ x: COLS - 9, y: Math.floor(ROWS / 2) }], boostsLeft: BOOSTS_PER_ROUND, boostTicks: 0 },
});

export const TronPage = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wallsRef = useRef(new Uint8Array(COLS * ROWS));
  const bikesRef = useRef(startingBikes());
  const queuedRef = useRef<Direction | null>(null);
  const runningRef = useRef(false);
  const levelRef = useRef<Level>('medium');
  const [level, setLevel] = useState<Level>('medium');
  const [phase, setPhase] = useState<Phase>('ready');
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(readBest);
  const [boosts, setBoosts] = useState({ player: BOOSTS_PER_ROUND, computer: BOOSTS_PER_ROUND });

  const reset = useCallback(() => {
    wallsRef.current = new Uint8Array(COLS * ROWS);
    bikesRef.current = startingBikes();
    wallsRef.current[key(bikesRef.current.player.head)] = 1;
    wallsRef.current[key(bikesRef.current.computer.head)] = 1;
    queuedRef.current = null;
    runningRef.current = false;
    setBoosts({ player: BOOSTS_PER_ROUND, computer: BOOSTS_PER_ROUND });
    setPhase('ready');
  }, []);

  const start = useCallback(() => {
    if (phase === 'playing') return;
    if (phase !== 'ready') reset();
    runningRef.current = true;
    setPhase('playing');
  }, [phase, reset]);

  const pickLevel = useCallback(
    (next: Level) => {
      levelRef.current = next;
      setLevel(next);
      setWins(0);
      setLosses(0);
      setStreak(0);
      reset();
    },
    [reset],
  );

  useEffect(() => {
    reset();
  }, [reset]);

  // A boost doubles the bike's speed for a few ticks; three per round for each side.
  const boost = useCallback((bike: Bike, who: 'player' | 'computer') => {
    if (bike.boostsLeft <= 0 || bike.boostTicks > 0) return;
    bike.boostsLeft -= 1;
    bike.boostTicks = BOOST_TICKS;
    setBoosts((current) => ({ ...current, [who]: bike.boostsLeft }));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const k = event.key.toLowerCase();
      const map: Record<string, Direction> = { arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' };
      if (map[k]) {
        event.preventDefault();
        if (!runningRef.current) start();
        const current = bikesRef.current.player.direction;
        if (map[k] !== OPPOSITE[current]) queuedRef.current = map[k];
      } else if (k === ' ') {
        event.preventDefault();
        if (!runningRef.current) start();
        else boost(bikesRef.current.player, 'player');
      } else if (k === 'r') reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start, reset, boost]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let accumulator = 0;

    const finish = (result: Phase) => {
      runningRef.current = false;
      setPhase(result);
      if (result === 'won') {
        setWins((w) => w + 1);
        setStreak((s) => {
          const next = s + 1;
          setBest((current) => {
            if (next <= current[levelRef.current]) return current;
            const updated = { ...current, [levelRef.current]: next };
            writeBest(updated);
            return updated;
          });
          return next;
        });
      } else if (result === 'lost') {
        setLosses((l) => l + 1);
        setStreak(0);
      }
    };

    const straightRun = (walls: Uint8Array, bike: Bike) => {
      let run = 0;
      let p = { x: bike.head.x + DELTA[bike.direction].x, y: bike.head.y + DELTA[bike.direction].y };
      while (inside(p) && !walls[key(p)] && run < 12) {
        run++;
        p = { x: p.x + DELTA[bike.direction].x, y: p.y + DELTA[bike.direction].y };
      }
      return run;
    };

    // The computer boosts when it has open road and the player is close enough for the burst to matter,
    // or to answer the player's own boost. Easy never boosts.
    const maybeComputerBoost = (walls: Uint8Array, computer: Bike, player: Bike) => {
      if (levelRef.current === 'easy' || computer.boostsLeft <= 0 || computer.boostTicks > 0) return;
      const run = straightRun(walls, computer);
      const gap = Math.abs(player.head.x - computer.head.x) + Math.abs(player.head.y - computer.head.y);
      const answering = player.boostTicks > 0 && gap <= 14 && run >= 4;
      const racing = run >= 6 && gap <= 10 && Math.random() < 0.35;
      if (answering || racing) boost(computer, 'computer');
    };

    const tick = () => {
      const walls = wallsRef.current;
      const { player, computer } = bikesRef.current;
      if (queuedRef.current) {
        player.direction = queuedRef.current;
        queuedRef.current = null;
      }
      computer.direction = chooseComputerMove(walls, computer, player, levelRef.current);
      maybeComputerBoost(walls, computer, player);
      const playerSteps = player.boostTicks > 0 ? 2 : 1;
      const computerSteps = computer.boostTicks > 0 ? 2 : 1;
      if (player.boostTicks > 0) player.boostTicks--;
      if (computer.boostTicks > 0) computer.boostTicks--;
      for (let sub = 0; sub < 2; sub++) {
        const playerMoves = sub < playerSteps;
        const computerMoves = sub < computerSteps;
        if (!playerMoves && !computerMoves) break;
        // On the second sub-step the computer re-reads the board so a boost does not drive it into a wall.
        if (sub === 1 && computerMoves) computer.direction = chooseComputerMove(walls, computer, player, levelRef.current);
        const playerNext = playerMoves ? { x: player.head.x + DELTA[player.direction].x, y: player.head.y + DELTA[player.direction].y } : player.head;
        const computerNext = computerMoves ? { x: computer.head.x + DELTA[computer.direction].x, y: computer.head.y + DELTA[computer.direction].y } : computer.head;
        const playerCrash = playerMoves && (!inside(playerNext) || walls[key(playerNext)] === 1);
        const computerCrash = computerMoves && (!inside(computerNext) || walls[key(computerNext)] === 1);
        const headOn = playerNext.x === computerNext.x && playerNext.y === computerNext.y;
        if ((playerCrash && computerCrash) || headOn) return finish('draw');
        if (playerCrash) return finish('lost');
        if (computerCrash) return finish('won');
        if (playerMoves) {
          walls[key(playerNext)] = 1;
          player.head = playerNext;
          player.trail.push(playerNext);
        }
        if (computerMoves) {
          walls[key(computerNext)] = 1;
          computer.head = computerNext;
          computer.trail.push(computerNext);
        }
      }
    };

    const draw = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const styles = getComputedStyle(canvas);
      const floor = styles.getPropertyValue('--t-background-secondary').trim() || '#141414';
      const grid = styles.getPropertyValue('--t-border-color-light').trim() || '#2a2a2a';
      const blue = styles.getPropertyValue('--t-tag-text-blue').trim() || '#3b82f6';
      const orange = styles.getPropertyValue('--t-tag-text-orange').trim() || '#f59e0b';
      ctx.fillStyle = floor;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = CELL; x < WIDTH; x += CELL * 2) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, HEIGHT);
      }
      for (let y = CELL; y < HEIGHT; y += CELL * 2) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(WIDTH, y + 0.5);
      }
      ctx.stroke();
      const paint = (bike: Bike, colour: string) => {
        ctx.shadowColor = colour;
        ctx.shadowBlur = 8;
        ctx.fillStyle = colour;
        for (const p of bike.trail) ctx.fillRect(p.x * CELL + 1, p.y * CELL + 1, CELL - 2, CELL - 2);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        if (bike.boostTicks > 0) {
          ctx.shadowColor = '#ffffff';
          ctx.shadowBlur = 14;
        }
        ctx.fillRect(bike.head.x * CELL + 2, bike.head.y * CELL + 2, CELL - 4, CELL - 4);
        ctx.shadowBlur = 0;
      };
      paint(bikesRef.current.computer, orange);
      paint(bikesRef.current.player, blue);
    };

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (runningRef.current) {
        accumulator += dt;
        const stepLength = 1 / LEVELS[levelRef.current].speed;
        while (accumulator >= stepLength && runningRef.current) {
          accumulator -= stepLength;
          tick();
        }
      } else accumulator = 0;
      draw();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const headline = phase === 'won' ? 'You win' : phase === 'lost' ? 'The computer wins' : phase === 'draw' ? 'Draw' : 'Tron';
  const hint = phase === 'ready' ? 'Arrows or WASD to ride, space for a boost. First to crash loses.' : phase === 'playing' ? '' : `Streak ${streak} · best on ${LEVELS[level].label} ${best[level]}`;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        width: '100%',
        height: '100%',
        minHeight: 0,
        gap: 16,
        padding: 24,
        boxSizing: 'border-box',
        color: 'var(--t-font-color-primary)',
        background: 'var(--t-background-primary)',
      }}
    >
      <div style={{ display: 'flex', gap: 24, alignItems: 'baseline', flexWrap: 'wrap', justifyContent: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Tron</h1>
        <span style={{ color: 'var(--t-font-color-tertiary)', fontSize: 14 }}>
          You <b style={{ color: 'var(--t-tag-text-blue)' }}>{wins}</b>
        </span>
        <span style={{ color: 'var(--t-font-color-tertiary)', fontSize: 14 }}>
          Computer <b style={{ color: 'var(--t-tag-text-orange)' }}>{losses}</b>
        </span>
        <span style={{ color: 'var(--t-font-color-tertiary)', fontSize: 14 }}>
          Streak <b style={{ color: 'var(--t-font-color-primary)' }}>{streak}</b>
        </span>
        <span style={{ color: 'var(--t-font-color-tertiary)', fontSize: 14 }}>
          Best <b style={{ color: 'var(--t-font-color-primary)' }}>{best[level]}</b>
        </span>
        <span style={{ color: 'var(--t-font-color-tertiary)', fontSize: 14 }}>
          Boosts <b style={{ color: 'var(--t-tag-text-blue)', letterSpacing: 2 }}>{'\u25cf'.repeat(boosts.player)}{'\u25cb'.repeat(BOOSTS_PER_ROUND - boosts.player)}</b>{' '}
          <b style={{ color: 'var(--t-tag-text-orange)', letterSpacing: 2 }}>{'\u25cf'.repeat(boosts.computer)}{'\u25cb'.repeat(BOOSTS_PER_ROUND - boosts.computer)}</b>
        </span>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        {LEVEL_ORDER.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => pickLevel(option)}
            disabled={phase === 'playing'}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: `1px solid ${option === level ? 'var(--t-tag-text-blue)' : 'var(--t-border-color-medium)'}`,
              background: option === level ? 'color-mix(in srgb, var(--t-tag-text-blue) 18%, transparent)' : 'var(--t-background-secondary)',
              color: 'var(--t-font-color-primary)',
              fontWeight: option === level ? 600 : 500,
              fontSize: 13,
              cursor: phase === 'playing' ? 'default' : 'pointer',
              opacity: phase === 'playing' && option !== level ? 0.5 : 1,
            }}
          >
            {LEVELS[option].label}
          </button>
        ))}
      </div>

      <div style={{ position: 'relative', maxWidth: '100%' }}>
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          onPointerDown={start}
          style={{
            display: 'block',
            maxWidth: '100%',
            borderRadius: 10,
            border: '1px solid var(--t-border-color-medium)',
            cursor: 'pointer',
          }}
        />
        {phase !== 'playing' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              borderRadius: 10,
              background: 'color-mix(in srgb, var(--t-background-primary) 85%, transparent)',
              pointerEvents: 'none',
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 600 }}>{headline}</div>
            <div style={{ color: 'var(--t-font-color-tertiary)', fontSize: 14 }}>{hint}</div>
            <div
              style={{
                padding: '8px 18px',
                borderRadius: 8,
                background: '#22a35a',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              {phase === 'ready' ? 'Press space to start' : 'Press space to play again'}
            </div>
          </div>
        )}
      </div>

      <div style={{ color: 'var(--t-font-color-tertiary)', fontSize: 13 }}>
        Arrows or WASD to steer &middot; space to start, then space to boost (3 a round) &middot; R to restart &middot; you are blue, the computer is orange
      </div>
    </div>
  );
};
