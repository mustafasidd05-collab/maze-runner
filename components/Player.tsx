"use client";

import React, { useEffect, useRef, useState } from "react";
import { useGameStore } from "../stores/gameStore";

// =============================================================================
// TYPES
// =============================================================================

interface PlayerProps {
  /**
   * The pixel length of a single cell.
   * Must exactly match the size used by the maze structural grid layout.
   */
  cellSize?: number;
}

// =============================================================================
// KEYFRAME STYLES
// Injected once into <head> — avoids a CSS file dependency while keeping
// animation definitions clean and performant (GPU-composited transforms only).
// =============================================================================

const KEYFRAMES = `
  @keyframes player-breathe {
    0%, 100% { transform: scale(1);    opacity: 1;    }
    50%       { transform: scale(1.08); opacity: 0.92; }
  }

  @keyframes player-ring-spin {
    from { transform: rotate(0deg);   }
    to   { transform: rotate(360deg); }
  }

  @keyframes player-ring-spin-reverse {
    from { transform: rotate(0deg);    }
    to   { transform: rotate(-360deg); }
  }

  @keyframes player-aura-pulse {
    0%, 100% { transform: scale(1);    opacity: 0.18; }
    50%       { transform: scale(1.35); opacity: 0.08; }
  }

  @keyframes player-ping {
    0%   { transform: scale(1);    opacity: 0.55; }
    100% { transform: scale(2.1);  opacity: 0;    }
  }

  @keyframes player-ripple {
    0%   { transform: scale(0.85); opacity: 0.5; }
    100% { transform: scale(1.8);  opacity: 0;   }
  }
`;

// Inject keyframes exactly once
let keyframesInjected = false;
function ensureKeyframes() {
  if (keyframesInjected || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
  keyframesInjected = true;
}

// =============================================================================
// DESIGN TOKENS
// =============================================================================

// Core palette — cool blue-white, intentionally restrained
const TOKEN = {
  coreGradStart:  "#e0f2fe",   // near-white sky
  coreGradEnd:    "#60a5fa",   // sky-400
  rimColor:       "#93c5fd",   // sky-300
  glowColor:      "rgba(59,130,246,0.55)",    // blue-500 bloom
  glowColorWide:  "rgba(59,130,246,0.18)",    // wide soft halo
  ringColor:      "rgba(147,197,253,0.45)",   // sky-300 semi-transparent
  ringColorInner: "rgba(224,242,254,0.25)",   // sky-100 faint
  auraColor:      "rgba(59,130,246,0.14)",
  specular:       "rgba(255,255,255,0.85)",
  shadow:         "rgba(0,0,20,0.55)",
} as const;

// =============================================================================
// COMPONENT
// =============================================================================

export const Player: React.FC<PlayerProps> = ({ cellSize = 20 }) => {
  ensureKeyframes();

  // ── Zustand (read-only, no logic changes) ──────────────────────────────────
  const player = useGameStore((state) => state.player);
  const status = useGameStore((state) => state.status);

  // ── Track previous position for move-flash effect ─────────────────────────
  const prevPos   = useRef(player);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (
      player &&
      prevPos.current &&
      (player[0] !== prevPos.current[0] || player[1] !== prevPos.current[1])
    ) {
      // Brief ripple flash on every move
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 320);
      prevPos.current = player;
      return () => clearTimeout(t);
    }
    prevPos.current = player;
  }, [player]);

  // ── Guards ────────────────────────────────────────────────────────────────
  if (!player || status === "idle") return null;

  const [row, col] = player;

  // ── Geometry (identical contract to original) ─────────────────────────────
  const markerSize = cellSize * 0.8;
  const offset     = (cellSize - markerSize) / 2;
  const pixelLeft  = col * cellSize + offset;
  const pixelTop   = row * cellSize + offset;

  // Derived sizes for child layers (all relative to markerSize)
  const S = markerSize;
  const R = S / 2;          // radius of marker square → used for border-radius

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left:   pixelLeft,
        top:    pixelTop,
        width:  S,
        height: S,
        // CSS transition drives smooth glide between grid positions.
        // duration matches original (100ms) so collision logic feel is unchanged.
        transition: "left 110ms cubic-bezier(0.25,0.8,0.25,1), top 110ms cubic-bezier(0.25,0.8,0.25,1)",
        // Establish stacking context so inner z-indices are self-contained
        isolation: "isolate",
      }}
    >

      {/* ── 1. Distant ambient aura (outermost, very soft) ──────────────── */}
      <div
        aria-hidden
        style={{
          position:     "absolute",
          inset:        `-${S * 0.55}px`,
          borderRadius: "50%",
          background:   TOKEN.auraColor,
          filter:       `blur(${S * 0.4}px)`,
          animation:    "player-aura-pulse 3.2s ease-in-out infinite",
          willChange:   "transform, opacity",
        }}
      />

      {/* ── 2. Outer ping ring (repeating expand-and-fade) ────────────────── */}
      <div
        aria-hidden
        style={{
          position:     "absolute",
          inset:        `-${S * 0.3}px`,
          borderRadius: "50%",
          border:       `1px solid ${TOKEN.rimColor}`,
          opacity:      0,
          animation:    "player-ping 2.6s ease-out infinite",
          willChange:   "transform, opacity",
        }}
      />

      {/* ── 3. Move ripple (fires on each position change) ────────────────── */}
      {flash && (
        <div
          aria-hidden
          style={{
            position:     "absolute",
            inset:        `-${S * 0.15}px`,
            borderRadius: "50%",
            border:       `1.5px solid ${TOKEN.rimColor}`,
            opacity:      0,
            animation:    "player-ripple 320ms ease-out forwards",
            willChange:   "transform, opacity",
          }}
        />
      )}

      {/* ── 4. Outer dashed orbit ring (slow clockwise) ───────────────────── */}
      <div
        aria-hidden
        style={{
          position:     "absolute",
          inset:        `-${S * 0.18}px`,
          borderRadius: "50%",
          border:       `1px dashed ${TOKEN.ringColor}`,
          animation:    "player-ring-spin 7s linear infinite",
          willChange:   "transform",
        }}
      />

      {/* ── 5. Inner dashed orbit ring (faster, counter-clockwise) ────────── */}
      <div
        aria-hidden
        style={{
          position:     "absolute",
          inset:        `-${S * 0.06}px`,
          borderRadius: "50%",
          border:       `1px dashed ${TOKEN.ringColorInner}`,
          animation:    "player-ring-spin-reverse 4s linear infinite",
          willChange:   "transform",
        }}
      />

      {/* ── 6. Glow bloom (blurred circle behind core) ────────────────────── */}
      <div
        aria-hidden
        style={{
          position:     "absolute",
          inset:        `-${S * 0.25}px`,
          borderRadius: "50%",
          background:   `radial-gradient(circle, ${TOKEN.glowColor} 0%, ${TOKEN.glowColorWide} 45%, transparent 72%)`,
          filter:       `blur(${S * 0.22}px)`,
          willChange:   "opacity",
        }}
      />

      {/* ── 7. Core sphere (breathing scale animation) ────────────────────── */}
      <div
        style={{
          position:     "absolute",
          inset:        0,
          borderRadius: "50%",
          // Sphere illusion: radial gradient lit from top-left
          background:   `radial-gradient(circle at 35% 32%, ${TOKEN.coreGradStart} 0%, ${TOKEN.coreGradEnd} 55%, #2563eb 100%)`,
          boxShadow:    [
            // Inner light rim
            `inset 0 1px 2px rgba(255,255,255,0.45)`,
            // Drop shadow
            `0 ${S * 0.12}px ${S * 0.3}px ${TOKEN.shadow}`,
            // Outer glow ring
            `0 0 ${S * 0.5}px ${TOKEN.glowColor}`,
            `0 0 ${S * 1.0}px ${TOKEN.glowColorWide}`,
          ].join(", "),
          animation:    "player-breathe 2.4s ease-in-out infinite",
          willChange:   "transform, opacity",
        }}
      />

      {/* ── 8. Specular highlight (top-left bright cap, static) ───────────── */}
      <div
        aria-hidden
        style={{
          position:     "absolute",
          top:          `${R * 0.18}px`,
          left:         `${R * 0.2}px`,
          width:        `${S * 0.28}px`,
          height:       `${S * 0.18}px`,
          borderRadius: "50%",
          background:   TOKEN.specular,
          filter:       `blur(${S * 0.06}px)`,
          opacity:      0.75,
          pointerEvents: "none",
          transform:    "rotate(-30deg)",
        }}
      />

    </div>
  );
};
