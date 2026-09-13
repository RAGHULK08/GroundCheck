"""
verifier.py — the core of GroundCheck / AuditLens.

Given a (prompt, response) pair, this module:
  1. Splits the response into individual claims (sentences).
  2. Embeds each claim and compares it against every document in Exasol's KNOWLEDGE_BASE.
  3. Flags any claim whose best match falls below GROUNDCHECK_THRESHOLD as unsupported.
  4. Rolls the per-claim results up into an overall verdict + confidence score.
  5. Writes one row to Exasol's CHECKS table — this row IS the audit trail.

Exasol does the real work here: it's the source-of-truth store for the knowledge
base AND the append-only log every governance query in the dashboard reads from.
"""

import json
import os
import re
import time
import uuid

from dotenv import load_dotenv

from db import get_connection
from embeddings import embed_text, from_json, cosine_similarity

load_dotenv()

THRESHOLD = float(os.getenv("GROUNDCHECK_THRESHOLD", "0.60"))


def split_into_claims(text: str) -> list:
    """Naive sentence splitter — good enough for a hackathon demo.
    Swap for a proper NLP sentence tokenizer for production use."""
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    return [s.strip() for s in sentences if s.strip()]


def load_knowledge_base(conn) -> list:
    """Pull every KB doc + its precomputed embedding out of Exasol."""
    rows = conn.execute("SELECT DOC_ID, TITLE, CONTENT, EMBEDDING FROM KNOWLEDGE_BASE").fetchall()
    kb = []
    for doc_id, title, content, embedding_json in rows:
        kb.append({
            "doc_id": doc_id,
            "title": title,
            "content": content,
            "embedding": from_json(embedding_json),
        })
    return kb


def best_match(claim_vector: list, kb: list):
    """Return (best_doc, best_score) for a single claim against the whole knowledge base."""
    best_doc = None
    best_score = -1.0
    for doc in kb:
        score = cosine_similarity(claim_vector, doc["embedding"])
        if score > best_score:
            best_score = score
            best_doc = doc
    return best_doc, best_score


def verify_response(prompt: str, response: str, model_name: str = "unspecified") -> dict:
    """Run the full groundedness check and log the result to Exasol.
    Returns the result dict so a caller (CLI, API, Streamlit) can display it immediately."""
    start = time.time()
    conn = get_connection()

    kb = load_knowledge_base(conn)
    if not kb:
        conn.close()
        raise RuntimeError(
            "KNOWLEDGE_BASE is empty. Run backend/ingest_kb.py first to load source documents."
        )

    claims = split_into_claims(response)
    flagged_spans = []
    scores = []
    used_doc_ids = set()

    for claim in claims:
        claim_vector = embed_text(claim)
        doc, score = best_match(claim_vector, kb)
        scores.append(score)
        used_doc_ids.add(doc["doc_id"])

        if score < THRESHOLD:
            flagged_spans.append({
                "text": claim,
                "reason": f"No supporting source found (best similarity {score:.2f} < {THRESHOLD})",
                "closest_doc_id": doc["doc_id"],
                "closest_doc_title": doc["title"],
            })

    avg_confidence = sum(scores) / len(scores) if scores else 0.0
    flagged_ratio = len(flagged_spans) / len(claims) if claims else 0.0

    if flagged_ratio == 0:
        verdict = "GROUNDED"
    elif flagged_ratio < 0.5:
        verdict = "PARTIAL"
    else:
        verdict = "HALLUCINATED"

    latency_ms = (time.time() - start) * 1000
    check_id = str(uuid.uuid4())

    conn.execute(
        """
        INSERT INTO CHECKS
            (CHECK_ID, PROMPT, RESPONSE, MODEL_NAME, VERDICT, CONFIDENCE_SCORE,
             FLAGGED_SPANS, SOURCE_DOC_IDS, LATENCY_MS)
        VALUES
            ({check_id}, {prompt}, {response}, {model_name}, {verdict}, {confidence},
             {flagged_spans}, {source_doc_ids}, {latency_ms})
        """,
        {
            "check_id": check_id,
            "prompt": prompt,
            "response": response,
            "model_name": model_name,
            "verdict": verdict,
            "confidence": round(avg_confidence, 4),
            "flagged_spans": json.dumps(flagged_spans),
            "source_doc_ids": json.dumps(list(used_doc_ids)),
            "latency_ms": round(latency_ms, 2),
        },
    )
    conn.close()

    return {
        "check_id": check_id,
        "verdict": verdict,
        "confidence_score": round(avg_confidence, 4),
        "flagged_spans": flagged_spans,
        "num_claims": len(claims),
        "num_flagged": len(flagged_spans),
        "latency_ms": round(latency_ms, 2),
    }
