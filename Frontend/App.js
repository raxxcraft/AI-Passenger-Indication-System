import React, { useState, useRef, useCallback, useEffect } from "react";
import axios from "axios";
import "./App.css";

const API = "http://localhost:8000";

/* ─── Status config ─────────────────────────────────────────── */
const STATUS_CONFIG = {
  GREEN: {
    label: "Seats Available",
    color: "#00C853",
    glow: "0 0 40px #00C853aa, 0 0 80px #00C85355",
    bg: "linear-gradient(135deg,#003d1a,#005724)",
    icon: "🟢",
    boardText: "SEATS\nAVAILABLE",
    pulse: "pulse-green",
  },
  ORANGE: {
    label: "Standing Space Only",
    color: "#FF6D00",
    glow: "0 0 40px #FF6D00aa, 0 0 80px #FF6D0055",
    bg: "linear-gradient(135deg,#3d1a00,#572400)",
    icon: "🟠",
    boardText: "STANDING\nONLY",
    pulse: "pulse-orange",
  },
  RED: {
    label: "Bus is Full",
    color: "#D50000",
    glow: "0 0 40px #D50000aa, 0 0 80px #D5000055",
    bg: "linear-gradient(135deg,#3d0000,#570000)",
    icon: "🔴",
    boardText: "BUS\nFULL",
    pulse: "pulse-red",
  },
};

/* ─── Bus SVG Component ──────────────────────────────────────── */
function BusSVG({ status, animating }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG["GREEN"];
  const boardColor = cfg.color;
  const lightsOn = status !== null;

  return (
    <svg
      viewBox="0 0 520 220"
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: "100%", maxWidth: 520, filter: animating ? "drop-shadow(0 8px 32px rgba(0,0,0,0.6))" : "none" }}
    >
      {/* Shadow */}
      <ellipse cx="260" cy="210" rx="200" ry="12" fill="rgba(0,0,0,0.35)" />

      {/* Wheels */}
      <circle cx="108" cy="195" r="22" fill="#1a1a1a" stroke="#333" strokeWidth="3" />
      <circle cx="108" cy="195" r="10" fill="#2a2a2a" stroke="#555" strokeWidth="2" />
      <circle cx="380" cy="195" r="22" fill="#1a1a1a" stroke="#333" strokeWidth="3" />
      <circle cx="380" cy="195" r="10" fill="#2a2a2a" stroke="#555" strokeWidth="2" />

      {/* Body */}
      <rect x="30" y="60" width="460" height="130" rx="18" fill="#1e3a5f" />
      {/* Purple stripe */}
      <rect x="30" y="145" width="460" height="28" rx="0" fill="#6a1b9a" />
      {/* Teal stripe */}
      <rect x="30" y="168" width="460" height="14" rx="0" fill="#00838f" />

      {/* Front cab */}
      <rect x="420" y="80" width="65" height="80" rx="10" fill="#162d47" />
      {/* Windshield */}
      <rect x="428" y="90" width="50" height="50" rx="6" fill="#aad4ee" opacity="0.85" />

      {/* Windows row */}
      {[60, 120, 180, 240, 300, 360].map((x, i) => (
        <rect key={i} x={x + 2} y="78" width="48" height="40" rx="6"
          fill="#aad4ee" opacity="0.7" stroke="#5599bb" strokeWidth="1" />
      ))}

      {/* Door */}
      <rect x="56" y="108" width="40" height="52" rx="4" fill="#1a3050"
        stroke="#5599bb" strokeWidth="1.5" />
      <line x1="76" y1="112" x2="76" y2="156" stroke="#5599bb" strokeWidth="1" />

      {/* ── STATUS BOARD (top, spans front of bus) ─────── */}
      <rect x="155" y="20" width="220" height="50" rx="10"
        fill="#0a0a0a" stroke={boardColor} strokeWidth="3"
        style={{ filter: `drop-shadow(0 0 14px ${boardColor})` }}
      />
      {/* Board colour fill */}
      <rect x="160" y="25" width="210" height="40" rx="7" fill={boardColor} opacity={lightsOn ? 0.92 : 0.15} />
      {/* Board text */}
      {lightsOn && (
        <text x="265" y="50" textAnchor="middle" fill="white"
          fontFamily="'Courier New', monospace" fontWeight="bold" fontSize="13"
          style={{ textTransform: "uppercase", letterSpacing: "2px" }}>
          {cfg.boardText.replace("\n", " · ")}
        </text>
      )}
      {!lightsOn && (
        <text x="265" y="50" textAnchor="middle" fill="#555"
          fontFamily="'Courier New', monospace" fontSize="11">
          AWAITING SCAN
        </text>
      )}

      {/* MTC logo area */}
      <rect x="60" y="82" width="36" height="18" rx="3" fill="#9c27b0" />
      <text x="78" y="95" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold">MTC</text>

      {/* Headlights */}
      <circle cx="478" cy="182" r="9" fill={lightsOn ? "#ffe066" : "#555"}
        style={{ filter: lightsOn ? "drop-shadow(0 0 8px #ffe066)" : "none" }} />
      {/* Tail lights */}
      <circle cx="36" cy="182" r="7" fill={lightsOn ? "#ff1a1a" : "#333"}
        style={{ filter: lightsOn ? "drop-shadow(0 0 8px #ff1a1a)" : "none" }} />
    </svg>
  );
}

/* ─── Road Component ────────────────────────────────────────── */
function Road({ animating }) {
  return (
    <div className="road-wrap">
      <div className="road">
        <div className={`dashes ${animating ? "dash-anim" : ""}`}>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="dash" />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Status Board Panel ─────────────────────────────────────── */
function StatusBoard({ result }) {
  if (!result) {
    return (
      <div className="board-idle">
        <div className="board-idle-icon">🚌</div>
        <p>Upload an image or video to analyze bus occupancy</p>
      </div>
    );
  }

  const { status } = result;
  const cfg = STATUS_CONFIG[status];

  return (
    <div className="board-result">
      {/* Three indicator lights */}
      <div className="lights-row">
        {["GREEN", "ORANGE", "RED"].map((s) => {
          const c = STATUS_CONFIG[s];
          const active = s === status;
          return (
            <div key={s} className={`indicator-light ${active ? "light-active " + c.pulse : ""}`}
              style={{ background: active ? c.color : "#1a1a1a", boxShadow: active ? c.glow : "none" }}>
              <span className="light-label">{c.label}</span>
            </div>
          );
        })}
      </div>

      {/* Main status card */}
      <div className="status-card" style={{ background: cfg.bg, borderColor: cfg.color }}>
        <div className="status-icon-large" style={{ color: cfg.color }}>{cfg.icon}</div>
        <div className="status-label" style={{ color: cfg.color }}>{cfg.label}</div>
        <div className="status-desc">{result.description}</div>
      </div>

      {/* Stats grid */}
      <div className="stats-grid">
        <div className="stat-box">
          <span className="stat-val">{result.person_count}</span>
          <span className="stat-key">People Detected</span>
        </div>
        <div className="stat-box">
          <span className="stat-val" style={{ color: cfg.color }}>{result.occupancy_ratio}%</span>
          <span className="stat-key">Occupancy</span>
        </div>
        <div className="stat-box">
          <span className="stat-val">{result.total_capacity}</span>
          <span className="stat-key">Total Capacity</span>
        </div>
        <div className="stat-box">
          <span className="stat-val">{result.seated_capacity}</span>
          <span className="stat-key">Seat Capacity</span>
        </div>
      </div>

      {/* Occupancy bar */}
      <div className="occ-bar-wrap">
        <span className="occ-label">Occupancy Level</span>
        <div className="occ-bar-bg">
          <div
            className="occ-bar-fill"
            style={{
              width: `${result.occupancy_ratio}%`,
              background: cfg.color,
              boxShadow: `0 0 12px ${cfg.color}88`,
            }}
          />
        </div>
        <span className="occ-pct" style={{ color: cfg.color }}>{result.occupancy_ratio}%</span>
      </div>
    </div>
  );
}

/* ─── Main App ───────────────────────────────────────────────── */
export default function App() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [isVideo, setIsVideo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [annotated, setAnnotated] = useState(null);
  const [error, setError] = useState(null);
  const [busStatus, setBusStatus] = useState(null);
  const [busMoving, setBusMoving] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [liveInterval, setLiveInterval] = useState(null);

  const fileInputRef = useRef();
  const videoRef = useRef();
  const captureCanvasRef = useRef();
  const liveVideoRef = useRef();

  /* drag-and-drop */
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  }, []);

  function handleFileSelect(f) {
    setError(null);
    setResult(null);
    setAnnotated(null);
    setBusStatus(null);
    setFile(f);
    const url = URL.createObjectURL(f);
    setPreview(url);
    setIsVideo(f.type.startsWith("video/"));
  }

  /* analyze */
  async function analyze() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setBusMoving(true);

    try {
      const fd = new FormData();
      fd.append("file", file);
      const endpoint = isVideo ? "/analyze/video" : "/analyze/image";
      const { data } = await axios.post(`${API}${endpoint}`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setResult(data.status);
      setBusStatus(data.status.status);
      if (data.annotated_image) {
        setAnnotated("data:image/jpeg;base64," + data.annotated_image);
      }
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || "Analysis failed";
      setError(msg);
      setBusMoving(false);
    } finally {
      setLoading(false);
    }
  }

  /* live webcam capture */
  async function startLive() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        liveVideoRef.current.play();
      }
      setLiveMode(true);
      const interval = setInterval(() => captureAndSend(), 2500);
      setLiveInterval(interval);
    } catch {
      setError("Camera access denied");
    }
  }

  function stopLive() {
    clearInterval(liveInterval);
    if (liveVideoRef.current?.srcObject) {
      liveVideoRef.current.srcObject.getTracks().forEach((t) => t.stop());
    }
    setLiveMode(false);
  }

  async function captureAndSend() {
    if (!liveVideoRef.current || !captureCanvasRef.current) return;
    const canvas = captureCanvasRef.current;
    const ctx = canvas.getContext("2d");
    canvas.width = liveVideoRef.current.videoWidth;
    canvas.height = liveVideoRef.current.videoHeight;
    ctx.drawImage(liveVideoRef.current, 0, 0);
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const fd = new FormData();
      fd.append("file", blob, "frame.jpg");
      try {
        const { data } = await axios.post(`${API}/analyze/image`, fd);
        setResult(data.status);
        setBusStatus(data.status.status);
        setBusMoving(true);
        if (data.annotated_image) setAnnotated("data:image/jpeg;base64," + data.annotated_image);
      } catch {}
    }, "image/jpeg", 0.85);
  }

  useEffect(() => () => clearInterval(liveInterval), [liveInterval]);

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-icon">🚌</span>
            <div>
              <div className="logo-title">BusVision</div>
              <div className="logo-sub">Smart Crowd Indication System</div>
            </div>
          </div>
          <div className="legend">
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <div key={k} className="legend-item">
                <div className="legend-dot" style={{ background: v.color, boxShadow: `0 0 8px ${v.color}88` }} />
                <span>{v.label}</span>
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* Main panels */}
      <main className="panels">
        {/* LEFT — Upload / Preview */}
        <section className="panel panel-left">
          <div className="panel-title">📷 Input Analysis</div>

          {/* Upload zone */}
          <div
            className={`drop-zone ${file ? "drop-zone-active" : ""}`}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => !liveMode && fileInputRef.current.click()}
          >
            {liveMode ? (
              <video ref={liveVideoRef} className="preview-media" autoPlay muted playsInline />
            ) : preview ? (
              isVideo ? (
                <video ref={videoRef} src={preview} className="preview-media" controls />
              ) : (
                <img src={annotated || preview} className="preview-media" alt="preview" />
              )
            ) : (
              <div className="drop-hint">
                <div className="drop-icon">⬆</div>
                <div className="drop-text">Drop image or video here</div>
                <div className="drop-sub">or click to browse</div>
                <div className="drop-formats">JPG · PNG · MP4 · AVI · MOV</div>
              </div>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            style={{ display: "none" }}
            onChange={(e) => e.target.files[0] && handleFileSelect(e.target.files[0])}
          />

          {/* Controls */}
          <div className="controls">
            <button
              className="btn btn-primary"
              onClick={analyze}
              disabled={!file || loading || liveMode}
            >
              {loading ? (
                <><span className="spinner" /> Analyzing…</>
              ) : (
                "🔍 Analyze"
              )}
            </button>

            <button
              className={`btn ${liveMode ? "btn-danger" : "btn-secondary"}`}
              onClick={liveMode ? stopLive : startLive}
            >
              {liveMode ? "⏹ Stop Live" : "📡 Live Camera"}
            </button>
          </div>

          {error && <div className="error-msg">⚠ {error}</div>}

          <canvas ref={captureCanvasRef} style={{ display: "none" }} />
        </section>

        {/* RIGHT — Bus animation + status */}
        <section className="panel panel-right">
          <div className="panel-title">🚌 Bus Status Display</div>

          {/* Bus animation */}
          <div className="bus-stage" style={busStatus ? { background: STATUS_CONFIG[busStatus].bg } : {}}>
            <div className={`bus-wrap ${busMoving ? "bus-moving" : ""}`}>
              <BusSVG status={busStatus} animating={busMoving} />
            </div>
            <Road animating={busMoving} />

            {/* Glow ring behind bus */}
            {busStatus && (
              <div
                className="bus-glow"
                style={{ background: `radial-gradient(ellipse, ${STATUS_CONFIG[busStatus].color}22 0%, transparent 70%)` }}
              />
            )}
          </div>

          {/* Status board */}
          <StatusBoard result={result} />
        </section>
      </main>

      <footer className="footer">
        <span>BusVision — MTC Chennai &nbsp;·&nbsp; Powered by YOLOv8 + React</span>
      </footer>
    </div>
  );
}