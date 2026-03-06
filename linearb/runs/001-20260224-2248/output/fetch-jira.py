#!/usr/bin/env python3
"""Fetch change_failure incidents from Jira project EX for the last 90 days."""

import base64
import json
import os
import sys
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

JIRA_EMAIL = os.environ.get("JIRA_EMAIL", "")
JIRA_API_TOKEN = os.environ.get("JIRA_API_TOKEN", "")

if not JIRA_EMAIL:
    print("ERROR: JIRA_EMAIL environment variable is not set", file=sys.stderr, flush=True)
    sys.exit(1)
if not JIRA_API_TOKEN:
    print("ERROR: JIRA_API_TOKEN environment variable is not set", file=sys.stderr, flush=True)
    sys.exit(1)

LOOKBACK_DAYS = 90

_auth = base64.b64encode(f"{JIRA_EMAIL}:{JIRA_API_TOKEN}".encode()).decode()
HEADERS = {
    "Authorization": f"Basic {_auth}",
    "Accept": "application/json",
    "Content-Type": "application/json",
}


def jira_get(base_url, path):
    """Make a GET request to Jira API."""
    url = f"{base_url}{path}"
    req = Request(url, headers=HEADERS)
    try:
        with urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"  HTTP {e.code} GET {path}: {body[:200]}", file=sys.stderr, flush=True)
        return None
    except URLError as e:
        print(f"  URLError GET {path}: {e.reason}", file=sys.stderr, flush=True)
        return None


def jira_post(base_url, path, body):
    """Make a POST request to Jira API."""
    url = f"{base_url}{path}"
    data = json.dumps(body).encode("utf-8")
    req = Request(url, data=data, headers=HEADERS, method="POST")
    try:
        with urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        print(f"  HTTP {e.code} POST {path}: {err_body[:200]}", file=sys.stderr, flush=True)
        return None
    except URLError as e:
        print(f"  URLError POST {path}: {e.reason}", file=sys.stderr, flush=True)
        return None


def discover_custom_fields(base_url):
    """Discover custom field IDs for Incident Discovered Time and Incident Resolution Time."""
    print("Discovering custom field IDs...", flush=True)
    fields = jira_get(base_url, "/field")
    if not fields:
        print("  WARNING: Could not fetch field list", file=sys.stderr, flush=True)
        return None, None

    discovered_id = None
    resolved_id = None

    for field in fields:
        name = field.get("name", "")
        field_id = field.get("id", "")
        if name == "Incident Discovered Time":
            discovered_id = field_id
            print(f"  Found 'Incident Discovered Time': {field_id}", flush=True)
        elif name == "Incident Resolution Time":
            resolved_id = field_id
            print(f"  Found 'Incident Resolution Time': {field_id}", flush=True)

    if not discovered_id:
        print("  WARNING: 'Incident Discovered Time' custom field not found", file=sys.stderr, flush=True)
    if not resolved_id:
        print("  WARNING: 'Incident Resolution Time' custom field not found", file=sys.stderr, flush=True)

    return discovered_id, resolved_id


def parse_dt(s):
    """Parse Jira datetime string to UTC ISO 8601 string with Z suffix."""
    if not s:
        return None
    try:
        # Jira returns formats like "2026-02-02T00:00:00.000+0000" or "2026-02-02T00:00:00.000+00:00"
        # Normalize +0000 → +00:00 so fromisoformat can parse it
        normalized = s
        if normalized.endswith("Z"):
            normalized = normalized[:-1] + "+00:00"
        # Handle +HHMM without colon (e.g., +0000)
        import re
        normalized = re.sub(r"([+-])(\d{2})(\d{2})$", r"\1\2:\3", normalized)
        dt = datetime.fromisoformat(normalized)
        dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    except (ValueError, TypeError):
        return None


def fetch_issues(base_url, jira_project, incident_label, discovered_field_id, resolved_field_id):
    """Fetch all change_failure incidents from the last 90 days using GET /search/jql."""
    from urllib.parse import urlencode

    jql = (
        f"project = {jira_project} AND labels = {incident_label} "
        f"AND created >= -{LOOKBACK_DAYS}d ORDER BY created DESC"
    )

    # Build fields string
    base_fields = [
        "summary", "status", "priority", "issuetype", "reporter",
        "labels", "components", "created", "resolutiondate",
    ]
    extra_fields = []
    if discovered_field_id:
        extra_fields.append(discovered_field_id)
    if resolved_field_id:
        extra_fields.append(resolved_field_id)
    fields_str = ",".join(base_fields + extra_fields)

    all_issues = []
    next_page_token = None
    page_num = 0

    while True:
        page_num += 1
        print(f"  Fetching page {page_num}...", flush=True)

        params = {
            "jql": jql,
            "maxResults": 100,
            "fields": fields_str,
        }
        if next_page_token:
            params["nextPageToken"] = next_page_token

        result = jira_get(base_url, f"/search/jql?{urlencode(params)}")

        if not result:
            print("  ERROR: Search request failed", file=sys.stderr, flush=True)
            break

        issues = result.get("issues", [])
        is_last = result.get("isLast", True)
        next_page_token = result.get("nextPageToken")

        if not issues:
            break

        all_issues.extend(issues)
        print(f"  Got {len(issues)} issues (total so far: {len(all_issues)})", flush=True)

        if is_last or not next_page_token:
            break

    return all_issues


def build_incident(issue, discovered_field_id, resolved_field_id, jira_instance):
    """Convert a Jira issue to our output schema."""
    fields = issue.get("fields", {})
    key = issue.get("key", "")

    summary = fields.get("summary", "")
    status = (fields.get("status") or {}).get("name", "")
    priority = (fields.get("priority") or {}).get("name", "")
    issue_type = (fields.get("issuetype") or {}).get("name", "")
    reporter = (fields.get("reporter") or {}).get("displayName", "")

    labels = [lbl for lbl in (fields.get("labels") or []) if isinstance(lbl, str)]
    components = [c.get("name", "") for c in (fields.get("components") or []) if isinstance(c, dict)]

    created_at = parse_dt(fields.get("created"))
    resolved_at = parse_dt(fields.get("resolutiondate"))

    # Custom fields for incident timing
    incident_discovered_raw = None
    incident_resolved_raw = None
    if discovered_field_id:
        incident_discovered_raw = fields.get(discovered_field_id)
    if resolved_field_id:
        incident_resolved_raw = fields.get(resolved_field_id)

    incident_discovered_at = parse_dt(incident_discovered_raw) if incident_discovered_raw else None
    incident_resolved_at = parse_dt(incident_resolved_raw) if incident_resolved_raw else None

    # Fallbacks per ARCHITECTURE.md
    if not incident_discovered_at:
        incident_discovered_at = created_at
    if not incident_resolved_at:
        incident_resolved_at = resolved_at

    url = f"https://{jira_instance}/browse/{key}"

    return {
        "key": key,
        "summary": summary,
        "status": status,
        "priority": priority,
        "type": issue_type,
        "reporter": reporter,
        "labels": labels,
        "components": components,
        "created_at": created_at,
        "resolved_at": resolved_at,
        "incident_discovered_at": incident_discovered_at,
        "incident_resolved_at": incident_resolved_at,
        "url": url,
    }


def main():
    config_path = os.path.join(os.path.dirname(__file__), "config", "repos.json")
    with open(config_path) as f:
        config = json.load(f)

    jira_instance = config["jira_instance"]
    jira_project = config["jira_project"]
    incident_label = config["incident_label"]

    base_url = f"https://{jira_instance}/rest/api/3"

    print(f"Fetching {incident_label} incidents from Jira project {jira_project} (last {LOOKBACK_DAYS} days)...", flush=True)

    # Discover custom field IDs
    discovered_field_id, resolved_field_id = discover_custom_fields(base_url)

    # Fetch issues
    issues = fetch_issues(base_url, jira_project, incident_label, discovered_field_id, resolved_field_id)
    print(f"Total issues fetched: {len(issues)}", flush=True)

    # Convert to output schema
    incidents = []
    for issue in issues:
        try:
            incident = build_incident(issue, discovered_field_id, resolved_field_id, jira_instance)
            incidents.append(incident)
        except Exception as e:
            print(f"  ERROR processing {issue.get('key', '?')}: {e}", file=sys.stderr, flush=True)

    # Write output
    out_path = os.path.join(os.path.dirname(__file__), "data", "jira_incidents.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(incidents, f, indent=2)

    print(f"Done. {len(incidents)} incidents written to {out_path}", flush=True)


if __name__ == "__main__":
    main()
