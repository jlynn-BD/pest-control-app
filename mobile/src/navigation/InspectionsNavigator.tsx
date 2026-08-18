import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import ChecklistScreen from "../screens/inspections/ChecklistScreen";
import SiteMapScreen from "../screens/inspections/SiteMapScreen";
import FindingFormScreen from "../screens/inspections/FindingFormScreen";
import InspectionDetailScreen from "../screens/inspections/InspectionDetailScreen";
import InspectionListScreen from "../screens/inspections/InspectionListScreen";
import InspectionWorkspaceScreen from "../screens/inspections/InspectionWorkspaceScreen";
import LocalInspectionDetailScreen from "../screens/inspections/LocalInspectionDetailScreen";
import NewInspectionScreen from "../screens/inspections/NewInspectionScreen";
import RecommendationFormScreen from "../screens/inspections/RecommendationFormScreen";
import ScheduleFollowUpScreen from "../screens/inspections/ScheduleFollowUpScreen";
import EstimateDetailScreen from "../screens/estimates/EstimateDetailScreen";
import EstimateFormScreen from "../screens/estimates/EstimateFormScreen";
import SignatureCaptureScreen from "../screens/inspections/SignatureCaptureScreen";
import TreatmentFormScreen from "../screens/inspections/TreatmentFormScreen";
import { InspectionsStackParamList } from "./navigationTypes";
import { colors } from "../components/ui";

const Stack = createNativeStackNavigator<InspectionsStackParamList>();

export default function InspectionsNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.card }, headerTintColor: colors.text }}>
      <Stack.Screen name="InspectionList" component={InspectionListScreen} options={{ title: "Inspections" }} />
      <Stack.Screen name="InspectionDetail" component={InspectionDetailScreen} options={{ title: "Inspection" }} />
      <Stack.Screen name="LocalInspectionDetail" component={LocalInspectionDetailScreen} options={{ title: "Inspection" }} />
      <Stack.Screen name="NewInspection" component={NewInspectionScreen} options={{ title: "New Inspection" }} />
      <Stack.Screen name="InspectionWorkspace" component={InspectionWorkspaceScreen} options={{ title: "Inspection" }} />
      <Stack.Screen name="Checklist" component={ChecklistScreen} options={{ title: "Checklist" }} />
      <Stack.Screen name="SiteMap" component={SiteMapScreen} options={{ title: "Site Map" }} />
      <Stack.Screen name="FindingForm" component={FindingFormScreen} options={{ title: "New Finding" }} />
      <Stack.Screen name="RecommendationForm" component={RecommendationFormScreen} options={{ title: "New Recommendation" }} />
      <Stack.Screen name="TreatmentForm" component={TreatmentFormScreen} options={{ title: "New Treatment" }} />
      <Stack.Screen name="SignatureCapture" component={SignatureCaptureScreen} options={{ title: "Signature" }} />
      <Stack.Screen name="ScheduleFollowUp" component={ScheduleFollowUpScreen} options={{ title: "Schedule Follow-up" }} />
      <Stack.Screen name="EstimateDetail" component={EstimateDetailScreen} options={{ title: "Estimate" }} />
      <Stack.Screen name="EstimateForm" component={EstimateFormScreen} options={{ title: "Edit Estimate" }} />
    </Stack.Navigator>
  );
}
