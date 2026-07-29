import { useEffect } from "react";
import type { PhotoData } from "../utils/photos";

function photoSrc(p: PhotoData & { data?: string }): string {
  return p.url ?? p.data ?? "";
}

// Fullscreen photo viewer with prev/next paging through a fixed set of photos (e.g. one task's photos)
export function PhotoLightbox({ photos, index, onIndexChange, onClose }: {
  photos:        (PhotoData & { data?: string })[];
  index:         number;
  onIndexChange: (i: number) => void;
  onClose:       () => void;
}) {
  const count      = photos.length;
  const safeIndex  = Math.min(Math.max(index, 0), Math.max(count - 1, 0));
  const src        = count > 0 ? photoSrc(photos[safeIndex]) : "";
  const hasPrev    = safeIndex > 0;
  const hasNext    = safeIndex < count - 1;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && safeIndex < count - 1) onIndexChange(safeIndex + 1);
      if (e.key === "ArrowLeft" && safeIndex > 0) onIndexChange(safeIndex - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [safeIndex, count, onClose, onIndexChange]);

  if (!src) return null;

  const navBtnStyle = {
    position: "absolute" as const,
    top: "50%", transform: "translateY(-50%)",
    width: 44, height: 44, borderRadius: 22,
    background: "rgba(255,255,255,0.12)", border: "none",
    color: "#fff", fontSize: 24, lineHeight: 1,
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer",
  };

  return (
    <div
      className="fixed inset-0 z-[600] flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
      {count > 1 && (
        <div style={{ position: "absolute", top: 16, left: 0, right: 0, textAlign: "center", color: "#fff", fontSize: 13, fontWeight: 600, letterSpacing: 0.5 }}>
          {safeIndex + 1} / {count}
        </div>
      )}

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        style={{
          position: "absolute", top: 12, right: 16,
          width: 36, height: 36, borderRadius: 18,
          background: "rgba(255,255,255,0.12)", border: "none",
          color: "#fff", fontSize: 20, cursor: "pointer",
        }}
      >
        ×
      </button>

      {hasPrev && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onIndexChange(safeIndex - 1); }}
          style={{ ...navBtnStyle, left: 8 }}
        >
          ‹
        </button>
      )}
      {hasNext && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onIndexChange(safeIndex + 1); }}
          style={{ ...navBtnStyle, right: 8 }}
        >
          ›
        </button>
      )}

      <img
        src={src}
        alt=""
        className="max-w-[92%] max-h-[85%] object-contain rounded-xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
