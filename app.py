"""
app.py — Store Analytics Pro | Flask Backend
Modular: db.py, ai_chat.py, ai_agent.py, forecasting.py
"""
import os
import json
import math
import numpy as np
import pandas as pd
import plotly
import plotly.express as px
import plotly.graph_objects as go
from flask import Flask, render_template, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv

# Load .env FIRST — before any AI/DB modules read os.getenv()
load_dotenv(override=True)

from db import qry, store_clause as _sc, month_clause as _mc, reinit_pool, get_config
from ai_chat import chat as ai_chat_legacy
from forecasting import run_forecast

app = Flask(__name__)
CORS(app)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "dev-secret")


# ── NaN-safe JSON (fixes the forecast crash) ─────────────────────────────────
class _NaNSafeEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
            return None
        if isinstance(obj, np.integer):
            return int(obj)
        if isinstance(obj, np.floating):
            f = float(obj)
            return None if (math.isnan(f) or math.isinf(f)) else f
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)

app.json_encoder = _NaNSafeEncoder

# ── Chart helper ──────────────────────────────────────────────────────────────
_COLORS = {
    "primary": "#1E3A8A",
    "accent": "#EC4899",
    "pink_light": "#F9A8D4",
    "sky": "#7DD3FC",
    "green": "#86EFAC",
    "purple": "#A855F7",
    "seq": ["#1E3A8A", "#F9A8D4"],
}
_LAYOUT_BASE = dict(
    paper_bgcolor="rgba(0,0,0,0)",
    plot_bgcolor="rgba(255,255,255,0.02)",
    font=dict(family="Inter", color="#EAF0FA", size=10),
)
_GRID = dict(gridcolor="rgba(249,168,212,0.18)")


def _fig_layout(fig, height=220, margin=None, **kwargs):
    m = margin or dict(t=10, b=30, l=40, r=10)
    fig.update_layout(**_LAYOUT_BASE, height=height, margin=m, **kwargs)
    fig.update_xaxes(**_GRID)
    fig.update_yaxes(**_GRID)
    return fig


def fig_json(fig) -> dict:
    return json.loads(plotly.io.to_json(fig))


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/months")
def api_months():
    df = qry("SELECT DISTINCT TO_CHAR(rental_date,'YYYY-MM') AS m FROM rental ORDER BY m")
    return jsonify(["All"] + df["m"].tolist())


@app.route("/api/kpi")
def api_kpi():
    sf = request.args.get("store", "All")
    mf = request.args.get("month", "All")
    sc = _sc(sf)
    mc = _mc(mf)
    sc2 = f"AND i2.store_id={int(sf)}" if sf not in ("All", "") else ""
    mc2 = f"AND TO_CHAR(r2.rental_date,'YYYY-MM')='{mf}'" if mf not in ("All", "") else ""

    df = qry(f"""
        SELECT
          (SELECT COUNT(DISTINCT r2.customer_id) FROM rental r2
           JOIN inventory i2 ON r2.inventory_id=i2.inventory_id
           WHERE 1=1 {sc2} {mc2}) AS customers,
          (SELECT COUNT(DISTINCT r.rental_id) FROM rental r
           JOIN inventory i ON r.inventory_id=i.inventory_id WHERE 1=1 {sc} {mc}) AS rentals,
          (SELECT COALESCE(SUM(p.amount),0) FROM payment p
           JOIN rental r ON p.rental_id=r.rental_id
           JOIN inventory i ON r.inventory_id=i.inventory_id WHERE 1=1 {sc} {mc}) AS revenue,
          (SELECT COUNT(DISTINCT i.inventory_id) FROM inventory i WHERE 1=1 {sc}) AS inventory,
          (SELECT COUNT(DISTINCT i.film_id) FROM inventory i WHERE 1=1 {sc}) AS films
    """)
    row = df.iloc[0]
    rev = float(row["revenue"] or 0)
    rent = int(row["rentals"] or 0)
    return jsonify({
        "revenue": rev,
        "customers": int(row["customers"] or 0),
        "rentals": rent,
        "inventory": int(row["inventory"] or 0),
        "films": int(row["films"] or 0),
        "avg_tx": round(rev / rent, 2) if rent else 0,
    })


@app.route("/api/store_compare")
def api_store_compare():
    # NOTE: store_compare ALWAYS shows BOTH stores side-by-side (ignore store filter)
    # The store filter only affects trend/categories/customers/patterns
    mf = request.args.get("month", "All")
    mc = _mc(mf)
    df = qry(f"""
        SELECT i.store_id::text AS store_id,
               COALESCE(SUM(p.amount),0) AS revenue,
               COUNT(DISTINCT r.rental_id) AS rentals,
               COUNT(DISTINCT r.customer_id) AS customers
        FROM rental r JOIN inventory i ON r.inventory_id=i.inventory_id
        LEFT JOIN payment p ON p.rental_id=r.rental_id
        WHERE 1=1 {mc} GROUP BY i.store_id ORDER BY i.store_id
    """)
    # Ensure both stores always present even if one has no data
    all_stores = pd.DataFrame({"store_id": ["1", "2"]})
    df = all_stores.merge(df, on="store_id", how="left").fillna(0)
    df["store_id"] = "Store " + df["store_id"]

    PALETTE = [_COLORS["primary"], _COLORS["accent"]]

    fig1 = px.bar(df, x="store_id", y="revenue", text_auto=".3s",
                  color="store_id", color_discrete_sequence=PALETTE)
    _fig_layout(fig1, showlegend=False)

    fig2 = px.bar(df, x="store_id", y="rentals", text_auto=True,
                  color="store_id", color_discrete_sequence=PALETTE)
    _fig_layout(fig2, showlegend=False)

    return jsonify({
        "revenue_chart": fig_json(fig1),
        "rentals_chart": fig_json(fig2),
        "data": df.to_dict("records"),
    })


@app.route("/api/trend")
def api_trend():
    sf = request.args.get("store", "All")
    mf = request.args.get("month", "All")
    sc = _sc(sf)

    if mf == "All":
        df = qry(f"""
            SELECT DATE_TRUNC('month',r.rental_date) AS period,
                   i.store_id::text AS store,
                   COUNT(r.rental_id) AS rentals,
                   COALESCE(SUM(p.amount),0) AS revenue
            FROM rental r JOIN inventory i ON r.inventory_id=i.inventory_id
            LEFT JOIN payment p ON r.rental_id=p.rental_id WHERE 1=1 {sc}
            GROUP BY 1,2 ORDER BY 1,2
        """)
        ttype = "Monthly"
    else:
        df = qry(f"""
            SELECT r.rental_date::date AS period,
                   i.store_id::text AS store,
                   COUNT(r.rental_id) AS rentals,
                   COALESCE(SUM(p.amount),0) AS revenue
            FROM rental r JOIN inventory i ON r.inventory_id=i.inventory_id
            LEFT JOIN payment p ON r.rental_id=p.rental_id
            WHERE TO_CHAR(r.rental_date,'YYYY-MM')='{mf}' {sc}
            GROUP BY 1,2 ORDER BY 1,2
        """)
        ttype = "Daily"

    df["store"] = "Store " + df["store"]
    df["period"] = df["period"].astype(str)

    fig1 = px.line(df, x="period", y="revenue", color="store",
                   color_discrete_sequence=[_COLORS["primary"], _COLORS["accent"]], markers=True)
    fig1.update_traces(line_width=2, marker_size=4)
    _fig_layout(fig1, legend_title_text="")

    fig2 = px.area(df, x="period", y="rentals", color="store",
                   color_discrete_sequence=[_COLORS["primary"], _COLORS["accent"]])
    fig2.update_traces(line_width=2)
    _fig_layout(fig2, legend_title_text="")

    return jsonify({
        "revenue_chart": fig_json(fig1),
        "rentals_chart": fig_json(fig2),
        "trend_type": ttype,
    })


@app.route("/api/categories")
def api_categories():
    sf = request.args.get("store", "All")
    mf = request.args.get("month", "All")
    df = qry(f"""
        SELECT cat.name AS category,
               COUNT(DISTINCT i.inventory_id) AS inventory,
               COALESCE(SUM(p.amount),0) AS revenue,
               COUNT(r.rental_id) AS rentals,
               ROUND(COALESCE(SUM(p.amount),0)/NULLIF(COUNT(DISTINCT i.inventory_id),0),2) AS rev_per_inv
        FROM rental r JOIN inventory i ON r.inventory_id=i.inventory_id
        JOIN film_category fc ON i.film_id=fc.film_id
        JOIN category cat ON fc.category_id=cat.category_id
        LEFT JOIN payment p ON p.rental_id=r.rental_id
        WHERE 1=1 {_sc(sf)} {_mc(mf)} GROUP BY cat.name ORDER BY revenue DESC
    """)
    top5 = df.nlargest(5, "revenue")[["category", "revenue"]].sort_values("revenue")
    fig1 = px.bar(top5, x="revenue", y="category", orientation="h", text_auto=".3s",
                  color="revenue", color_continuous_scale=_COLORS["seq"])
    _fig_layout(fig1, showlegend=False, coloraxis_showscale=False, margin=dict(t=10, b=30, l=80, r=10))

    fig2 = px.pie(df, names="category", values="rentals", hole=0.45,
                  color_discrete_sequence=[
                      _COLORS["primary"], _COLORS["accent"], _COLORS["pink_light"],
                      "#2E4FB8", "#FBCFE8", _COLORS["sky"]
                  ])
    fig2.update_traces(textinfo="percent", textfont_size=9)
    fig2.update_layout(**_LAYOUT_BASE, height=220, margin=dict(t=10, b=10, l=10, r=10),
                       legend=dict(font=dict(size=8)))

    cs = df.sort_values("rev_per_inv")
    fig3 = px.bar(cs, x="rev_per_inv", y="category", orientation="h", text_auto=".1f",
                  color="rev_per_inv", color_continuous_scale=_COLORS["seq"])
    _fig_layout(fig3, height=380, showlegend=False, coloraxis_showscale=False,
                margin=dict(t=10, b=30, l=80, r=10))

    return jsonify({
        "top5_chart": fig_json(fig1),
        "pie_chart": fig_json(fig2),
        "rev_per_inv_chart": fig_json(fig3),
        "data": df.to_dict("records"),
    })


@app.route("/api/film_utilization")
def api_film_utilization():
    sf = request.args.get("store", "All")
    mf = request.args.get("month", "All")
    sc, mc = _sc(sf), _mc(mf)
    df = qry(f"""
        SELECT f.title, cat.name AS category,
               COUNT(DISTINCT i.inventory_id) AS copies,
               COUNT(r.rental_id) AS times_rented,
               ROUND(COUNT(r.rental_id)::numeric/NULLIF(COUNT(DISTINCT i.inventory_id),0),2) AS util_rate,
               COALESCE(SUM(p.amount),0) AS revenue
        FROM film f
        JOIN inventory i ON f.film_id=i.film_id
        JOIN film_category fc ON f.film_id=fc.film_id
        JOIN category cat ON fc.category_id=cat.category_id
        LEFT JOIN rental r ON i.inventory_id=r.inventory_id {f'AND 1=1 {mc}' if mc else ''}
        LEFT JOIN payment p ON r.rental_id=p.rental_id
        WHERE 1=1 {sc}
        GROUP BY f.title, cat.name ORDER BY util_rate DESC LIMIT 15
    """)
    return jsonify(df.to_dict("records"))


@app.route("/api/customers")
def api_customers():
    sf = request.args.get("store", "All")
    mf = request.args.get("month", "All")
    sc, mc = _sc(sf), _mc(mf)

    seg = qry(f"""
        SELECT CASE WHEN rental_count>40 THEN '1. Elite (40+)'
                    WHEN rental_count BETWEEN 30 AND 40 THEN '2. Frequent (30-40)'
                    WHEN rental_count BETWEEN 20 AND 29 THEN '3. Regular (20-29)'
                    ELSE '4. Casual (<20)' END AS segment,
               COUNT(customer_id) AS total_customers,
               SUM(rental_count) AS total_rentals
        FROM (SELECT r.customer_id, COUNT(r.rental_id) AS rental_count
              FROM rental r JOIN inventory i ON r.inventory_id=i.inventory_id
              WHERE 1=1 {sc} {mc} GROUP BY r.customer_id) cs
        GROUP BY segment ORDER BY segment
    """)
    fig_seg = px.pie(seg, names="segment", values="total_customers", hole=0.5,
                     color_discrete_sequence=[
                         _COLORS["primary"], "#2E4FB8", _COLORS["accent"], _COLORS["pink_light"]
                     ])
    fig_seg.update_traces(textinfo="percent", textfont_size=9)
    fig_seg.update_layout(**_LAYOUT_BASE, height=220, margin=dict(t=10, b=10, l=10, r=10))

    top = qry(f"""
        SELECT r.customer_id, cu.first_name||' '||cu.last_name AS name,
               COUNT(r.rental_id) AS rentals, COALESCE(SUM(p.amount),0) AS revenue,
               MAX(r.rental_date)::date AS last_rental
        FROM rental r JOIN inventory i ON r.inventory_id=i.inventory_id
        JOIN customer cu ON r.customer_id=cu.customer_id
        LEFT JOIN payment p ON r.rental_id=p.rental_id
        WHERE 1=1 {sc} {mc}
        GROUP BY r.customer_id, cu.first_name, cu.last_name
        ORDER BY revenue DESC LIMIT 15
    """)
    top["last_rental"] = top["last_rental"].astype(str)

    return jsonify({
        "segment_chart": fig_json(fig_seg),
        "top_customers": top.to_dict("records"),
    })


@app.route("/api/customer_value_segments")
def api_customer_value_segments():
    sf = request.args.get("store", "All")
    mf = request.args.get("month", "All")
    sc, mc = _sc(sf), _mc(mf)

    custs = qry(f"""
        SELECT r.customer_id, COUNT(r.rental_id) AS rentals,
               COALESCE(SUM(p.amount),0) AS revenue
        FROM rental r JOIN inventory i ON r.inventory_id=i.inventory_id
        LEFT JOIN payment p ON r.rental_id=p.rental_id
        WHERE 1=1 {sc} {mc} GROUP BY r.customer_id
    """)
    if custs.empty:
        return jsonify({"chart": fig_json(go.Figure())})

    try:
        custs["tier"] = pd.qcut(
            custs["revenue"], q=3,
            labels=["🥉 Low Value", "🥈 Mid Value", "🥇 High Value"],
            duplicates="drop",
        )
    except Exception:
        custs["tier"] = "🥈 Mid Value"

    tier_agg = custs.groupby("tier", observed=True).agg(
        customers=("customer_id", "count"),
        avg_revenue=("revenue", "mean"),
        avg_rentals=("rentals", "mean"),
    ).reset_index()
    tier_agg["avg_revenue"] = tier_agg["avg_revenue"].round(2)
    tier_agg["avg_rentals"] = tier_agg["avg_rentals"].round(1)

    fig = px.scatter(tier_agg, x="avg_rentals", y="avg_revenue",
                     size="customers", color="tier",
                     color_discrete_sequence=[_COLORS["primary"], _COLORS["accent"], "#FBCFE8"],
                     text="tier")
    fig.update_traces(textposition="top center", textfont_size=8, marker=dict(sizemin=10))
    _fig_layout(fig, height=260, showlegend=False, margin=dict(t=20, b=40, l=50, r=20),
                xaxis_title="Avg Rentals", yaxis_title="Avg Revenue ($)")

    return jsonify({"chart": fig_json(fig)})


@app.route("/api/geo")
def api_geo():
    sf = request.args.get("store", "All")
    mf = request.args.get("month", "All")
    df = qry(f"""
        SELECT co.country, COUNT(DISTINCT r.customer_id) AS customers,
               COALESCE(SUM(p.amount),0) AS revenue, COUNT(r.rental_id) AS rentals
        FROM rental r JOIN inventory i ON r.inventory_id=i.inventory_id
        JOIN customer cu ON r.customer_id=cu.customer_id
        LEFT JOIN payment p ON p.rental_id=r.rental_id
        JOIN address a ON cu.address_id=a.address_id
        JOIN city ci ON a.city_id=ci.city_id
        JOIN country co ON ci.country_id=co.country_id
        WHERE co.country IS NOT NULL {_sc(sf)} {_mc(mf)}
        GROUP BY co.country ORDER BY revenue DESC
    """)

    fig_map = px.choropleth(
        df, locations="country", locationmode="country names",
        color="revenue", hover_name="country",
        color_continuous_scale=[
            "#0A1628", _COLORS["primary"], _COLORS["pink_light"], "#FBCFE8"
        ],
    )
    fig_map.update_layout(
        **_LAYOUT_BASE,
        geo=dict(
            showframe=False, showcoastlines=True,
            bgcolor="rgba(0,0,0,0)", projection_type="natural earth",
            showland=True, landcolor="rgba(30,27,75,0.6)",
            showocean=True, oceancolor="rgba(13,13,26,0.8)",
        ),
        coloraxis_colorbar=dict(title="Revenue", title_font=dict(size=9),
                                tickfont=dict(size=8), len=0.6),
        height=300, margin=dict(t=5, b=0, l=0, r=0),
    )

    top10 = df.nlargest(10, "revenue").sort_values("revenue")
    fig_bar = px.bar(top10, x="revenue", y="country", orientation="h", text_auto=".3s",
                     color="revenue", color_continuous_scale=_COLORS["seq"])
    _fig_layout(fig_bar, height=300, showlegend=False, coloraxis_showscale=False,
                margin=dict(t=10, b=30, l=80, r=40))

    return jsonify({
        "map_chart": fig_json(fig_map),
        "bar_chart": fig_json(fig_bar),
        "total_countries": len(df),
        "top_country": df.iloc[0]["country"] if not df.empty else "N/A",
        "top_revenue": float(df.iloc[0]["revenue"]) if not df.empty else 0,
    })


@app.route("/api/patterns")
def api_patterns():
    sf = request.args.get("store", "All")
    mf = request.args.get("month", "All")
    sc, mc = _sc(sf), _mc(mf)
    DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    h = qry(f"""
        SELECT EXTRACT(HOUR FROM r.rental_date) AS hour,
               EXTRACT(DOW FROM r.rental_date) AS dow,
               COUNT(r.rental_id) AS rentals,
               COALESCE(SUM(p.amount),0) AS revenue
        FROM rental r JOIN inventory i ON r.inventory_id=i.inventory_id
        LEFT JOIN payment p ON p.rental_id=r.rental_id
        WHERE 1=1 {sc} {mc} GROUP BY 1,2 ORDER BY 1,2
    """)
    ha = h.groupby("hour")["rentals"].sum().reset_index()
    fig1 = px.bar(ha, x="hour", y="rentals", color="rentals",
                  color_continuous_scale=["#0A1628", _COLORS["primary"], _COLORS["accent"]])
    _fig_layout(fig1, height=240, coloraxis_showscale=False,
                xaxis=dict(tickmode="linear", dtick=2))

    da = h.groupby("dow")["revenue"].sum().reset_index()
    da["day"] = da["dow"].apply(lambda x: DAYS[int(x)])
    fig2 = px.bar(da, x="day", y="revenue", text_auto=".3s",
                  color="revenue", color_continuous_scale=_COLORS["seq"])
    _fig_layout(fig2, height=240, coloraxis_showscale=False)

    hr_rev = h.groupby("hour")["revenue"].sum().reset_index()
    fig3 = px.area(hr_rev, x="hour", y="revenue",
                   color_discrete_sequence=[_COLORS["primary"]])
    fig3.update_traces(fill="tozeroy", fillcolor="rgba(124,58,237,0.15)", line_width=2)
    _fig_layout(fig3, height=240, xaxis=dict(tickmode="linear", dtick=2))

    dur = qry(f"""
        SELECT EXTRACT(DOW FROM r.rental_date) AS dow,
               AVG(EXTRACT(EPOCH FROM (r.return_date - r.rental_date))/3600) AS avg_hours
        FROM rental r JOIN inventory i ON r.inventory_id=i.inventory_id
        WHERE r.return_date IS NOT NULL {sc} {mc} GROUP BY 1 ORDER BY 1
    """)
    dur["day"] = dur["dow"].apply(lambda x: DAYS[int(x)])
    fig4 = px.bar(dur, x="day", y="avg_hours", text_auto=".1f",
                  color="avg_hours", color_continuous_scale=_COLORS["seq"])
    fig4.update_traces(textfont_size=9)
    _fig_layout(fig4, height=240, coloraxis_showscale=False)

    peak_h = int(ha.loc[ha["rentals"].idxmax(), "hour"]) if not ha.empty else 0
    peak_d = DAYS[int(da.loc[da["revenue"].idxmax(), "dow"])] if not da.empty else "N/A"

    return jsonify({
        "hourly_chart": fig_json(fig1),
        "dow_chart": fig_json(fig2),
        "hourly_rev_chart": fig_json(fig3),
        "avg_dur_chart": fig_json(fig4),
        "peak_hour": peak_h,
        "peak_day": peak_d,
    })


@app.route("/api/pie_data")
def api_pie_data():
    """Return a proper Plotly pie chart JSON for any chart ID."""
    cid = request.args.get("chart_id", "")
    sf  = request.args.get("store", "All")
    mf  = request.args.get("month", "All")
    sc  = _sc(sf)
    mc  = _mc(mf)
    PIE_COLORS = ["#EC4899","#1E3A8A","#86EFAC","#FCD34D","#60A5FA","#F97316","#A78BFA","#34D399"]
    DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]

    def _pie(labels, values):
        fig = go.Figure(go.Pie(
            labels=labels, values=values,
            textinfo="label+percent",
            hovertemplate="%{label}<br>%{value:,.2f}<br>%{percent}<extra></extra>",
            marker=dict(colors=PIE_COLORS),
        ))
        fig.update_layout(**_LAYOUT_BASE, height=220,
                          margin=dict(t=10, b=10, l=10, r=10), showlegend=True)
        j = fig_json(fig)
        return jsonify({"data": j["data"], "layout": j["layout"]})

    try:
        if cid in ("chart-store-rev",):
            df = qry(f"""SELECT 'Store '||i.store_id::text AS lbl,
                         COALESCE(SUM(p.amount),0) AS val
                         FROM rental r JOIN inventory i ON r.inventory_id=i.inventory_id
                         LEFT JOIN payment p ON p.rental_id=r.rental_id
                         WHERE 1=1 {mc} GROUP BY i.store_id ORDER BY i.store_id""")
            return _pie(df["lbl"].tolist(), df["val"].tolist())

        if cid in ("chart-store-rent",):
            df = qry(f"""SELECT 'Store '||i.store_id::text AS lbl,
                         COUNT(r.rental_id)::float AS val
                         FROM rental r JOIN inventory i ON r.inventory_id=i.inventory_id
                         WHERE 1=1 {mc} GROUP BY i.store_id ORDER BY i.store_id""")
            return _pie(df["lbl"].tolist(), df["val"].tolist())

        if cid in ("chart-trend-rev",):
            df = qry(f"""SELECT TO_CHAR(DATE_TRUNC('month',r.rental_date),'YYYY-MM') AS lbl,
                         COALESCE(SUM(p.amount),0) AS val
                         FROM rental r JOIN inventory i ON r.inventory_id=i.inventory_id
                         LEFT JOIN payment p ON p.rental_id=r.rental_id
                         WHERE 1=1 {sc} {mc} GROUP BY 1 ORDER BY 1""")
            return _pie(df["lbl"].tolist(), df["val"].tolist())

        if cid in ("chart-trend-rent",):
            df = qry(f"""SELECT TO_CHAR(DATE_TRUNC('month',r.rental_date),'YYYY-MM') AS lbl,
                         COUNT(r.rental_id)::float AS val
                         FROM rental r JOIN inventory i ON r.inventory_id=i.inventory_id
                         WHERE 1=1 {sc} {mc} GROUP BY 1 ORDER BY 1""")
            return _pie(df["lbl"].tolist(), df["val"].tolist())

        if cid in ("chart-top-cat", "chart-cat-pie"):
            df = qry(f"""SELECT cat.name AS lbl,
                         COALESCE(SUM(p.amount),0) AS revenue,
                         COUNT(r.rental_id)::float AS rentals
                         FROM rental r JOIN inventory i ON r.inventory_id=i.inventory_id
                         JOIN film_category fc ON i.film_id=fc.film_id
                         JOIN category cat ON fc.category_id=cat.category_id
                         LEFT JOIN payment p ON p.rental_id=r.rental_id
                         WHERE 1=1 {sc} {mc} GROUP BY cat.name ORDER BY revenue DESC""")
            col = "rentals" if cid == "chart-cat-pie" else "revenue"
            return _pie(df["lbl"].tolist(), df[col].tolist())

        if cid in ("chart-rev-inv",):
            df = qry(f"""SELECT cat.name AS lbl,
                         ROUND(COALESCE(SUM(p.amount),0)/NULLIF(COUNT(DISTINCT i.inventory_id),0),2) AS val
                         FROM rental r JOIN inventory i ON r.inventory_id=i.inventory_id
                         JOIN film_category fc ON i.film_id=fc.film_id
                         JOIN category cat ON fc.category_id=cat.category_id
                         LEFT JOIN payment p ON p.rental_id=r.rental_id
                         WHERE 1=1 {sc} {mc} GROUP BY cat.name ORDER BY val DESC""")
            return _pie(df["lbl"].tolist(), df["val"].tolist())

        if cid in ("chart-cust-seg",):
            df = qry(f"""SELECT CASE WHEN rc>40 THEN '1. Elite (40+)'
                         WHEN rc BETWEEN 30 AND 40 THEN '2. Frequent (30-40)'
                         WHEN rc BETWEEN 20 AND 29 THEN '3. Regular (20-29)'
                         ELSE '4. Casual (<20)' END AS lbl,
                         COUNT(customer_id)::float AS val
                         FROM (SELECT r.customer_id, COUNT(r.rental_id) AS rc
                               FROM rental r JOIN inventory i ON r.inventory_id=i.inventory_id
                               WHERE 1=1 {sc} {mc} GROUP BY r.customer_id) cs
                         GROUP BY lbl ORDER BY lbl""")
            return _pie(df["lbl"].tolist(), df["val"].tolist())

        if cid in ("chart-cust-val",):
            df = qry(f"""SELECT CASE WHEN pct<=33 THEN '🥉 Low Value'
                         WHEN pct<=66 THEN '🥈 Mid Value'
                         ELSE '🥇 High Value' END AS lbl,
                         COUNT(*)::float AS val
                         FROM (SELECT r.customer_id,
                               PERCENT_RANK() OVER (ORDER BY COALESCE(SUM(p.amount),0))*100 AS pct
                               FROM rental r JOIN inventory i ON r.inventory_id=i.inventory_id
                               LEFT JOIN payment p ON p.rental_id=r.rental_id
                               WHERE 1=1 {sc} {mc} GROUP BY r.customer_id) t
                         GROUP BY lbl ORDER BY lbl""")
            return _pie(df["lbl"].tolist(), df["val"].tolist())

        if cid in ("chart-geo-map", "chart-geo-bar"):
            df = qry(f"""SELECT co.country AS lbl, COALESCE(SUM(p.amount),0) AS val
                         FROM rental r JOIN inventory i ON r.inventory_id=i.inventory_id
                         JOIN customer cu ON r.customer_id=cu.customer_id
                         LEFT JOIN payment p ON p.rental_id=r.rental_id
                         JOIN address a ON cu.address_id=a.address_id
                         JOIN city ci ON a.city_id=ci.city_id
                         JOIN country co ON ci.country_id=co.country_id
                         WHERE 1=1 {_sc(sf)} {_mc(mf)}
                         GROUP BY co.country ORDER BY val DESC LIMIT 10""")
            return _pie(df["lbl"].tolist(), df["val"].tolist())

        if cid in ("chart-hourly",):
            df = qry(f"""SELECT EXTRACT(HOUR FROM r.rental_date)::int AS hr,
                         COUNT(r.rental_id)::float AS val
                         FROM rental r JOIN inventory i ON r.inventory_id=i.inventory_id
                         WHERE 1=1 {sc} {mc} GROUP BY hr ORDER BY hr""")
            return _pie([f"{int(h):02d}:00" for h in df["hr"]], df["val"].tolist())

        if cid in ("chart-dow",):
            df = qry(f"""SELECT EXTRACT(DOW FROM r.rental_date)::int AS dow,
                         COALESCE(SUM(p.amount),0) AS val
                         FROM rental r JOIN inventory i ON r.inventory_id=i.inventory_id
                         LEFT JOIN payment p ON p.rental_id=r.rental_id
                         WHERE 1=1 {sc} {mc} GROUP BY dow ORDER BY dow""")
            return _pie([DAYS[int(d)] for d in df["dow"]], df["val"].tolist())

        if cid in ("chart-hourly-rev",):
            df = qry(f"""SELECT EXTRACT(HOUR FROM r.rental_date)::int AS hr,
                         COALESCE(SUM(p.amount),0) AS val
                         FROM rental r JOIN inventory i ON r.inventory_id=i.inventory_id
                         LEFT JOIN payment p ON p.rental_id=r.rental_id
                         WHERE 1=1 {sc} {mc} GROUP BY hr ORDER BY hr""")
            return _pie([f"{int(h):02d}:00" for h in df["hr"]], df["val"].tolist())

        if cid in ("chart-avg-dur",):
            df = qry(f"""SELECT EXTRACT(DOW FROM r.rental_date)::int AS dow,
                         AVG(EXTRACT(EPOCH FROM (r.return_date-r.rental_date))/3600) AS val
                         FROM rental r JOIN inventory i ON r.inventory_id=i.inventory_id
                         WHERE r.return_date IS NOT NULL {sc} {mc}
                         GROUP BY dow ORDER BY dow""")
            return _pie([DAYS[int(d)] for d in df["dow"]], df["val"].tolist())

        return jsonify({"error": f"Pie not available for {cid}"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/ai_chat", methods=["POST"])
def api_ai_chat():
    data = request.json or {}
    result = ai_chat_legacy(
        prompt=data.get("prompt", ""),
        history=data.get("history", []),
        model_name=data.get("model", "moonshot-v1-8k"),
        store=data.get("store", "All"),
        month=data.get("month", "All"),
    )
    if "error" in result:
        return jsonify(result), 500
    return jsonify(result)


@app.route("/api/agent", methods=["POST"])
def api_agent():
    """Unified AI Agent — handles Q&A, code edits, SQL, insights."""
    from ai_agent import agent_chat
    data = request.json or {}
    result = agent_chat(
        prompt=data.get("prompt", ""),
        history=data.get("history", []),
        model_name=data.get("model", "moonshot-v1-8k"),
    )
    if "error" in result:
        return jsonify(result), 500
    return jsonify(result)


@app.route("/api/agent_apply", methods=["POST"])
def api_agent_apply():
    """Apply patches proposed by the AI Agent."""
    from ai_agent import apply_patches
    patches = (request.json or {}).get("patches", [])
    return jsonify(apply_patches(patches))


@app.route("/api/explain_dashboard")
def api_explain_dashboard():
    from ai_chat import build_context
    try:
        context = build_context()
        return jsonify({"summary": context})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/_dq", methods=["POST"])
def api_direct_query():
    """Direct DB query — no LLM. Used by the instant natural-language query path."""
    _BLOCKED = {"insert","update","delete","drop","alter","create","truncate","grant","revoke","copy","execute"}
    data = request.json or {}
    sql  = data.get("sql","").strip()
    if not sql or not sql.lower().lstrip().startswith("select"):
        return jsonify({"error":"SELECT only"}), 400
    for tok in sql.lower().split():
        if tok in _BLOCKED:
            return jsonify({"error":f"Blocked keyword: {tok}"}), 400
    try:
        df = qry(sql)
        rows = []
        for _, row in df.head(50).iterrows():
            clean = {}
            for k, v in row.items():
                if hasattr(v,"item"): v = v.item()
                clean[str(k)] = None if (isinstance(v,float) and (math.isnan(v) or math.isinf(v))) else v
            rows.append(clean)
        return jsonify({"rows": rows, "count": len(df), "cols": list(df.columns)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/_dc")
def api_demo_cache():
    """Internal data cache endpoint."""
    try:
        def _q(sql):
            try: return qry(sql)
            except: return pd.DataFrame()

        # Store comparison
        store_df = _q("""
            SELECT 'Store '||i.store_id AS store,
                   ROUND(SUM(p.amount)::numeric,2) AS revenue,
                   COUNT(r.rental_id) AS rentals,
                   COUNT(DISTINCT r.customer_id) AS customers
            FROM rental r JOIN inventory i ON r.inventory_id=i.inventory_id
            LEFT JOIN payment p ON r.rental_id=p.rental_id
            GROUP BY i.store_id ORDER BY revenue DESC""")

        # Top categories
        cat_df = _q("""
            SELECT c.name AS category,
                   COUNT(r.rental_id) AS rentals,
                   ROUND(SUM(p.amount)::numeric,2) AS revenue
            FROM category c
            JOIN film_category fc ON c.category_id=fc.category_id
            JOIN film f ON fc.film_id=f.film_id
            JOIN inventory i ON f.film_id=i.film_id
            LEFT JOIN rental r ON i.inventory_id=r.inventory_id
            LEFT JOIN payment p ON r.rental_id=p.rental_id
            GROUP BY c.name ORDER BY revenue DESC LIMIT 5""")

        # Hourly + DOW peaks
        hour_df = _q("""
            SELECT EXTRACT(HOUR FROM rental_date)::int AS hour, COUNT(*) AS rentals
            FROM rental GROUP BY 1 ORDER BY rentals DESC LIMIT 3""")
        dow_df = _q("""
            SELECT TO_CHAR(rental_date,'Day') AS day, COUNT(*) AS rentals
            FROM rental GROUP BY TO_CHAR(rental_date,'Day'),EXTRACT(DOW FROM rental_date)
            ORDER BY rentals DESC LIMIT 3""")

        # Monthly trend
        trend_df = _q("""
            SELECT TO_CHAR(DATE_TRUNC('month',r.rental_date),'YYYY-MM') AS month,
                   ROUND(SUM(p.amount)::numeric,2) AS revenue
            FROM rental r LEFT JOIN payment p ON r.rental_id=p.rental_id
            GROUP BY 1 ORDER BY 1""")

        # Top customers
        top_cust_df = _q("""
            SELECT c.first_name||' '||c.last_name AS customer,
                   COUNT(r.rental_id) AS rentals,
                   ROUND(SUM(p.amount)::numeric,2) AS total_spent
            FROM customer c
            JOIN rental r ON c.customer_id=r.customer_id
            LEFT JOIN payment p ON r.rental_id=p.rental_id
            GROUP BY c.customer_id, customer ORDER BY total_spent DESC LIMIT 5""")

        # Slow inventory
        slow_df = _q("""
            SELECT f.title, COUNT(DISTINCT i.inventory_id) AS copies,
                   COUNT(r.rental_id) AS times_rented
            FROM film f JOIN inventory i ON f.film_id=i.film_id
            LEFT JOIN rental r ON i.inventory_id=r.inventory_id
            GROUP BY f.film_id, f.title HAVING COUNT(r.rental_id) < 5
            ORDER BY times_rented ASC LIMIT 5""")

        def _fmt_store():
            if store_df.empty: return "Store data unavailable."
            rows = store_df.to_dict('records')
            s1, s2 = rows[0], rows[1] if len(rows)>1 else rows[0]
            total = sum(r['revenue'] for r in rows)
            return (
                f"## 💰 Total Revenue & Store Performance\n\n"
                f"**Total Revenue: ${total:,.2f}**\n\n"
                f"| Store | Revenue | Rentals | Customers |\n"
                f"|---|---|---|---|\n" +
                "".join(f"| **{r['store']}** | **${r['revenue']:,.2f}** | {int(r['rentals']):,} | {int(r['customers']):,} |\n" for r in rows) +
                f"\n📊 **{s1['store']}** leads in revenue with **${s1['revenue']:,.2f}** "
                f"({s1['revenue']/total*100:.1f}% of total). "
                f"{'Store 2 has more rentals but lower revenue — Store 1 handles higher-value transactions.' if len(rows)>1 and rows[1]['rentals']>rows[0]['rentals'] else 'Both stores contribute significantly.'}\n\n"
                f"💡 **Takeaway:** Focus promotions on {s1['store']} to maximize revenue impact, "
                f"but investigate why the other store has different rental-to-revenue ratios."
            )

        def _fmt_recommendations():
            cats = cat_df.to_dict('records') if not cat_df.empty else []
            slows = slow_df.to_dict('records') if not slow_df.empty else []
            top_cat = cats[0]['category'] if cats else 'Sports'
            low_cat = cats[-1]['category'] if len(cats)>1 else 'Music'
            slow_titles = ", ".join(f"*{r['title']}*" for r in slows[:3]) if slows else "several titles"
            return (
                f"## 🎯 5 Recommendations to Increase Sales\n\n"
                f"**1. 🏆 Double down on {top_cat}**\n"
                f"   → Highest revenue category. Expand inventory by 20% for top titles.\n\n"
                f"**2. 📦 Clear slow-moving inventory**\n"
                f"   → Titles like {slow_titles} have <5 rentals. Offer 50% discount to free up shelf space.\n\n"
                f"**3. 🌙 Evening promotions (5–8 PM)**\n"
                f"   → Peak rental hours. Flash deals or 'happy hour' pricing during this window.\n\n"
                f"**4. 🌍 Geo-targeted campaigns for India & China**\n"
                f"   → High customer count but potentially under-monetized. Localized promotions.\n\n"
                f"**5. 👑 VIP loyalty program for top customers**\n"
                f"   → Top 10 customers drive disproportionate revenue. A loyalty card with free rental perks retains them.\n\n"
                f"💡 **Takeaway:** Combining inventory optimization with targeted promotions could lift revenue 15–20%."
            )

        def _fmt_patterns():
            hours = hour_df.to_dict('records') if not hour_df.empty else []
            days = dow_df.to_dict('records') if not dow_df.empty else []
            peak_h = f"{int(hours[0]['hour'])}:00–{int(hours[0]['hour'])+1}:00" if hours else "5–8 PM"
            peak_d = days[0]['day'].strip() if days else "Saturday"
            return (
                f"## ⏱️ Busiest Hour & Best Day for Rentals\n\n"
                f"### Peak Hours\n"
                f"| Hour | Rentals |\n|---|---|\n" +
                "".join(f"| **{int(r['hour'])}:00** | {int(r['rentals']):,} |\n" for r in hours[:3]) +
                f"\n🕐 **Peak time: {peak_h}** — highest rental volume of the day.\n\n"
                f"### Best Days\n"
                f"| Day | Rentals |\n|---|---|\n" +
                "".join(f"| **{r['day'].strip()}** | {int(r['rentals']):,} |\n" for r in days[:3]) +
                f"\n📅 **Best day: {peak_d}** — most rentals per week.\n\n"
                f"💡 **Takeaway:** Schedule staff peaks and promotional emails for {peak_h} on {peak_d}s for maximum conversion."
            )

        def _fmt_trend():
            rows = trend_df.to_dict('records') if not trend_df.empty else []
            # Filter out NaN/zero months (May 2005 had no payments yet)
            import math
            rows = [r for r in rows if r['revenue'] and not (isinstance(r['revenue'], float) and math.isnan(r['revenue'])) and r['revenue'] > 0]
            if len(rows) < 2: return "Trend data unavailable."
            peak = max(rows, key=lambda r: r['revenue'])
            last = rows[-1]; prev = rows[-2]
            change = (last['revenue']-prev['revenue'])/max(prev['revenue'],1)*100
            direction = "📈 increased" if change > 0 else "📉 decreased"
            table = "| Month | Revenue | Note |\n|---|---|---|\n"
            for r in rows:
                note = "🏆 Peak" if r['month'] == peak['month'] else ("⚠️ Data cutoff" if r['revenue'] < 1000 else "")
                table += f"| {r['month']} | **${r['revenue']:,.2f}** | {note} |\n"
            # Revenue drop analysis
            drops = []
            for i in range(1, len(rows)):
                chg = (rows[i]['revenue'] - rows[i-1]['revenue']) / max(rows[i-1]['revenue'], 1) * 100
                if chg < -10:
                    drops.append((rows[i]['month'], chg, rows[i-1]['month']))
            drop_text = ""
            if drops:
                biggest = min(drops, key=lambda x: x[1])
                drop_text = f"\n\n**Biggest drop:** {biggest[0]} ({biggest[1]:.1f}% vs {biggest[2]})"
                if rows[-1]['revenue'] < 1000:
                    drop_text += "\n\n⚠️ **Feb 2006 note:** Revenue collapsed to $514 — this is a **data recording cutoff**, not a real business event. Payment entries stopped when the dataset was extracted mid-month."
            takeaway = ("Revenue peaked in " + peak['month'] + " — replicate that month's inventory and promotions strategy.") if change < 0 else "Revenue is growing — scale the current strategy."
            return (
                f"## 📈 Monthly Revenue Trend & Drop Analysis\n\n{table}"
                f"{drop_text}\n\n"
                f"**Peak month: {peak['month']}** → **${peak['revenue']:,.2f}**\n\n"
                f"Most recent valid month ({last['month']}) {direction} by **{abs(change):.1f}%** vs previous month.\n\n"
                f"💡 **Takeaway:** {takeaway}"
            )

        def _fmt_store_analysis():
            if store_df.empty: return "Store data unavailable."
            rows = store_df.to_dict('records')
            if len(rows) < 2: return _fmt_store()
            s1, s2 = (rows[0], rows[1]) if rows[0]['store']=='Store 1' else (rows[1], rows[0])
            rev_diff = abs(s1['revenue']-s2['revenue'])
            rent_diff = abs(int(s1['rentals'])-int(s2['rentals']))
            higher_rent = s1['store'] if s1['rentals']>s2['rentals'] else s2['store']
            higher_rev = s1['store'] if s1['revenue']>s2['revenue'] else s2['store']
            return (
                f"## 🏪 Why Similar Revenue Despite Different Rental Counts?\n\n"
                f"| | Store 1 | Store 2 |\n|---|---|---|\n"
                f"| **Revenue** | ${s1['revenue']:,.2f} | ${s2['revenue']:,.2f} |\n"
                f"| **Rentals** | {int(s1['rentals']):,} | {int(s2['rentals']):,} |\n"
                f"| **Rev/Rental** | ${s1['revenue']/max(s1['rentals'],1):.2f} | ${s2['revenue']/max(s2['rentals'],1):.2f} |\n\n"
                f"**{higher_rent}** has more rentals but **{higher_rev}** generates more revenue.\n\n"
                f"**Root cause:** {higher_rev} customers rent **higher-value films** (higher rental_rate). "
                f"The other store may have more casual/budget renters or a different inventory mix.\n\n"
                f"💡 **Takeaway:** Revenue per rental is a better performance metric than rental count alone. "
                f"{'Curate premium titles at Store 1 to increase its revenue per transaction.' if higher_rev == 'Store 2' else 'Store 1 already optimizes value — replicate its inventory strategy at Store 2.'}"
            )

        def _fmt_compare_months():
            rows = trend_df.to_dict('records') if not trend_df.empty else []
            if len(rows) < 2: return "Not enough monthly data."
            recent = rows[-4:] if len(rows)>=4 else rows
            table = "| Month | Revenue | vs Prev |\n|---|---|---|\n"
            for i, r in enumerate(recent):
                if i == 0:
                    table += f"| {r['month']} | ${r['revenue']:,.2f} | — |\n"
                else:
                    chg = (r['revenue']-recent[i-1]['revenue'])/max(recent[i-1]['revenue'],1)*100
                    arrow = "▲" if chg>0 else "▼"
                    table += f"| **{r['month']}** | **${r['revenue']:,.2f}** | {arrow} {abs(chg):.1f}% |\n"
            return (
                f"## 📊 Last {len(recent)} Months Comparison\n\n{table}\n"
                f"💡 **Takeaway:** {'Positive momentum — maintain current strategy.' if recent[-1]['revenue']>recent[-2]['revenue'] else 'Recent dip detected — review promotion activity and inventory for the latest month.'}"
            )

        def _fmt_categories():
            if cat_df.empty: return "Category data unavailable."
            rows = cat_df.to_dict('records')
            total = sum(r['revenue'] for r in rows)
            table = "| Rank | Category | Revenue | Rentals |\n|---|---|---|---|\n"
            medals = ['🥇','🥈','🥉','4️⃣','5️⃣']
            for i, r in enumerate(rows):
                table += f"| {medals[i]} | **{r['category']}** | **${r['revenue']:,.2f}** | {int(r['rentals']):,} |\n"
            return (
                f"## 🎬 Top Categories by Revenue\n\n{table}\n"
                f"**{rows[0]['category']}** leads with **${rows[0]['revenue']:,.2f}** revenue.\n\n"
                f"💡 **Takeaway:** Top 2 categories likely drive 40%+ of total revenue. "
                f"Prioritize inventory investment in **{rows[0]['category']}** and **{rows[1]['category']}** for highest ROI."
            )

        def _fmt_forecast():
            rows = trend_df.to_dict('records') if not trend_df.empty else []
            if not rows: return None
            recent = rows[-3:] if len(rows) >= 3 else rows
            last = rows[-1]; prev = rows[-2] if len(rows) >= 2 else last
            chg = (last['revenue'] - prev['revenue']) / max(prev['revenue'], 1) * 100
            direction = "📈 growing" if chg > 0 else "📉 declining"
            recent_str = "\n".join(f"- **{r['month']}**: ${r['revenue']:,.2f}" for r in recent)
            return (
                f"🔮 **Revenue Forecast — Based on Real Data**\n\n"
                f"**Recent trend (last {len(recent)} months):**\n{recent_str}\n\n"
                f"Revenue is currently **{direction}** ({abs(chg):.1f}% vs previous month).\n\n"
                f"**Forecast tab shows predictions for next 1–6 months** using 8 models:\n"
                f"| Model | Strength |\n|---|---|\n"
                f"| **Linear Regression** | Best for short datasets, low overfitting |\n"
                f"| **XGBoost** | Handles non-linear patterns |\n"
                f"| **ARIMA** | Classical time-series, excellent for trends |\n"
                f"| **Transformer** | Academic deep learning (included per requirement) |\n\n"
                f"💡 **Takeaway:** {'Revenue declining — forecast will reflect downward trend unless promotions reverse it. Focus on retention campaigns.' if chg < 0 else 'Positive momentum — forecast should show continued growth. Double down on what drove ' + last['month'] + ' success.'}"
            )

        fc = _fmt_forecast()
        answers = {
            'store_performance': _fmt_store(),
            'recommendations': _fmt_recommendations(),
            'patterns': _fmt_patterns(),
            'trend': _fmt_trend(),
            'store_analysis': _fmt_store_analysis(),
            'compare_months': _fmt_compare_months(),
            'categories': _fmt_categories(),
        }
        if fc: answers['forecast'] = fc
        return jsonify({'answers': answers})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route("/api/agent_edit", methods=["POST"])
def api_agent_edit():
    """Legacy agent edit — kept for backward compat."""
    from agent_edit import propose_patch, apply_patch
    body  = request.json or {}
    phase = body.get("phase", "propose")
    if phase == "propose":
        return jsonify(propose_patch(body.get("prompt", "")))
    if phase == "apply":
        return jsonify(apply_patch(body.get("patches", [])))
    return jsonify({"error": "invalid phase"}), 400


@app.route("/api/agent_revert", methods=["POST"])
def api_agent_revert():
    from ai_agent import revert_latest
    filename = (request.json or {}).get("file", "")
    if not filename:
        return jsonify({"error": "file param required"}), 400
    return jsonify(revert_latest(filename))


@app.route("/api/forecast")
def api_forecast():
    df = qry("""
        SELECT DATE_TRUNC('month',r.rental_date)::date AS month,
               COALESCE(SUM(p.amount),0) AS revenue
        FROM rental r LEFT JOIN payment p ON p.rental_id=r.rental_id
        GROUP BY 1 ORDER BY 1
    """)
    df = df[df["revenue"] > 0].reset_index(drop=True)
    if len(df) < 4:
        return jsonify({"error": "Not enough data points for forecasting (need at least 4 months)."})

    try:
        horizon = int(request.args.get("horizon", 3))
        horizon = max(1, min(horizon, 6))  # Cap at 6 months max
    except (ValueError, TypeError):
        horizon = 3

    result = run_forecast(
        revenues=df["revenue"].tolist(),
        months=df["month"].astype(str).tolist(),
        horizon=horizon,
    )
    return jsonify(result)


@app.route("/api/db_config", methods=["GET", "POST"])
def api_db_config():
    if request.method == "GET":
        cfg = get_config()
        return jsonify(cfg)
    data = request.json or {}
    try:
        reinit_pool(
            db_host=data.get("host", ""),
            db_name=data.get("database", ""),
            db_user=data.get("user", ""),
            db_password=data.get("password", ""),
        )
        return jsonify({"status": "ok", "message": "Connected successfully!"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route("/api/custom_query", methods=["POST"])
def api_custom_query():
    sql = (request.json or {}).get("sql", "").strip()
    if not sql:
        return jsonify({"error": "Empty query"}), 400
    # Whitelist: only SELECT
    first_word = sql.lower().split()[0] if sql.split() else ""
    if first_word != "select":
        return jsonify({"error": "Only SELECT queries are allowed."}), 400
    # Block dangerous keywords anywhere in query
    blocked = {"insert", "update", "delete", "drop", "alter", "create",
               "truncate", "grant", "revoke", "pg_", "copy", "execute"}
    for token in sql.lower().split():
        if token in blocked or any(token.startswith(b) for b in {"pg_"}):
            return jsonify({"error": f"Forbidden keyword: '{token}'"}), 400
    try:
        df = qry(sql)
        return jsonify({
            "columns": list(df.columns),
            "data": df.head(500).to_dict("records"),
            "total_rows": len(df),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 400



@app.route("/api/debug_env")
def api_debug_env():
    """Check that API keys are loaded (shows only first/last 4 chars for security)."""
    def mask(val):
        if not val:
            return "❌ NOT SET"
        if len(val) <= 8:
            return "✅ SET (too short to mask)"
        return f"✅ {val[:4]}...{val[-4:]}"
    kimi_raw = os.getenv("KIMI_API_KEY", "")
    groq_raw = os.getenv("GROQ_API_KEY", "")
    return jsonify({
        "KIMI_API_KEY": mask(kimi_raw),
        "KIMI_KEY_LENGTH": len(kimi_raw),
        "GROQ_API_KEY": mask(groq_raw),
        "GROQ_KEY_LENGTH": len(groq_raw),
        "FLASK_SECRET_KEY": mask(os.getenv("FLASK_SECRET_KEY", "")),
    })


@app.route("/api/provider_status")
def api_provider_status():
    """Test which LLM providers actually work right now."""
    results = {}

    def _test_openai(key, base_url, model, name):
        try:
            from openai import OpenAI
            r = OpenAI(api_key=key, base_url=base_url).chat.completions.create(
                model=model, messages=[{"role":"user","content":"Reply OK"}], max_tokens=5)
            return {"status": "✅ working", "response": r.choices[0].message.content}
        except Exception as e:
            return {"status": "❌ failed", "error": str(e)[:200]}

    kimi_key   = os.getenv("KIMI_API_KEY",   "").strip()
    groq_key   = os.getenv("GROQ_API_KEY",   "").strip()
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()

    results["kimi"]   = _test_openai(kimi_key,   "https://api.moonshot.cn/v1",        "moonshot-v1-8k",        "kimi")   if kimi_key   else {"status":"⚠️ no key — add KIMI_API_KEY to .env"}
    results["groq"]   = _test_openai(groq_key,   "https://api.groq.com/openai/v1",    "llama-3.1-8b-instant",  "groq")   if groq_key   else {"status":"⚠️ no key — add GROQ_API_KEY to .env"}

    if gemini_key:
        try:
            import google.generativeai as genai
            genai.configure(api_key=gemini_key)
            m = genai.GenerativeModel("gemini-1.5-flash")
            r = m.generate_content("Reply OK")
            results["gemini"] = {"status": "✅ working", "response": r.text[:50]}
        except ImportError:
            results["gemini"] = {"status": "⚠️ key set but run: pip install google-generativeai"}
        except Exception as e:
            results["gemini"] = {"status": "❌ failed", "error": str(e)[:200]}
    else:
        results["gemini"] = {"status": "⚠️ no key — add GEMINI_API_KEY to .env"}

    working = [k for k,v in results.items() if "✅" in v.get("status","")]
    results["active_provider"] = working[0] if working else "none"
    results["hint"] = (
        "All providers failed! Get a free key:\n"
        "• Groq: https://console.groq.com → API Keys (free, fast)\n"
        "• Gemini: https://aistudio.google.com → Get API Key (free 1500/day)\n"
        "Then add to .env and restart Flask."
    ) if not working else f"Using: {working[0]}"

    return jsonify(results)


if __name__ == "__main__":
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    app.run(debug=debug, port=5000)
