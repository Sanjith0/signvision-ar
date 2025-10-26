"""
SignVision Gemini Backend - Label Refinement Server
Provides accurate sign classification for COCO-SSD detections
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai
import os
import base64
import logging
from typing import List, Dict
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI
app = FastAPI(title="SignVision Gemini Refinement API")

# Enable CORS for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Gemini
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    logger.error("GEMINI_API_KEY not found in environment")
    logger.error("Make sure .env file exists with: GEMINI_API_KEY=your_key")
else:
    genai.configure(api_key=GEMINI_API_KEY)
    logger.info("✅ Gemini API configured successfully")

# Request model
class AnalyzeRequest(BaseModel):
    image: str
    content_type: str = "image/jpeg"

# Detection response model
class Detection(BaseModel):
    label: str
    bbox: List[float]  # [x, y, width, height] normalized 0-1
    color: str
    confidence: float

class AnalyzeResponse(BaseModel):
    detections: List[Detection]
    processing_time_ms: float

@app.get("/")
async def root():
    return {"status": "SignVision Gemini Refinement API", "version": "2.0"}

@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_image(request: AnalyzeRequest):
    """
    Analyze image with Gemini for accurate sign/hazard detection
    Returns refined labels for COCO-SSD detections
    """
    import time
    start_time = time.time()
    
    try:
        # Decode base64 image
        image_data = base64.b64decode(request.image)
        
        # Initialize Gemini model
        model = genai.GenerativeModel('gemini-2.0-flash-exp')
        
        # Prepare image for Gemini
        image_parts = [{
            "mime_type": request.content_type,
            "data": image_data
        }]
        
        # Prompt for traffic sign and hazard detection
        prompt = """Analyze this image for SIGNS and SIGNALS only. Distinguish between signs and people.

CRITICAL: Look for physical SIGNS with symbols on them, NOT actual people walking.

Detect these SIGNS/SIGNALS ONLY:
1. **Pedestrian Signs** (physical signs, not people):
   - "No Pedestrian Sign" (white with red circle/slash) → label as "No Walk Sign"
   - "Pedestrian Crossing Sign" (yellow diamond with person) → label as "Walk Sign" or "Pedestrian Crossing"
   
2. **Pedestrian Signals** (traffic light type):
   - Walk signal (green/white hand or person) → label as "Walk Signal - Green"
   - Don't Walk signal (red hand or person) → label as "Don't Walk - Red"
   
3. **Traffic Signs**:
   - Stop signs, yield signs, speed limit signs, etc.
   
4. **Traffic Lights**:
   - Specify color/state (red, yellow, green)

5. **Actual Pedestrians**:
   - ONLY if there's a real person in the scene (not on a sign)
   - Label as "Pedestrian" only if it's a living person

IMPORTANT:
- Do NOT confuse sign symbols with real people
- A person silhouette ON a sign = it's a SIGN, not a pedestrian
- White square signs with person + red circle = "No Walk Sign"
- Yellow diamond signs with person = "Pedestrian Crossing" or "Walk Sign"

For each detected object, provide:
1. Precise label (e.g., "No Walk Sign", "Walk Signal - Green", "Stop Sign")
2. Bounding box coordinates [x, y, width, height] as percentages (0-100)
3. Confidence score (0-100)

Return ONLY valid JSON array with this exact format:
[
  {
    "label": "No Walk Sign",
    "bbox": [45.2, 30.1, 12.5, 18.3],
    "color": "red",
    "confidence": 95
  },
  {
    "label": "Pedestrian Crossing",
    "bbox": [65.0, 35.0, 10.0, 15.0],
    "color": "yellow",
    "confidence": 90
  }
]

Colors: red (danger/stop), yellow (caution), green (safe/go), blue (info), orange (construction)

If nothing detected, return: []"""
        
        # Generate content
        response = model.generate_content([prompt, image_parts[0]])
        
        # Parse response
        try:
            # Extract JSON from response
            text = response.text.strip()
            
            # Remove markdown code blocks if present
            if text.startswith("```json"):
                text = text[7:]
            elif text.startswith("```"):
                text = text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()
            
            import json
            detections_data = json.loads(text)
            
            # Convert to Detection objects
            detections = []
            for det in detections_data:
                # Normalize bbox from percentage to 0-1
                bbox = [det["bbox"][i] / 100.0 for i in range(4)]
                
                detections.append(Detection(
                    label=det["label"],
                    bbox=bbox,
                    color=det.get("color", "yellow"),
                    confidence=det.get("confidence", 0) / 100.0
                ))
            
            processing_time = (time.time() - start_time) * 1000
            
            logger.info(f"Detected {len(detections)} objects in {processing_time:.0f}ms")
            
            return AnalyzeResponse(
                detections=detections,
                processing_time_ms=processing_time
            )
            
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error: {e}")
            logger.error(f"Response text: {response.text}")
            # Return empty detections on parse error
            return AnalyzeResponse(
                detections=[],
                processing_time_ms=(time.time() - start_time) * 1000
            )
            
    except Exception as e:
        logger.error(f"Analysis error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)

