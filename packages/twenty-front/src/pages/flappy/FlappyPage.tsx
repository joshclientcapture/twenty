import { useCallback, useEffect, useRef, useState } from 'react';

const WIDTH = 480;
const HEIGHT = 400;
const BIRD_X = 110;
const BIRD_RADIUS = 12;
const GRAVITY = 1400;
const FLAP_VELOCITY = -380;
const PIPE_WIDTH = 58;
const PIPE_GAP = 130;
const PIPE_SPACING = 210;
const SPEED = 150;
const BEST_KEY = 'conversifi-flappy-best';

type Pipe = { x: number; gapTop: number; passed: boolean };

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

const randomGapTop = () => 50 + Math.random() * (HEIGHT - PIPE_GAP - 100);

export const FlappyPage = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const birdYRef = useRef(HEIGHT / 2);
  const velocityRef = useRef(0);
  const pipesRef = useRef<Pipe[]>([]);
  const runningRef = useRef(false);
  const scoreRef = useRef(0);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(readBest);
  const [phase, setPhase] = useState<'ready' | 'playing' | 'dead'>('ready');

  const reset = useCallback(() => {
    birdYRef.current = HEIGHT / 2;
    velocityRef.current = 0;
    pipesRef.current = [
      { x: WIDTH + 60, gapTop: randomGapTop(), passed: false },
      { x: WIDTH + 60 + PIPE_SPACING, gapTop: randomGapTop(), passed: false },
      { x: WIDTH + 60 + PIPE_SPACING * 2, gapTop: randomGapTop(), passed: false },
    ];
    scoreRef.current = 0;
    runningRef.current = false;
    setScore(0);
    setPhase('ready');
  }, []);

  const flap = useCallback(() => {
    if (phase === 'dead') {
      reset();
      return;
    }
    if (phase === 'ready') {
      runningRef.current = true;
      setPhase('playing');
    }
    velocityRef.current = FLAP_VELOCITY;
  }, [phase, reset]);

  useEffect(() => {
    reset();
  }, [reset]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === ' ' || key === 'arrowup' || key === 'w') {
        event.preventDefault();
        flap();
      } else if (key === 'r') reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flap, reset]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const die = () => {
      runningRef.current = false;
      const final = scoreRef.current;
      setBest((current) => {
        const next = Math.max(current, final);
        if (next !== current) writeBest(next);
        return next;
      });
      setPhase('dead');
    };

    const step = (dt: number) => {
      velocityRef.current += GRAVITY * dt;
      birdYRef.current += velocityRef.current * dt;
      for (const pipe of pipesRef.current) {
        pipe.x -= SPEED * dt;
        if (!pipe.passed && pipe.x + PIPE_WIDTH < BIRD_X - BIRD_RADIUS) {
          pipe.passed = true;
          scoreRef.current += 1;
          setScore(scoreRef.current);
        }
      }
      if (pipesRef.current[0].x + PIPE_WIDTH < 0) {
        pipesRef.current.shift();
        const lastPipe = pipesRef.current[pipesRef.current.length - 1];
        pipesRef.current.push({ x: lastPipe.x + PIPE_SPACING, gapTop: randomGapTop(), passed: false });
      }
      const y = birdYRef.current;
      if (y + BIRD_RADIUS >= HEIGHT || y - BIRD_RADIUS <= 0) return die();
      for (const pipe of pipesRef.current) {
        const withinX = BIRD_X + BIRD_RADIUS > pipe.x && BIRD_X - BIRD_RADIUS < pipe.x + PIPE_WIDTH;
        const inGap = y - BIRD_RADIUS > pipe.gapTop && y + BIRD_RADIUS < pipe.gapTop + PIPE_GAP;
        if (withinX && !inGap) return die();
      }
    };

    const draw = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const styles = getComputedStyle(canvas);
      const sky = styles.getPropertyValue('--t-background-secondary').trim() || '#141414';
      const pipeColour = styles.getPropertyValue('--t-tag-text-green').trim() || '#22a35a';
      const bird = styles.getPropertyValue('--t-tag-text-orange').trim() || '#f59e0b';
      const ink = styles.getPropertyValue('--t-font-color-primary').trim() || '#ffffff';
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = pipeColour;
      for (const pipe of pipesRef.current) {
        ctx.fillRect(pipe.x, 0, PIPE_WIDTH, pipe.gapTop);
        ctx.fillRect(pipe.x, pipe.gapTop + PIPE_GAP, PIPE_WIDTH, HEIGHT - pipe.gapTop - PIPE_GAP);
      }
      ctx.fillStyle = bird;
      ctx.beginPath();
      ctx.arc(BIRD_X, birdYRef.current, BIRD_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(BIRD_X + 4, birdYRef.current - 4, 2.5, 0, Math.PI * 2);
      ctx.fill();
    };

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (runningRef.current) step(dt);
      draw();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

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
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Flappy</h1>
        <span style={{ color: 'var(--t-font-color-tertiary)', fontSize: 14 }}>
          Score <b style={{ color: 'var(--t-font-color-primary)' }}>{score}</b>
        </span>
        <span style={{ color: 'var(--t-font-color-tertiary)', fontSize: 14 }}>
          Best <b style={{ color: 'var(--t-font-color-primary)' }}>{best}</b>
        </span>
      </div>

      <div style={{ position: 'relative', maxWidth: '100%' }}>
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          onPointerDown={flap}
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
            <div style={{ fontSize: 18, fontWeight: 600 }}>{phase === 'dead' ? 'Game over' : 'Flappy'}</div>
            <div style={{ color: 'var(--t-font-color-tertiary)', fontSize: 14 }}>
              {phase === 'dead' ? `You scored ${score}` : 'Space, W or click to flap'}
            </div>
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
              {phase === 'dead' ? 'Press space to play again' : 'Press space to start'}
            </div>
          </div>
        )}
      </div>

      <div style={{ color: 'var(--t-font-color-tertiary)', fontSize: 13 }}>
        Space, W, up arrow or click to flap &middot; R to restart
      </div>
    </div>
  );
};
