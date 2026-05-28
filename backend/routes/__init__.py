"""Modular FastAPI routes for The Collective Savers backend.

Each module exposes `router` (an APIRouter) which `server.py` includes onto
the main `api_router`. Modules import shared state (db, logger, manager,
auth deps) from `backend.core`.
"""
