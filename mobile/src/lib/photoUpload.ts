import { Platform } from "react-native";

// Adds a photo to an upload form. On a phone app the { uri, name, type }
// object is what React Native's FormData turns into a file; a browser's
// FormData doesn't understand it and would send the text "[object Object]",
// so on web the picture's bytes are read back and attached as a real file.
export async function appendPhotoFile(form: FormData, uri: string, name: string): Promise<void> {
  if (Platform.OS === "web") {
    const blob = await (await fetch(uri)).blob();
    form.append("file", blob, name);
    return;
  }
  form.append("file", { uri, name, type: "image/jpeg" } as unknown as Blob);
}
