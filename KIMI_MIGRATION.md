# 🔄 Kimi API Migration Guide

## What Changed

| File | Change |
|------|--------|
| `ai_chat.py` | Replaced `groq` client → `openai` SDK pointed at Kimi API |
| `ai_agent.py` | Replaced `groq` client → `openai` SDK, added full dashboard control tools |
| `agent_edit.py` | Replaced `groq` client → `openai` SDK |
| `app.py` | Default model changed: `llama-3.3-70b-versatile` → `moonshot-v1-8k` |
| `requirements.txt` | Removed `groq`, added `openai>=1.0.0` |
| `templates/index.html` | Model selector updated to Kimi models + dashboard control quick prompts |
| `static/app.js` | Updated welcome message, default model reference |
| `.env` | Fixed `KIMI_API_KEY` spacing (removed extra space before `=`) |

## How Kimi API Works

Kimi (by Moonshot AI) uses the **OpenAI-compatible API format**:
- Base URL: `https://api.moonshot.cn/v1`
- SDK: standard `openai` Python package
- Function calling: supported (same format as OpenAI)

```python
from openai import OpenAI
client = OpenAI(
    api_key=os.getenv("KIMI_API_KEY"),
    base_url="https://api.moonshot.cn/v1"
)
```

## Available Models

| Model | Context | Use case |
|-------|---------|----------|
| `moonshot-v1-8k` | 8K tokens | Default, fast, most requests |
| `moonshot-v1-32k` | 32K tokens | Longer conversations |
| `moonshot-v1-128k` | 128K tokens | Very long file reading |

## Setup

```bash
pip install -r requirements.txt
python app.py
```

## AI Dashboard Controller Capabilities

The AI chatbot can now modify **anything** in the dashboard:

- 🎨 **Colors** — "Change background to dark blue", "Ganti warna accent jadi merah"
- 📊 **Chart types** — "Change revenue chart to pie chart", "Bar chart → line chart"  
- 📐 **Layout** — "Move KPI cards to bottom", "Pindah section forecast ke atas"
- 👁️ **Visibility** — "Hide the customer table", "Sembunyikan section kategori"
- 📏 **Sizes** — "Make KPI cards bigger", "Perkecil font di tabel"
- 🎯 **Theme** — "Switch to light theme", "Make it look purple and gold"

All changes **persist permanently** — the AI modifies the actual CSS/HTML/JS files on the server. A page reload keeps the new look.

To **revert**: type "revert" or "undo" in the chat, or click the revert button.
