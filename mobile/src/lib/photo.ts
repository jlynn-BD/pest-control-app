import * as ImagePicker from "expo-image-picker";
import { Alert, Platform } from "react-native";

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

// Opens the browser's file picker. With `camera` it goes straight to the
// device camera; without it, phones show their own chooser (Photo Library /
// Take Photo / Choose File) and computers show the file dialog. `multiple`
// lets several pictures be chosen at once (library only).
function pickOnWeb(opts: { camera: boolean; multiple: boolean }): Promise<string[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    if (opts.camera) input.setAttribute("capture", "environment");
    if (opts.multiple && !opts.camera) input.multiple = true;
    input.style.display = "none";
    document.body.appendChild(input);
    let settled = false;
    const finish = (value: string[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };
    input.addEventListener("change", async () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) return finish([]);
      const urls = await Promise.all(files.map((f) => toCompressedDataUrl(f).catch(() => null)));
      finish(urls.filter((u): u is string => Boolean(u)));
    });
    input.addEventListener("cancel", () => finish([]));
    input.click();
  });
}

// Take a new picture with the camera.
export async function capturePhoto(): Promise<string | null> {
  if (Platform.OS === "web") return (await pickOnWeb({ camera: true, multiple: false }))[0] ?? null;

  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (perm.status !== "granted") return null;

  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 });
  if (result.canceled || !result.assets?.[0]) return null;
  return result.assets[0].uri;
}

// Choose one or more existing pictures from the device's photo library.
export async function pickPhotosFromLibrary(): Promise<string[]> {
  if (Platform.OS === "web") return pickOnWeb({ camera: false, multiple: true });

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    quality: 0.7,
  });
  if (result.canceled) return [];
  return result.assets.map((a) => a.uri);
}

// One picture, from wherever the person prefers: on the web the phone's own
// chooser (Photo Library / Take Photo / Files) appears; in the phone app a
// small menu asks.
export async function choosePhoto(): Promise<string | null> {
  if (Platform.OS === "web") return (await pickOnWeb({ camera: false, multiple: false }))[0] ?? null;

  const source = await new Promise<"camera" | "library" | null>((resolve) => {
    Alert.alert("Add a photo", undefined, [
      { text: "Take photo", onPress: () => resolve("camera") },
      { text: "Choose from library", onPress: () => resolve("library") },
      { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
    ], { cancelable: true, onDismiss: () => resolve(null) });
  });
  if (source === "camera") return capturePhoto();
  if (source === "library") return (await pickPhotosFromLibrary())[0] ?? null;
  return null;
}
