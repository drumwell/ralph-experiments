#!/usr/bin/env python3
"""Fetch transactions from Extend API and write to data/transactions.json."""

import asyncio
import json
import os
import sys
from extend import ExtendClient
from extend.auth import BasicAuth

DATA_FILE = "data/transactions.json"
PER_PAGE = 25


async def fetch_all_transactions():
    api_key = os.environ.get("EXTEND_API_KEY")
    api_secret = os.environ.get("EXTEND_API_SECRET")
    if not api_key or not api_secret:
        print("ERROR: EXTEND_API_KEY and EXTEND_API_SECRET env vars required", file=sys.stderr, flush=True)
        sys.exit(1)

    client = ExtendClient(auth=BasicAuth(api_key, api_secret))

    all_transactions = []
    page = 1

    while True:
        print(f"Fetching page {page}...", flush=True)
        try:
            response = await client.transactions.get_transactions(page=page, per_page=PER_PAGE)
        except Exception as e:
            print(f"ERROR fetching page {page}: {e}", file=sys.stderr, flush=True)
            if all_transactions:
                print(f"Saving {len(all_transactions)} transactions fetched so far.", flush=True)
                break
            sys.exit(1)

        page_transactions = response["report"]["transactions"]
        all_transactions.extend(page_transactions)
        print(f"  Got {len(page_transactions)} transactions (total so far: {len(all_transactions)})", flush=True)

        # Stop when page is less than full — no more pages
        if len(page_transactions) < PER_PAGE:
            break

        page += 1

    return all_transactions


def main():
    transactions = asyncio.run(fetch_all_transactions())

    os.makedirs("data", exist_ok=True)
    with open(DATA_FILE, "w") as f:
        json.dump(transactions, f, indent=2)

    print(f"\nDone: {len(transactions)} transactions written to {DATA_FILE}", flush=True)


if __name__ == "__main__":
    main()
