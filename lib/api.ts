// =============================================================================
// lib/api.ts — Centralised API layer for all Maze Runner backend communication
// =============================================================================
//
// Architecture position
// ---------------------
//   Game UI (React components / hooks / stores)
//           ↓  calls
//       lib/api.ts                        ← THIS FILE
//           ↓  HTTP
//       FastAPI backend  (localhost:8000)
//
// Rules enforced by this file
// ---------------------------
//  1. NO fetch() calls anywhere else in the frontend — only here.
//  2. NO `any` types — every request and response is fully typed.
//  3. NO UI logic — no state updates, no React imports, no rendering.
//  4. Every function is async and returns a typed result or throws an
//     ApiError so the caller always knows exactly what it received.
// =============================================================================

import type {
    MazeGenerateRequest,
    MazeGenerateResponse,
    MazeSolveRequest,
    MazeSolveResponse,
    ApiErrorResponse,
    MazeGrid,
    Position,
} from "../types/maze";


// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Base URL of the FastAPI backend.
 *
 * Falls back to localhost:8000 for local development.
 * Set NEXT_PUBLIC_API_URL in .env.local (or your deployment environment)
 * to point at a staging / production server without changing this file:
 *
 *   NEXT_PUBLIC_API_URL=https://api.your-domain.com
 *
 * NEXT_PUBLIC_ prefix is required for Next.js to expose the variable to
 * the browser bundle. Server-side code can also read it safely.
 */
const BASE_URL: string =
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * Versioned API prefix — mirrors the prefix registered in FastAPI's main.py.
 * Change once here if the backend version bumps to /api/v2.
 */
const API_PREFIX: string = "";

/**
 * Default fetch timeout in milliseconds.
 * Maze generation for large grids (51×51) can take a moment;
 * 10 s is generous enough for dev, tight enough to surface hangs quickly.
 */
const DEFAULT_TIMEOUT_MS: number = 10_000;


// =============================================================================
// CUSTOM ERROR CLASS
// =============================================================================

/**
 * Structured error thrown by every function in this file.
 *
 * Callers (hooks, stores) catch `ApiError` and can branch on:
 *   - err.status  : HTTP status code (0 = network / timeout failure)
 *   - err.message : Human-readable description safe to display in the UI
 *   - err.detail  : Raw `detail` string from FastAPI's HTTPException, if any
 *
 * Having a dedicated class (rather than plain Error) lets TypeScript narrow
 * the type in catch blocks:
 *
 *   } catch (err) {
 *     if (err instanceof ApiError) { ... }   // fully typed
 *   }
 */
export class ApiError extends Error {
    /** HTTP status code. 0 means the request never reached the server. */
    public readonly status: number;

    /** Raw FastAPI error detail string, if the server returned one. */
    public readonly detail: string | null;

    constructor(message: string, status: number, detail: string | null = null) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.detail = detail;
    }
}


// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Build the full URL for a given API path segment.
 *
 * Examples:
 *   buildUrl("/maze/generate") → "http://localhost:8000/api/v1/maze/generate"
 *   buildUrl("/maze/health")   → "http://localhost:8000/api/v1/maze/health"
 *
 * @param path - Path segment starting with "/".
 */
function buildUrl(path: string): string {
    return `${BASE_URL}${API_PREFIX}${path}`;
}


/**
 * Wrapper around fetch() that:
 *   1. Attaches a timeout via AbortController.
 *   2. Adds standard JSON headers to every request.
 *   3. Parses the response body as JSON exactly once.
 *   4. Maps every failure mode (network error, timeout, non-2xx status)
 *      to a typed ApiError so callers never deal with raw fetch rejections.
 *
 * @param url     - Full URL to request.
 * @param options - Standard RequestInit options (method, body, etc.).
 * @returns       - Parsed JSON response body cast to T.
 * @throws        - ApiError for any failure (network, timeout, HTTP error).
 */
async function request<T>(url: string, options: RequestInit): Promise<T> {
    // ── Timeout via AbortController ───────────────────────────────────────
    // fetch() has no built-in timeout; AbortController is the standard
    // approach that works in both browser and Node (Next.js SSR / RSC).
    const controller = new AbortController();
    const timeoutId  = setTimeout(
        () => controller.abort(),
        DEFAULT_TIMEOUT_MS,
    );

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
                // Tell FastAPI we are sending JSON
                "Content-Type": "application/json",
                // Tell FastAPI we expect JSON back
                "Accept": "application/json",
                // Spread any caller-provided headers last so they can override
                ...options.headers,
            },
        });

        // ── Parse the body ONCE regardless of status ──────────────────────
        // We need the body for both success payloads and FastAPI error details.
        // `response.json()` rejects for empty bodies (e.g. 204 No Content);
        // in that case we fall back to null.
        let body: T | ApiErrorResponse | null = null;

        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
            body = (await response.json()) as T | ApiErrorResponse;
        }

        // ── Non-2xx → extract FastAPI's detail and throw ──────────────────
        if (!response.ok) {
            const errorBody = body as ApiErrorResponse | null;
            const detail    = errorBody?.detail ?? null;

            // Map common HTTP status codes to developer-friendly messages
            const message = httpStatusMessage(response.status, detail);
            throw new ApiError(message, response.status, detail);
        }

        // ── Success ───────────────────────────────────────────────────────
        return body as T;

    } catch (err) {
        // Re-throw ApiErrors we created above — nothing to re-wrap
        if (err instanceof ApiError) throw err;

        // AbortController fired → timeout
        if (err instanceof DOMException && err.name === "AbortError") {
            throw new ApiError(
                `Request timed out after ${DEFAULT_TIMEOUT_MS / 1000}s. `
                + "Check that the backend is running.",
                0,
            );
        }

        // Network failure (server unreachable, DNS failure, CORS block, …)
        const networkMessage =
            err instanceof Error ? err.message : "Unknown network error.";

        throw new ApiError(
            `Network error — could not reach the backend: ${networkMessage}`,
            0,
        );
    } finally {
        // Always clear the timeout to avoid a Node.js / browser warning
        // about a timer firing after the request has already resolved.
        clearTimeout(timeoutId);
    }
}


/**
 * Map an HTTP status code to a human-readable error message.
 * Falls back to the raw FastAPI detail string when we don't have
 * a specific message, then to a generic fallback.
 *
 * @param status - HTTP response status code.
 * @param detail - FastAPI HTTPException detail string, if any.
 */
function httpStatusMessage(status: number, detail: string | null): string {
    const knownMessages: Record<number, string> = {
        400: "Bad request — check maze parameters (seed, size, coordinates).",
        404: "Endpoint not found — the backend route may have changed.",
        422: "Validation error — the request body did not match the backend schema.",
        500: "Internal server error — the backend encountered an unexpected failure.",
        503: "Service unavailable — the backend may be starting up or overloaded.",
    };

    return (
        knownMessages[status]
        ?? detail
        ?? `Unexpected HTTP ${status} response from the backend.`
    );
}


// =============================================================================
// PUBLIC API FUNCTIONS
// =============================================================================

// -----------------------------------------------------------------------------
// generateMaze
// -----------------------------------------------------------------------------

/**
 * Request a new maze from the backend.
 *
 * Calls: POST /api/v1/maze/generate
 *
 * The backend uses `seed` to deterministically generate the maze via
 * Recursive Backtracking. Identical (seed, size) pairs always return
 * identical mazes, making replays and sharing trivial.
 *
 * @param seed - Integer seed for maze generation. Any integer is valid.
 * @param size - Odd integer >= 11 controlling grid dimensions.
 *               Defaults to 21 if not provided.
 *
 * @returns MazeGenerateResponse containing maze grid, start, and center.
 *
 * @throws ApiError if:
 *   - size is even or below 11 (HTTP 400 from backend validator)
 *   - backend is unreachable (status 0)
 *   - any other HTTP or network failure
 *
 * @example
 *   const data = await generateMaze(42, 21);
 *   // data.maze    → 21×21 grid
 *   // data.start   → [1, 3]
 *   // data.center  → [10, 10]
 */
export async function generateMaze(
    seed: number,
    size: number = 21,
): Promise<MazeGenerateResponse> {
    const body: MazeGenerateRequest = { seed, size };

    return request<MazeGenerateResponse>(
        buildUrl("/maze/generate"),
        {
            method: "POST",
            body: JSON.stringify(body),
        },
    );
}


// -----------------------------------------------------------------------------
// solveMaze
// -----------------------------------------------------------------------------

/**
 * Ask the backend for the shortest path from `start` to `goal` (BFS).
 *
 * Calls: POST /api/v1/maze/solve
 *
 * The backend is stateless — it needs the full maze grid on every solve
 * request. Pass the same `maze` received from generateMaze().
 *
 * @param maze  - Full 2-D maze grid (0 = path, 1 = wall).
 * @param start - [row, col] of the player's current position.
 * @param goal  - [row, col] of the target cell (usually the center).
 *
 * @returns MazeSolveResponse with an ordered path and step count.
 *          path = []  and path_length = -1 when no solution exists.
 *
 * @throws ApiError if:
 *   - start or goal is out-of-bounds or on a wall (HTTP 400)
 *   - backend is unreachable (status 0)
 *   - any other HTTP or network failure
 *
 * @example
 *   const result = await solveMaze(maze, [1, 1], [10, 10]);
 *   // result.path        → [[1,1],[1,2], … ,[10,10]]
 *   // result.path_length → 18
 */
export async function solveMaze(
    maze: MazeGrid,
    start: Position,
    goal: Position,
): Promise<MazeSolveResponse> {
    const body: MazeSolveRequest = { maze, start, goal };

    return request<MazeSolveResponse>(
        buildUrl("/maze/solve"),
        {
            method: "POST",
            body: JSON.stringify(body),
        },
    );
}


// -----------------------------------------------------------------------------
// checkHealth
// -----------------------------------------------------------------------------

/**
 * Verify that the maze service is reachable and responding.
 *
 * Calls: GET /api/v1/maze/health
 *
 * Use this on app startup or in a debug panel to surface connectivity
 * issues early, before the user tries to generate a maze.
 *
 * @returns true if the backend reports healthy status.
 *
 * @throws ApiError if the backend is unreachable or returns a non-2xx status.
 *
 * @example
 *   const healthy = await checkHealth();
 *   console.log(healthy); // true
 */
export async function checkHealth(): Promise<boolean> {
    const response = await request<{ status: string; service: string }>(
        buildUrl("/maze/health"),
        { method: "GET" },
    );

    // Backend returns { "status": "healthy", "service": "maze" }
    // Any non-throwing response from request() means HTTP 2xx,
    // but we double-check the payload for an explicit "healthy" value.
    return response.status === "healthy";
}


// =============================================================================
// NAMED EXPORTS SUMMARY
// =============================================================================
//
//  Classes  : ApiError
//  Functions: generateMaze, solveMaze, checkHealth
//  Constants: BASE_URL (not exported — internal implementation detail)
//
//  Consumers import like:
//
//    import { generateMaze, solveMaze, checkHealth, ApiError } from "@/lib/api";
//
// =============================================================================