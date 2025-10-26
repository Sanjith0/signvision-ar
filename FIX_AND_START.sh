#!/bin/bash

echo "🔧 Fixing SignVision Backend..."
echo ""

# Kill any process on port 8000
echo "🔴 Killing old process on port 8000..."
lsof -ti:8000 | xargs kill -9 2>/dev/null
sleep 1

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ .env file not found!"
    echo "   Run: echo 'GEMINI_API_KEY=your_key_here' > .env"
    exit 1
fi

echo "✅ Port 8000 cleared"
echo "✅ .env file found"
echo ""
echo "🚀 Starting backend on http://localhost:8000"
echo "   Press Ctrl+C to stop"
echo ""

# Start the server
python3 server.py
