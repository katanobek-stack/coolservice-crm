import { useEffect, useRef, useState } from "react";
import { PhotoLightbox } from "../../shared/ui/PhotoLightbox";
import { uploadPhoto, type PhotoData } from "../../shared/utils/photos";

export function useReportPhotos(folder: string) {
  const [files, setFiles] = useState<File[]>([]);
  const uploaded = useRef(new Map<File, PhotoData>());
  return {
    files, setFiles,
    async upload() {
      // Keep successful uploads for a retry; never delete a possibly committed
      // server attachment after a lost response.
      for (const file of files) if (!uploaded.current.has(file)) uploaded.current.set(file, await uploadPhoto(file, folder));
      return files.map(file => uploaded.current.get(file)!);
    },
    reset() { setFiles([]); uploaded.current.clear(); },
  };
}

export function ReportPhotoPicker({ files, onChange, disabled, purpose = "report" }: { files: File[]; onChange: (files: File[]) => void; disabled: boolean; purpose?: "report" | "task" }) {
  const [previews, setPreviews] = useState<string[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const urls = files.map(file => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, [files]);
  function select(list: FileList | null) {
    const added = Array.from(list ?? []);
    if (files.length + added.length > 6) { setError("Можно прикрепить до 6 фото к одному отчёту"); return; }
    if (added.some(f => !f.type.startsWith("image/") || f.size > 20 * 1024 * 1024)) { setError("Выберите изображения размером до 20 МБ"); return; }
    setError(""); onChange([...files, ...added]);
  }
  return <fieldset disabled={disabled} className="ppz-photo-picker">
    <legend>{purpose === "task" ? "Фото задачи" : "Фото выполненной работы"} · до 6</legend>
    <div className="ppz-row">
      <label className="ppz-photo-select">📷 Снять фото<input aria-label={purpose === "task" ? "Снять фото задачи" : "Снять фото работы"} type="file" accept="image/*" capture="environment" onChange={e => { select(e.target.files); e.target.value = ""; }} /></label>
      <label className="ppz-photo-select">▧ Из галереи<input aria-label={purpose === "task" ? "Фото задачи из галереи" : "Фото работы из галереи"} type="file" accept="image/*" multiple onChange={e => { select(e.target.files); e.target.value = ""; }} /></label>
      <span className="ppz-muted">{files.length}/6 · {purpose === "task" ? "сохранятся к задаче без отметки выполнения" : "сохранятся вместе с отчётом"}</span>
    </div>
    <div className="ppz-photo-grid">{files.map((file, index) => <div key={`${file.name}-${index}`}>
      {previews[index] && <img src={previews[index]} alt={`Выбранное фото ${index + 1}`} />}
      <button type="button" aria-label={`Убрать фото ${index + 1}`} onClick={() => onChange(files.filter((_, i) => i !== index))}>×</button>
    </div>)}</div>
    {error && <p className="ppz-error" role="alert">{error}</p>}
  </fieldset>;
}

export function PhotoEvidence({ photos = [], label = "Фотоотчёт" }: { photos?: PhotoData[]; label?: string }) {
  const [index, setIndex] = useState<number | null>(null);
  if (!photos.length) return null;
  return <div className="ppz-evidence"><span className="ppz-muted">{label} · {photos.length}</span>
    <div className="ppz-photo-grid">{photos.map((photo, i) => <button type="button" key={photo.path || photo.id} aria-label={`Открыть фото работы ${i + 1}`} onClick={() => setIndex(i)}><img src={photo.url || photo.data} alt={`Фото выполненной работы ${i + 1}`} loading="lazy" /></button>)}</div>
    {index !== null && <PhotoLightbox photos={photos} index={index} onIndexChange={setIndex} onClose={() => setIndex(null)} />}
  </div>;
}
