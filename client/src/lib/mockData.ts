// Re-export shared types for backward compatibility
export type { StaffMember, Specialty, ProviderSchedule, ProviderSpecialty, ClinicArea } from "@shared/schema";
export { SPECIALTIES, PROVIDER_SPECIALTIES, CLINIC_AREAS, SHARED_LVN_SPECIALTIES } from "@shared/schema";

export type StaffType = 'MD' | 'DO' | 'NP' | 'PA' | 'LVN' | 'RN';

export const SCHEDULE_TYPES = ['Patient Care', 'Admin', 'Off', 'Meeting'];
