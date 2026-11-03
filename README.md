# GroundCheck / AuditLens

**An LLM output verification and audit-trail governance layer, built for Exasol Personal.**
*Rewritten as a modern React 19 + TypeScript + Vite + Tailwind CSS v4 web application.*

---

## The Problem

LLMs are shipping into production faster than organizations can govern them:

- Model outputs go straight to users with nothing verifying them against an organization's own source documents.
- When a model hallucinates, there's usually no record of what was checked, when, or why it passed.
- Teams swap models constantly with no consistent way to compare how often each one hallucinates.
- Regulated industries need evidence of oversight — not just a chatbot that "seems fine."

## The Solution

GroundCheck / AuditLens checks every LLM response against a knowledge base of trusted source documents, flags unsupported claims, and logs **every single check** — prompt, response, verdict, confidence score, and flagged spans — as a permanent, queryable row in the Exasol audit log.

**Verify → Score → Log:**
1. **Verify** — The response is split into individual claims (sentences), each embedded and matched against the knowledge base documents.
2. **Score** — Each claim receives a groundedness confidence score; claims scoring below `GROUNDCHECK_THRESHOLD` (default: `0.60`) are flagged with the exact reason, contradiction penalty, and closest source document.
3. **Log** — The full result is committed to the append-only `CHECKS` audit log, instantly reflected in the dashboard and live analytics.

## Exasol System of Record

| Object | Role |
|---|---|
| `KNOWLEDGE_BASE` (table) | Source-of-truth documents and embeddings — the ground truth every claim is checked against |
| `CHECKS` (table) | Append-only audit log: every prompt, response, verdict, confidence score, flagged spans, and latency |
| `DAILY_MODEL_STATS` (view) | Native SQL rollup of hallucination rate per model, per day (`HALLUCINATED_COUNT / TOTAL_CHECKS`) |

## Features in React Dashboard

1. **Run a New Check**:
   - Interactive prompt and LLM response tester.
   - Model selection (`gpt-4o`, `claude-3-5-sonnet`, `gemini-1.5-pro`, `llama-3-70b`, `mistral-large`).
   - One-click presets demonstrating Hallucinated, Grounded, and Partial responses.
   - Real-time verdict (`GROUNDED` / `PARTIAL` / `HALLUCINATED`), confidence score, claim count, latency, and flagged spans with closest document attribution.
2. **Governance Metrics Overview**:
   - Total checks, Grounded count, Partial count, Hallucinated count, and hallucination percentage.
3. **Hallucination Rate Over Time (by Model)**:
   - Interactive multi-line SVG visualization tracking model hallucination rates across dates.
   - Dual-view toggle between Line Chart and the raw `DAILY_MODEL_STATS` SQL table.
4. **Audit Trail Log**:
   - Queryable log with filtering by verdict, model, and search queries.
   - CSV export capability for compliance auditing.
5. **Drill-down Inspector**:
   - Select any check to inspect the prompt, full response text, flagged spans with semantic explanations, and comparison against matched ground truth documents.
   - Raw JSON viewer option matching Streamlit's `st.json` inspect view.
6. **Knowledge Base Management**:
   - Inspect loaded documents (`refund_policy.txt`, `shipping_policy.txt`).
   - Add new custom ground truth documents directly from the UI.
7. **Exasol SQL Architecture Modal**:
   - View the schema DDL (`sql/schema.sql`) and live table statistics.

## Tech Stack

- **Framework:** React 19, Vite, TypeScript
- **Styling:** Tailwind CSS v4
- **Icons:** Lucide React
- **Storage:** Exasol Personal schema emulation with persistent local storage
- **Verification Engine:** Semantic tokenizer, subword n-gram vector matcher, contradiction penalty logic, and cosine similarity scoring.

## Author

- **Raghul K** — raghul.k2023@vitstudent.ac.in
  School of Computer Science and Engineering, Vellore Institute of Technology, Vellore, India
