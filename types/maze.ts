// =============================================================================
// types/maze.ts — Single source of truth for all Maze Runner data contracts
// =============================================================================
//
// Architecture rule
// -----------------
// This file has ZERO imports and ZERO business logic.
// Every other module imports FROM here — nothing here imports from elsewhere.
//
//   types/maze.ts
//        ▲
//        │  imported by
//   ┌────┴──────────────────────────────────┐
//   │  lib/api.ts   stores/gameStore.ts     │
//   │  components/  hooks/useGame.ts        │
//   └───────────────────────────────────────┘
//
// Changing a type here is the ONLY place you need to update to propagate
// a contract change across the entire frontend.
// =============================================================================


// =============================================================================
// SECTION 1 — PRIMITIVE / REUSABLE TYPES
// These are the building blocks used by every other type in this file.
// =============================================================================

/**
 * A single [row, col] coordinate inside the maze grid.
 *
 * - row : vertical index   (0 = top row)
 * - col : horizontal index (0 = left column)
 *
 * Used for: player position, start, center/goal, and every node in a path.
 * Tuple type (not number[]) enforces exactly two elements at compile time.
 */
export type Position = [row: number, col: number];


/**
 * A single maze cell value.
 *
 *   0 → PATH  (walkable)
 *   1 → WALL  (impassable)
 *
 * Using a literal union (not plain `number`) means TypeScript will error
 * if any code tries to assign, e.g., 2 or -1 to a cell.
 */
export type CellValue = 0 | 1;


/**
 * The full maze grid — a 2-D array of CellValue.
 *
 * Constraints (enforced at runtime by the backend, documented here):
 *   - Always square: maze[i].length === maze.length for all i
 *   - Always odd dimension: 11 × 11, 21 × 21, 31 × 31, …
 *   - Outer ring is always WALL (1)
 *
 * Indexed as: maze[row][col]
 */
export type MazeGrid = CellValue[][];


/**
 * Valid odd maze dimensions accepted by the backend.
 *
 * The backend enforces size >= 11 and size % 2 !== 0.
 * Listing common sizes here makes form inputs and dropdowns type-safe;
 * extend the union as new sizes are supported.
 */
export type MazeSize = 11 | 15 | 21 | 25 | 31 | 41 | 51;


// =============================================================================
// SECTION 2 — API REQUEST TYPES
// Shapes sent FROM the frontend TO the FastAPI backend.
// Must match the Pydantic request models in app/models/maze.py exactly.
// =============================================================================

/**
 * Request body for POST /api/v1/maze/generate
 *
 * Backend Pydantic model: MazeGenerateRequest
 *   - seed : any integer — deterministic RNG seed
 *   - size : odd integer >= 11 — maze grid dimension
 */
export interface MazeGenerateRequest {
    /** Integer seed. Same seed + size always produces identical maze. */
    seed: number;

    /**
     * Width and height of the square maze grid.
     * Must be odd and >= 11 (validated by the backend).
     */
    size: MazeSize | number;   // MazeSize for known values; number for custom input
}


/**
 * Request body for POST /api/v1/maze/solve
 *
 * Backend Pydantic model: MazeSolveRequest
 *   - maze  : full grid (re-sent so the backend is stateless)
 *   - start : player's current [row, col]
 *   - goal  : target [row, col] (usually the center cell)
 */
export interface MazeSolveRequest {
    /** Full 2-D maze grid as returned by /generate. */
    maze: MazeGrid;

    /** [row, col] of the player's current position. */
    start: Position;

    /** [row, col] of the target cell (the maze center). */
    goal: Position;
}


// =============================================================================
// SECTION 3 — API RESPONSE TYPES
// Shapes received FROM the FastAPI backend BY the frontend.
// Must match the Pydantic response models in app/models/maze.py exactly.
// =============================================================================

/**
 * Response body from POST /api/v1/maze/generate
 *
 * Backend Pydantic model: MazeGenerateResponse
 */
export interface MazeGenerateResponse {
    /** Echo of the seed used — store this to allow "replay same maze". */
    seed: number;

    /** Echo of the size used — width and height of the returned grid. */
    size: number;

    /**
     * Full 2-D maze grid.
     * 0 = walkable path, 1 = wall. Indexed as maze[row][col].
     */
    maze: MazeGrid;

    /**
     * Player spawn point — always an open cell on the top inner row.
     * Place the player sprite here on game start.
     */
    start: Position;

    /**
     * Goal / exit cell — always the geometric centre of the grid.
     * e.g. size=11 → center=[5,5]. Render the objective marker here.
     */
    center: Position;
}


/**
 * Response body from POST /api/v1/maze/solve
 *
 * Backend Pydantic model: MazeSolveResponse
 */
export interface MazeSolveResponse {
    /**
     * Ordered list of [row, col] waypoints from start to goal (inclusive).
     * Produced by BFS — guaranteed to be the shortest possible path.
     * Empty array [] when no path exists.
     */
    path: Position[];

    /**
     * Number of steps in the path (path.length - 1).
     * -1 when no path exists (disconnected maze region).
     *  0 when start === goal.
     */
    path_length: number;
}


// =============================================================================
// SECTION 4 — GAME STATUS
// Union type representing every possible phase of a game session.
// Used by the Zustand store and all UI components that conditionally render
// based on the current game phase.
// =============================================================================

/**
 * All valid phases of a game session — in typical lifecycle order:
 *
 *   idle  →  loading  →  playing  →  solved
 *               ↑                       │
 *               └───────────────────────┘  (replay / new game resets to loading)
 *
 *   idle    : No maze loaded. Show the start screen / seed input.
 *   loading : Awaiting response from /generate. Show spinner.
 *   playing : Maze rendered, player can move. Timer running.
 *   solved  : Player reached the center. Show results overlay.
 *   error   : API call failed or validation error. Show error state.
 */
export type GameStatus = "idle" | "loading" | "playing" | "solved" | "error";


// =============================================================================
// SECTION 5 — FRONTEND GAME STATE
// The canonical shape of the Zustand game store.
// This type is FRONTEND-ONLY — it has no backend equivalent.
// =============================================================================

/**
 * Complete state model for the Maze Runner game session.
 *
 * Owned by: stores/gameStore.ts (Zustand)
 * Read by : components/, hooks/useGame.ts
 *
 * Field notes
 * -----------
 * - maze, start, center  : populated after a successful /generate call.
 * - player               : initialised to `start`, updated on each move.
 * - path                 : populated after a successful /solve call (hint mode).
 * - status               : drives all conditional UI rendering.
 * - seed                 : kept in state so the user can share / replay the maze.
 * - error                : set when status === "error"; null otherwise.
 * - moveCount            : incremented on every valid player move (for scoring).
 * - elapsedSeconds       : wall-clock time since the game entered "playing".
 */
export interface GameState {
    // ── Maze data (from /generate response) ──────────────────────────────
    /** Full 2-D grid. Empty array [] before first generation. */
    maze: MazeGrid;

    /** Player spawn point. Matches MazeGenerateResponse.start. */
    start: Position;

    /** Goal / exit cell. Matches MazeGenerateResponse.center. */
    center: Position;

    // ── Live game data ─────────────────────────────────────────────────────
    /** Current player position. Initialised to `start` when game begins. */
    player: Position;

    // ── Solve / hint data (from /solve response, optional) ────────────────
    /**
     * BFS shortest path from player's position to center.
     * Populated when the player requests a hint.
     * Empty array [] when no hint has been requested or no path exists.
     */
    path: Position[];

    // ── Session metadata ───────────────────────────────────────────────────
    /** Current phase of the game session. Drives all conditional UI. */
    status: GameStatus;

    /**
     * Active seed — echoed from the backend so the player can replay
     * or share an identical maze by reusing this value.
     * null before the first /generate call.
     */
    seed: number | null;

    /** Human-readable error message when status === "error". null otherwise. */
    error: string | null;

    // ── Scoring ────────────────────────────────────────────────────────────
    /** Total valid moves made since the game entered "playing". */
    moveCount: number;

    /** Seconds elapsed since the game entered "playing". */
    elapsedSeconds: number;
}


// =============================================================================
// SECTION 6 — CONVENIENCE UNIONS / UTILITY TYPES
// Derived types that other modules can import instead of re-declaring.
// =============================================================================

/**
 * The four compass directions the player can move.
 * Used by useGame.ts and any keyboard / swipe handler.
 */
export type Direction = "up" | "down" | "left" | "right";


/**
 * Minimal maze metadata — a lightweight slice of MazeGenerateResponse
 * used by components that only need seed + size (e.g. a HUD "replay" button)
 * and should not hold a reference to the full grid.
 */
export interface MazeMeta {
    seed: number;
    size: number;
}


/**
 * Payload shape for an API error response from FastAPI.
 * FastAPI's HTTPException serialises as { detail: string }.
 * Storing this type here keeps error-handling logic consistent
 * across all api.ts calls.
 */
export interface ApiErrorResponse {
    detail: string;
}