#!/usr/bin/env python3
"""
fetch-data.py — Fetches paginated transactions from the Extend API.
Writes data/transactions.json with normalized transaction records.
ALWAYS overwrites (never appends) the output file.
"""

import asyncio
import json
import os
import sys
from pathlib import Path

from extend import ExtendClient
from extend.auth import BasicAuth


def normalize_transaction(txn):
    """Normalize Extend API transaction to internal schema."""
    has_attachments = txn.get('hasAttachments', False)
    attachments_count = txn.get('attachmentsCount', 0)
    receipt_missing = not has_attachments or attachments_count == 0

    return {
        'id': txn.get('id', ''),
        'merchant': txn.get('merchantName', ''),
        'amount_cents': txn.get('authBillingAmountCents', 0),
        'date': txn.get('authedAt', ''),
        'virtual_card_id': txn.get('virtualCardId', ''),
        'vcn_display_name': txn.get('vcnDisplayName', ''),
        'vcn_last4': txn.get('vcnLast4', ''),
        'cardholder': txn.get('recipientName', ''),
        'mcc': txn.get('mcc', ''),
        'mcc_group': txn.get('mccGroup', ''),
        'receipt_missing': receipt_missing,
        'status': txn.get('status', ''),
    }


async def fetch_all_transactions(client):
    """Fetch all paginated transactions from the Extend API."""
    per_page = 100
    page = 1
    all_transactions = []

    while True:
        print(f"Fetching page {page}...", flush=True)
        try:
            response = await client.transactions.get_transactions(
                page=page,
                per_page=per_page,
            )
        except Exception as e:
            print(f"ERROR fetching page {page}: {e}", file=sys.stderr, flush=True)
            if all_transactions:
                print(f"Saving {len(all_transactions)} transactions fetched so far.", flush=True)
            break

        report = response.get('report', {})
        transactions = report.get('transactions', [])
        print(f"  Got {len(transactions)} transactions on page {page}", flush=True)

        all_transactions.extend(transactions)

        # Stop when the page has fewer items than per_page (last page)
        if len(transactions) < per_page:
            print(f"Last page reached (got {len(transactions)} < {per_page})", flush=True)
            break

        page += 1

    return all_transactions


async def main():
    api_key = os.environ.get('EXTEND_API_KEY')
    api_secret = os.environ.get('EXTEND_API_SECRET')

    if not api_key or not api_secret:
        print("ERROR: EXTEND_API_KEY and EXTEND_API_SECRET must be set", file=sys.stderr, flush=True)
        sys.exit(1)

    client = ExtendClient(auth=BasicAuth(api_key, api_secret))

    print("Fetching transactions from Extend API...", flush=True)
    raw_transactions = await fetch_all_transactions(client)

    print(f"Total raw transactions fetched: {len(raw_transactions)}", flush=True)

    # Normalize to internal schema
    normalized = [normalize_transaction(t) for t in raw_transactions]

    # Ensure data directory exists
    Path('data').mkdir(exist_ok=True)

    # OVERWRITE (never append) the output file
    output_path = 'data/transactions.json'
    with open(output_path, 'w') as f:
        json.dump(normalized, f, indent=2)

    print(f"Wrote {len(normalized)} transactions to {output_path}", flush=True)

    # Verify no duplicates
    ids = [t['id'] for t in normalized]
    unique_ids = set(ids)
    if len(ids) != len(unique_ids):
        print(f"WARNING: Found {len(ids) - len(unique_ids)} duplicate IDs!", file=sys.stderr, flush=True)
        sys.exit(1)
    else:
        print(f"Dedup check OK: {len(ids)} unique IDs", flush=True)


if __name__ == '__main__':
    asyncio.run(main())
