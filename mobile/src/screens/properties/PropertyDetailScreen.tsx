import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { Image, ScrollView, StyleSheet, Text } from "react-native";
import { getProperty, getPropertyServiceHistory, uploadSiteMap } from "../../api/properties";
import { capturePhoto } from "../../lib/photo";
import { ApiError } from "../../api/client";
import { CustomersStackParamList } from "../../navigation/navigationTypes";
import { Badge, Card, ErrorView, LoadingView, PrimaryButton, colors } from "../../components/ui";

type Props = NativeStackScreenProps<CustomersStackParamList, "PropertyDetail">;

export default function PropertyDetailScreen({ route }: Props) {
  const { propertyId } = route.params;
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const propertyQuery = useQuery({ queryKey: ["properties", propertyId], queryFn: () => getProperty(propertyId) });
  const historyQuery = useQuery({
    queryKey: ["properties", propertyId, "history"],
    queryFn: () => getPropertyServiceHistory(propertyId),
  });

  const uploadMutation = useMutation({
    mutationFn: (uri: string) => uploadSiteMap(propertyId, uri),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["properties", propertyId] }),
    onError: (err) => setError(err instanceof ApiError || err instanceof Error ? err.message : "Failed to upload site plan"),
    onSettled: () => setUploading(false),
  });

  async function handleUploadSiteMap() {
    const uri = await capturePhoto();
    if (!uri) return;
    setError(null);
    setUploading(true);
    uploadMutation.mutate(uri);
  }

  if (propertyQuery.isLoading) return <LoadingView />;
  if (propertyQuery.isError || !propertyQuery.data)
    return <ErrorView message="Failed to load property" />;

  const property = propertyQuery.data;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{property.label || property.addressLine1}</Text>
      <Text style={styles.meta}>
        {property.addressLine1}, {property.city}, {property.state} {property.postalCode}
      </Text>
      <Text style={styles.meta}>{property.customer.name}</Text>
      {property.accessNotes ? (
        <Card style={styles.notesCard}>
          <Text style={styles.notesLabel}>Access notes</Text>
          <Text style={styles.notesText}>{property.accessNotes}</Text>
        </Card>
      ) : null}

      <Text style={styles.sectionTitle}>Site plan</Text>
      {property.siteMapImageUrl ? (
        <Image source={{ uri: property.siteMapImageUrl }} style={styles.siteMapThumb} resizeMode="cover" />
      ) : (
        <Text style={styles.emptyText}>No site plan uploaded yet. Technicians mark entry points and issues on it during inspections.</Text>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton
        title={property.siteMapImageUrl ? "Replace site plan" : "Upload site plan"}
        onPress={handleUploadSiteMap}
        loading={uploading}
      />

      <Text style={styles.sectionTitle}>Service history</Text>
      {historyQuery.isLoading ? (
        <LoadingView />
      ) : !historyQuery.data || historyQuery.data.length === 0 ? (
        <Text style={styles.emptyText}>No prior inspections</Text>
      ) : (
        historyQuery.data.map((inspection) => (
          <Card key={inspection.id} style={styles.card}>
            <Text style={styles.cardTitle}>
              {new Date(inspection.createdAt).toLocaleDateString()} · {inspection.technician.firstName}{" "}
              {inspection.technician.lastName}
            </Text>
            <Badge
              label={inspection.status}
              tone={inspection.status === "COMPLETED" ? "success" : "default"}
            />
            <Text style={styles.meta}>{inspection.findings.length} finding(s) recorded</Text>
          </Card>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  meta: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
  notesCard: { marginTop: 14 },
  notesLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "600", marginBottom: 4 },
  notesText: { fontSize: 14, color: colors.text },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: 20, marginBottom: 8 },
  emptyText: { color: colors.textMuted, fontStyle: "italic", marginBottom: 10 },
  siteMapThumb: { width: "100%", height: 180, borderRadius: 10, marginBottom: 10, backgroundColor: colors.border },
  error: { color: colors.danger, marginBottom: 10 },
  card: { marginBottom: 8, gap: 4 },
  cardTitle: { fontSize: 14, fontWeight: "600", color: colors.text },
});
