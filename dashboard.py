"""
dashboard.py — GroundCheck / AuditLens governance dashboard.

Everything shown here is read live from Exasol Personal — the CHECKS table
and the DAILY_MODEL_STATS view. Run with:

    streamlit run dashboard.py

Includes a "Run a new check" panel so the whole prompt -> verify -> log ->
dashboard-updates loop can be demoed live in under 3 minutes.
"""

import json
import sys
import os

import pandas as pd
import streamlit as st

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))
from db import get_connection            # noqa: E402
from verifier import verify_response     # noqa: E402

st.set_page_config(page_title="GroundCheck / AuditLens", layout="wide")
st.title("GroundCheck / AuditLens")
st.caption("LLM output verification & audit-trail layer — backed live by Exasol Personal")


@st.cache_data(ttl=5)
def load_checks():
    conn = get_connection()
    rows = conn.execute(
        """
        SELECT CHECK_ID, PROMPT, RESPONSE, MODEL_NAME, VERDICT, CONFIDENCE_SCORE,
               FLAGGED_SPANS, LATENCY_MS, CREATED_AT
        FROM CHECKS
        ORDER BY CREATED_AT DESC
        """
    ).fetchall()
    conn.close()
    columns = ["CHECK_ID", "PROMPT", "RESPONSE", "MODEL_NAME", "VERDICT",
               "CONFIDENCE_SCORE", "FLAGGED_SPANS", "LATENCY_MS", "CREATED_AT"]
    return pd.DataFrame(rows, columns=columns)


@st.cache_data(ttl=5)
def load_daily_stats():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM DAILY_MODEL_STATS ORDER BY CHECK_DATE DESC").fetchall()
    conn.close()
    columns = ["CHECK_DATE", "MODEL_NAME", "TOTAL_CHECKS", "HALLUCINATED_COUNT",
               "PARTIAL_COUNT", "GROUNDED_COUNT", "AVG_CONFIDENCE"]
    return pd.DataFrame(rows, columns=columns)


# ---- Run a new check ----
with st.expander("Run a new check", expanded=True):
    col1, col2 = st.columns(2)
    with col1:
        prompt = st.text_area("Prompt", placeholder="What is our refund policy?")
        model_name = st.text_input("Model name", value="gpt-4o")
    with col2:
        response = st.text_area("LLM response to verify", height=150,
                                 placeholder="Paste or type the model's response here...")

    if st.button("Verify against knowledge base", type="primary"):
        if not prompt or not response:
            st.warning("Enter both a prompt and a response.")
        else:
            with st.spinner("Checking claims against Exasol knowledge base..."):
                result = verify_response(prompt, response, model_name)
            st.cache_data.clear()

            verdict_color = {"GROUNDED": "green", "PARTIAL": "orange", "HALLUCINATED": "red"}
            st.markdown(f"### Verdict: :{verdict_color.get(result['verdict'], 'gray')}[{result['verdict']}]")
            st.write(f"Confidence score: **{result['confidence_score']}** "
                     f"({result['num_flagged']}/{result['num_claims']} claims flagged, "
                     f"{result['latency_ms']} ms)")
            if result["flagged_spans"]:
                st.write("Flagged claims:")
                for span in result["flagged_spans"]:
                    st.error(f"\"{span['text']}\" — {span['reason']}")

st.divider()

# ---- Audit trail & metrics ----
df = load_checks()

if df.empty:
    st.info("No checks logged yet. Run one above, or use backend/run_check.py.")
else:
    m1, m2, m3, m4 = st.columns(4)
    m1.metric("Total checks", len(df))
    m2.metric("Grounded", int((df["VERDICT"] == "GROUNDED").sum()))
    m3.metric("Partial", int((df["VERDICT"] == "PARTIAL").sum()))
    m4.metric("Hallucinated", int((df["VERDICT"] == "HALLUCINATED").sum()))

    st.subheader("Hallucination rate over time (by model)")
    stats_df = load_daily_stats()
    if not stats_df.empty:
        stats_df["HALLUCINATION_RATE"] = (
            stats_df["HALLUCINATED_COUNT"] / stats_df["TOTAL_CHECKS"]
        ).round(3)
        st.line_chart(
            stats_df.pivot_table(index="CHECK_DATE", columns="MODEL_NAME",
                                  values="HALLUCINATION_RATE", aggfunc="mean")
        )
        st.dataframe(stats_df, use_container_width=True)

    st.subheader("Audit trail — every check, queryable from Exasol")
    st.dataframe(
        df[["CREATED_AT", "MODEL_NAME", "VERDICT", "CONFIDENCE_SCORE", "LATENCY_MS", "PROMPT"]],
        use_container_width=True,
    )

    st.subheader("Drill into a flagged response")
    flagged_df = df[df["VERDICT"] != "GROUNDED"]
    if flagged_df.empty:
        st.write("No flagged responses yet.")
    else:
        selected = st.selectbox(
            "Select a check to inspect",
            flagged_df["CHECK_ID"],
            format_func=lambda cid: f"{cid[:8]}... — {flagged_df.loc[flagged_df['CHECK_ID']==cid, 'VERDICT'].values[0]}"
        )
        row = df[df["CHECK_ID"] == selected].iloc[0]
        st.write("**Prompt:**", row["PROMPT"])
        st.write("**Response:**", row["RESPONSE"])
        st.write("**Flagged spans:**")
        st.json(json.loads(row["FLAGGED_SPANS"]) if row["FLAGGED_SPANS"] else [])
