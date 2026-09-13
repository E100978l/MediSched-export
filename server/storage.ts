import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import { db } from "./db";
import {
  staffMembers, coverageRecords, providerSchedules, staffUnavailability, users,
  specialClinics, clinicDayOverrides, clinicAssignments, callAvailability, shiftDistributionLog,
  rnAssignments,
  floorUnits, floorDailyRooms, floorStaff, floorShiftAssignments, floorRoomAcuity, floorShiftReports,
  type StaffMember, type InsertStaffMember,
  type CoverageRecord, type InsertCoverageRecord,
  type ProviderSchedule, type InsertProviderSchedule,
  type StaffUnavailability, type InsertStaffUnavailability,
  type User, type InsertUser, type PublicUser, type UserRole,
  type SpecialClinic, type InsertSpecialClinic,
  type ClinicDayOverride, type InsertClinicDayOverride,
  type ClinicAssignment, type InsertClinicAssignment,
  type CallAvailability, type InsertCallAvailability,
  type ShiftDistributionLog, type InsertShiftDistributionLog,
  type RnAssignment, type InsertRnAssignment, type RnPositionId,
  type FloorUnit, type InsertFloorUnit,
  type FloorDailyRooms, type InsertFloorDailyRooms,
  type FloorStaffMember, type InsertFloorStaff,
  type FloorShiftAssignment, type InsertFloorShiftAssignment,
  type FloorRoomAcuity, type InsertFloorRoomAcuity,
  type FloorShiftReport, type InsertFloorShiftReport,
  type FloorShift,
} from "@shared/schema";

export interface IStorage {
  // Staff
  getAllStaff(): Promise<StaffMember[]>;
  getAllStaffIncludingInactive(): Promise<StaffMember[]>;
  getStaffById(id: string): Promise<StaffMember | undefined>;
  createStaffMember(member: InsertStaffMember): Promise<StaffMember>;
  updateStaffMember(id: string, member: Partial<InsertStaffMember>): Promise<StaffMember | undefined>;
  deactivateStaffMember(id: string): Promise<boolean>;
  reactivateStaffMember(id: string): Promise<boolean>;

  // Coverage
  getAllCoverageRecords(): Promise<CoverageRecord[]>;
  getCoverageForDate(date: string): Promise<CoverageRecord[]>;
  createCoverageRecord(record: InsertCoverageRecord): Promise<CoverageRecord>;
  deleteCoverageRecord(id: string): Promise<boolean>;

  // Schedules
  getSchedule(providerId: string, date: string): Promise<ProviderSchedule | undefined>;
  upsertSchedule(schedule: InsertProviderSchedule): Promise<ProviderSchedule>;
  getSchedulesForDateRange(startDate: string, endDate: string): Promise<ProviderSchedule[]>;

  // Unavailability
  getAllUnavailability(): Promise<StaffUnavailability[]>;
  getUnavailabilityForStaff(staffId: string): Promise<StaffUnavailability[]>;
  createUnavailability(record: InsertStaffUnavailability): Promise<StaffUnavailability>;
  updateUnavailability(id: string, data: Partial<InsertStaffUnavailability>): Promise<StaffUnavailability | undefined>;
  deleteUnavailability(id: string): Promise<boolean>;

  // Special Clinics
  getAllClinics(): Promise<SpecialClinic[]>;
  getClinicById(id: string): Promise<SpecialClinic | undefined>;
  createClinic(clinic: InsertSpecialClinic): Promise<SpecialClinic>;
  updateClinic(id: string, clinic: Partial<InsertSpecialClinic>): Promise<SpecialClinic | undefined>;
  deleteClinic(id: string): Promise<boolean>;

  // Clinic Day Overrides
  getAllClinicOverrides(): Promise<ClinicDayOverride[]>;
  getOverridesForClinic(clinicId: string): Promise<ClinicDayOverride[]>;
  createClinicOverride(override: InsertClinicDayOverride): Promise<ClinicDayOverride>;
  deleteClinicOverride(id: string): Promise<boolean>;
  deleteClinicOverrideByDate(clinicId: string, date: string): Promise<boolean>;

  // Clinic Assignments
  getAllClinicAssignments(): Promise<ClinicAssignment[]>;
  getAssignmentsForClinic(clinicId: string): Promise<ClinicAssignment[]>;
  getAssignmentsForDate(date: string): Promise<ClinicAssignment[]>;
  createClinicAssignment(assignment: InsertClinicAssignment): Promise<ClinicAssignment>;
  deleteClinicAssignment(id: string): Promise<boolean>;
  deleteClinicAssignmentsForDate(clinicId: string, date: string): Promise<number>;

  // Call Availability
  getAllCallAvailability(): Promise<CallAvailability[]>;
  getCallAvailabilityForDate(date: string): Promise<CallAvailability[]>;
  createCallAvailability(record: InsertCallAvailability): Promise<CallAvailability>;
  deleteCallAvailability(id: string): Promise<boolean>;

  // Shift Distribution Log
  getAllShiftDistributionLogs(): Promise<ShiftDistributionLog[]>;
  createShiftDistributionLog(log: InsertShiftDistributionLog): Promise<ShiftDistributionLog>;
  deleteShiftDistributionLog(id: string): Promise<boolean>;

  // RN Charge Assignments
  getRnAssignmentsForDate(date: string): Promise<RnAssignment[]>;
  getRnAssignmentsForRange(start: string, end: string): Promise<RnAssignment[]>;
  upsertRnAssignment(data: InsertRnAssignment): Promise<RnAssignment>;
  deleteRnAssignment(id: string): Promise<boolean>;

  // Admin: schedule reset (clears all scheduling data, preserves staff + users + clinic defs)
  resetScheduleData(startDate?: string, endDate?: string): Promise<{ cleared: string[] }>;

  // Admin: remove clinic_assignments whose clinic no longer exists in special_clinics
  cleanupOrphanedClinicAssignments(): Promise<{ deleted: number }>;
  cleanupDuplicateStaff(): Promise<{ deactivated: number; names: string[] }>;

  // Floor Units
  getAllFloorUnits(): Promise<FloorUnit[]>;
  getFloorUnitById(id: string): Promise<FloorUnit | undefined>;
  createFloorUnit(unit: InsertFloorUnit): Promise<FloorUnit>;
  updateFloorUnit(id: string, unit: Partial<InsertFloorUnit>): Promise<FloorUnit | undefined>;
  deleteFloorUnit(id: string): Promise<boolean>;

  // Floor Daily Rooms
  getFloorDailyRooms(unitId: string, date: string): Promise<FloorDailyRooms | undefined>;
  upsertFloorDailyRooms(data: InsertFloorDailyRooms): Promise<FloorDailyRooms>;
  deleteFloorDailyRooms(unitId: string, date: string): Promise<void>;

  // Floor Staff
  getAllFloorStaff(): Promise<FloorStaffMember[]>;
  getFloorStaffById(id: string): Promise<FloorStaffMember | undefined>;
  createFloorStaffMember(member: InsertFloorStaff): Promise<FloorStaffMember>;
  updateFloorStaffMember(id: string, member: Partial<InsertFloorStaff>): Promise<FloorStaffMember | undefined>;
  deactivateFloorStaffMember(id: string): Promise<boolean>;
  reactivateFloorStaffMember(id: string): Promise<boolean>;

  // Floor Shift Assignments
  getFloorShiftAssignments(unitId: string, date: string): Promise<FloorShiftAssignment[]>;
  getFloorShiftAssignmentsForStaff(staffId: string, startDate: string, endDate: string): Promise<FloorShiftAssignment[]>;
  getFloorShiftAssignmentsByUnitDateRange(unitId: string, startDate: string, endDate: string): Promise<FloorShiftAssignment[]>;
  upsertFloorShiftAssignment(data: InsertFloorShiftAssignment): Promise<FloorShiftAssignment>;
  deleteFloorShiftAssignment(id: string): Promise<boolean>;
  deleteFloorShiftAssignmentsForDateShift(unitId: string, date: string, shift: FloorShift): Promise<number>;

  // Floor Room Acuity
  getFloorRoomAcuity(unitId: string, date: string, shift: FloorShift): Promise<FloorRoomAcuity[]>;
  upsertFloorRoomAcuity(data: InsertFloorRoomAcuity): Promise<FloorRoomAcuity>;
  deleteFloorRoomAcuity(id: string): Promise<boolean>;
  deleteFloorRoomAcuityByShift(unitId: string, date: string, shift: FloorShift): Promise<number>;

  // Floor Shift Reports
  getFloorShiftReport(unitId: string, date: string, shift: FloorShift): Promise<FloorShiftReport | undefined>;
  getFloorShiftReports(unitId: string, date: string): Promise<FloorShiftReport[]>;
  upsertFloorShiftReport(data: InsertFloorShiftReport): Promise<FloorShiftReport>;
  deleteFloorShiftReport(id: string): Promise<boolean>;

  // Users
  getAllUsers(): Promise<PublicUser[]>;
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(data: InsertUser): Promise<User>;
  updateUserRole(id: string, role: UserRole): Promise<PublicUser | undefined>;
  updateUserPassword(id: string, passwordHash: string): Promise<boolean>;
  deleteUser(id: string): Promise<boolean>;
  adminExists(): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  async getAllStaff(): Promise<StaffMember[]> {
    return db.select().from(staffMembers).where(eq(staffMembers.isActive, true));
  }

  async getAllStaffIncludingInactive(): Promise<StaffMember[]> {
    return db.select().from(staffMembers);
  }

  async getStaffById(id: string): Promise<StaffMember | undefined> {
    const rows = await db.select().from(staffMembers).where(eq(staffMembers.id, id));
    return rows[0];
  }

  async createStaffMember(member: InsertStaffMember): Promise<StaffMember> {
    const rows = await db.insert(staffMembers).values({ ...member, isActive: true } as any).returning();
    return rows[0];
  }

  async updateStaffMember(id: string, member: Partial<InsertStaffMember>): Promise<StaffMember | undefined> {
    const rows = await db.update(staffMembers).set(member as any).where(eq(staffMembers.id, id)).returning();
    return rows[0];
  }

  async deactivateStaffMember(id: string): Promise<boolean> {
    const rows = await db.update(staffMembers)
      .set({ isActive: false })
      .where(eq(staffMembers.id, id))
      .returning();
    if (rows.length > 0) {
      // Release this staff member from all future clinic and charge assignments.
      // Coverage records are kept — they are historical audit data for reporting.
      await db.delete(clinicAssignments).where(eq(clinicAssignments.staffId, id));
      await db.delete(rnAssignments).where(eq(rnAssignments.rnId, id));
    }
    return rows.length > 0;
  }

  async reactivateStaffMember(id: string): Promise<boolean> {
    const rows = await db.update(staffMembers)
      .set({ isActive: true })
      .where(eq(staffMembers.id, id))
      .returning();
    return rows.length > 0;
  }

  async getAllCoverageRecords(): Promise<CoverageRecord[]> {
    return db.select().from(coverageRecords).orderBy(desc(coverageRecords.date));
  }

  async getCoverageForDate(date: string): Promise<CoverageRecord[]> {
    return db.select().from(coverageRecords).where(eq(coverageRecords.date, date));
  }

  async createCoverageRecord(record: InsertCoverageRecord): Promise<CoverageRecord> {
    const rows = await db.insert(coverageRecords).values(record).returning();
    return rows[0];
  }

  async deleteCoverageRecord(id: string): Promise<boolean> {
    const rows = await db.delete(coverageRecords).where(eq(coverageRecords.id, id)).returning();
    return rows.length > 0;
  }

  async getSchedule(providerId: string, date: string): Promise<ProviderSchedule | undefined> {
    const rows = await db
      .select()
      .from(providerSchedules)
      .where(and(eq(providerSchedules.providerId, providerId), eq(providerSchedules.date, date)));
    return rows[0];
  }

  async upsertSchedule(schedule: InsertProviderSchedule): Promise<ProviderSchedule> {
    const existing = await this.getSchedule(schedule.providerId, schedule.date);
    if (existing) {
      const rows = await db
        .update(providerSchedules)
        .set({ am: schedule.am, pm: schedule.pm } as any)
        .where(eq(providerSchedules.id, existing.id))
        .returning();
      return rows[0];
    }
    const rows = await db.insert(providerSchedules).values(schedule as any).returning();
    return rows[0];
  }

  async getSchedulesForDateRange(startDate: string, endDate: string): Promise<ProviderSchedule[]> {
    const all = await db.select().from(providerSchedules);
    return all.filter(s => s.date >= startDate && s.date <= endDate);
  }

  async getAllUnavailability(): Promise<StaffUnavailability[]> {
    return db.select().from(staffUnavailability).orderBy(staffUnavailability.startDate);
  }

  async getUnavailabilityForStaff(staffId: string): Promise<StaffUnavailability[]> {
    return db.select().from(staffUnavailability).where(eq(staffUnavailability.staffId, staffId));
  }

  async createUnavailability(record: InsertStaffUnavailability): Promise<StaffUnavailability> {
    const rows = await db.insert(staffUnavailability).values(record as any).returning();
    return rows[0];
  }

  async updateUnavailability(id: string, data: Partial<InsertStaffUnavailability>): Promise<StaffUnavailability | undefined> {
    const rows = await db.update(staffUnavailability).set(data as any).where(eq(staffUnavailability.id, id)).returning();
    return rows[0];
  }

  async deleteUnavailability(id: string): Promise<boolean> {
    const rows = await db.delete(staffUnavailability).where(eq(staffUnavailability.id, id)).returning();
    return rows.length > 0;
  }

  // Special Clinics
  async getAllClinics(): Promise<SpecialClinic[]> {
    return db.select().from(specialClinics).orderBy(specialClinics.name);
  }

  async getClinicById(id: string): Promise<SpecialClinic | undefined> {
    const rows = await db.select().from(specialClinics).where(eq(specialClinics.id, id));
    return rows[0];
  }

  async createClinic(clinic: InsertSpecialClinic): Promise<SpecialClinic> {
    const rows = await db.insert(specialClinics).values(clinic).returning();
    return rows[0];
  }

  async updateClinic(id: string, clinic: Partial<InsertSpecialClinic>): Promise<SpecialClinic | undefined> {
    const rows = await db.update(specialClinics).set(clinic).where(eq(specialClinics.id, id)).returning();
    return rows[0];
  }

  async deleteClinic(id: string): Promise<boolean> {
    // Cascade: remove all assignments and day overrides for this clinic first,
    // so staff are immediately returned to available status.
    await db.delete(clinicAssignments).where(eq(clinicAssignments.clinicId, id));
    await db.delete(clinicDayOverrides).where(eq(clinicDayOverrides.clinicId, id));
    const rows = await db.delete(specialClinics).where(eq(specialClinics.id, id)).returning();
    return rows.length > 0;
  }

  // Clinic Day Overrides
  async getAllClinicOverrides(): Promise<ClinicDayOverride[]> {
    return db.select().from(clinicDayOverrides);
  }

  async getOverridesForClinic(clinicId: string): Promise<ClinicDayOverride[]> {
    return db.select().from(clinicDayOverrides).where(eq(clinicDayOverrides.clinicId, clinicId));
  }

  async createClinicOverride(override: InsertClinicDayOverride): Promise<ClinicDayOverride> {
    const rows = await db.insert(clinicDayOverrides).values(override).returning();
    return rows[0];
  }

  async deleteClinicAssignmentsForDate(clinicId: string, date: string): Promise<number> {
    const rows = await db.delete(clinicAssignments)
      .where(and(eq(clinicAssignments.clinicId, clinicId), eq(clinicAssignments.date, date)))
      .returning();
    return rows.length;
  }

  async deleteClinicOverride(id: string): Promise<boolean> {
    const rows = await db.delete(clinicDayOverrides).where(eq(clinicDayOverrides.id, id)).returning();
    return rows.length > 0;
  }

  async deleteClinicOverrideByDate(clinicId: string, date: string): Promise<boolean> {
    const rows = await db.delete(clinicDayOverrides)
      .where(and(eq(clinicDayOverrides.clinicId, clinicId), eq(clinicDayOverrides.date, date)))
      .returning();
    return rows.length > 0;
  }

  // Clinic Assignments
  async getAllClinicAssignments(): Promise<ClinicAssignment[]> {
    return db.select().from(clinicAssignments).orderBy(desc(clinicAssignments.date));
  }

  async getAssignmentsForClinic(clinicId: string): Promise<ClinicAssignment[]> {
    return db.select().from(clinicAssignments).where(eq(clinicAssignments.clinicId, clinicId)).orderBy(desc(clinicAssignments.date));
  }

  async getAssignmentsForDate(date: string): Promise<ClinicAssignment[]> {
    return db.select().from(clinicAssignments).where(eq(clinicAssignments.date, date));
  }

  async createClinicAssignment(assignment: InsertClinicAssignment): Promise<ClinicAssignment> {
    const rows = await db.insert(clinicAssignments).values(assignment as any).returning();
    return rows[0];
  }

  async deleteClinicAssignment(id: string): Promise<boolean> {
    const rows = await db.delete(clinicAssignments).where(eq(clinicAssignments.id, id)).returning();
    return rows.length > 0;
  }

  // Call Availability
  async getAllCallAvailability(): Promise<CallAvailability[]> {
    return db.select().from(callAvailability).orderBy(callAvailability.availableDate);
  }

  async getCallAvailabilityForDate(date: string): Promise<CallAvailability[]> {
    return db.select().from(callAvailability).where(eq(callAvailability.availableDate, date));
  }

  async createCallAvailability(record: InsertCallAvailability): Promise<CallAvailability> {
    const rows = await db.insert(callAvailability).values(record as any).returning();
    return rows[0];
  }

  async deleteCallAvailability(id: string): Promise<boolean> {
    const rows = await db.delete(callAvailability).where(eq(callAvailability.id, id)).returning();
    return rows.length > 0;
  }

  async getAllShiftDistributionLogs(): Promise<ShiftDistributionLog[]> {
    return db.select().from(shiftDistributionLog);
  }

  async createShiftDistributionLog(log: InsertShiftDistributionLog): Promise<ShiftDistributionLog> {
    const rows = await db.insert(shiftDistributionLog).values(log as any).returning();
    return rows[0];
  }

  async deleteShiftDistributionLog(id: string): Promise<boolean> {
    const rows = await db.delete(shiftDistributionLog).where(eq(shiftDistributionLog.id, id)).returning();
    return rows.length > 0;
  }

  private toPublic(u: User): PublicUser {
    const { passwordHash: _, ...pub } = u;
    return pub;
  }

  async getAllUsers(): Promise<PublicUser[]> {
    const rows = await db.select().from(users);
    return rows.map(r => this.toPublic(r));
  }

  async getUser(id: string): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.id, id));
    return rows[0];
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const rows = await db.select().from(users).where(eq(users.email, email));
    return rows[0];
  }

  async createUser(data: InsertUser): Promise<User> {
    const rows = await db.insert(users).values(data as any).returning();
    return rows[0];
  }

  async updateUserRole(id: string, role: UserRole): Promise<PublicUser | undefined> {
    const rows = await db.update(users).set({ role }).where(eq(users.id, id)).returning();
    return rows[0] ? this.toPublic(rows[0]) : undefined;
  }

  async updateUserPassword(id: string, passwordHash: string): Promise<boolean> {
    const rows = await db.update(users).set({ passwordHash }).where(eq(users.id, id)).returning();
    return rows.length > 0;
  }

  async deleteUser(id: string): Promise<boolean> {
    const rows = await db.delete(users).where(eq(users.id, id)).returning();
    return rows.length > 0;
  }

  async adminExists(): Promise<boolean> {
    const rows = await db.select().from(users).where(eq(users.role, 'admin'));
    return rows.length > 0;
  }

  async getRnAssignmentsForDate(date: string): Promise<RnAssignment[]> {
    return db.select().from(rnAssignments).where(eq(rnAssignments.date, date));
  }

  async getRnAssignmentsForRange(start: string, end: string): Promise<RnAssignment[]> {
    return db.select().from(rnAssignments)
      .where(and(gte(rnAssignments.date, start), lte(rnAssignments.date, end)))
      .orderBy(rnAssignments.date);
  }

  async upsertRnAssignment(data: InsertRnAssignment): Promise<RnAssignment> {
    // Delete any existing assignment for this position+date, then insert
    await db.delete(rnAssignments).where(
      and(eq(rnAssignments.date, data.date), eq(rnAssignments.positionId, data.positionId as RnPositionId))
    );
    const rows = await db.insert(rnAssignments).values(data as any).returning();
    return rows[0];
  }

  async deleteRnAssignment(id: string): Promise<boolean> {
    const rows = await db.delete(rnAssignments).where(eq(rnAssignments.id, id)).returning();
    return rows.length > 0;
  }

  async resetScheduleData(startDate?: string, endDate?: string): Promise<{ cleared: string[] }> {
    const hasRange = !!(startDate && endDate);

    if (hasRange) {
      // Date-filtered deletes — each table uses its own date column
      // provider_schedules.date
      await db.delete(providerSchedules).where(
        and(gte(providerSchedules.date, startDate!), lte(providerSchedules.date, endDate!))
      );
      // coverage_records.date
      await db.delete(coverageRecords).where(
        and(gte(coverageRecords.date, startDate!), lte(coverageRecords.date, endDate!))
      );
      // staff_unavailability: delete if the record's range overlaps with [startDate, endDate]
      // Overlap condition: record.startDate <= endDate AND record.endDate >= startDate
      await db.delete(staffUnavailability).where(
        and(lte(staffUnavailability.startDate, endDate!), gte(staffUnavailability.endDate, startDate!))
      );
      // clinic_assignments.date
      await db.delete(clinicAssignments).where(
        and(gte(clinicAssignments.date, startDate!), lte(clinicAssignments.date, endDate!))
      );
      // clinic_day_overrides.date
      await db.delete(clinicDayOverrides).where(
        and(gte(clinicDayOverrides.date, startDate!), lte(clinicDayOverrides.date, endDate!))
      );
      // call_availability.availableDate
      await db.delete(callAvailability).where(
        and(gte(callAvailability.availableDate, startDate!), lte(callAvailability.availableDate, endDate!))
      );
      // shift_distribution_log.assignedDate
      await db.delete(shiftDistributionLog).where(
        and(gte(shiftDistributionLog.assignedDate, startDate!), lte(shiftDistributionLog.assignedDate, endDate!))
      );
      // rn_assignments.date
      await db.delete(rnAssignments).where(
        and(gte(rnAssignments.date, startDate!), lte(rnAssignments.date, endDate!))
      );
    } else {
      // No range — wipe everything
      await db.delete(providerSchedules);
      await db.delete(coverageRecords);
      await db.delete(staffUnavailability);
      await db.delete(clinicAssignments);
      await db.delete(clinicDayOverrides);
      await db.delete(callAvailability);
      await db.delete(shiftDistributionLog);
      await db.delete(rnAssignments);
    }

    return {
      cleared: [
        'Provider Schedules',
        'Coverage Records',
        'Staff Unavailability',
        'Clinic Assignments',
        'Clinic Day Overrides',
        'Call Availability',
        'Shift Distribution Log',
      ],
    };
  }

  async cleanupOrphanedClinicAssignments(): Promise<{ deleted: number }> {
    const result = await db.execute(
      sql`DELETE FROM clinic_assignments
          WHERE clinic_id NOT IN (SELECT id FROM special_clinics)`
    );
    const deleted = (result as any).rowCount ?? 0;
    return { deleted };
  }

  async cleanupDuplicateStaff(): Promise<{ deactivated: number; names: string[] }> {
    const rows = await db.execute(
      sql`WITH ranked AS (
            SELECT
              id,
              name,
              ROW_NUMBER() OVER (
                PARTITION BY lower(name)
                ORDER BY jsonb_array_length(COALESCE(assigned_to, '[]'::jsonb)) DESC, id ASC
              ) AS rn
            FROM staff_members
            WHERE is_active = true
          ),
          to_deactivate AS (
            UPDATE staff_members
            SET is_active = false
            WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
            RETURNING name
          )
          SELECT name FROM to_deactivate`
    );
    const affected = (rows as any).rows ?? [];
    const names: string[] = affected.map((r: any) => r.name);
    return { deactivated: names.length, names };
  }

  // ── Floor Units ───────────────────────────────────────────────────────────────

  async getAllFloorUnits(): Promise<FloorUnit[]> {
    return db.select().from(floorUnits).orderBy(floorUnits.name);
  }

  async getFloorUnitById(id: string): Promise<FloorUnit | undefined> {
    const rows = await db.select().from(floorUnits).where(eq(floorUnits.id, id));
    return rows[0];
  }

  async createFloorUnit(unit: InsertFloorUnit): Promise<FloorUnit> {
    const rows = await db.insert(floorUnits).values(unit).returning();
    return rows[0];
  }

  async updateFloorUnit(id: string, unit: Partial<InsertFloorUnit>): Promise<FloorUnit | undefined> {
    const rows = await db.update(floorUnits).set(unit).where(eq(floorUnits.id, id)).returning();
    return rows[0];
  }

  async deleteFloorUnit(id: string): Promise<boolean> {
    const rows = await db.delete(floorUnits).where(eq(floorUnits.id, id)).returning();
    return rows.length > 0;
  }

  // ── Floor Daily Rooms ─────────────────────────────────────────────────────────

  async getFloorDailyRooms(unitId: string, date: string): Promise<FloorDailyRooms | undefined> {
    const rows = await db.select().from(floorDailyRooms)
      .where(and(eq(floorDailyRooms.unitId, unitId), eq(floorDailyRooms.date, date)));
    return rows[0];
  }

  async upsertFloorDailyRooms(data: InsertFloorDailyRooms): Promise<FloorDailyRooms> {
    const existing = await this.getFloorDailyRooms(data.unitId, data.date);
    if (existing) {
      const rows = await db.update(floorDailyRooms)
        .set({ openRoomCount: data.openRoomCount })
        .where(eq(floorDailyRooms.id, existing.id))
        .returning();
      return rows[0];
    }
    const rows = await db.insert(floorDailyRooms).values(data).returning();
    return rows[0];
  }

  async deleteFloorDailyRooms(unitId: string, date: string): Promise<void> {
    await db.delete(floorDailyRooms)
      .where(and(eq(floorDailyRooms.unitId, unitId), eq(floorDailyRooms.date, date)));
  }

  // ── Floor Staff ───────────────────────────────────────────────────────────────

  async getAllFloorStaff(): Promise<FloorStaffMember[]> {
    return db.select().from(floorStaff).orderBy(floorStaff.name);
  }

  async getFloorStaffById(id: string): Promise<FloorStaffMember | undefined> {
    const rows = await db.select().from(floorStaff).where(eq(floorStaff.id, id));
    return rows[0];
  }

  async createFloorStaffMember(member: InsertFloorStaff): Promise<FloorStaffMember> {
    const rows = await db.insert(floorStaff).values({ ...member, isActive: true } as any).returning();
    return rows[0];
  }

  async updateFloorStaffMember(id: string, member: Partial<InsertFloorStaff>): Promise<FloorStaffMember | undefined> {
    const rows = await db.update(floorStaff).set(member as any).where(eq(floorStaff.id, id)).returning();
    return rows[0];
  }

  async deactivateFloorStaffMember(id: string): Promise<boolean> {
    const rows = await db.update(floorStaff)
      .set({ isActive: false })
      .where(eq(floorStaff.id, id))
      .returning();
    return rows.length > 0;
  }

  async reactivateFloorStaffMember(id: string): Promise<boolean> {
    const rows = await db.update(floorStaff)
      .set({ isActive: true })
      .where(eq(floorStaff.id, id))
      .returning();
    return rows.length > 0;
  }

  // ── Floor Shift Assignments ───────────────────────────────────────────────────

  async getFloorShiftAssignments(unitId: string, date: string): Promise<FloorShiftAssignment[]> {
    return db.select().from(floorShiftAssignments)
      .where(and(eq(floorShiftAssignments.unitId, unitId), eq(floorShiftAssignments.date, date)));
  }

  async getFloorShiftAssignmentsForStaff(staffId: string, startDate: string, endDate: string): Promise<FloorShiftAssignment[]> {
    return db.select().from(floorShiftAssignments)
      .where(and(
        eq(floorShiftAssignments.staffId, staffId),
        gte(floorShiftAssignments.date, startDate),
        lte(floorShiftAssignments.date, endDate)
      ));
  }

  async getFloorShiftAssignmentsByUnitDateRange(unitId: string, startDate: string, endDate: string): Promise<FloorShiftAssignment[]> {
    return db.select().from(floorShiftAssignments)
      .where(and(
        eq(floorShiftAssignments.unitId, unitId),
        gte(floorShiftAssignments.date, startDate),
        lte(floorShiftAssignments.date, endDate)
      ));
  }

  async upsertFloorShiftAssignment(data: InsertFloorShiftAssignment): Promise<FloorShiftAssignment> {
    const existing = await db.select().from(floorShiftAssignments)
      .where(and(
        eq(floorShiftAssignments.staffId, data.staffId),
        eq(floorShiftAssignments.unitId, data.unitId),
        eq(floorShiftAssignments.date, data.date),
        eq(floorShiftAssignments.shift, data.shift as any)
      ));
    if (existing[0]) {
      const rows = await db.update(floorShiftAssignments)
        .set({ rooms: data.rooms, acuityLoad: data.acuityLoad, isChargeRn: data.isChargeRn } as any)
        .where(eq(floorShiftAssignments.id, existing[0].id))
        .returning();
      return rows[0];
    }
    const rows = await db.insert(floorShiftAssignments).values(data as any).returning();
    return rows[0];
  }

  async deleteFloorShiftAssignment(id: string): Promise<boolean> {
    const rows = await db.delete(floorShiftAssignments).where(eq(floorShiftAssignments.id, id)).returning();
    return rows.length > 0;
  }

  async deleteFloorShiftAssignmentsForDateShift(unitId: string, date: string, shift: FloorShift): Promise<number> {
    const rows = await db.delete(floorShiftAssignments)
      .where(and(
        eq(floorShiftAssignments.unitId, unitId),
        eq(floorShiftAssignments.date, date),
        eq(floorShiftAssignments.shift, shift)
      ))
      .returning();
    return rows.length;
  }

  // ── Floor Room Acuity ─────────────────────────────────────────────────────────

  async getFloorRoomAcuity(unitId: string, date: string, shift: FloorShift): Promise<FloorRoomAcuity[]> {
    return db.select().from(floorRoomAcuity)
      .where(and(
        eq(floorRoomAcuity.unitId, unitId),
        eq(floorRoomAcuity.date, date),
        eq(floorRoomAcuity.shift, shift)
      ));
  }

  async upsertFloorRoomAcuity(data: InsertFloorRoomAcuity): Promise<FloorRoomAcuity> {
    const existing = await db.select().from(floorRoomAcuity)
      .where(and(
        eq(floorRoomAcuity.unitId, data.unitId),
        eq(floorRoomAcuity.date, data.date),
        eq(floorRoomAcuity.shift, data.shift as any),
        eq(floorRoomAcuity.roomNumber, data.roomNumber as any)
      ));
    if (existing[0]) {
      const rows = await db.update(floorRoomAcuity)
        .set({ acuityLevel: data.acuityLevel } as any)
        .where(eq(floorRoomAcuity.id, existing[0].id))
        .returning();
      return rows[0];
    }
    const rows = await db.insert(floorRoomAcuity).values(data as any).returning();
    return rows[0];
  }

  async deleteFloorRoomAcuity(id: string): Promise<boolean> {
    const rows = await db.delete(floorRoomAcuity).where(eq(floorRoomAcuity.id, id)).returning();
    return rows.length > 0;
  }

  async deleteFloorRoomAcuityByShift(unitId: string, date: string, shift: FloorShift): Promise<number> {
    const rows = await db.delete(floorRoomAcuity)
      .where(and(
        eq(floorRoomAcuity.unitId, unitId),
        eq(floorRoomAcuity.date, date),
        eq(floorRoomAcuity.shift, shift)
      ))
      .returning();
    return rows.length;
  }

  // ── Floor Shift Reports ───────────────────────────────────────────────────────

  async getFloorShiftReport(unitId: string, date: string, shift: FloorShift): Promise<FloorShiftReport | undefined> {
    const rows = await db.select().from(floorShiftReports)
      .where(and(
        eq(floorShiftReports.unitId, unitId),
        eq(floorShiftReports.date, date),
        eq(floorShiftReports.shift, shift)
      ));
    return rows[0];
  }

  async getFloorShiftReports(unitId: string, date: string): Promise<FloorShiftReport[]> {
    return db.select().from(floorShiftReports)
      .where(and(eq(floorShiftReports.unitId, unitId), eq(floorShiftReports.date, date)));
  }

  async upsertFloorShiftReport(data: InsertFloorShiftReport): Promise<FloorShiftReport> {
    const existing = await this.getFloorShiftReport(data.unitId, data.date, data.shift as any);
    if (existing) {
      const rows = await db.update(floorShiftReports)
        .set({
          chargeRnId: data.chargeRnId,
          chargeRnName: data.chargeRnName,
          roomNotes: data.roomNotes,
          shiftSummary: data.shiftSummary,
          huddleTopics: data.huddleTopics,
          updatedAt: data.updatedAt,
        } as any)
        .where(eq(floorShiftReports.id, existing.id))
        .returning();
      return rows[0];
    }
    const rows = await db.insert(floorShiftReports).values(data as any).returning();
    return rows[0];
  }

  async deleteFloorShiftReport(id: string): Promise<boolean> {
    const rows = await db.delete(floorShiftReports).where(eq(floorShiftReports.id, id)).returning();
    return rows.length > 0;
  }
}

export const storage = new DatabaseStorage();
