# =============================================================================
# services/pathfinder.py — Shortest path via Breadth-First Search (BFS)
# =============================================================================

# deque: O(1) append and popleft — essential for an efficient BFS queue.
# Using a plain list would make popleft() O(n), degrading BFS to O(n²).
from collections import deque


# =============================================================================
# CONSTANTS
# =============================================================================

WALL: int = 1   # Impassable cell
PATH: int = 0   # Walkable cell

# Cardinal movement directions: UP, DOWN, LEFT, RIGHT
# Stored as (delta_row, delta_col) pairs
DIRECTIONS: list[tuple[int, int]] = [(-1, 0), (1, 0), (0, -1), (0, 1)]


# =============================================================================
# INTERNAL HELPERS
# =============================================================================

def _is_valid_cell(
    row: int,
    col: int,
    maze: list[list[int]],
) -> bool:
    """
    Check whether (row, col) is inside the maze boundaries and walkable.

    A cell is valid when ALL of the following hold:
        1. row is within [0, num_rows)
        2. col is within [0, num_cols)
        3. the cell value is PATH (0), not WALL (1)

    Args:
        row  : Row index to test.
        col  : Column index to test.
        maze : 2-D grid used for boundary and wall checks.

    Returns:
        True if the cell can be stepped on, False otherwise.
    """
    num_rows: int = len(maze)
    num_cols: int = len(maze[0]) if num_rows > 0 else 0

    in_bounds: bool = 0 <= row < num_rows and 0 <= col < num_cols
    if not in_bounds:
        return False

    return maze[row][col] == PATH


def _validate_coordinates(
    maze: list[list[int]],
    start: tuple[int, int],
    goal: tuple[int, int],
) -> None:
    """
    Raise ValueError for any coordinate that is out-of-bounds or on a wall.

    Called once at the top of find_shortest_path() before BFS begins,
    so invalid inputs surface immediately with a descriptive message rather
    than causing silent incorrect results.

    Args:
        maze  : 2-D grid.
        start : (row, col) of the player's starting position.
        goal  : (row, col) of the target position.

    Raises:
        ValueError: If start or goal falls outside the maze or on a wall.
    """
    num_rows: int = len(maze)
    num_cols: int = len(maze[0]) if num_rows > 0 else 0

    for label, (row, col) in [("start", start), ("goal", goal)]:
        if not (0 <= row < num_rows and 0 <= col < num_cols):
            raise ValueError(
                f"'{label}' coordinate ({row}, {col}) is outside the maze "
                f"(grid is {num_rows}×{num_cols})."
            )
        if maze[row][col] == WALL:
            raise ValueError(
                f"'{label}' coordinate ({row}, {col}) is a wall cell. "
                "Both start and goal must be walkable (PATH) cells."
            )


def _reconstruct_path(
    parent: dict[tuple[int, int], tuple[int, int] | None],
    start: tuple[int, int],
    goal: tuple[int, int],
) -> list[list[int]]:
    """
    Walk the parent map backwards from goal → start to reconstruct the path.

    How parent tracking works
    -------------------------
    During BFS, every time we visit a new cell N from cell P, we record:
        parent[N] = P

    This creates a chain of "who discovered whom":
        goal ← cell_k ← … ← cell_1 ← start

    To reconstruct, we follow parent pointers from the goal back to the
    start (which has parent = None), then reverse the list so it reads
    start → … → goal.

    Args:
        parent : Dict mapping each visited cell to the cell it was reached from.
                 The start cell maps to None (it has no predecessor).
        start  : Origin cell — used as the termination condition.
        goal   : Destination cell — reconstruction begins here.

    Returns:
        Ordered list of [row, col] pairs from start to goal (inclusive).
    """
    path: list[list[int]] = []
    current: tuple[int, int] | None = goal

    # Trace backwards until we reach the start (whose parent is None)
    while current is not None:
        path.append(list(current))      # convert tuple → list for JSON
        current = parent.get(current)   # move to the cell that discovered us

    # The path was built goal → start; reverse it to get start → goal
    path.reverse()
    return path


# =============================================================================
# PUBLIC API
# =============================================================================

def find_shortest_path(
    maze: list[list[int]],
    start: tuple[int, int],
    goal: tuple[int, int],
) -> dict:
    """
    Find the shortest path between two cells in a maze using BFS.

    Why BFS guarantees the shortest path
    -------------------------------------
    BFS explores cells in order of increasing distance from the start.
    It processes all cells at distance 1 before any at distance 2, all at
    distance 2 before any at distance 3, and so on.

    The moment BFS first reaches the goal it has done so via the fewest
    possible steps — any other route would have been found at an earlier
    or equal expansion round, never later.

        Distance 0: [start]
        Distance 1: [all neighbours of start]
        Distance 2: [all unvisited neighbours of distance-1 cells]
        …
        Distance k: [goal] ← shortest path has length k

    Queue mechanics
    ---------------
    We use a deque as a FIFO queue:
        - enqueue (right end)  : deque.append(cell)
        - dequeue (left end)   : deque.popleft()

    Both operations are O(1), keeping the overall BFS complexity O(V + E)
    where V = number of cells and E = number of valid moves.

    Parent tracking
    ---------------
    A `parent` dict records how each cell was first reached.
    When we dequeue cell P and visit neighbour N for the first time:
        parent[N] = P
    After BFS terminates (goal found or queue empty) we call
    _reconstruct_path() which follows parent pointers goal → start,
    then reverses the result.

    Args:
        maze  : 2-D grid; 0 = walkable path, 1 = wall.
        start : (row, col) of the player's current position.
        goal  : (row, col) of the target cell.

    Returns:
        {
            "path":        [[row, col], …],   # ordered start → goal
            "path_length": int                 # steps = len(path) - 1
                                               # -1 if no path exists
        }

    Raises:
        ValueError: If start or goal is out-of-bounds or on a wall.
    """

    # ── Edge case: already at the goal ────────────────────────────────────
    if start == goal:
        return {"path": [list(start)], "path_length": 0}

    # ── Validate inputs before touching the BFS structures ────────────────
    _validate_coordinates(maze, start, goal)

    # ── BFS initialisation ────────────────────────────────────────────────

    # Queue holds cells yet to be explored.
    # Seeded with the start cell — BFS expands outward from here.
    queue: deque[tuple[int, int]] = deque()
    queue.append(start)

    # parent maps every visited cell → the cell it was discovered from.
    # start has no predecessor, so its value is None.
    # Doubling as a visited set: a cell is "visited" the moment it enters
    # the queue, preventing duplicate processing and infinite loops.
    parent: dict[tuple[int, int], tuple[int, int] | None] = {start: None}

    # ── BFS main loop ─────────────────────────────────────────────────────
    while queue:
        current: tuple[int, int] = queue.popleft()   # O(1) FIFO dequeue
        current_row, current_col = current

        # Explore all four cardinal neighbours
        for delta_row, delta_col in DIRECTIONS:
            neighbour_row: int = current_row + delta_row
            neighbour_col: int = current_col + delta_col
            neighbour: tuple[int, int] = (neighbour_row, neighbour_col)

            # Skip walls, out-of-bounds cells, and already-visited cells
            if not _is_valid_cell(neighbour_row, neighbour_col, maze):
                continue
            if neighbour in parent:         # already queued / visited
                continue

            # ── Record discovery: neighbour was reached from current ───────
            parent[neighbour] = current

            # ── Goal reached — reconstruct and return immediately ──────────
            # BFS guarantees this is the shortest path.
            if neighbour == goal:
                path: list[list[int]] = _reconstruct_path(parent, start, goal)
                return {
                    "path": path,
                    "path_length": len(path) - 1,   # steps = nodes - 1
                }

            # Otherwise, enqueue the neighbour for future exploration
            queue.append(neighbour)

    # ── Queue exhausted without reaching the goal ─────────────────────────
    # The goal is unreachable from start (disconnected maze region).
    return {"path": [], "path_length": -1}

