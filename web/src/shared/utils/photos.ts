import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { getFirebaseStorage } from "../firebase/app";
import { genId } from "./format";

export interface PhotoData {
  id:    string;
  url?:  string;   // Firebase Storage URL
  data?: string;   // Legacy base64 format
  path?: string;
}

function compressToBlob(file: File, maxWidth = 800, quality = 0.65): Promise<Blob> {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let { width: w, height: h } = img;
        if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => resolve(blob!), "image/jpeg", quality);
      };
      img.src = e.target!.result as string;
    };
    fr.readAsDataURL(file);
  });
}

export async function uploadPhoto(file: File, folder = "photos"): Promise<PhotoData> {
  const photoId = genId();
  const path    = `${folder}/${photoId}.jpg`;
  const blob    = await compressToBlob(file);
  const sRef    = ref(getFirebaseStorage(), path);
  const snap    = await uploadBytes(sRef, blob);
  const url     = await getDownloadURL(snap.ref);
  return { id: photoId, url, path };
}

export async function uploadPhotos(
  files: File[],
  folder = "photos",
  onProgress?: (done: number, total: number) => void,
): Promise<PhotoData[]> {
  const total = files.length;
  let done = 0;
  onProgress?.(done, total);
  return Promise.all(
    files.map(async (f) => {
      const result = await uploadPhoto(f, folder);
      done += 1;
      onProgress?.(done, total);
      return result;
    }),
  );
}

export async function deletePhoto(path: string): Promise<void> {
  try {
    await deleteObject(ref(getFirebaseStorage(), path));
  } catch {
    // ignore not-found errors
  }
}

// Firebase Storage error codes → понятные сообщения для пользователя
export function getStorageErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  if (code === "storage/quota-exceeded") {
    return "Хранилище переполнено. Обратитесь к администратору — необходимо очистить старые фото в Firebase Console (Storage → Files) или перейти на платный тариф Blaze.";
  }
  if (code === "storage/unauthorized") {
    return "Нет доступа к хранилищу. Попробуйте выйти и войти заново.";
  }
  if (code === "storage/canceled") {
    return "Загрузка отменена.";
  }
  if (code === "storage/retry-limit-exceeded" || code === "storage/network-request-failed") {
    return "Ошибка сети при загрузке фото. Проверьте подключение и попробуйте ещё раз.";
  }
  if (code === "storage/unknown" || code === "storage/server-file-wrong-size") {
    return "Ошибка сервера при загрузке фото. Попробуйте ещё раз.";
  }
  return err instanceof Error ? err.message : String(err);
}
