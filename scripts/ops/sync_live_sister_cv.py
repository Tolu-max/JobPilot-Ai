import hashlib
import json
from pathlib import Path

target = Path("/app/data/profiles/sister/cv-data.json")
resume_path = Path("/app/data/profiles/sister/resume.pdf")
payload = json.load(open(0))

if resume_path.exists():
    resume_hash = hashlib.sha256(resume_path.read_bytes()).hexdigest()
    payload["_resumeHash"] = resume_hash
    payload["_pdfHash"] = resume_hash
    source = dict(payload.get("source") or {})
    source["hash"] = resume_hash
    source["path"] = str(resume_path)
    source["filename"] = resume_path.name
    payload["source"] = source
    payload["_resumePath"] = str(resume_path)

target.write_text(json.dumps(payload, indent=2) + "\n")
print(json.dumps({
    "written": str(target),
    "name": payload.get("name"),
    "summary": (payload.get("summary") or "")[:120],
    "resumePath": payload.get("_resumePath") or payload.get("source", {}).get("path"),
    "resumeHash": payload.get("_resumeHash"),
}))
