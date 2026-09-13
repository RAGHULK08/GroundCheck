"""
run_check.py — quick command-line entry point for testing the verifier
before wiring up the dashboard or a live LLM call.

Usage:
    python backend/run_check.py --prompt "What is our refund policy?" \
        --response "Refunds are issued within 30 days, no questions asked." \
        --model "gpt-4o"
"""

import argparse
import json

from verifier import verify_response

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run a single GroundCheck verification.")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--response", required=True)
    parser.add_argument("--model", default="unspecified")
    args = parser.parse_args()

    result = verify_response(args.prompt, args.response, args.model)
    print(json.dumps(result, indent=2))
