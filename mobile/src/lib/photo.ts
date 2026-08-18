import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

// expo-image-picker's launchCameraAsync has no web implementation, so on
// web we fall back to the file/library picker for the browser smoke-test
// target; a real device build always uses the live camera.
export async function capturePhoto(): Promise<string | null> {
  const useLibrary = Platform.OS === "web";

  if (!useLibrary) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== "granted") return null;
  }

  const result = useLibrary
    ? await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 })
    : await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 });

  if (result.canceled || !result.assets?.[0]) return null;
  return result.assets[0].uri;
}
