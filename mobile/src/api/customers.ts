import type { Contact, Customer, Property } from "@pest-app/shared";
import { apiRequest } from "./client";

export type CustomerWithProperties = Customer & { properties: Property[] };
export type CustomerDetail = Customer & { properties: Property[]; contacts: Contact[] };

export function listCustomers(q?: string): Promise<CustomerWithProperties[]> {
  const query = q ? `?q=${encodeURIComponent(q)}` : "";
  return apiRequest<CustomerWithProperties[]>(`/api/customers${query}`);
}

export function getCustomer(id: string): Promise<CustomerDetail> {
  return apiRequest<CustomerDetail>(`/api/customers/${id}`);
}

export interface CreateCustomerInput {
  type: "RESIDENTIAL" | "COMMERCIAL";
  name: string;
  email?: string;
  phone?: string;
  billingAddressLine1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  notes?: string;
}

export function createCustomer(input: CreateCustomerInput): Promise<Customer> {
  return apiRequest<Customer>("/api/customers", { method: "POST", body: input });
}
