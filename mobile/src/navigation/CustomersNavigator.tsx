import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import CustomerDetailScreen from "../screens/customers/CustomerDetailScreen";
import CustomerFormScreen from "../screens/customers/CustomerFormScreen";
import CustomerListScreen from "../screens/customers/CustomerListScreen";
import PropertyDetailScreen from "../screens/properties/PropertyDetailScreen";
import PropertyFormScreen from "../screens/properties/PropertyFormScreen";
import EstimateListScreen from "../screens/estimates/EstimateListScreen";
import EstimateDetailScreen from "../screens/estimates/EstimateDetailScreen";
import EstimateFormScreen from "../screens/estimates/EstimateFormScreen";
import { CustomersStackParamList } from "./navigationTypes";
import { colors } from "../components/ui";

const Stack = createNativeStackNavigator<CustomersStackParamList>();

export default function CustomersNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.card }, headerTintColor: colors.text }}>
      <Stack.Screen name="CustomerList" component={CustomerListScreen} options={{ title: "Customers" }} />
      <Stack.Screen name="CustomerDetail" component={CustomerDetailScreen} options={{ title: "Customer" }} />
      <Stack.Screen name="CustomerForm" component={CustomerFormScreen} options={{ title: "New Customer" }} />
      <Stack.Screen name="PropertyDetail" component={PropertyDetailScreen} options={{ title: "Property" }} />
      <Stack.Screen name="PropertyForm" component={PropertyFormScreen} options={{ title: "New Property" }} />
      <Stack.Screen name="EstimateList" component={EstimateListScreen} options={{ title: "Estimates" }} />
      <Stack.Screen name="EstimateDetail" component={EstimateDetailScreen} options={{ title: "Estimate" }} />
      <Stack.Screen name="EstimateForm" component={EstimateFormScreen} options={{ title: "Edit Estimate" }} />
    </Stack.Navigator>
  );
}
