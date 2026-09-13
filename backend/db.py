"""
db.py — Exasol Personal connection helper for GroundCheck / AuditLens.

All backend scripts (ingest_kb.py, verifier.py, dashboard.py) import get_connection()
from here so there's exactly one place that knows how to talk to Exasol.
"""

import os
from typing import Optional
from dotenv import load_dotenv
import pyexasol

load_dotenv()


def get_connection(schema_override=None):
    """Open a connection to Exasol Personal using settings from .env."""
    host = os.getenv("EXASOL_HOST", "localhost")
    port = os.getenv("EXASOL_PORT", "8563")
    user = os.getenv("EXASOL_USER", "sys")
    password = os.getenv("EXASOL_PASSWORD", "exasol")
    schema = schema_override if schema_override is not None else os.getenv("EXASOL_SCHEMA", "GROUNDCHECK")
    encryption = os.getenv("EXASOL_ENCRYPTION", "false").lower() == "true"

    conn = pyexasol.connect(
        dsn=f"{host}:{port}",
        user=user,
        password=password,
        schema=schema,
        encryption=encryption,
    )
    return conn


def run_schema(sql_path: Optional[str] = None):
    """Apply schema.sql against the connected Exasol instance. Safe to re-run (uses IF NOT EXISTS)."""
    if sql_path is None:
        # Dynamically locate schema.sql relative to db.py's location
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        sql_path = os.path.join(base_dir, "sql", "schema.sql")

    conn = get_connection(schema_override="")
    with open(sql_path, "r", encoding="utf-8") as f:
        script = f.read()

    # Split on ';' and strip individual comment lines without dropping the statement
    statements = script.split(";")
    for statement in statements:
        cleaned = "\n".join(
            line for line in statement.splitlines() if not line.strip().startswith("--")
        ).strip()
        if cleaned:
            conn.execute(cleaned)

    conn.close()
    print(f"Schema applied successfully from {sql_path}")


if __name__ == "__main__":
    run_schema()
