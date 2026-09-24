import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

// On a phone's browser, an <input capture> opens the camera directly (and
// on a laptop it just opens the file dialog). expo-image-picker has no camera
// on web, so this does it by hand, then shrinks the picture - a raw phone
// photo is several MB, too heavy to keep on the device and upload over cell
// data - and returns it as a data URL, which (unlike a blob address)
// survives a page reload.
const MAX_PHOTO_EDGE = 1600;

async function toCompressedDataUrl(file: File): Promise<string> {
  if (typeof createImageBitmap !== "function") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.72);
}

function captureOnWeb(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.setAttribute("capture", "environment");
    input.style.display = "none";
    document.body.appendChild(input);
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      finish(await toCompressedDataUrl(file).catch(() => null));
    });
    input.addEventListener("cancel", () => finish(null));
    input.click();
  });
}

export async function capturePhoto(): Promise<string | null> {
  if (Platform.OS === "web") return captureOnWeb();

  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (perm.status !== "granted") return null;

  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 });
  if (result.canceled || !result.assets?.[0]) return null;
  return result.assets[0].uri;
}
