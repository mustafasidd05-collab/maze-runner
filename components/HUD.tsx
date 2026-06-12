"use client";

import React, { useEffect, useRef, useState } from "react";
import { MazeCanvas } from "../components/MazeCanvas";
import { useGame } from "../hooks/useGame";
import { useGameStore } from "../stores/gameStore";

// =============================================================================
// DESIGN TOKENS
// =============================================================================
// Palette: near-void black, deep cobalt, electric azure, ghost white, amber gold
// Typography: system-ui for HUD data; letter-spaced caps for labels
// Signature: the "stage frame" — a luminous inner border that pulses on solve,
//            treating the maze as a framed artefact rather than a raw canvas.
// =============================================================================

// ── Inline style objects (no Tailwind for precision values) ──────────────────

const S = {
  // Root: true full-screen, no overflow ever
  root: {
    position: "fixed" as const,
    inset: 0,
    overflow: "hidden",
    background: "#04070f",
    fontFamily: "'system-ui', '-apple-system', sans-serif",
  },

  // Animated atmospheric background
  bgLayer: {
    position: "absolute" as const,
    inset: 0,
    zIndex: 0,
    pointerEvents: "none" as const,
  },

  // Depth layer: game stage sits here
  stageLayer: {
    position: "absolute" as const,
    inset: 0,
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "clamp(12px, 3vmin, 48px)",
  },

  // The framed maze board
  stageFrame: (solved: boolean) => ({
    position: "relative" as const,
    width: "100%",
    height: "100%",
    maxWidth: "min(90vw, 90vh, 900px)",
    maxHeight: "min(90vw, 90vh, 900px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "16px",
    boxShadow: solved
      ? "0 0 0 1px rgba(52,211,153,0.4), 0 0 60px rgba(52,211,153,0.15), 0 0 120px rgba(52,211,153,0.08)"
      : "0 0 0 1px rgba(255,255,255,0.06), 0 0 60px rgba(59,130,246,0.08), 0 32px 80px rgba(0,0,0,0.8)",
    transition: "box-shadow 0.8s ease",
    background: "rgba(8,12,24,0.6)",
  }),

  // Corner accent marks (pure CSS, no extra DOM weight)
  cornerTL: {
    position: "absolute" as const,
    top: 10, left: 10,
    width: 20, height: 20,
    borderTop: "2px solid rgba(96,165,250,0.5)",
    borderLeft: "2px solid rgba(96,165,250,0.5)",
    borderRadius: "2px 0 0 0",
    pointerEvents: "none" as const,
  },
  cornerTR: {
    position: "absolute" as const,
    top: 10, right: 10,
    width: 20, height: 20,
    borderTop: "2px solid rgba(96,165,250,0.5)",
    borderRight: "2px solid rgba(96,165,250,0.5)",
    borderRadius: "0 2px 0 0",
    pointerEvents: "none" as const,
  },
  cornerBL: {
    position: "absolute" as const,
    bottom: 10, left: 10,
    width: 20, height: 20,
    borderBottom: "2px solid rgba(96,165,250,0.5)",
    borderLeft: "2px solid rgba(96,165,250,0.5)",
    borderRadius: "0 0 0 2px",
    pointerEvents: "none" as const,
  },
  cornerBR: {
    position: "absolute" as const,
    bottom: 10, right: 10,
    width: 20, height: 20,
    borderBottom: "2px solid rgba(96,165,250,0.5)",
    borderRight: "2px solid rgba(96,165,250,0.5)",
    borderRadius: "0 0 2px 0",
    pointerEvents: "none" as const,
  },

  // HUD layer floats above everything
  hudLayer: {
    position: "absolute" as const,
    inset: 0,
    zIndex: 2,
    pointerEvents: "none" as const,
  },

  // Top-left HUD panel (stats)
  hudStats: {
    position: "absolute" as const,
    top: "clamp(12px, 2vw, 24px)",
    left: "clamp(12px, 2vw, 24px)",
    pointerEvents: "auto" as const,
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },

  // Top-right HUD panel (actions)
  hudActions: {
    position: "absolute" as const,
    top: "clamp(12px, 2vw, 24px)",
    right: "clamp(12px, 2vw, 24px)",
    pointerEvents: "auto" as const,
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    alignItems: "flex-end",
  },

  // Bottom-center: status ribbon
  hudBottom: {
    position: "absolute" as const,
    bottom: "clamp(12px, 2vw, 24px)",
    left: "50%",
    transform: "translateX(-50%)",
    pointerEvents: "auto" as const,
    display: "flex",
    gap: 10,
    alignItems: "center",
  },

  // Glassmorphism card used for stat chips and panels
  glassCard: {
    background: "rgba(10,16,36,0.72)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 10,
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    padding: "8px 14px",
    display: "flex",
    alignItems: "center",
    gap: 8,
    boxShadow: "0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
  },

  // Stat label
  statLabel: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    color: "rgba(148,163,184,0.7)",
    lineHeight: 1,
  },

  // Stat value
  statValue: {
    fontSize: 16,
    fontWeight: 700,
    color: "#f1f5f9",
    letterSpacing: "0.02em",
    lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
  },

  // Game title wordmark
  wordmark: {
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.22em",
    textTransform: "uppercase" as const,
    color: "rgba(148,163,184,0.5)",
    lineHeight: 1,
  },
};

// ── Button variants ─────────────────────────────────────────────────────────

type BtnVariant = "primary" | "ghost" | "danger" | "success";

function btnStyle(variant: BtnVariant, disabled = false): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    padding: "9px 18px",
    borderRadius: 9,
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    transition: "all 0.18s ease",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    opacity: disabled ? 0.42 : 1,
    pointerEvents: disabled ? "none" : "auto",
    whiteSpace: "nowrap",
  };

  switch (variant) {
    case "primary":
      return {
        ...base,
        background: "rgba(59,130,246,0.18)",
        border: "1px solid rgba(96,165,250,0.35)",
        color: "#93c5fd",
        boxShadow: "0 0 20px rgba(59,130,246,0.1), inset 0 1px 0 rgba(255,255,255,0.06)",
      };
    case "ghost":
      return {
        ...base,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.1)",
        color: "rgba(203,213,225,0.8)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      };
    case "danger":
      return {
        ...base,
        background: "rgba(239,68,68,0.12)",
        border: "1px solid rgba(248,113,113,0.3)",
        color: "#fca5a5",
        boxShadow: "0 0 16px rgba(239,68,68,0.08), inset 0 1px 0 rgba(255,255,255,0.04)",
      };
    case "success":
      return {
        ...base,
        background: "rgba(52,211,153,0.15)",
        border: "1px solid rgba(52,211,153,0.35)",
        color: "#6ee7b7",
        boxShadow: "0 0 20px rgba(52,211,153,0.1), inset 0 1px 0 rgba(255,255,255,0.06)",
      };
  }
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

// ── Animated SVG background ─────────────────────────────────────────────────
const AtmosphericBackground: React.FC<{ solved: boolean }> = ({ solved }) => (
  <div style={S.bgLayer}>
    {/* Deep space base */}
    <div style={{
      position: "absolute", inset: 0,
      background: solved
        ? "radial-gradient(ellipse 80% 60% at 50% 40%, rgba(16,62,40,0.35) 0%, rgba(4,7,15,1) 70%)"
        : "radial-gradient(ellipse 80% 60% at 50% 40%, rgba(15,25,60,0.5) 0%, rgba(4,7,15,1) 70%)",
      transition: "background 1.2s ease",
    }} />

    {/* Slow-drifting orb — the signature atmospheric risk */}
    <div style={{
      position: "absolute",
      width: "55vmax", height: "55vmax",
      borderRadius: "50%",
      background: solved
        ? "radial-gradient(circle, rgba(52,211,153,0.04) 0%, transparent 70%)"
        : "radial-gradient(circle, rgba(59,130,246,0.05) 0%, transparent 70%)",
      top: "50%", left: "50%",
      transform: "translate(-50%, -50%)",
      animation: "orbDrift 18s ease-in-out infinite",
      transition: "background 1.2s ease",
      pointerEvents: "none",
    }} />

    {/* Horizon scan line */}
    <div style={{
      position: "absolute",
      top: "50%", left: 0, right: 0,
      height: 1,
      background: "linear-gradient(90deg, transparent, rgba(96,165,250,0.06) 30%, rgba(96,165,250,0.06) 70%, transparent)",
      transform: "translateY(-50%)",
      pointerEvents: "none",
    }} />

    <style>{`
      @keyframes orbDrift {
        0%,100% { transform: translate(-50%,-50%) scale(1); }
        33%      { transform: translate(-48%,-52%) scale(1.04); }
        66%      { transform: translate(-52%,-48%) scale(0.97); }
      }
      @keyframes fadeSlideDown {
        from { opacity:0; transform:translateY(-6px); }
        to   { opacity:1; transform:translateY(0); }
      }
      @keyframes fadeSlideUp {
        from { opacity:0; transform:translateY(8px); }
        to   { opacity:1; transform:translateY(0); }
      }
      @keyframes solvedPulse {
        0%,100% { box-shadow: 0 0 0 1px rgba(52,211,153,0.4), 0 0 60px rgba(52,211,153,0.15); }
        50%     { box-shadow: 0 0 0 2px rgba(52,211,153,0.6), 0 0 80px rgba(52,211,153,0.28); }
      }
      @keyframes idlePing {
        0%   { transform:scale(1);   opacity:0.5; }
        80%  { transform:scale(1.5); opacity:0; }
        100% { transform:scale(1.5); opacity:0; }
      }
    `}</style>
  </div>
);

// ── Stat chip ────────────────────────────────────────────────────────────────
const StatChip: React.FC<{ label: string; value: React.ReactNode; accent?: string }> = ({
  label, value, accent = "#f1f5f9",
}) => (
  <div style={S.glassCard}>
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={S.statLabel}>{label}</span>
      <span style={{ ...S.statValue, color: accent }}>{value}</span>
    </div>
  </div>
);

// ── Timer display ────────────────────────────────────────────────────────────
const useElapsedTimer = (running: boolean) => {
  const [seconds, setSeconds] = useState(0);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      setSeconds(0);
      ref.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } else {
      if (ref.current) clearInterval(ref.current);
    }
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [running]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
};

// ── Solved overlay ───────────────────────────────────────────────────────────
const SolvedOverlay: React.FC<{ onReset: () => void; onNew: () => void }> = ({ onReset, onNew }) => (
  <div style={{
    position: "absolute", inset: 0, zIndex: 10,
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    borderRadius: 16,
    background: "rgba(4,7,15,0.82)",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    animation: "fadeSlideDown 0.5s ease both",
  }}>
    <div style={{
      fontSize: 11, fontWeight: 800, letterSpacing: "0.3em",
      color: "rgba(52,211,153,0.7)", textTransform: "uppercase", marginBottom: 12,
    }}>
      Level Complete
    </div>
    <div style={{
      fontSize: "clamp(28px, 5vw, 48px)", fontWeight: 900,
      color: "#f1f5f9", letterSpacing: "-0.02em", marginBottom: 6,
    }}>
      Solved
    </div>
    <div style={{
      fontSize: 13, color: "rgba(148,163,184,0.6)", marginBottom: 32,
    }}>
      The path has been revealed.
    </div>
    <div style={{ display: "flex", gap: 10 }}>
      <button style={btnStyle("ghost")} onClick={onReset}>↺ Retry</button>
      <button style={btnStyle("success")} onClick={onNew}>New Maze →</button>
    </div>
  </div>
);

// ── Idle overlay ─────────────────────────────────────────────────────────────
const IdleOverlay: React.FC<{ onGenerate: () => void; loading: boolean }> = ({
  onGenerate, loading,
}) => (
  <div style={{
    position: "absolute", inset: 0, zIndex: 10,
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    borderRadius: 16,
    background: "rgba(4,7,15,0.88)",
    backdropFilter: "blur(4px)",
    WebkitBackdropFilter: "blur(4px)",
    animation: "fadeSlideDown 0.4s ease both",
  }}>
    {/* Ping ring */}
    <div style={{ position: "relative", marginBottom: 32, width: 64, height: 64 }}>
      <div style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        border: "1px solid rgba(96,165,250,0.35)",
        animation: "idlePing 2.4s ease-out infinite",
      }} />
      <div style={{
        position: "absolute", inset: 8, borderRadius: "50%",
        background: "rgba(59,130,246,0.12)",
        border: "1px solid rgba(96,165,250,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 22,
      }}>
        ⬡
      </div>
    </div>

    <div style={{
      fontSize: 10, fontWeight: 800, letterSpacing: "0.3em",
      color: "rgba(96,165,250,0.5)", textTransform: "uppercase", marginBottom: 10,
    }}>
      Maze Runner
    </div>
    <div style={{
      fontSize: "clamp(22px, 4vw, 36px)", fontWeight: 900,
      color: "#f1f5f9", letterSpacing: "-0.02em", marginBottom: 8,
    }}>
      Enter the Labyrinth
    </div>
    <div style={{
      fontSize: 13, color: "rgba(148,163,184,0.5)", marginBottom: 36,
      maxWidth: 260, textAlign: "center", lineHeight: 1.6,
    }}>
      A procedurally generated maze awaits. Find your way to the center.
    </div>

    <button
      style={btnStyle("primary")}
      onClick={onGenerate}
      disabled={loading}
    >
      {loading ? (
        <>
          <span style={{ display: "inline-block", animation: "orbDrift 1s linear infinite", fontSize: 14 }}>◌</span>
          Generating…
        </>
      ) : (
        <>⬡ Generate Maze</>
      )}
    </button>
  </div>
);

// =============================================================================
// PAGE
// =============================================================================

export default function GamePage() {
  const { startGame, solveGame, resetGame, isLoading, isPlaying, isSolved, isError, error } = useGame();
  const moves = useGameStore((s) => s.moveCount ?? 0);
  const seed  = useGameStore((s) => s.seed  ?? null);
  const size  = useGameStore((s) => s.size  ?? 21);

  const timer = useElapsedTimer(isPlaying);

  const handleGenerate = () => {
    const randomSeed = Math.floor(Math.random() * 99999);
    startGame(randomSeed, 21);
  };

  const handleReset = () => { resetGame(); };

  const showIdle   = !isPlaying && !isSolved && !isLoading;
  const showSolved = isSolved;
  const showHUD    = isPlaying || isSolved;

  return (
    <div style={S.root}>

      {/* ── Layer 0: Atmosphere ───────────────────────────────────────── */}
      <AtmosphericBackground solved={isSolved} />

      {/* ── Layer 1: Game Stage ───────────────────────────────────────── */}
      <div style={S.stageLayer}>
        <div style={S.stageFrame(isSolved)}>

          {/* Corner accents */}
          <div style={S.cornerTL} />
          <div style={S.cornerTR} />
          <div style={S.cornerBL} />
          <div style={S.cornerBR} />

          {/* The maze canvas — always mounted to prevent layout shift */}
          <div style={{
            width: "100%", height: "100%",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 24,
          }}>
            <MazeCanvas />
          </div>

          {/* Idle overlay */}
          {showIdle && (
            <IdleOverlay onGenerate={handleGenerate} loading={isLoading} />
          )}

          {/* Solved overlay */}
          {showSolved && (
            <SolvedOverlay onReset={handleReset} onNew={handleGenerate} />
          )}

          {/* Loading shimmer overlay */}
          {isLoading && (
            <div style={{
              position: "absolute", inset: 0, borderRadius: 16, zIndex: 8,
              background: "rgba(4,7,15,0.7)",
              display: "flex", alignItems: "center", justifyContent: "center",
              backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)",
            }}>
              <div style={{
                fontSize: 12, fontWeight: 700, letterSpacing: "0.2em",
                color: "rgba(96,165,250,0.7)", textTransform: "uppercase",
                animation: "fadeSlideDown 0.3s ease both",
              }}>
                Building maze…
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Layer 2: HUD ─────────────────────────────────────────────────── */}
      {showHUD && (
        <div style={S.hudLayer}>

          {/* Top-left: stats */}
          <div style={S.hudStats}>
            <div style={{ ...S.glassCard, paddingBottom: 6 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={S.wordmark}>Maze Runner</span>
              </div>
            </div>
            <StatChip label="Time" value={timer} accent="#93c5fd" />
            <StatChip label="Moves" value={moves} accent="#f1f5f9" />
            {seed !== null && (
              <StatChip label="Seed" value={`#${seed}`} accent="rgba(148,163,184,0.6)" />
            )}
            <StatChip label="Size" value={`${size}×${size}`} accent="rgba(148,163,184,0.5)" />
          </div>

          {/* Top-right: actions */}
          <div style={S.hudActions}>
            <button
              style={btnStyle("ghost")}
              onClick={handleReset}
            >
              ↺ Reset
            </button>
            {isPlaying && (
              <button
                style={btnStyle("primary")}
                onClick={solveGame}
              >
                ◈ Solve
              </button>
            )}
            <button
              style={btnStyle("ghost")}
              onClick={handleGenerate}
            >
              ⬡ New
            </button>
          </div>

          {/* Bottom-center: contextual hint */}
          <div style={S.hudBottom}>
            {isPlaying && (
              <div style={{
                ...S.glassCard,
                animation: "fadeSlideUp 0.4s ease both",
                fontSize: 11,
                color: "rgba(148,163,184,0.55)",
                letterSpacing: "0.06em",
              }}>
                <span style={{ color: "rgba(96,165,250,0.5)", fontSize: 14 }}>◈</span>
                Use arrow keys or WASD to navigate
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Error toast ──────────────────────────────────────────────────── */}
      {isError && error && (
        <div style={{
          position: "absolute", bottom: 24, left: "50%",
          transform: "translateX(-50%)",
          zIndex: 20,
          ...S.glassCard,
          border: "1px solid rgba(248,113,113,0.3)",
          background: "rgba(30,8,8,0.85)",
          color: "#fca5a5",
          fontSize: 12,
          letterSpacing: "0.04em",
          animation: "fadeSlideUp 0.3s ease both",
          maxWidth: "min(90vw, 380px)",
        }}>
          <span style={{ color: "#f87171", fontSize: 15 }}>⚠</span>
          {error}
        </div>
      )}

    </div>
  );
}