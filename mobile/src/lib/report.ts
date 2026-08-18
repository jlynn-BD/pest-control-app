import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { API_BASE_URL } from "../api/config";
import { tokenStore } from "../api/tokenStore";

async function downloadAndSharePdf(url: string, filename: string): Promise<void> {
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
