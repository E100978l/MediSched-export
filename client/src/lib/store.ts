import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import type {
  StaffMember, CoverageRecord, StaffUnavailability,
  SpecialClinic, ClinicDayOverride, ClinicAssignment, ProviderSchedule,
  CallAvailability, ShiftDistributionLog, RnAssignment, InsertRnAssignment,
  FloorUnit, InsertFloorUnit,
  FloorDailyRooms, InsertFloorDailyRooms,
  FloorStaffMember, InsertFloorStaff,
  FloorShiftAssignment, InsertFloorShiftAssignment,
  FloorRoomAcuity, InsertFloorRoomAcuity,
  FloorShiftReport, InsertFloorShiftReport,
  FloorShift,
  PublicUser,
} from "@shared/schema";
import { shiftsOverlap } from "@shared/schema";

export type {
  StaffMember, CoverageRecord, StaffUnavailability,
  SpecialClinic, ClinicDayOverride, ClinicAssignment, ProviderSchedule,
  CallAvailability, ShiftDistributionLog, RnAssignment, InsertRnAssignment,
  FloorUnit, InsertFloorUnit,
  FloorDailyRooms, InsertFloorDailyRooms,
  FloorStaffMember, InsertFloorStaff,
  FloorShiftAssignment, InsertFloorShiftAssignment,
  FloorRoomAcuity, InsertFloorRoomAcuity,
  FloorShiftReport, InsertFloorShiftReport,
  FloorShift,
  PublicUser,
};
export { shiftsOverlap };

const POLL_INTERVAL = 15_000; // 15-second live-update polling

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(err.error || res.statusText, res.status);
  }
  return res.json();
}

// --- Staff + Coverage ---

export function useStaff() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAuthenticated = !!user;
  const isAdmin = user?.role === "admin";

  const staffQuery = useQuery<StaffMember[]>({
    queryKey: ["/api/staff"],
    queryFn: () => apiFetch("/api/staff"),
    enabled: isAuthenticated,
    refetchInterval: isAuthenticated ? POLL_INTERVAL : false,
  });

  const coverageQuery = useQuery<CoverageRecord[]>({
    queryKey: ["/api/coverage"],
    queryFn: () => apiFetch("/api/coverage"),
    enabled: isAuthenticated,
    refetchInterval: isAuthenticated ? POLL_INTERVAL : false,
  });

  const updateMutation = useMutation({
    mutationFn: (member: StaffMember) =>
      apiFetch<StaffMember>(`/api/staff/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: member.name,
          role: member.role,
          specialty: member.specialty,
          crossTrained: member.crossTrained,
          assignedTo: member.assignedTo,
          isFloatPool: member.isFloatPool,
          lvnsRequired: member.lvnsRequired,
          phone: member.phone,
          email: member.email,
          employmentType: member.employmentType,
        }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/staff"] }),
  });

  const addMutation = useMutation({
    mutationFn: (member: Omit<StaffMember, "id">) =>
      apiFetch<StaffMember>("/api/staff", {
        method: "POST",
        body: JSON.stringify(member),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/staff"] }),
  });

  const inactiveStaffQuery = useQuery<StaffMember[]>({
    queryKey: ["/api/staff/inactive"],
    queryFn: () => apiFetch("/api/staff/inactive"),
    enabled: isAuthenticated && isAdmin,
    refetchInterval: isAuthenticated && isAdmin ? POLL_INTERVAL : false,
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/staff/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      queryClient.invalidateQueries({ queryKey: ["/api/staff/inactive"] });
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/staff/${id}/reactivate`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      queryClient.invalidateQueries({ queryKey: ["/api/staff/inactive"] });
    },
  });

  const addCoverageMutation = useMutation({
    mutationFn: (record: Omit<CoverageRecord, "id">) =>
      apiFetch<CoverageRecord>("/api/coverage", {
        method: "POST",
        body: JSON.stringify(record),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/coverage"] }),
  });

  const deleteCoverageMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/coverage/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/coverage"] }),
  });

  return {
    staff: staffQuery.data ?? [],
    inactiveStaff: inactiveStaffQuery.data ?? [],
    isLoading: staffQuery.isLoading || coverageQuery.isLoading || (isAdmin && inactiveStaffQuery.isLoading),
    isError: staffQuery.isError || coverageQuery.isError || (isAdmin && inactiveStaffQuery.isError),
    error: staffQuery.error ?? coverageQuery.error ?? (isAdmin ? inactiveStaffQuery.error : null),
    refetch: () => { staffQuery.refetch(); coverageQuery.refetch(); if (isAdmin) inactiveStaffQuery.refetch(); },
    coverageHistory: coverageQuery.data ?? [],
    updateStaffMember: (member: StaffMember) => updateMutation.mutateAsync(member),
    addStaffMember: (member: Omit<StaffMember, "id">) => addMutation.mutateAsync(member),
    deactivateStaffMember: (id: string) => deactivateMutation.mutateAsync(id),
    reactivateStaffMember: (id: string) => reactivateMutation.mutateAsync(id),
    addCoverageRecord: (record: Omit<CoverageRecord, "id">) => addCoverageMutation.mutateAsync(record),
    deleteCoverageRecord: (id: string) => deleteCoverageMutation.mutateAsync(id),
  };
}

// --- Unavailability ---

export function useUnavailability() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAuthenticated = !!user;

  const query = useQuery<StaffUnavailability[]>({
    queryKey: ["/api/unavailability"],
    queryFn: () => apiFetch("/api/unavailability"),
    enabled: isAuthenticated,
    refetchInterval: isAuthenticated ? POLL_INTERVAL : false,
  });

  const addMutation = useMutation({
    mutationFn: (record: Omit<StaffUnavailability, "id">) =>
      apiFetch<StaffUnavailability>("/api/unavailability", {
        method: "POST",
        body: JSON.stringify(record),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/unavailability"] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Omit<StaffUnavailability, "id">> }) =>
      apiFetch<StaffUnavailability>(`/api/unavailability/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/unavailability"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/unavailability/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/unavailability"] }),
  });

  return {
    unavailability: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    addUnavailability: (record: Omit<StaffUnavailability, "id">) => addMutation.mutateAsync(record),
    updateUnavailability: (id: string, data: Partial<Omit<StaffUnavailability, "id">>) =>
      updateMutation.mutateAsync({ id, data }),
    deleteUnavailability: (id: string) => deleteMutation.mutateAsync(id),
  };
}

// --- Call Availability ---

export function useCallAvailability() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAuthenticated = !!user;

  const query = useQuery<CallAvailability[]>({
    queryKey: ["/api/call-availability"],
    queryFn: () => apiFetch("/api/call-availability"),
    enabled: isAuthenticated,
    refetchInterval: isAuthenticated ? POLL_INTERVAL : false,
  });

  const addMutation = useMutation({
    mutationFn: (record: Omit<CallAvailability, "id">) =>
      apiFetch<CallAvailability>("/api/call-availability", {
        method: "POST",
        body: JSON.stringify(record),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/call-availability"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/call-availability/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/call-availability"] }),
  });

  return {
    callAvailability: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    addCallAvailability: (record: Omit<CallAvailability, "id">) => addMutation.mutateAsync(record),
    deleteCallAvailability: (id: string) => deleteMutation.mutateAsync(id),
  };
}

// --- Shift Distribution Log ---

export function useShiftDistributionLog() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAuthenticated = !!user;

  const query = useQuery<ShiftDistributionLog[]>({
    queryKey: ["/api/shift-distribution"],
    queryFn: () => apiFetch("/api/shift-distribution"),
    enabled: isAuthenticated,
    refetchInterval: isAuthenticated ? POLL_INTERVAL : false,
  });

  const addMutation = useMutation({
    mutationFn: (log: Omit<ShiftDistributionLog, "id">) =>
      apiFetch<ShiftDistributionLog>("/api/shift-distribution", {
        method: "POST",
        body: JSON.stringify(log),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/shift-distribution"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/shift-distribution/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/shift-distribution"] }),
  });

  return {
    shiftLog: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    addShiftLog: (log: Omit<ShiftDistributionLog, "id">) => addMutation.mutateAsync(log),
    deleteShiftLog: (id: string) => deleteMutation.mutateAsync(id),
  };
}

// Helper: Is a specific staff member unavailable on a given date?
// Respects excluded dates (individual days cancelled within a range)
export function isStaffUnavailable(
  unavailability: StaffUnavailability[],
  staffId: string,
  date: string
): StaffUnavailability | undefined {
  return unavailability.find(u =>
    u.staffId === staffId &&
    date >= u.startDate &&
    date <= u.endDate &&
    !(u.excludedDates ?? []).includes(date)
  );
}

// --- Provider Schedules ---

export function useProviderSchedules(startDate: string, endDate: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAuthenticated = !!user;

  const query = useQuery<ProviderSchedule[]>({
    queryKey: ["/api/schedules", startDate, endDate],
    queryFn: () => apiFetch(`/api/schedules?start=${startDate}&end=${endDate}`),
    enabled: isAuthenticated && !!startDate && !!endDate,
    staleTime: 30_000,
    refetchInterval: isAuthenticated ? POLL_INTERVAL : false,
  });

  const saveMutation = useMutation({
    mutationFn: (data: { providerId: string; date: string; am: string; pm: string }) =>
      apiFetch<ProviderSchedule>("/api/schedules", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/schedules"] }),
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
    },
  });

  return {
    schedules: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    saveSchedule: saveMutation.mutateAsync,
  };
}

// --- Special Clinics ---

export function useClinics() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAuthenticated = !!user;

  const clinicsQuery = useQuery<SpecialClinic[]>({
    queryKey: ["/api/clinics"],
    queryFn: () => apiFetch("/api/clinics"),
    enabled: isAuthenticated,
    refetchInterval: isAuthenticated ? POLL_INTERVAL : false,
  });

  const overridesQuery = useQuery<ClinicDayOverride[]>({
    queryKey: ["/api/clinic-overrides"],
    queryFn: () => apiFetch("/api/clinic-overrides"),
    enabled: isAuthenticated,
    refetchInterval: isAuthenticated ? POLL_INTERVAL : false,
  });

  const assignmentsQuery = useQuery<ClinicAssignment[]>({
    queryKey: ["/api/clinic-assignments"],
    queryFn: () => apiFetch("/api/clinic-assignments"),
    enabled: isAuthenticated,
    refetchInterval: isAuthenticated ? POLL_INTERVAL : false,
  });

  const createClinicMutation = useMutation({
    mutationFn: (clinic: Omit<SpecialClinic, "id">) =>
      apiFetch<SpecialClinic>("/api/clinics", { method: "POST", body: JSON.stringify(clinic) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/clinics"] }),
  });

  const updateClinicMutation = useMutation({
    mutationFn: ({ id, ...data }: Partial<SpecialClinic> & { id: string }) =>
      apiFetch<SpecialClinic>(`/api/clinics/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/clinics"] }),
  });

  const deleteClinicMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/clinics/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/clinics"] }),
  });

  const addOverrideMutation = useMutation({
    mutationFn: (override: Omit<ClinicDayOverride, "id">) =>
      apiFetch<ClinicDayOverride>("/api/clinic-overrides", { method: "POST", body: JSON.stringify(override) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/clinic-overrides"] }),
  });

  const deleteOverrideMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/clinic-overrides/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/clinic-overrides"] }),
  });

  const addAssignmentMutation = useMutation({
    mutationFn: (assignment: Omit<ClinicAssignment, "id">) =>
      apiFetch<ClinicAssignment>("/api/clinic-assignments", { method: "POST", body: JSON.stringify(assignment) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coverage"] });
    },
  });

  const deleteAssignmentMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/clinic-assignments/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coverage"] });
    },
  });

  return {
    clinics: clinicsQuery.data ?? [],
    overrides: overridesQuery.data ?? [],
    assignments: assignmentsQuery.data ?? [],
    isLoading: clinicsQuery.isLoading || overridesQuery.isLoading || assignmentsQuery.isLoading,
    isError: clinicsQuery.isError || overridesQuery.isError || assignmentsQuery.isError,
    refetch: () => {
      clinicsQuery.refetch();
      overridesQuery.refetch();
      assignmentsQuery.refetch();
    },
    createClinic: (c: Omit<SpecialClinic, "id">) => createClinicMutation.mutateAsync(c),
    updateClinic: (c: Partial<SpecialClinic> & { id: string }) => updateClinicMutation.mutateAsync(c),
    deleteClinic: (id: string) => deleteClinicMutation.mutateAsync(id),
    addOverride: (o: Omit<ClinicDayOverride, "id">) => addOverrideMutation.mutateAsync(o),
    deleteOverride: (id: string) => deleteOverrideMutation.mutateAsync(id),
    addAssignment: (a: Omit<ClinicAssignment, "id">) => addAssignmentMutation.mutateAsync(a),
    deleteAssignment: (id: string) => deleteAssignmentMutation.mutateAsync(id),
  };
}

// Helper: Is a clinic running on a given date?
export function isClinicOpen(
  clinic: SpecialClinic,
  overrides: ClinicDayOverride[],
  date: string
): boolean {
  if (!clinic.isActive) return false;
  if (date < clinic.startDate || date > clinic.endDate) return false;
  // Use parseISO to avoid timezone issues — split the date string directly
  const [year, month, day] = date.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  const dayOfWeek = d.getDay();
  // JSONB may return number[] or string[] — normalise to Number
  const daysOfWeek = ((clinic.daysOfWeek as unknown[]) ?? []).map(Number);
  if (!daysOfWeek.includes(dayOfWeek)) return false;
  const override = overrides.find(o => o.clinicId === clinic.id && o.date === date);
  if (override && override.isClosed) return false;
  return true;
}

// Helper: Is a staff member eligible for a specific clinic (cross-trained or primary specialty matches)?
export function isStaffEligibleForClinic(
  staffMember: StaffMember,
  clinicName: string
): boolean {
  // Primary specialty matches the clinic name
  if (staffMember.specialty === clinicName) return true;
  // Cross-trained for this clinic area
  if ((staffMember.crossTrained ?? []).includes(clinicName as StaffMember["specialty"])) return true;
  return false;
}

/**
 * Returns the clinic assignment that blocks this staff member on the given date/shift,
 * or undefined if there's no conflict.
 * Pass excludeClinicId to ignore assignments belonging to the same clinic
 * (e.g. when editing an existing assignment).
 */
export function getLvnClinicConflict(
  staffId: string,
  date: string,
  shift: 'AM' | 'PM' | 'Full',
  assignments: ClinicAssignment[],
  excludeClinicId?: string
): ClinicAssignment | undefined {
  return assignments.find(a =>
    a.staffId === staffId &&
    a.date === date &&
    (!excludeClinicId || a.clinicId !== excludeClinicId) &&
    shiftsOverlap(a.shift as 'AM' | 'PM' | 'Full', shift)
  );
}

// ── Shared LVN busy-check utilities ──────────────────────────────────────────

export interface LvnBusyStatus {
  busy: boolean;
  /** Whether the conflict is a clinic assignment, a coverage record, or none */
  reason: 'clinic' | 'coverage' | null;
  /** Human-readable detail, e.g. "Flu Clinic (AM)" or "Coverage assigned" */
  detail: string | null;
}

/**
 * Single source of truth for whether an LVN is already committed on a given date/shift.
 * Checks clinic assignments (shift-aware) first, then optional coverage records.
 * Used consistently across Clinics, Rotations, and Schedule pages.
 */
export function isLvnBusyOnShift(
  staffId: string,
  date: string,
  shift: 'AM' | 'PM' | 'Full',
  context: {
    clinicAssignments: ClinicAssignment[];
    coverageRecords?: CoverageRecord[];
    excludeClinicId?: string;
  }
): LvnBusyStatus {
  const clinicConflict = getLvnClinicConflict(
    staffId, date, shift, context.clinicAssignments, context.excludeClinicId
  );
  if (clinicConflict) {
    return {
      busy: true,
      reason: 'clinic',
      detail: `${clinicConflict.clinicName} (${clinicConflict.shift})`,
    };
  }
  if (context.coverageRecords) {
    const coverageConflict = context.coverageRecords.find(
      r => r.staffId === staffId && r.date === date
    );
    if (coverageConflict) {
      return { busy: true, reason: 'coverage', detail: 'Coverage assigned' };
    }
  }
  return { busy: false, reason: null, detail: null };
}

// ── Provider schedule status helpers ─────────────────────────────────────────

export type ProviderShiftStatus = 'Patient Care' | 'Admin' | 'Off' | 'Meeting';

export interface LvnProviderStatus {
  providerId: string | null;
  providerName: string | null;
  /** Provider's AM status on the date */
  am: ProviderShiftStatus;
  /** Provider's PM status on the date */
  pm: ProviderShiftStatus;
  /** True if provider has Patient Care for at least one half of the day */
  hasPatientCare: boolean;
  /** True if the provider has NO Patient Care all day (Off/Admin/Meeting for both halves) */
  providerFree: boolean;
}

/**
 * Returns the schedule status of an LVN's assigned provider on a given date.
 * Looks up persisted schedule records from the DB; falls back to weekday=Patient Care /
 * weekend=Off when no explicit record exists.
 */
export function getLvnProviderStatus(
  lvn: StaffMember,
  date: string,
  context: {
    staff: StaffMember[];
    providerSchedules: ProviderSchedule[];
  }
): LvnProviderStatus {
  const assignedProviderIds = lvn.assignedTo ?? [];
  if (assignedProviderIds.length === 0) {
    // No provider assigned — assume Patient Care (conservative default)
    return {
      providerId: null,
      providerName: null,
      am: 'Patient Care',
      pm: 'Patient Care',
      hasPatientCare: true,
      providerFree: false,
    };
  }

  const dayOfWeek = new Date(date + 'T12:00:00').getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const defaultStatus: ProviderShiftStatus = isWeekend ? 'Off' : 'Patient Care';

  // Evaluate ALL assigned providers: worst-case wins (if any provider has Patient Care, LVN is needed)
  // Track actual resolved statuses per half-day
  let anyPatientCareAM = false;
  let anyPatientCarePM = false;
  let primaryProviderId = assignedProviderIds[0];
  // Track primary provider's real schedule for display
  let primaryAM: ProviderShiftStatus = defaultStatus;
  let primaryPM: ProviderShiftStatus = defaultStatus;

  for (let i = 0; i < assignedProviderIds.length; i++) {
    const pid = assignedProviderIds[i];
    const schedule = context.providerSchedules.find(s => s.providerId === pid && s.date === date);
    const am = (schedule?.am ?? defaultStatus) as ProviderShiftStatus;
    const pm = (schedule?.pm ?? defaultStatus) as ProviderShiftStatus;
    if (am === 'Patient Care') anyPatientCareAM = true;
    if (pm === 'Patient Care') anyPatientCarePM = true;
    if (i === 0) {
      primaryAM = am;
      primaryPM = pm;
    }
  }

  // Use the first assigned provider for display name (primary)
  const primaryProvider = context.staff.find(s => s.id === primaryProviderId); // eslint-disable-line
  const primaryProviderName = primaryProvider?.name ?? null;

  // Aggregate: if any provider has Patient Care on a half-day, report Patient Care for that half.
  // Otherwise use primary provider's actual schedule status for that half.
  const aggregateAM: ProviderShiftStatus = anyPatientCareAM ? 'Patient Care' : primaryAM;
  const aggregatePM: ProviderShiftStatus = anyPatientCarePM ? 'Patient Care' : primaryPM;

  return {
    providerId: primaryProviderId,
    providerName: assignedProviderIds.length > 1
      ? `${primaryProviderName ?? primaryProviderId} +${assignedProviderIds.length - 1}`
      : primaryProviderName,
    am: aggregateAM,
    pm: aggregatePM,
    hasPatientCare: anyPatientCareAM || anyPatientCarePM,
    providerFree: !anyPatientCareAM && !anyPatientCarePM,
  };
}

// --- RN Charge Assignments ---

export function useWeeklyRnAssignments(weekStart: string, weekEnd: string) {
  const { user } = useAuth();
  const isAuthenticated = !!user;
  const query = useQuery<RnAssignment[]>({
    queryKey: ["/api/rn-assignments", "week", weekStart, weekEnd],
    queryFn: () => apiFetch(`/api/rn-assignments?weekStart=${weekStart}&weekEnd=${weekEnd}`),
    enabled: isAuthenticated && !!weekStart && !!weekEnd,
    refetchInterval: isAuthenticated ? POLL_INTERVAL : false,
  });
  return { assignments: query.data ?? [], isLoading: query.isLoading, isError: query.isError, refetch: query.refetch };
}

export function useRnAssignments(date: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAuthenticated = !!user;

  const query = useQuery<RnAssignment[]>({
    queryKey: ["/api/rn-assignments", date],
    queryFn: () => apiFetch(`/api/rn-assignments?date=${date}`),
    enabled: isAuthenticated && !!date,
    refetchInterval: isAuthenticated ? POLL_INTERVAL : false,
  });

  const upsertMutation = useMutation({
    mutationFn: (data: InsertRnAssignment) =>
      apiFetch<RnAssignment>("/api/rn-assignments", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/rn-assignments", date] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ success: boolean }>(`/api/rn-assignments/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/rn-assignments", date] }),
  });

  return {
    assignments: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    upsertAssignment: upsertMutation.mutateAsync,
    deleteAssignment: deleteMutation.mutateAsync,
  };
}

// ── Floor Staffing Hooks ──────────────────────────────────────────────────────

export function useFloorUnits() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAuthenticated = !!user;

  const query = useQuery<FloorUnit[]>({
    queryKey: ["/api/floor/units"],
    queryFn: () => apiFetch("/api/floor/units"),
    enabled: isAuthenticated,
    refetchInterval: isAuthenticated ? POLL_INTERVAL : false,
  });

  const createMutation = useMutation({
    mutationFn: (data: InsertFloorUnit) =>
      apiFetch<FloorUnit>("/api/floor/units", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/floor/units"] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<InsertFloorUnit> }) =>
      apiFetch<FloorUnit>(`/api/floor/units/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/floor/units"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ success: boolean }>(`/api/floor/units/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/floor/units"] }),
  });

  return {
    units: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    createUnit: createMutation.mutateAsync,
    updateUnit: updateMutation.mutateAsync,
    deleteUnit: deleteMutation.mutateAsync,
  };
}

export function useFloorDailyRooms(unitId: string, date: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAuthenticated = !!user;

  const query = useQuery<FloorDailyRooms | null>({
    queryKey: ["/api/floor/daily-rooms", unitId, date],
    queryFn: () => apiFetch(`/api/floor/daily-rooms?unitId=${unitId}&date=${date}`),
    enabled: isAuthenticated && !!unitId && !!date,
    refetchInterval: isAuthenticated ? POLL_INTERVAL : false,
  });

  const upsertMutation = useMutation({
    mutationFn: (data: InsertFloorDailyRooms) =>
      apiFetch<FloorDailyRooms>("/api/floor/daily-rooms", { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/floor/daily-rooms", unitId, date] }),
  });

  return {
    dailyRooms: query.data ?? null,
    isLoading: query.isLoading,
    upsertDailyRooms: upsertMutation.mutateAsync,
  };
}

export function useFloorStaff() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAuthenticated = !!user;

  const query = useQuery<FloorStaffMember[]>({
    queryKey: ["/api/floor/staff"],
    queryFn: () => apiFetch("/api/floor/staff"),
    enabled: isAuthenticated,
    refetchInterval: isAuthenticated ? POLL_INTERVAL : false,
  });

  const createMutation = useMutation({
    mutationFn: (data: InsertFloorStaff) =>
      apiFetch<FloorStaffMember>("/api/floor/staff", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/floor/staff"] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<InsertFloorStaff> }) =>
      apiFetch<FloorStaffMember>(`/api/floor/staff/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/floor/staff"] }),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ success: boolean }>(`/api/floor/staff/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/floor/staff"] }),
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ success: boolean }>(`/api/floor/staff/${id}/reactivate`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/floor/staff"] }),
  });

  return {
    staff: (query.data ?? []).filter(s => s.isActive),
    allStaff: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    createStaff: createMutation.mutateAsync,
    updateStaff: updateMutation.mutateAsync,
    deactivateStaff: deactivateMutation.mutateAsync,
    reactivateStaff: reactivateMutation.mutateAsync,
  };
}

export function useFloorShiftAssignments(unitId: string, date: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAuthenticated = !!user;

  const query = useQuery<FloorShiftAssignment[]>({
    queryKey: ["/api/floor/assignments", unitId, date],
    queryFn: () => apiFetch(`/api/floor/assignments?unitId=${unitId}&date=${date}`),
    enabled: isAuthenticated && !!unitId && !!date,
    refetchInterval: isAuthenticated ? POLL_INTERVAL : false,
  });

  const upsertMutation = useMutation({
    mutationFn: (data: InsertFloorShiftAssignment) =>
      apiFetch<FloorShiftAssignment>("/api/floor/assignments", { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/floor/assignments", unitId, date] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ success: boolean }>(`/api/floor/assignments/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/floor/assignments", unitId, date] }),
  });

  const clearShiftMutation = useMutation({
    mutationFn: (shift: FloorShift) =>
      apiFetch<{ success: boolean }>("/api/floor/assignments", {
        method: "DELETE",
        body: JSON.stringify({ unitId, date, shift }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/floor/assignments", unitId, date] }),
  });

  return {
    assignments: query.data ?? [],
    isLoading: query.isLoading,
    refetch: query.refetch,
    upsertAssignment: upsertMutation.mutateAsync,
    deleteAssignment: deleteMutation.mutateAsync,
    clearShift: clearShiftMutation.mutateAsync,
  };
}

export function useFloorMonthlyAssignments(unitId: string, startDate: string, endDate: string) {
  const { user } = useAuth();
  const isAuthenticated = !!user;

  const query = useQuery<FloorShiftAssignment[]>({
    queryKey: ["/api/floor/assignments/monthly", unitId, startDate, endDate],
    queryFn: () => apiFetch(`/api/floor/assignments?unitId=${unitId}&startDate=${startDate}&endDate=${endDate}`),
    enabled: isAuthenticated && !!unitId && !!startDate && !!endDate,
    staleTime: 60_000,
  });

  return {
    monthlyAssignments: query.data ?? [],
    isLoading: query.isLoading,
  };
}

export function useFloorStaffWorkload(staffId: string, startDate: string, endDate: string) {
  const { user } = useAuth();
  const isAuthenticated = !!user;

  const query = useQuery<FloorShiftAssignment[]>({
    queryKey: ["/api/floor/assignments/staff", staffId, startDate, endDate],
    queryFn: () => apiFetch(`/api/floor/assignments?staffId=${staffId}&startDate=${startDate}&endDate=${endDate}`),
    enabled: isAuthenticated && !!staffId && !!startDate && !!endDate,
  });

  return {
    assignments: query.data ?? [],
    totalAcuityLoad: (query.data ?? []).reduce((sum, a) => sum + a.acuityLoad, 0),
    isLoading: query.isLoading,
  };
}

export function useFloorRoomAcuity(unitId: string, date: string, shift: FloorShift) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAuthenticated = !!user;

  const query = useQuery<FloorRoomAcuity[]>({
    queryKey: ["/api/floor/acuity", unitId, date, shift],
    queryFn: () => apiFetch(`/api/floor/acuity?unitId=${unitId}&date=${date}&shift=${shift}`),
    enabled: isAuthenticated && !!unitId && !!date && !!shift,
    refetchInterval: isAuthenticated ? POLL_INTERVAL : false,
  });

  const upsertMutation = useMutation({
    mutationFn: (data: InsertFloorRoomAcuity) =>
      apiFetch<FloorRoomAcuity>("/api/floor/acuity", { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/floor/acuity", unitId, date, shift] }),
  });

  return {
    acuityRecords: query.data ?? [],
    isLoading: query.isLoading,
    upsertAcuity: upsertMutation.mutateAsync,
  };
}

// Returns the shift's reports when authorized, null when the user is not authorized (403).
// Re-throws for genuine server errors (5xx, etc.) so React Query surfaces them normally.
async function fetchShiftReport(unitId: string, date: string, shift: FloorShift): Promise<FloorShiftReport[] | null> {
  try {
    return await apiFetch<FloorShiftReport[]>(`/api/floor/reports?unitId=${unitId}&date=${date}&shift=${shift}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) return null;
    throw err;
  }
}

export function useFloorShiftReport(unitId: string, date: string, shift: FloorShift) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAuthenticated = !!user;

  const query = useQuery<FloorShiftReport[] | null>({
    queryKey: ["/api/floor/reports", unitId, date, shift],
    queryFn: () => fetchShiftReport(unitId, date, shift),
    enabled: isAuthenticated && !!unitId && !!date,
    refetchInterval: isAuthenticated ? POLL_INTERVAL : false,
  });

  const upsertMutation = useMutation({
    mutationFn: (data: InsertFloorShiftReport) =>
      apiFetch<FloorShiftReport>("/api/floor/reports", { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/floor/reports", unitId, date, shift] }),
  });

  return {
    report: query.data?.[0] ?? null,
    // null means unauthorized, [] means no report written yet
    isUnauthorized: query.data === null,
    isLoading: query.isLoading,
    upsertReport: upsertMutation.mutateAsync,
  };
}

export function useFloorShiftReports(unitId: string, date: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAuthenticated = !!user;

  const dayQuery = useQuery<FloorShiftReport[] | null>({
    queryKey: ["/api/floor/reports", unitId, date, "day"],
    queryFn: () => fetchShiftReport(unitId, date, "day"),
    enabled: isAuthenticated && !!unitId && !!date,
    refetchInterval: isAuthenticated ? POLL_INTERVAL : false,
  });
  const eveningQuery = useQuery<FloorShiftReport[] | null>({
    queryKey: ["/api/floor/reports", unitId, date, "evening"],
    queryFn: () => fetchShiftReport(unitId, date, "evening"),
    enabled: isAuthenticated && !!unitId && !!date,
    refetchInterval: isAuthenticated ? POLL_INTERVAL : false,
  });
  const nightQuery = useQuery<FloorShiftReport[] | null>({
    queryKey: ["/api/floor/reports", unitId, date, "night"],
    queryFn: () => fetchShiftReport(unitId, date, "night"),
    enabled: isAuthenticated && !!unitId && !!date,
    refetchInterval: isAuthenticated ? POLL_INTERVAL : false,
  });

  const upsertMutation = useMutation({
    mutationFn: (data: InsertFloorShiftReport) =>
      apiFetch<FloorShiftReport>("/api/floor/reports", { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/floor/reports", unitId, date, vars.shift] });
    },
  });

  // Flatten authorized results; null (unauthorized) shifts contribute no reports.
  const allReports = [
    ...(dayQuery.data ?? []),
    ...(eveningQuery.data ?? []),
    ...(nightQuery.data ?? []),
  ];

  return {
    reports: allReports,
    isLoading: dayQuery.isLoading || eveningQuery.isLoading || nightQuery.isLoading,
    upsertReport: upsertMutation.mutateAsync,
  };
}

export function useUsers() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const query = useQuery<PublicUser[]>({
    queryKey: ["/api/auth/users"],
    queryFn: () => apiFetch("/api/auth/users"),
    enabled: isAdmin,
  });

  return {
    users: query.data ?? [],
    isLoading: query.isLoading,
  };
}
