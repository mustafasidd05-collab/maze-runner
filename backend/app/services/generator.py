# =============================================================================
# services/generator.py — Deterministic maze generation via Recursive Backtracking
# =============================================================================

# random: used for seeded, reproducible random choices during carving
import random

# deque: efficient double-ended queue used for iterative DFS stack
from collections import deque


# =============================================================================
# CONSTANTS
# =============================================================================

WALL: int = 1   # A cell that cannot be walked through
PATH: int = 0   # A cell the player can occupy / move through


# =============================================================================
# INTERNAL HELPERS
# =============================================================================

def _build_wall_grid(size: int) -> list[list[int]]:
    """
    Create a (size x size) grid where every cell starts as a WALL.

    The carving algorithm will then punch holes (PATH cells) into this
    solid block to create corridors.

    Args:
        size: Odd integer — width and height of the grid.

    Returns:
        2-D list filled entirely with WALL (1).
    """
    return [[WALL] * size for _ in range(size)]


def _get_unvisited_neighbours(
    row: int,
    col: int,
    size: int,
    visited: list[list[bool]],
) -> list[tuple[int, int]]:
    """
    Return all valid, unvisited neighbours that are exactly 2 steps away.

    Why 2 steps?
    In a grid where walls sit on even coordinates and paths on odd ones,
    moving 2 cells at a time keeps us landing on valid path cells.
    The cell in-between the current cell and the neighbour becomes the
    corridor wall we carve through.

        [current] → [wall-between] → [neighbour]
           (r,c)       (r±1, c±1)     (r±2, c±2)

    Args:
        row, col : Current cell position.
        size     : Grid dimension (boundary check).
        visited  : 2-D boolean grid tracking which cells have been carved.

    Returns:
        List of (row, col) tuples for reachable unvisited neighbours.
    """
    neighbours: list[tuple[int, int]] = []

    # Check all four cardinal directions: UP, DOWN, LEFT, RIGHT
    for dr, dc in [(-2, 0), (2, 0), (0, -2), (0, 2)]:
        nr, nc = row + dr, col + dc

        # Stay inside the grid (leaving a 1-cell outer wall border)
        if 1 <= nr < size - 1 and 1 <= nc < size - 1:
            if not visited[nr][nc]:
                neighbours.append((nr, nc))

    return neighbours


def _carve_passages(
    maze: list[list[int]],
    visited: list[list[bool]],
    start_row: int,
    start_col: int,
    size: int,
) -> None:
    """
    Iterative Recursive Backtracking (Depth-First Search) maze carver.

    Algorithm overview
    ------------------
    1. Push the starting cell onto a stack and mark it visited + PATH.
    2. While the stack is not empty:
       a. Peek at the top cell.
       b. Collect its unvisited neighbours (2 steps away).
       c. If neighbours exist:
            - Pick one at random.
            - Carve through the wall between current and chosen neighbour
              (set the intermediate cell to PATH).
            - Mark the neighbour as visited + PATH.
            - Push the neighbour onto the stack.
       d. If no unvisited neighbours remain → backtrack (pop the stack).

    This guarantees a perfect maze (exactly one path between any two cells)
    with no isolated sections.

    We use an explicit stack (deque) instead of Python recursion to avoid
    hitting Python's default recursion limit (~1000) on large mazes.

    Args:
        maze       : Mutable 2-D grid (modified in-place).
        visited    : Mutable 2-D boolean grid (modified in-place).
        start_row  : Row of the first cell to carve from.
        start_col  : Col of the first cell to carve from.
        size       : Grid dimension.
    """
    stack: deque[tuple[int, int]] = deque()

    # ── Initialise: mark the starting cell as a PATH and push it ──────────
    maze[start_row][start_col] = PATH
    visited[start_row][start_col] = True
    stack.append((start_row, start_col))

    # ── Main DFS loop ──────────────────────────────────────────────────────
    while stack:
        current_row, current_col = stack[-1]   # peek (do not pop yet)

        neighbours = _get_unvisited_neighbours(
            current_row, current_col, size, visited
        )

        if neighbours:
            # ── Choose a random unvisited neighbour ────────────────────────
            chosen_row, chosen_col = random.choice(neighbours)

            # ── Carve the wall between current cell and chosen neighbour ───
            # The wall sits exactly halfway between them.
            wall_row = (current_row + chosen_row) // 2
            wall_col = (current_col + chosen_col) // 2
            maze[wall_row][wall_col] = PATH

            # ── Mark the neighbour as visited and open it as a PATH ────────
            maze[chosen_row][chosen_col] = PATH
            visited[chosen_row][chosen_col] = True

            stack.append((chosen_row, chosen_col))
        else:
            # ── Dead end reached — backtrack ───────────────────────────────
            stack.pop()


def _find_start_position(maze: list[list[int]], size: int) -> list[int]:
    """
    Find a PATH cell on the top border row (row 1) to use as the player spawn.

    We scan row 1 (first inner row) left-to-right and return the first open
    cell. Because Recursive Backtracking always produces a connected maze,
    this cell is guaranteed to be reachable from every other PATH cell,
    including the center.

    Args:
        maze : Completed maze grid.
        size : Grid dimension.

    Returns:
        [row, col] of the start position.
    """
    for col in range(1, size - 1):
        if maze[1][col] == PATH:
            return [1, col]

    # Fallback: scan every border cell (should never be needed for a valid maze)
    for col in range(1, size - 1):
        if maze[size - 2][col] == PATH:
            return [size - 2, col]

    # Absolute last resort — guaranteed open cell
    return [1, 1]


def _get_center(size: int) -> list[int]:
    """
    Return the [row, col] of the exact centre cell.

    Because size is always odd, integer division gives the true centre.
    e.g. size=11 → centre = [5, 5]

    Args:
        size: Odd grid dimension.

    Returns:
        [row, col] of the centre.
    """
    mid: int = size // 2
    return [mid, mid]


def _ensure_center_is_open(maze: list[list[int]], size: int) -> None:
    """
    Guarantee the centre cell is a PATH so the goal is always reachable.

    The DFS carver *usually* opens the centre, but for very small grids or
    unusual seeds it might remain a WALL. This function forces it open and
    also opens its immediate neighbours so it connects to the existing
    corridor network.

    Args:
        maze : Mutable 2-D grid (modified in-place).
        size : Grid dimension.
    """
    mid: int = size // 2
    maze[mid][mid] = PATH

    # Open orthogonal neighbours to guarantee connectivity
    for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
        nr, nc = mid + dr, mid + dc
        if 1 <= nr < size - 1 and 1 <= nc < size - 1:
            maze[nr][nc] = PATH


# =============================================================================
# PUBLIC API
# =============================================================================

def generate_maze(seed: int, size: int) -> dict:
    """
    Generate a deterministic, fully-connected maze using Recursive Backtracking.

    Guarantees
    ----------
    * Deterministic  : Same (seed, size) pair always produces identical output.
    * Perfect maze   : Exactly one path exists between any two cells —
                       no loops, no isolated sections.
    * Outer walls    : The entire perimeter remains WALL.
    * Valid start    : Spawn point is on the top inner row, always a PATH cell.
    * Valid goal     : Center cell is always forced open as a PATH cell.
    * Solvable       : A valid path from start → center is guaranteed by the
                       perfect-maze property.

    Args:
        seed : Integer seed for Python's random module.
               Identical seeds reproduce identical mazes.
        size : Odd integer ≥ 11 — width and height of the square grid.

    Returns:
        dict with keys:
            "seed"   (int)            — echo of the input seed
            "size"   (int)            — echo of the input size
            "maze"   (list[list[int]])— 2-D grid; 0 = path, 1 = wall
            "start"  (list[int])      — [row, col] player spawn
            "center" (list[int])      — [row, col] goal / exit

    Raises:
        ValueError: If size is even or less than 11.
    """

    # ── Input validation ───────────────────────────────────────────────────
    if size < 11:
        raise ValueError(f"size must be at least 11, got {size}.")
    if size % 2 == 0:
        raise ValueError(f"size must be odd, got {size}.")

    # ── Seed the RNG — this is what makes the maze deterministic ──────────
    # All random.choice() calls in _carve_passages use this seeded state.
    random.seed(seed)

    # ── Build the initial all-wall grid ───────────────────────────────────
    maze: list[list[int]] = _build_wall_grid(size)

    # ── Visited tracker (separate from the maze for clarity) ──────────────
    visited: list[list[bool]] = [[False] * size for _ in range(size)]

    # ── Run the DFS carver starting from cell (1, 1) ──────────────────────
    # (1, 1) is the first valid inner cell (top-left, just inside the border)
    _carve_passages(maze, visited, start_row=1, start_col=1, size=size)

    # ── Guarantee the goal cell (center) is open ──────────────────────────
    _ensure_center_is_open(maze, size)

    # ── Determine start and goal positions ────────────────────────────────
    start: list[int]  = _find_start_position(maze, size)
    center: list[int] = _get_center(size)

    return {
        "seed":   seed,
        "size":   size,
        "maze":   maze,
        "start":  start,
        "center": center,
    }
    