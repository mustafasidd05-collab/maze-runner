# =============================================================================
# models/maze.py — Pydantic schemas for Maze Runner API request/response models
# =============================================================================

# BaseModel: base class for all Pydantic models (handles validation + serialization)
from pydantic import BaseModel, Field, model_validator

# Any extra typing utilities we need
from typing import Self


# =============================================================================
# REQUEST MODELS
# These define what the API expects to receive from the frontend.
# =============================================================================

class MazeGenerateRequest(BaseModel):
    """
    Request body for POST /maze/generate.

    The frontend sends a seed (for reproducibility) and a size (grid dimensions).
    Both fields are validated before the generator ever runs.
    """

    seed: int = Field(
        ...,
        description="Random seed for reproducible maze generation. "
                    "The same seed + size always produces the same maze.",
        examples=[42],
    )

    size: int = Field(
        ...,
        description="Width and height of the square maze grid. "
                    "Must be an odd number and at least 11 "
                    "(e.g. 11, 13, 15 …). "
                    "Odd sizes ensure walls and paths align correctly.",
        ge=11,          # Pydantic v2: 'ge' = greater-than-or-equal (replaces Field(min=…))
        examples=[11, 15, 21],
    )

    # -------------------------------------------------------------------------
    # model_validator runs after all individual field validators have passed.
    # mode="after" means 'self' is already a fully constructed model instance,
    # so we can read self.size safely.
    # -------------------------------------------------------------------------
    @model_validator(mode="after")
    def size_must_be_odd(self) -> Self:
        """
        Enforce that 'size' is an odd integer.

        Maze generation algorithms (recursive backtracking, Prim's, etc.)
        require odd dimensions so that every cell sits on an odd coordinate
        and every wall sits on an even coordinate.
        """
        if self.size % 2 == 0:
            raise ValueError(
                f"'size' must be an odd number (received {self.size}). "
                "Try the next odd value: "
                f"{self.size + 1}."
            )
        return self


# =============================================================================

class MazeSolveRequest(BaseModel):
    """
    Request body for POST /maze/solve.

    The frontend sends the raw maze grid plus a start cell and goal cell.
    The pathfinder service returns the shortest path between them.
    """

    maze: list[list[int]] = Field(
        ...,
        description="2-D grid representing the maze. "
                    "0 = open path, 1 = wall.",
    )

    start: list[int] = Field(
        ...,
        description="[row, col] coordinates of the player's starting position.",
        min_length=2,   # must contain exactly two elements
        max_length=2,
        examples=[[0, 1]],
    )

    goal: list[int] = Field(
        ...,
        description="[row, col] coordinates of the target/exit cell.",
        min_length=2,
        max_length=2,
        examples=[[10, 9]],
    )


# =============================================================================
# RESPONSE MODELS
# These define exactly what the API sends back to the frontend.
# Pydantic serialises the data and strips any extra fields automatically.
# =============================================================================

class MazeGenerateResponse(BaseModel):
    """
    Response body returned by POST /maze/generate.

    Contains the full maze grid plus key coordinates so the frontend
    knows where to place the player and mark the objective.
    """

    seed: int = Field(
        ...,
        description="The seed that was used to generate this maze. "
                    "Store it on the frontend to allow 'replay same maze'.",
    )

    size: int = Field(
        ...,
        description="Width (and height) of the returned square grid.",
    )

    start: list[int] = Field(
        ...,
        description="[row, col] of the player's spawn point. "
                    "Always an open cell adjacent to the outer wall.",
    )

    center: list[int] = Field(
        ...,
        description="[row, col] of the maze's centre cell — "
                    "this is the goal / exit the player must reach.",
    )

    maze: list[list[int]] = Field(
        ...,
        description="Full 2-D grid. 0 = walkable path, 1 = wall. "
                    "Indexed as maze[row][col].",
    )


# =============================================================================

class MazeSolveResponse(BaseModel):
    """
    Response body returned by POST /maze/solve.

    Contains the optimal path from start to goal as an ordered list
    of [row, col] coordinates, plus a convenience length field.
    """

    path: list[list[int]] = Field(
        ...,
        description="Ordered list of [row, col] waypoints from start to goal "
                    "(inclusive of both endpoints). "
                    "Empty list if no path exists.",
    )

    path_length: int = Field(
        ...,
        description="Number of steps in the path (len(path) - 1). "
                    "0 if start == goal, -1 if no path was found.",
        ge=-1,
    )