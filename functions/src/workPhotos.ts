import { HttpsError } from "firebase-functions/v2/https";

export interface WorkPhoto { id: string; path: string; url: string }
/** Accept only references to this user's report folder in the same Firebase project. */
export function parseWorkPhotos(value: unknown, folder: string, projectId: string): WorkPhoto[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 6) throw new HttpsError("invalid-argument", "До 6 фотографий за один отчёт");
  const photos: WorkPhoto[] = [];
  for (const p of value) {
    if (!p || typeof p.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(p.id)
      || p.path !== `${folder}/${p.id}.jpg` || typeof p.url !== "string" || p.url.length > 3000) {
      throw new HttpsError("invalid-argument", "Некорректная фотография отчёта");
    }
    let url: URL;
    try { url = new URL(p.url); } catch { throw new HttpsError("invalid-argument", "Некорректная ссылка фотографии"); }
    const paths = ["appspot.com", "firebasestorage.app"].map(suffix => `/v0/b/${projectId}.${suffix}/o/${encodeURIComponent(p.path)}`);
    if (!projectId || url.origin !== "https://firebasestorage.googleapis.com" || !paths.includes(url.pathname)
      || url.searchParams.get("alt") !== "media" || url.username || url.password || url.hash) {
      throw new HttpsError("invalid-argument", "Фотография должна находиться в хранилище CRM");
    }
    if (photos.some(photo => photo.id === p.id)) throw new HttpsError("invalid-argument", "Повтор фотографии в отчёте");
    photos.push({ id: p.id, path: p.path, url: p.url });
  }
  return photos;
}

export function appendWorkPhotos<T extends { id: string; path?: string }>(previous: T[], added: T[]): T[] {
  const result = [...previous];
  for (const photo of added) {
    const old = result.find(p => p.id === photo.id || (p.path && p.path === photo.path));
    if (old) {
      if (old.path !== photo.path) throw new HttpsError("already-exists", "ID фотографии уже используется");
      continue;
    }
    result.push(photo);
  }
  if (result.length > 60) throw new HttpsError("resource-exhausted", "В этой работе уже 60 фотографий");
  return result;
}
