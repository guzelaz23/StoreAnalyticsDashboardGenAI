# Store Analytics Pro — Upgrade Instructions for Claude Code

## Context
Project ini Flask-based DVD Rental analytics dashboard dengan AI chatbot (Groq LLM) + Transformer forecasting (NumPy custom impl). Stack: Flask, PostgreSQL, Plotly, vanilla JS. File utama: `app.py`, `ai_chat.py`, `forecasting.py`, `templates/index.html`, `static/app.js`, `static/style.css`.

Sebelum mulai apapun: baca dulu `app.py`, `ai_chat.py`, `forecasting.py`, `templates/index.html`, `static/app.js`, `static/style.css` supaya paham arsitekturnya. Jangan langsung patch tanpa baca konteks.

## Workflow Rules (PENTING)
1. **Selalu jelaskan rencana sebelum edit.** Sebelum nge-patch file apapun, kasih ringkasan: file mana, perubahan apa, alasannya. Tunggu konfirmasi user untuk perubahan besar (>20 baris atau struktural). Untuk fix kecil, langsung kerjakan tapi tetap report setelahnya.
2. **One change at a time.** Jangan bundling banyak feature dalam 1 batch edit. Selesaikan task A → test/verify → lanjut task B.
3. **Test setelah edit.** Untuk perubahan Python: `python -c "import app"` minimal cek syntax. Untuk JS/HTML: cek bracket matching, cek tag tertutup.
4. **Preserve style.** Ikuti formatting & naming convention yang ada (snake_case Python, camelCase JS, indent 2 untuk HTML/CSS/JS, indent 4 untuk Python).
5. **No silent breakage.** Kalau hapus sesuatu, pastikan reference-nya di file lain juga dibersihkan (cari `grep -rn` dulu).

---

## TASK 1 — Hapus "AI Insight" yang redundant dengan chatbot 💬

Chatbot floating button (`#chat-fab`) sudah ada dan fungsional. Insight statis di setiap tab redundant.

**Aksi:**
- Hapus elemen `<div id="overview-insight" class="insight-box">` di tab Overview (`templates/index.html`).
- Hapus elemen `<div id="geo-insight" class="insight-box">` di tab Customers.
- Hapus elemen `<div id="pattern-insight" class="insight-box">` di tab Patterns.
- Hapus seluruh tab **Recommendations** (button `data-tab="recommend"` di nav, dan `<div id="tab-recommend">` panel-nya). Karena chatbot sudah bisa generate recommendation on-demand.
- Di `static/app.js`: hapus semua kode yang nge-populate elemen di atas (cari `overview-insight`, `geo-insight`, `pattern-insight`, `recommendations-grid`). Hapus juga function `loadRecommendations` kalau ada, dan call-nya.
- Di `app.py`: hapus route `/api/recommendations` kalau ada (cek dulu).
- Setelah hapus tab Recommendations, pastikan tab pertama (Overview) tetap default `active`.

Untuk transition yang halus, tambahkan tooltip subtle di chatbot FAB: "💬 Tanya AI untuk insight & rekomendasi". Tooltip cukup pakai atribut `title=""` yang sudah ada — update text-nya saja.

---

## TASK 2 — Fix Transformer Forecast

Kemungkinan masalah saat ini:
- Training pakai finite-difference gradient (lihat `forecasting.py` `_train_transformer`) → lambat & noisy → loss kadang stuck → forecast flat atau aneh.
- 300 epochs dengan FD gradient di tiap weight = mahal banget tapi hasil belum tentu konvergen.
- Tidak ada early stopping.
- `tf_future` autoregressive — kalau 1 prediksi awal aneh, sisanya makin aneh.

**Aksi (urut, jangan loncat):**

### 2a. Diagnostic dulu
Jalankan: `python -c "from forecasting import run_forecast; import json; r = run_forecast([1000,1200,1500,1300,1400,1600,1800,1700,1900,2100,2300,2200,2400], ['2024-01-01','2024-02-01','2024-03-01','2024-04-01','2024-05-01','2024-06-01','2024-07-01','2024-08-01','2024-09-01','2024-10-01','2024-11-01','2024-12-01','2025-01-01']); print(json.dumps({'tf_future': r['tf_future'], 'tf_metrics': r['metrics']['transformer'], 'final_loss': r['training']['final_loss']}, indent=2))"`. Report hasilnya.

### 2b. Implementasi proper backprop (atau switch ke PyTorch)
**Opsi A (preferred jika dependency boleh nambah):** rewrite `NumpyTransformer` ke PyTorch. Bobot kecil, training ratusan epoch jadi <2 detik di CPU. Tambahkan `torch` ke `requirements.txt`. Pakai `nn.TransformerEncoderLayer` dengan `d_model=16, nhead=2, dim_feedforward=32, batch_first=True`, plus `nn.Linear(d_model, 1)` output head. Loss MSE, optimizer Adam(lr=1e-2), 200 epoch dengan early stopping (patience=20).

**Opsi B (kalau pure NumPy diharuskan):** ganti finite-difference dengan analytic gradient via manual chain rule. Ini effort besar — confirm dulu ke user mana yang dipilih.

Default: **pakai Opsi A** kecuali user bilang sebaliknya.

### 2c. Validation guard
Tambahkan di `run_forecast`:
- Kalau `tf_future` punya variance < 1% dari mean revenue → log warning dan fallback ke ensemble (rata-rata RF + LR future).
- Clip output prediksi ke range `[0.5 * min(rev), 2.0 * max(rev)]` supaya gak meledak.

### 2d. Frontend polish
Di `static/app.js` function `loadForecast`:
- Pastikan `forecast-cards` render dengan style yang konsisten (cek CSS `.pred-card`).
- Kalau `metrics.transformer.r2` negatif atau MAPE > 50%, tampilkan badge warning kuning di forecast-status: "⚠️ Transformer underperforming, consider RF as primary".

### 2e. Test end-to-end
Run Flask: `python app.py` (pastikan PostgreSQL hidup). Buka `http://localhost:5000`, klik tab Forecast, verify chart muncul, cards muncul dengan angka realistis (bukan NaN, bukan negatif besar), loss curve declining.

---

## TASK 3 — AI Agent: chatbot bisa modify dashboard via prompt

Ini fitur baru. Goal: user ketik di chatbot "kpi card kegedean, kecilin", AI proposes patch ke `style.css`, user confirm, file ke-update, page auto-reload.

### 3a. Backend — endpoint `/api/agent_edit`
Tambah di `app.py`:

```python
@app.route("/api/agent_edit", methods=["POST"])
def api_agent_edit():
    """
    Two-phase: PROPOSE then APPLY.
    Body: { "prompt": "...", "phase": "propose"|"apply", "patches": [...optional...] }
    """
    from agent_edit import propose_patch, apply_patch  # new module
    body = request.json or {}
    phase = body.get("phase", "propose")
    if phase == "propose":
        return jsonify(propose_patch(body.get("prompt", "")))
    elif phase == "apply":
        return jsonify(apply_patch(body.get("patches", [])))
    return jsonify({"error": "invalid phase"}), 400
```

### 3b. Modul baru `agent_edit.py`
Buat file baru. Isi:
- `EDITABLE_FILES = {"static/style.css", "static/app.js", "templates/index.html"}` — whitelist. **Jangan pernah biarkan AI edit `app.py`, `db.py`, `ai_chat.py`, `forecasting.py`, atau `agent_edit.py` itu sendiri** (security).
- `BACKUP_DIR = "backups/"` — sebelum apply, copy file lama ke `backups/{filename}.{timestamp}.bak`.
- Function `propose_patch(prompt)`:
  1. Baca isi `EDITABLE_FILES` (truncate kalau > 8000 char per file).
  2. Kirim ke Groq dengan system prompt yang jelas: "Kamu agent yang menerima request user untuk modifikasi UI dashboard. Output HARUS JSON: `{\"summary\": \"...\", \"patches\": [{\"file\": \"...\", \"old_str\": \"...\", \"new_str\": \"...\", \"reason\": \"...\"}], \"warnings\": [...]}`. `old_str` harus EXACT match dan unik di file. Kalau tidak yakin, kembalikan `patches: []` dan jelaskan di summary."
  3. Parse JSON response, validate setiap patch: file ada di whitelist, `old_str` ada di file dan unik (count == 1).
  4. Return proposal — JANGAN apply.
- Function `apply_patch(patches)`:
  1. Untuk tiap patch: backup → `text.replace(old_str, new_str, 1)` → write.
  2. Return `{"applied": [...files...], "errors": [...]}`.

### 3c. Frontend — UI confirm di chatbot
Di `static/app.js`, modify chat send handler:
- Kalau user message dimulai dengan trigger keyword: `edit`, `modify`, `change`, `ubah`, `kecilin`, `gedein`, `pindah`, `ganti warna`, dll → route ke `/api/agent_edit?phase=propose` dulu (bukan ke `/api/chat` biasa).
- Tampilkan response sebagai card di chatbox: summary + diff preview (pakai `<pre>` dengan highlight merah/hijau) + 2 button: **Apply** & **Cancel**.
- Klik Apply → POST ke `/api/agent_edit?phase=apply` dengan `patches`. Setelah sukses, tampilkan toast "✅ Updated. Reloading..." dan `setTimeout(() => location.reload(), 1500)`.
- Klik Cancel → tutup card, no-op.

### 3d. Safety
- Limit max 5 patches per proposal.
- Limit `new_str` length max 2000 char per patch.
- Log semua edit ke `agent_edit.log` (timestamp, prompt, files changed).
- Tambahkan endpoint `/api/agent_revert` yang restore dari backup terbaru — biar user bisa undo via chat ("revert last change").

### 3e. Test scenarios
Setelah semua kelar, test 3 prompt ini manual:
1. "Make the KPI card padding tighter"
2. "Change the primary color to a darker blue"
3. "Make the forecast chart taller"

Setiap kali harus: AI propose → preview muncul → klik Apply → page reload → perubahan terlihat. Kalau salah satu gagal, debug dan report.

---

## TASK 4 — Improve chatbot quality

Sudah ada `ai_chat.py` dengan Groq + context builder dari DB. Improvements:
- Tambah quick-prompt suggestion di chatbox: "Explain this dashboard", "Why is revenue dropping?", "Edit: make font larger" — exactly 6 prompt. Edit di `templates/index.html` bagian chatbox-body.
- Di `ai_chat.py` function `chat`, kalau prompt mengandung kata "edit/modify/change/ubah" — return short message: "Sepertinya kamu mau modifikasi UI. Kirim sebagai instruksi edit (akan diproses agent), bukan tanya jawab." dan jangan call LLM.
- Tambah endpoint `/api/explain_dashboard` yang return summary lengkap dashboard untuk prompt "kenapa gini" — context builder yang sudah ada bisa direuse.

---

## DELIVERABLES per task
Setelah selesai tiap TASK, kasih ringkasan ke user:
- Files modified (list path).
- Lines added/removed (approximate).
- Manual test step yang user perlu lakukan untuk verify.
- Known issues / limitations.

## NON-GOALS (jangan dikerjakan kecuali diminta)
- Refactor besar arsitektur.
- Ganti database engine.
- Dockerize.
- Tambah autentikasi user.
- Migration ke React/Vue.

Mulai dari TASK 1. Konfirmasi dulu ke user sebelum mulai TASK 3 karena impact-nya besar (file modification dari LLM).