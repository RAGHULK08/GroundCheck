# Deployment & Run Guide

This guide takes you from a clean machine to a running dashboard against **Exasol Personal**.

## Prerequisites

- **Docker Desktop** — must be running before you install or start Exasol Personal.
- **Python 3.11+**
- **PowerShell** (Windows) or a POSIX shell (macOS/Linux)

## 1. Install Exasol Personal

If you haven't already:

**Windows (PowerShell):**
```powershell
irm https://www.exasol.com/install/starter-kit.ps1 | iex
```

**macOS/Linux:** see the equivalent one-line installer at https://www.exasol.com/developers/

This installs four components: the Exasol database itself, `exapump`, an MCP server, and `pyexasol`. It's managed afterward through the `exakit` CLI.

## 2. Start Exasol and get your connection details

```bash
exakit status     # confirms Docker/the database container is running
exakit start      # if it isn't already running
exakit info       # prints host, port, user, and password
```

Keep this terminal output handy — you'll need it for `.env` in the next step. Don't assume default credentials; `exakit info` is the source of truth for your machine.

## 3. Clone the repo and set up Python

```bash
git clone <your-repo-url>
cd groundcheck
pip install -r requirements.txt
```

## 4. Configure environment variables

Copy the example file and edit it with the values from `exakit info`:

```bash
cp .env.example .env
```

```
EXASOL_HOST=127.0.0.1
EXASOL_PORT=8563
EXASOL_USER=<from exakit info>
EXASOL_PASSWORD=<from exakit info>
EXASOL_SCHEMA=GROUNDCHECK
EXASOL_ENCRYPTION=false
GROUNDCHECK_THRESHOLD=0.60
```

`GROUNDCHECK_THRESHOLD` controls how strict the groundedness check is — claims scoring below this cosine similarity to any knowledge base document get flagged. 0.60 is a reasonable starting point for the bundled embedding model; tune it against your own demo data if you see too many/few false flags.

## 5. Apply the Exasol schema

```bash
python backend/db.py
```

This creates the `GROUNDCHECK` schema and the `KNOWLEDGE_BASE`, `CHECKS` tables plus the `DAILY_MODEL_STATS` view. Safe to re-run — it uses `IF NOT EXISTS`.

**Alternative:** run `sql/schema.sql` directly via `exapump interactive -p starter-kit`, or any SQL client (DBeaver, DbVisualizer) connected to `127.0.0.1:8563`.

## 6. Load the knowledge base

```bash
python backend/ingest_kb.py --folder sample_docs
```

This embeds and loads the two bundled sample policy documents. To use your own knowledge base, drop `.txt` files into a folder and point `--folder` at it — one file becomes one document chunk.

## 7. Sanity-check with the CLI

```bash
python backend/run_check.py \
  --prompt "What is our refund policy?" \
  --response "Refunds are issued within 30 days, no questions asked." \
  --model "gpt-4o"
```

You should see a JSON result with a `verdict`, `confidence_score`, and any `flagged_spans`. If this errors, fix it here before moving to the dashboard — it isolates whether the issue is your Exasol connection or the embedding pipeline.

## 8. Launch the dashboard

```bash
streamlit run dashboard.py
```

This opens in your browser (default `localhost:8501`). From here you can:
- Submit new prompt/response pairs and see them verified live
- Watch the audit trail and hallucination-rate chart update as checks are logged
- Drill into any flagged response to see exactly which claim was unsupported

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `pyexasol` connection refused | Run `exakit status` — the database container may not be running. `exakit start`. |
| Auth error connecting to Exasol | Re-check `.env` against fresh output from `exakit info` — credentials can differ per machine. |
| `RuntimeError: KNOWLEDGE_BASE is empty` | Run step 6 (`ingest_kb.py`) before verifying anything. |
| Dashboard shows stale data | Streamlit caches queries for 5 seconds (`ttl=5` in `dashboard.py`); wait a moment or rerun the app. |
| Docker Desktop not running | Exasol Personal requires Docker Desktop active in the background — start it and retry `exakit start`. |

## Stopping / restarting

```bash
exakit stop     # stops the database, keeps your data
exakit start    # starts it again
```

Your `KNOWLEDGE_BASE` and `CHECKS` data persist across stop/start cycles.
