"use client";

import { useState, useEffect, useRef, useCallback } from "react";
// تأكد أيضاً من استيراد useEffect إذا كنت تستخدم isMounted

// ============================================================
// Types (متوافقة مع الـ API Route)
// ============================================================
type Confidence = "high" | "medium" | "low";
type AnalysisQuality = "excellent" | "good" | "partial" | "failed";

interface ProductItem {
  product_name: string;
  brand: string;
  category: string;
  unit_price: string;
  quantity: number | string;
  barcode: string;
  confidence: Confidence;
  notes: string;
}

interface AnalysisResult {
  success: boolean;
  products: ProductItem[];
  total_products_detected: number;
  analysis_quality: AnalysisQuality;
  warnings: string[];
}

// ============================================================
// Sub-components
// ============================================================

function ConfidenceBadge({ level }: { level: Confidence }) {
  const map: Record<Confidence, { label: string; class: string }> = {
    high: { label: "دقة عالية", class: "badge-success" },
    medium: { label: "دقة متوسطة", class: "badge-warning" },
    low: { label: "دقة منخفضة", class: "badge-danger" },
  };
  const { label, class: cls } = map[level] ?? map.medium;
  return <span className={`badge ${cls}`}>{label}</span>;
}

function QualityBar({ quality }: { quality: AnalysisQuality }) {
  const map: Record<AnalysisQuality, { label: string; width: string; color: string }> = {
    excellent: { label: "ممتاز", width: "100%", color: "#10b981" },
    good: { label: "جيد", width: "75%", color: "#3b82f6" },
    partial: { label: "جزئي", width: "45%", color: "#f59e0b" },
    failed: { label: "فشل", width: "10%", color: "#ef4444" },
  };
  const { label, width, color } = map[quality] ?? map.good;
  return (
    <div className="quality-bar-wrapper">
      <span className="quality-label">جودة التحليل: {label}</span>
      <div className="quality-track">
        <div className="quality-fill" style={{ width, background: color }} />
      </div>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return (
    <div className="stat-card">
      <span className="stat-icon">{icon}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function ProductCard({
  item,
  index,
  onChange,
  onDelete,
  currencySymbol,
}: {
  item: ProductItem;
  index: number;
  onChange: (idx: number, field: keyof ProductItem, value: string) => void;
  onDelete: (idx: number) => void;
  currencySymbol: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="product-card">
      <div className="product-card-header" onClick={() => setExpanded((p) => !p)}>
        <div className="product-card-left">
          <div className="product-index">#{index + 1}</div>
          <div>
            <div className="product-name">{item.product_name || "منتج غير معروف"}</div>
            <div className="product-meta">
              {item.brand && <span className="chip chip-brand">{item.brand}</span>}
              {item.category && <span className="chip chip-cat">{item.category}</span>}
            </div>
          </div>
        </div>
        <div className="product-card-right">
          <ConfidenceBadge level={item.confidence} />
          <span className="expand-icon">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      <div className="product-quick-stats">
        <div className="quick-stat">
          <span className="qs-label">الكمية</span>
          <span className="qs-value">{item.quantity || "—"}</span>
        </div>
        <div className="quick-stat">
          <span className="qs-label">السعر</span>
          <span className="qs-value">{item.unit_price ? `${item.unit_price} ${currencySymbol}` : "—"}</span>
        </div>
        {item.barcode && (
          <div className="quick-stat">
            <span className="qs-label">باركود</span>
            <span className="qs-value barcode">{item.barcode}</span>
          </div>
        )}
      </div>

      {expanded && (
        <div className="product-edit-section">
          <div className="edit-grid">
            {(
              [
                { key: "product_name", label: "اسم المنتج" },
                { key: "brand", label: "الماركة" },
                { key: "category", label: "التصنيف" },
                { key: "unit_price", label: "السعر" },
                { key: "quantity", label: "الكمية" },
                { key: "barcode", label: "الباركود" },
              ] as { key: keyof ProductItem; label: string }[]
            ).map(({ key, label }) => (
              <div key={key} className="edit-field">
                <label className="edit-label">{label}</label>
                <input
                  className="edit-input"
                  value={String(item[key] ?? "")}
                  onChange={(e) => onChange(index, key, e.target.value)}
                  dir="rtl"
                />
              </div>
            ))}
          </div>
          {item.notes && (
            <div className="notes-row">
              <span className="notes-icon">ℹ</span>
              <span className="notes-text">{item.notes}</span>
            </div>
          )}
          <button className="delete-btn" onClick={() => onDelete(index)}>
            حذف هذا المنتج
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Camera / Upload Component
// ============================================================
function ImageCapture({ onCapture, disabled }: { onCapture: (img: string) => void; disabled: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) onCapture(e.target.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readFile(file);
  };

  return (
    <div className="capture-zone">
      <div className="capture-icon">📷</div>
      <p className="capture-title">التقط صورة الرف أو ارفع صورة</p>
      <p className="capture-sub">JPEG · PNG · WEBP · حتى 10MB</p>
      <div className="capture-buttons">
        <button className="btn btn-primary" disabled={disabled} onClick={() => cameraRef.current?.click()}>
          📸 كاميرا
        </button>
        <button className="btn btn-secondary" disabled={disabled} onClick={() => fileRef.current?.click()}>
          📁 رفع صورة
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleChange} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleChange} />
    </div>
  );
}

// ============================================================
// Video Capture Component
// ============================================================
const LIGHTING_MODES = [
  { id: "auto",   label: "تلقائي",       icon: "✨", filter: "none",                                                              desc: "للإضاءة الطبيعية المعتدلة" },
  { id: "bright", label: "إضاءة عالية", icon: "☀️", filter: "brightness(0.65) contrast(1.2) saturate(1.05)",                    desc: "للأماكن ذات الإضاءة القوية جداً" },
  { id: "dark",   label: "إضاءة خافتة", icon: "🌙", filter: "brightness(1.7) contrast(1.25) saturate(1.3)",                     desc: "للمخازن المظلمة أو الليل" },
  { id: "warm",   label: "إضاءة دافئة", icon: "🕯️", filter: "brightness(1.1) contrast(1.1) saturate(0.85) sepia(0.15)",         desc: "للإضاءة الصفراء الدافئة" },
  { id: "cold",   label: "إضاءة باردة", icon: "❄️", filter: "brightness(1.1) contrast(1.2) saturate(1.4) hue-rotate(10deg)",   desc: "للإضاءة الفلورية الباردة" },
  { id: "sharp",  label: "تعزيز الحدة", icon: "🔍", filter: "contrast(1.4) saturate(1.35) brightness(0.95)",                   desc: "لتحسين وضوح النصوص والباركود" },
  { id: "night",  label: "جرد ليلي",    icon: "🌃", filter: "brightness(2.0) contrast(1.35) saturate(1.15) grayscale(0.05)",   desc: "إضاءة منخفضة جداً بدون flash" },
];

function VideoCapture({ onCapture, disabled }: { onCapture: (img: string) => void; disabled: boolean }) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [isOpen,        setIsOpen]        = useState(false);
  const [lightingMode,  setLightingMode]  = useState(LIGHTING_MODES[0]);
  const [capturing,     setCapturing]     = useState(false);
  const [countdown,     setCountdown]     = useState<number | null>(null);
  const [camError,      setCamError]      = useState<string | null>(null);
  const [snapPreview,   setSnapPreview]   = useState<string | null>(null);
  const [autoMode,      setAutoMode]      = useState(false);
  const autoTimerRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCamera = async () => {
    setCamError(null);
    setSnapPreview(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setIsOpen(true);
    } catch {
      setCamError("تعذّر الوصول للكاميرا. تأكد من منح الإذن في إعدادات المتصفح.");
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (autoTimerRef.current) clearInterval(autoTimerRef.current);
    setIsOpen(false);
    setAutoMode(false);
    setCountdown(null);
    setCapturing(false);
    setSnapPreview(null);
  };

  const captureFrame = (): string | null => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;

    const W = video.videoWidth  || 1280;
    const H = video.videoHeight || 720;
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.filter = lightingMode.filter === "none" ? "none" : lightingMode.filter;
    ctx.drawImage(video, 0, 0, W, H);
    ctx.filter = "none";

    return canvas.toDataURL("image/jpeg", 0.85);
  };

  const handleSnap = () => {
    if (capturing) return;
    setCapturing(true);
    setCountdown(3);

    let count = 3;
    const timer = setInterval(() => {
      count--;
      setCountdown(count);
      if (count === 0) {
        clearInterval(timer);
        const img = captureFrame();
        if (img) {
          setSnapPreview(img);
          setCountdown(null);
          setCapturing(false);
        }
      }
    }, 1000);
  };

  const confirmFrame = () => {
    if (snapPreview) {
      onCapture(snapPreview);
      stopCamera();
    }
  };

  const retakeFrame = () => {
    setSnapPreview(null);
    setCapturing(false);
    setCountdown(null);
  };

  const toggleAutoMode = () => {
    if (autoMode) {
      if (autoTimerRef.current) clearInterval(autoTimerRef.current);
      setAutoMode(false);
      return;
    }
    setAutoMode(true);
    autoTimerRef.current = setInterval(() => {
      const img = captureFrame();
      if (img) onCapture(img);
    }, 3000);
  };

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (autoTimerRef.current) clearInterval(autoTimerRef.current);
    };
  }, []);

  if (!isOpen) {
    return (
      <div style={{ marginTop: "0.75rem" }}>
        {camError && (
          <div style={{
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
            borderRadius: "10px", padding: "0.6rem 0.9rem",
            fontSize: "0.75rem", color: "#f87171", marginBottom: "0.5rem",
          }}>
            ⚠️ {camError}
          </div>
        )}
        <button
          className="btn btn-secondary"
          disabled={disabled}
          onClick={startCamera}
          style={{ width: "100%", justifyContent: "center", gap: "0.5rem", padding: "0.7rem" }}
        >
          🎥 جرد بالفيديو (كل الإضاءات)
        </button>
      </div>
    );
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.95)",
      zIndex: 400, display: "flex", flexDirection: "column",
    }}>
      <canvas ref={canvasRef} style={{ display: "none" }} />

      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.75rem 1rem",
        background: "rgba(10,14,26,0.95)",
        borderBottom: "1px solid rgba(99,157,255,0.15)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "1rem" }}>🎥</span>
          <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#f1f5f9" }}>جرد بالفيديو</span>
          <span style={{
            background: "rgba(239,68,68,0.2)", border: "1px solid rgba(239,68,68,0.4)",
            color: "#f87171", fontSize: "0.6rem", padding: "2px 7px", borderRadius: "10px",
            animation: "pulse-rec 1.5s infinite",
          }}>● LIVE</span>
        </div>
        <button onClick={stopCamera} style={{
          background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
          color: "#f87171", padding: "0.3rem 0.8rem", borderRadius: "8px",
          fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
        }}>
          ✕ إغلاق
        </button>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
        <div style={{ flex: 1, position: "relative", overflow: "hidden", minHeight: 0 }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: "100%", height: "100%",
              objectFit: "cover",
              filter: lightingMode.filter === "none" ? "none" : lightingMode.filter,
              transition: "filter 0.3s ease",
            }}
          />

          <div style={{
            position: "absolute", inset: "15%",
            border: "2px solid rgba(59,130,246,0.6)",
            borderRadius: "12px",
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.25)",
            pointerEvents: "none",
          }}>
            <span style={{
              position: "absolute", bottom: -28, left: "50%", transform: "translateX(-50%)",
              fontSize: "0.65rem", color: "rgba(255,255,255,0.7)", whiteSpace: "nowrap",
            }}>
              وجّه الكاميرا نحو الرف
            </span>
          </div>

          {countdown !== null && (
            <div style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(0,0,0,0.4)",
            }}>
              <div style={{
                fontSize: "5rem", fontWeight: 900, color: "#fff",
                textShadow: "0 0 30px rgba(59,130,246,0.8)",
                animation: "countdown-pop 0.9s ease-in-out",
              }}>
                {countdown}
              </div>
            </div>
          )}

          <div style={{
            position: "absolute", top: 12, right: 12,
            background: "rgba(10,14,26,0.8)",
            border: "1px solid rgba(99,157,255,0.2)",
            borderRadius: "8px", padding: "5px 10px",
            fontSize: "0.7rem", color: "#94a3b8",
            display: "flex", alignItems: "center", gap: "5px",
          }}>
            <span>{lightingMode.icon}</span>
            <span>{lightingMode.label}</span>
          </div>

          {autoMode && (
            <div style={{
              position: "absolute", top: 12, left: 12,
              background: "rgba(16,185,129,0.2)",
              border: "1px solid rgba(16,185,129,0.4)",
              borderRadius: "8px", padding: "5px 10px",
              fontSize: "0.7rem", color: "#34d399",
              display: "flex", alignItems: "center", gap: "5px",
            }}>
              <span style={{ animation: "pulse-rec 1s infinite" }}>●</span>
              <span>جرد تلقائي كل 3ث</span>
            </div>
          )}

          {snapPreview && (
            <div style={{
              position: "absolute", inset: 0,
              background: "rgba(0,0,0,0.85)",
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: "1rem",
              padding: "1rem",
            }}>
              <img src={snapPreview} alt="معاينة" style={{
                maxWidth: "80%", maxHeight: "60%",
                borderRadius: "12px", border: "2px solid rgba(59,130,246,0.4)",
                objectFit: "contain",
              }} />
              <p style={{ color: "#94a3b8", fontSize: "0.8rem" }}>هل الصورة واضحة؟</p>
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <button onClick={confirmFrame} style={{
                  background: "linear-gradient(135deg,#10b981,#059669)",
                  color: "#fff", border: "none", padding: "0.65rem 1.5rem",
                  borderRadius: "12px", fontSize: "0.9rem", fontWeight: 700,
                  cursor: "pointer", fontFamily: "inherit",
                }}>
                  ✅ تحليل هذه الصورة
                </button>
                <button onClick={retakeFrame} style={{
                  background: "rgba(30,40,65,0.8)",
                  color: "#94a3b8", border: "1px solid rgba(99,157,255,0.2)",
                  padding: "0.65rem 1.5rem", borderRadius: "12px",
                  fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit",
                }}>
                  🔄 إعادة التقاط
                </button>
              </div>
            </div>
          )}
        </div>

        <div style={{
          background: "rgba(10,14,26,0.95)",
          borderTop: "1px solid rgba(99,157,255,0.1)",
          padding: "0.6rem 0.75rem",
          flexShrink: 0,
        }}>
          <p style={{ fontSize: "0.62rem", color: "#475569", marginBottom: "0.4rem", textAlign: "center" }}>
            اختر وضع الإضاءة المناسب
          </p>
          <div style={{ display: "flex", gap: "0.4rem", overflowX: "auto", paddingBottom: "4px" }}>
            {LIGHTING_MODES.map((mode) => (
              <button
                key={mode.id}
                onClick={() => setLightingMode(mode)}
                title={mode.desc}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: "2px",
                  padding: "0.45rem 0.75rem", borderRadius: "10px", flexShrink: 0,
                  border: lightingMode.id === mode.id
                    ? "1.5px solid rgba(59,130,246,0.7)"
                    : "1px solid rgba(99,157,255,0.12)",
                  background: lightingMode.id === mode.id
                    ? "rgba(59,130,246,0.15)"
                    : "rgba(15,22,44,0.6)",
                  cursor: "pointer", transition: "all 0.15s",
                }}
              >
                <span style={{ fontSize: "1.1rem" }}>{mode.icon}</span>
                <span style={{
                  fontSize: "0.6rem", fontWeight: 600, whiteSpace: "nowrap",
                  color: lightingMode.id === mode.id ? "#60a5fa" : "#475569",
                }}>
                  {mode.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div style={{
          background: "rgba(10,14,26,0.98)",
          borderTop: "1px solid rgba(99,157,255,0.1)",
          padding: "0.75rem 1rem",
          display: "flex", gap: "0.6rem",
          flexShrink: 0,
        }}>
          <button
            onClick={handleSnap}
            disabled={capturing || !!snapPreview || autoMode}
            style={{
              flex: 2, padding: "0.85rem",
              background: capturing || snapPreview || autoMode
                ? "rgba(59,130,246,0.3)"
                : "linear-gradient(135deg,#3b82f6,#6366f1)",
              color: "#fff", border: "none", borderRadius: "14px",
              fontSize: "0.95rem", fontWeight: 700,
              cursor: capturing || snapPreview || autoMode ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem",
            }}
          >
            {capturing ? `📸 جاري الالتقاط...` : "📸 التقاط (3ث)"}
          </button>

          <button
            onClick={() => {
              const img = captureFrame();
              if (img) { setSnapPreview(img); }
            }}
            disabled={capturing || !!snapPreview || autoMode}
            style={{
              flex: 1, padding: "0.85rem",
              background: "rgba(16,185,129,0.1)",
              color: "#34d399",
              border: "1px solid rgba(16,185,129,0.3)",
              borderRadius: "14px", fontSize: "0.8rem", fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            ⚡ فوري
          </button>

          <button
            onClick={toggleAutoMode}
            disabled={!!snapPreview}
            style={{
              flex: 1, padding: "0.85rem",
              background: autoMode ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.1)",
              color: autoMode ? "#f87171" : "#fbbf24",
              border: autoMode
                ? "1px solid rgba(239,68,68,0.35)"
                : "1px solid rgba(245,158,11,0.3)",
              borderRadius: "14px", fontSize: "0.75rem", fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {autoMode ? "⏹ إيقاف" : "🔄 تلقائي"}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes pulse-rec {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes countdown-pop {
          0% { transform: scale(0.5); opacity: 0; }
          50% { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

// ============================================================
// نظام العملات
// ============================================================
interface Currency {
  code: string;
  symbol: string;
  name: string;
  flag: string;
}

const CURRENCIES: Currency[] = [
  { code: "EGP", symbol: "ج.م", name: "جنيه مصري",       flag: "🇪🇬" },
  { code: "SAR", symbol: "ر.س", name: "ريال سعودي",      flag: "🇸🇦" },
  { code: "AED", symbol: "د.إ", name: "درهم إماراتي",    flag: "🇦🇪" },
  { code: "KWD", symbol: "د.ك", name: "دينار كويتي",     flag: "🇰🇼" },
  { code: "QAR", symbol: "ر.ق", name: "ريال قطري",       flag: "🇶🇦" },
  { code: "BHD", symbol: "د.ب", name: "دينار بحريني",    flag: "🇧🇭" },
  { code: "OMR", symbol: "ر.ع", name: "ريال عماني",      flag: "🇴🇲" },
  { code: "JOD", symbol: "د.أ", name: "دينار أردني",     flag: "🇯🇴" },
  { code: "LBP", symbol: "ل.ل", name: "ليرة لبنانية",   flag: "🇱🇧" },
  { code: "MAD", symbol: "د.م", name: "درهم مغربي",      flag: "🇲🇦" },
  { code: "TND", symbol: "د.ت", name: "دينار تونسي",     flag: "🇹🇳" },
  { code: "DZD", symbol: "د.ج", name: "دينار جزائري",    flag: "🇩🇿" },
  { code: "IQD", symbol: "د.ع", name: "دينار عراقي",     flag: "🇮🇶" },
  { code: "SDG", symbol: "ج.س", name: "جنيه سوداني",     flag: "🇸🇩" },
  { code: "LYD", symbol: "د.ل", name: "دينار ليبي",      flag: "🇱🇾" },
  { code: "USD", symbol: "$",   name: "دولار أمريكي",    flag: "🇺🇸" },
  { code: "EUR", symbol: "€",   name: "يورو",             flag: "🇪🇺" },
  { code: "GBP", symbol: "£",   name: "جنيه إسترليني",   flag: "🇬🇧" },
  { code: "TRY", symbol: "₺",   name: "ليرة تركية",      flag: "🇹🇷" },
  { code: "PKR", symbol: "₨",   name: "روبية باكستانية", flag: "🇵🇰" },
];

// ============================================================
// نظام الفواتير
// ============================================================
interface InvoiceInfo {
  clientName: string;
  clientPhone: string;
  clientAddress: string;
  companyName: string;
  companyLogo: string;
  invoiceNumber: string;
  invoiceDate: string;
  notes: string;
  taxPercent: number;
  discountPercent: number;
  showBarcode: boolean;
}

function generateInvoiceHTML(
  info: InvoiceInfo,
  products: ProductItem[],
  currency: Currency
): string {
  const invDate = info.invoiceDate || new Date().toLocaleDateString("ar-EG");
  const invNum  = info.invoiceNumber || `INV-${Date.now().toString().slice(-6)}`;

  const subtotal = products.reduce((sum, p) => {
    const price = parseFloat(String(p.unit_price).replace(/[^\d.]/g, "")) || 0;
    const qty   = Number(p.quantity) || 0;
    return sum + price * qty;
  }, 0);

  const discountAmt = subtotal * (info.discountPercent / 100);
  const taxAmt      = (subtotal - discountAmt) * (info.taxPercent / 100);
  const total       = subtotal - discountAmt + taxAmt;

  const fmt = (n: number) =>
    n.toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const rows = products.map((p, i) => {
    const price = parseFloat(String(p.unit_price).replace(/[^\d.]/g, "")) || 0;
    const qty   = Number(p.quantity) || 0;
    const totalP = price * qty;
    return `
      <tr style="border-bottom:1px solid #e2e8f0;${i % 2 === 1 ? "background:#f8fafc;" : ""}">
        <td style="padding:10px 12px;font-size:13px;color:#1e293b">${i + 1}</td>
        <td style="padding:10px 12px;font-size:13px;color:#1e293b;font-weight:600">${p.product_name || "—"}</td>
        <td style="padding:10px 12px;font-size:12px;color:#64748b">${p.brand || "—"}</td>
        <td style="padding:10px 12px;font-size:12px;color:#64748b">${p.category || "—"}</td>
        <td style="padding:10px 12px;font-size:13px;color:#1e293b;text-align:center">${qty}</td>
        <td style="padding:10px 12px;font-size:13px;color:#1e293b;text-align:left">${price > 0 ? fmt(price) : "—"} ${currency.symbol}</td>
        <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#0f172a;text-align:left">${totalP > 0 ? fmt(totalP) : "—"} ${currency.symbol}</td>
        ${info.showBarcode ? `<td style="padding:10px 12px;font-size:11px;color:#94a3b8;font-family:monospace">${p.barcode || "—"}</td>` : ""}
      </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>فاتورة ${invNum}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Cairo',Tahoma,sans-serif;background:#f1f5f9;color:#1e293b;direction:rtl}
  .page{max-width:900px;margin:2rem auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 40px rgba(0,0,0,0.1)}
  .header{background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);padding:2.5rem 2.5rem 2rem;display:flex;justify-content:space-between;align-items:flex-start}
  .company-info h1{font-size:1.6rem;font-weight:900;color:#fff;margin-bottom:4px}
  .company-info p{font-size:0.8rem;color:#94a3b8;line-height:1.6}
  .invoice-badge{background:rgba(59,130,246,0.2);border:1px solid rgba(59,130,246,0.4);border-radius:12px;padding:1rem 1.5rem;text-align:left}
  .invoice-badge .label{font-size:0.65rem;color:#93c5fd;letter-spacing:.1em;font-weight:600;text-transform:uppercase}
  .invoice-badge .num{font-size:1.2rem;font-weight:900;color:#fff;margin:2px 0}
  .invoice-badge .date{font-size:0.75rem;color:#94a3b8}
  .body{padding:2rem 2.5rem}
  .client-section{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:2rem;padding-bottom:1.5rem;border-bottom:2px solid #f1f5f9}
  .info-block h3{font-size:0.65rem;color:#94a3b8;letter-spacing:.1em;font-weight:700;text-transform:uppercase;margin-bottom:8px}
  .info-block p{font-size:0.88rem;color:#1e293b;line-height:1.6}
  .info-block .name{font-size:1.1rem;font-weight:700;color:#0f172a}
  table{width:100%;border-collapse:collapse;margin-bottom:1.5rem}
  thead{background:#0f172a}
  thead th{padding:10px 12px;font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:.08em;text-align:right}
  thead th:last-child,thead th:nth-child(5),thead th:nth-child(6){text-align:left}
  .totals{display:flex;justify-content:flex-end}
  .totals-box{width:300px;background:#f8fafc;border-radius:12px;padding:1.25rem 1.5rem}
  .total-row{display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#64748b}
  .total-row.main{border-top:2px solid #e2e8f0;margin-top:8px;padding-top:12px;font-size:1rem;font-weight:900;color:#0f172a}
  .footer{background:#f8fafc;border-top:1px solid #e2e8f0;padding:1.25rem 2.5rem;display:flex;justify-content:space-between;align-items:center}
  .footer p{font-size:0.72rem;color:#94a3b8}
  .stamp{border:2px dashed #e2e8f0;border-radius:8px;padding:6px 16px;font-size:0.7rem;color:#cbd5e1}
  .notes-section{background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-bottom:1.5rem}
  .notes-section p{font-size:12px;color:#92400e;line-height:1.6}
  @media print{
    body{background:#fff}
    .page{box-shadow:none;border-radius:0;margin:0}
    .no-print{display:none!important}
  }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="company-info">
      ${info.companyLogo ? `<img src="${info.companyLogo}" style="height:50px;margin-bottom:12px;border-radius:6px" alt="logo"/>` : ""}
      <h1>${info.companyName || "الشركة"}</h1>
      <p>نظام الجرد الذكي · AI Inventory</p>
    </div>
    <div class="invoice-badge">
      <div class="label">فاتورة رقم</div>
      <div class="num">${invNum}</div>
      <div class="date">📅 ${invDate}</div>
    </div>
  </div>

  <div class="body">
    <div class="client-section">
      <div class="info-block">
        <h3>فاتورة إلى</h3>
        <p class="name">${info.clientName || "العميل"}</p>
        ${info.clientPhone ? `<p>📞 ${info.clientPhone}</p>` : ""}
        ${info.clientAddress ? `<p>📍 ${info.clientAddress}</p>` : ""}
      </div>
      <div class="info-block" style="text-align:left">
        <h3>ملخص</h3>
        <p>العدد الإجمالي: <strong>${products.length} منتج</strong></p>
        <p>العملة: <strong>${currency.flag} ${currency.name} (${currency.symbol})</strong></p>
        ${info.taxPercent > 0 ? `<p>الضريبة: <strong>${info.taxPercent}%</strong></p>` : ""}
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>المنتج</th>
          <th>الماركة</th>
          <th>التصنيف</th>
          <th style="text-align:center">الكمية</th>
          <th style="text-align:left">سعر الوحدة</th>
          <th style="text-align:left">الإجمالي</th>
          ${info.showBarcode ? "<th>الباركود</th>" : ""}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    ${info.notes ? `
    <div class="notes-section">
      <p><strong>ملاحظات:</strong> ${info.notes}</p>
    </div>` : ""}

    <div class="totals">
      <div class="totals-box">
        <div class="total-row"><span>المجموع الفرعي</span><span>${fmt(subtotal)} ${currency.symbol}</span></div>
        ${info.discountPercent > 0 ? `<div class="total-row"><span>خصم (${info.discountPercent}%)</span><span style="color:#10b981">- ${fmt(discountAmt)} ${currency.symbol}</span></div>` : ""}
        ${info.taxPercent > 0 ? `<div class="total-row"><span>ضريبة (${info.taxPercent}%)</span><span>${fmt(taxAmt)} ${currency.symbol}</span></div>` : ""}
        <div class="total-row main"><span>الإجمالي النهائي</span><span style="color:#2563eb">${fmt(total)} ${currency.symbol}</span></div>
      </div>
    </div>
  </div>

  <div class="footer">
    <p>تم إنشاء هذه الفاتورة بواسطة نظام الجرد الذكي · ${new Date().toLocaleString("ar-EG")}</p>
    <div class="stamp">ختم وتوقيع</div>
  </div>
</div>

<div class="no-print" style="text-align:center;padding:1.5rem">
  <button onclick="window.print()" style="background:#2563eb;color:#fff;border:none;padding:12px 32px;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">
    🖨️ طباعة / حفظ PDF
  </button>
</div>
</body>
</html>`;
}

// ============================================================
// Invoice Modal Component
// ============================================================
function InvoiceModal({
  products,
  currency,
  onClose,
}: {
  products: ProductItem[];
  currency: Currency;
  onClose: () => void;
}) {
  const today = new Date().toISOString().split("T")[0];
  const [info, setInfo] = useState<InvoiceInfo>({
    clientName: "",
    clientPhone: "",
    clientAddress: "",
    companyName: "",
    companyLogo: "",
    invoiceNumber: `INV-${Date.now().toString().slice(-6)}`,
    invoiceDate: today,
    notes: "",
    taxPercent: 0,
    discountPercent: 0,
    showBarcode: true,
  });

  const set = (field: keyof InvoiceInfo, value: string | number | boolean) =>
    setInfo((p) => ({ ...p, [field]: value }));

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => set("companyLogo", ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleGenerate = () => {
    const html = generateInvoiceHTML(info, products, currency);
    const win = window.open("", "_blank");
    if (win) { win.document.write(html); win.document.close(); }
  };

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    background: "rgba(15,22,44,0.8)",
    border: "1px solid rgba(99,157,255,0.15)",
    borderRadius: "8px",
    padding: "0.55rem 0.75rem",
    color: "#e2e8f0",
    fontSize: "0.83rem",
    fontFamily: "inherit",
    outline: "none",
    direction: "rtl",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "0.68rem",
    color: "#64748b",
    fontWeight: 600,
    display: "block",
    marginBottom: "4px",
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 300, padding: "1rem",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "#0f1628",
        border: "1px solid rgba(99,157,255,0.2)",
        borderRadius: "20px",
        width: "100%", maxWidth: "520px",
        maxHeight: "90vh", overflowY: "auto",
        padding: "1.5rem",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem" }}>
          <div>
            <div style={{ fontSize: "1rem", fontWeight: 700, color: "#f1f5f9" }}>🧾 إنشاء فاتورة احترافية</div>
            <div style={{ fontSize: "0.72rem", color: "#475569", marginTop: "2px" }}>{products.length} منتج · {currency.flag} {currency.name}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#475569", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#3b82f6", marginBottom: "8px", letterSpacing: ".08em" }}>بيانات المورد / الشركة</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem", marginBottom: "1rem" }}>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={labelStyle}>اسم الشركة / المتجر</label>
            <input style={fieldStyle} value={info.companyName} onChange={(e) => set("companyName", e.target.value)} placeholder="متجر النور للبقالة" />
          </div>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={labelStyle}>شعار الشركة (اختياري)</label>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input type="file" accept="image/*" onChange={handleLogoUpload} style={{ display: "none" }} id="logo-upload" />
              <label htmlFor="logo-upload" style={{
                ...fieldStyle, cursor: "pointer", textAlign: "center",
                color: info.companyLogo ? "#10b981" : "#475569", padding: "0.4rem",
              }}>
                {info.companyLogo ? "✅ تم رفع الشعار" : "📁 رفع شعار"}
              </label>
              {info.companyLogo && (
                <button onClick={() => set("companyLogo", "")} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: "0.8rem" }}>حذف</button>
              )}
            </div>
          </div>
        </div>

        <div style={{ height: "1px", background: "rgba(99,157,255,0.08)", margin: "1rem 0" }} />

        <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#10b981", marginBottom: "8px", letterSpacing: ".08em" }}>بيانات العميل</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem", marginBottom: "1rem" }}>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={labelStyle}>اسم العميل *</label>
            <input style={fieldStyle} value={info.clientName} onChange={(e) => set("clientName", e.target.value)} placeholder="أحمد محمد علي" />
          </div>
          <div>
            <label style={labelStyle}>رقم الهاتف</label>
            <input style={{ ...fieldStyle, direction: "ltr" }} value={info.clientPhone} onChange={(e) => set("clientPhone", e.target.value)} placeholder="+20 100 000 0000" />
          </div>
          <div>
            <label style={labelStyle}>العنوان</label>
            <input style={fieldStyle} value={info.clientAddress} onChange={(e) => set("clientAddress", e.target.value)} placeholder="القاهرة، مصر" />
          </div>
        </div>

        <div style={{ height: "1px", background: "rgba(99,157,255,0.08)", margin: "1rem 0" }} />

        <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#f59e0b", marginBottom: "8px", letterSpacing: ".08em" }}>بيانات الفاتورة</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem", marginBottom: "1rem" }}>
          <div>
            <label style={labelStyle}>رقم الفاتورة</label>
            <input style={{ ...fieldStyle, direction: "ltr" }} value={info.invoiceNumber} onChange={(e) => set("invoiceNumber", e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>التاريخ</label>
            <input type="date" style={{ ...fieldStyle, direction: "ltr" }} value={info.invoiceDate} onChange={(e) => set("invoiceDate", e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>نسبة الضريبة %</label>
            <input type="number" min="0" max="100" style={{ ...fieldStyle, direction: "ltr" }} value={info.taxPercent} onChange={(e) => set("taxPercent", Number(e.target.value))} placeholder="0" />
          </div>
          <div>
            <label style={labelStyle}>نسبة الخصم %</label>
            <input type="number" min="0" max="100" style={{ ...fieldStyle, direction: "ltr" }} value={info.discountPercent} onChange={(e) => set("discountPercent", Number(e.target.value))} placeholder="0" />
          </div>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={labelStyle}>ملاحظات (اختياري)</label>
            <textarea
              rows={2}
              style={{ ...fieldStyle, resize: "none" }}
              value={info.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="شروط الدفع، تعليمات التسليم..."
            />
          </div>
          <div style={{ gridColumn: "1/-1", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              id="show-barcode"
              checked={info.showBarcode}
              onChange={(e) => set("showBarcode", e.target.checked)}
              style={{ width: "16px", height: "16px", accentColor: "#3b82f6" }}
            />
            <label htmlFor="show-barcode" style={{ ...labelStyle, marginBottom: 0, cursor: "pointer" }}>
              إظهار عمود الباركود في الفاتورة
            </label>
          </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={!info.clientName.trim()}
          style={{
            width: "100%", padding: "0.9rem",
            background: !info.clientName.trim()
              ? "rgba(59,130,246,0.3)"
              : "linear-gradient(135deg,#3b82f6,#6366f1)",
            color: "#fff", border: "none", borderRadius: "14px",
            fontSize: "0.95rem", fontWeight: 700,
            cursor: !info.clientName.trim() ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            boxShadow: "0 4px 20px rgba(59,130,246,0.3)",
          }}
        >
          🧾 إنشاء الفاتورة وفتحها للطباعة
        </button>
        {!info.clientName.trim() && (
          <p style={{ textAlign: "center", fontSize: "0.7rem", color: "#f59e0b", marginTop: "6px" }}>
            * اسم العميل مطلوب لإنشاء الفاتورة
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Main Component - هذه هي الصفحة الرئيسية
// ============================================================
export default function InventoryScannerPage() {
  const [isMounted, setIsMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [previewImg, setPreviewImg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [currency, setCurrency] = useState<Currency>(CURRENCIES[0]);
  const [showInvoice, setShowInvoice] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const saved = localStorage.getItem("inv_spreadsheet_id");
    if (saved) setSpreadsheetId(saved);
    const savedCurrency = localStorage.getItem("inv_currency");
    if (savedCurrency) {
      const found = CURRENCIES.find((c) => c.code === savedCurrency);
      if (found) setCurrency(found);
    }
  }, []);

  const handleCapture = useCallback(async (imageData: string) => {
    setPreviewImg(imageData);
    setLoading(true);
    setError(null);
    setResult(null);
    setExportSuccess(false);

    try {
      const response = await fetch("https://stackblitz-starters-kmscm2a9.vercel.app/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageData }),
      });

      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        const rawText = await res.text();
        console.error("Non-JSON response from server:", rawText.substring(0, 300));
        throw new Error(
          `الخادم أرجع استجابة غير متوقعة (${res.status} ${res.statusText}). تحقق من السيرفر.`
        );
      }

      let data: AnalysisResult;
      try {
        data = await res.json();
      } catch {
        throw new Error("فشل في قراءة رد الخادم - الرد ليس JSON صالحاً");
      }

      if (!res.ok || !data.success) {
        const serverError = (data as { error?: string; detail?: string }).error
          ?? (data as { detail?: string }).detail
          ?? `خطأ ${res.status}: فشل التحليل`;
        throw new Error(serverError);
      }

      if (!Array.isArray(data.products)) {
        throw new Error("رد الخادم لا يحتوي على قائمة منتجات صحيحة");
      }

      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطأ غير متوقع في الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleFieldChange = useCallback((idx: number, field: keyof ProductItem, value: string) => {
    setResult((prev) => {
      if (!prev) return prev;
      const updated = [...prev.products];
      updated[idx] = { ...updated[idx], [field]: value };
      return { ...prev, products: updated, total_products_detected: updated.length };
    });
  }, []);

  const handleDelete = useCallback((idx: number) => {
    setResult((prev) => {
      if (!prev) return prev;
      const updated = prev.products.filter((_, i) => i !== idx);
      return { ...prev, products: updated, total_products_detected: updated.length };
    });
  }, []);

  const handleExport = async () => {
    if (!result || result.products.length === 0) return;

    if (!spreadsheetId.trim()) {
      setShowSettings(true);
      setError("الرجاء إدخال رابط أو ID ملف Google Sheets أولاً من الإعدادات");
      return;
    }

    setExporting(true);
    setError(null);

    try {
      const res = await fetch("/api/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spreadsheetId: spreadsheetId.trim(),
          products: result.products,
        }),
      });

      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        const rawText = await res.text();
        console.error("Non-JSON from /api/sheets:", rawText.substring(0, 300));
        throw new Error(`خطأ من الخادم (${res.status}). تحقق من إعداد Google Sheets API.`);
      }

      let data: { success: boolean; error?: string; detail?: string };
      try {
        data = await res.json();
      } catch {
        throw new Error("فشل في قراءة رد خادم الجداول");
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error ?? data.detail ?? `فشل التصدير (${res.status})`);
      }

      setExportSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطأ غير متوقع في الاتصال بخدمة الجداول");
    } finally {
      setExporting(false);
    }
  };

  const handleSaveSettings = () => {
    const id = spreadsheetId.trim();
    if (!id) return;
    localStorage.setItem("inv_spreadsheet_id", id);
    localStorage.setItem("inv_currency", currency.code);
    setShowSettings(false);
    setError(null);
  };

  const handleAddProduct = useCallback(() => {
    const newItem: ProductItem = {
      product_name: "منتج جديد",
      brand: "",
      category: "",
      unit_price: "",
      quantity: 1,
      barcode: "",
      confidence: "high",
      notes: "تمت الإضافة يدوياً",
    };
    setResult((prev) => {
      const existing = prev?.products ?? [];
      return {
        success: true,
        products: [newItem, ...existing],
        total_products_detected: existing.length + 1,
        analysis_quality: prev?.analysis_quality ?? "good",
        warnings: prev?.warnings ?? [],
      };
    });
  }, []);

  const handleReset = () => {
    const hasUnsaved = result && result.products.length > 0 && !exportSuccess;
    if (hasUnsaved) {
      const confirmed = window.confirm(
        `⚠️ تنبيه: يوجد ${result.products.length} منتج لم يتم ترحيله بعد.\n\nهل أنت متأكد من المسح وفقدان البيانات؟`
      );
      if (!confirmed) return;
    }
    setResult(null);
    setPreviewImg(null);
    setError(null);
    setExportSuccess(false);
  };

  const highConfidence = result?.products.filter((p) => p.confidence === "high").length ?? 0;

  if (!isMounted) return null;

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', 'Cairo', Tahoma, sans-serif; direction: rtl; background: #0a0e1a; color: #e2e8f0; min-height: 100vh; }
        .scanner-root { min-height: 100vh; background: linear-gradient(135deg, #0a0e1a 0%, #0f1628 50%, #0a1224 100%); padding: 0 0 4rem; }
        .header { background: linear-gradient(180deg, rgba(15,22,44,0.98) 0%, rgba(10,14,26,0.95) 100%); border-bottom: 1px solid rgba(99,157,255,0.15); padding: 1.25rem 1.5rem; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; backdrop-filter: blur(12px); }
        .header-brand { display: flex; align-items: center; gap: 0.75rem; }
        .header-logo { width: 38px; height: 38px; background: linear-gradient(135deg, #3b82f6, #6366f1); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; }
        .header-title { font-size: 1.1rem; font-weight: 700; color: #f1f5f9; letter-spacing: -0.02em; }
        .header-sub { font-size: 0.7rem; color: #64748b; margin-top: 1px; }
        .header-badge { background: rgba(59,130,246,0.12); border: 1px solid rgba(59,130,246,0.25); color: #93c5fd; font-size: 0.65rem; font-weight: 600; padding: 3px 10px; border-radius: 20px; letter-spacing: 0.05em; }
        .main { max-width: 700px; margin: 0 auto; padding: 1.5rem 1rem; }
        .capture-zone { border: 2px dashed rgba(99,157,255,0.25); border-radius: 20px; padding: 2.5rem 1.5rem; text-align: center; background: rgba(15,22,44,0.5); transition: border-color 0.2s; }
        .capture-zone:hover { border-color: rgba(99,157,255,0.45); }
        .capture-icon { font-size: 3rem; margin-bottom: 0.75rem; filter: grayscale(0.2); }
        .capture-title { font-size: 1rem; font-weight: 600; color: #cbd5e1; margin-bottom: 0.3rem; }
        .capture-sub { font-size: 0.75rem; color: #475569; margin-bottom: 1.5rem; }
        .capture-buttons { display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap; }
        .btn { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.65rem 1.4rem; border-radius: 12px; font-size: 0.9rem; font-weight: 600; border: none; cursor: pointer; transition: all 0.18s; font-family: inherit; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-primary { background: linear-gradient(135deg, #3b82f6, #6366f1); color: #fff; box-shadow: 0 4px 15px rgba(59,130,246,0.3); }
        .btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(59,130,246,0.4); }
        .btn-secondary { background: rgba(30,40,65,0.8); color: #94a3b8; border: 1px solid rgba(99,157,255,0.2); }
        .btn-secondary:hover:not(:disabled) { background: rgba(40,55,85,0.9); color: #cbd5e1; }
        .btn-export { width: 100%; padding: 1rem; background: linear-gradient(135deg, #10b981, #059669); color: #fff; font-size: 1rem; border-radius: 16px; justify-content: center; box-shadow: 0 4px 20px rgba(16,185,129,0.3); }
        .btn-export:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 25px rgba(16,185,129,0.4); }
        .btn-reset { width: 100%; padding: 0.75rem; background: transparent; color: #64748b; border: 1px solid rgba(100,116,139,0.2); border-radius: 12px; justify-content: center; font-size: 0.85rem; margin-top: 0.5rem; }
        .btn-reset:hover { color: #94a3b8; border-color: rgba(100,116,139,0.4); }
        .image-preview { border-radius: 16px; overflow: hidden; border: 1px solid rgba(99,157,255,0.15); margin-bottom: 1.25rem; position: relative; }
        .image-preview img { width: 100%; max-height: 220px; object-fit: cover; display: block; }
        .image-preview-overlay { position: absolute; bottom: 0; left: 0; right: 0; padding: 0.75rem 1rem; background: linear-gradient(transparent, rgba(0,0,0,0.7)); font-size: 0.75rem; color: #94a3b8; }
        .loading-wrapper { text-align: center; padding: 2.5rem 1rem; }
        .loading-spinner { width: 52px; height: 52px; border: 3px solid rgba(59,130,246,0.15); border-top-color: #3b82f6; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 1.25rem; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .loading-dots { display: flex; justify-content: center; gap: 5px; margin-top: 0.75rem; }
        .dot { width: 6px; height: 6px; background: #3b82f6; border-radius: 50%; animation: bounce 1.2s infinite; }
        .dot:nth-child(2) { animation-delay: 0.2s; }
        .dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes bounce { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }
        .error-box { background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.25); border-radius: 14px; padding: 1rem 1.25rem; display: flex; align-items: flex-start; gap: 0.75rem; margin-bottom: 1rem; }
        .error-icon { font-size: 1.2rem; flex-shrink: 0; }
        .error-text { color: #fca5a5; font-size: 0.88rem; line-height: 1.5; }
        .stats-bar { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-bottom: 1.25rem; }
        .stat-card { background: rgba(15,22,44,0.7); border: 1px solid rgba(99,157,255,0.12); border-radius: 14px; padding: 0.9rem 0.75rem; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 0.2rem; }
        .stat-icon { font-size: 1.3rem; }
        .stat-value { font-size: 1.4rem; font-weight: 700; color: #f1f5f9; line-height: 1; }
        .stat-label { font-size: 0.65rem; color: #64748b; }
        .quality-bar-wrapper { background: rgba(15,22,44,0.5); border: 1px solid rgba(99,157,255,0.1); border-radius: 12px; padding: 0.75rem 1rem; margin-bottom: 1.25rem; display: flex; align-items: center; gap: 1rem; }
        .quality-label { font-size: 0.78rem; color: #64748b; white-space: nowrap; flex-shrink: 0; }
        .quality-track { flex: 1; height: 6px; background: rgba(255,255,255,0.07); border-radius: 3px; overflow: hidden; }
        .quality-fill { height: 100%; border-radius: 3px; transition: width 0.6s ease; }
        .warnings-box { background: rgba(245,158,11,0.07); border: 1px solid rgba(245,158,11,0.2); border-radius: 12px; padding: 0.75rem 1rem; margin-bottom: 1rem; }
        .warnings-title { font-size: 0.75rem; font-weight: 600; color: #fbbf24; margin-bottom: 0.3rem; }
        .warnings-list { list-style: none; padding: 0; }
        .warnings-list li { font-size: 0.75rem; color: #d97706; padding: 2px 0; }
        .section-title { font-size: 0.8rem; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.5rem; }
        .section-title > span { display: flex; align-items: center; gap: 0.5rem; flex: 1; }
        .section-title > span::after { content: ''; flex: 1; height: 1px; background: rgba(99,157,255,0.1); min-width: 1rem; }
        .products-list { display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1.5rem; }
        .product-card { background: rgba(15,22,44,0.6); border: 1px solid rgba(99,157,255,0.12); border-radius: 16px; overflow: hidden; transition: border-color 0.2s; }
        .product-card:hover { border-color: rgba(99,157,255,0.25); }
        .product-card-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 0.9rem 1rem 0.6rem; cursor: pointer; gap: 0.75rem; }
        .product-card-left { display: flex; align-items: flex-start; gap: 0.75rem; flex: 1; min-width: 0; }
        .product-index { width: 28px; height: 28px; background: rgba(59,130,246,0.12); color: #60a5fa; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 700; flex-shrink: 0; }
        .product-name { font-size: 0.92rem; font-weight: 600; color: #e2e8f0; line-height: 1.3; word-break: break-word; }
        .product-meta { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.35rem; }
        .chip { font-size: 0.65rem; padding: 2px 8px; border-radius: 6px; font-weight: 500; }
        .chip-brand { background: rgba(99,102,241,0.15); color: #a5b4fc; border: 1px solid rgba(99,102,241,0.2); }
        .chip-cat { background: rgba(20,184,166,0.1); color: #5eead4; border: 1px solid rgba(20,184,166,0.15); }
        .product-card-right { display: flex; flex-direction: column; align-items: flex-end; gap: 0.4rem; flex-shrink: 0; }
        .expand-icon { font-size: 0.6rem; color: #475569; }
        .badge { font-size: 0.62rem; padding: 3px 8px; border-radius: 6px; font-weight: 600; white-space: nowrap; }
        .badge-success { background: rgba(16,185,129,0.12); color: #34d399; border: 1px solid rgba(16,185,129,0.2); }
        .badge-warning { background: rgba(245,158,11,0.1); color: #fbbf24; border: 1px solid rgba(245,158,11,0.2); }
        .badge-danger { background: rgba(239,68,68,0.1); color: #f87171; border: 1px solid rgba(239,68,68,0.2); }
        .product-quick-stats { display: flex; gap: 1rem; border-top: 1px solid rgba(99,157,255,0.07); padding: 0.55rem 1rem; flex-wrap: wrap; }
        .quick-stat { display: flex; flex-direction: column; gap: 1px; }
        .qs-label { font-size: 0.62rem; color: #475569; }
        .qs-value { font-size: 0.82rem; font-weight: 600; color: #94a3b8; }
        .qs-value.barcode { font-family: monospace; font-size: 0.7rem; letter-spacing: 0.05em; }
        .product-edit-section { padding: 0.75rem 1rem 1rem; border-top: 1px solid rgba(99,157,255,0.1); background: rgba(10,14,26,0.4); }
        .edit-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; margin-bottom: 0.75rem; }
        .edit-field { display: flex; flex-direction: column; gap: 4px; }
        .edit-label { font-size: 0.68rem; color: #475569; font-weight: 500; }
        .edit-input { background: rgba(15,22,44,0.8); border: 1px solid rgba(99,157,255,0.15); border-radius: 8px; padding: 0.45rem 0.6rem; color: #e2e8f0; font-size: 0.82rem; font-family: inherit; text-align: right; outline: none; transition: border-color 0.15s; }
        .edit-input:focus { border-color: rgba(59,130,246,0.45); }
        .notes-row { display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.5rem 0.75rem; background: rgba(59,130,246,0.06); border-radius: 8px; margin-bottom: 0.6rem; }
        .notes-icon { color: #60a5fa; font-size: 0.9rem; flex-shrink: 0; }
        .notes-text { font-size: 0.75rem; color: #64748b; line-height: 1.5; }
        .delete-btn { background: transparent; border: 1px solid rgba(239,68,68,0.2); color: #f87171; padding: 0.4rem 0.9rem; border-radius: 8px; font-size: 0.75rem; cursor: pointer; font-family: inherit; transition: all 0.15s; }
        .delete-btn:hover { background: rgba(239,68,68,0.08); border-color: rgba(239,68,68,0.4); }
        .export-section { padding-top: 0.5rem; }
        .export-success { background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.2); border-radius: 14px; padding: 1rem 1.25rem; text-align: center; margin-bottom: 1rem; }
        .export-success-icon { font-size: 2rem; margin-bottom: 0.5rem; }
        .export-success-text { font-size: 0.9rem; font-weight: 600; color: #34d399; }
        .export-success-sub { font-size: 0.75rem; color: #475569; margin-top: 0.25rem; }
        .divider { height: 1px; background: rgba(99,157,255,0.08); margin: 1.25rem 0; }
        .settings-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.75); display: flex; align-items: center; justify-content: center; z-index: 200; padding: 1rem; }
        .settings-modal { background: #0f1628; border: 1px solid rgba(99,157,255,0.2); border-radius: 20px; padding: 1.5rem; width: 100%; max-width: 420px; }
        .settings-title { font-size: 1rem; font-weight: 700; color: #f1f5f9; margin-bottom: 0.35rem; }
        .settings-sub { font-size: 0.75rem; color: #475569; margin-bottom: 1.25rem; line-height: 1.5; }
        .settings-label { font-size: 0.75rem; font-weight: 600; color: #64748b; display: block; margin-bottom: 0.4rem; }
        .settings-input { width: 100%; background: rgba(15,22,44,0.8); border: 1px solid rgba(99,157,255,0.2); border-radius: 10px; padding: 0.6rem 0.85rem; color: #e2e8f0; font-size: 0.82rem; font-family: monospace; text-align: left; direction: ltr; outline: none; margin-bottom: 1rem; }
        .settings-input:focus { border-color: rgba(59,130,246,0.5); }
        .settings-hint { font-size: 0.68rem; color: #334155; margin-bottom: 1.25rem; line-height: 1.5; background: rgba(59,130,246,0.05); border: 1px solid rgba(59,130,246,0.1); border-radius: 8px; padding: 0.5rem 0.75rem; }
        .settings-actions { display: flex; gap: 0.6rem; }
        .btn-settings-icon { background: rgba(30,40,65,0.8); border: 1px solid rgba(99,157,255,0.15); color: #64748b; width: 36px; height: 36px; border-radius: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 1rem; transition: all 0.15s; }
        .btn-settings-icon:hover { background: rgba(40,55,85,0.9); color: #94a3b8; border-color: rgba(99,157,255,0.3); }
        .has-id-dot { width: 6px; height: 6px; background: #10b981; border-radius: 50%; position: absolute; top: 4px; left: 4px; }
        .settings-btn-wrap { position: relative; display: inline-flex; }
        .hidden { display: none; }
        @media (max-width: 420px) { .stats-bar { grid-template-columns: 1fr 1fr; } .edit-grid { grid-template-columns: 1fr; } }
      `}</style>

      {showSettings && (
        <div className="settings-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}>
          <div className="settings-modal">
            <div className="settings-title">⚙️ الإعدادات</div>
            <div className="settings-sub">اضبط عملة الأسعار ورابط Google Sheets الخاص بك</div>

            <label className="settings-label">العملة</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem", marginBottom: "1rem", maxHeight: "180px", overflowY: "auto", padding: "2px" }}>
              {CURRENCIES.map((c) => (
                <button
                  key={c.code}
                  onClick={() => setCurrency(c)}
                  style={{
                    display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.45rem 0.7rem",
                    borderRadius: "8px", border: currency.code === c.code ? "1.5px solid rgba(59,130,246,0.6)" : "1px solid rgba(99,157,255,0.12)",
                    background: currency.code === c.code ? "rgba(59,130,246,0.12)" : "rgba(15,22,44,0.6)",
                    color: currency.code === c.code ? "#60a5fa" : "#64748b", cursor: "pointer",
                    fontSize: "0.75rem", fontFamily: "inherit", textAlign: "right", transition: "all 0.15s",
                  }}
                >
                  <span style={{ fontSize: "1rem", flexShrink: 0 }}>{c.flag}</span>
                  <span style={{ fontWeight: currency.code === c.code ? 700 : 400 }}>{c.symbol}</span>
                  <span style={{ color: "#475569", fontSize: "0.68rem", flex: 1 }}>{c.name}</span>
                </button>
              ))}
            </div>

            <div style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.1)", borderRadius: "8px", padding: "0.5rem 0.75rem", marginBottom: "1.25rem", fontSize: "0.72rem", color: "#475569", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span>{currency.flag}</span>
              <span>العملة المختارة: <strong style={{ color: "#60a5fa" }}>{currency.name} ({currency.symbol})</strong></span>
            </div>

            <label className="settings-label">Spreadsheet ID</label>
            <input
              className="settings-input"
              placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
              value={spreadsheetId}
              onChange={(e) => setSpreadsheetId(e.target.value)}
              dir="ltr"
            />

            <div className="settings-hint">
              📌 مثال على الرابط:<br />
              <span style={{ color: "#475569" }}>docs.google.com/spreadsheets/d/</span>
              <span style={{ color: "#60a5fa", fontFamily: "monospace" }}>1BxiMVs0XRA...</span>
              <span style={{ color: "#475569" }}>/edit</span>
            </div>

            <div className="settings-actions">
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSaveSettings} disabled={!spreadsheetId.trim()}>
                💾 حفظ الإعدادات
              </button>
              <button className="btn btn-secondary" onClick={() => setShowSettings(false)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {showInvoice && result && (
        <InvoiceModal products={result.products} currency={currency} onClose={() => setShowInvoice(false)} />
      )}

      <div className="scanner-root">
        <header className="header">
          <div className="header-brand">
            <div className="header-logo">🏪</div>
            <div>
              <div className="header-title">الماسح الذكي للمخزون</div>
              <div className="header-sub">Smart Inventory Scanner</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <span className="header-badge">AI POWERED</span>
            <span
              style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)", color: "#34d399", fontSize: "0.65rem", fontWeight: 700, padding: "3px 8px", borderRadius: "20px", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
              onClick={() => setShowSettings(true)}
              title="تغيير العملة"
            >
              {currency.flag} {currency.symbol}
            </span>
            <div className="settings-btn-wrap">
              <button className="btn-settings-icon" onClick={() => setShowSettings(true)} title="الإعدادات">⚙️</button>
              {spreadsheetId && <span className="has-id-dot" />}
            </div>
          </div>
        </header>

        <main className="main">
          {previewImg && (
            <div className="image-preview">
              <img src={previewImg} alt="صورة الرف" />
              <div className="image-preview-overlay">
                {loading ? "جاري تحليل الصورة..." : `تم تحليل ${result?.total_products_detected ?? 0} منتج`}
              </div>
            </div>
          )}

          {!result && !loading && <ImageCapture onCapture={handleCapture} disabled={loading} />}

          {loading && (
            <div className="loading-wrapper">
              <div className="loading-spinner" />
              <p style={{ color: "#94a3b8", fontSize: "0.9rem", fontWeight: 600 }}>جاري تحليل الرفوف بالذكاء الاصطناعي...</p>
              <p style={{ color: "#475569", fontSize: "0.75rem", marginTop: "0.3rem" }}>يرجى الانتظار، يتم فحص المنتجات</p>
              <div className="loading-dots">
                <div className="dot" /><div className="dot" /><div className="dot" />
              </div>
            </div>
          )}

          {error && (
            <div className="error-box">
              <span className="error-icon">⚠️</span>
              <div>
                <div className="error-text">{error}</div>
                <button className="btn btn-secondary" style={{ marginTop: "0.5rem", fontSize: "0.78rem", padding: "0.4rem 0.9rem" }} onClick={handleReset}>حاول مرة أخرى</button>
              </div>
            </div>
          )}

          {result && !loading && (
            <>
              <div className="stats-bar">
                <StatCard label="إجمالي المنتجات" value={result.total_products_detected} icon="📦" />
                <StatCard label="دقة عالية" value={highConfidence} icon="✅" />
                <StatCard label="فئات مختلفة" value={new Set(result.products.map((p) => p.category).filter(Boolean)).size} icon="🏷️" />
              </div>

              <QualityBar quality={result.analysis_quality} />

              {result.warnings.length > 0 && (
                <div className="warnings-box">
                  <div className="warnings-title">⚠ تحذيرات التحليل</div>
                  <ul className="warnings-list">
                    {result.warnings.map((w, i) => (<li key={i}>• {w}</li>))}
                  </ul>
                </div>
              )}

              <div className="divider" />

              <div className="section-title" style={{ justifyContent: "space-between" }}>
                <span>المنتجات المكتشفة</span>
                <button className="btn btn-secondary" style={{ fontSize: "0.7rem", padding: "0.3rem 0.75rem", textTransform: "none", letterSpacing: 0 }} onClick={handleAddProduct}>➕ إضافة يدوياً</button>
              </div>

              <div className="products-list">
                {result.products.length === 0 ? (
                  <p style={{ color: "#475569", fontSize: "0.85rem", textAlign: "center", padding: "2rem" }}>لم يتم اكتشاف أي منتجات</p>
                ) : (
                  result.products.map((item, idx) => (
                    <ProductCard key={idx} item={item} index={idx} onChange={handleFieldChange} onDelete={handleDelete} currencySymbol={currency.symbol} />
                  ))
                )}
              </div>

              <div className="divider" />

              <div className="export-section">
                {exportSuccess ? (
                  <div className="export-success">
                    <div className="export-success-icon">🎉</div>
                    <div className="export-success-text">تم الترحيل بنجاح!</div>
                    <div className="export-success-sub">{result.total_products_detected} منتج تم إضافته إلى Google Sheets</div>
                    {spreadsheetId && (
                      <button className="btn btn-primary" style={{ marginTop: "1rem", width: "auto", fontSize: "0.85rem" }} onClick={() => window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`, "_blank")}>
                        📄 فتح جدول البيانات
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    {!spreadsheetId && (
                      <div style={{ background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: "12px", padding: "0.7rem 1rem", marginBottom: "0.75rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
                        <span style={{ fontSize: "0.78rem", color: "#d97706" }}>⚠️ لم تُضف رابط Google Sheets بعد</span>
                        <button className="btn btn-secondary" style={{ fontSize: "0.73rem", padding: "0.35rem 0.8rem", flexShrink: 0 }} onClick={() => setShowSettings(true)}>إضافة الآن ⚙️</button>
                      </div>
                    )}
                    <button className="btn btn-export" onClick={handleExport} disabled={exporting || result.products.length === 0}>
                      {exporting ? "⏳ جاري الترحيل..." : `📊 تأكيد الترحيل إلى Google Sheets (${result.total_products_detected} منتج)`}
                    </button>
                    <button className="btn btn-secondary" style={{ width: "100%", justifyContent: "center", marginTop: "0.6rem", padding: "0.85rem", background: "rgba(99,102,241,0.1)", borderColor: "rgba(99,102,241,0.3)", color: "#a5b4fc", fontSize: "0.9rem" }} onClick={() => setShowInvoice(true)} disabled={result.products.length === 0}>
                      🧾 إنشاء فاتورة احترافية PDF
                    </button>
                  </>
                )}
                <button className="btn btn-reset" onClick={handleReset}>↩ مسح ورفع صورة جديدة</button>
              </div>
            </>
          )}
        </main>
      </div>
    </>
  );
}
