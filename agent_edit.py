"""
agent_edit.py — Legacy patch agent. Now uses llm_client for Kimi/Groq fallback.
"""
import os
import json
import logging
import shutil
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv
from llm_client import chat_completion

load_dotenv(override=True)

EDITABLE_FILES = {"static/style.css", "static/app.js", "templates/index.html"}
BACKUP_DIR = "backups"
LOG_FILE   = "agent_edit.log"

logging.basicConfig(filename=LOG_FILE, level=logging.INFO,
                    format="%(asctime)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S")

_FILE_LIMITS = {
    "static/style.css":     9000,
    "templates/index.html": 4000,
    "static/app.js":        1500,
}

_SYSTEM_PROMPT = """You are a UI patch agent. Output ONLY valid JSON, no markdown fences:
{
  "summary": "one-sentence description",
  "patches": [
    {"file": "static/style.css", "old_str": "exact verbatim string", "new_str": "replacement", "reason": "why"}
  ],
  "warnings": []
}
RULES: old_str must appear EXACTLY ONCE. For colors, edit CSS variables in :root, not hardcoded hex."""


def propose_patch(prompt: str) -> dict:
    snippets = {fp: Path(fp).read_text("utf-8")[:lim]
                for fp, lim in _FILE_LIMITS.items() if Path(fp).exists()}
    user_msg = f"Request: {prompt}\n\n" + "\n\n".join(
        f"=== {fp} ===\n{snip}" for fp, snip in snippets.items()
    )
    try:
        result = chat_completion(
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.05, max_tokens=2000,
        )
        raw = result["message"].content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw.strip())
    except json.JSONDecodeError as e:
        return {"error": f"JSON parse error: {e}"}
    except Exception as e:
        return {"error": str(e)}


def apply_patch(patches: list) -> dict:
    Path(BACKUP_DIR).mkdir(exist_ok=True)
    applied, errors = [], []
    for p in patches:
        f, old, new = p.get("file",""), p.get("old_str",""), p.get("new_str","")
        if f not in EDITABLE_FILES:
            errors.append(f"Rejected '{f}'"); continue
        path = Path(f)
        if not path.exists():
            errors.append(f"Not found: {f}"); continue
        text = path.read_text("utf-8")
        cnt = text.count(old)
        if cnt != 1:
            errors.append(f"{f}: count={cnt} (must be 1)"); continue
        ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        shutil.copy2(path, Path(BACKUP_DIR) / f"{path.name}.{ts}.bak")
        path.write_text(text.replace(old, new, 1), "utf-8")
        applied.append(f)
        logging.info("APPLY file=%s", f)
    return {"applied": list(set(applied)), "errors": errors}
