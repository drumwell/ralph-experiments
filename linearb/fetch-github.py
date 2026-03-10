#!/usr/bin/env python3
"""Fetch merged PRs from all configured GitHub repos for the last 90 days."""

import json
import os
import sys
import time
from datetime import datetime, timezone, timedelta
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
if not GITHUB_TOKEN:
    print("ERROR: GITHUB_TOKEN environment variable is not set", file=sys.stderr, flush=True)
    sys.exit(1)

BASE_URL = "https://api.github.com"
HEADERS = {
    "Authorization": f"Bearer {GITHUB_TOKEN}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}

LOOKBACK_DAYS = 90
CUTOFF = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).isoformat()


def gh_request(url):
    """Make a GitHub API request, returning (data, headers)."""
    req = Request(url, headers=HEADERS)
    try:
        with urlopen(req, timeout=30) as resp:
            remaining = resp.headers.get("X-RateLimit-Remaining", "?")
            if remaining != "?" and int(remaining) < 50:
                print(f"  WARNING: Rate limit low — {remaining} requests remaining", file=sys.stderr, flush=True)
            return json.loads(resp.read()), resp.headers
    except HTTPError as e:
        if e.code == 404:
            return None, None
        if e.code == 403:
            reset = e.headers.get("X-RateLimit-Reset", "")
            print(f"  ERROR: 403 Forbidden (rate limit?). Reset at: {reset}", file=sys.stderr, flush=True)
            if reset:
                wait = max(0, int(reset) - int(time.time())) + 5
                print(f"  Sleeping {wait}s for rate limit reset...", file=sys.stderr, flush=True)
                time.sleep(wait)
                return gh_request(url)
            return None, None
        print(f"  HTTP {e.code}: {url}", file=sys.stderr, flush=True)
        return None, None
    except URLError as e:
        print(f"  URLError: {e.reason} for {url}", file=sys.stderr, flush=True)
        return None, None


def get_paginated(base_url):
    """Yield all items from a paginated GitHub endpoint."""
    url = base_url
    while url:
        data, headers = gh_request(url)
        if data is None:
            break
        if isinstance(data, list):
            yield from data
        else:
            yield data
            break

        # Follow Link header
        link = headers.get("Link", "") if headers else ""
        next_url = None
        for part in link.split(","):
            part = part.strip()
            if 'rel="next"' in part:
                next_url = part.split(";")[0].strip().strip("<>")
                break
        url = next_url


def parse_dt(s):
    """Parse ISO 8601 datetime string to datetime object."""
    if not s:
        return None
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)


def fetch_pr_commits(org, repo, pr_number):
    """Return earliest commit date for a PR."""
    url = f"{BASE_URL}/repos/{org}/{repo}/pulls/{pr_number}/commits?per_page=100"
    commits = list(get_paginated(url))
    dates = []
    for c in commits:
        author = c.get("commit", {}).get("author", {})
        dt_str = author.get("date")
        if dt_str:
            dt = parse_dt(dt_str)
            if dt:
                dates.append(dt)
    if dates:
        return min(dates).isoformat().replace("+00:00", "Z")
    return None


def fetch_pr_reviews(org, repo, pr_number, merged_at_dt):
    """Return (first_review_at, approved_at, review_count) for a PR."""
    url = f"{BASE_URL}/repos/{org}/{repo}/pulls/{pr_number}/reviews?per_page=100"
    reviews = list(get_paginated(url))
    review_count = len(reviews)

    RELEVANT_STATES = {"APPROVED", "CHANGES_REQUESTED", "COMMENTED"}
    first_review_dt = None
    approved_dt = None

    for r in reviews:
        state = r.get("state", "")
        submitted_str = r.get("submitted_at")
        if not submitted_str:
            continue
        submitted_dt = parse_dt(submitted_str)
        if not submitted_dt:
            continue

        if state in RELEVANT_STATES:
            if first_review_dt is None or submitted_dt < first_review_dt:
                first_review_dt = submitted_dt

        if state == "APPROVED":
            # Must be BEFORE merged_at
            if merged_at_dt and submitted_dt < merged_at_dt:
                if approved_dt is None or submitted_dt > approved_dt:
                    approved_dt = submitted_dt

    first_review_at = first_review_dt.isoformat().replace("+00:00", "Z") if first_review_dt else None
    approved_at = approved_dt.isoformat().replace("+00:00", "Z") if approved_dt else None
    return first_review_at, approved_at, review_count


def fetch_pr_detail(org, repo, pr_number):
    """Return (files_changed, additions, deletions) from PR detail endpoint."""
    url = f"{BASE_URL}/repos/{org}/{repo}/pulls/{pr_number}"
    data, _ = gh_request(url)
    if data:
        return data.get("changed_files", 0), data.get("additions", 0), data.get("deletions", 0)
    return 0, 0, 0


def fetch_repo_prs(org, repo):
    """Fetch all merged PRs from a repo within the last 90 days."""
    results = []

    # Try both 'main' and 'master' as base branch
    for base in ["main", "master"]:
        params = urlencode({
            "state": "closed",
            "base": base,
            "sort": "updated",
            "direction": "desc",
            "per_page": 100,
        })
        url = f"{BASE_URL}/repos/{org}/{repo}/pulls?{params}"
        count = 0
        stop = False

        for pr in get_paginated(url):
            merged_at_str = pr.get("merged_at")
            if not merged_at_str:
                # Not merged — skip
                continue

            merged_at_dt = parse_dt(merged_at_str)
            if not merged_at_dt:
                continue

            # Stop if we've gone past our lookback window
            if merged_at_str < CUTOFF:
                stop = True
                break

            pr_number = pr["number"]
            created_at = pr.get("created_at", "")

            # Fetch commits to get first_commit_at
            first_commit_at = fetch_pr_commits(org, repo, pr_number)
            if not first_commit_at:
                first_commit_at = created_at  # fallback

            # Fetch reviews (also returns review_count)
            first_review_at, approved_at, review_count = fetch_pr_reviews(org, repo, pr_number, merged_at_dt)

            # Fetch PR detail for size metrics (not in list response)
            files_changed, additions, deletions = fetch_pr_detail(org, repo, pr_number)

            results.append({
                "repo": repo,
                "pr_number": pr_number,
                "title": pr.get("title", ""),
                "author": pr.get("user", {}).get("login", ""),
                "created_at": created_at,
                "merged_at": merged_at_str,
                "first_commit_at": first_commit_at,
                "first_review_at": first_review_at,
                "approved_at": approved_at,
                "review_count": review_count,
                "files_changed": files_changed,
                "additions": additions,
                "deletions": deletions,
                "base_branch": base,
            })
            count += 1

        if stop or count > 0:
            break  # Found PRs on this base branch, don't also try the other

    return results


def fetch_org_repos(org, exclude_repos=None):
    """Discover all non-archived repos in the org via the GitHub API."""
    exclude = set(exclude_repos or [])
    url = f"{BASE_URL}/orgs/{org}/repos?type=sources&per_page=100"
    repos = []
    for repo_data in get_paginated(url):
        name = repo_data.get("name", "")
        if repo_data.get("archived", False):
            continue
        if name in exclude:
            continue
        repos.append(name)
    repos.sort()
    return repos


def main():
    config_path = os.path.join(os.path.dirname(__file__), "config", "repos.json")
    with open(config_path) as f:
        config = json.load(f)

    org = config["github_org"]
    exclude_repos = config.get("exclude_repos", [])

    print(f"Discovering repos in {org}...", flush=True)
    repos = fetch_org_repos(org, exclude_repos)
    print(f"Found {len(repos)} active repos (excluding {len(exclude_repos)} excluded, archived repos filtered)", flush=True)

    print(f"Fetching merged PRs (last {LOOKBACK_DAYS} days)...", flush=True)
    print(f"Cutoff: {CUTOFF}", flush=True)

    all_prs = []

    for i, repo in enumerate(repos, 1):
        print(f"[{i}/{len(repos)}] {org}/{repo}...", end=" ", flush=True)
        try:
            prs = fetch_repo_prs(org, repo)
            all_prs.extend(prs)
            print(f"{len(prs)} PRs", flush=True)
        except Exception as e:
            print(f"ERROR: {e}", file=sys.stderr, flush=True)

    # Sort by merged_at descending
    all_prs.sort(key=lambda p: p["merged_at"], reverse=True)

    out_path = os.path.join(os.path.dirname(__file__), "data", "github_prs.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(all_prs, f, indent=2)

    print(f"\nDone. {len(all_prs)} total PRs written to {out_path}", flush=True)


if __name__ == "__main__":
    main()
