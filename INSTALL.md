# 🚀 Installation Guide

## The Issue
You installed `google-genai` but the code needs `google-generativeai` (different package!).

## Fix

Run this in your terminal (NOT in sandbox):

```bash
cd /Users/sanjith/Downloads/SignVision1/SignVision-AR

# Uninstall wrong package
pip uninstall google-genai -y

# Install correct package
pip install google-generativeai --user
```

Or install all dependencies fresh:

```bash
pip install -r requirements.txt --user
```

## Setup Gemini API Key

```bash
# Create .env file
echo "GEMINI_API_KEY=your_actual_key_here" > .env
```

Get your key: https://aistudio.google.com/apikey

## Run

```bash
# Terminal 1: Backend
python server.py

# Terminal 2: Frontend (already running)
# Open http://localhost:8080
```

## Verify

You should see:
```
INFO:     Started server process
INFO:     Uvicorn running on http://0.0.0.0:8000
```

Then in browser console:
```
⚡ COCO-SSD: 75ms, Objects: 2
🧠 Gemini refined 2 labels in 850ms
```

If you see the first line but not the second, backend isn't connected.

