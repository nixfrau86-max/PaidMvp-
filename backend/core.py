"""Shared singletons + dependencies used by both server.py and route modules.

Importing this module is safe from any route file — it doesn't import from
server.py and therefore can't introduce circular imports.
"""
import logging
import os

from motor.motor_asyncio import AsyncIOMotorClient

logger = logging.getLogger("collective-savers")

# Mongo connection — keys are guaranteed to exist (see backend/.env).
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]
