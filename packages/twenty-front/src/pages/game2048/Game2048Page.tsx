import { useCallback, useEffect, useState } from 'react';

const SIZE = 4;
const BEST_KEY = 'conversifi-2048-best';

type Grid = number[][];

const emptyGrid = (): Grid => Array.from({ length: SIZE }, () => Array(SIZE).fill(0));

const addTile = (grid: Grid): Grid => {
  const empty: [number, number][] = [];
  grid.forEach((row, y) => row.forEach((value, x) => value === 0 && empty.push([y, x])));
  if (empty.length === 0) return grid;
  const [y, x] = empty[Math.floor(Math.random() * empty.length)];
  const next = grid.map((row) => [...row]);
  next[y][x] = Math.random() < 0.9 ? 2 : 4;
  return next;
};

// Slides one row to the left and merges equal neighbours once; every move is this plus rotation.
const slideRow = (row: number[]): { row: number[]; gained: number } => {
  const tiles = row.filter((value) => value !== 0);
  const merged: number[] = [];
  let gained = 0;
  for (let index = 0; index < tiles.length; index += 1) {
    if (tiles[index] === tiles[index + 1]) {
      merged.push(tiles[index] * 2);
      gained += tiles[index] * 2;
      index += 1;
    } else merged.push(tiles[index]);
  }
  while (merged.length < SIZE) merged.push(0);
  return { row: merged, gained };
};

const rotate = (grid: Grid): Grid => grid[0].map((_, x) => grid.map((row) => row[x]).reverse());

const move = (grid: Grid, direction: 'left' | 'right' | 'up' | 'down'): { grid: Grid; gained: number; moved: boolean } => {
  const turns = { left: 0, down: 1, right: 2, up: 3 }[direction];
  let working = grid;
  for (let turn = 0; turn < turns; turn += 1) working = rotate(working);
  let gained = 0;
  working = working.map((row) => {
    const result = slideRow(row);
    gained += result.gained;
    return result.row;
  });
  for (let turn = 0; turn < (4 - turns) % 4; turn += 1) working = rotate(working);
  const moved = working.some((row, y) => row.some((value, x) => value !== grid[y][x]));
  return { grid: working, gained, moved };
};

const canMove = (grid: Grid) => (['left', 'right', 'up', 'down'] as const).some((direction) => move(grid, direction).moved);

const readBest = () => {
  try {
    return Number(localStorage.getItem(BEST_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
};

const writeBest = (value: number) => {
  try {
    localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Private windows and blocked storage just lose the best score.
  }
};

const TILE_COLOURS: Record<number, string> = {
  2: '#eee4da', 4: '#ede0c8', 8: '#f2b179', 16: '#f59563', 32: '#f67c5f', 64: '#f65e3b',
  128: '#edcf72', 256: '#edcc61', 512: '#edc850', 1024: '#edc53f', 2048: '#edc22e',
};

const newGame = () => addTile(addTile(emptyGrid()));

export const Game2048Page = () => {
  const [grid, setGrid] = useState<Grid>(newGame);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(readBest);
  const [won, setWon] = useState(false);
  const [keepGoing, setKeepGoing] = useState(false);

  const over = !canMove(grid);

  const reset = useCallback(() => {
    setGrid(newGame());
    setScore(0);
    setWon(false);
    setKeepGoing(false);
  }, []);

  const play = useCallback(
    (direction: 'left' | 'right' | 'up' | 'down') => {
      if (over || (won && !keepGoing)) return;
      const result = move(grid, direction);
      if (!result.moved) return;
      const next = addTile(result.grid);
      const total = score + result.gained;
      setGrid(next);
      setScore(total);
      if (total > best) {
        setBest(total);
        writeBest(total);
      }
      if (!won && next.some((row) => row.includes(2048))) setWon(true);
    },
    [grid, score, best, over, won, keepGoing],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const directions: Record<string, 'left' | 'right' | 'up' | 'down'> = {
        arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down',
      };
      if (directions[key]) {
        event.preventDefault();
        play(directions[key]);
      } else if (key === 'r') reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [play, reset]);

  const overlay = over ? 'Game over' : won && !keepGoing ? 'You made 2048' : null;

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
      <div style={{ display: 'flex', gap: 24, alignItems: 'baseline' }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>2048</h1>
        <span style={{ color: 'var(--t-font-color-tertiary)', fontSize: 14 }}>
          Score <b style={{ color: 'var(--t-font-color-primary)' }}>{score}</b>
        </span>
        <span style={{ color: 'var(--t-font-color-tertiary)', fontSize: 14 }}>
          Best <b style={{ color: 'var(--t-font-color-primary)' }}>{best}</b>
        </span>
      </div>

      <div style={{ position: 'relative', maxWidth: '100%' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${SIZE}, 84px)`,
            gap: 10,
            padding: 10,
            borderRadius: 10,
            background: 'var(--t-background-tertiary)',
            border: '1px solid var(--t-border-color-medium)',
          }}
        >
          {grid.flatMap((row, y) =>
            row.map((value, x) => (
              <div
                key={`${y}-${x}`}
                style={{
                  width: 84,
                  height: 84,
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: value >= 1024 ? 24 : value >= 128 ? 28 : 32,
                  background: value ? TILE_COLOURS[value] ?? '#3c3a32' : 'var(--t-background-secondary)',
                  color: value >= 8 ? '#f9f6f2' : '#776e65',
                  transition: 'background 120ms ease-out',
                }}
              >
                {value || ''}
              </div>
            )),
          )}
        </div>
        {overlay && (
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
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 600 }}>{overlay}</div>
            <div style={{ color: 'var(--t-font-color-tertiary)', fontSize: 14 }}>You scored {score}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {won && !over && (
                <button
                  onClick={() => setKeepGoing(true)}
                  style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid var(--t-border-color-medium)', background: 'var(--t-background-primary)', color: 'var(--t-font-color-primary)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
                >
                  Keep going
                </button>
              )}
              <button
                onClick={reset}
                style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#22a35a', color: '#ffffff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
              >
                Play again
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ color: 'var(--t-font-color-tertiary)', fontSize: 13 }}>
        Arrow keys or WASD to slide &middot; R to restart
      </div>
    </div>
  );
};
