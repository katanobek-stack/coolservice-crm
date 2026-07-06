import { useRef, useState } from "react";
import { uploadPhotos, getStorageErrorMessage } from "../utils/photos";
import type { PhotoData } from "../utils/photos";

interface Props {
  photos:    PhotoData[];
  onChange:  (photos: PhotoData[]) => Promise<void>;
  folder?:   string;
  readOnly?: boolean;
}

// Handles both {url} (Storage) and {data} (legacy base64) photo formats
function photoSrc(p: PhotoData & { data?: string }): string {
  return p.url ?? p.data ?? "";
}

export function PhotoGrid({ photos, onRemove, readOnly, onView }: {
  photos:    (PhotoData & { data?: string })[];
  onRemove?: (id: string) => void;
  readOnly?: boolean;
  onView?:   (url: string) => void;
}) {
  if (!photos.length) return null;
  return (
    <div className="grid grid-cols-3 gap-1.5 mt-2">
      {photos.map((p) => {
        const src = photoSrc(p);
        if (!src) return null;
        return (
        <div key={p.id} className="relative aspect-square">
          <img
            src={src}
            alt=""
            className="w-full h-full object-cover rounded-xl border border-[#E2E8F0] cursor-pointer"
            onClick={() => onView?.(src)}
          />
          {!readOnly && onRemove && (
            <button
              type="button"
              onClick={() => onRemove(p.id)}
              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs flex items-center justify-center border-none cursor-pointer leading-none"
            >
              ×
            </button>
          )}
        </div>
        );
      })}
    </div>
  );
}

export function DualPhotoButton({
  onUploaded,
  folder = "photos",
}: {
  onUploaded: (photos: PhotoData[]) => Promise<void>;
  folder?:    string;
}) {
  const camRef                     = useRef<HTMLInputElement>(null);
  const galRef                     = useRef<HTMLInputElement>(null);
  const [uploading, setUploading]  = useState(false);

  async function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    try {
      const result = await uploadPhotos(files, folder);
      await onUploaded(result);
    } catch (err) {
      alert("Ошибка загрузки: " + getStorageErrorMessage(err));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  if (uploading) return <span style={{ fontSize: 12, color: "var(--text3)" }}>⏳ Загрузка...</span>;

  const btnCss = "text-xs text-[#667085] bg-white px-2.5 py-1 rounded-lg border border-[#E2E8F0] cursor-pointer inline-flex items-center gap-1";
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handle} />
      <input ref={galRef} type="file" accept="image/*" multiple className="hidden" onChange={handle} />
      <button type="button" className={btnCss} onClick={() => camRef.current?.click()}>📷 Камера</button>
      <button type="button" className={btnCss} onClick={() => galRef.current?.click()}>🖼️ Галерея</button>
    </div>
  );
}

export function InlinePhotoButton({
  onUploaded,
  folder = "photos",
  label = "Фото",
  capture,
}: {
  onUploaded: (photos: PhotoData[]) => Promise<void>;
  folder?:    string;
  label?:     string;
  capture?:   "environment" | "user";
}) {
  const inputRef                   = useRef<HTMLInputElement>(null);
  const [uploading, setUploading]  = useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    try {
      const result = await uploadPhotos(files, folder);
      await onUploaded(result);
    } catch (err) {
      alert("Ошибка загрузки: " + getStorageErrorMessage(err));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple={!capture}
        {...(capture ? { capture } : {})}
        className="hidden"
        onChange={handleChange}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="text-xs text-[#667085] bg-white px-2.5 py-1 rounded-lg border border-[#E2E8F0] cursor-pointer disabled:opacity-50 inline-flex items-center gap-1"
      >
        {uploading ? "⏳" : capture ? "📷" : "🖼️"} {uploading ? "Загрузка..." : label}
      </button>
    </>
  );
}
