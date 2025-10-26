#!/usr/bin/env python3
"""
Quick test to verify Gemini API key works
"""
import os
from dotenv import load_dotenv

print("🔍 Testing Gemini API Key...\n")

# Load .env file
load_dotenv()

# Check if key exists
api_key = os.getenv("GEMINI_API_KEY")

if not api_key:
    print("❌ GEMINI_API_KEY not found!")
    print("   Create .env file with: GEMINI_API_KEY=your_key_here")
    exit(1)

print(f"✅ API key found: {api_key[:8]}...{api_key[-4:]}")
print(f"   Length: {len(api_key)} characters")

# Test if key works with Gemini
try:
    import google.generativeai as genai
    print("\n✅ google.generativeai package installed")
    
    genai.configure(api_key=api_key)
    print("✅ API key configured")
    
    # Try to list models (quick API test)
    print("\n🧪 Testing API connection...")
    models = genai.list_models()
    model_names = [m.name for m in models if 'gemini' in m.name.lower()][:3]
    
    print(f"✅ API KEY WORKS! Connected to Gemini.")
    print(f"   Available models: {len(model_names)}")
    for name in model_names:
        print(f"   - {name}")
    
    print("\n✨ Everything is set up correctly!")
    print("   You can now run: python server.py")
    
except ImportError as e:
    print(f"\n❌ Package not installed: {e}")
    print("   Run: pip install google-generativeai --user")
    
except Exception as e:
    print(f"\n❌ API key test failed: {e}")
    print("   Check if your API key is valid at:")
    print("   https://aistudio.google.com/apikey")

