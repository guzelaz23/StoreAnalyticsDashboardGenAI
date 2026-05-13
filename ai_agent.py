"""
ai_agent.py — Super-intelligent AI Controller for Store Analytics Pro.
Handles ALL question categories from the cheat sheet with accurate SQL + insights.
Kimi → Groq fallback via llm_client.py.
"""
import os, json, difflib, shutil, logging
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv
from db import qry
from llm_client import chat_completion

load_dotenv(override=True)

EDITABLE = {"static/style.css","static/app.js","templates/index.html","static/enhanced.css"}
READABLE  = EDITABLE | {"app.py","forecasting.py","db.py"}
BACKUP    = "backups"
BLOCKED   = {"insert","update","delete","drop","alter","create","truncate","grant","revoke","copy","execute"}
logging.basicConfig(filename="agent_edit.log",level=logging.INFO,
                    format="%(asctime)s %(message)s",datefmt="%Y-%m-%d %H:%M:%S")

# ── Tools ─────────────────────────────────────────────────────────────────────
TOOLS = [
    {"type":"function","function":{
        "name":"query_db",
        "description":(
            "Execute a read-only SQL SELECT on the DVD rental PostgreSQL database. "
            "Use for ANY business or data question. NEVER guess numbers — always query."
        ),
        "parameters":{"type":"object","properties":{
            "sql":{"type":"string","description":"SELECT query only"},
            "purpose":{"type":"string","description":"What business question this answers"}
        },"required":["sql"]}
    }},
    {"type":"function","function":{
        "name":"multi_query",
        "description":"Run multiple SQL queries at once for complex analyses requiring cross-table data.",
        "parameters":{"type":"object","properties":{
            "queries":{"type":"array","items":{
                "type":"object","properties":{
                    "label":{"type":"string"},
                    "sql":{"type":"string"}
                },"required":["label","sql"]
            }}
        },"required":["queries"]}
    }},
    {"type":"function","function":{
        "name":"read_file",
        "description":"Read a project source file. Always call before modify_file.",
        "parameters":{"type":"object","properties":{
            "path":{"type":"string"}
        },"required":["path"]}
    }},
    {"type":"function","function":{
        "name":"modify_file",
        "description":"Propose a code change (shown as diff for user approval). For permanent chart/layout changes.",
        "parameters":{"type":"object","properties":{
            "path":{"type":"string"},
            "old_code":{"type":"string","description":"EXACT verbatim text — copy from read_file, 3+ lines"},
            "new_code":{"type":"string"},
            "reason":{"type":"string"}
        },"required":["path","old_code","new_code","reason"]}
    }},
    {"type":"function","function":{
        "name":"create_chart",
        "description":(
            "Create a new interactive chart on the dashboard from a live database query. "
            "Use whenever the user asks to create, add, build, show, or visualize any new chart, "
            "graph, or visualization. The chart appears instantly on the dashboard and persists "
            "across refreshes. Limit SQL to 20-30 rows for readability."
        ),
        "parameters":{"type":"object","properties":{
            "title":      {"type":"string","description":"Chart title displayed above the chart"},
            "chart_type": {"type":"string","enum":["bar","horizontal_bar","line","pie","scatter"],
                           "description":"bar=vertical bars, horizontal_bar=ranked horizontal, line=trend over time, pie=donut share, scatter=correlation"},
            "sql":        {"type":"string","description":"SELECT query — max 30 rows. Must return at least x_col and y_col."},
            "x_col":      {"type":"string","description":"Column name for x-axis (categories, labels, dates)"},
            "y_col":      {"type":"string","description":"Column name for y-axis (numeric values)"},
            "color":      {"type":"string","description":"Hex color for bars/lines, e.g. #EC4899 (optional)"}
        },"required":["title","chart_type","sql","x_col","y_col"]}
    }},
]

# ── Master System Prompt ───────────────────────────────────────────────────────
SYSTEM = """You are a senior BI analyst for Store Analytics Pro — a DVD rental dashboard (May 2005–Feb 2006, 2 stores).

RULES:
1. NEVER show SQL. Query silently, show only results.
2. ALWAYS use query_db — never guess numbers.
3. Be concise: key numbers + context + 💡 Takeaway.
4. Bold numbers, markdown tables for comparisons.
5. Answer in user's language (Indonesian or English).
6. Use multi_query for analyses needing multiple tables.
7. End every data answer with: 💡 **Takeaway:** [one business action]

DATABASE: DVD rental PostgreSQL (May 2005–Feb 2006, 2 stores)
Tables: rental, payment, inventory, film, customer, category, film_category, store, staff, address, city, country, actor, film_actor
Key joins: rental→payment (rental_id), rental→inventory (inventory_id), inventory→film (film_id), film→film_category→category, customer→address→city→country, film→film_actor→actor

CRITICAL SQL RULES:
- Always LEFT JOIN payment (some rentals have no payment)
- Use ROUND(SUM(p.amount)::numeric,2) for revenue
- Country queries: JOIN address→city→country, filter with HAVING LOWER(co.country)='x'
- Multi-condition filters use HAVING (aggregate), WHERE (row-level)
- revenue drop analysis: use LAG() window function for month-over-month change
- May 2005 revenue ≈ $0 (payment system launched mid-May — exclude or note this)
- Feb 2006 revenue = $514 (data cutoff artifact, not real collapse)

STRATEGY SHORTCUTS:
- revenue drop/cause → query monthly trend with LAG(), find biggest decline month + reason
- busiest time → hour + day of week query together
- churn risk → customers with last_rental < '2006-01-01'
- loyal customers → HAVING COUNT(rentals) >= 40, grouped by country
- overstock → HAVING copies >= 4 AND rentals < 3
- slow-moving → HAVING rentals < 5
- store comparison → GROUP BY store_id with revenue, rentals, customers
- staff performance → JOIN staff s ON r.staff_id=s.staff_id, GROUP BY s.staff_id, s.first_name, s.last_name. Return name, store_id, total_rentals, total_revenue. Note: only 2 staff (Mike Hillyer @ Store 1, Jon Stephens @ Store 2) — always show both with comparison + which store they manage.

ML MODELS (9-month dataset, seq_len=6):
- Transformer: 2,273 params, d_model=32, 4 heads, 2 layers, AdamW+cosine LR, Huber loss. Overfits on small data. Academic requirement (attention mechanism demo). Penalized 2.25× in leaderboard for <24 months.
- LSTM: 13,473 params, 2-layer hidden=64, LayerNorm, dropout=0.1. Same overfit issue.
- Linear/Ridge Regression: ~7 params. L2 regularization. BEST PERFORMER on 9 months (simplicity=less overfit).
- XGBoost: 200 trees, max_depth=4, lr=0.05, subsample=0.8. Second best on small data.
- Random Forest: 200 trees, max_depth=6. Good variance reduction.
- ARIMA: auto (p,1,q) by AIC minimization. Designed for short time-series. Excellent here.
- Moving Average: weighted last 6 months. Naive but reliable baseline.
- Leaderboard score: 0.4×MAE + 0.3×RMSE + 0.2×MAPE - 0.1×R² (lower=better)
- Confidence interval: ±1.96σ across all model predictions (95% CI)
- With 24+ months: Transformer/LSTM would outperform classical models"""

# ── Tool Executor ──────────────────────────────────────────────────────────────
def _run_tool(name: str, args: dict) -> dict:
    if name == "query_db":
        sql = args.get("sql","").strip()
        if not sql: return {"error":"Empty SQL"}
        if not sql.lower().lstrip().startswith("select"):
            return {"error":"SELECT queries only"}
        for tok in sql.lower().split():
            if tok in BLOCKED: return {"error":f"Blocked keyword: {tok}"}
        try:
            df = qry(sql)
            # Convert to clean dict with proper types
            rows = []
            for _, row in df.head(50).iterrows():
                clean = {}
                for k, v in row.items():
                    if hasattr(v, 'item'): v = v.item()  # numpy → python
                    clean[str(k)] = v
                rows.append(clean)
            return {"rows": rows, "count": len(df), "cols": list(df.columns),
                    "purpose": args.get("purpose","")}
        except Exception as e:
            return {"error": str(e)}

    elif name == "multi_query":
        results = {}
        for q in args.get("queries", []):
            label = q.get("label","query")
            sql   = q.get("sql","").strip()
            if not sql.lower().lstrip().startswith("select"):
                results[label] = {"error":"SELECT only"}
                continue
            try:
                df = qry(sql)
                rows = []
                for _, row in df.head(30).iterrows():
                    clean = {k: (v.item() if hasattr(v,'item') else v) for k,v in row.items()}
                    rows.append(clean)
                results[label] = {"rows": rows, "count": len(df)}
            except Exception as e:
                results[label] = {"error": str(e)}
        return results

    elif name == "read_file":
        fp = args.get("path","")
        if fp not in READABLE: return {"error":f"Cannot read '{fp}'"}
        p = Path(fp)
        if not p.exists(): return {"error":f"Not found: {fp}"}
        text = p.read_text("utf-8")
        if len(text) > 15000: text = text[:15000] + f"\n...[truncated {len(text)} chars]"
        return {"path":fp, "content":text}

    elif name == "modify_file":
        fp  = args.get("path","")
        old = args.get("old_code","")
        new = args.get("new_code","")
        reason = args.get("reason","")
        if fp not in EDITABLE: return {"error":f"Not editable: {fp}"}
        p = Path(fp)
        if not p.exists(): return {"error":f"Not found: {fp}"}
        text = p.read_text("utf-8")
        cnt = text.count(old)
        if cnt == 0:
            lines = [l.strip() for l in text.split("\n")]
            first = old.split("\n")[0].strip() if old else ""
            close = difflib.get_close_matches(first, lines, n=2, cutoff=0.5)
            return {"error":f"old_code not found in {fp}. Close: {close}. Read file first."}
        if cnt > 1:
            return {"error":f"old_code appears {cnt}× — add more lines for uniqueness."}
        new_text = text.replace(old, new, 1)
        diff = list(difflib.unified_diff(
            text.splitlines(keepends=True), new_text.splitlines(keepends=True),
            fromfile=f"a/{fp}", tofile=f"b/{fp}", lineterm=""))
        return {
            "status":"proposed","file":fp,"reason":reason,
            "diff_preview":"\n".join(diff[:60]),
            "patch":{"file":fp,"old_str":old,"new_str":new,"reason":reason},
        }
    elif name == "create_chart":
        import time as _time
        title      = args.get("title", "Custom Chart")
        chart_type = args.get("chart_type", "bar")
        sql        = args.get("sql", "").strip()
        x_col      = args.get("x_col", "")
        y_col      = args.get("y_col", "")
        color      = args.get("color", "#EC4899")
        if not sql or not sql.lower().lstrip().startswith("select"):
            return {"error": "SELECT query required"}
        for tok in sql.lower().split():
            if tok in BLOCKED:
                return {"error": f"Blocked keyword: {tok}"}
        try:
            df = qry(sql)
            if df.empty:
                return {"error": "Query returned no data"}
            cols = list(df.columns)
            if x_col not in cols: x_col = cols[0]
            if y_col not in cols:
                y_col = next((c for c in cols if c != x_col), cols[-1])
            x_vals = [str(v) for v in df[x_col].tolist()]
            y_vals = []
            for v in df[y_col].tolist():
                if hasattr(v, "item"): v = v.item()
                try: y_vals.append(float(v) if v is not None else 0)
                except (TypeError, ValueError): y_vals.append(0)
            chart_id = f"cc-{int(_time.time()*1000) % 9999999}"
            return {
                "chart_id": chart_id, "title": title,
                "chart_type": chart_type, "color": color,
                "x_col": x_col, "y_col": y_col,
                "x_vals": x_vals, "y_vals": y_vals,
                "rows": len(df),
            }
        except Exception as e:
            return {"error": str(e)}

    return {"error":f"Unknown tool: {name}"}

# ── Apply / Revert ─────────────────────────────────────────────────────────────
def apply_patches(patches):
    Path(BACKUP).mkdir(exist_ok=True)
    applied, errors = [], []
    for p in patches:
        f,old,new = p.get("file",""),p.get("old_str",""),p.get("new_str","")
        if f not in EDITABLE: errors.append(f"Rejected '{f}'"); continue
        path = Path(f)
        if not path.exists(): errors.append(f"Not found: {f}"); continue
        text = path.read_text("utf-8")
        if text.count(old) != 1: errors.append(f"{f}: count={text.count(old)}"); continue
        ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        shutil.copy2(path, Path(BACKUP)/f"{path.name}.{ts}.bak")
        path.write_text(text.replace(old,new,1),"utf-8")
        applied.append(f)
        logging.info("APPLY %s",f)
    return {"applied":list(set(applied)),"errors":errors}

def revert_latest(filename):
    if filename not in EDITABLE: return {"error":f"Not editable: {filename}"}
    bdir = Path(BACKUP)
    if not bdir.exists(): return {"error":"No backups"}
    cands = sorted(bdir.glob(f"{Path(filename).name}.*.bak"), reverse=True)
    if not cands: return {"error":f"No backup for {filename}"}
    shutil.copy2(cands[0], Path(filename))
    return {"reverted":filename,"from":cands[0].name}

# ── Main Agent Loop ────────────────────────────────────────────────────────────
def agent_chat(prompt: str, history: list = None, model_name: str = None) -> dict:
    if history is None: history = []
    messages = [{"role":"system","content":SYSTEM}]
    for m in history[-4:]:
        role = m.get("role","user")
        content = str(m.get("content",""))
        if role in ("user","assistant"):
            messages.append({"role":role,"content":content})

    messages.append({"role":"user","content":prompt})

    patches, tool_log, charts = [], [], []
    provider_used = None

    try:
        for iteration in range(8):
            result = chat_completion(
                messages=messages, tools=TOOLS,
                model_hint=model_name, temperature=0.1, max_tokens=1500
            )
            provider_used = result["provider"]
            msg    = result["message"]
            finish = result["finish_reason"]

            if finish == "tool_calls" and msg.tool_calls:
                tc_dicts = [
                    {"id":tc.id,"type":"function",
                     "function":{"name":tc.function.name,"arguments":tc.function.arguments}}
                    for tc in msg.tool_calls
                ]
                messages.append({
                    "role":"assistant",
                    "content":msg.content or "",
                    "tool_calls":tc_dicts
                })
                for tc in msg.tool_calls:
                    fn = tc.function.name
                    try: fa = json.loads(tc.function.arguments)
                    except: fa = {}
                    res = _run_tool(fn, fa)
                    if fn == "modify_file" and "patch" in res:
                        patches.append(res["patch"])
                    if fn == "create_chart" and "chart_id" in res:
                        charts.append(res)
                    tool_log.append({"tool":fn,"ok":"error" not in res,
                                     "args":{k:str(v)[:80] for k,v in fa.items() if k!="sql"}})
                    content_str = json.dumps(res, default=str)
                    if len(content_str) > 5000:
                        content_str = content_str[:5000] + "..."
                    messages.append({
                        "role":"tool",
                        "tool_call_id":tc.id,
                        "content":content_str
                    })
                continue

            return {
                "response": msg.content or "",
                "model_used": f"{provider_used}/{result['model']}",
                "patches": patches,
                "tool_calls": tool_log,
                "charts": charts,
            }

        return {"response":"Max reasoning steps reached. Try a more specific question.",
                "model_used":provider_used or "?","patches":patches,"tool_calls":tool_log}

    except Exception as e:
        return {"error":str(e)}
