// @ts-nocheck -- npm workspace hoisting resolves two different copies of
// @types/react (backend's own 18.x nested next to the mobile-driven 19.x at
// the workspace root), so @react-pdf/renderer's JSX components structurally
// conflict across the two copies at the type level only. Runtime is
// unaffected (this file runs through tsx, which strips types without
// checking); EstimateData below stays fully typed and is what callers rely on.
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import React from "react";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, fontFamily: "Helvetica", color: "#1A2421" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  title: { fontSize: 20, fontWeight: 700 },
  subtitle: { fontSize: 10, color: "#5C6B65", marginTop: 2 },
  badge: { fontSize: 9, fontWeight: 700, padding: 4, backgroundColor: "#EAF3EF", borderRadius: 4 },
  section: { marginTop: 16 },
  sectionTitle: { fontSize: 13, fontWeight: 700, marginBottom: 8, borderBottomWidth: 1, borderBottomColor: "#E1E6E3", paddingBottom: 4 },
  infoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  infoBlock: { width: "45%", marginBottom: 8 },
  infoLabel: { fontSize: 8, color: "#5C6B65", textTransform: "uppercase" },
  infoValue: { fontSize: 10, marginTop: 2 },
  table: { marginTop: 4, borderWidth: 1, borderColor: "#E1E6E3", borderRadius: 6 },
  tableHeaderRow: { flexDirection: "row", backgroundColor: "#EAF3EF", paddingVertical: 6, paddingHorizontal: 10 },
  tableRow: { flexDirection: "row", paddingVertical: 6, paddingHorizontal: 10, borderTopWidth: 1, borderTopColor: "#E1E6E3" },
  colDescription: { flex: 3, fontSize: 9.5 },
  colQty: { flex: 1, fontSize: 9.5, textAlign: "right" },
  colPrice: { flex: 1, fontSize: 9.5, textAlign: "right" },
  colAmount: { flex: 1, fontSize: 9.5, textAlign: "right" },
  headerCell: { fontSize: 8, fontWeight: 700, textTransform: "uppercase", color: "#5C6B65" },
  totalsBlock: { marginTop: 12, alignSelf: "flex-end", width: 220 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalsLabel: { fontSize: 10, color: "#5C6B65" },
  totalsValue: { fontSize: 10 },
  grandTotalRow: { flexDirection: "row", justifyContent: "space-between", paddingTop: 6, marginTop: 4, borderTopWidth: 1, borderTopColor: "#1A2421" },
  grandTotalLabel: { fontSize: 12, fontWeight: 700 },
  grandTotalValue: { fontSize: 12, fontWeight: 700 },
  cardBody: { fontSize: 9.5, marginTop: 4 },
  footer: { position: "absolute", bottom: 24, left: 32, right: 32, fontSize: 8, color: "#5C6B65", textAlign: "center" },
});

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export interface EstimateLineItemData {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface EstimateData {
  estimateId: string;
  status: string;
  customerName: string;
  propertyAddress: string;
  createdByName: string;
  generatedAt: string;
  validUntil: string | null;
  notes: string | null;
  lineItems: EstimateLineItemData[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
}

export function EstimateDocument({ data }: { data: EstimateData }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Service Estimate</Text>
            <Text style={styles.subtitle}>Generated {new Date(data.generatedAt).toLocaleString()}</Text>
          </View>
          <Text style={styles.badge}>{data.status}</Text>
        </View>

        <View style={styles.section}>
          <View style={styles.infoGrid}>
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>Customer</Text>
              <Text style={styles.infoValue}>{data.customerName}</Text>
            </View>
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>Property</Text>
              <Text style={styles.infoValue}>{data.propertyAddress}</Text>
            </View>
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>Prepared by</Text>
              <Text style={styles.infoValue}>{data.createdByName}</Text>
            </View>
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>Valid until</Text>
              <Text style={styles.infoValue}>{data.validUntil ? new Date(data.validUntil).toLocaleDateString() : "—"}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Line Items</Text>
          <View style={styles.table}>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.colDescription, styles.headerCell]}>Description</Text>
              <Text style={[styles.colQty, styles.headerCell]}>Qty</Text>
              <Text style={[styles.colPrice, styles.headerCell]}>Unit price</Text>
              <Text style={[styles.colAmount, styles.headerCell]}>Amount</Text>
            </View>
            {data.lineItems.map((item, i) => (
              <View key={i} style={styles.tableRow} wrap={false}>
                <Text style={styles.colDescription}>{item.description}</Text>
                <Text style={styles.colQty}>{item.quantity}</Text>
                <Text style={styles.colPrice}>{formatCurrency(item.unitPrice)}</Text>
                <Text style={styles.colAmount}>{formatCurrency(item.amount)}</Text>
              </View>
            ))}
          </View>

          <View style={styles.totalsBlock}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Subtotal</Text>
              <Text style={styles.totalsValue}>{formatCurrency(data.subtotal)}</Text>
            </View>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Tax ({(data.taxRate * 100).toFixed(2)}%)</Text>
              <Text style={styles.totalsValue}>{formatCurrency(data.taxAmount)}</Text>
            </View>
            <View style={styles.grandTotalRow}>
              <Text style={styles.grandTotalLabel}>Total</Text>
              <Text style={styles.grandTotalValue}>{formatCurrency(data.total)}</Text>
            </View>
          </View>
        </View>

        {data.notes ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text style={styles.cardBody}>{data.notes}</Text>
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          PestApp Field — Estimate {data.estimateId}
        </Text>
      </Page>
    </Document>
  );
}
