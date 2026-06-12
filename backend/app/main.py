# =============================================================================
# main.py — Entry point for the Maze Runner Game Backend API
# =============================================================================

# FastAPI: the core web framework for building the API
from fastapi import FastAPI

# CORSMiddleware: allows the frontend (Next.js on port 3000) to talk to this backend
from fastapi.middleware.cors import CORSMiddleware

# JSONResponse: lets us return explicit JSON responses with custom status codes
from fastapi.responses import JSONResponse

# =============================================================================
# APP INSTANCE
# =============================================================================

app = FastAPI(
    title="Maze Runner API",
    description=(
        "Backend API for the Maze Runner game. "
        "Handles maze generation, pathfinding, move validation, and game state."
    ),
    version="1.0.0",
    docs_url="/docs",       # Swagger UI available at /docs
    redoc_url="/redoc",     # ReDoc UI available at /redoc
)

# =============================================================================
# CORS CONFIGURATION
# Allows the Next.js frontend running on localhost:3000 to make API requests.
# In production, replace "*" origins with your actual deployed frontend URL.
# =============================================================================

origins: list[str] = [
    "http://localhost:3000",      # Next.js dev server
    "http://127.0.0.1:3000",      # Alternative localhost notation
    # "https://your-production-domain.com",  # Add your production URL here
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,        # Which origins are permitted
    allow_credentials=True,       # Allow cookies / auth headers
    allow_methods=["*"],          # Allow all HTTP methods (GET, POST, etc.)
    allow_headers=["*"],          # Allow all headers
)

# =============================================================================
# ROUTER REGISTRATION
# As the project grows, routers from app/routes/ are registered here.
# Each router groups related endpoints (e.g. all maze-related routes).
# =============================================================================

from app.routes.maze import router as maze_router

app.include_router(maze_router)

# Example of how additional routers would be added:
# from app.routes.player import router as player_router
# app.include_router(player_router, prefix="/api/v1/player", tags=["Player"])

# =============================================================================
# STARTUP / SHUTDOWN EVENTS
# Use these lifecycle hooks for DB connections, cache warm-up, etc.
# =============================================================================

@app.on_event("startup")
async def on_startup() -> None:
    """Runs once when the server starts. Use for DB init, loading configs, etc."""
    print("🚀 Maze Runner API is starting up...")


@app.on_event("shutdown")
async def on_shutdown() -> None:
    """Runs once when the server shuts down. Use for cleanup tasks."""
    print("🛑 Maze Runner API is shutting down...")


# =============================================================================
# ROOT ENDPOINT
# A simple health-check / welcome endpoint to confirm the API is live.
# =============================================================================

@app.get("/", response_class=JSONResponse, tags=["Health"])
async def root() -> dict:
    """
    Root endpoint.

    Returns a basic status response confirming the API is running.
    Useful as a health-check for deployment platforms (Railway, Render, etc.).
    """
    return {
        "message": "Welcome to the Maze Runner API 🎮",
        "api_status": "online",
        "version": "1.0.0",
    }


# =============================================================================
# HEALTH CHECK ENDPOINT
# Dedicated /health route — useful for container orchestration (Docker, K8s).
# =============================================================================

@app.get("/health", response_class=JSONResponse, tags=["Health"])
async def health_check() -> dict:
    """
    Health check endpoint.

    Returns the operational status of the API.
    Can be extended to include DB connectivity, cache status, etc.
    """
    return {
        "status": "healthy",
        "api": "Maze Runner API",
        "version": "1.0.0",
    }