import { useQuery } from '@tanstack/react-query'
import {
  fetchCustomers, fetchCustomer, fetchCustomerAddresses,
  fetchInstalledSystems, fetchWarrantyRecords,
  fetchRentalContracts, fetchRentalContractSystems, fetchRentalPayments,
  fetchMaintenancePlans, fetchComplianceRequirements,
  fetchServiceScheduleItems, fetchServiceCompletions, fetchComplianceProofs,
  fetchBuyoutCalculations, fetchCustomerActivity, fetchProductCatalog,
} from '../../services/customerService'

export const CUSTOMER_KEYS = {
  all:          ['customers'] as const,
  list:         () => [...CUSTOMER_KEYS.all, 'list'] as const,
  detail:       (id: string) => [...CUSTOMER_KEYS.all, id] as const,
  addresses:    (id: string) => [...CUSTOMER_KEYS.all, id, 'addresses'] as const,
  systems:      (id: string) => [...CUSTOMER_KEYS.all, id, 'systems'] as const,
  warranties:   (id: string) => [...CUSTOMER_KEYS.all, id, 'warranties'] as const,
  rentals:      (id: string) => [...CUSTOMER_KEYS.all, id, 'rentals'] as const,
  rentalSys:    (cId: string) => [...CUSTOMER_KEYS.all, cId, 'rental_systems'] as const,
  payments:     (cId: string) => [...CUSTOMER_KEYS.all, cId, 'payments'] as const,
  plans:        (id: string) => [...CUSTOMER_KEYS.all, id, 'plans'] as const,
  requirements: (id: string) => [...CUSTOMER_KEYS.all, id, 'requirements'] as const,
  schedules:    (id: string) => [...CUSTOMER_KEYS.all, id, 'schedules'] as const,
  completions:  (id: string) => [...CUSTOMER_KEYS.all, id, 'completions'] as const,
  proofs:       (id: string) => [...CUSTOMER_KEYS.all, id, 'proofs'] as const,
  buyouts:      (cId: string) => [...CUSTOMER_KEYS.all, cId, 'buyouts'] as const,
  activity:     (id: string) => [...CUSTOMER_KEYS.all, id, 'activity'] as const,
  catalog:      () => ['product_catalog'] as const,
}

export function useCustomers() {
  return useQuery({ queryKey: CUSTOMER_KEYS.list(), queryFn: fetchCustomers, staleTime: 30_000 })
}
export function useCustomer(id: string) {
  return useQuery({ queryKey: CUSTOMER_KEYS.detail(id), queryFn: () => fetchCustomer(id), enabled: !!id })
}
export function useCustomerAddresses(id: string) {
  return useQuery({ queryKey: CUSTOMER_KEYS.addresses(id), queryFn: () => fetchCustomerAddresses(id), enabled: !!id })
}
export function useInstalledSystems(id: string) {
  return useQuery({ queryKey: CUSTOMER_KEYS.systems(id), queryFn: () => fetchInstalledSystems(id), enabled: !!id })
}
export function useWarrantyRecords(id: string) {
  return useQuery({ queryKey: CUSTOMER_KEYS.warranties(id), queryFn: () => fetchWarrantyRecords(id), enabled: !!id })
}
export function useRentalContracts(id: string) {
  return useQuery({ queryKey: CUSTOMER_KEYS.rentals(id), queryFn: () => fetchRentalContracts(id), enabled: !!id })
}
export function useRentalContractSystems(contractId: string) {
  return useQuery({ queryKey: CUSTOMER_KEYS.rentalSys(contractId), queryFn: () => fetchRentalContractSystems(contractId), enabled: !!contractId })
}
export function useRentalPayments(contractId: string) {
  return useQuery({ queryKey: CUSTOMER_KEYS.payments(contractId), queryFn: () => fetchRentalPayments(contractId), enabled: !!contractId })
}
export function useMaintenancePlans(id: string) {
  return useQuery({ queryKey: CUSTOMER_KEYS.plans(id), queryFn: () => fetchMaintenancePlans(id), enabled: !!id })
}
export function useComplianceRequirements(id: string) {
  return useQuery({ queryKey: CUSTOMER_KEYS.requirements(id), queryFn: () => fetchComplianceRequirements(id), enabled: !!id })
}
export function useServiceScheduleItems(id: string) {
  return useQuery({ queryKey: CUSTOMER_KEYS.schedules(id), queryFn: () => fetchServiceScheduleItems(id), enabled: !!id })
}
export function useServiceCompletions(id: string) {
  return useQuery({ queryKey: CUSTOMER_KEYS.completions(id), queryFn: () => fetchServiceCompletions(id), enabled: !!id })
}
export function useComplianceProofs(id: string) {
  return useQuery({ queryKey: CUSTOMER_KEYS.proofs(id), queryFn: () => fetchComplianceProofs(id), enabled: !!id })
}
export function useBuyoutCalculations(contractId: string) {
  return useQuery({ queryKey: CUSTOMER_KEYS.buyouts(contractId), queryFn: () => fetchBuyoutCalculations(contractId), enabled: !!contractId })
}
export function useCustomerActivity(id: string) {
  return useQuery({ queryKey: CUSTOMER_KEYS.activity(id), queryFn: () => fetchCustomerActivity(id), enabled: !!id })
}
export function useProductCatalog() {
  return useQuery({ queryKey: CUSTOMER_KEYS.catalog(), queryFn: fetchProductCatalog, staleTime: 60_000 })
}
