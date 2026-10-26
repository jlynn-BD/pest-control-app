import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { API_BASE_URL } from "../../api/config";
import { AuthImage } from "../../components/AuthImage";
import { deleteProperty, deleteSiteMap, getProperty, getPropertyServiceHistory, uploadSiteMap } from "../../api/properties";
import { primeCache } from "../../db/cache";
import { choosePhoto } from "../../lib/photo";
import { getCachedProperty } from "../../db/cache";
import { parseSiteMapSketch } from "../../lib/siteMapSketch";
import { ApiError } from "../../api/client";
import { CustomersStackParamList } from "../../navigation/navigationTypes";
import { Badge, Card, ErrorView, LoadingView, PrimaryButton, colors, fonts } from "../../components/ui";

type Props = NativeStackScreenProps<CustomersStackParamList, "PropertyDetail">;

export default function PropertyDetailScreen({ route, navigation }: Props) {
  const { propertyId } = route.params;
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingRemoveProperty, setConfirmingRemoveProperty] = useState(false);
  const [removingProperty, setRemovingProperty] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const propertyQuery = useQuery({ queryKey: ["properties", propertyId], queryFn: () => getProperty(propertyId) });
  // Coming back from drawing the site plan (or from an inspection): reload, and
  // re-read this device's copy, so the page reflects what was just done.
  const [, setFocusTick] = useState(0);
  const { refetch: refetchProperty } = propertyQuery;
  useFocusEffect(
    useCallback(() => {
      setFocusTick((n) => n + 1);
      refetchProperty();
    }, [refetchProperty])
  );
  const historyQuery = useQuery({
    queryKey: ["properties", propertyId, "history"],
    queryFn: () => getPropertyServiceHistory(propertyId),
  });

  const uploadMutation = useMutation({
    mutationFn: (uri: string) => uploadSiteMap(propertyId, uri),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["properties", propertyId] }),
    onError: (err) => setError(err instanceof ApiError || err instanceof Error ? err.message : "Failed to create site plan"),
    onSettled: () => setUploading(false),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteSiteMap(propertyId),
    onSuccess: () => {
      setConfirmingDelete(false);
      return queryClient.invalidateQueries({ queryKey: ["properties", propertyId] });
    },
    onError: (err) => setError(err instanceof ApiError || err instanceof Error ? err.message : "Couldn't delete the site plan photo"),
  });

  // Removes a duplicate (or mistaken) property. The server refuses if it has
  // inspections or bookings, and says so.
  async function handleRemoveProperty() {
    setRemovingProperty(true);
    setRemoveError(null);
    try {
      await deleteProperty(propertyId);
      primeCache().catch(() => {});
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      navigation.goBack();
    } catch (err) {
      setConfirmingRemoveProperty(false);
      setRemoveError(err instanceof ApiError || err instanceof Error ? err.message : "Couldn't delete the property.");
    } finally {
      setRemovingProperty(false);
    }
  }

  async function handleUploadSiteMap() {
    const uri = await choosePhoto();
    if (!uri) return;
    setError(null);
    setUploading(true);
    uploadMutation.mutate(uri);
  }

  if (propertyQuery.isLoading) return <LoadingView />;
  if (propertyQuery.isError || !propertyQuery.data)
    return <ErrorView message="Failed to load property" />;

  const property = propertyQuery.data;
  // Has anything been drawn on the property's map (walls, labels, shapes)?
  // The copy on this device wins when there is one: it includes drawing that
  // hasn't reached the server yet.
  const localSketch = getCachedProperty(propertyId)?.siteMapSketchJson;
  const hasDrawnPlan = parseSiteMapSketch(localSketch ?? property.siteMapSketch).levels.some(
    (l) => l.lines.length > 0 || l.labels.length > 0 || l.annotations.length > 0
  );
  const hasPlan = Boolean(property.siteMapImageUrl) || hasDrawnPlan;

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
        // Stored on the server behind login: needs the server address and the
        // person's access token or it shows blank.
        <AuthImage
          uri={property.siteMapImageUrl.startsWith("/api/") ? `${API_BASE_URL}${property.siteMapImageUrl}` : property.siteMapImageUrl}
          style={styles.siteMapThumb}
          resizeMode="cover"
        />
      ) : hasDrawnPlan ? (
        <Text style={styles.emptyText}>A site plan has been drawn for this property. Technicians mark entry points and issues on it during inspections.</Text>
      ) : (
        <Text style={styles.emptyText}>
          No site plan yet. Create one by drawing the layout of the property: levels, walls, labels and shapes. Technicians mark entry points and issues on it during inspections.
        </Text>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.buttonStack}>
      <PrimaryButton title={hasPlan ? "Open site plan" : "Create site plan"} onPress={() => navigation.navigate("SiteMap", { propertyId })} />
      {property.siteMapImageUrl ? (
        <>
          <PrimaryButton title="Replace site plan photo" onPress={handleUploadSiteMap} loading={uploading} />
          {confirmingDelete ? (
            <>
              <Text style={styles.emptyText}>Delete this site plan photo? It's removed for everyone, and the map goes back to the drawing tools. This can't be undone.</Text>
              <PrimaryButton title="Yes, delete it" onPress={() => deleteMutation.mutate()} loading={deleteMutation.isPending} />
              <PrimaryButton title="Keep it" onPress={() => setConfirmingDelete(false)} disabled={deleteMutation.isPending} />
            </>
          ) : (
            <PrimaryButton title="Delete site plan photo" onPress={() => setConfirmingDelete(true)} />
          )}
        </>
      ) : !hasDrawnPlan ? (
        <PrimaryButton title="Use a photo of the layout instead" onPress={handleUploadSiteMap} loading={uploading} />
      ) : null}
      </View>

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

      <Text style={styles.sectionTitle}>Remove this property</Text>
      {removeError ? <Text style={styles.error}>{removeError}</Text> : null}
      {confirmingRemoveProperty ? (
        <View style={styles.buttonStack}>
          <Text style={styles.emptyText}>Delete this property? Use this for a duplicate or a mistake. It can only be deleted if it has no inspections or bookings.</Text>
          <PrimaryButton title="Yes, delete property" onPress={handleRemoveProperty} loading={removingProperty} />
          <PrimaryButton title="Keep it" onPress={() => setConfirmingRemoveProperty(false)} disabled={removingProperty} />
        </View>
      ) : (
        <PrimaryButton title="Delete property" onPress={() => setConfirmingRemoveProperty(true)} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  buttonStack: { gap: 10 },
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16 },
  title: { fontFamily: fonts.display, fontSize: 22, fontWeight: "700", color: colors.text },
  meta: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
  notesCard: { marginTop: 14 },
  notesLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "600", marginBottom: 4 },
  notesText: { fontSize: 14, color: colors.text },
  sectionTitle: { fontFamily: fonts.display, fontSize: 15, fontWeight: "700", color: colors.text, marginTop: 20, marginBottom: 8 },
  emptyText: { color: colors.textMuted, fontStyle: "italic", marginBottom: 10 },
  siteMapThumb: { width: "100%", height: 180, borderRadius: 10, marginBottom: 10, backgroundColor: colors.border },
  error: { color: colors.danger, marginBottom: 10 },
  card: { marginBottom: 8, gap: 4 },
  cardTitle: { fontFamily: fonts.display, fontSize: 14, fontWeight: "600", color: colors.text },
});
