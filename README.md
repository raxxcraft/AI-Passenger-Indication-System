# BusVision – Bus Crowd Indication System

Real-time bus occupancy detection using YOLOv8 + React.

## Status Logic
| Board Color | Meaning         | Threshold              |
|-------------|-----------------|------------------------|
| 🟢 GREEN    | Seats Available | < 60% capacity         |
| 🟠 ORANGE   | Standing Only   | 60 – 90% capacity      |
| 🔴 RED      | Bus is Full     | > 90% capacity         |

---

## Setup

### 1. Backend (Python / FastAPI)

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

> **YOLOv8** (`ultralytics`) will auto-download `yolov8n.pt` on first run.
> If it fails, the system falls back to OpenCV HOG detector.

### 2. Frontend (React)

```bash
cd frontend
npm install
npm start
```

Opens at **http://localhost:3000**

---

## API Endpoints

| Method | Endpoint              | Description                        |
|--------|-----------------------|------------------------------------|
| GET    | `/health`             | Health check + model status        |
| GET    | `/config`             | Get bus capacity config            |
| POST   | `/config`             | Update capacity thresholds         |
| POST   | `/analyze/image`      | Analyze uploaded image             |
| POST   | `/analyze/video`      | Analyze uploaded video (sampled)   |
| POST   | `/analyze/video-frame`| Analyze single video frame (live)  |

---

## Configuration
Edit `backend/main.py` → `BUS_CONFIG`:
```python
BUS_CONFIG = {
    "total_seats": 40,       # Seating capacity
    "total_capacity": 60,    # Total incl. standing
    "green_threshold": 0.60, # < 60% → GREEN
    "orange_threshold": 0.90 # 60-90% → ORANGE, >90% → RED
}
```

---

## Project Structure
```
bus-indication-system/
├── backend/
│   ├── main.py           # FastAPI + YOLOv8 analysis
│   └── requirements.txt
└── frontend/
    ├── public/
    │   └── index.html
    ├── src/
    │   ├── App.js        # Main React UI
    │   ├── App.css       # Styles
    │   └── index.js
    └── package.json
```