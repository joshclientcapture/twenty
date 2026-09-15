import { useCallback, useEffect, useRef, useState } from "react";

const CELL = 20;
const COLS = 28;
const ROWS = 20;
const TICK_MS = 90;

type Point = { x: number; y: number };

const randomFood = (snake: Point[]): Point => {
  let p: Point;
  do {
    p = {
      x: Math.floor(Math.random() * COLS),
      y: Math.floor(Math.random() * ROWS),
    };
  } while (snake.some((s) => s.x === p.x && s.y === p.y));
  return p;
};

export const SnakePage = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const snakeRef = useRef<Point[]>([{ x: 8, y: 10 }]);
  const dirRef = useRef<Point>({ x: 1, y: 0 });
  const queuedDirRef = useRef<Point>({ x: 1, y: 0 });
  const foodRef = useRef<Point>({ x: 16, y: 10 });
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [dead, setDead] = useState(false);
  const [paused, setPaused] = useState(false);

  const reset = useCallback(() => {
    snakeRef.current = [{ x: 8, y: 10 }];
    dirRef.current = { x: 1, y: 0 };
    queuedDirRef.current = { x: 1, y: 0 };
    foodRef.current = randomFood(snakeRef.current);
    setScore(0);
    setDead(false);
    setPaused(false);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const d = dirRef.current;
      if ((k === "arrowup" || k === "w") && d.y !== 1) queuedDirRef.current = { x: 0, y: -1 };
      else if ((k === "arrowdown" || k === "s") && d.y !== -1) queuedDirRef.current = { x: 0, y: 1 };
      else if ((k === "arrowleft" || k === "a") && d.x !== 1) queuedDirRef.current = { x: -1, y: 0 };
      else if ((k === "arrowright" || k === "d") && d.x !== -1) queuedDirRef.current = { x: 1, y: 0 };
      else if (k === " ") setPaused((p) => !p);
      else if (k === "r") reset();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reset]);

  useEffect(() => {
    if (dead || paused) return;
    const id = setInterval(() => {
      dirRef.current = queuedDirRef.current;
      const snake = snakeRef.current;
      const head = { x: snake[0].x + dirRef.current.x, y: snake[0].y + dirRef.current.y };
      if (
        head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS ||
        snake.some((s) => s.x === head.x && s.y === head.y)
      ) {
        setDead(true);
        setBest((b) => Math.max(b, snake.length - 1));
        return;
      }
      const next = [head, ...snake];
      if (head.x === foodRef.current.x && head.y === foodRef.current.y) {
        foodRef.current = randomFood(next);
        setScore((s) => s + 1);
      } else {
        next.pop();
      }
      snakeRef.current = next;
    }, TICK_MS);
    return () => clearInterval(id);
  }, [dead, paused]);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const c = canvasRef.current;
      const ctx = c?.getContext("2d");
      if (c && ctx) {
        const cs = getComputedStyle(c);
        const boardBg = cs.getPropertyValue("--t-background-secondary").trim() || "#141414";
        const grid = cs.getPropertyValue("--t-border-color-light").trim() || "rgba(128,128,128,0.15)";
        ctx.fillStyle = boardBg;
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.strokeStyle = grid;
        ctx.lineWidth = 1;
        for (let x = 0; x <= COLS; x++) {
          ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, ROWS * CELL); ctx.stroke();
        }
        for (let y = 0; y <= ROWS; y++) {
          ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(COLS * CELL, y * CELL); ctx.stroke();
        }
        const f = foodRef.current;
        ctx.fillStyle = "#ff6b4a";
        ctx.beginPath();
        ctx.arc(f.x * CELL + CELL / 2, f.y * CELL + CELL / 2, CELL / 2 - 3, 0, Math.PI * 2);
        ctx.fill();
        snakeRef.current.forEach((s, i) => {
          ctx.fillStyle = i === 0 ? "#4ade80" : "#22a35a";
          ctx.fillRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2);
        });
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        flex: 1,
        width: "100%",
        height: "100%",
        minHeight: 0,
        gap: 16,
        padding: 24,
        boxSizing: "border-box",
        color: "var(--t-font-color-primary)",
        background: "var(--t-background-primary)",
      }}
    >
      <div style={{ display: "flex", gap: 24, alignItems: "baseline" }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Snake</h1>
        <span style={{ color: "var(--t-font-color-tertiary)", fontSize: 14 }}>
          Score <b style={{ color: "var(--t-font-color-primary)" }}>{score}</b>
        </span>
        <span style={{ color: "var(--t-font-color-tertiary)", fontSize: 14 }}>
          Best <b style={{ color: "var(--t-font-color-primary)" }}>{best}</b>
        </span>
      </div>

      <div style={{ position: "relative", maxWidth: "100%" }}>
        <canvas
          ref={canvasRef}
          width={COLS * CELL}
          height={ROWS * CELL}
          style={{
            display: "block",
            maxWidth: "100%",
            borderRadius: 10,
            border: "1px solid var(--t-border-color-medium)",
          }}
        />
        {(dead || paused) && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              borderRadius: 10,
              background: "color-mix(in srgb, var(--t-background-primary) 85%, transparent)",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 600 }}>{dead ? "Game over" : "Paused"}</div>
            {dead && (
              <div style={{ color: "var(--t-font-color-tertiary)", fontSize: 14 }}>You scored {score}</div>
            )}
            <button
              onClick={reset}
              style={{
                padding: "8px 18px",
                borderRadius: 8,
                border: "none",
                background: "#22a35a",
                color: "#ffffff",
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              {dead ? "Play again" : "Resume"}
            </button>
          </div>
        )}
      </div>

      <div style={{ color: "var(--t-font-color-tertiary)", fontSize: 13 }}>
        Arrow keys or WASD to move &middot; Space to pause &middot; R to restart
      </div>
    </div>
  );
};
