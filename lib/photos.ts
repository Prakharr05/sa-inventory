import { supabase } from "./supabase";

export const BUCKET = "property-photos";
const MAX_SIDE = 1600;
const QUALITY = 0.8;

// crypto.randomUUID only exists on HTTPS/localhost; phones on LAN (http://192.168…) need a fallback.
export const uuid = (): string =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16));

// Resize to max 1600px and re-encode as JPEG — a 5 MB phone photo becomes ~300 KB.
export async function compress(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("Could not process image"))), "image/jpeg", QUALITY));
}

export async function uploadPhoto(propertyId: string, file: File): Promise<string> {
  const blob = await compress(file);
  const path = `${propertyId}/${uuid()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
  if (error) throw error;
  return path;
}

export async function deletePhotos(paths: string[]) {
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
}

export const photoUrl = (path: string) => supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
