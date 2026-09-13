# GroundCheck / AuditLens

**An LLM output verification and audit-trail layer, built on Exasol Personal.**

Submission for the **Exasol AI + Data Challenge 2026 (Devjam)** — Track: *AI Trust, Safety & Governance*.

---

## The problem

LLMs are shipping into production faster than anyone can govern them:

- Model outputs go straight to users with nothing verifying them against an organization's own source documents.
- When a model hallucinates, there's usually no record of what was checked, when, or why it passed.
- Teams swap models constantly with no consistent way to compare how often each one hallucinates.
- Regulated industries need evidence of oversight — not just a chatbot that "seems fine."

## The solution

GroundCheck / AuditLens checks every LLM response against a knowledge base of trusted source documents, flags unsupported claims, and logs **every single check** — prompt, response, verdict, confidence score, and flagged spans — as a permanent, queryable row in Exasol.

That log is the audit trail. It's not a side effect — it's the point.

**Verify → Score → Log:**
1. **Verify** — the response is split into individual claims, each embedded and matched against the knowledge base.
2. **Score** — each claim gets a groundedness score; anything below the threshold is flagged with its reason and closest source.
3. **Log** — the full result is written to Exasol as an audit row, instantly visible on the dashboard.

## How Exasol Personal is used

Exasol isn't a bolt-on data store here — it's the system of record the whole project depends on:

| Object | Role |
|---|---|
| `KNOWLEDGE_BASE` (table) | Source-of-truth documents and their embeddings — the ground truth every claim is checked against |
| `CHECKS` (table) | Append-only audit log: every prompt, response, verdict, confidence score, and flagged span |
| `DAILY_MODEL_STATS` (view) | Native SQL rollup of hallucination rate per model, per day — no external BI tool needed |

The Streamlit dashboard queries Exasol directly on every refresh — what you see on screen is a live query, not a cached export.

## Architecture

```
 Prompt +            Verifier                Exasol Personal            Streamlit
 LLM Response   -->  (embeddings +      -->  KNOWLEDGE_BASE     -->     Dashboard
                      claim matching)         + CHECKS
```

## Tech stack

- **Database:** Exasol Personal (local, via the official starter kit)
- **Backend:** Python, `pyexasol`, `sentence-transformers` (local embeddings — no external API key required)
- **Dashboard:** Streamlit
- **Everything runs locally** — no cloud account, no external LLM API dependency for the verification step itself

## Repository structure

```
groundcheck/
├── sql/
│   └── schema.sql          # KNOWLEDGE_BASE, CHECKS, DAILY_MODEL_STATS
├── backend/
│   ├── db.py               # Exasol connection + schema runner
│   ├── embeddings.py       # Local sentence-embedding helper
│   ├── ingest_kb.py        # Loads source docs into KNOWLEDGE_BASE
│   ├── verifier.py         # Core verification logic + audit logging
│   └── run_check.py        # CLI for quick manual testing
├── dashboard.py            # Streamlit governance dashboard
├── sample_docs/            # Example knowledge base (refund + shipping policy)
├── requirements.txt
├── .env.example
└── DEPLOYMENT.md           # Full setup and run guide
```

## Quick start

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for full setup instructions. In short:

```bash
pip install -r requirements.txt
cp .env.example .env          # fill in your Exasol connection details
python backend/db.py          # apply schema.sql
python backend/ingest_kb.py --folder sample_docs
streamlit run dashboard.py
```

## Usage

1. Open the dashboard and paste in a prompt and an LLM response you want to verify.
2. Click **Verify against knowledge base**.
3. See the verdict (`GROUNDED` / `PARTIAL` / `HALLUCINATED`), confidence score, and any flagged claims immediately.
4. Every check is logged to Exasol and appears in the audit trail table and hallucination-rate chart below — no manual refresh needed.
5. Click into any flagged check to see exactly which claim was unsupported and why.

You can also run a check from the command line:

```bash
python backend/run_check.py \
  --prompt "What is our refund policy?" \
  --response "Refunds are issued within 30 days, no questions asked." \
  --model "gpt-4o"
```

## Team

Raghul K and team — VIT Vellore

## License

Built for the Exasol AI + Data Challenge 2026. See event rules for submission terms.
