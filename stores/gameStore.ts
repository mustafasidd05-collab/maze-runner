// =============================================================================
// stores/gameStore.ts — Zustand global state store for Maze Runner
// =============================================================================
//
// Architecture position
// ---------------------
//   lib/api.ts          (fetches data — no state)
//        ↓
//   stores/gameStore.ts (holds data — no fetch, no UI)  ← THIS FILE
//        ↓
//   React Components    (renders data — no direct API calls)
//
// Rules enforced by this file
// ---------------------------
//  1. NO fetch() or API calls — data arrives via actions called by hooks.
//  2. NO direct state mutation — every update goes through a setter action.
//  3. NO React imports — pure Zustand, usable outside component tree.
//  4. Every field and action is strictly typed via types/maze.ts.
//  5. State always flows: idle → loading → playing → solved
// =============================================================================

// zustand: lightweight (~1 kB) state manager for React.
// `create`    — factory that produces a typed React hook from a state slice.
// `StateCreator` — utility type for splitting stores into slices (future-proof).
import { create } from "zustand";

// devtools: Zustand middleware that connects to Redux DevTools Extension.
// Lets you inspect every action and time-travel during development.
// Wraps the store creator; has zero effect in production builds when the
// DevTools extension is absent.
import { devtools } from "zustand/middleware";

// All game types flow from a single source of truth — never redefined here.
import type {
    GameState,
    GameStatus,
    MazeGrid,
    Position,
    MazeGenerateResponse,
} from "../types/maze";


// =============================================================================
// INITIAL STATE
// =============================================================================

/**
 * The default shape of the store before any game session starts.
 *
 * Exported so components can compare slices against the default
 * (e.g. "has the maze loaded yet?") and so resetGame() has a single
 * source of truth to restore — no magic literals scattered through actions.
 */
export const INITIAL_STATE: GameStateSlice = {
    maze:           [],
    start:          [0, 0],
    center:         [0, 0],
    player:         [0, 0],
    path:           [],
    status:         "idle",
    seed:           null,
    size:           null,
    error:          null,
    moveCount:      0,
    elapsedSeconds: 0,
};


// =============================================================================
// STATE SLICE TYPE
// =============================================================================

/**
 * Pure data fields held by the store.
 *
 * Separated from `GameActions` so selectors can be typed against data only,
 * and so the shape exactly mirrors `GameState` from types/maze.ts with two
 * additions (`size`, `error`) needed for session management.
 */
interface GameStateSlice {
    // ── Maze data (populated by loadGame / setMaze) ───────────────────────
    /** Full 2-D grid received from /maze/generate. 0=path, 1=wall. */
    maze:           MazeGrid;

    /** Fixed player spawn point. Set once per session. */
    start:          Position;

    /** Fixed goal cell (maze centre). Set once per session. */
    center:         Position;

    // ── Live gameplay data ─────────────────────────────────────────────────
    /** Current player position. Mutated on every valid move. */
    player:         Position;

    // ── Solve / hint data ──────────────────────────────────────────────────
    /**
     * BFS shortest path from player position to center.
     * Empty array [] until the player requests a hint (solveMaze called).
     */
    path:           Position[];

    // ── Lifecycle ─────────────────────────────────────────────────────────
    /** Current game phase. Drives all conditional UI rendering. */
    status:         GameStatus;

    // ── Session metadata ───────────────────────────────────────────────────
    /**
     * Seed used to generate this maze — lets the player replay or share.
     * null before the first game session.
     */
    seed:           number | null;

    /**
     * Grid dimension used to generate this maze.
     * null before the first game session.
     */
    size:           number | null;

    /** Human-readable error message when status === "error". null otherwise. */
    error:          string | null;

    // ── Scoring ────────────────────────────────────────────────────────────
    /** Total valid moves made since the game entered "playing". */
    moveCount:      number;

    /** Wall-clock seconds elapsed since the game entered "playing". */
    elapsedSeconds: number;
}


// =============================================================================
// ACTIONS TYPE
// =============================================================================

/**
 * All state-mutation functions exposed by the store.
 *
 * Keeping actions in a separate interface means:
 *   - Selectors typed as `GameStateSlice` never accidentally call actions.
 *   - Adding a new action is a one-place change (here + implementation).
 */
interface GameActions {
    /**
     * Populate maze data and initialise the player at the spawn point.
     *
     * Called after a successful /maze/generate response when you want to
     * set maze, start, and center individually (e.g. if seed/size are
     * already stored). Prefer `loadGame()` for the common full-response case.
     *
     * Side effects:
     *   - Sets player to `start`
     *   - Clears any existing path and error
     *   - Resets moveCount and elapsedSeconds
     *
     * @param maze   - 2-D grid from the backend.
     * @param start  - Player spawn [row, col].
     * @param center - Goal cell [row, col].
     */
    setMaze(maze: MazeGrid, start: Position, center: Position): void;
    setSeed(seed: number): void;
    setSize(size: number): void;

    /**
     * Move the player to a new position.
     *
     * The store does NOT validate whether the move is legal (not a wall,
     * within bounds). That responsibility lives in useGame.ts. The store
     * is a dumb data container — it accepts whatever the hook tells it.
     *
     * Side effects:
     *   - Increments moveCount
     *
     * @param position - New [row, col] for the player.
     */
    setPlayer(position: Position): void;

    /**
     * Store the BFS solution path returned by /maze/solve.
     *
     * @param path - Ordered list of [row, col] waypoints from start to center.
     */
    setPath(path: Position[]): void;

    /**
     * Advance the game lifecycle to a new status.
     *
     * Valid transitions (enforced by caller — useGame.ts, not the store):
     *   idle → loading → playing → solved
     *                  ↘ error
     *
     * @param status - Target GameStatus value.
     */
    setStatus(status: GameStatus): void;

    /**
     * Store an error message and flip status to "error".
     *
     * Convenience wrapper around setStatus("error") + setting the error
     * field so callers do not need two separate calls.
     *
     * @param message - Human-readable error string safe for UI display.
     */
    setError(message: string): void;

    /**
     * Increment elapsedSeconds by 1.
     *
     * Intended to be called by a setInterval in useGame.ts every second
     * while status === "playing". The store does not manage its own timer.
     */
    tickTimer(): void;

    /**
     * Load a full MazeGenerateResponse into the store in a single atomic update.
     *
     * Preferred over calling setMaze() + individual setters separately because
     * Zustand batches all field updates inside one set() call, preventing
     * intermediate re-renders between individual setter calls.
     *
     * Lifecycle:
     *   - Sets maze, start, center, seed, size
     *   - Initialises player to start
     *   - Clears path, error, moveCount, elapsedSeconds
     *   - Sets status to "playing"
     *
     * @param data - Full response object from generateMaze() in lib/api.ts.
     */
    loadGame(data: MazeGenerateResponse): void;

    /**
     * Restore the store to its initial empty state.
     *
     * Called when the player starts a new game or navigates away.
     * Uses INITIAL_STATE as the single source of truth so there are
     * no hard-coded defaults scattered across actions.
     */
    resetGame(): void;
}


// =============================================================================
// COMBINED STORE TYPE
// =============================================================================

/**
 * Full store type = data fields + action functions.
 * This is the type returned by `useGameStore()` and used by all selectors.
 */
type GameStore = GameStateSlice & GameActions;


// =============================================================================
// STORE IMPLEMENTATION
// =============================================================================

/**
 * The Zustand store hook.
 *
 * Usage in components:
 * ```tsx
 * // Subscribe to a single field (component re-renders only when maze changes)
 * const maze   = useGameStore((s) => s.maze);
 *
 * // Subscribe to an action (stable reference — never triggers re-render)
 * const loadGame = useGameStore((s) => s.loadGame);
 *
 * // Subscribe to multiple fields with shallow equality check
 * import { useShallow } from "zustand/react/shallow";
 * const { player, status } = useGameStore(
 *     useShallow((s) => ({ player: s.player, status: s.status }))
 * );
 * ```
 */
export const useGameStore = create<GameStore>()(

    // devtools middleware — names every action in Redux DevTools for easy
    // debugging. The `name` option labels the store in the DevTools panel.
    devtools(
        (set, _get) => ({

            // ── Spread initial data fields ─────────────────────────────────
            ...INITIAL_STATE,
            // ================================================================
            // ACTION: setSeed
            // ================================================================
            setSeed(seed: number): void {
                set(
                    { seed },
                    false,
                    "setSeed",
                );
            },

            // ================================================================
            // ACTION: setSize
            // ================================================================
            setSize(size: number): void {
                set(
                    { size },
                    false,
                    "setSize",
                );
            },


            // ================================================================
            // ACTION: setMaze
            // ================================================================
            setMaze(
                maze: MazeGrid,
                start: Position,
                center: Position,
            ): void {
                set(
                    {
                        maze,
                        start,
                        center,
                        player:         start,   // spawn player at start
                        path:           [],      // clear any previous hint path
                        error:          null,    // clear any previous error
                        moveCount:      0,       // reset scoring
                        elapsedSeconds: 0,
                    },
                    false,             // false = merge, not replace full state
                    "setMaze",         // action label visible in DevTools
                );
            },


            // ================================================================
            // ACTION: setPlayer
            // ================================================================
            setPlayer(position: Position): void {
                set(
                    (state) => ({
                        player:    position,
                        moveCount: state.moveCount + 1,
                    }),
                    false,
                    "setPlayer",
                );
            },


            // ================================================================
            // ACTION: setPath
            // ================================================================
            setPath(path: Position[]): void {
                set(
                    { path },
                    false,
                    "setPath",
                );
            },


            // ================================================================
            // ACTION: setStatus
            // ================================================================
            setStatus(status: GameStatus): void {
                set(
                    { status },
                    false,
                    "setStatus",
                );
            },


            // ================================================================
            // ACTION: setError
            // ================================================================
            setError(message: string): void {
                set(
                    {
                        status: "error" as GameStatus,
                        error:  message,
                    },
                    false,
                    "setError",
                );
            },


            // ================================================================
            // ACTION: tickTimer
            // ================================================================
            tickTimer(): void {
                set(
                    (state) => ({ elapsedSeconds: state.elapsedSeconds + 1 }),
                    false,
                    "tickTimer",
                );
            },


            // ================================================================
            // ACTION: loadGame
            // ================================================================
            loadGame(data: MazeGenerateResponse): void {
                set(
                    {
                        // ── Data from backend ──────────────────────────────
                        maze:           data.maze,
                        start:          data.start,
                        center:         data.center,
                        seed:           data.seed,
                        size:           data.size,

                        // ── Derived / reset fields ─────────────────────────
                        player:         data.start,   // spawn at start
                        path:           [],
                        error:          null,
                        moveCount:      0,
                        elapsedSeconds: 0,

                        // ── Advance lifecycle ──────────────────────────────
                        // loading → playing in one atomic update so no
                        // component ever sees a "loaded maze, still loading"
                        // intermediate state.
                        status:         "playing" as GameStatus,
                    },
                    false,
                    "loadGame",
                );
            },


            // ================================================================
            // ACTION: resetGame
            // ================================================================
            resetGame(): void {
                set(
                    INITIAL_STATE,   // single source of default values
                    false,
                    "resetGame",
                );
            },

        }),

        // devtools options
        {
            name:    "GameStore",   // label in Redux DevTools panel
            enabled: process.env.NODE_ENV === "development",
        },
    ),
);


// =============================================================================
// TYPED SELECTORS
// =============================================================================
//
// Pre-built selector functions for the most commonly read state slices.
//
// Why use selectors instead of reading the whole store?
// ------------------------------------------------------
// Zustand re-renders a component whenever ANY part of the store changes
// if the component subscribes with `useGameStore()` (no selector).
// Passing a selector means the component only re-renders when the specific
// slice it cares about changes — a significant performance win for canvas
// renders and HUD updates that fire on every player move.
//
// Usage:
//   const maze = useGameStore(selectMaze);
//   const { player, status } = useGameStore(selectPlayerAndStatus);
// =============================================================================

/** Select the full 2-D maze grid. */
export const selectMaze           = (s: GameStore): MazeGrid   => s.maze;

/** Select the player's current [row, col]. */
export const selectPlayer         = (s: GameStore): Position   => s.player;

/** Select the fixed goal position. */
export const selectCenter         = (s: GameStore): Position   => s.center;

/** Select the fixed spawn position. */
export const selectStart          = (s: GameStore): Position   => s.start;

/** Select the BFS hint path (empty until solve is requested). */
export const selectPath           = (s: GameStore): Position[] => s.path;

/** Select the current game lifecycle status. */
export const selectStatus         = (s: GameStore): GameStatus => s.status;

/** Select the active seed for replay / sharing. */
export const selectSeed           = (s: GameStore): number | null => s.seed;

/** Select the error message (non-null only when status === "error"). */
export const selectError          = (s: GameStore): string | null => s.error;

/** Select the current move count for scoring display. */
export const selectMoveCount      = (s: GameStore): number => s.moveCount;

/** Select elapsed seconds for the in-game timer. */
export const selectElapsedSeconds = (s: GameStore): number => s.elapsedSeconds;

/**
 * Select whether the player has reached the center cell.
 *
 * Derived boolean — cheaper to compute here than in every component
 * that needs to conditionally render the win overlay.
 */
export const selectIsSolved = (s: GameStore): boolean =>
    s.player[0] === s.center[0] && s.player[1] === s.center[1];