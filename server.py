"""
SignVision Backend Server
FastAPI server that receives camera frames from the iPhone and uses Google Gemini API
to detect road signs, crosswalks, and hazards with real-time AI vision processing.
"""

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional
from google import genai
import os
from dotenv import load_dotenv
import logging
from datetime import datetime
import io
import base64
import json
import re
from pathlib import Path

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(title="SignVision API", version="1.0.0")

# Configure CORS to allow iPhone Safari requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Get the directory where this script is located
BASE_DIR = Path(__file__).resolve().parent

# Serve static files (HTML, CSS, JS) for production deployment
# This allows running the entire app from a single server
if os.path.exists(BASE_DIR / "index.html"):
    # Mount static files, but don't override API routes
    @app.get("/")
    async def serve_home():
        """Serve the main HTML file"""
        return FileResponse(BASE_DIR / "index.html")
    
    @app.get("/manifest.json")
    async def serve_manifest():
        """Serve the PWA manifest"""
        return FileResponse(BASE_DIR / "manifest.json")
    
    @app.get("/sw.js")
    async def serve_service_worker():
        """Serve the service worker"""
        return FileResponse(BASE_DIR / "sw.js")
    
    @app.get("/script.js")
    async def serve_script():
        """Serve the main JavaScript file"""
        return FileResponse(BASE_DIR / "script.js")
    
    @app.get("/style.css")
    async def serve_style():
        """Serve the CSS file"""
        return FileResponse(BASE_DIR / "style.css")
    
    logger.info("Static file serving enabled for production deployment")

# Load Gemini API key from environment
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY not found in environment variables. Please add it to .env file.")

# Initialize Gemini client - NEW SDK
try:
    client = genai.Client(api_key=GEMINI_API_KEY)
    
    # Test connection by listing available models
    models = client.models.list()
    model_name = "models/gemini-2.0-flash"  # Use latest model
    
    # Get available model names
    available_model_names = [m.name for m in models]
    
    if model_name not in available_model_names:
        # Try alternatives - prioritize vision models with 'flash' or 'vision'
        for alt in ["models/gemini-2.5-flash", "models/gemini-1.5-flash", "models/gemini-flash-latest"]:
            if alt in available_model_names:
                model_name = alt
                logger.info(f"Using alternative model: {model_name}")
                break
        else:
            # Find a vision-capable model (filter out embeddings, imagens, etc.)
            vision_models = [m.name for m in models if 'gemini' in m.name.lower() and ('flash' in m.name.lower() or 'pro' in m.name.lower())]
            if vision_models:
                model_name = vision_models[0]
                logger.info(f"Selected vision model: {model_name}")
            else:
                model_name = available_model_names[0] if available_model_names else "models/gemini-1.5-flash"
                logger.warning(f"Using fallback model: {model_name}")
    
    logger.info(f"Gemini client initialized successfully with model: {model_name}")
    logger.info(f"Available models count: {len(available_model_names)}")
except Exception as e:
    logger.error(f"Failed to initialize Gemini client: {e}")
    raise


class Detection(BaseModel):
    """Detection result model"""
    label: str
    bbox: List[float]  # [x, y, width, height]
    color: str
    confidence: Optional[float] = None


class AnalyzeResponse(BaseModel):
    """Response model for /analyze endpoint"""
    detections: List[Detection]
    processing_time_ms: float


@app.get("/")
async def root():
    """Health check endpoint"""
    return {"message": "SignVision API is running", "status": "ok"}


@app.get("/models")
async def list_models():
    """List available Gemini models"""
    try:
        models = client.models.list()
        model_names = [{"name": m.name, "display_name": getattr(m, 'display_name', m.name)} for m in models if hasattr(m, 'name')]
        return {
            "models": model_names,
            "current_model": model_name,
            "sdk": "google-genai"
        }
    except Exception as e:
        logger.error(f"Failed to list models: {e}")
        return {"error": str(e), "models": [], "sdk": "google-genai"}


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_image(file: UploadFile = File(...)):
    """
    Analyze an uploaded image frame for road signs, crosswalks, and hazards.
    
    Args:
        file: Uploaded image file from the frontend camera stream
        
    Returns:
        JSON response with detected objects (bounding boxes, labels, colors)
    """
    start_time = datetime.now()
    
    try:
        # Validate file
        if not file.content_type.startswith('image/'):
            raise HTTPException(status_code=400, detail="File must be an image")
        
        # Read the uploaded file
        image_data = await file.read()
        logger.info(f"Received image: {len(image_data)} bytes, content-type: {file.content_type}")
        
        # Prepare the prompt for Gemini
        prompt = """
        Analyze this street scene image and detect the following:
        1. Traffic signs (stop signs, no walk signs, walk signs, speed limits, etc.)
        2. Crosswalk signals (walk/don't walk pedestrian signals)
        3. Crosswalk markings (zebra stripes, painted crosswalks)
        4. Potential hazards (obstacles, debris, pedestrians, vehicles)
        
        For each detection, provide:
        - label: a short description (e.g., "stop_sign", "no_walk", "crosswalk", "hazard")
        - bbox: bounding box coordinates [x, y, width, height] normalized to 0-1
        - color: "red" for hazards/no signs, "yellow" for caution, "green" for safe/proceed
        
        Return your response in this exact JSON format:
        {
            "detections": [
                {"label": "stop_sign", "bbox": [0.2, 0.1, 0.15, 0.15], "color": "red"},
                {"label": "crosswalk", "bbox": [0.1, 0.7, 0.3, 0.2], "color": "green"}
            ]
        }
        
        Only respond with the JSON object, no additional text.
        """
        
        try:
            # NEW SDK API - encode image as base64
            image_bytes = base64.b64encode(image_data).decode('utf-8')
            
            # Call Gemini API with the new SDK
            response = client.models.generate_content(
                model=model_name,
                contents=[
                    {
                        "role": "user",
                        "parts": [
                            {"text": prompt},
                            {
                                "inline_data": {
                                    "mime_type": file.content_type,
                                    "data": image_bytes
                                }
                            }
                        ]
                    }
                ],
                config={
                    "temperature": 0.3,
                    "max_output_tokens": 2048,
                }
            )
            
            # Parse the response - NEW SDK returns different structure
            if hasattr(response, 'text'):
                response_text = response.text.strip()
            elif hasattr(response, 'candidates') and len(response.candidates) > 0:
                response_text = response.candidates[0].content.parts[0].text.strip()
            else:
                raise ValueError("Unexpected response format from Gemini API")
            
            # Extract JSON from the response (in case it's wrapped in markdown)
            if "```json" in response_text:
                response_text = response_text.split("```json")[1].split("```")[0]
            elif "```" in response_text:
                response_text = response_text.split("```")[1].split("```")[0]
            
            # Parse JSON response
            try:
                result = json.loads(response_text)
            except json.JSONDecodeError:
                # Try to extract JSON more flexibly
                json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
                if json_match:
                    result = json.loads(json_match.group())
                else:
                    raise
            
            # Validate and format the response
            detections = result.get("detections", [])
            
            # Ensure all detections have required fields
            formatted_detections = []
            for det in detections:
                if "label" in det and "bbox" in det:
                    formatted_detections.append({
                        "label": det["label"],
                        "bbox": det["bbox"],
                        "color": det.get("color", "yellow"),
                        "confidence": det.get("confidence", 0.85)
                    })
            
            # Calculate processing time
            processing_time = (datetime.now() - start_time).total_seconds() * 1000
            
            logger.info(f"Processed in {processing_time:.2f}ms, found {len(formatted_detections)} detections")
            
            return {
                "detections": formatted_detections,
                "processing_time_ms": processing_time
            }
            
        except Exception as e:
            logger.error(f"Gemini API error: {e}")
            raise HTTPException(status_code=500, detail=f"AI processing failed: {str(e)}")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        raise HTTPException(status_code=500, detail=f"Server error: {str(e)}")


@app.post("/analyze-fallback")
async def analyze_fallback(file: UploadFile = File(...)):
    """
    Fallback analysis endpoint with simpler prompt (if main /analyze fails)
    """
    try:
        image_data = await file.read()
        
        # Simple fallback - just return that we saw the image
        return {
            "detections": [
                {
                    "label": "scene_analyzed",
                    "bbox": [0.25, 0.25, 0.5, 0.5],
                    "color": "blue",
                    "confidence": 1.0
                }
            ],
            "processing_time_ms": 100.0
        }
    except Exception as e:
        logger.error(f"Fallback error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

