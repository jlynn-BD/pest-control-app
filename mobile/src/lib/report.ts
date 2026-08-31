import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { API_BASE_URL } from "../api/config";
import { tokenStore } from "../api/tokenStore";

// expo-file-system's File/Sharing APIs are native-only ("expo-file-system is
// not supported on web" - its web stub methods are empty and throw once
// something like validatePath() gets called on them), so web downloads the
// PDF as a blob and saves it via a normal anchor click instead.
async function downloadPdfOnWeb(url: string, filename: string): Promise<void> {
  const token = await tokenStore.getAccessToken();
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  if (!res.ok) throw new Error(`Failed to download PDF (${res.status})`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

async function downloadAndSharePdf(url: string, filename: string): Promise<void> {
  if (Platform.OS === "web") {
    return downloadPdfOnWeb(url, filename);
  }

  const token = await tokenStore.getAccessToken();
  const destination = new File(Paths.document, filename);

  const file = await File.downloadFileAsync(url, destination, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    idempotent: true,
  });

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(file.uri, { mimeType: "application/pdf" });
  }
}

export function downloadAndShareReport(reportId: string, inspectionId: string): Promise<void> {
  return downloadAndSharePdf(`${API_BASE_URL}/api/reports/${reportId}/download`, `inspection-report-${inspectionId}.pdf`);
}

export function downloadAndShareEstimate(estimateId: string): Promise<void> {
  return downloadAndSharePdf(`${API_BASE_URL}/api/estimates/${estimateId}/pdf`, `estimate-${estimateId}.pdf`);
}
