"""
Bus Crowd Indication System - Backend
FastAPI + YOLOv8 for person detection and seat estimation
"""

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import cv2
import numpy as np
import base64
import io
from pydantic import BaseModel
import tempfile
import os
import logging
from typing import Optional
import json

# Try to import ultralytics (YOLOv8)
try:
    from ultralytics import YOLO
    YOLO_AVAILABLE = True
except ImportError:
    YOLO_AVAILABLE = False
    logging.warning("YOLOv8 not available. Install with: pip install ultralytics")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Bus Crowd Indication System",
    description="Analyzes crowd density in bus images/videos and returns occupancy status",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Bus capacity configuration
BUS_CONFIG = {
    "total_seats": 40,          # Total seating capacity
    "total_capacity": 60,       # Total capacity including standing
    "green_threshold": 0.50,    # Below 50% of seats = seats available (GREEN)
    "orange_threshold": 0.85,   # 50-85% of seats = standing only (ORANGE)
    # Above 85% of seats = bus full (RED)
}

# Global model instance
model = None

def load_model():
    """Load YOLOv8 model (person detection only)"""
    global model
    if YOLO_AVAILABLE and model is None:
        try:
            model = YOLO("yolov8n.pt")  # nano model - fastest
            logger.info("YOLOv8 model loaded successfully")
        except Exception as e:
            logger.error(f"Failed to load YOLO model: {e}")
            model = None
    return model

def crowd_density_score(image: np.ndarray, boxes: list) -> dict:
    """
    Estimate true occupancy using bounding-box coverage of the frame.

    In a packed bus, many people are occluded so YOLO under-counts them.
    We compensate by:
      1. Computing what fraction of the frame area the detected boxes cover.
      2. Mapping that coverage to an estimated passenger count that reflects
         how crowded the bus truly is.

    Coverage thresholds (tuned for interior bus shots):
      < 15%  → sparse   → raw count is reliable
      15-35% → moderate → multiply raw count × 1.5
      35-55% → dense    → multiply raw count × 2.5  (standing crowd)
      > 55%  → packed   → force to 90-100% of seat capacity (BUS FULL)
    """
    h, w = image.shape[:2]
    frame_area = h * w
    if frame_area == 0 or not boxes:
        return {"coverage_pct": 0.0, "density_label": "empty", "estimated_count": 0}

    # Union-area approximation: clip each box to frame then sum areas
    # (we use sum rather than true union to keep it fast; it's an upper bound
    #  which is intentional — partial overlaps mean even more people)
    total_box_area = 0
    for b in boxes:
        bw = min(b["width"],  w - b["x"])
        bh = min(b["height"], h - b["y"])
        total_box_area += max(0, bw) * max(0, bh)

    coverage = min(total_box_area / frame_area, 1.0)  # 0-1
    coverage_pct = round(coverage * 100, 1)
    raw = len(boxes)
    seats = BUS_CONFIG["total_seats"]

    if coverage < 0.15:
        density_label = "sparse"
        estimated = raw                          # YOLO count is reliable
    elif coverage < 0.35:
        density_label = "moderate"
        estimated = int(raw * 1.5)              # mild occlusion
    elif coverage < 0.55:
        density_label = "dense"
        estimated = int(raw * 2.5)              # heavy occlusion (standing)
    else:
        density_label = "packed"
        # Frame is almost entirely people → bus is definitely full
        estimated = int(seats * 0.95)           # 95% of seats → RED

    return {
        "coverage_pct": coverage_pct,
        "density_label": density_label,
        "estimated_count": estimated,
    }


def detect_persons_yolo(image: np.ndarray) -> dict:
    """Detect persons using YOLOv8 with density-aware occupancy estimation."""
    m = load_model()
    if m is None:
        return fallback_detection(image)

    # Lower confidence threshold to catch occluded / partial people
    results = m(image, classes=[0], conf=0.25, verbose=False)  # class 0 = person
    boxes = []

    for result in results:
        for box in result.boxes:
            if int(box.cls[0]) == 0:
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                conf = float(box.conf[0])
                boxes.append({
                    "x": x1, "y": y1,
                    "width": x2 - x1,
                    "height": y2 - y1,
                    "confidence": round(conf, 3)
                })

    density = crowd_density_score(image, boxes)

    return {
        "person_count": density["estimated_count"],   # density-adjusted count
        "raw_detected": len(boxes),                   # what YOLO actually saw
        "coverage_pct": density["coverage_pct"],
        "density_label": density["density_label"],
        "boxes": boxes,
        "method": "YOLOv8",
    }

def fallback_detection(image: np.ndarray) -> dict:
    """
    Fallback: HOG-based person detection when YOLO not available
    """
    hog = cv2.HOGDescriptor()
    hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
    
    # Resize for performance
    h, w = image.shape[:2]
    scale = min(640 / w, 480 / h)
    resized = cv2.resize(image, (int(w * scale), int(h * scale)))
    
    rects, weights = hog.detectMultiScale(
        resized,
        winStride=(8, 8),
        padding=(4, 4),
        scale=1.05,
        useMeanshiftGrouping=False
    )

    # OpenCV returns () when nothing is detected; normalise to list
    if not isinstance(rects, np.ndarray) or len(rects) == 0:
        return {"person_count": 0, "boxes": [], "method": "HOG"}

    boxes = []
    for (x, y, bw, bh), weight in zip(rects, weights):
        # In newer OpenCV, weight may be a scalar or a 1-element array
        conf = float(weight[0]) if hasattr(weight, '__len__') else float(weight)
        boxes.append({
            "x": int(x / scale),
            "y": int(y / scale),
            "width": int(bw / scale),
            "height": int(bh / scale),
            "confidence": round(conf, 3)
        })

    density = crowd_density_score(image, boxes)

    return {
        "person_count": density["estimated_count"],
        "raw_detected": len(rects),
        "coverage_pct": density["coverage_pct"],
        "density_label": density["density_label"],
        "boxes": boxes,
        "method": "HOG",
    }

def calculate_status(person_count: int) -> dict:
    """
    Determine bus status based on detected person count vs seated capacity.
    We compare against seated capacity (not total) because camera images
    typically capture visible passengers, not the full standing crowd.

    GREEN  → seats available   (< 50% of seats filled)
    ORANGE → standing only     (50–85% of seats filled)
    RED    → bus is full       (> 85% of seats filled)
    """
    total = BUS_CONFIG["total_capacity"]
    seats = BUS_CONFIG["total_seats"]

    # Use seated capacity as the reference — more realistic for image-based detection
    seat_ratio = min(person_count / seats, 1.0)

    if seat_ratio < BUS_CONFIG["green_threshold"]:
        status = "GREEN"
        message = "Seats Available"
        color = "#00C853"
        seats_left = max(0, seats - person_count)
        description = f"Approximately {seats_left} seats available"
    elif seat_ratio < BUS_CONFIG["orange_threshold"]:
        status = "ORANGE"
        message = "Standing Space Only"
        color = "#FF6D00"
        standing_left = max(0, total - person_count)
        description = f"Approximately {standing_left} standing spots left"
    else:
        status = "RED"
        message = "Bus is Full"
        color = "#D50000"
        description = "No space available. Wait for next bus."

    return {
        "status": status,
        "message": message,
        "color": color,
        "description": description,
        "person_count": person_count,
        "occupancy_ratio": round(seat_ratio * 100, 1),  # % of seats filled
        "total_capacity": total,
        "seated_capacity": seats,
    }

def draw_annotated_frame(image: np.ndarray, boxes: list, status_info: dict) -> str:
    """Draw bounding boxes and status overlay on frame, return as base64"""
    annotated = image.copy()
    # Note: OpenCV uses BGR channel order
    color_map = {
        "GREEN":  (83,  200,   0),   # BGR for #00C853
        "ORANGE": (0,   109, 255),   # BGR for #FF6D00
        "RED":    (0,     0, 213),   # BGR for #D50000
    }
    box_color = color_map.get(status_info["status"], (255, 255, 255))
    
    # Draw person bounding boxes
    for box in boxes:
        x, y, w, h = box["x"], box["y"], box["width"], box["height"]
        cv2.rectangle(annotated, (x, y), (x + w, y + h), box_color, 2)
        label = f"{box['confidence']:.2f}"
        cv2.putText(annotated, label, (x, y - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, box_color, 1)
    
    # Status banner at top
    banner_h = 60
    overlay = annotated.copy()
    cv2.rectangle(overlay, (0, 0), (annotated.shape[1], banner_h), box_color, -1)
    cv2.addWeighted(overlay, 0.75, annotated, 0.25, 0, annotated)
    
    status_text = f"{status_info['message']}  |  {status_info['person_count']} people  |  {status_info['occupancy_ratio']}% full"
    cv2.putText(annotated, status_text, (12, 38),
                cv2.FONT_HERSHEY_DUPLEX, 0.7, (255, 255, 255), 2)
    
    # Encode to base64
    _, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 88])
    return base64.b64encode(buf).decode("utf-8")

def decode_image(file_bytes: bytes) -> np.ndarray:
    """Decode uploaded file bytes to OpenCV image"""
    nparr = np.frombuffer(file_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image")
    return img

# ─── Routes ──────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"status": "ok", "service": "Bus Crowd Indication System"}

@app.get("/health")
def health():
    return {
        "status": "healthy",
        "yolo_available": YOLO_AVAILABLE,
        "model_loaded": model is not None,
        "bus_config": BUS_CONFIG
    }

@app.get("/config")
def get_config():
    return BUS_CONFIG

class BusConfigUpdate(BaseModel):
    total_seats: int
    total_capacity: int
    green_threshold: float = 0.60
    orange_threshold: float = 0.90

@app.post("/config")
def update_config(config: BusConfigUpdate):
    BUS_CONFIG.update({
        "total_seats": config.total_seats,
        "total_capacity": config.total_capacity,
        "green_threshold": config.green_threshold,
        "orange_threshold": config.orange_threshold,
    })
    return {"message": "Config updated", "config": BUS_CONFIG}

@app.post("/analyze/image")
async def analyze_image(file: UploadFile = File(...)):
    """
    Analyze a single image for crowd density.
    Returns status (GREEN/ORANGE/RED), person count, annotated image.
    """
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Only image files are accepted")
    
    try:
        raw = await file.read()
        img = decode_image(raw)
        detection = detect_persons_yolo(img)
        status_info = calculate_status(detection["person_count"])
        annotated_b64 = draw_annotated_frame(img, detection["boxes"], status_info)
        
        return JSONResponse({
            "success": True,
            "detection": detection,
            "status": status_info,
            "annotated_image": annotated_b64,
            "detection_method": detection["method"]
        })
    
    except Exception as e:
        logger.exception("Image analysis error")
        raise HTTPException(500, f"Analysis failed: {str(e)}")

@app.post("/analyze/video-frame")
async def analyze_video_frame(file: UploadFile = File(...)):
    """
    Analyze a single video frame (JPEG/PNG bytes from frontend).
    Same response as /analyze/image.
    """
    return await analyze_image(file)

@app.post("/analyze/video")
async def analyze_video(file: UploadFile = File(...)):
    """
    Analyze a short video clip. Samples frames and returns aggregate result.
    """
    if not file.content_type.startswith("video/"):
        raise HTTPException(400, "Only video files are accepted")
    
    tmp_path = None
    try:
        raw = await file.read()
        
        # Write to temp file
        suffix = os.path.splitext(file.filename or "")[1] or ".mp4"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(raw)
            tmp_path = tmp.name
        
        cap = cv2.VideoCapture(tmp_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS) or 25  # noqa: F841

        if total_frames == 0:
            cap.release()
            raise HTTPException(422, "Video has no readable frames")

        # Sample up to 10 evenly spaced frames
        num_samples = min(10, total_frames)
        sample_indices = np.linspace(0, total_frames - 1, num_samples, dtype=int)
        counts = []
        last_frame = None
        last_boxes = []
        
        for idx in sample_indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
            ret, frame = cap.read()
            if not ret:
                continue
            det = detect_persons_yolo(frame)
            counts.append(det["person_count"])
            last_frame = frame
            last_boxes = det["boxes"]
        
        cap.release()
        
        if not counts:
            raise HTTPException(422, "Could not read any frames from video")
        
        # Use median count for robustness
        median_count = int(np.median(counts))
        status_info = calculate_status(median_count)
        annotated_b64 = draw_annotated_frame(last_frame, last_boxes, status_info) if last_frame is not None else ""
        
        return JSONResponse({
            "success": True,
            "frames_analyzed": len(counts),
            "frame_counts": counts,
            "median_count": median_count,
            "status": status_info,
            "annotated_image": annotated_b64,
            "detection_method": "YOLOv8" if YOLO_AVAILABLE else "HOG"
        })
    
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Video analysis error")
        raise HTTPException(500, f"Video analysis failed: {str(e)}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)