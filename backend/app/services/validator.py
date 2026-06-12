# =============================================================================
# services/validator.py — Structural and connectivity validation for mazes
# =============================================================================

# deque: O(1) append and popleft — used for BFS connectivity check,
# same reason as in pathfinder.py (plain list popleft is O(n))
from collections import deque


# =============================================================================
# CONSTANTS
# =============================================================================

WALL: int = 1   # Impassable cell
PATH: int = 0   # Walkable cell

# Cardinal directions: UP, DOWN, LEFT, RIGHT as (delta_row, delta_col)
DIRECTIONS: list[tuple[int, int]] = [(-1, 0), (1, 0), (0, -1), (0, 1)]


# =============================================================================
# 1. STRUCTURAL VALIDATION
# =============================================================================

def validate_maze_structure(maze: list[list[int]]) -> None:
    """
    Verify the maze grid is well-formed before any game logic runs on it.

    Checks (in order):
        1. The maze is not None or empty.
        2. Every row exists and has the same number of columns.
        3. Every cell value is exactly 0 (PATH) or 1 (WALL).

    Why validate structure first?
    All downstream functions (pathfinding, position checks, connectivity)
    assume a rectangular grid of binary values. Catching malformed input
    here produces a clear, specific error instead of a cryptic IndexError
    or incorrect result buried in BFS.

    Args:
        maze: 2-D list representing the maze grid.

    Raises:
        ValueError: Describes exactly which structural rule was violated.
    """

    # ── Check 1: maze must exist and contain at least one row ─────────────
    if not maze or not isinstance(maze, list):
        raise ValueError(
            "Maze must be a non-empty 2-D list. "
            f"Received: {type(maze).__name__}."
        )

    num_rows: int = len(maze)

    # ── Check 2a: every row must itself be a list ─────────────────────────
    for row_idx, row in enumerate(maze):
        if not isinstance(row, list):
            raise ValueError(
                f"Row {row_idx} is not a list (got {type(row).__name__}). "
                "Each row must be a list of integers."
            )

    # ── Check 2b: maze must have at least one column ──────────────────────
    num_cols: int = len(maze[0])
    if num_cols == 0:
        raise ValueError(
            "Maze rows must not be empty. "
            f"Row 0 has 0 columns."
        )

    # ── Check 2c: all rows must have the same length (rectangular grid) ───
    for row_idx, row in enumerate(maze):
        if len(row) != num_cols:
            raise ValueError(
                f"Row {row_idx} has {len(row)} column(s) but row 0 has "
                f"{num_cols}. All rows must have equal length."
            )

    # ── Check 3: every cell must be 0 or 1 ───────────────────────────────
    valid_values: frozenset[int] = frozenset({PATH, WALL})

    for row_idx, row in enumerate(maze):
        for col_idx, cell in enumerate(row):
            if cell not in valid_values:
                raise ValueError(
                    f"Invalid cell value '{cell}' at position "
                    f"({row_idx}, {col_idx}). "
                    "All cells must be 0 (PATH) or 1 (WALL)."
                )


# =============================================================================
# 2. POSITION VALIDATION
# =============================================================================

def validate_position(
    maze: list[list[int]],
    position: list[int] | tuple[int, int],
    label: str = "position",
) -> None:
    """
    Confirm a single [row, col] coordinate is within the maze and walkable.

    Called for both `start` and `goal` positions before any pathfinding
    or game logic runs. The `label` argument lets callers produce messages
    like "'start' is a wall" instead of the generic "'position' is a wall".

    Args:
        maze     : 2-D grid (assumed structurally valid).
        position : [row, col] or (row, col) coordinate to check.
        label    : Human-readable name for the position in error messages.
                   Defaults to "position"; pass "start" or "goal" for
                   clearer errors.

    Raises:
        ValueError: If the position is out of bounds or on a WALL cell.
    """
    num_rows: int = len(maze)
    num_cols: int = len(maze[0])

    row, col = position[0], position[1]

    # ── Bounds check ──────────────────────────────────────────────────────
    if not (0 <= row < num_rows and 0 <= col < num_cols):
        raise ValueError(
            f"'{label}' coordinate ({row}, {col}) is outside the maze "
            f"boundaries (grid is {num_rows}×{num_cols}). "
            f"Valid range: row 0–{num_rows - 1}, col 0–{num_cols - 1}."
        )

    # ── Walkability check ─────────────────────────────────────────────────
    if maze[row][col] == WALL:
        raise ValueError(
            f"'{label}' coordinate ({row}, {col}) is a WALL cell (value=1). "
            "Both start and goal must be placed on PATH cells (value=0)."
        )


# =============================================================================
# 3. CONNECTIVITY VALIDATION
# =============================================================================

def validate_connectivity(
    maze: list[list[int]],
    start: list[int] | tuple[int, int],
    goal: list[int] | tuple[int, int],
) -> None:
    """
    Confirm that `goal` is reachable from `start` using BFS.

    Why BFS (not DFS)?
    BFS is level-order: it visits nearby cells before distant ones.
    For a pure reachability check (not shortest path) either algorithm
    works, but BFS tends to find the goal faster when it is close to the
    start — the common case during maze validation.

    How the BFS works here
    ----------------------
    Unlike pathfinder.py, we do NOT track parents because we only need
    a yes/no reachability answer, not the actual path. This keeps memory
    usage lower — we store only the visited set, not a full parent map.

        queue  : cells discovered but not yet expanded
        visited: cells already added to the queue (prevents revisits)

    If the queue empties before the goal is dequeued, the goal is
    unreachable from start.

    Args:
        maze  : 2-D grid (assumed structurally valid).
        start : [row, col] origin cell.
        goal  : [row, col] target cell.

    Raises:
        ValueError: If goal is not reachable from start.
    """
    start_tuple: tuple[int, int] = (start[0], start[1])
    goal_tuple:  tuple[int, int] = (goal[0],  goal[1])

    # ── Trivial case: start and goal are the same cell ────────────────────
    if start_tuple == goal_tuple:
        return  # Always reachable

    num_rows: int = len(maze)
    num_cols: int = len(maze[0])

    # ── BFS initialisation ────────────────────────────────────────────────
    queue: deque[tuple[int, int]] = deque()
    queue.append(start_tuple)

    # visited doubles as the "already enqueued" guard to prevent
    # processing the same cell twice and looping infinitely
    visited: set[tuple[int, int]] = {start_tuple}

    # ── BFS expansion ─────────────────────────────────────────────────────
    while queue:
        current_row, current_col = queue.popleft()

        for delta_row, delta_col in DIRECTIONS:
            neighbour_row: int = current_row + delta_row
            neighbour_col: int = current_col + delta_col
            neighbour: tuple[int, int] = (neighbour_row, neighbour_col)

            # ── Skip out-of-bounds neighbours ─────────────────────────────
            if not (0 <= neighbour_row < num_rows and
                    0 <= neighbour_col < num_cols):
                continue

            # ── Skip walls ────────────────────────────────────────────────
            if maze[neighbour_row][neighbour_col] == WALL:
                continue

            # ── Skip already-visited cells ────────────────────────────────
            if neighbour in visited:
                continue

            # ── Goal found — maze is connected ────────────────────────────
            if neighbour == goal_tuple:
                return  # Reachable: validation passes

            visited.add(neighbour)
            queue.append(neighbour)

    # ── Queue exhausted — goal was never reached ──────────────────────────
    raise ValueError(
        f"Maze is not solvable: goal {list(goal_tuple)} is unreachable "
        f"from start {list(start_tuple)}. "
        "The maze may contain disconnected regions."
    )


# =============================================================================
# 4. COMPOSITE VALIDATOR
# =============================================================================

def validate_generated_maze(
    maze: list[list[int]],
    start: list[int] | tuple[int, int],
    goal: list[int] | tuple[int, int],
) -> None:
    """
    Run all validation checks against a freshly generated maze.

    Execution order
    ---------------
    1. validate_maze_structure  — grid is rectangular and binary.
    2. validate_position(start) — start is in-bounds and walkable.
    3. validate_position(goal)  — goal is in-bounds and walkable.
    4. validate_connectivity    — goal is BFS-reachable from start.

    Order matters: structural validity must be confirmed before positions
    are checked (to avoid IndexErrors), and both positions must be valid
    before connectivity BFS runs (to avoid starting BFS on a wall).

    Intended usage in generator.py or routes/maze.py:
```python
    from app.services.validator import validate_generated_maze
    validate_generated_maze(maze, start, center)
```

    Args:
        maze  : 2-D grid returned by the generator.
        start : [row, col] player spawn point.
        goal  : [row, col] target / exit cell (usually the center).

    Raises:
        ValueError: With a descriptive message for the first check that fails.
    """

    # ── Step 1: grid must be well-formed ──────────────────────────────────
    validate_maze_structure(maze)

    # ── Step 2: start must be in-bounds and on a PATH cell ────────────────
    validate_position(maze, start, label="start")

    # ── Step 3: goal must be in-bounds and on a PATH cell ─────────────────
    validate_position(maze, goal, label="goal")

    # ── Step 4: goal must be BFS-reachable from start ─────────────────────
    validate_connectivity(maze, start, goal)