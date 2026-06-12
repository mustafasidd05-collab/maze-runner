"use client";

import { useEffect } from "react";
import { useGameStore } from "../stores/gameStore";

export function useGameTimer() {
  const status = useGameStore((s) => s.status);
  const tickTimer = useGameStore((s) => s.tickTimer);

  useEffect(() => {
    if (status !== "playing") return;

    const interval = setInterval(() => {
      tickTimer();
    }, 1000);

    return () => clearInterval(interval);
  }, [status, tickTimer]);
}