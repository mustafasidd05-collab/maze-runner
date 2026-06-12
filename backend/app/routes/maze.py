# =============================================================================
# routes/maze.py — API routes for maze generation and pathfinding operations
# =============================================================================

# APIRouter: lets us define routes in separate files and register in main.py
from fastapi import APIRouter, HTTPException
from fastapi import status

# --- Schemas -----------------------------------------------------------------
# Generation contracts
from app.models.maze import MazeGenerateRequest, MazeGenerateResponse
# Solving contracts
from app.models.maze import MazeSolveRequest, MazeSolveResponse

# --- Services ----------------------------------------------------------------
# Maze generation logic
from app.services.generator import generate_maze
# Shortest-path logic
from app.services.pathfinder import find_shortest_path


# =============================================================================
# ROUTER INSTANCE
# =============================================================================

router = APIRouter(
    prefix="/maze",
    tags=["Maze"],
)


# =============================================================================
# HEALTH CHECK
# =============================================================================

@router.get(
    "/health",
    summary="Maze service health check",
    status_code=status.HTTP_200_OK,
)
async def maze_health() -> dict:
    """
    Confirm that the maze router is reachable and the service is running.

    Returns:
        JSON with 'status' and 'service' keys.
    """
    return {"status": "healthy", "service": "maze"}


# =============================================================================
# POST /maze/generate
# =============================================================================

@router.post(
    "/generate",
    response_model=MazeGenerateResponse,
    summary="Generate a new maze",
    status_code=status.HTTP_200_OK,
)
async def generate(request: MazeGenerateRequest) -> MazeGenerateResponse:
    """
    Generate a deterministic maze from a seed and size.

    - **seed**: any integer — same seed + size always returns the same maze.
    - **size**: odd integer ≥ 11 — controls maze dimensions (e.g. 11, 15, 21).

    The maze is represented as a 2-D grid where:
    - `0` = walkable path
    - `1` = wall

    The response includes the player spawn (`start`) and the goal cell
    (`center`) so the frontend can position game objects immediately.

    Raises:
        400 Bad Request           — if size is even or below the minimum.
        500 Internal Server Error — for any unexpected failure.
    """
    try:
        result: dict = generate_maze(seed=request.seed, size=request.size)
        return MazeGenerateResponse(**result)

    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while generating the maze.",
        ) from exc


# =============================================================================
# POST /maze/solve
# =============================================================================

@router.post(
    "/solve",
    response_model=MazeSolveResponse,
    summary="Solve a maze using BFS",
    status_code=status.HTTP_200_OK,
)
async def solve(request: MazeSolveRequest) -> MazeSolveResponse:
    """
    Find the shortest path from `start` to `goal` inside the provided maze.

    Delegates entirely to the BFS implementation in `pathfinder.py`.
    This route is intentionally thin — it only handles HTTP concerns
    (deserialisation, error mapping, serialisation).

    Request body:
    - **maze**  : 2-D grid; `0` = walkable path, `1` = wall.
    - **start** : `[row, col]` of the player's current position.
    - **goal**  : `[row, col]` of the target cell.

    Response:
    - **path**        : Ordered list of `[row, col]` waypoints from
                        `start` to `goal` (both endpoints included).
                        Empty list `[]` when no path exists.
    - **path_length** : Number of steps taken (`len(path) - 1`).
                        `-1` when no path exists.

    Example response (path found):
```json
    {
        "path": [[0,1],[1,1],[2,1],[2,2],[2,3]],
        "path_length": 4
    }
```

    Example response (no path):
```json
    {
        "path": [],
        "path_length": -1
    }
```

    Raises:
        400 Bad Request           — start or goal is out-of-bounds or on a wall
                                    (ValueError raised by pathfinder).
        500 Internal Server Error — any unexpected failure.
    """
    try:
        # ── Convert list[int] → tuple[int, int] as pathfinder expects tuples
        start: tuple[int, int] = (request.start[0], request.start[1])
        goal: tuple[int, int]  = (request.goal[0],  request.goal[1])

        # ── Delegate all solving logic to the pathfinder service ──────────
        result: dict = find_shortest_path(
            maze=request.maze,
            start=start,
            goal=goal,
        )

        # ── Wrap raw dict in the typed response model ─────────────────────
        return MazeSolveResponse(**result)

    except ValueError as exc:
        # Raised by _validate_coordinates() for bad start/goal positions
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while solving the maze.",
        ) from exc