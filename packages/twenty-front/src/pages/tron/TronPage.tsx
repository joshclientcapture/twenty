import { useCallback, useEffect, useRef, useState } from 'react';

const COLS = 60;
const ROWS = 44;
const CELL = 10;
const WIDTH = COLS * CELL;
const HEIGHT = ROWS * CELL;
const BEST_KEY = 'conversifi-tron-best';

type Direction = 'up' | 'down' | 'left' | 'right';
type Point = { x: number; y: number };
type Level = 'easy' | 'medium' | 'hard' | 'insane';
type Phase = 'ready' | 'playing' | 'won' | 'lost' | 'draw';

// Speed is cells per second. Smarts: how far ahead the computer thinks and how often it blunders.
const LEVELS: Record<Level, { label: string; speed: number; blunder: number; territory: boolean; cutoff: boolean }> = {
  easy: { label: 'Easy', speed: 9, blunder: 0.25, territory: false, cutoff: false },
  medium: { label: 'Medium', speed: 12, blunder: 0.08, territory: true, cutoff: false },
  hard: { label: 'Hard', speed: 15, blunder: 0.02, territory: true, cutoff: true },
  insane: { label: 'Insane', speed: 19, blunder: 0, territory: true, cutoff: true },
};
const LEVEL_ORDER: Level[] = ['easy', 'medium', 'hard', 'insane'];

const DELTA: Record<Direction, Point> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const OPPOSITE: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const ALL: Direction[] = ['up', 'down', 'left', 'right'];

type Bike = { head: Point; direction: Direction; trail: Point[] };

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

// Cells reachable from a start point without crossing walls, capped so a tick stays cheap.
const reachable = (walls: Uint8Array, start: Point, cap = COLS * ROWS): number => {
  if (!inside(start) || walls[key(start)]) return 0;
  const seen = new Uint8Array(COLS * ROWS);
  const queue: number[] = [key(start)];
  seen[key(start)] = 1;
  let count = 0;
  while (queue.length && count < cap) {
    const current = queue.shift() as number;
    count++;
    const x = current % COLS;
    const y = (current - x) / COLS;
    for (const d of ALL) {
      const next = { x: x + DELTA[d].x, y: y + DELTA[d].y };
      if (!inside(next)) continue;
      const k = key(next);
      if (walls[k] || seen[k]) continue;
      seen[k] = 1;
      queue.push(k);
    }
  }
  return count;
};

// Distance map by breadth-first search, used to count which cells each bike would reach first.
const distances = (walls: Uint8Array, start: Point): Int32Array => {
  const dist = new Int32Array(COLS * ROWS).fill(-1);
  if (!inside(start) || walls[key(start)]) return dist;
  const queue: number[] = [key(start)];
  dist[key(start)] = 0;
  while (queue.length) {
    const current = queue.shift() as number;
    const x = current % COLS;
    const y = (current - x) / COLS;
    for (const d of ALL) {
      const next = { x: x + DELTA[d].x, y: y + DELTA[d].y };
      if (!inside(next)) continue;
      const k = key(next);
      if (walls[k] || dist[k] >= 0) continue;
      dist[k] = dist[current] + 1;
      queue.push(k);
    }
  }
  return dist;
};

const territory = (walls: Uint8Array, mine: Point, theirs: Point): number => {
  const a = distances(walls, mine);
  const b = distances(walls, theirs);
  let score = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] < 0) continue;
    if (b[i] < 0 || a[i] < b[i]) score++;
    else if (a[i] > b[i]) score--;
  }
  return score;
};

const chooseComputerMove = (walls: Uint8Array, computer: Bike, player: Bike, level: Level): Direction => {
  const config = LEVELS[level];
  const options = ALL.filter((d) => d !== OPPOSITE[computer.direction]);
  const safe = options.filter((d) => {
    const next = { x: computer.head.x + DELTA[d].x, y: computer.head.y + DELTA[d].y };
    return inside(next) && !walls[key(next)];
  });
  if (safe.length === 0) return computer.direction;
  if (Math.random() < config.blunder) return safe[Math.floor(Math.random() * safe.length)];

  let bestDirection = safe[0];
  let bestScore = -Infinity;
  for (const d of safe) {
    const next = { x: computer.head.x + DELTA[d].x, y: computer.head.y + DELTA[d].y };
    const trial = walls.slice();
    trial[key(next)] = 1;
    let score = reachable(trial, next) * (config.territory ? 1 : 3);
    if (config.territory) score += territory(trial, next, player.head) * 2;
    if (config.cutoff) {
      // Prefer moving across the player's path when we already hold more ground.
      const ahead = { x: player.head.x + DELTA[player.direction].x * 3, y: player.head.y + DELTA[player.direction].y * 3 };
      const gap = Math.abs(ahead.x - next.x) + Math.abs(ahead.y - next.y);
      if (score > 0) score += Math.max(0, 12 - gap) * 4;
    }
    // Keep going straight when it is close, so the computer does not wobble.
    if (d === computer.direction) score += 3;
    if (score > bestScore) {
      bestScore = score;
      bestDirection = d;
    }
  }
  return bestDirection;
};

const startingBikes = (): { player: Bike; computer: Bike } => ({
  player: { head: { x: 8, y: Math.floor(ROWS / 2) }, direction: 'right', trail: [{ x: 8, y: Math.floor(ROWS / 2) }] },
  computer: { head: { x: COLS - 9, y: Math.floor(ROWS / 2) }, direction: 'left', trail: [{ x: COLS - 9, y: Math.floor(ROWS / 2) }] },
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

  const reset = useCallback(() => {
    wallsRef.current = new Uint8Array(COLS * ROWS);
    bikesRef.current = startingBikes();
    wallsRef.current[key(bikesRef.current.player.head)] = 1;
    wallsRef.current[key(bikesRef.current.computer.head)] = 1;
    queuedRef.current = null;
    runningRef.current = false;
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
        start();
      } else if (k === 'r') reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start, reset]);

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

    const tick = () => {
      const walls = wallsRef.current;
      const { player, computer } = bikesRef.current;
      if (queuedRef.current) {
        player.direction = queuedRef.current;
        queuedRef.current = null;
      }
      computer.direction = chooseComputerMove(walls, computer, player, levelRef.current);
      const playerNext = { x: player.head.x + DELTA[player.direction].x, y: player.head.y + DELTA[player.direction].y };
      const computerNext = { x: computer.head.x + DELTA[computer.direction].x, y: computer.head.y + DELTA[computer.direction].y };
      const playerCrash = !inside(playerNext) || walls[key(playerNext)] === 1;
      const computerCrash = !inside(computerNext) || walls[key(computerNext)] === 1;
      const headOn = playerNext.x === computerNext.x && playerNext.y === computerNext.y;
      if ((playerCrash && computerCrash) || headOn) return finish('draw');
      if (playerCrash) return finish('lost');
      if (computerCrash) return finish('won');
      walls[key(playerNext)] = 1;
      walls[key(computerNext)] = 1;
      player.head = playerNext;
      player.trail.push(playerNext);
      computer.head = computerNext;
      computer.trail.push(computerNext);
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
        ctx.fillRect(bike.head.x * CELL + 2, bike.head.y * CELL + 2, CELL - 4, CELL - 4);
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
  const hint = phase === 'ready' ? 'Arrows or WASD to ride. First to crash loses.' : phase === 'playing' ? '' : `Streak ${streak} · best on ${LEVELS[level].label} ${best[level]}`;

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
        Arrows or WASD to steer &middot; space to start &middot; R to restart &middot; you are blue, the computer is orange
      </div>
    </div>
  );
};
