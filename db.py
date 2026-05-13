"""
db.py — PostgreSQL connection pool + safe query helpers
"""
import os
import pandas as pd
import psycopg2
from psycopg2 import pool as pg_pool
from dotenv import load_dotenv

load_dotenv()

_pool: pg_pool.ThreadedConnectionPool | None = None


def _get_pool() -> pg_pool.ThreadedConnectionPool:
    global _pool
    if _pool is None or _pool.closed:
        _pool = pg_pool.ThreadedConnectionPool(
            minconn=int(os.getenv("DB_POOL_MIN", 2)),
            maxconn=int(os.getenv("DB_POOL_MAX", 10)),
            host=os.getenv("DB_HOST", "localhost"),
            port=int(os.getenv("DB_PORT", 5432)),
            database=os.getenv("DB_NAME", "dvdrental"),
            user=os.getenv("DB_USER", "postgres"),
            password=os.getenv("DB_PASSWORD", "123"),
            connect_timeout=5,
        )
    return _pool


def qry(sql: str, params=None) -> pd.DataFrame:
    """Execute a SQL query and return a DataFrame."""
    p = _get_pool()
    conn = p.getconn()
    try:
        df = pd.read_sql(sql, conn, params=params)
        return df
    finally:
        p.putconn(conn)


def reinit_pool(**kwargs):
    """Reinitialise the pool with new credentials (called from settings UI)."""
    global _pool
    if _pool and not _pool.closed:
        _pool.closeall()
    _pool = None
    for k, v in kwargs.items():
        os.environ[k.upper()] = str(v)
    _get_pool()   # eagerly open to validate credentials


def get_config() -> dict:
    return {
        "host": os.getenv("DB_HOST"),
        "port": os.getenv("DB_PORT"),
        "database": os.getenv("DB_NAME"),
        "user": os.getenv("DB_USER"),
    }


# ── filter helpers ──────────────────────────────────────────
def store_clause(sf, alias: str = "i") -> str:
    return f"AND {alias}.store_id = {int(sf)}" if sf not in ("All", "") else ""


def month_clause(mf, alias: str = "r") -> str:
    return (
        f"AND TO_CHAR({alias}.rental_date, 'YYYY-MM') = '{mf}'"
        if mf not in ("All", "")
        else ""
    )
