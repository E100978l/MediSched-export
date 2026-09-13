import { sql } from "drizzle-orm";
import { pgTable, text, varchar, jsonb, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Provider specialties
export const PROVIDER_SPECIALTIES = [
  'Internal/Family Med (Met Home 1)',
  'Internal/Family Med (Met Home 2)',
  'OB/GYN',
  'Pediatrics',
  'Allergy',
  'Optometry',
  'Diabetic Education',
] as const;

// Clinic / support areas that LVNs can be cross-trained for
export const CLINIC_AREAS = [
  'Retinal AI',
  'Flu Clinic',
  'Nurse Visits',
] as const;

// All valid specialty/area values (used for crossTrained)
export const SPECIALTIES = [...PROVIDER_SPECIALTIES, ...CLINIC_AREAS] as const;

export type ProviderSpecialty = typeof PROVIDER_SPECIALTIES[number];
export type ClinicArea = typeof CLINIC_AREAS[number];
export type Specialty = typeof SPECIALTIES[number];
export type StaffType = 'MD' | 'DO' | 'NP' | 'PA' | 'LVN' | 'RN' | 'Pharmacist';

// Specialties where all providers share a single LVN pool
// (key = specialty name, value = total LVNs needed for the whole group)
export const SHARED_LVN_SPECIALTIES: Partial<Record<Specialty, number>> = {
  'Diabetic Education': 1,
};

export const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Per Diem', 'Extra Help'] as const;
export type EmploymentType = typeof EMPLOYMENT_TYPES[number];

// Preferential order for additional shift assignment (index 0 = highest priority)
export const EMPLOYMENT_PRIORITY: Record<EmploymentType, number> = {
  'Full-time': 0,
  'Part-time': 1,
  'Per Diem': 2,
  'Extra Help': 3,
};

export const staffMembers = pgTable("staff_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  role: text("role").notNull().$type<StaffType>(),
  specialty: text("specialty").notNull().$type<Specialty>(),
  crossTrained: jsonb("cross_trained").$type<Specialty[]>().default([]),
  assignedTo: jsonb("assigned_to").$type<string[]>().default([]),
  isFloatPool: boolean("is_float_pool").default(false),
  // For providers: how many LVNs they need (1 for NP/PA, 2 for some MDs like OB/GYN)
  lvnsRequired: integer("lvns_required").default(1),
  // Contact info (optional)
  phone: text("phone").default(""),
  email: text("email").default(""),
  // Employment classification (used for shift prioritization)
  employmentType: text("employment_type").default("Full-time").$type<EmploymentType>(),
  // For RNs: which RN_POSITIONS entry this person is the permanent/default charge RN for (null = not a default charge RN)
  defaultChargePositionId: text("default_charge_position_id"),
  // Soft delete: false = no longer working, history preserved
  isActive: boolean("is_active").default(true).notNull(),
});

export const insertStaffMemberSchema = createInsertSchema(staffMembers).omit({ id: true });
export type InsertStaffMember = z.infer<typeof insertStaffMemberSchema>;
export type StaffMember = typeof staffMembers.$inferSelect;

export const coverageRecords = pgTable("coverage_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: text("date").notNull(),
  staffId: varchar("staff_id").notNull(),
  staffName: text("staff_name").notNull(),
  originalSpecialty: text("original_specialty").notNull(),
  coveredSpecialty: text("covered_specialty").notNull(),
  providerId: varchar("provider_id").notNull(),
  providerName: text("provider_name").notNull(),
});

export const insertCoverageRecordSchema = createInsertSchema(coverageRecords).omit({ id: true });
export type InsertCoverageRecord = z.infer<typeof insertCoverageRecordSchema>;
export type CoverageRecord = typeof coverageRecords.$inferSelect;

export const providerSchedules = pgTable("provider_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  providerId: varchar("provider_id").notNull(),
  date: text("date").notNull(),
  am: text("am").notNull().default('Patient Care').$type<'Patient Care' | 'Admin' | 'Off' | 'Meeting'>(),
  pm: text("pm").notNull().default('Patient Care').$type<'Patient Care' | 'Admin' | 'Off' | 'Meeting'>(),
});

export const insertProviderScheduleSchema = createInsertSchema(providerSchedules).omit({ id: true });
export type InsertProviderSchedule = z.infer<typeof insertProviderScheduleSchema>;
export type ProviderSchedule = typeof providerSchedules.$inferSelect;

export const staffUnavailability = pgTable("staff_unavailability", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  staffId: varchar("staff_id").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  type: text("type").notNull().$type<'Vacation' | 'Sick' | 'FMLA' | 'Leave'>(),
  note: text("note").default(""),
  // Individual days within the range that have been cancelled/excluded
  excludedDates: jsonb("excluded_dates").$type<string[]>().default([]),
});

export const insertStaffUnavailabilitySchema = createInsertSchema(staffUnavailability).omit({ id: true });
export type InsertStaffUnavailability = z.infer<typeof insertStaffUnavailabilitySchema>;
export type StaffUnavailability = typeof staffUnavailability.$inferSelect;

// Special clinic definitions
export const CLINIC_NAMES = [
  'Nurse Visits',
  'Retinal AI',
  'Diabetic Education',
  'Flu Clinic',
] as const;
export type ClinicName = typeof CLINIC_NAMES[number];

export const specialClinics = pgTable("special_clinics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  daysOfWeek: jsonb("days_of_week").$type<number[]>().default([1,2,3,4,5]),
  startTime: text("start_time").notNull().default("08:00"),
  endTime: text("end_time").notNull().default("17:00"),
  staffNeeded: integer("staff_needed").notNull().default(1),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  isActive: boolean("is_active").default(true),
  color: text("color").default("blue"),
});

export const insertSpecialClinicSchema = createInsertSchema(specialClinics).omit({ id: true });
export type InsertSpecialClinic = z.infer<typeof insertSpecialClinicSchema>;
export type SpecialClinic = typeof specialClinics.$inferSelect;

export const clinicDayOverrides = pgTable("clinic_day_overrides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clinicId: varchar("clinic_id").notNull(),
  date: text("date").notNull(),
  isClosed: boolean("is_closed").notNull().default(true),
  note: text("note").default(""),
});

export const insertClinicDayOverrideSchema = createInsertSchema(clinicDayOverrides).omit({ id: true });
export type InsertClinicDayOverride = z.infer<typeof insertClinicDayOverrideSchema>;
export type ClinicDayOverride = typeof clinicDayOverrides.$inferSelect;

export const clinicAssignments = pgTable("clinic_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clinicId: varchar("clinic_id").notNull(),
  clinicName: text("clinic_name").notNull(),
  date: text("date").notNull(),
  staffId: varchar("staff_id").notNull(),
  staffName: text("staff_name").notNull(),
  staffRole: text("staff_role").notNull(),
  shift: text("shift").notNull().default("Full").$type<'AM' | 'PM' | 'Full'>(),
});

export const insertClinicAssignmentSchema = createInsertSchema(clinicAssignments).omit({ id: true });
export type InsertClinicAssignment = z.infer<typeof insertClinicAssignmentSchema>;
export type ClinicAssignment = typeof clinicAssignments.$inferSelect;

// Call availability — staff proactively register dates they can provide coverage
export const callAvailability = pgTable("call_availability", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  staffId: varchar("staff_id").notNull(),
  staffName: text("staff_name").notNull(),
  availableDate: text("available_date").notNull(),
  shift: text("shift").notNull().default("Full").$type<'AM' | 'PM' | 'Full'>(),
  note: text("note").default(""),
});

export const insertCallAvailabilitySchema = createInsertSchema(callAvailability).omit({ id: true });
export type InsertCallAvailability = z.infer<typeof insertCallAvailabilitySchema>;
export type CallAvailability = typeof callAvailability.$inferSelect;

// Shift distribution log — tracks extra/per diem/part-time shift assignments for equity tracking
export const shiftDistributionLog = pgTable("shift_distribution_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  staffId: varchar("staff_id").notNull(),
  staffName: text("staff_name").notNull(),
  staffRole: text("staff_role").notNull(),
  employmentType: text("employment_type").notNull().$type<EmploymentType>(),
  assignedDate: text("assigned_date").notNull(),
  shift: text("shift").notNull().default("Full").$type<'AM' | 'PM' | 'Full'>(),
  context: text("context").default(""), // e.g. "Coverage for Pediatrics" or "Retinal AI Clinic"
  note: text("note").default(""),
  loggedAt: text("logged_at").notNull(), // ISO timestamp string
});

export const insertShiftDistributionLogSchema = createInsertSchema(shiftDistributionLog).omit({ id: true });
export type InsertShiftDistributionLog = z.infer<typeof insertShiftDistributionLogSchema>;
export type ShiftDistributionLog = typeof shiftDistributionLog.$inferSelect;

// ── RN Charge Positions ───────────────────────────────────────────────────────
// Four fixed daily charge/floor nurse positions
export const RN_POSITIONS = [
  {
    id: 'charge-med-home-1',
    label: 'Charge RN — Med Home 1',
    areas: ['Internal/Family Med (Met Home 1)'],
    note: 'May cover both Med Home units when needed',
    mergeGroup: 'med-home',
    mergeLabel: 'Covering both Med Home units',
    headerBg: '#1d4ed8',
    bg: '#dbeafe',
  },
  {
    id: 'charge-med-home-2',
    label: 'Charge RN — Med Home 2',
    areas: ['Internal/Family Med (Met Home 2)'],
    note: 'May cover both Med Home units when needed',
    mergeGroup: 'med-home',
    mergeLabel: 'Covering both Med Home units',
    headerBg: '#15803d',
    bg: '#dcfce7',
  },
  {
    id: 'charge-ob-peds',
    label: 'Charge RN — OB/GYN & Pediatrics',
    areas: ['OB/GYN', 'Pediatrics'],
    note: 'May combine with Floor RN to cover full floor',
    mergeGroup: 'floor',
    mergeLabel: 'One nurse covering full floor + Allergy/DE/Retinal AI',
    headerBg: '#be185d',
    bg: '#fce7f3',
  },
  {
    id: 'floor-allergy-peds',
    label: 'Floor RN — Allergy & Peds Assist',
    areas: ['Allergy', 'Pediatrics (assist)'],
    supervisedAreas: ['Allergy', 'Diabetic Education', 'Retinal AI'],
    note: 'Supervises Allergy, Diabetic Education, and Retinal AI',
    mergeGroup: 'floor',
    mergeLabel: 'One nurse covering full floor + Allergy/DE/Retinal AI',
    headerBg: '#c2410c',
    bg: '#ffedd5',
  },
] as const;

export type RnPositionId = typeof RN_POSITIONS[number]['id'];

export const rnAssignments = pgTable("rn_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: text("date").notNull(),
  positionId: text("position_id").notNull().$type<RnPositionId>(),
  rnId: varchar("rn_id").notNull(),
  rnName: text("rn_name").notNull(),
  note: text("note").default(""),
});

export const insertRnAssignmentSchema = createInsertSchema(rnAssignments).omit({ id: true });
export type InsertRnAssignment = z.infer<typeof insertRnAssignmentSchema>;
export type RnAssignment = typeof rnAssignments.$inferSelect;

export const USER_ROLES = ['admin', 'user'] as const;
export type UserRole = typeof USER_ROLES[number];

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default('user').$type<UserRole>(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export const registerUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['admin', 'user']).default('user'),
});
export type RegisterUser = z.infer<typeof registerUserSchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type PublicUser = Omit<User, 'passwordHash'>;

// ── Shift conflict helpers (used on both frontend and backend) ───────────────

/**
 * Returns true if two clinic shifts overlap in time.
 * 'Full' overlaps everything; 'AM' overlaps AM/Full; 'PM' overlaps PM/Full.
 */
export function shiftsOverlap(
  shiftA: 'AM' | 'PM' | 'Full',
  shiftB: 'AM' | 'PM' | 'Full'
): boolean {
  if (shiftA === 'Full' || shiftB === 'Full') return true;
  return shiftA === shiftB;
}

// ── Floor Staffing Module ─────────────────────────────────────────────────────

export const FLOOR_SHIFTS = ['day', 'evening', 'night'] as const;
export type FloorShift = typeof FLOOR_SHIFTS[number];

export const FLOOR_SHIFT_LABELS: Record<FloorShift, string> = {
  day: '7 AM – 3 PM',
  evening: '3 PM – 11 PM',
  night: '11 PM – 7 AM',
};

export const FLOOR_ROLES = ['RN', 'LVN', 'CNA'] as const;
export type FloorRole = typeof FLOOR_ROLES[number];

export const FLOOR_SHIFT_PREFS = ['day', 'evening', 'night', 'any'] as const;
export type FloorShiftPref = typeof FLOOR_SHIFT_PREFS[number];

export const ACUITY_LEVELS = [1, 2, 3] as const;
export type AcuityLevel = typeof ACUITY_LEVELS[number];

// Floor units (e.g., "3 West", "4 North")
export const floorUnits = pgTable("floor_units", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  roomStart: integer("room_start").notNull(),
  roomEnd: integer("room_end").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
});

export const insertFloorUnitSchema = createInsertSchema(floorUnits).omit({ id: true });
export type InsertFloorUnit = z.infer<typeof insertFloorUnitSchema>;
export type FloorUnit = typeof floorUnits.$inferSelect;

// Open rooms per unit per day
export const floorDailyRooms = pgTable("floor_daily_rooms", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  unitId: varchar("unit_id").notNull(),
  date: text("date").notNull(),
  openRoomCount: integer("open_room_count").notNull().default(0),
});

export const insertFloorDailyRoomsSchema = createInsertSchema(floorDailyRooms).omit({ id: true });
export type InsertFloorDailyRooms = z.infer<typeof insertFloorDailyRoomsSchema>;
export type FloorDailyRooms = typeof floorDailyRooms.$inferSelect;

// Floor staff roster (separate from outpatient staff)
export const floorStaff = pgTable("floor_staff", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  role: text("role").notNull().$type<FloorRole>(),
  shiftPreference: text("shift_preference").notNull().default('any').$type<FloorShiftPref>(),
  employmentType: text("employment_type").notNull().default('Full-time').$type<EmploymentType>(),
  phone: text("phone").default(""),
  email: text("email").default(""),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  isActive: boolean("is_active").default(true).notNull(),
});

export const insertFloorStaffSchema = createInsertSchema(floorStaff).omit({ id: true });
export type InsertFloorStaff = z.infer<typeof insertFloorStaffSchema>;
export type FloorStaffMember = typeof floorStaff.$inferSelect;

// Shift assignments: staff_id + date + shift + rooms + acuity-weighted load
export const floorShiftAssignments = pgTable("floor_shift_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  staffId: varchar("staff_id").notNull(),
  unitId: varchar("unit_id").notNull(),
  date: text("date").notNull(),
  shift: text("shift").notNull().$type<FloorShift>(),
  rooms: jsonb("rooms").$type<number[]>().default([]),
  acuityLoad: integer("acuity_load").notNull().default(0),
  isChargeRn: boolean("is_charge_rn").default(false).notNull(),
});

export const insertFloorShiftAssignmentSchema = createInsertSchema(floorShiftAssignments).omit({ id: true });
export type InsertFloorShiftAssignment = z.infer<typeof insertFloorShiftAssignmentSchema>;
export type FloorShiftAssignment = typeof floorShiftAssignments.$inferSelect;

// Per-room acuity levels per unit+date+shift
export const floorRoomAcuity = pgTable("floor_room_acuity", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  unitId: varchar("unit_id").notNull(),
  date: text("date").notNull(),
  shift: text("shift").notNull().$type<FloorShift>(),
  roomNumber: integer("room_number").notNull(),
  acuityLevel: integer("acuity_level").notNull().default(1).$type<AcuityLevel>(),
});

export const insertFloorRoomAcuitySchema = createInsertSchema(floorRoomAcuity).omit({ id: true });
export type InsertFloorRoomAcuity = z.infer<typeof insertFloorRoomAcuitySchema>;
export type FloorRoomAcuity = typeof floorRoomAcuity.$inferSelect;

// Shift handoff reports
export const floorShiftReports = pgTable("floor_shift_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  unitId: varchar("unit_id").notNull(),
  date: text("date").notNull(),
  shift: text("shift").notNull().$type<FloorShift>(),
  chargeRnId: varchar("charge_rn_id").notNull(),
  chargeRnName: text("charge_rn_name").notNull(),
  roomNotes: jsonb("room_notes").$type<Array<{ room: number; note: string; acuity: AcuityLevel }>>().default([]),
  shiftSummary: text("shift_summary").default(""),
  huddleTopics: text("huddle_topics").default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertFloorShiftReportSchema = createInsertSchema(floorShiftReports).omit({ id: true });
export type InsertFloorShiftReport = z.infer<typeof insertFloorShiftReportSchema>;
export type FloorShiftReport = typeof floorShiftReports.$inferSelect;
