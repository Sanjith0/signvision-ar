#!/bin/bash

echo "🚀 Starting SignVision Backend..."
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ .env file not found!"
    echo "   Create it with: echo 'GEMINI_API_KEY=your_key' > .env"
    exit 1
fi

echo "✅ .env file found"

# Check if dependencies are installed
python3 -c "import google.generativeai" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "⚠️  google-generativeai not installed"
    echo "   Installing now..."
    pip3 install google-generativeai --user
fi

echo "✅ Dependencies ready"
echo ""
echo "🔥 Starting backend on http://localhost:8000"
echo "   Press Ctrl+C to stop"
echo ""

# Start the server
python3 server.py
