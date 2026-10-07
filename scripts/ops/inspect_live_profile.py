import json
from pathlib import Path

for profile in ("sister", "tolu"):
    roots = [Path("/app/data/profiles") / profile, Path("/app/data/profiles") / profile / profile]
    for base in roots:
        cv_path = base / "cv-data.json"
        prefs_path = base / "preferences.json"
        out = {
            "profile": profile,
            "base": str(base),
            "cv_exists": cv_path.exists(),
            "prefs_exists": prefs_path.exists(),
        }
        if cv_path.exists():
            data = json.loads(cv_path.read_text())
            out["cv_name"] = data.get("name")
            out["cv_summary"] = (data.get("summary") or "")[:120]
            out["cv_resume_path"] = data.get("_resumePath") or data.get("source", {}).get("path")
        if prefs_path.exists():
            prefs = json.loads(prefs_path.read_text())
            out["maxAutoApplyPerRun"] = prefs.get("maxAutoApplyPerRun")
            out["resumePath"] = prefs.get("resumePath")
        print(json.dumps(out))
