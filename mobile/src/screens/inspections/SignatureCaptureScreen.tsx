import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useRef, useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { addLocalSignature } from "../../db/inspectionStore";
import { useAuth } from "../../context/AuthContext";
import { useSignaturePad } from "../../components/SignaturePad";
import { SignatureBox, SignatureSvgHandle } from "../../components/SignatureBox";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";
import { Field, PrimaryButton, colors } from "../../components/ui";

type Props = NativeStackScreenProps<InspectionsStackParamList, "SignatureCapture">;

export default function SignatureCaptureScreen({ route, navigation }: Props) {
  const { inspectionId, signerType } = route.params;
  const { user } = useAuth();
  const pad = useSignaturePad();
  const svgRef = useRef<SignatureSvgHandle>(null);
  const [signerName, setSignerName] = useState(signerType === "TECHNICIAN" && user ? `${user.firstName} ${user.lastName}` : "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function handleSave() {
    if (!signerName.trim()) {
      setError("Signer name is required");
      return;
    }
    if (pad.isEmpty) {
      setError("Please sign before continuing");
      return;
    }
    setError(null);
    setSaving(true);
    svgRef.current?.toDataURL((base64) => {
      addLocalSignature(inspectionId, {
        signerType,
        signerName: signerName.trim(),
        imageBase64: `data:image/png;base64,${base64}`,
      });
      setSaving(false);
      navigation.goBack();
    });
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>{signerType === "CUSTOMER" ? "Customer signature" : "Technician signature"}</Text>
      <Field label="Signer name" value={signerName} onChangeText={setSignerName} />
      <SignatureBox ref={svgRef} panHandlers={pad.panHandlers} paths={pad.paths} isEmpty={pad.isEmpty} onClear={pad.clear} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton title="Save signature" onPress={handleSave} loading={saving} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  heading: { fontSize: 18, fontWeight: "700", color: colors.text, marginBottom: 16 },
  error: { color: colors.danger, marginVertical: 12, textAlign: "center" },
});
