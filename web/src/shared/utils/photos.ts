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

export async function uploadPhotos(files: File[], folder = "photos"): Promise<PhotoData[]> {
  return Promise.all(files.map((f) => uploadPhoto(f, folder)));
}

export async function deletePhoto(path: string): Promise<void> {
  try {
    await deleteObject(ref(getFirebaseStorage(), path));
  } catch {
    // ignore not-found errors
  }
}
