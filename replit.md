# MediSched - Medical Staff Scheduling Application

## Overview
MediSched is a full-stack medical staff scheduling web application for managing provider schedules, LVN/RN assignments, cross-training records, quarterly rotations, daily sick call coverage, special clinic scheduling, and exportable reporting.

## Architecture

### Tech Stack
- **Frontend**: React + TypeScript, TanStack Query, Wouter routing, shadcn/ui, Tailwind CSS
- **Backend**: Node.js + Express
- **Database**: PostgreSQL via Neon serverless + Drizzle ORM
- **Auth**: Session-based (express-session + connect-pg-simple + bcrypt), roles: admin/user
- **Build**: Vite (frontend), tsx (server)
- **Export**: xlsx (SheetJS) for Excel, jsPDF + jspdf-autotable for PDF

### Project Structure
```
client/src/
  pages/
    Dashboard.tsx       - Overview statistics
    Schedule.tsx        - Provider AM/PM schedule + 2-week Outlook gap detector
    Staff.tsx           - Staff directory + float pool toggle
    Rotations.tsx       - Sick call coverage finder with equity sorting
    Availability.tsx    - Staff unavailability (Vacation/Sick/FMLA)
    Clinics.tsx         - Special clinic management + calendar + assignments
    Reports.tsx         - Cross-coverage + clinic assignment reports (PDF/Excel)
  lib/
    store.ts            - API hooks: useStaff, useUnavailability, useClinics + isStaffUnavailable, isClinicOpen helpers
    mockData.ts         - Re-exports shared types + constants
  components/           - Layout and UI components

server/
  index.ts              - Express server entry
  routes.ts             - All API routes
  storage.ts            - DatabaseStorage implementing IStorage interface
  seed.ts               - Seeds initial staff on first run
  db.ts                 - Drizzle + Neon DB setup

shared/
  schema.ts             - Drizzle table schemas + Zod insert schemas + types
```

### Database Tables
- `staff_members` - All staff; includes `phone`, `email`, `employmentType` (Full-time/Part-time/Per Diem/Extra Help), `isFloatPool`, `isActive`
- `coverage_records` - Sick call cross-coverage history
- `provider_schedules` - AM/PM schedule slots per provider per day
- `staff_unavailability` - Vacation/Sick/FMLA date ranges per staff
- `special_clinics` - Recurring clinic definitions (Diabetic Ed, Retinal AI, Flu Clinic, Nurse Visits)
- `clinic_day_overrides` - Manual close/open overrides for individual days per clinic
- `clinic_assignments` - Staff assignments to specific clinic days (LVN/RN + shift)
- `call_availability` - Nurse-registered available dates for on-call coverage (up to 2 months ahead)
- `shift_distribution_log` - Tracks extra shifts assigned to Part-time/Per Diem/Extra Help nurses for equitable distribution
- `users` - `id`, `name`, `email`, `passwordHash`, `role` (admin|user)
- `session` - Auto-created by connect-pg-simple for server-side sessions

### API Routes
- `GET /api/auth/setup-needed` — public; returns `{setupNeeded: bool}`
- `POST /api/auth/register` — public (only if no admin exists) or admin-only
- `POST /api/auth/login` / `POST /api/auth/logout`
- `GET /api/auth/me` — returns session user (requires auth)
- `GET /api/auth/users` — admin only; list all users
- `PATCH /api/auth/users/:id/role` — admin only; change role
- `DELETE /api/auth/users/:id` — admin only; cannot delete self
- Staff routes (all require auth, some admin-only):
  - `GET /api/staff` — active staff only
  - `GET /api/staff/inactive` — admin only; former/deactivated staff
  - `POST /api/staff` — add staff
  - `PATCH /api/staff/:id` — edit staff (non-admins cannot change structural fields or isActive)
  - `DELETE /api/staff/:id` — admin only; soft-delete (sets isActive=false, preserves history)
  - `POST /api/staff/:id/reactivate` — admin only; restore a former staff member
- All other routes require auth (`requireAuth` middleware):
  - `GET/POST/DELETE /api/coverage`
  - `GET/PUT /api/schedules`
  - `GET/POST/DELETE /api/unavailability`
  - `GET/POST/PATCH/DELETE /api/clinics`
  - `GET/POST/DELETE /api/clinic-overrides`
  - `GET/POST/DELETE /api/clinic-assignments`

### Employment Type System
- `employmentType` field on nurses (LVN/RN): Full-time, Part-time, Per Diem, Extra Help
- Shown as colored badge on staff cards and in availability panels
- Preferential order for additional shift approval: Part-time coded > Per Diem > Extra Help
- `EMPLOYMENT_PRIORITY` constant in schema.ts drives sorting across all features

### Shift Distribution Log
- Tracks extra shifts assigned to non-full-time nurses
- Shift Distribution tab on Availability page: per-nurse shift counts, sortable by least utilized first
- `POST /GET /DELETE /api/shift-distribution` routes; `useShiftDistributionLog` hook in store.ts

### Call Availability Calendar (on Availability page)
- LVN/RN register available dates up to 2 months ahead
- Multi-date batch entry: click/toggle multiple dates in the Add Availability dialog
- Day detail panel groups staff by employment type in preferential order
- `call_availability` table; `GET/POST/DELETE /api/call-availability`

## Floor Staffing Module

A fully isolated inpatient floor staffing module separate from the outpatient clinic:

### Pages
- `/floor` - Main floor staffing day view: date picker, unit selector, 3-shift grid (day/evening/night)
- `/floor/staff` - Floor staff roster: RNs, LVNs, CNAs with workload summaries

### Database Tables (new)
- `floor_units` - Floor unit definitions (name, room range, active flag)
- `floor_daily_rooms` - Open room count per unit per day
- `floor_staff` - Separate staff roster (role: RN/LVN/CNA, shift preference, employment type, contact)
- `floor_shift_assignments` - Staff-to-shift assignments (rooms array, acuity-weighted load, charge RN flag)
- `floor_room_acuity` - Per-room acuity levels (1=routine, 2=moderate, 3=high) per unit/date/shift
- `floor_shift_reports` - HIPAA-safe handoff reports (room notes w/o patient IDs, shift summary, huddle topics)

### API Routes (new, all under /api/floor/*)
- `GET/POST/PATCH/DELETE /api/floor/units`
- `GET/PUT /api/floor/daily-rooms`
- `GET/POST/PATCH/DELETE /api/floor/staff` + `POST /api/floor/staff/:id/reactivate`
- `GET/PUT/DELETE /api/floor/assignments`
- `GET/PUT /api/floor/acuity`
- `GET/PUT /api/floor/reports`

### Key Features
- 3-shift rotation (7a-3p, 3p-11p, 11p-7a) with staff filtered by shift preference
- Acuity-weighted auto-assign: greedy distribution minimizing variance in load
- Per-room acuity chip editing (hover to change level 1-3)
- Charge RN designation per shift
- HIPAA-safe shift handoff reports (room numbers only, no patient identifiers)
- Voice-to-text input via Web Speech API on all shift report text fields
- Carry-forward huddle topics to next shift
- Copy for Outlook + Download Excel export for floor schedule
- Per-staff workload summary (acuity-weighted rooms this week/month)

## Key Features
- Staff directory with add/edit + soft-delete ("No Longer Working") and reactivation (admin only); float pool designation (star icon on LVN/RN cards)
- Former Staff section (admin only, collapsed): shows inactive/deactivated staff with Reactivate button; history (coverage, schedules, unavailability) is preserved
- Seed data completely removed — app starts fresh with no sample staff; `seed.ts` is now a no-op
- Float pool staff: extra help LVN/RNs surfaced only when all regular staff are assigned
- Cross-training management for LVNs/RNs: grouped into Provider Specialties and Clinic Areas (Retinal AI, Flu Clinic, Nurse Visits)
- Provider LVNs Required setting: each provider can specify 1 or 2 LVNs needed (OB/GYN MDs = 2, NP/PA = 1)
- Provider-to-LVN assignment management
- Daily coverage & vacancy reporter with equitable coverage finder (sorted by fewest times covered); clinic-assigned LVNs shown as blocked with "Clinic: [ClinicName]" badge
- Staff unavailability tracking (Vacation/Sick/FMLA)
- 2-Week Schedule Outlook with gap detection and smart LVN suggestions: clinic-assigned LVNs excluded; LVNs whose own provider is off/admin/meeting are sorted to the top with "Provider Off" label; equity sort (fewest cross-specialty shifts) as tiebreaker
- Copy-to-Outlook day schedule button
- Special clinic scheduling: configure Diabetic Education, Retinal AI, Flu Clinic, Nurse Visits
  - Set operating days of week, open/close times, staff needed, date range
  - Calendar view with per-day staffing status (filled/gap/closed)
  - Manual open/close toggle per day (lock icon)
  - Staff assignment per clinic day: shift-aware conflict detection — staff already assigned to another clinic on the same shift are blocked (shown greyed out with reason); shift selector appears first so the list updates in real time. Backend 409 guard prevents double-booking. Primary/Cross-trained/Float badges shown; falls back to all LVN/RN if no one is cross-trained
- Diabetic Education: shared LVN pool rule (1 LVN covers all providers in the group); shown as 1 gap in 2-Week Outlook
- OB/GYN gap detection respects per-provider `lvnsRequired` setting (2 for MDs, 1 for NP/PA)
- Reports & Export page:
  - Cross-coverage summary: how many times each LVN covered out of specialty, which providers, which dates
  - Clinic assignment summary: shifts per clinic per staff member
  - Filterable by date range and role (LVN/RN)
  - Export as Excel (4 sheets: detail + summary for each report type) or PDF (3 pages)
