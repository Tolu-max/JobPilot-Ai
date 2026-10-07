import json
from collections import Counter
from pathlib import Path

LIMIT = 150

for profile in ("tolu", "sister"):
    path = Path("/app/data/profiles") / profile / "processedJobs.json"
    if not path.exists():
        print(json.dumps({"profile": profile, "error": "missing processedJobs.json"}))
        continue

    store = json.loads(path.read_text())
    jobs = list(store.get("jobs", []))
    jobs_sorted = sorted(
        jobs,
        key=lambda j: j.get("updatedAt") or j.get("createdAt") or "",
        reverse=True,
    )
    sample = jobs_sorted[:LIMIT]

    status_counts = Counter(j.get("status", "unknown") for j in sample)
    source_counts = Counter(j.get("source_site", "unknown") for j in sample)

    reviewed_bruntwork = [
        {
            "title": j.get("title"),
            "score": j.get("score", 0),
            "optimizer_score": (j.get("optimizer") or {}).get("application_score"),
            "local_score": (j.get("local") or {}).get("score"),
            "job_url": j.get("job_url"),
            "updatedAt": j.get("updatedAt"),
            "acceptedViaTelegram": j.get("acceptedViaTelegram"),
            "skippedBecause": j.get("skippedBecause"),
            "reason": (j.get("reason") or "")[:200],
        }
        for j in sample
        if j.get("status") == "reviewed" and j.get("source_site") == "bruntwork"
    ]

    pending_apply = [
        {
            "title": j.get("title"),
            "score": j.get("score", 0),
            "optimizer_score": (j.get("optimizer") or {}).get("application_score"),
            "local_score": (j.get("local") or {}).get("score"),
            "job_url": j.get("job_url"),
            "updatedAt": j.get("updatedAt"),
            "acceptedViaTelegram": j.get("acceptedViaTelegram"),
            "reason": (j.get("reason") or "")[:200],
        }
        for j in sample
        if j.get("status") == "pending_apply"
    ]

    failed_apply = [
        {
            "title": j.get("title"),
            "score": j.get("score", 0),
            "job_url": j.get("job_url"),
            "updatedAt": j.get("updatedAt"),
            "reason": (j.get("reason") or "")[:200],
        }
        for j in sample
        if j.get("status") == "failed" and j.get("decision") == "apply"
    ]

    top_recent = [
        {
            "title": j.get("title"),
            "status": j.get("status"),
            "score": j.get("score", 0),
            "source_site": j.get("source_site"),
            "job_url": j.get("job_url"),
            "updatedAt": j.get("updatedAt"),
            "skippedBecause": j.get("skippedBecause"),
            "reason": (j.get("reason") or "")[:160],
        }
        for j in sample[:25]
    ]

    print(json.dumps({
        "profile": profile,
        "total_jobs": len(jobs),
        "audited": len(sample),
        "status_counts": dict(status_counts),
        "source_counts": dict(source_counts),
        "reviewed_bruntwork": reviewed_bruntwork[:30],
        "pending_apply": pending_apply[:30],
        "failed_apply": failed_apply[:30],
        "top_recent": top_recent,
    }))
