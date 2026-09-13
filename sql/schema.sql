-- GroundCheck / AuditLens — Exasol Personal schema
-- Run this once against your Exasol Personal instance before starting the app.
-- Usage: exaplus -c <host>:<port> -u sys -P <password> -f schema.sql
--    or: open Exasol's SQL client / DBeaver connected to Exasol Personal and run this file.

CREATE SCHEMA IF NOT EXISTS GROUNDCHECK;
OPEN SCHEMA GROUNDCHECK;

-- 1. Knowledge base: the "ground truth" source documents that LLM responses are checked against.
CREATE TABLE IF NOT EXISTS KNOWLEDGE_BASE (
    DOC_ID          VARCHAR(64)     NOT NULL,   
    TITLE           VARCHAR(500),               
    CONTENT         VARCHAR(2000000),           
    "SOURCE"        VARCHAR(500),               
    EMBEDDING       VARCHAR(2000000),           
    CREATED_AT      TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (DOC_ID)
);

-- 2. Audit log: every prompt/response pair that gets verified, with its verdict.
--    This table IS the audit trail — judges can query it directly to see governance in action.
CREATE TABLE IF NOT EXISTS CHECKS (
    CHECK_ID            VARCHAR(64)     NOT NULL,    -- UUID for this verification event
    PROMPT              VARCHAR(2000000) NOT NULL,
    RESPONSE            VARCHAR(2000000) NOT NULL,
    MODEL_NAME          VARCHAR(200),                -- which LLM produced the response
    VERDICT             VARCHAR(20),                 -- 'GROUNDED' | 'PARTIAL' | 'HALLUCINATED'
    CONFIDENCE_SCORE    DECIMAL(5,4),                -- 0.0000 - 1.0000 groundedness score
    FLAGGED_SPANS       VARCHAR(2000000),            -- JSON array of {text, reason, matched_doc_id} for unsupported claims
    SOURCE_DOC_IDS      VARCHAR(2000),               -- JSON array of DOC_ID values used for this check
    LATENCY_MS          DECIMAL(10,2),               -- how long the verification took (technical excellence signal)
    CREATED_AT          TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (CHECK_ID)
);

-- 3. Convenience view for the dashboard: daily hallucination rate per model.
CREATE OR REPLACE VIEW DAILY_MODEL_STATS AS
SELECT
    CAST(CREATED_AT AS DATE)                                   AS CHECK_DATE,
    MODEL_NAME,
    COUNT(*)                                                   AS TOTAL_CHECKS,
    SUM(CASE WHEN VERDICT = 'HALLUCINATED' THEN 1 ELSE 0 END)  AS HALLUCINATED_COUNT,
    SUM(CASE WHEN VERDICT = 'PARTIAL' THEN 1 ELSE 0 END)       AS PARTIAL_COUNT,
    SUM(CASE WHEN VERDICT = 'GROUNDED' THEN 1 ELSE 0 END)      AS GROUNDED_COUNT,
    AVG(CONFIDENCE_SCORE)                                      AS AVG_CONFIDENCE
FROM CHECKS
GROUP BY CAST(CREATED_AT AS DATE), MODEL_NAME;
