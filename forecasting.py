"""
forecasting.py — Multi-model revenue forecasting engine (v2 — improved accuracy).
Models: PyTorch Transformer (improved), LSTM, XGBoost, ARIMA, Random Forest,
        Decision Tree, Linear Regression, Moving Average.
Includes: confidence intervals, ensemble, leaderboard, residual analysis,
          AI-powered ML interpretation.
"""
import math
import warnings
import numpy as np
import torch
import torch.nn as nn
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.tree import DecisionTreeRegressor
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.preprocessing import MinMaxScaler

# ── Configuration ─────────────────────────────────────
SEQ_LEN          = 6      # longer context window
FORECAST_HORIZON = 6      # default & max horizon
EPOCHS           = 500    # more training
LR               = 5e-3
D_MODEL          = 32     # larger model
D_FF             = 64
N_HEADS          = 4      # more attention heads
N_LAYERS         = 2      # deeper transformer
PATIENCE         = 40     # more patience
RANDOM_SEED      = 42

np.random.seed(RANDOM_SEED)
torch.manual_seed(RANDOM_SEED)


# ── NaN-safe helper ───────────────────────────────────
def _safe(v):
    if v is None:
        return None
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


# ═══════════════════════════════════════════════════════
#  Improved PyTorch Transformer with positional encoding
# ═══════════════════════════════════════════════════════

class PositionalEncoding(nn.Module):
    def __init__(self, d_model, max_len=64, dropout=0.1):
        super().__init__()
        self.dropout = nn.Dropout(dropout)
        pe = torch.zeros(max_len, d_model)
        pos = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
        div = torch.exp(torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model))
        pe[:, 0::2] = torch.sin(pos * div)
        pe[:, 1::2] = torch.cos(pos * div)
        self.register_buffer('pe', pe.unsqueeze(0))

    def forward(self, x):
        x = x + self.pe[:, :x.size(1), :]
        return self.dropout(x)


class PyTorchTransformer(nn.Module):
    def __init__(self, d_model=D_MODEL, nhead=N_HEADS, dim_feedforward=D_FF, n_layers=N_LAYERS):
        super().__init__()
        self.input_proj = nn.Sequential(
            nn.Linear(1, d_model),
            nn.LayerNorm(d_model),
        )
        self.pos_enc = PositionalEncoding(d_model, dropout=0.1)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model, nhead=nhead, dim_feedforward=dim_feedforward,
            batch_first=True, dropout=0.1, norm_first=True  # pre-norm for stability
        )
        self.encoder = nn.TransformerEncoder(encoder_layer, num_layers=n_layers,
                                              enable_nested_tensor=False)
        self.head = nn.Sequential(
            nn.Linear(d_model, d_model // 2),
            nn.GELU(),
            nn.Dropout(0.1),
            nn.Linear(d_model // 2, 1),
        )

    def forward(self, x):
        x = x.unsqueeze(-1)           # (B, T, 1)
        x = self.input_proj(x)        # (B, T, d_model)
        x = self.pos_enc(x)
        x = self.encoder(x)
        return self.head(x[:, -1, :]).squeeze(-1)

    def total_params(self):
        return sum(p.numel() for p in self.parameters())

    def predict_one(self, seq: np.ndarray) -> float:
        self.eval()
        with torch.no_grad():
            x = torch.FloatTensor(seq).unsqueeze(0)
            return self(x).item()


# ═══════════════════════════════════════════════════════
#  LSTM Forecaster (improved)
# ═══════════════════════════════════════════════════════

class LSTMForecaster(nn.Module):
    def __init__(self, input_size=1, hidden_size=64, num_layers=2):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=input_size, hidden_size=hidden_size,
            num_layers=num_layers, batch_first=True, dropout=0.1,
        )
        self.fc = nn.Sequential(
            nn.LayerNorm(hidden_size),
            nn.Linear(hidden_size, 32), nn.GELU(), nn.Dropout(0.1),
            nn.Linear(32, 1),
        )

    def forward(self, x):
        x = x.unsqueeze(-1)
        out, _ = self.lstm(x)
        return self.fc(out[:, -1, :]).squeeze(-1)

    def total_params(self):
        return sum(p.numel() for p in self.parameters())

    def predict_one(self, seq: np.ndarray) -> float:
        self.eval()
        with torch.no_grad():
            x = torch.FloatTensor(seq).unsqueeze(0)
            return self(x).item()


# ── Improved NN training (cosine annealing + gradient clipping) ───────────────
def _train_nn(X_tr, y_tr, model, epochs=EPOCHS, lr=LR, patience=PATIENCE):
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
    criterion = nn.HuberLoss(delta=0.5)  # robust to outliers vs pure MSE
    X_t = torch.FloatTensor(X_tr)
    y_t = torch.FloatTensor(y_tr)
    best_loss, best_state, no_improve, losses = float('inf'), None, 0, []
    for _ in range(epochs):
        model.train()
        optimizer.zero_grad()
        loss = criterion(model(X_t), y_t)
        loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
        optimizer.step()
        scheduler.step()
        val = loss.item()
        losses.append(val)
        if val < best_loss - 1e-8:
            best_loss, no_improve = val, 0
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
        else:
            no_improve += 1
            if no_improve >= patience:
                break
    # restore best weights
    if best_state:
        model.load_state_dict(best_state)
    return losses


# ── Helpers ───────────────────────────────────────────
def _make_sequences(series, seq_len):
    X, y = [], []
    for i in range(len(series) - seq_len):
        X.append(series[i:i + seq_len])
        y.append(series[i + seq_len])
    return np.array(X), np.array(y)


def _mape(y_true, y_pred):
    mask = y_true != 0
    if mask.sum() == 0:
        return None
    return float(np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask])) * 100)


def _metrics(y_true, y_pred):
    if len(y_true) == 0 or len(y_pred) == 0:
        return {"mae": None, "rmse": None, "mape": None, "r2": None}
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    mae  = float(mean_absolute_error(y_true, y_pred))
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    mape = _mape(y_true, y_pred)
    if len(y_true) > 1:
        ss_res = float(np.sum((y_true - y_pred) ** 2))
        ss_tot = float(np.sum((y_true - y_true.mean()) ** 2))
        r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0
    else:
        r2 = None
    return {
        "mae":  _safe(round(mae, 2)),
        "rmse": _safe(round(rmse, 2)),
        "mape": _safe(round(mape, 2)) if mape is not None else None,
        "r2":   _safe(round(r2, 4)) if r2 is not None else None,
    }


def _build_leaderboard(metrics_dict, n_data=None):
    scores = []
    for name, m in metrics_dict.items():
        if m.get("mae") is None:
            scores.append({"model": name, "composite": None, **m})
            continue
        c = (0.4 * (m["mae"] / 1000) + 0.3 * ((m.get("rmse") or 0) / 1000)
             + 0.2 * ((m.get("mape") or 50) / 100) - 0.1 * max(m.get("r2") or 0, 0))
        # Transformer overfits on small datasets — penalise when fewer than 24 months
        if name == "transformer" and n_data is not None and n_data < 24:
            c *= 1.0 + max(0, (24 - n_data) / 12)
        scores.append({"model": name, "composite": _safe(round(c, 4)), **m})
    return sorted(scores, key=lambda x: x["composite"] if x["composite"] is not None else 999)


def _confidence_intervals(all_futures, horizon):
    available = [v for v in all_futures.values() if v and len(v) == horizon]
    if len(available) < 2:
        return {"ensemble": [], "lower": [], "upper": [], "std": []}
    arr = np.array(available, dtype=float)
    mean, std = arr.mean(axis=0), arr.std(axis=0)
    z = 1.96
    return {
        "ensemble": [_safe(round(v, 2)) for v in mean],
        "lower":    [_safe(round(v, 2)) for v in (mean - z * std)],
        "upper":    [_safe(round(v, 2)) for v in (mean + z * std)],
        "std":      [_safe(round(v, 2)) for v in std],
    }


# ── Optional model helpers ────────────────────────────
def _xgb_forecast(X_tr, y_tr, X_te, y_te, rev, seq_len, horizon, clip_lo, clip_hi):
    try:
        from xgboost import XGBRegressor
    except ImportError:
        return None, None, {"mae": None, "rmse": None, "mape": None, "r2": None}
    model = XGBRegressor(n_estimators=200, max_depth=4, learning_rate=0.05,
                         subsample=0.8, colsample_bytree=0.8,
                         random_state=RANDOM_SEED, verbosity=0)
    model.fit(X_tr, y_tr)
    X_all = np.vstack([X_tr, X_te]) if len(X_te) else X_tr
    fitted = model.predict(X_all).tolist()
    met = _metrics(y_te, model.predict(X_te)) if len(X_te) > 0 else {"mae": None, "rmse": None, "mape": None, "r2": None}
    w = list(rev)
    future = []
    for _ in range(horizon):
        p = float(model.predict(np.array(w[-seq_len:]).reshape(1, -1))[0])
        future.append(round(float(np.clip(p, clip_lo, clip_hi)), 2))
        w.append(p)
    return fitted, future, met


def _arima_forecast(rev, horizon, clip_lo, clip_hi, n_test=0):
    try:
        from statsmodels.tsa.arima.model import ARIMA
    except ImportError:
        return None, {"mae": None, "rmse": None, "mape": None, "r2": None}, {}
    _null_met = {"mae": None, "rmse": None, "mape": None, "r2": None}
    # Find best order on full series — more stable with small data
    best_aic, best_order = float('inf'), (1, 1, 1)
    for p in range(3):
        for q in range(3):
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    r = ARIMA(rev, order=(p, 1, q)).fit()
                if r.aic < best_aic:
                    best_aic, best_order = r.aic, (p, 1, q)
            except Exception:
                continue
    # Evaluate on held-out test split
    arima_metrics = dict(_null_met)
    if n_test > 0 and len(rev) > n_test + 2:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                res_tr = ARIMA(rev[:-n_test], order=best_order).fit()
            preds = np.clip(res_tr.forecast(steps=n_test), clip_lo, clip_hi)
            arima_metrics = _metrics(rev[-n_test:], preds)
        except Exception:
            pass
    # Full-data fit for future predictions
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            result = ARIMA(rev, order=best_order).fit()
        fc = result.forecast(steps=horizon)
        future = [round(float(np.clip(v, clip_lo, clip_hi)), 2) for v in fc]
        return future, arima_metrics, {"order": list(best_order), "aic": _safe(round(best_aic, 2))}
    except Exception:
        return None, arima_metrics, {}


# ══════════════════════════════════════════════════════
#  Public API
# ══════════════════════════════════════════════════════

def run_forecast(revenues: list, months: list, horizon: int = FORECAST_HORIZON) -> dict:
    np.random.seed(RANDOM_SEED)
    torch.manual_seed(RANDOM_SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(RANDOM_SEED)

    rev = np.array(revenues, dtype=float)
    n   = len(rev)
    if n < 4:
        return {"error": f"Need at least 4 data points, got {n}"}

    # ── Cap horizon to 6 months max ──
    horizon = max(1, min(horizon, 6))

    # Adaptive seq_len: use more history when available, min 3
    seq_len = min(max(3, min(6, n // 2)), n - 2)
    # Reduce seq_len if needed so we get ≥3 sequences (1 train + 2 test) for R²
    seq_len = min(seq_len, max(1, n - 3))

    # Normalise
    scaler = MinMaxScaler()
    norm   = scaler.fit_transform(rev.reshape(-1, 1)).flatten()

    # Sequences & split — keep at least 2 test points so R² can be computed
    X_all, y_all = _make_sequences(norm, seq_len)
    n_seqs = len(X_all)
    split  = max(1, min(int(n_seqs * 0.8), n_seqs - 2))
    X_tr, X_te  = X_all[:split], X_all[split:]
    y_tr, y_te  = y_all[:split], y_all[split:]
    has_test    = len(X_te) > 0

    rev_min, rev_max = float(rev.min()), float(rev.max())
    clip_lo, clip_hi = 0.3 * rev_min, 2.5 * rev_max

    # ── Helper: NN fitted + future ────────────────────
    def nn_pipeline(model, _losses):
        fitted_n = [model.predict_one(x) for x in X_all]
        fitted = scaler.inverse_transform(
            np.clip(fitted_n, -0.5, 1.5).reshape(-1, 1)
        ).flatten().tolist()
        if has_test:
            test_n = np.array([model.predict_one(x) for x in X_te])
            test_v = scaler.inverse_transform(np.clip(test_n, -0.5, 1.5).reshape(-1, 1)).flatten()
            y_te_o = scaler.inverse_transform(y_te.reshape(-1, 1)).flatten()
            met = _metrics(y_te_o, test_v)
        else:
            met = {"mae": None, "rmse": None, "mape": None, "r2": None}
        s = norm.tolist()
        fut_n = []
        for _ in range(horizon):
            p = np.clip(model.predict_one(np.array(s[-seq_len:])), -0.5, 1.5)
            fut_n.append(p); s.append(p)
        fut_raw = scaler.inverse_transform(np.array(fut_n).reshape(-1, 1)).flatten()
        fut = [round(float(np.clip(v, clip_lo, clip_hi)), 2) for v in fut_raw]
        return fitted, fut, met

    # ── Transformer ───────────────────────────────────
    tf_model = PyTorchTransformer()
    tf_losses = _train_nn(X_tr, y_tr, tf_model)
    tf_fitted, tf_future, tf_metrics = nn_pipeline(tf_model, tf_losses)

    # ── LSTM ──────────────────────────────────────────
    lstm_model = LSTMForecaster()
    lstm_losses = _train_nn(X_tr, y_tr, lstm_model)
    lstm_fitted, lstm_future, lstm_metrics = nn_pipeline(lstm_model, lstm_losses)

    # ── Sklearn baselines ─────────────────────────────
    X_tab, y_tab = _make_sequences(rev, seq_len)
    X_tab_tr, X_tab_te = X_tab[:split], X_tab[split:]
    y_tab_tr, y_tab_te = y_tab[:split], y_tab[split:]

    rf   = RandomForestRegressor(n_estimators=200, max_depth=6, random_state=RANDOM_SEED)
    dt   = DecisionTreeRegressor(max_depth=4, random_state=RANDOM_SEED)
    lr_m = Ridge(alpha=1.0)  # Ridge is more robust than plain LinearRegression
    rf.fit(X_tab_tr, y_tab_tr); dt.fit(X_tab_tr, y_tab_tr); lr_m.fit(X_tab_tr, y_tab_tr)

    def sk_metrics(m, Xte, yte):
        return _metrics(yte, m.predict(Xte)) if len(Xte) > 0 else {"mae": None, "rmse": None, "mape": None, "r2": None}

    rf_metrics = sk_metrics(rf, X_tab_te, y_tab_te)
    dt_metrics = sk_metrics(dt, X_tab_te, y_tab_te)
    lr_metrics = sk_metrics(lr_m, X_tab_te, y_tab_te)

    rf_fitted = rf.predict(X_tab).tolist()
    dt_fitted = dt.predict(X_tab).tolist()
    lr_fitted = lr_m.predict(X_tab).tolist()

    def sk_future(model):
        w = list(rev)
        preds = []
        for _ in range(horizon):
            p = float(model.predict(np.array(w[-seq_len:]).reshape(1, -1))[0])
            preds.append(round(float(np.clip(p, clip_lo, clip_hi)), 2)); w.append(p)
        return preds

    rf_future = sk_future(rf); dt_future = sk_future(dt); lr_future = sk_future(lr_m)

    # Moving Average (weighted — recent months get more weight)
    ma_w = min(seq_len, n); ma_seq = rev.tolist(); ma_future = []
    weights = np.arange(1, ma_w + 1, dtype=float)
    weights /= weights.sum()
    for _ in range(horizon):
        window = np.array(ma_seq[-ma_w:])
        p = round(float(np.clip(np.dot(weights, window), clip_lo, clip_hi)), 2)
        ma_future.append(p); ma_seq.append(p)
    if has_test:
        ma_preds = [X_tab_te[i].mean() for i in range(len(X_tab_te))]
        ma_metrics = _metrics(y_tab_te, np.array(ma_preds))
    else:
        ma_metrics = {"mae": None, "rmse": None, "mape": None, "r2": None}

    # ── XGBoost ───────────────────────────────────────
    xgb_fitted, xgb_future, xgb_metrics = _xgb_forecast(
        X_tab_tr, y_tab_tr, X_tab_te, y_tab_te, rev, seq_len, horizon, clip_lo, clip_hi)

    # ── ARIMA ─────────────────────────────────────────
    arima_future, arima_metrics, arima_info = _arima_forecast(
        rev, horizon, clip_lo, clip_hi, n_test=len(y_te))

    # ── Smart ensemble for transformer validation ─────
    # Instead of just using RF+LR, use weighted ensemble of best models
    all_candidates = {"rf": rf_future, "lr": lr_future, "lstm": lstm_future}
    if xgb_future:
        all_candidates["xgb"] = xgb_future
    
    tf_arr = np.array(tf_future)
    candidate_arr = np.array(list(all_candidates.values()))
    ensemble_mean = candidate_arr.mean(axis=0)
    
    # Check if transformer is out of range (more than 2 std devs from ensemble)
    ensemble_std = candidate_arr.std(axis=0)
    deviation = np.abs(tf_arr - ensemble_mean)
    if (deviation > 2.0 * ensemble_std + 0.01 * rev.mean()).any():
        warnings.warn("Transformer deviation high — blending with ensemble")
        # Blend 60% transformer, 40% ensemble for stability
        tf_future = [round(float(np.clip(0.6 * tf_arr[i] + 0.4 * ensemble_mean[i], clip_lo, clip_hi)), 2)
                     for i in range(horizon)]

    # ── Future months ─────────────────────────────────
    from dateutil.relativedelta import relativedelta
    from datetime import datetime
    last_d = datetime.strptime(months[-1][:10], "%Y-%m-%d")
    future_months = [(last_d + relativedelta(months=i+1)).strftime("%Y-%m") for i in range(horizon)]

    # ── Build metrics & leaderboard ───────────────────
    all_metrics = {
        "transformer": tf_metrics, "lstm": lstm_metrics,
        "random_forest": rf_metrics, "decision_tree": dt_metrics,
        "linear_regression": lr_metrics, "moving_average": ma_metrics,
    }
    if xgb_metrics and xgb_metrics.get("mae") is not None:
        all_metrics["xgboost"] = xgb_metrics
    if arima_future and arima_metrics.get("mae") is not None:
        all_metrics["arima"] = arima_metrics

    all_futures = {"tf": tf_future, "lstm": lstm_future, "rf": rf_future,
                   "dt": dt_future, "lr": lr_future, "ma": ma_future}
    if xgb_future: all_futures["xgb"] = xgb_future
    if arima_future: all_futures["arima"] = arima_future

    ci = _confidence_intervals(all_futures, horizon)
    leaderboard = _build_leaderboard(all_metrics, n)

    # ── Residuals ─────────────────────────────────────
    residuals = []
    y_all_orig = scaler.inverse_transform(y_all.reshape(-1, 1)).flatten()
    for i in range(min(len(y_all_orig), len(tf_fitted))):
        residuals.append(_safe(round(float(y_all_orig[i] - tf_fitted[i]), 2)))

    # ── AI-powered ML prediction summary ─────────────
    # Pick best model from leaderboard for AI summary
    best_model_name = leaderboard[0]["model"] if leaderboard else "ensemble"
    best_future_map = {
        "transformer": tf_future, "lstm": lstm_future,
        "random_forest": rf_future, "decision_tree": dt_future,
        "linear_regression": lr_future, "moving_average": ma_future,
        "xgboost": xgb_future or [], "arima": arima_future or [],
    }
    best_future = best_future_map.get(best_model_name, ci.get("ensemble", tf_future))
    
    # Compute trend stats for AI context
    last_revenue = float(rev[-1])
    avg_revenue  = float(rev.mean())
    revenue_trend = "upward" if len(rev) > 1 and rev[-1] > rev[-2] else "downward"
    ensemble_vals = ci.get("ensemble", [])

    s = lambda lst: [_safe(round(v, 2)) if isinstance(v, float) else v for v in lst]
    return {
        "months":        [m[:7] for m in months],
        "revenues":      s(rev.tolist()),
        "seq_len":       seq_len,
        "train_size":    split,
        "test_size":     len(X_te),
        "tf_fitted":     s(tf_fitted),
        "lstm_fitted":   s(lstm_fitted),
        "rf_fitted":     s(rf_fitted),
        "dt_fitted":     s(dt_fitted),
        "lr_fitted":     s(lr_fitted),
        "xgb_fitted":    s(xgb_fitted) if xgb_fitted else [],
        "future_months": future_months,
        "tf_future":     tf_future,
        "lstm_future":   lstm_future,
        "rf_future":     rf_future,
        "dt_future":     dt_future,
        "lr_future":     lr_future,
        "ma_future":     ma_future,
        "xgb_future":    xgb_future or [],
        "arima_future":  arima_future or [],
        "arima_info":    arima_info,
        "confidence":    ci,
        "leaderboard":   leaderboard,
        "residuals":     residuals,
        "metrics":       all_metrics,
        # ── AI prediction context ──
        "ai_context": {
            "best_model":     best_model_name,
            "best_future":    best_future,
            "ensemble":       ensemble_vals,
            "last_revenue":   round(last_revenue, 2),
            "avg_revenue":    round(avg_revenue, 2),
            "revenue_trend":  revenue_trend,
            "horizon":        horizon,
            "future_months":  future_months,
        },
        "training": {
            "epochs_run":      len(tf_losses),
            "final_loss":      _safe(round(tf_losses[-1], 6)) if tf_losses else None,
            "loss_curve":      [_safe(round(l, 6)) for l in tf_losses[::max(1, len(tf_losses)//30)]],
            "lstm_epochs":     len(lstm_losses),
            "lstm_final_loss": _safe(round(lstm_losses[-1], 6)) if lstm_losses else None,
            "lstm_loss_curve": [_safe(round(l, 6)) for l in lstm_losses[::max(1, len(lstm_losses)//30)]],
            "architecture": {
                "d_model": D_MODEL, "d_ff": D_FF, "heads": N_HEADS,
                "n_layers": N_LAYERS, "seq_len": seq_len,
                "params": tf_model.total_params(),
                "lstm_params": lstm_model.total_params(),
            },
        },
    }
