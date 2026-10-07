import argparse
import json
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(description="Stage live processed jobs into pending_apply.")
    parser.add_argument("--profile", required=True, choices=("tolu", "sister"))
    parser.add_argument("--source", default=None)
    parser.add_argument("--from-status", dest="from_status", default="reviewed")
    parser.add_argument("--min-score", dest="min_score", type=int, default=0)
    parser.add_argument("--limit", type=int, default=0, help="0 means no limit")
    parser.add_argument("--apply", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()
    path = Path("/app/data/profiles") / args.profile / "processedJobs.json"
    if not path.exists():
      raise SystemExit(f"missing store: {path}")

    store = json.loads(path.read_text(encoding="utf-8"))
    jobs = list(store.get("jobs", []))
    staged = []

    ordered = sorted(
        jobs,
        key=lambda job: job.get("updatedAt") or job.get("createdAt") or "",
        reverse=True,
    )

    for job in ordered:
        if args.limit and len(staged) >= args.limit:
            break
        if job.get("status") != args.from_status:
            continue
        if args.source and job.get("source_site") != args.source:
            continue
        if int(job.get("score") or 0) < args.min_score:
            continue
        staged.append(
            {
                "title": job.get("title"),
                "score": int(job.get("score") or 0),
                "job_url": job.get("job_url"),
                "updatedAt": job.get("updatedAt"),
            }
        )
        if args.apply:
            job["status"] = "pending_apply"
            job["decision"] = "apply"
            job["acceptedViaTelegram"] = True
            job["updatedAt"] = job.get("updatedAt") or job.get("createdAt")
            job["reason"] = "Restaged for live retry"

    if args.apply:
        path.write_text(json.dumps(store, indent=2) + "\n", encoding="utf-8")

    print(
        json.dumps(
            {
                "profile": args.profile,
                "source": args.source,
                "from_status": args.from_status,
                "min_score": args.min_score,
                "limit": args.limit,
                "apply": args.apply,
                "staged_count": len(staged),
                "staged": staged,
            }
        )
    )


if __name__ == "__main__":
    main()
