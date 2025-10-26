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
        prompt = """TRAFFIC SIGNS AND ROAD SIGNS ONLY. Ignore everything else.

DO NOT DETECT:
❌ People, pedestrians, humans
❌ Vehicles (cars, trucks, bikes)
❌ Objects (phones, bags, etc.)
❌ Animals

ONLY DETECT THESE ROAD SIGNS:

1. **Pedestrian Signs** (physical signs on poles):
   - White square sign with person + red circle/diagonal line → "No Walk Sign"
   - Yellow diamond sign with walking person symbol → "Pedestrian Crossing"
   
2. **Pedestrian Signals** (traffic light type):
   - Walk signal (green hand/person) → "Walk Signal - Green"
   - Don't Walk signal (red hand/person) → "Don't Walk - Red"
   
3. **Traffic Control Signs**:
   - Stop sign (red octagon) → "Stop Sign"
   - Yield sign → "Yield Sign"
   - Speed limit signs → "Speed Limit [number]"
   - One way, no entry, etc.
   
4. **Traffic Lights**:
   - "Traffic Light - Red"
   - "Traffic Light - Yellow"
   - "Traffic Light - Green"

5. **Warning Signs**:
   - Construction signs
   - Curve warning
   - Merge warning

STRICT RULES:
- ONLY detect mounted signs and signals
- Ignore all people, even if near signs
- Ignore all vehicles
- Ignore all handheld objects
- If you see a person silhouette ON a sign, that's a SIGN not a person

Response format (JSON only):
[
  {
    "label": "No Walk Sign",
    "bbox": [x, y, width, height],
    "color": "red",
    "confidence": 95
  }
]

Colors: red (danger), yellow (caution), green (safe), blue (info), orange (construction)

If no SIGNS, return: []"""
        
        # Generate content
        response = model.generate_content([prompt, image_parts[0]])
        
        # Parse response
        try:
            # Extract JSON from response
            text = response.text.strip()
            
            # Log raw response for debugging
            logger.info(f"Gemini response (first 200 chars): {text[:200]}")
            
            # Remove markdown code blocks if present
            if text.startswith("```json"):
                text = text[7:]
            elif text.startswith("```"):
                text = text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()
            
            # Handle empty or non-JSON responses
            if not text or text == "[]":
                logger.info("Gemini returned no detections")
                return AnalyzeResponse(
                    detections=[],
                    processing_time_ms=(time.time() - start_time) * 1000
                )
            
            import json
            detections_data = json.loads(text)
            
            # Validate it's a list
            if not isinstance(detections_data, list):
                logger.error(f"Gemini returned non-list: {type(detections_data)}")
                return AnalyzeResponse(
                    detections=[],
                    processing_time_ms=(time.time() - start_time) * 1000
                )
            
            # Convert to Detection objects
            detections = []
            for det in detections_data:
                try:
                    # Validate required fields
                    if "label" not in det or "bbox" not in det:
                        logger.warning(f"Skipping detection missing required fields: {det}")
                        continue
                    
                    # Validate bbox values are in valid range (0-100)
                    bbox_raw = det["bbox"]
                    if len(bbox_raw) != 4:
                        logger.warning(f"Skipping detection with invalid bbox length: {bbox_raw}")
                        continue
                    
                    # Check all values are between 0-100
                    if not all(0 <= val <= 100 for val in bbox_raw):
                        logger.warning(f"⚠️  Invalid bbox (values must be 0-100): {bbox_raw} for {det['label']}")
                        # Clamp values to valid range
                        bbox_raw = [max(0, min(100, val)) for val in bbox_raw]
                        logger.info(f"   Clamped to: {bbox_raw}")
                    
                    # Normalize bbox from percentage to 0-1
                    bbox = [bbox_raw[i] / 100.0 for i in range(4)]
                    
                    detections.append(Detection(
                        label=det["label"],
                        bbox=bbox,
                        color=det.get("color", "yellow"),
                        confidence=det.get("confidence", 50) / 100.0
                    ))
                    logger.info(f"✅ Valid detection: {det['label']} at {bbox}")
                except Exception as e:
                    logger.warning(f"Skipping invalid detection {det}: {e}")
                    continue
            
            processing_time = (time.time() - start_time) * 1000
            
            logger.info(f"✅ Detected {len(detections)} objects in {processing_time:.0f}ms")
            
            return AnalyzeResponse(
                detections=detections,
                processing_time_ms=processing_time
            )
            
        except json.JSONDecodeError as e:
            logger.error(f"❌ JSON parse error: {e}")
            logger.error(f"Response text (full): {response.text}")
            # Return empty detections on parse error
            return AnalyzeResponse(
                detections=[],
                processing_time_ms=(time.time() - start_time) * 1000
            )
        except Exception as e:
            logger.error(f"❌ Unexpected error parsing response: {e}")
            logger.error(f"Response text: {response.text}")
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

