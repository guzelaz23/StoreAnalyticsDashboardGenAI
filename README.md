# Store Analytics Dashboard - GenAI

A Flask-based analytics dashboard for DVD rental store data, powered by multi-model ML forecasting and a generative AI chatbot.

## Features

- **Interactive Dashboard** — Revenue, customer geography, rental patterns, and KPI cards visualized with Plotly
- **Multi-Model Forecasting** — PyTorch Transformer, XGBoost, ARIMA, Random Forest, LSTM, and more with ensemble leaderboard
- **AI Chatbot** — Groq LLM-powered assistant for on-demand insights and recommendations
- **AI Agent Edit** — Chat-driven dashboard modification: describe a UI change, AI proposes a patch, you confirm, page updates live

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python, Flask, Flask-CORS |
| Database | PostgreSQL (psycopg2) |
| ML / Forecasting | PyTorch, XGBoost, scikit-learn, statsmodels |
| Visualization | Plotly |
| AI | Groq API (OpenAI-compatible SDK) |
| Frontend | Vanilla JS, HTML/CSS |

## Project Structure

```
├── app.py              # Main Flask app & API routes
├── db.py               # PostgreSQL connection pool & query helpers
├── ai_chat.py          # AI chatbot endpoint logic
├── ai_agent.py         # AI agent for dashboard editing
├── agent_edit.py       # File patch apply/revert logic
├── forecasting.py      # Multi-model forecasting engine
├── llm_client.py       # LLM client wrapper
├── static/
│   ├── app.js          # Frontend logic
│   ├── style.css       # Main styles
│   └── enhanced.css    # Additional styles
├── templates/
│   └── index.html      # Single-page dashboard
└── requirements.txt
```

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/guzelaz23/StoreAnalyticsDashboardGenAI.git
cd StoreAnalyticsDashboardGenAI
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure environment

Create a `.env` file in the root directory:

```env
# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=your_database
DB_USER=your_user
DB_PASSWORD=your_password

# Groq API
GROQ_API_KEY=your_groq_api_key

# Flask
FLASK_SECRET_KEY=your_secret_key
```

### 4. Run the app

```bash
python app.py
```

Open `http://localhost:5000` in your browser.

## Requirements

- Python 3.11+
- PostgreSQL with DVD rental dataset loaded
- Groq API key (free tier available at [console.groq.com](https://console.groq.com))
