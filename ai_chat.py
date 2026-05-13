"""
ai_chat.py — Context-aware chatbot pipeline for DVD Rental Analytics.
Uses llm_client.py → automatic Kimi / Groq fallback.
"""
import os
import re
from dotenv import load_dotenv
from db import qry, store_clause as _sc, month_clause as _mc
from llm_client import chat_completion

load_dotenv(override=True)

# ── Topic filter ──────────────────────────────────────────────────────────────
_ALLOWED_TOPICS = {
    "revenue","sales","income","payment","amount","money","profit",
    "rental","rent","borrow","transaction","checkout",
    "customer","client","member","segment","retention","churn",
    "film","movie","dvd","title","genre","category","inventory","stock","copy",
    "store","shop","location","branch",
    "forecast","predict","prediction","future","trend","growth",
    "performance","insight","analysis","analytics","metric","kpi",
    "recommendation","strategy","opportunity","improve","increase",
    "country","geography","region","city",
    "hour","day","week","month","pattern","peak","busy",
    "top","best","worst","highest","lowest","most","least",
    "compare","comparison","versus","vs","difference",
    "staff","employee","manager","summary","report","overview",
    # ML / forecasting model names
    "transformer","lstm","arima","xgboost","xgb","ensemble",
    "linear","regression","neural","network","boosting","gradient",
    "random","forest","decision","tree","moving","average",
    # ML concepts & metrics
    "overfitting","overfit","overfits","mae","rmse","mape","r2",
    "confidence","interval","shaded","band","uncertainty",
    "leaderboard","composite","ranked","ranking","score",
    "accurate","accuracy","model","models","algorithm","parameter","parameters",
    "training","learning","machine","deep","architecture","layer",
    "attention","mechanism","encoding","positional","head","heads",
    "sequential","recurrent","epoch","dropout","regularization",
    "data","history","seasonal","seasonality","error","variance",
    # UI/dashboard keywords — routed to agent
    "change","ubah","ganti","modify","edit","warna","color","colour",
    "background","chart","bar","pie","line","theme","dark","light",
    "position","move","pindah","size","ukuran","layout","kpi",
    "show","hide","tampilkan","sembunyikan","dashboard","widget",
}

_REJECTION_MSG = (
    "I can only answer questions related to the **DVD Rental store dashboard** — "
    "such as revenue, rentals, customers, categories, inventory, store performance, "
    "geographic trends, temporal patterns, and forecasting.\n\n"
    "Please ask a business analytics question about the store data."
)

_EDIT_RE = re.compile(
    r'\b(edit|modify|change|ubah|kecilin|gedein|resize|pindah|ganti|'
    r'warna|color|background|theme|chart|layout|sembunyikan|hide|show)\b',
    re.IGNORECASE,
)

_EDIT_REDIRECT_MSG = (
    "It looks like you want to **modify the dashboard UI**. "
    "The AI Agent will handle this — proposing the exact code changes for you to review and apply."
)


def is_on_topic(prompt: str) -> bool:
    words = set(prompt.lower().split())
    return bool(words & _ALLOWED_TOPICS)


# ── Real-time context builder — uses EXACT same SQL as dashboard endpoints ────
def build_context(store: str = "All", month: str = "All") -> str:
    sc = _sc(store)   # e.g. "AND i.store_id = 1"
    mc = _mc(month)   # e.g. "AND TO_CHAR(r.rental_date,'YYYY-MM') = '2005-06'"

    lines = [
        f"=== REAL-TIME DASHBOARD DATA (Filter: Store={store}, Month={month}) ===\n"
    ]

    # ── KPIs (mirrors api_kpi exactly) ──────────────────────────────────────
    kpi = qry(f"""
        SELECT
          (SELECT COALESCE(SUM(p.amount),0)
           FROM payment p
           JOIN rental r ON p.rental_id=r.rental_id
           JOIN inventory i ON r.inventory_id=i.inventory_id
           WHERE 1=1 {sc} {mc}) AS revenue,
          (SELECT COUNT(DISTINCT r.rental_id)
           FROM rental r
           JOIN inventory i ON r.inventory_id=i.inventory_id
           WHERE 1=1 {sc} {mc}) AS total_rentals,
          (SELECT COUNT(DISTINCT r.customer_id)
           FROM rental r
           JOIN inventory i ON r.inventory_id=i.inventory_id
           WHERE 1=1 {sc} {mc}) AS customers,
          (SELECT COUNT(DISTINCT i.inventory_id) FROM inventory i WHERE 1=1 {sc}) AS inventory_items,
          (SELECT COUNT(DISTINCT i.film_id)      FROM inventory i WHERE 1=1 {sc}) AS film_titles
    """)
    rev   = float(kpi.iloc[0]["revenue"]       or 0)
    rents = int(kpi.iloc[0]["total_rentals"]   or 0)
    lines += [
        "[KEY PERFORMANCE INDICATORS]",
        f"Total Revenue: ${rev:,.2f}",
        f"Total Customers: {int(kpi.iloc[0]['customers'] or 0):,}",
        f"Total Rentals: {rents:,}",
        f"Inventory Items: {int(kpi.iloc[0]['inventory_items'] or 0):,}",
        f"Film Titles: {int(kpi.iloc[0]['film_titles'] or 0)}",
        (f"Avg Revenue per Rental: ${rev/rents:.2f}" if rents else "Avg Revenue per Rental: $0.00"),
        "",
    ]

    # ── Store comparison (mirrors api_store_compare — month filter only) ────
    stores = qry(f"""
        SELECT i.store_id::text AS store_id,
               COALESCE(SUM(p.amount),0)       AS revenue,
               COUNT(DISTINCT r.rental_id)     AS rentals,
               COUNT(DISTINCT r.customer_id)   AS customers
        FROM rental r
        JOIN inventory i ON r.inventory_id=i.inventory_id
        LEFT JOIN payment p ON p.rental_id=r.rental_id
        WHERE 1=1 {mc}
        GROUP BY i.store_id ORDER BY i.store_id
    """)
    lines.append("[STORE COMPARISON — both stores, month filter applied]")
    for _, row in stores.iterrows():
        lines.append(
            f"  Store {row['store_id']}: Revenue=${float(row['revenue']):,.2f}, "
            f"Rentals={int(row['rentals']):,}, Customers={int(row['customers'])}"
        )
    lines.append("")

    # ── Monthly revenue trend (mirrors api_trend) ────────────────────────────
    monthly = qry(f"""
        SELECT TO_CHAR(DATE_TRUNC('month',r.rental_date),'YYYY-MM') AS month,
               COALESCE(SUM(p.amount),0) AS revenue,
               COUNT(r.rental_id)        AS rentals
        FROM rental r
        JOIN inventory i ON r.inventory_id=i.inventory_id
        LEFT JOIN payment p ON p.rental_id=r.rental_id
        WHERE 1=1 {sc} {mc}
        GROUP BY 1 ORDER BY 1
    """)
    lines.append("[MONTHLY REVENUE TREND]")
    for _, row in monthly.iterrows():
        lines.append(f"  {row['month']}: Revenue=${float(row['revenue']):,.2f}, Rentals={int(row['rentals'])}")
    lines.append("")

    # ── Categories (mirrors api_categories exactly) ──────────────────────────
    cats = qry(f"""
        SELECT cat.name AS category,
               COALESCE(SUM(p.amount),0)                                              AS revenue,
               COUNT(r.rental_id)                                                     AS rentals,
               COUNT(DISTINCT i.inventory_id)                                         AS inventory,
               ROUND(COALESCE(SUM(p.amount),0)/NULLIF(COUNT(DISTINCT i.inventory_id),0),2) AS rev_per_inv
        FROM rental r
        JOIN inventory i ON r.inventory_id=i.inventory_id
        JOIN film_category fc ON i.film_id=fc.film_id
        JOIN category cat ON fc.category_id=cat.category_id
        LEFT JOIN payment p ON p.rental_id=r.rental_id
        WHERE 1=1 {sc} {mc}
        GROUP BY cat.name ORDER BY revenue DESC
    """)
    lines.append("[CATEGORIES BY REVENUE]")
    for rank, (_, row) in enumerate(cats.iterrows(), 1):
        lines.append(
            f"  #{rank} {row['category']}: Revenue=${float(row['revenue']):,.2f}, "
            f"Rentals={int(row['rentals'])}, Rev/Inventory=${float(row['rev_per_inv']):.2f}"
        )
    lines.append("")

    # ── Top 10 customers ─────────────────────────────────────────────────────
    top_c = qry(f"""
        SELECT cu.first_name||' '||cu.last_name AS name,
               COUNT(r.rental_id)        AS rentals,
               COALESCE(SUM(p.amount),0) AS revenue,
               MAX(r.rental_date)::date  AS last_rental
        FROM rental r
        JOIN inventory i ON r.inventory_id=i.inventory_id
        JOIN customer cu ON r.customer_id=cu.customer_id
        LEFT JOIN payment p ON p.rental_id=r.rental_id
        WHERE 1=1 {sc} {mc}
        GROUP BY cu.first_name, cu.last_name
        ORDER BY revenue DESC LIMIT 10
    """)
    lines.append("[TOP 10 CUSTOMERS BY REVENUE]")
    for rank, (_, row) in enumerate(top_c.iterrows(), 1):
        lines.append(
            f"  #{rank} {row['name']}: Revenue=${float(row['revenue']):,.2f}, "
            f"Rentals={int(row['rentals'])}, Last Rental={row['last_rental']}"
        )
    lines.append("")

    # ── Top 10 countries ─────────────────────────────────────────────────────
    geo = qry(f"""
        SELECT co.country,
               COALESCE(SUM(p.amount),0)     AS revenue,
               COUNT(DISTINCT cu.customer_id) AS customers
        FROM rental r
        JOIN inventory i ON r.inventory_id=i.inventory_id
        JOIN customer cu ON r.customer_id=cu.customer_id
        LEFT JOIN payment p ON p.rental_id=r.rental_id
        JOIN address a  ON cu.address_id=a.address_id
        JOIN city ci    ON a.city_id=ci.city_id
        JOIN country co ON ci.country_id=co.country_id
        WHERE 1=1 {sc} {mc}
        GROUP BY co.country ORDER BY revenue DESC LIMIT 10
    """)
    lines.append("[TOP 10 COUNTRIES BY REVENUE]")
    for rank, (_, row) in enumerate(geo.iterrows(), 1):
        lines.append(
            f"  #{rank} {row['country']}: Revenue=${float(row['revenue']):,.2f}, "
            f"Customers={int(row['customers'])}"
        )
    lines.append("")

    # ── Peak Hour & Day (accurate from DB) ──────────────────────────────────
    try:
        hourly = qry(f"""
            SELECT EXTRACT(HOUR FROM r.rental_date)::int AS hour,
                   COUNT(*) AS rentals,
                   ROUND(COALESCE(SUM(p.amount),0)::numeric,2) AS revenue
            FROM rental r
            JOIN inventory i ON r.inventory_id=i.inventory_id
            LEFT JOIN payment p ON p.rental_id=r.rental_id
            WHERE 1=1 {sc} {mc}
            GROUP BY 1 ORDER BY rentals DESC LIMIT 5
        """)
        lines.append("[PEAK HOURS (by rental count)]")
        for _, row in hourly.iterrows():
            h = int(row['hour'])
            ampm = f"{h}AM" if h < 12 else (f"12PM" if h == 12 else f"{h-12}PM")
            lines.append(f"  {ampm} (hour {h}): {int(row['rentals'])} rentals, Revenue=${float(row['revenue']):,.2f}")
        lines.append("")

        dow = qry(f"""
            SELECT TO_CHAR(r.rental_date,'Day') AS day_name,
                   EXTRACT(DOW FROM r.rental_date)::int AS dow,
                   COUNT(*) AS rentals,
                   ROUND(COALESCE(SUM(p.amount),0)::numeric,2) AS revenue
            FROM rental r
            JOIN inventory i ON r.inventory_id=i.inventory_id
            LEFT JOIN payment p ON p.rental_id=r.rental_id
            WHERE 1=1 {sc} {mc}
            GROUP BY 1,2 ORDER BY rentals DESC
        """)
        lines.append("[REVENUE BY DAY OF WEEK]")
        for _, row in dow.iterrows():
            lines.append(f"  {row['day_name'].strip()}: {int(row['rentals'])} rentals, Revenue=${float(row['revenue']):,.2f}")
        lines.append("")
    except Exception:
        pass

    return "\n".join(lines)


# ── System prompt ─────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are an expert Business Intelligence analyst AND machine learning consultant for a DVD rental store chain.

RULES:
1. For business data questions: Answer ONLY using numbers from the REAL-TIME DASHBOARD DATA provided. NEVER invent or estimate figures.
2. For ML/forecasting concept questions: Use the FORECASTING SYSTEM CONTEXT below to give accurate technical explanations.
3. Quote exact figures: write "$12,345.67" not "around $12K".
4. Use Markdown: **bold** for key numbers, bullet points for lists.
5. Respond in the same language as the user (Indonesian or English).
6. Be concise — max 6 lines for business data questions, up to 15 lines for ML concept explanations.

BUSINESS CONTEXT: Two physical DVD rental stores (Store 1 and Store 2). Data period: May 2005 – Feb 2006.

FORECASTING SYSTEM CONTEXT:
Dataset: 9 months (May 2005–Feb 2006) — very small for deep learning.
8 forecast models: Linear Regression (Ridge, ~7 params), XGBoost (200 trees, n_estimators=200, max_depth=4, lr=0.05, subsample=0.8), ARIMA (auto p,d=1,q — grid search, lowest AIC), Random Forest, Decision Tree, Moving Average (3-month), LSTM (2-layer hidden=64, 13,473 params), Transformer (d_model=32, 4 heads, 2 encoder layers, 2,273 params).

EVALUATION METRICS:
- MAE (Mean Absolute Error): avg dollar error/month — most intuitive. Lower = better.
- RMSE (Root Mean Squared Error): penalizes large errors more than MAE. Lower = better.
- MAPE (Mean Absolute Percentage Error): % error. <10% excellent, <20% good, >50% poor.
- R²: variance explained (1.0=perfect). Higher = better.
- Composite score = 0.4×MAE + 0.3×RMSE + 0.2×MAPE − 0.1×R² (lower = better). Transformer gets 2.25× penalty when data < 24 months to prevent overfitting luck.

KEY ML CONCEPTS:
- Overfitting: model memorizes training data, fails on new data. Analogy: student who memorizes past exam answers fails a new exam. Transformer (2,273 params) and LSTM (13,473 params) overfit on only 7 training sequences. Linear Regression (~7 params) and ARIMA generalize well on small data.
- With 24+ months data: LSTM starts competing. With 48+ months: Transformer benefits fully from its attention mechanism.
- Ensemble = average of all 8 model predictions. Errors cancel out — "wisdom of crowds" applied to models.
- Confidence Interval (shaded band) = ensemble mean ± 1.96 × std_dev across all 8 models. Narrow band = models agree (high confidence). Wide band = high uncertainty. Always grows with longer forecast horizon.
- ARIMA(p,1,q): grid search p,q ∈ [0,1,2], picks lowest AIC. Designed for short time-series, no gradient descent, no overfitting risk. d=1 means first differencing to remove trend.
- XGBoost: 200 sequential decision trees, each correcting the previous one's errors. subsample=0.8 prevents overfitting.
- LSTM gates: forget gate (erase irrelevant memory), input gate (store new info), output gate (produce next prediction). Processes sequences one step at a time.
- Transformer attention: 4 heads simultaneously learn which past months matter most. Positional encoding (sine/cosine) provides temporal order since Transformer processes in parallel, not sequentially. With 9 months: heads learn noise. With 48+ months: heads learn genuine seasonality.
- Feb 2006 revenue = $514 (data recording cutoff artifact — dataset was extracted mid-month, not a real business collapse). All 8 models learn this sharp decline and extrapolate it forward. Classic "garbage in, garbage out" example."""


def chat(prompt: str, history: list, model_name: str = None,
         store: str = "All", month: str = "All") -> dict:
    """Returns {"response": str, "model_used": str} or {"error": str}."""
    if _EDIT_RE.search(prompt):
        return {"response": _EDIT_REDIRECT_MSG, "model_used": "intent-filter", "edit_redirect": True}

    if not is_on_topic(prompt):
        return {"response": _REJECTION_MSG, "model_used": "intent-filter", "rejected": True}

    try:
        context = build_context(store, month)
    except Exception as e:
        return {"error": f"Database error: {e}"}

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for m in history[-12:]:
        messages.append({"role": m["role"], "content": m["content"]})
    messages.append({
        "role": "user",
        "content": (
            f"Real-time dashboard data — use ONLY these numbers:\n\n{context}\n\n"
            f"---\nUser question: {prompt}"
        ),
    })

    try:
        result = chat_completion(messages=messages, model_hint=model_name, temperature=0.1, max_tokens=2048)
        text = result["message"].content or ""
        return {"response": text, "model_used": f"{result['provider']}/{result['model']}"}
    except Exception as e:
        return {"error": str(e)}
