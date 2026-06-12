"use client";

import { useEffect } from "react";
import { useGameStore } from "../stores/gameStore";

export function usePlayerMovement() {
  const maze = useGameStore((s) => s.maze);
  const player = useGameStore((s) => s.player);
  const center = useGameStore((s) => s.center);

  const setPlayer = useGameStore((s) => s.setPlayer);
  const setStatus = useGameStore((s) => s.setStatus);

 useEffect(() => {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (!maze.length || !player || !center) return;

    event.preventDefault(); // 👈 IMPORTANT (prevents browser scroll blocking WASD)

    let [row, col] = player;

    switch (event.key.toLowerCase()) {
      case "arrowup":
      case "w":
        row--;
        break;

      case "arrowdown":
      case "s":
        row++;
        break;

      case "arrowleft":
      case "a":
        col--;
        break;

      case "arrowright":
      case "d":
        col++;
        break;

      default:
        return;
    }

    if (
      row < 0 ||
      col < 0 ||
      row >= maze.length ||
      col >= maze[0].length
    ) return;

    if (maze[row][col] === 1) return;

    setPlayer([row, col]);

    if (row === center[0] && col === center[1]) {
      setStatus("solved");
    }
  };

  window.addEventListener("keydown", handleKeyDown);

  return () => {
    window.removeEventListener("keydown", handleKeyDown);
  };
}, [maze, player, center, setPlayer, setStatus]);
}