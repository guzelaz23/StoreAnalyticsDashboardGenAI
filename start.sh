#!/bin/bash
echo "╔══════════════════════════════════════╗"
echo "║   Store Analytics Pro — Startup      ║"
echo "╚══════════════════════════════════════╝"

# Check .env
if [ ! -f .env ]; then
  echo "❌ .env not found! Copy .env.example and fill in your keys."
  exit 1
fi

echo "📦 Installing dependencies..."
pip install -q openai>=1.0.0 flask flask-cors psycopg2-binary pandas numpy plotly python-dotenv python-dateutil

echo ""
echo "🔑 Checking API keys..."
python -c "
from dotenv import load_dotenv; import os
load_dotenv(override=True)
k = os.getenv('KIMI_API_KEY','').strip()
g = os.getenv('GROQ_API_KEY','').strip()
print(f'  Kimi:  {\"✅ set\" if k else \"❌ not set\"}')
print(f'  Groq:  {\"✅ set\" if g else \"❌ not set\"}')
if not k and not g:
    print('  ❌ No AI key found! Set at least GROQ_API_KEY in .env')
    exit(1)
print()
"

echo "🚀 Starting Flask server on http://localhost:5000"
echo "   Then open: http://localhost:5000"
echo "   Check providers: http://localhost:5000/api/provider_status"
echo ""
python app.py
