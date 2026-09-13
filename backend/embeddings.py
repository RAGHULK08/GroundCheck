"""
embeddings.py — shared sentence-embedding model for GroundCheck.

Uses a small local model (no API key needed) so the groundedness check works
fully offline. This keeps the demo self-contained and keeps Exasol Personal —
not an external LLM API — as the system doing the heavy lifting for storage
and retrieval of the knowledge base.
"""

import json
from functools import lru_cache

import numpy as np
from sentence_transformers import SentenceTransformer


@lru_cache(maxsize=1)
def get_model() -> SentenceTransformer:
    """Load the embedding model once per process."""
    return SentenceTransformer("all-MiniLM-L6-v2")


def embed_text(text: str) -> list:
    """Return a plain Python list of floats — safe to JSON-encode and store in Exasol."""
    model = get_model()
    vector = model.encode(text, normalize_embeddings=True)
    return vector.tolist()


def embed_batch(texts: list) -> list:
    """Embed multiple strings at once (faster than calling embed_text in a loop)."""
    model = get_model()
    vectors = model.encode(texts, normalize_embeddings=True)
    return [v.tolist() for v in vectors]


def cosine_similarity(vec_a: list, vec_b: list) -> float:
    """Both vectors are already normalized, so cosine similarity is just the dot product."""
    a = np.array(vec_a)
    b = np.array(vec_b)
    return float(np.dot(a, b))


def to_json(vector: list) -> str:
    return json.dumps(vector)


def from_json(vector_json: str) -> list:
    return json.loads(vector_json)
