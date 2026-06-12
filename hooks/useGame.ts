// =============================================================================
// hooks/useGame.ts — Game lifecycle orchestration hook for Maze Runner
// =============================================================================
//
// Architecture position
// ---------------------
//   lib/api.ts          (fetches data)
//   stores/gameStore.ts (holds data)
//        ↑ ↑
//   hooks/useGame.ts    (orchestrates flow)  ← THIS FILE
//        ↓
//   React Components    (calls hook actions, reads store directly)
//
// Single responsibility
// ---------------------
// This hook does ONE thing: connect the API layer to the store layer.
// It never renders, never holds local game state, never writes to DOM.
// Components read state from the store directly via selectors.
// Components trigger actions via the functions this hook returns.
//
// Game lifecycle this hook enforces
// ----------------------------------
//   idle ──► loading ──► playing ──► solved
//              ▲                       │
//              └───── resetGame() ─────┘
//                     (back to idle)
// =============================================================================

// useCallback: memoises action functions so components that receive them
// as props don't re-render on every hook call.
import { useCallback } from "react";

// All API functions — the ONLY place fetch() is called in the frontend.
import { generateMaze, solveMaze, ApiError } from "../lib/api";

// Store actions and selectors — all state lives here, never in this hook.
import {
    useGameStore,
    selectMaze,
    selectPlayer,
    selectCenter,
    selectStatus,
} from "../stores/gameStore";

// Types shared across the full stack contract.
import type { MazeGenerateResponse, Position } from "../types/maze";


// =============================================================================
// HOOK RETURN TYPE
// =============================================================================

/**
 * Everything a component needs from this hook.
 *
 * Separated into three groups for clarity:
 *   - actions : async functions the component calls in response to user input
 *   - state   : derived booleans computed here so components stay dumb
 *   - error   : the latest human-readable error message, or null
 */
export interface UseGameReturn {
    // ── Core actions ──────────────────────────────────────────────────────
    /**
     * Fetch a maze from the backend and start a new game session.
     * Transitions: idle / solved / error → loading → playing
     *
     * @param seed - Integer seed for deterministic generation.
     * @param size - Odd integer >= 11. Defaults to 21.
     */
    startGame: (seed: number, size?: number) => Promise<void>;

    /**
     * Ask the backend for the BFS shortest path from the player's current
     * position to the center, then store it as a hint overlay.
     * Transitions: playing → loading → solved
     */
    solveGame: () => Promise<void>;

    /**
     * Clear all game data and return to the idle screen.
     * Transitions: any → idle
     */
    resetGame: () => void;

    // ── Derived state booleans ────────────────────────────────────────────
    /** True while an API request is in-flight. Use to show spinners. */
    isLoading: boolean;

    /** True once the maze is loaded and the player can move. */
    isPlaying: boolean;

    /** True after solveGame() completes successfully. */
    isSolved: boolean;

    /** True when the last action produced an unrecoverable error. */
    isError: boolean;

    // ── Error messaging ───────────────────────────────────────────────────
    /** Human-readable error string safe for UI display. null when no error. */
    error: string | null;
}


// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Central game orchestration hook.
 *
 * Usage in any component:
 * ```tsx
 * const { startGame, solveGame, resetGame, isLoading, isPlaying } = useGame();
 *
 * // Start a new game when the player submits a seed
 * await startGame(42, 21);
 *
 * // Request a hint
 * await solveGame();
 *
 * // Return to the start screen
 * resetGame();
 * ```
 *
 * Components should read maze data, player position, and path directly
 * from the store via selectors — this hook only exposes control functions
 * and derived status booleans.
 */
export function useGame(): UseGameReturn {

    // ── Read store actions (stable references — never cause re-renders) ───
    const setPlayer = useGameStore((s) => s.setPlayer);
    const loadGame  = useGameStore((s) => s.loadGame);
    const setStatus = useGameStore((s) => s.setStatus);
    const setPath   = useGameStore((s) => s.setPath);
    const setError  = useGameStore((s) => s.setError);
    const resetStore = useGameStore((s) => s.resetGame);

    // ── Read state slices (each selector = isolated subscription) ─────────
    const maze   = useGameStore(selectMaze);
    const player = useGameStore(selectPlayer);
    const center = useGameStore(selectCenter);
    const status = useGameStore(selectStatus);
    const error  = useGameStore((s) => s.error);


    // =========================================================================
    // ACTION: startGame
    // =========================================================================

    const startGame = useCallback(async (
        seed: number,
        size: number = 21,
    ): Promise<void> => {

        // ── Guard: prevent double-firing if already loading ───────────────
        if (status === "loading") return;

        // ── Step 1: signal loading so UI shows a spinner immediately ──────
        setStatus("loading");

        try {
            // ── Step 2: fetch maze from backend ───────────────────────────
            // generateMaze() in lib/api.ts owns all fetch logic.
            // We never touch fetch() here.
            const data: MazeGenerateResponse = await generateMaze(seed, size);

            // ── Step 3: push full response into store atomically ──────────
            // loadGame() sets maze + start + center + seed + size,
            // initialises player at start, clears old path,
            // and flips status to "playing" — all in one set() call.
            // No intermediate renders between "loaded maze" and "playing".
            loadGame(data);

            // status is now "playing" — set by loadGame() inside the store.

        } catch (err) {
            // ── Error: surface to UI via store, never crash ───────────────
            const message = formatError(err, "Failed to generate maze.");
            setError(message);
            // status is now "error" — set by setError() inside the store.
        }

    }, [status, setStatus, loadGame, setError]);


    // =========================================================================
    // ACTION: solveGame
    // =========================================================================

    const solveGame = useCallback(async (): Promise<void> => {

    // ── Guard: can only solve while actively playing ──────────────────
    if (status !== "playing") return;

    // ── Guard: maze must be loaded before we can solve it ─────────────
    if (maze.length === 0) {
        setError("No maze loaded. Start a game first.");
        return;
    }

    try {
        // ── Request shortest path from backend ─────────────────────────
        const result = await solveMaze(
            maze,
            player as Position,
            center as Position,
        );

        const path = result.path;

        // Store path so MazeCanvas can draw it
        setPath(path);

        // Animate player movement step-by-step
        for (let i = 0; i < path.length; i++) {
            await new Promise((resolve) => setTimeout(resolve, 80));

            setPlayer(path[i]);
        }

        // Reached destination
        setStatus("solved");

    } catch (err) {
        const message = formatError(err, "Failed to solve maze.");
        setError(message);
    }

}, [
    status,
    maze,
    player,
    center,
    setPath,
    setPlayer,
    setStatus,
    setError,
]);


    // =========================================================================
    // ACTION: resetGame
    // =========================================================================

    const resetGame = useCallback((): void => {
        // Delegates entirely to the store's resetGame action which restores
        // INITIAL_STATE in one set() call — no local cleanup needed here.
        resetStore();
        // status is now "idle".
    }, [resetStore]);


    // =========================================================================
    // DERIVED STATE
    // Computed here so every component gets the same boolean logic
    // without duplicating status-string comparisons across the codebase.
    // =========================================================================

    const isLoading: boolean = status === "loading";
    const isPlaying: boolean = status === "playing";
    const isSolved:  boolean = status === "solved";
    const isError:   boolean = status === "error";


    // =========================================================================
    // RETURN
    // =========================================================================

    return {
        startGame,
        solveGame,
        resetGame,
        isLoading,
        isPlaying,
        isSolved,
        isError,
        error,
    };
}


// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Normalise any thrown value into a human-readable string safe for the UI.
 *
 * Three cases:
 *   1. ApiError (from lib/api.ts)  → use its typed message
 *   2. Generic Error               → use its message string
 *   3. Unknown (string, object, …) → use the fallback
 *
 * The fallback parameter lets each call site provide context:
 * "Failed to generate maze." vs "Failed to solve maze."
 *
 * @param err      - The caught value (unknown type by TypeScript convention).
 * @param fallback - Message to show when err has no readable message.
 */
function formatError(err: unknown, fallback: string): string {
    if (err instanceof ApiError) {
        // ApiError.message is already formatted in lib/api.ts
        return err.message;
    }
    if (err instanceof Error) {
        return err.message;
    }
    return fallback;
}