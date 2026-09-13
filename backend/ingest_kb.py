"""
ingest_kb.py — load source-of-truth documents into the Exasol KNOWLEDGE_BASE table.

Usage:
    python backend/ingest_kb.py --folder ./sample_docs

Every .txt file in the folder becomes one row. For a real deployment you'd chunk
longer documents into paragraphs first — for a hackathon demo, one file = one doc
chunk is enough to show the pipeline working end-to-end.
"""

import argparse
import os
import uuid

from db import get_connection
from embeddings import embed_text, to_json


def ingest_folder(folder_path: str):
    conn = get_connection()
    count = 0

    for filename in sorted(os.listdir(folder_path)):
        if not filename.endswith(".txt"):
            continue

        filepath = os.path.join(folder_path, filename)
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read().strip()

        if not content:
            continue

        doc_id = str(uuid.uuid4())
        title = filename.replace(".txt", "").replace("_", " ").title()
        vector = embed_text(content)

        conn.execute(
            """
            INSERT INTO KNOWLEDGE_BASE (DOC_ID, TITLE, CONTENT, "SOURCE", EMBEDDING)
            VALUES ({doc_id}, {title}, {content}, {source}, {embedding})
            """,
            {
                "doc_id": doc_id,
                "title": title,
                "content": content,
                "source": filepath,
                "embedding": to_json(vector),
            },
        )
        count += 1
        print(f"Ingested: {filename} -> DOC_ID={doc_id}")

    conn.close()
    print(f"\nDone. {count} document(s) loaded into KNOWLEDGE_BASE.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest .txt source documents into Exasol's KNOWLEDGE_BASE table.")
    parser.add_argument("--folder", required=True, help="Path to a folder of .txt files")
    args = parser.parse_args()
    ingest_folder(args.folder)
