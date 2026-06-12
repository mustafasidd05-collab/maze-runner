"use client";

import { useMemo } from "react";
import { useGameStore } from "../stores/gameStore";

export function useMazeCamera() {
  const maze = useGameStore((s) => s.maze);

  return useMemo(() => {
    if (!maze.length) {
      return {
        scale: 1,
        width: 0,
        height: 0,
      };
    }

    const rows = maze.length;
    const cols = maze[0].length;

    // viewport size (fallback-safe for SSR)
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;

    // padding so UI doesn’t touch edges
    const padding = 120;

    const maxWidth = vw - padding;
    const maxHeight = vh - padding;

    // base cell size BEFORE scaling
    const baseCellSize = 24;

    const scaleX = maxWidth / (cols * baseCellSize);
    const scaleY = maxHeight / (rows * baseCellSize);

    // final camera scale (never exceed 1 for pixel crispness)
    const scale = Math.min(scaleX, scaleY, 1);

    return {
      scale,
      width: cols * baseCellSize * scale,
      height: rows * baseCellSize * scale,
      baseCellSize,
    };
  }, [maze]);
}