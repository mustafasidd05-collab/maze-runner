"use client";

import React, { useEffect, useRef, useCallback } from "react";
import { useGameStore } from "../stores/gameStore";

// =============================================================================
// TYPES
// =============================================================================

interface MazeCanvasProps {
  /** Optional fixed cell size. When omitted the maze auto-fits the viewport. */
  cellSize?: number;
}

interface Vec2 { row: number; col: number; }

interface TrailPoint {
  row: number;
  col: number;
  age: number;   // seconds since deposited
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number;   // 0-1 remaining life fraction
  size: number;
}

// =============================================================================
// DESIGN TOKENS
// =============================================================================

// Wall palette – cool slate with a metallic top-edge shimmer
const WALL_DARK   = "#0b0f1c";
const WALL_MID    = "#141b2e";
const WALL_LIGHT  = "#1c2540";

// Floor palette – deep navy, barely lighter than walls for contrast
const FLOOR_DARK  = "#090d1a";
const FLOOR_MID   = "#0d1326";

// Accent colours
const PLAYER_CORE = "#60a5fa";   // sky blue
const PLAYER_RIM  = "#93c5fd";
const PLAYER_GLOW = "#3b82f6";

const GOAL_CORE   = "#34d399";   // emerald
const GOAL_RIM    = "#6ee7b7";
const GOAL_GLOW   = "#10b981";

const TRAIL_COLOR = "#3b82f6";

const PATHFX_CORE = "#f59e0b";   // amber
const PATHFX_GLOW = "#fbbf24";

const VIGNETTE    = "rgba(0,0,0,0.78)";
const GRID_LINE   = "rgba(255,255,255,0.018)";

// Timing constants
const LERP_SPEED       = 14;     // higher = snappier player slide
const TRAIL_LIFETIME   = 0.55;   // seconds a trail dot lives
const PATH_REVEAL_TIME = 0.85;   // seconds for full path draw-on
const PULSE_RATE       = 2.4;    // rad/s for entity pulse clocks

// =============================================================================
// MATH HELPERS
// =============================================================================

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

// =============================================================================
// OFFSCREEN WALL TILE CACHE
// Pre-renders one wall tile at a given cell-size so the main loop never
// recomputes gradients per-cell per-frame — huge perf win for large mazes.
// =============================================================================

let wallCache: { cs: number; bitmap: ImageBitmap | null } = { cs: -1, bitmap: null };

async function buildWallTile(cs: number): Promise<ImageBitmap> {
  const oc = new OffscreenCanvas(cs, cs);
  const g  = oc.getContext("2d")!;

  // Base gradient: dark bottom-left → lighter top-right (light from NW)
  const base = g.createLinearGradient(0, cs, cs, 0);
  base.addColorStop(0,    WALL_DARK);
  base.addColorStop(0.45, WALL_MID);
  base.addColorStop(1,    WALL_LIGHT);
  g.fillStyle = base;
  g.fillRect(0, 0, cs, cs);

  // Inner bevel highlight (top & left edges, 1px)
  g.fillStyle = "rgba(255,255,255,0.07)";
  g.fillRect(0, 0, cs, 1);
  g.fillRect(0, 0, 1, cs);

  // Inner bevel shadow (bottom & right edges, 1px)
  g.fillStyle = "rgba(0,0,0,0.45)";
  g.fillRect(0, cs - 1, cs, 1);
  g.fillRect(cs - 1, 0, 1, cs);

  // Very faint corner rivet suggestion (metallic detail)
  const ri = Math.max(1, Math.round(cs * 0.12));
  [[ri, ri], [cs - ri, ri], [ri, cs - ri], [cs - ri, cs - ri]].forEach(([rx, ry]) => {
    g.fillStyle = "rgba(255,255,255,0.05)";
    g.beginPath();
    g.arc(rx, ry, Math.max(1, cs * 0.06), 0, Math.PI * 2);
    g.fill();
  });

  return createImageBitmap(oc);
}

// Pre-render floor tile with a subtle radial soft centre
let floorCache: { cs: number; bitmap: ImageBitmap | null } = { cs: -1, bitmap: null };

async function buildFloorTile(cs: number): Promise<ImageBitmap> {
  const oc = new OffscreenCanvas(cs, cs);
  const g  = oc.getContext("2d")!;

  const base = g.createLinearGradient(0, 0, cs, cs);
  base.addColorStop(0, FLOOR_MID);
  base.addColorStop(1, FLOOR_DARK);
  g.fillStyle = base;
  g.fillRect(0, 0, cs, cs);

  // Soft centre bloom (path feels lit from above)
  const bloom = g.createRadialGradient(cs / 2, cs / 2, 0, cs / 2, cs / 2, cs * 0.7);
  bloom.addColorStop(0, "rgba(80,120,255,0.055)");
  bloom.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = bloom;
  g.fillRect(0, 0, cs, cs);

  return createImageBitmap(oc);
}

// =============================================================================
// COMPONENT
// =============================================================================

export const MazeCanvas: React.FC<MazeCanvasProps> = ({ cellSize }) => {
  const canvasRef    = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef       = useRef<number>(0);

  // ── Zustand slices (read-only) ────────────────────────────────────────────
  const maze   = useGameStore((s) => s.maze);
  const player = useGameStore((s) => s.player);
  const center = useGameStore((s) => s.center);
  const path   = useGameStore((s) => s.path);

  // ── Animated player position (lerped) ────────────────────────────────────
  const animPos   = useRef<Vec2>({ row: player?.[0] ?? 0, col: player?.[1] ?? 0 });
  const targetPos = useRef<Vec2>({ row: player?.[0] ?? 0, col: player?.[1] ?? 0 });

  // ── Motion trail ring buffer ──────────────────────────────────────────────
  const trail = useRef<TrailPoint[]>([]);
  const lastTrailDeposit = useRef<Vec2>({ row: -999, col: -999 });

  // ── Goal particles ────────────────────────────────────────────────────────
  const particles = useRef<Particle[]>([]);
  const particleSpawnClock = useRef(0);

  // ── Clock refs ────────────────────────────────────────────────────────────
  const pulseRef    = useRef(0);
  const pathReveal  = useRef(0);

  // ── Refs that shadow Zustand (avoid stale closures in RAF) ────────────────
  const pathRef   = useRef(path);
  const playerRef = useRef(player);
  useEffect(() => { pathRef.current = path;   pathReveal.current = 0; }, [path]);
  useEffect(() => { playerRef.current = player; }, [player]);

  // Update lerp target on player change
  useEffect(() => {
    if (!player) return;
    targetPos.current = { row: player[0], col: player[1] };
  }, [player]);

  // ── Tile cache invalidation on cell-size change ───────────────────────────
  const tileReady = useRef(false);

  // ── Compute auto cell size ────────────────────────────────────────────────
  const computeCellSize = useCallback((): number => {
    if (cellSize) return cellSize;
    if (!containerRef.current || maze.length === 0) return 16;
    const { clientWidth: w, clientHeight: h } = containerRef.current;
    const rows = maze.length;
    const cols = maze[0].length;
    return Math.max(4, Math.min(Math.floor(w / cols), Math.floor(h / rows), 32));
  }, [cellSize, maze]);

  // =============================================================================
  // MAIN RENDER LOOP
  // =============================================================================

  useEffect(() => {
    if (maze.length === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let lastTime = performance.now();
    tileReady.current = false;

    // ── Async: rebuild tile bitmaps whenever maze loads ──────────────────────
    const initTiles = async (cs: number) => {
      wallCache.bitmap  = await buildWallTile(cs);
      wallCache.cs      = cs;
      floorCache.bitmap = await buildFloorTile(cs);
      floorCache.cs     = cs;
      tileReady.current = true;
    };

    const cs0 = computeCellSize();
    initTiles(cs0);

    // ── RAF draw function ─────────────────────────────────────────────────────
    const draw = (now: number) => {
      const dt = clamp((now - lastTime) / 1000, 0, 0.05);
      lastTime = now;

      const cs   = computeCellSize();
      const rows = maze.length;
      const cols = maze[0].length;

      // Rebuild tiles if cell size changed
      if (cs !== wallCache.cs) { initTiles(cs); }

      // Resize canvas
      const W = cols * cs;
      const H = rows * cs;
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width  = W;
        canvas.height = H;
      }

      // ── Clock ticks ─────────────────────────────────────────────────────────
      pulseRef.current       += dt * PULSE_RATE;
      particleSpawnClock.current += dt;

      const curPath = pathRef.current;
      if (curPath && curPath.length > 0) {
        pathReveal.current = Math.min(
          pathReveal.current + dt * (curPath.length / PATH_REVEAL_TIME),
          curPath.length,
        );
      }

      // ── Lerp player ─────────────────────────────────────────────────────────
      const lerpT = clamp(dt * LERP_SPEED, 0, 1);
      animPos.current.row = lerp(animPos.current.row, targetPos.current.row, lerpT);
      animPos.current.col = lerp(animPos.current.col, targetPos.current.col, lerpT);

      // ── Deposit trail dot when animPos crosses into a new cell ───────────────
      const nearRow = Math.round(animPos.current.row);
      const nearCol = Math.round(animPos.current.col);
      if (nearRow !== lastTrailDeposit.current.row || nearCol !== lastTrailDeposit.current.col) {
        trail.current.push({ row: animPos.current.row, col: animPos.current.col, age: 0 });
        lastTrailDeposit.current = { row: nearRow, col: nearCol };
        if (trail.current.length > 20) trail.current.shift();
      }

      // Age and prune trail
      trail.current = trail.current
        .map(t => ({ ...t, age: t.age + dt }))
        .filter(t => t.age < TRAIL_LIFETIME);

      // ── Spawn goal particles ─────────────────────────────────────────────────
      if (center && particleSpawnClock.current > 0.18) {
        particleSpawnClock.current = 0;
        const [gr, gc] = center;
        const gx = gc * cs + cs / 2;
        const gy = gr * cs + cs / 2;
        const angle = Math.random() * Math.PI * 2;
        const speed = (0.3 + Math.random() * 0.5) * cs;
        particles.current.push({
          x: gx, y: gy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          size: (0.06 + Math.random() * 0.06) * cs,
        });
      }

      // Integrate + prune particles
      particles.current = particles.current
        .map(p => ({
          ...p,
          x: p.x + p.vx * dt,
          y: p.y + p.vy * dt,
          vx: p.vx * 0.88,
          vy: p.vy * 0.88,
          life: p.life - dt * 1.4,
        }))
        .filter(p => p.life > 0);

      // ── Clear ────────────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, W, H);

      // ═════════════════════════════════════════════════════════════════════════
      // LAYER 1 – Canvas-wide background gradient
      // ═════════════════════════════════════════════════════════════════════════
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0,   "#070b17");
      bg.addColorStop(0.5, "#0a0f1f");
      bg.addColorStop(1,   "#060a14");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // ═════════════════════════════════════════════════════════════════════════
      // LAYER 2 – Maze tiles (pre-rendered bitmaps if ready, fallback gradients)
      // ═════════════════════════════════════════════════════════════════════════
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * cs;
          const y = r * cs;

          if (maze[r][c] === 1) {
            if (tileReady.current && wallCache.bitmap) {
              ctx.drawImage(wallCache.bitmap, x, y, cs, cs);
            } else {
              // Fallback while bitmap builds
              ctx.fillStyle = WALL_MID;
              ctx.fillRect(x, y, cs, cs);
            }
          } else {
            if (tileReady.current && floorCache.bitmap) {
              ctx.drawImage(floorCache.bitmap, x, y, cs, cs);
            } else {
              ctx.fillStyle = FLOOR_DARK;
              ctx.fillRect(x, y, cs, cs);
            }
          }
        }
      }

      // ═════════════════════════════════════════════════════════════════════════
      // LAYER 3 – Subtle grid lines
      // ═════════════════════════════════════════════════════════════════════════
      ctx.strokeStyle = GRID_LINE;
      ctx.lineWidth   = 0.5;
      ctx.beginPath();
      for (let r = 0; r <= rows; r++) { ctx.moveTo(0, r * cs); ctx.lineTo(W, r * cs); }
      for (let c = 0; c <= cols; c++) { ctx.moveTo(c * cs, 0); ctx.lineTo(c * cs, H); }
      ctx.stroke();

      // ═════════════════════════════════════════════════════════════════════════
      // LAYER 4 – Solution path (sequential reveal + breathing glow)
      // ═════════════════════════════════════════════════════════════════════════
      if (curPath && curPath.length > 1) {
        const visibleCount = Math.floor(pathReveal.current);
        const partial      = pathReveal.current - visibleCount;   // 0-1 sub-cell
        const visible      = curPath.slice(0, visibleCount + 1);

        if (visible.length > 1) {
          // Interpolate the leading edge for smooth draw-on
          const [pr0, pc0] = visible[visible.length - 2];
          const [pr1, pc1] = visible[visible.length - 1];
          const leadX = lerp(pc0 * cs + cs / 2, pc1 * cs + cs / 2, easeOutCubic(partial));
          const leadY = lerp(pr0 * cs + cs / 2, pr1 * cs + cs / 2, easeOutCubic(partial));

          // ── Outer wide glow ─────────────────────────────────────────────────
          ctx.save();
          ctx.shadowColor = PATHFX_GLOW;
          ctx.shadowBlur  = cs * 1.8;
          ctx.strokeStyle = PATHFX_GLOW;
          ctx.lineWidth   = cs * 0.28;
          ctx.lineCap     = "round";
          ctx.lineJoin    = "round";
          ctx.globalAlpha = 0.28;
          ctx.beginPath();
          visible.forEach(([vr, vc], i) => {
            const px = vc * cs + cs / 2;
            const py = vr * cs + cs / 2;
            if (i === 0) ctx.moveTo(px, py);
            else if (i < visible.length - 1) ctx.lineTo(px, py);
            else ctx.lineTo(leadX, leadY);
          });
          ctx.stroke();
          ctx.restore();

          // ── Core amber line ─────────────────────────────────────────────────
          ctx.save();
          ctx.shadowColor = PATHFX_GLOW;
          ctx.shadowBlur  = cs * 0.7;
          ctx.strokeStyle = PATHFX_CORE;
          ctx.lineWidth   = cs * 0.2;
          ctx.lineCap     = "round";
          ctx.lineJoin    = "round";
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          visible.forEach(([vr, vc], i) => {
            const px = vc * cs + cs / 2;
            const py = vr * cs + cs / 2;
            if (i === 0) ctx.moveTo(px, py);
            else if (i < visible.length - 1) ctx.lineTo(px, py);
            else ctx.lineTo(leadX, leadY);
          });
          ctx.stroke();
          ctx.restore();

          // ── Reveal frontier spark ───────────────────────────────────────────
          ctx.save();
          ctx.shadowColor = "#fff";
          ctx.shadowBlur  = cs * 1.2;
          ctx.fillStyle   = "#fffde7";
          ctx.globalAlpha = 0.92;
          ctx.beginPath();
          ctx.arc(leadX, leadY, cs * 0.16, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          // ── Step dots along revealed path (breadcrumbs) ─────────────────────
          ctx.save();
          ctx.fillStyle   = PATHFX_CORE;
          ctx.globalAlpha = 0.35;
          visible.slice(0, -1).forEach(([vr, vc]) => {
            ctx.beginPath();
            ctx.arc(vc * cs + cs / 2, vr * cs + cs / 2, cs * 0.08, 0, Math.PI * 2);
            ctx.fill();
          });
          ctx.restore();
        }
      }

      // ═════════════════════════════════════════════════════════════════════════
      // LAYER 5 – Player motion trail
      // ═════════════════════════════════════════════════════════════════════════
      trail.current.forEach((tp) => {
        const alpha = (1 - tp.age / TRAIL_LIFETIME);
        const radius = cs * 0.18 * alpha;
        const tx = tp.col * cs + cs / 2;
        const ty = tp.row * cs + cs / 2;

        ctx.save();
        ctx.globalAlpha = alpha * 0.55;
        ctx.shadowColor = TRAIL_COLOR;
        ctx.shadowBlur  = cs * 0.6;
        ctx.fillStyle   = TRAIL_COLOR;
        ctx.beginPath();
        ctx.arc(tx, ty, Math.max(0.5, radius), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      // ═════════════════════════════════════════════════════════════════════════
      // LAYER 6 – Goal (center) – halo rings + particle field + core gem
      // ═════════════════════════════════════════════════════════════════════════
      if (center) {
        const [gr, gc] = center;
        const gx = gc * cs + cs / 2;
        const gy = gr * cs + cs / 2;
        const p  = 0.5 + 0.5 * Math.sin(pulseRef.current * 1.1);   // 0-1

        // Ambient spread
        ctx.save();
        ctx.globalAlpha = 0.14 + 0.1 * p;
        const spread = ctx.createRadialGradient(gx, gy, 0, gx, gy, cs * 2);
        spread.addColorStop(0, GOAL_GLOW);
        spread.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = spread;
        ctx.beginPath();
        ctx.arc(gx, gy, cs * 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Rotating outer ring
        ctx.save();
        ctx.globalAlpha = 0.22 + 0.12 * p;
        ctx.strokeStyle = GOAL_GLOW;
        ctx.lineWidth   = Math.max(1, cs * 0.05);
        ctx.shadowColor = GOAL_GLOW;
        ctx.shadowBlur  = cs * 0.8;
        ctx.beginPath();
        ctx.arc(gx, gy, cs * (0.45 + 0.06 * p), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // Particles
        particles.current.forEach(pp => {
          ctx.save();
          ctx.globalAlpha = pp.life * 0.7;
          ctx.fillStyle   = GOAL_RIM;
          ctx.shadowColor = GOAL_GLOW;
          ctx.shadowBlur  = pp.size * 3;
          ctx.beginPath();
          ctx.arc(pp.x, pp.y, pp.size * pp.life, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        });

        // Core gem — radial gradient sphere illusion
        ctx.save();
        ctx.shadowColor = GOAL_GLOW;
        ctx.shadowBlur  = cs * (1.0 + 0.5 * p);
        const gem = ctx.createRadialGradient(
          gx - cs * 0.08, gy - cs * 0.08, 0,
          gx, gy, cs * (0.28 + 0.05 * p),
        );
        gem.addColorStop(0, GOAL_RIM);
        gem.addColorStop(0.6, GOAL_CORE);
        gem.addColorStop(1, GOAL_GLOW);
        ctx.fillStyle   = gem;
        ctx.globalAlpha = 0.95 + 0.05 * p;
        ctx.beginPath();
        ctx.arc(gx, gy, cs * (0.28 + 0.05 * p), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Specular flare
        ctx.save();
        ctx.globalAlpha = 0.5 + 0.25 * p;
        ctx.fillStyle   = "#ffffff";
        ctx.beginPath();
        ctx.arc(gx - cs * 0.09, gy - cs * 0.09, cs * 0.07, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // ═════════════════════════════════════════════════════════════════════════
      // LAYER 7 – Player – body + shield ring + specular + aura
      // ═════════════════════════════════════════════════════════════════════════
      {
        const { row: ar, col: ac } = animPos.current;
        const px = ac * cs + cs / 2;
        const py = ar * cs + cs / 2;
        const p  = 0.5 + 0.5 * Math.sin(pulseRef.current);

        // Far aura bloom
        ctx.save();
        ctx.globalAlpha = 0.1 + 0.06 * p;
        const aura = ctx.createRadialGradient(px, py, 0, px, py, cs * 1.5);
        aura.addColorStop(0, PLAYER_GLOW);
        aura.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(px, py, cs * 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Ground shadow (offset downward slightly)
        ctx.save();
        ctx.globalAlpha = 0.35;
        const shadow = ctx.createRadialGradient(px, py + cs * 0.18, 0, px, py + cs * 0.18, cs * 0.42);
        shadow.addColorStop(0, "rgba(0,0,0,0.7)");
        shadow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = shadow;
        ctx.beginPath();
        ctx.arc(px, py + cs * 0.18, cs * 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Outer shield ring (rotates via pulse clock)
        ctx.save();
        ctx.globalAlpha = 0.32 + 0.18 * p;
        ctx.strokeStyle = PLAYER_RIM;
        ctx.lineWidth   = Math.max(1, cs * 0.05);
        ctx.shadowColor = PLAYER_GLOW;
        ctx.shadowBlur  = cs * 0.7;
        ctx.setLineDash([cs * 0.18, cs * 0.12]);
        ctx.lineDashOffset = -pulseRef.current * cs * 0.3;  // animated dash scroll
        ctx.beginPath();
        ctx.arc(px, py, cs * (0.42 + 0.04 * p), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // Core body sphere
        ctx.save();
        ctx.shadowColor = PLAYER_GLOW;
        ctx.shadowBlur  = cs * (1.0 + 0.4 * p);
        const body = ctx.createRadialGradient(
          px - cs * 0.1, py - cs * 0.1, 0,
          px, py, cs * (0.3 + 0.04 * p),
        );
        body.addColorStop(0,   PLAYER_RIM);
        body.addColorStop(0.5, PLAYER_CORE);
        body.addColorStop(1,   PLAYER_GLOW);
        ctx.fillStyle   = body;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(px, py, cs * (0.3 + 0.04 * p), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Specular highlight (small white cap top-left)
        ctx.save();
        ctx.globalAlpha = 0.65 + 0.2 * p;
        ctx.fillStyle   = "rgba(255,255,255,0.9)";
        ctx.beginPath();
        ctx.arc(px - cs * 0.09, py - cs * 0.09, cs * 0.09, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // ═════════════════════════════════════════════════════════════════════════
      // LAYER 8 – Vignette (edges fade to black, keeping eye on center)
      // ═════════════════════════════════════════════════════════════════════════
      {
        const vg = ctx.createRadialGradient(
          W / 2, H / 2, Math.min(W, H) * 0.28,
          W / 2, H / 2, Math.max(W, H) * 0.78,
        );
        vg.addColorStop(0, "rgba(0,0,0,0)");
        vg.addColorStop(1, VIGNETTE);
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, W, H);
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [maze, computeCellSize]);

  // =============================================================================
  // EMPTY STATE
  // =============================================================================

  if (maze.length === 0) {
    return (
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          height: "100%", minHeight: 200,
          background: "linear-gradient(135deg, #07091a, #0d1226)",
          borderRadius: 12,
          border: "1px dashed rgba(96,165,250,0.2)",
          color: "rgba(148,163,184,0.5)",
          fontSize: 13, fontWeight: 600, letterSpacing: "0.06em",
        }}
      >
        <span style={{ textShadow: "0 0 16px rgba(96,165,250,0.4)" }}>
          No Active Maze — Click Generate
        </span>
      </div>
    );
  }

  // =============================================================================
  // RENDER
  // =============================================================================

  return (
    <div
      ref={containerRef}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: "100%", height: "100%",
        background: "transparent",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          maxWidth:     "100%",
          maxHeight:    "100%",
          borderRadius: "10px",
          border:       "1px solid rgba(255,255,255,0.05)",
          boxShadow:    [
            "0 0 0 1px rgba(59,130,246,0.08)",
            "0 0 40px rgba(59,130,246,0.12)",
            "0 0 100px rgba(0,0,0,0.7)",
          ].join(", "),
        }}
      />
    </div>
  );
};