import type { Express } from "express";
import { createServer, type Server } from "http";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";
import { storage } from "./storage";
import { requireAuth, requireAdmin } from "./auth";
import {
  insertStaffMemberSchema, insertCoverageRecordSchema,
  insertProviderScheduleSchema, insertStaffUnavailabilitySchema,
  insertSpecialClinicSchema, insertClinicDayOverrideSchema, insertClinicAssignmentSchema,
  insertCallAvailabilitySchema, insertShiftDistributionLogSchema,
  insertRnAssignmentSchema,
  insertFloorUnitSchema, insertFloorDailyRoomsSchema, insertFloorStaffSchema,
  insertFloorShiftAssignmentSchema, insertFloorRoomAcuitySchema, insertFloorShiftReportSchema,
  registerUserSchema, USER_ROLES, shiftsOverlap,
  type FloorShift,
} from "@shared/schema";
import { seedInitialData } from "./seed";

const SALT_ROUNDS = 10;

// In-memory store for password-reset codes: email → { code, expiresAt }
const resetCodes = new Map<string, { code: string; expiresAt: number }>();

function makeResetCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function sendResetEmail(toEmail: string, code: string) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_EMAIL,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
  await transporter.sendMail({
    from: `"ClinicFlow" <${process.env.GMAIL_EMAIL}>`,
    to: toEmail,
    subject: "ClinicFlow Password Reset",
    text: `Your password reset code is: ${code}\n\nEnter this code in the app to set a new password. It expires in 30 minutes.\n\nIf you did not request this, ignore this email.`,
    html: `<p>Your password reset code is:</p><h2 style="letter-spacing:4px;">${code}</h2><p>Enter this code in the app to set a new password. It expires in <strong>30 minutes</strong>.</p><p style="color:#888;font-size:12px;">If you did not request this, ignore this email.</p>`,
  });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // On every startup, silently remove any clinic_assignments whose clinic no longer exists.
  // This cleans up orphaned records left by clinic deletions that pre-date cascade cleanup.
  try {
    const orphanCleanup = await storage.cleanupOrphanedClinicAssignments();
    if (orphanCleanup.deleted > 0) {
      console.log(`[startup] Removed ${orphanCleanup.deleted} orphaned clinic assignment(s).`);
    }
  } catch (e) {
    console.warn("[startup] Could not run orphaned clinic assignment cleanup:", e);
  }

  // On every startup, deactivate any duplicate active staff members sharing the same name.
  // Keeps the record with the most provider assignments; deactivates all others.
  try {
    const dupCleanup = await storage.cleanupDuplicateStaff();
    if (dupCleanup.deactivated > 0) {
      console.log(`[startup] Deactivated ${dupCleanup.deactivated} duplicate staff record(s): ${dupCleanup.names.join(", ")}`);
    }
  } catch (e) {
    console.warn("[startup] Could not run duplicate staff cleanup:", e);
  }

  await seedInitialData();

  // ─── Auth Routes ─────────────────────────────────────────────────────────────

  // First-run: check if any admin exists (used to show setup page)
  app.get("/api/auth/setup-needed", async (_req, res) => {
    const exists = await storage.adminExists();
    res.json({ setupNeeded: !exists });
  });

  // Register (open only if no admin exists yet, or called by an admin)
  app.post("/api/auth/register", async (req, res) => {
    const adminExists = await storage.adminExists();
    const callerIsAdmin = req.session?.user?.role === "admin";

    if (adminExists && !callerIsAdmin) {
      return res.status(403).json({ message: "Only admins can create new users" });
    }

    const parsed = registerUserSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.flatten() });

    const { name, email, password, role } = parsed.data;

    const existing = await storage.getUserByEmail(email);
    if (existing) return res.status(409).json({ message: "Email already in use" });

    // First user is always admin
    const assignedRole = !adminExists ? "admin" : role;
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await storage.createUser({ name, email, passwordHash, role: assignedRole });
    const { passwordHash: _, ...pub } = user;
    res.status(201).json(pub);
  });

  // Login
  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Email and password required" });

    const user = await storage.getUserByEmail(email);
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ message: "Invalid credentials" });

    const { passwordHash: _, ...pub } = user;
    req.session.user = pub;
    // Explicitly save the session to the PostgreSQL store before responding,
    // so the cookie is valid for the very next request.
    req.session.save((err) => {
      if (err) {
        console.error("Session save error:", err);
        return res.status(500).json({ message: "Session error" });
      }
      res.json(pub);
    });
  });

  // Logout
  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
  });

  // Current user
  app.get("/api/auth/me", requireAuth, (req, res) => {
    res.json(req.session.user);
  });

  // List all users (admin only)
  app.get("/api/auth/users", requireAdmin, async (_req, res) => {
    const users = await storage.getAllUsers();
    res.json(users);
  });

  // Update user role (admin only)
  app.patch("/api/auth/users/:id/role", requireAdmin, async (req, res) => {
    const { role } = req.body;
    if (!USER_ROLES.includes(role)) return res.status(400).json({ message: "Invalid role" });
    const updated = await storage.updateUserRole(req.params.id, role);
    if (!updated) return res.status(404).json({ message: "User not found" });
    res.json(updated);
  });

  // Delete user (admin only — cannot delete self)
  app.delete("/api/auth/users/:id", requireAdmin, async (req, res) => {
    if (req.session.user?.id === req.params.id) {
      return res.status(400).json({ message: "Cannot delete your own account" });
    }
    const deleted = await storage.deleteUser(req.params.id);
    if (!deleted) return res.status(404).json({ message: "User not found" });
    res.json({ success: true });
  });

  // ─── Password Reset Routes ───────────────────────────────────────────────────

  // Step 1: request a reset code
  app.post("/api/auth/forgot-password", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email required" });

    const user = await storage.getUserByEmail(email);
    // Always respond OK to avoid user enumeration
    if (!user) return res.json({ message: "If that email exists, a code has been sent." });

    const code = makeResetCode();
    resetCodes.set(email.toLowerCase(), { code, expiresAt: Date.now() + 30 * 60 * 1000 });

    try {
      await sendResetEmail(email, code);
    } catch (err) {
      console.error("[forgot-password] Email send failed:", err);
      return res.status(500).json({ message: "Failed to send reset email. Check server email configuration." });
    }

    res.json({ message: "If that email exists, a code has been sent." });
  });

  // Step 2: verify code + set new password
  app.post("/api/auth/reset-password", async (req, res) => {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      return res.status(400).json({ message: "email, code, and newPassword are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const entry = resetCodes.get(email.toLowerCase());
    if (!entry) return res.status(400).json({ message: "No reset code found for this email" });
    if (Date.now() > entry.expiresAt) {
      resetCodes.delete(email.toLowerCase());
      return res.status(400).json({ message: "Reset code has expired. Please request a new one." });
    }
    if (entry.code !== code.toUpperCase().trim()) {
      return res.status(400).json({ message: "Incorrect reset code" });
    }

    const user = await storage.getUserByEmail(email);
    if (!user) return res.status(404).json({ message: "User not found" });

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await storage.updateUserPassword(user.id, passwordHash);
    resetCodes.delete(email.toLowerCase());

    res.json({ message: "Password updated successfully" });
  });

  // ─── Staff Routes ─────────────────────────────────────────────────────────────
  app.get("/api/staff", requireAuth, async (_req, res) => {
    const staff = await storage.getAllStaff();
    res.json(staff);
  });

  // Admin only: view former/inactive staff
  app.get("/api/staff/inactive", requireAdmin, async (_req, res) => {
    const all = await storage.getAllStaffIncludingInactive();
    res.json(all.filter(s => !s.isActive));
  });

  app.post("/api/staff", requireAuth, async (req, res) => {
    const parsed = insertStaffMemberSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const member = await storage.createStaffMember(parsed.data);
    res.status(201).json(member);
  });

  app.patch("/api/staff/:id", requireAuth, async (req, res) => {
    const isAdmin = req.session.user?.role === "admin";
    let body = req.body;
    // Non-admins cannot change structural fields
    if (!isAdmin) {
      const { isFloatPool, crossTrained, lvnsRequired, assignedTo, isActive, ...dataFields } = body;
      body = dataFields;
    }
    const parsed = insertStaffMemberSchema.partial().safeParse(body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const updated = await storage.updateStaffMember(req.params.id, parsed.data);
    if (!updated) return res.status(404).json({ error: "Staff member not found" });
    res.json(updated);
  });

  // Admin only: soft-delete (mark as no longer working — preserves history)
  app.delete("/api/staff/:id", requireAdmin, async (req, res) => {
    const deactivated = await storage.deactivateStaffMember(req.params.id);
    if (!deactivated) return res.status(404).json({ error: "Staff member not found" });
    res.json({ success: true });
  });

  // Admin only: reactivate a former staff member
  app.post("/api/staff/:id/reactivate", requireAdmin, async (req, res) => {
    const reactivated = await storage.reactivateStaffMember(req.params.id);
    if (!reactivated) return res.status(404).json({ error: "Staff member not found" });
    res.json({ success: true });
  });

  // ─── Coverage Routes ──────────────────────────────────────────────────────────
  app.get("/api/coverage", requireAuth, async (_req, res) => {
    const records = await storage.getAllCoverageRecords();
    res.json(records);
  });

  app.post("/api/coverage", requireAuth, async (req, res) => {
    const parsed = insertCoverageRecordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { staffId, date, staffName } = parsed.data;

    // Hard stop: reject if this staff member already has a coverage assignment on the same date
    const existingCoverage = await storage.getCoverageForDate(date);
    const coverageConflict = existingCoverage.find(r => r.staffId === staffId);
    if (coverageConflict) {
      return res.status(409).json({
        error: `${staffName} is already covering for ${coverageConflict.providerName} on ${date}. Cannot assign the same staff member to two locations.`,
        conflictingProvider: coverageConflict.providerName,
      });
    }

    // Hard stop: reject if this staff member has a clinic assignment on the same date
    const clinicAssignmentsOnDate = await storage.getAssignmentsForDate(date);
    const clinicConflict = clinicAssignmentsOnDate.find(a => a.staffId === staffId);
    if (clinicConflict) {
      return res.status(409).json({
        error: `${staffName} is already assigned to ${clinicConflict.clinicName} on ${date}. Cannot assign the same staff member to two locations.`,
        conflictingClinic: clinicConflict.clinicName,
      });
    }

    const record = await storage.createCoverageRecord(parsed.data);
    res.status(201).json(record);
  });

  app.delete("/api/coverage/:id", requireAuth, async (req, res) => {
    const deleted = await storage.deleteCoverageRecord(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Record not found" });
    res.json({ success: true });
  });

  // ─── Schedule Routes ──────────────────────────────────────────────────────────
  app.get("/api/schedules", requireAuth, async (req, res) => {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: "start and end query params required" });
    const schedules = await storage.getSchedulesForDateRange(start as string, end as string);
    res.json(schedules);
  });

  app.put("/api/schedules", requireAuth, async (req, res) => {
    const parsed = insertProviderScheduleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const schedule = await storage.upsertSchedule(parsed.data);
    res.json(schedule);
  });

  // ─── Unavailability Routes ────────────────────────────────────────────────────
  app.get("/api/unavailability", requireAuth, async (_req, res) => {
    const records = await storage.getAllUnavailability();
    res.json(records);
  });

  app.post("/api/unavailability", requireAuth, async (req, res) => {
    const parsed = insertStaffUnavailabilitySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const record = await storage.createUnavailability(parsed.data);
    res.status(201).json(record);
  });

  app.patch("/api/unavailability/:id", requireAuth, async (req, res) => {
    const parsed = insertStaffUnavailabilitySchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const updated = await storage.updateUnavailability(req.params.id, parsed.data);
    if (!updated) return res.status(404).json({ error: "Record not found" });
    res.json(updated);
  });

  app.delete("/api/unavailability/:id", requireAuth, async (req, res) => {
    const deleted = await storage.deleteUnavailability(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Record not found" });
    res.json({ success: true });
  });

  // ─── Special Clinics Routes ───────────────────────────────────────────────────
  app.get("/api/clinics", requireAuth, async (_req, res) => {
    const clinics = await storage.getAllClinics();
    res.json(clinics);
  });

  app.post("/api/clinics", requireAuth, async (req, res) => {
    const parsed = insertSpecialClinicSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const clinic = await storage.createClinic(parsed.data);
    res.status(201).json(clinic);
  });

  app.patch("/api/clinics/:id", requireAuth, async (req, res) => {
    const parsed = insertSpecialClinicSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const updated = await storage.updateClinic(req.params.id, parsed.data);
    if (!updated) return res.status(404).json({ error: "Clinic not found" });
    res.json(updated);
  });

  app.delete("/api/clinics/:id", requireAuth, async (req, res) => {
    const deleted = await storage.deleteClinic(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Clinic not found" });
    res.json({ success: true });
  });

  // ─── Clinic Day Overrides ─────────────────────────────────────────────────────
  app.get("/api/clinic-overrides", requireAuth, async (_req, res) => {
    const overrides = await storage.getAllClinicOverrides();
    res.json(overrides);
  });

  app.post("/api/clinic-overrides", requireAuth, async (req, res) => {
    const parsed = insertClinicDayOverrideSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const override = await storage.createClinicOverride(parsed.data);
    // When a date is closed/cancelled, immediately release any staff assigned to that clinic on that date
    if (parsed.data.isClosed) {
      await storage.deleteClinicAssignmentsForDate(parsed.data.clinicId, parsed.data.date);
    }
    res.status(201).json(override);
  });

  app.delete("/api/clinic-overrides/:id", requireAuth, async (req, res) => {
    const deleted = await storage.deleteClinicOverride(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Override not found" });
    res.json({ success: true });
  });

  // ─── Clinic Assignments ───────────────────────────────────────────────────────
  app.get("/api/clinic-assignments", requireAuth, async (req, res) => {
    const { date, clinicId } = req.query;
    if (date) return res.json(await storage.getAssignmentsForDate(date as string));
    if (clinicId) return res.json(await storage.getAssignmentsForClinic(clinicId as string));
    res.json(await storage.getAllClinicAssignments());
  });

  app.post("/api/clinic-assignments", requireAuth, async (req, res) => {
    const parsed = insertClinicAssignmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { staffId, date, shift } = parsed.data;
    const staffName = parsed.data.staffName;

    // Hard stop: check if this staff member already has a clinic assignment on the same
    // date with an overlapping shift (any clinic — including same clinic duplicate entries).
    const existingOnDate = await storage.getAssignmentsForDate(date);
    const clinicConflict = existingOnDate.find(a =>
      a.staffId === staffId &&
      shiftsOverlap(a.shift as 'AM' | 'PM' | 'Full', shift as 'AM' | 'PM' | 'Full')
    );
    if (clinicConflict) {
      return res.status(409).json({
        error: `${staffName} is already assigned to ${clinicConflict.clinicName} on ${date} (${clinicConflict.shift} shift). Cannot assign the same staff member to two locations at the same time.`,
        conflictingClinic: clinicConflict.clinicName,
        conflictingShift: clinicConflict.shift,
      });
    }

    // Hard stop: check if this staff member is already covering for a provider on the same date.
    const coverageOnDate = await storage.getCoverageForDate(date);
    const coverageConflict = coverageOnDate.find(r => r.staffId === staffId);
    if (coverageConflict) {
      return res.status(409).json({
        error: `${staffName} is already covering for ${coverageConflict.providerName} on ${date}. Cannot assign the same staff member to two locations at the same time.`,
        conflictingProvider: coverageConflict.providerName,
      });
    }

    const assignment = await storage.createClinicAssignment(parsed.data);
    res.status(201).json(assignment);
  });

  app.delete("/api/clinic-assignments/:id", requireAuth, async (req, res) => {
    const deleted = await storage.deleteClinicAssignment(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Assignment not found" });
    res.json({ success: true });
  });

  // ─── Call Availability Routes ─────────────────────────────────────────────────
  app.get("/api/call-availability", requireAuth, async (_req, res) => {
    const records = await storage.getAllCallAvailability();
    res.json(records);
  });

  app.post("/api/call-availability", requireAuth, async (req, res) => {
    const parsed = insertCallAvailabilitySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    // Prevent duplicate entries for same staff + date + shift
    const existing = await storage.getCallAvailabilityForDate(parsed.data.availableDate);
    const dupe = existing.find(r => r.staffId === parsed.data.staffId && r.shift === parsed.data.shift);
    if (dupe) return res.status(409).json({ error: "Availability already recorded for this person on that date and shift." });
    const record = await storage.createCallAvailability(parsed.data);
    res.status(201).json(record);
  });

  app.delete("/api/call-availability/:id", requireAuth, async (req, res) => {
    const deleted = await storage.deleteCallAvailability(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Record not found" });
    res.json({ success: true });
  });

  // ─── Shift Distribution Log Routes ───────────────────────────────────────────
  app.get("/api/shift-distribution", requireAuth, async (_req, res) => {
    const logs = await storage.getAllShiftDistributionLogs();
    res.json(logs);
  });

  app.post("/api/shift-distribution", requireAuth, async (req, res) => {
    const parsed = insertShiftDistributionLogSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const log = await storage.createShiftDistributionLog(parsed.data);
    res.status(201).json(log);
  });

  app.delete("/api/shift-distribution/:id", requireAuth, async (req, res) => {
    const deleted = await storage.deleteShiftDistributionLog(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Log entry not found" });
    res.json({ success: true });
  });

  // ─── RN Charge Assignments ────────────────────────────────────────────────────
  app.get("/api/rn-assignments", requireAuth, async (req, res) => {
    const { date, weekStart, weekEnd } = req.query;
    if (weekStart && weekEnd && typeof weekStart === 'string' && typeof weekEnd === 'string') {
      const records = await storage.getRnAssignmentsForRange(weekStart, weekEnd);
      return res.json(records);
    }
    if (!date || typeof date !== 'string') return res.status(400).json({ error: "date or weekStart+weekEnd required" });
    const records = await storage.getRnAssignmentsForDate(date);
    res.json(records);
  });

  app.put("/api/rn-assignments", requireAuth, async (req, res) => {
    const parsed = insertRnAssignmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const record = await storage.upsertRnAssignment(parsed.data);
    res.json(record);
  });

  app.delete("/api/rn-assignments/:id", requireAuth, async (req, res) => {
    const deleted = await storage.deleteRnAssignment(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Assignment not found" });
    res.json({ success: true });
  });

  // ─── Admin: Reset Schedule Data ───────────────────────────────────────────────
  app.delete("/api/admin/reset-schedule", requireAdmin, async (req, res) => {
    const { startDate, endDate } = req.body ?? {};
    // Validate: if one is provided both must be, and start <= end
    if ((startDate && !endDate) || (!startDate && endDate)) {
      return res.status(400).json({ error: "Both startDate and endDate are required when filtering by date range." });
    }
    if (startDate && endDate && startDate > endDate) {
      return res.status(400).json({ error: "startDate must be on or before endDate." });
    }
    const result = await storage.resetScheduleData(startDate, endDate);
    res.json({ success: true, cleared: result.cleared, startDate, endDate });
  });

  // Admin: remove clinic_assignments whose clinic no longer exists in special_clinics
  app.post("/api/admin/cleanup-orphaned-assignments", requireAdmin, async (_req, res) => {
    const result = await storage.cleanupOrphanedClinicAssignments();
    res.json({ success: true, deleted: result.deleted });
  });

  // ─── Floor Units ──────────────────────────────────────────────────────────────
  app.get("/api/floor/units", requireAuth, async (_req, res) => {
    const units = await storage.getAllFloorUnits();
    res.json(units);
  });

  app.post("/api/floor/units", requireAdmin, async (req, res) => {
    const parsed = insertFloorUnitSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const unit = await storage.createFloorUnit(parsed.data);
    res.status(201).json(unit);
  });

  app.patch("/api/floor/units/:id", requireAdmin, async (req, res) => {
    const parsed = insertFloorUnitSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const updated = await storage.updateFloorUnit(req.params.id, parsed.data);
    if (!updated) return res.status(404).json({ error: "Unit not found" });
    res.json(updated);
  });

  app.delete("/api/floor/units/:id", requireAdmin, async (req, res) => {
    const deleted = await storage.deleteFloorUnit(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Unit not found" });
    res.json({ success: true });
  });

  // ─── Floor Daily Rooms ────────────────────────────────────────────────────────
  app.get("/api/floor/daily-rooms", requireAuth, async (req, res) => {
    const { unitId, date } = req.query;
    if (!unitId || !date) return res.status(400).json({ error: "unitId and date required" });
    const record = await storage.getFloorDailyRooms(unitId as string, date as string);
    res.json(record ?? null);
  });

  app.put("/api/floor/daily-rooms", requireAdmin, async (req, res) => {
    const parsed = insertFloorDailyRoomsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const record = await storage.upsertFloorDailyRooms(parsed.data);
    res.json(record);
  });

  app.delete("/api/floor/daily-rooms", requireAdmin, async (req, res) => {
    const { unitId, date } = req.query;
    if (!unitId || !date) return res.status(400).json({ error: "unitId and date required" });
    await storage.deleteFloorDailyRooms(unitId as string, date as string);
    res.status(204).end();
  });

  // ─── Floor Staff ──────────────────────────────────────────────────────────────
  app.get("/api/floor/staff", requireAuth, async (_req, res) => {
    const staff = await storage.getAllFloorStaff();
    res.json(staff);
  });

  app.post("/api/floor/staff", requireAdmin, async (req, res) => {
    const parsed = insertFloorStaffSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const member = await storage.createFloorStaffMember(parsed.data);
    res.status(201).json(member);
  });

  app.patch("/api/floor/staff/:id", requireAdmin, async (req, res) => {
    const parsed = insertFloorStaffSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const updated = await storage.updateFloorStaffMember(req.params.id, parsed.data);
    if (!updated) return res.status(404).json({ error: "Staff member not found" });
    res.json(updated);
  });

  app.delete("/api/floor/staff/:id", requireAdmin, async (req, res) => {
    const deactivated = await storage.deactivateFloorStaffMember(req.params.id);
    if (!deactivated) return res.status(404).json({ error: "Staff member not found" });
    res.json({ success: true });
  });

  app.post("/api/floor/staff/:id/reactivate", requireAdmin, async (req, res) => {
    const reactivated = await storage.reactivateFloorStaffMember(req.params.id);
    if (!reactivated) return res.status(404).json({ error: "Staff member not found" });
    res.json({ success: true });
  });

  // ─── Floor Shift Assignments ──────────────────────────────────────────────────
  app.get("/api/floor/assignments", requireAuth, async (req, res) => {
    const { unitId, date, staffId, startDate, endDate } = req.query;
    if (staffId && startDate && endDate) {
      return res.json(await storage.getFloorShiftAssignmentsForStaff(staffId as string, startDate as string, endDate as string));
    }
    if (unitId && startDate && endDate) {
      return res.json(await storage.getFloorShiftAssignmentsByUnitDateRange(unitId as string, startDate as string, endDate as string));
    }
    if (!unitId || !date) return res.status(400).json({ error: "unitId and date required" });
    const assignments = await storage.getFloorShiftAssignments(unitId as string, date as string);
    res.json(assignments);
  });

  app.put("/api/floor/assignments", requireAdmin, async (req, res) => {
    const parsed = insertFloorShiftAssignmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const assignment = await storage.upsertFloorShiftAssignment(parsed.data);
    res.json(assignment);
  });

  app.delete("/api/floor/assignments/:id", requireAdmin, async (req, res) => {
    const deleted = await storage.deleteFloorShiftAssignment(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Assignment not found" });
    res.json({ success: true });
  });

  app.delete("/api/floor/assignments", requireAdmin, async (req, res) => {
    const { unitId, date, shift } = req.body;
    if (!unitId || !date || !shift) return res.status(400).json({ error: "unitId, date, shift required" });
    const count = await storage.deleteFloorShiftAssignmentsForDateShift(unitId, date, shift as FloorShift);
    res.json({ success: true, deleted: count });
  });

  // ─── Floor Room Acuity ────────────────────────────────────────────────────────
  app.get("/api/floor/acuity", requireAuth, async (req, res) => {
    const { unitId, date, shift } = req.query;
    if (!unitId || !date || !shift) return res.status(400).json({ error: "unitId, date, shift required" });
    const records = await storage.getFloorRoomAcuity(unitId as string, date as string, shift as FloorShift);
    res.json(records);
  });

  app.put("/api/floor/acuity", requireAdmin, async (req, res) => {
    const parsed = insertFloorRoomAcuitySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const record = await storage.upsertFloorRoomAcuity(parsed.data);
    res.json(record);
  });

  app.delete("/api/floor/acuity/:id", requireAdmin, async (req, res) => {
    const deleted = await storage.deleteFloorRoomAcuity(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Acuity record not found" });
    res.json({ success: true });
  });

  app.delete("/api/floor/acuity", requireAdmin, async (req, res) => {
    const { unitId, date, shift } = req.body;
    if (!unitId || !date || !shift) return res.status(400).json({ error: "unitId, date, shift required" });
    const count = await storage.deleteFloorRoomAcuityByShift(unitId, date, shift as FloorShift);
    res.json({ success: true, deleted: count });
  });

  // ─── Floor Shift Reports ──────────────────────────────────────────────────────
  // Helper: check if a session userId is a Charge RN for the given shift(s) on that unit/date.
  async function isUserChargeRnForShifts(
    sessionUserId: string, unitId: string, date: string, allowedShifts: FloorShift[]
  ): Promise<boolean> {
    const assignments = await storage.getFloorShiftAssignments(unitId, date);
    const chargeAssignments = assignments.filter(a => a.isChargeRn && allowedShifts.includes(a.shift as FloorShift));
    for (const ca of chargeAssignments) {
      const staffMember = await storage.getFloorStaffById(ca.staffId);
      if (staffMember?.userId === sessionUserId) return true;
    }
    return false;
  }

  // For each shift, identify the incoming shift + the date offset for cross-day handoff.
  // night (D) handoff → day (D+1): the day Charge RN on the *next* date reads the night report.
  const INCOMING_SHIFT_ACCESS: Record<FloorShift, { shift: FloorShift; dateDelta: number } | null> = {
    day: { shift: "evening", dateDelta: 0 },   // evening on same day receives day handoff
    evening: { shift: "night", dateDelta: 0 }, // night on same day receives evening handoff
    night: { shift: "day", dateDelta: 1 },     // day on NEXT day receives night handoff (cross-date)
  };

  // Returns next calendar date in YYYY-MM-DD format.
  function addOneDay(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  app.get("/api/floor/reports", requireAuth, async (req, res) => {
    const { unitId, date, shift } = req.query;
    if (!unitId || !date || !shift) return res.status(400).json({ error: "unitId, date, and shift required" });

    const requestedShift = shift as FloorShift;
    const isAdmin = req.session?.user?.role === "admin";

    if (!isAdmin) {
      const sessionUserId = req.session?.user?.id;
      if (!sessionUserId) return res.status(403).json({ error: "Not authorized" });

      // Non-admin is authorized if they are:
      // (a) Charge RN for the requested shift on the requested date (report author), OR
      // (b) Charge RN for the incoming shift (which may be on the next calendar date for night→day).
      const authorizedOnRequestedDate = await isUserChargeRnForShifts(
        sessionUserId, unitId as string, date as string, [requestedShift]
      );

      let authorizedAsIncoming = false;
      const incoming = INCOMING_SHIFT_ACCESS[requestedShift];
      if (!authorizedOnRequestedDate && incoming) {
        const incomingDate = incoming.dateDelta > 0 ? addOneDay(date as string) : (date as string);
        authorizedAsIncoming = await isUserChargeRnForShifts(
          sessionUserId, unitId as string, incomingDate, [incoming.shift]
        );
      }

      if (!authorizedOnRequestedDate && !authorizedAsIncoming) {
        return res.status(403).json({ error: "Only designated Charge RNs or administrators may read shift reports" });
      }
    }

    // Return only the requested shift's report.
    const report = await storage.getFloorShiftReport(unitId as string, date as string, requestedShift);
    res.json(report ? [report] : []);
  });

  app.put("/api/floor/reports", requireAuth, async (req, res) => {
    const parsed = insertFloorShiftReportSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const isAdmin = req.session?.user?.role === "admin";

    // Verify chargeRnId is the actual designated Charge RN for this unit/date/shift.
    const designation = await storage.getFloorShiftAssignments(parsed.data.unitId, parsed.data.date);
    const chargeAssignment = designation.find(
      a => a.shift === parsed.data.shift && a.staffId === parsed.data.chargeRnId && a.isChargeRn
    );
    if (!chargeAssignment) {
      return res.status(400).json({ error: "The specified staff member is not the designated Charge RN for this shift" });
    }

    if (!isAdmin) {
      // Non-admin: verify the session user is linked to the designated Charge RN floor staff record.
      const sessionUserId = req.session?.user?.id;
      const chargeStaff = await storage.getFloorStaffById(parsed.data.chargeRnId);
      if (!chargeStaff || chargeStaff.userId !== sessionUserId) {
        return res.status(403).json({ error: "Only the designated Charge RN or an administrator may save shift reports" });
      }
    }

    const report = await storage.upsertFloorShiftReport(parsed.data);
    res.json(report);
  });

  app.delete("/api/floor/reports/:id", requireAdmin, async (req, res) => {
    const deleted = await storage.deleteFloorShiftReport(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Report not found" });
    res.json({ success: true });
  });

  return httpServer;
}
