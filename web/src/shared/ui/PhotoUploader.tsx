import { useRef, useState } from "react";
import { uploadPhotos } from "../utils/photos";
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
      alert("Ошибка загрузки: " + (err instanceof Error ? err.message : String(err)));
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
