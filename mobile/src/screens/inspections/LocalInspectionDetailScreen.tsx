import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useMemo, useState } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { getCachedCustomer, getCachedProperty, getCachedTemplateSections } from "../../db/cache";
import { getLocalInspectionDetail, signatureImageUri } from "../../db/inspectionStore";
import { CHECKLIST_CATEGORY_LABEL, CHECKLIST_STATUS_LABEL, groupChecklistForDisplay } from "../../lib/checklist";
import { buildSiteMapPanels, parseSiteMapSketch } from "../../lib/siteMapSketch";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";
import { SiteMapCanvas } from "../../components/ArrowCanvas";
import { PhotoThumb } from "../../components/PhotoThumb";
import { AuthImage } from "../../components/AuthImage";
import { ReportCard } from "../../components/ReportCard";
import { InspectionHistoryLink } from "../../components/InspectionHistoryLink";
import { FindingsAndRecommendations } from "../../components/FindingsAndRecommendations";
import { runSync } from "../../sync/syncEngine";
import { Badge, Card, PrimaryButton, colors } from "../../components/ui";

type Props = NativeStackScreenProps<InspectionsStackParamList, "LocalInspectionDetail">;

export default function LocalInspectionDetailScreen({ route }: Props) {
  const { inspectionId } = route.params;
  // Re-read after each sync attempt so "not yet synced" turns into "Synced"
  // (and the report card appears) without leaving the page.
  const [refreshTick, setRefreshTick] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const detail = useMemo(() => getLocalInspectionDetail(inspectionId), [inspectionId, refreshTick]);

  const trySync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await runSync();
      if (res.error) setSyncError(res.error);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Could not sync");
    } finally {
      setSyncing(false);
      setRefreshTick((n) => n + 1);
    }
  }, []);

  // Opening an unsynced inspection starts a sync, and keeps retrying while
  // the page is open.
  useFocusEffect(
    useCallback(() => {
      const current = getLocalInspectionDetail(inspectionId);
      if (!current || current.inspection.syncStatus === "synced") return;
      trySync();
      const timer = setInterval(() => {
        const d = getLocalInspectionDetail(inspectionId);
        if (!d || d.inspection.syncStatus === "synced") {
          setRefreshTick((n) => n + 1);
          clearInterval(timer);
          return;
        }
        trySync();
      }, 15000);
      return () => clearInterval(timer);
    }, [inspectionId, trySync])
  );

  if (!detail) return null;

  const property = getCachedProperty(detail.inspection.propertyId);
  const customer = getCachedCustomer(detail.inspection.customerId);
  const templateSections = detail.inspection.templateId ? getCachedTemplateSections(detail.inspection.templateId) : [];
  const checklistSections = groupChecklistForDisplay(templateSections, detail.checklistResponses);
  const siteMapImageUri = property?.siteMapLocalUri || property?.siteMapImageUrl || null;
  const siteMapSketch = parseSiteMapSketch(property?.siteMapSketchJson);
  const siteMapPanels = buildSiteMapPanels(siteMapImageUri, siteMapSketch, detail.findings);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{customer?.name ?? "Inspection"}</Text>
        <Badge label={detail.inspection.status.replace(/_/g, " ")} tone={detail.inspection.status === "COMPLETED" ? "success" : "default"} />
      </View>
      <Text style={styles.meta}>{property?.addressLine1}</Text>
      <InspectionHistoryLink inspectionId={inspectionId} title={customer?.name} />
      {detail.inspection.syncStatus === "synced" ? (
        <Badge label="Synced" tone="success" />
      ) : (
        <>
          <Badge label={syncing ? "Syncing…" : "Stored on this device — not yet synced"} tone="warning" />
          {syncError ? <Text style={styles.meta}>Could not sync yet: {syncError}</Text> : null}
          <PrimaryButton title="Sync now" onPress={trySync} loading={syncing} />
        </>
      )}
      {detail.inspection.status === "COMPLETED" ? (
        detail.inspection.syncStatus === "synced" ? (
          <ReportCard inspectionId={inspectionId} />
        ) : (
          <Text style={styles.body}>The report can be generated once this inspection has synced. It is syncing now and this page updates by itself, or tap Sync now.</Text>
        )
      ) : null}


      {siteMapPanels.map((panel, i) => (
        <View key={i}>
          <Text style={styles.sectionTitle}>{panel.title}</Text>
          <SiteMapCanvas
            imageUri={panel.imageUri}
            arrows={panel.arrows}
            savedLines={panel.lines}
            labels={panel.labels}
            annotations={panel.annotations}
            grid={panel.grid}
            view={panel.view}
            mode="view"
          />
        </View>
      ))}

      {checklistSections.map((section) => (
        <View key={section.category}>
          <Text style={styles.sectionTitle}>{CHECKLIST_CATEGORY_LABEL[section.category] ?? section.category}</Text>
          {section.items.map((item, i) => (
            <Card key={i} style={styles.card}>
              <View style={styles.rowTop}>
                <Text style={styles.cardTitle}>{item.prompt}</Text>
                <Badge
                  label={CHECKLIST_STATUS_LABEL[item.status] ?? item.status}
                  tone={item.status === "NEEDS_ATTENTION" ? "danger" : item.status === "SATISFACTORY" ? "success" : "default"}
                />
              </View>
              {item.notes ? <Text style={styles.body}>{item.notes}</Text> : null}
              {item.photos.length > 0 ? (
                <View style={styles.photoRow}>
                  {item.photos.map((p) => (
                    <PhotoThumb key={p.id} uri={p.localUri} style={styles.photoThumb} />
                  ))}
                </View>
              ) : null}
            </Card>
          ))}
        </View>
      ))}

      <FindingsAndRecommendations
        findings={detail.findings.map((f) => ({
          id: f.id,
          areaLocation: f.areaLocation,
          severity: f.severity,
          description: f.description,
          photoUris: f.photos.map((p) => p.localUri),
          recommendationPriority: detail.recommendations.find((r) => r.findingId === f.id)?.priority ?? null,
        }))}
        standalone={detail.recommendations
          .filter((r) => !r.findingId || !detail.findings.some((f) => f.id === r.findingId))
          .map((r) => ({ id: r.id, title: r.title, priority: r.priority, description: r.description }))}
      />

      <Text style={styles.sectionTitle}>Signatures ({detail.signatures.length})</Text>
      {detail.signatures.map((s) => (
        <Card key={s.id} style={styles.card}>
          <Text style={styles.cardTitle}>
            {s.signerName} ({s.signerType})
          </Text>
          {signatureImageUri(s) ? <AuthImage uri={signatureImageUri(s)!} style={styles.signatureImage} resizeMode="contain" /> : null}
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 4 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 20, fontWeight: "700", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 2, marginBottom: 8 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: 18, marginBottom: 8 },
  card: { marginBottom: 8, gap: 2 },
  cardTitle: { fontSize: 14, fontWeight: "600", color: colors.text },
  body: { fontSize: 14, color: colors.text, marginTop: 4 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  photoThumb: { width: 60, height: 60, borderRadius: 6 },
  signatureImage: { width: "100%", height: 80, marginTop: 8, backgroundColor: "#fff" },
});
