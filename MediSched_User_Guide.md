# MediSched — User Guide

**Ambulatory Care Center · Clinic Staffing Management System**

---

## Table of Contents

1. [Overview](#1-overview)
2. [Getting Started](#2-getting-started)
3. [Dashboard](#3-dashboard)
4. [Schedule Management](#4-schedule-management)
5. [Staff & Assignments](#5-staff--assignments)
6. [Availability & Absences](#6-availability--absences)
7. [Rotations & Coverage](#7-rotations--coverage)
8. [Special Clinics](#8-special-clinics)
9. [Reports & Export](#9-reports--export)
10. [3-Shift Facility (Acute Psychiatric Unit)](#10-3-shift-facility-acute-psychiatric-unit)
11. [User Management (Admin Only)](#11-user-management-admin-only)
12. [Common Workflows](#12-common-workflows)

---

## 1. Overview

MediSched is a web-based staffing and scheduling system for an outpatient ambulatory care clinic. It manages:

- **Provider daily schedules** (AM/PM shift types across all specialties)
- **LVN and RN assignments** to providers, clinics, and charge positions
- **Conflict detection** — automatically flags LVN double-booking and coverage gaps
- **Specialty clinics** — Nurse Visits, Retinal AI, Diabetic Education, Flu Clinic, and custom clinics
- **Staff absences and call availability** with equity-based shift distribution
- **Cross-coverage rotations** with a full audit trail
- **Inpatient APU staffing** through the standalone 3-Shift Facility module
- **Schedule exports** — color grid for Outlook/Gmail, Excel, and Print

There are two access levels:

| Role | Capabilities |
|------|-------------|
| **Admin** | Full access — manage users, edit all data, assign RN Charge positions, access Danger Zone tools |
| **Staff / User** | Clinical data access — schedules, clinics, coverage, staff; RN Charge Assignments are read-only; cannot manage other users |

---

## 2. Getting Started

### Logging In

Navigate to the application URL and enter your email and password. If the system is freshly set up, use the default admin credentials provided by your system administrator.

### Navigation

The left sidebar contains all main sections. The current page is highlighted in blue. The **3-Shift Facility** section appears at the bottom under an **Inpatient** divider and is entirely separate from the outpatient scheduling data.

Your name, role badge, and a sign-out button appear at the bottom of the sidebar. A live staff count (Providers / LVNs / RNs / Float Pool) is also displayed there at all times.

---

## 3. Dashboard

**Path:** `/` (Home)

The dashboard provides a real-time staffing snapshot for today.

### Cards at a Glance

| Card | What it shows |
|------|--------------|
| **Providers Active** | Total providers vs. those out today |
| **LVNs Active** | Total LVNs vs. those out today |
| **RNs Active** | Total RNs vs. those out today |
| **LVN Cross-Coverage** | Cross-specialty shifts logged this month |

### Staff Out Today

Lists every staff member currently on Vacation, Sick, FMLA, or Leave. Toggle **Week View** to see absences across the full current week in a calendar layout.

### Clinic Assignments Today

Shows all specialty clinics running today. Expand any clinic to see the assigned staff members, their roles, and which shift (AM / PM / Full Day) they are covering.

### Upcoming Assignments

Lists clinic assignments for the next 7 weekdays, with a count of available (non-absent) staff for each day.

### Staffing by Specialty

A visual bar breakdown of how many staff are assigned to each specialty across the clinic.

### Quarterly Rotation Status

Shows the current rotation cycle and the percentage of LVN staff participating in cross-coverage rotations this quarter.

---

## 4. Schedule Management

**Path:** `/schedule`

This is the central scheduling screen. It shows every provider's AM/PM shift and their LVN assignments for any date.

### View Modes

Use the segmented control at the top to switch views:

| View | Description |
|------|-------------|
| **Day** | Full grid for a single day — editable inline |
| **Week** | Mon–Fri week grid for all providers |
| **Month** | Monthly calendar overview |
| **2-Week Outlook** | Gap detection across the next 14 working days — a red badge shows the count of coverage gaps |

Date navigation arrows step by one day (Day view), one week (Week view), or one month (Month view). The 2-Week Outlook always starts from today.

### Provider Schedule Grid (Day View)

Each row shows one provider:

- **Provider name** and specialty group header (color-coded by specialty)
- **AM** column — `Patient Care`, `Admin`, `Off`, or `Meeting` (click to change)
- **PM** column — same options
- **Assigned Staff** column — LVNs (and their status/clinic assignment)

Click the pencil icon on any row to open the full edit dialog for that provider's day. From there you can:

- Change AM/PM shift types
- Assign, swap, or remove LVNs
- View cross-coverage suggestions

### RN Charge Assignments (Admin Only)

Below the provider grid, the day view shows four RN Charge position cards:

| Position | Coverage Area |
|----------|--------------|
| Charge RN — Med Home 1 | Internal/Family Med (Met Home 1) |
| Charge RN — Med Home 2 | Internal/Family Med (Met Home 2) |
| Charge RN — OB/GYN & Pediatrics | OB/GYN, Pediatrics |
| Floor RN — Allergy & Peds Assist | Allergy, Pediatrics (assist), Diabetic Education, Retinal AI |

Each card shows the **permanent RN** configured for that position. If the permanent RN is absent today, the card highlights in amber and suggests the next qualified replacement.

> **Editing RN Charge Assignments is restricted to Administrators.** Staff / User accounts see the RN Charge section in a read-only view (marked with an "Admin only" badge). Only an Admin can check, uncheck, or override an RN assignment for any position. This ensures that daily Charge RN decisions are always authorized by leadership before being committed.

### Conflict Detection Banner

A red banner appears automatically at the top of the Day view whenever a conflict is detected for the current date. Conflicts include:

- **LVN double-booked** — same LVN assigned to two patient-care providers in the same shift
- **Missing LVN coverage** — a provider is in Patient Care with no LVN assigned
- **LVN out today** — an assigned LVN is on leave
- **Clinic conflict** — an LVN is simultaneously assigned to a provider shift and a specialty clinic in the same time slot

The banner lists each conflict and offers suggested alternatives. Dismiss the banner with the × button; it reappears if you navigate away and return.

### Form C — Bulk Schedule Entry

The **Form C** button (top-right of the Schedule screen) opens a bulk entry dialog.

1. Select a **Provider** and a **Date**
2. Set the **AM** and **PM** shift types
3. Click **+ Add Row** to queue multiple entries at once
4. Click **Save All** to commit all rows to the database in a single operation

Form C is the fastest way to update multiple providers across the same date or to enter a recurring weekly pattern.

### Schedule Rules

- Providers default to **Patient Care** on weekdays and **Off** on weekends
- LVNs with `Full-time` or `Part-time` employment are prioritized for primary assignments
- An LVN's `lvnsRequired` setting on their provider determines how many LVNs appear in that provider's row
- The **Block Save** setting (retained internally, defaulting to ON) prevents saving a shift assignment that would cause a hard conflict

---

## 5. Staff & Assignments

**Path:** `/staff`

### Staff Directory

All active staff are listed with their name, role, specialty, employment type, and contact info. Use the search bar and role/specialty filters to find specific people.

Staff types supported:

| Type | Abbrev |
|------|--------|
| Medical Doctor | MD |
| Doctor of Osteopathy | DO |
| Nurse Practitioner | NP |
| Physician Assistant | PA |
| Licensed Vocational Nurse | LVN |
| Registered Nurse | RN |
| Pharmacist | — |

### Adding a Staff Member

Click **Add Staff Member** (Admin only). Fill in:

- **Name** and **Role**
- **Specialty** — from the full list of clinic areas and provider specialties
- **Employment Type** — Full-time, Part-time, Per Diem, or Extra Help
- **Phone** and **Email** (optional — used in schedule exports and email links)
- **LVNs Required** (Providers only) — typically 1 for NP/PA, may be 2 for high-volume MDs
- **Default Charge Position** (RNs only) — the RN charge slot this person defaults to each day
- **Float Pool** flag — marks this person as a pool resource not tied to a specialty
- **Cross-Trained Specialties** (LVNs) — additional specialties this LVN can cover

### LVN ↔ Provider Assignments

Each LVN can be assigned to one or more providers via the **Assigned To** field. This creates the default LVN row in the provider's daily schedule grid. You can also override assignments day-by-day in the Schedule screen.

### Finding Coverage for a Sick Call

The **Find Coverage** tool on the Staff page lets you search for LVNs or RNs who are either primarily assigned to or cross-trained for a specific specialty. Results are sorted by availability (not absent, not fully booked) and cross-coverage count (to maintain equity).

### Deactivating Staff

Click **Deactivate** on any staff card (Admin only). The person's history is preserved; they disappear from active scheduling but remain in all historical reports. Use **Reactivate** to restore them.

---

## 6. Availability & Absences

**Path:** `/availability`

This page has three tabs.

### Tab 1 — Absences & Unavailability

Record a leave period for any staff member:

| Field | Options |
|-------|---------|
| **Staff Member** | Any active staff |
| **Leave Type** | Vacation · Sick · FMLA · Leave |
| **Date Range** | Start date to End date |
| **Exclude Specific Dates** | Remove individual days from the range (e.g., a holiday mid-vacation) |
| **Note** | Optional internal note |

Staff with an active absence record are automatically excluded from coverage suggestions and clinic assignments for those dates.

### Tab 2 — Call Availability Calendar

For Part-time, Per Diem, and Extra Help staff who volunteer for additional shifts. Staff can be marked available for:

- **AM** only
- **PM** only
- **Full Day**

The calendar shows availability grouped by employment priority:

1. Part-time (coded)
2. Per Diem
3. Extra Help

This priority order determines who gets offered shifts first during equitable distribution.

### Tab 3 — Shift Distribution

Tracks the total number of extra shifts assigned to non-full-time staff during the current period. Sorted ascending by shift count so that staff with the fewest assignments are shown at the top — making equitable scheduling straightforward.

---

## 7. Rotations & Coverage

**Path:** `/rotations`

### Daily Coverage & Vacancies

**Step 1 — Report the absence.** Select the staff member who is out, the date, and whether the AM, PM, or both shifts need coverage.

**Step 2 — Find equitable coverage.** The system suggests the best-fit LVN by scoring candidates on:

- Not on vacation or sick leave that day
- Not already fully booked (assigned to a provider in both AM and PM patient care)
- Cross-trained or primarily assigned to the absent person's specialty
- Fewest cross-specialty coverage shifts this quarter (equity tiebreaker)

**Step 3 — Confirm the assignment.** The coverage is logged to the audit trail.

### Coverage History

A table showing all past coverage events with date, staff member, provider covered, and specialty. Export to CSV using the **Download CSV** button.

### Quarterly Rotations

For long-term specialty rotation assignments where an LVN is moved to cover a different specialty group for an entire quarter. Only LVNs are eligible; RNs are excluded from provider rotation.

---

## 8. Special Clinics

**Path:** `/clinics`

### What Is a Special Clinic?

A recurring or temporary clinic event that requires dedicated LVN/RN staffing separate from the main provider schedule. Examples:

- **Nurse Visits** — standalone nurse-only appointments
- **Retinal AI** — retinal screening clinic
- **Diabetic Education** — group or individual diabetes education sessions
- **Flu Clinic** — seasonal immunization clinic
- **Custom / Other** — any other named clinic

### Creating a Clinic

Click **Add Clinic**:

| Field | Description |
|-------|-------------|
| **Clinic Name** | Pick from the preset list or choose **Other** to type a custom name |
| **Days of Week** | Which weekdays this clinic runs |
| **Date Range** | Start and end dates (leave open-ended for permanent clinics) |
| **Open Time / Close Time** | Hours the clinic operates |
| **Staff Needed** | How many LVN/RN positions must be filled each day |
| **Color** | Badge color used in the calendar view |

### Assigning Staff to a Clinic

Click any day on the clinic's calendar and use **+ Assign** to add an available LVN or RN to that date. The system warns if the person is already committed to a provider shift in an overlapping time window.

### Temporary Closures

Use **Mark Closed** on any specific date to override the regular schedule for that day (e.g., a holiday or facility closure) without changing the clinic definition.

### Shift Awareness

When assigning LVNs to clinics, the system checks whether the clinic shift (AM / PM / Full Day) overlaps with any provider patient-care shift the LVN is already covering. An overlap triggers a conflict — the same LVN cannot be physically in two places at once.

---

## 9. Reports & Export

**Path:** `/reports`

The Reports page has four tabs. It opens on the **Schedule Export** tab by default.

### Tab 1 — Schedule Export

Export the full day schedule for any date in three formats:

#### Copy Color Grid
Copies a complete, formatted HTML table to your clipboard. Paste it directly into **Outlook** or **Gmail** and the color-coded layout (specialty header rows, green Patient Care, gray Off, clinic sections, RN charge positions) is fully preserved. No additional formatting needed.

**What is included in the grid:**
- All providers grouped by specialty, with AM/PM status and LVN assignments
- Specialty Clinics section with fill status
- RN Charge Assignments (all 4 positions)

#### Download Excel
Saves a `.xlsx` file (`MediSched_YYYY-MM-DD.xlsx`) with the same sections:
- Rows grouped by specialty
- Merged section header cells
- Column widths pre-set for readability
- Drop-down lists on unassigned LVN cells (showing available LVNs that day)

#### Print Schedule
Opens a print-ready version of the full day schedule in a new browser tab and launches the print dialog automatically.

**To use:** Select a date with the date picker, then click any of the three buttons.

### Tab 2 — Cross-Coverage

Historical report of every cross-specialty coverage event. Filter by date range and staff role (All / LVN / RN). Shows:

- Coverage events per staff member
- Which providers they covered and how many times
- Running totals by quarter

Export to Excel or PDF using the controls at the top of the page.

### Tab 3 — Clinic Assignments

Summary of all clinic staffing assignments within the selected date range. Grouped by staff member with a per-clinic breakdown. Also exportable to Excel or PDF.

### Tab 4 — Scheduling Conflicts

Audit log of detected conflicts (double assignments, policy violations). A red badge on the tab shows the count of active conflicts. Includes staff contact info for quick outreach.

---

## 10. 3-Shift Facility (Acute Psychiatric Unit)

**Path:** `/three-shift`

This is a fully self-contained module for the inpatient Acute Psychiatric Unit (APU) operating on a 24-hour, 3-shift cycle. All data is stored separately from the outpatient scheduling system.

> **Access to this module is controlled by Administrators.** Non-admin staff see a locked screen by default and must be granted access before they can use any part of this section. Admins always have full access and can set the access level for all other users.

### Access Control (Admin Only)

At the top of the 3-Shift Facility page, Administrators see an **Access Control** panel with three settings:

| Setting | Who it affects | What it does |
|---------|---------------|--------------|
| **Staff Locked** | All non-admin users | Page shows a locked screen with a description of the two access tiers. No data is visible or editable. |
| **Trial — Sample Data** | All non-admin users | Page opens with pre-loaded sample staff and patient data. Changes made in trial mode are for exploration only — **nothing is saved**. |
| **Functional — Existing Data** | All non-admin users | Full access to the real facility data stored in this browser. All changes are saved normally. |

Admins select one option at a time; the setting takes effect immediately for any non-admin currently viewing the page.

**When to use Trial vs. Functional:**
- Use **Trial** when onboarding new staff or letting someone preview the module before go-live. The sample data includes pre-filled shift assignments, team census counts, check frequencies, and a PC 2603 example.
- Use **Functional** when the module is ready for daily production use and the staff roster / shift data has been set up.

#### Sidebar Indicator

When the access level is **Staff Locked**, non-admin users see a small padlock icon next to the "3-Shift Facility" link in the sidebar. When access is Trial or Functional, the icon disappears and the **NEW** badge is shown instead.

### Dark Theme

The 3-Shift Facility uses a dark navy theme to visually distinguish it from the outpatient pages.

### Shift Structure

Three shifts run every day:

| Shift | Hours |
|-------|-------|
| Day | 7:00 AM – 3:00 PM |
| Evening | 3:00 PM – 11:00 PM |
| Night | 11:00 PM – 7:00 AM |

### Provider Teams

Three provider teams rotate intake responsibility:

| Team | Color Code |
|------|-----------|
| Team A | Red |
| Team B | Blue |
| Team C | Green |

Intake rotation is the only rotation tracked (teams do not rotate charge).

### Staffing Each Shift

For each shift, assign:

1. **Charge RN** — exactly one required per shift. Selected from your RN roster.
2. **Shift Staff** — LVNs and MAs assigned to the shift as a unit (not to individual providers)

The system flags a warning if a shift has no Charge RN assigned.

### Patient Distribution

Each team card shows:

- **Total Patients** — enter the current census count for this team
- **Acuity Breakdown** — Level 1 (stable), Level 2 (moderate), Level 3 (high acuity)
- **Sitter Requirement** — Level 3 patients automatically trigger a dedicated 1:1 sitter requirement (one sitter per Level 3 patient)

An acuity mismatch warning appears if the Level 1 + Level 2 + Level 3 counts do not add up to the total patient count.

### Check Frequency per Bed

Each patient slot (labeled Bed 1, Bed 2, etc.) has a toggleable check frequency:

| Label | Color | Meaning |
|-------|-------|---------|
| **Q15** | Red | 15-minute safety checks |
| **Q60** | Blue | Standard hourly checks |

Tap any bed slot to toggle between the two. Defaults to Q60 (hourly).

### PC 2603 Flag

Any bed slot can be flagged as **PC 2603** (Penal Code 2603 — court-ordered involuntary psychiatric medication):

- **Grey "2603?"** — not flagged
- **Purple "PC 2603"** — flagged

Tap the small button below the Q15/Q60 toggle to flag or unflag. A purple badge in the Patient Distribution header shows the total PC 2603 count for the day. Use **Filter: PC 2603 only** to collapse all non-flagged bed slots across all three team cards for a quick focused view.

### Staff Roster

Click **Manage Staff** to maintain the 3-Shift Facility–specific staff roster. This roster is completely separate from the outpatient staff directory. Add, edit, or remove APU staff with roles: Charge RN, RN, LVN, or MA.

### Data Persistence

All 3-Shift Facility data is stored in your browser's local storage under keys prefixed `3sf_`. It is date-specific and does not sync to the server database. To transfer data to another device, use your browser's export tools or coordinate with your system administrator.

---

## 11. User Management (Admin Only)

**Path:** `/users`

### Managing Accounts

| Action | Description |
|--------|-------------|
| **Add User** | Create a login with name, email, password, and role (Admin or Staff) |
| **Change Role** | Toggle any user between Admin and Staff access |
| **Delete User** | Remove a user's login access permanently |

### Permission Summary

| Feature | Admin | Staff |
|---------|-------|-------|
| View all pages | ✓ | ✓ |
| Edit schedules, clinics, staff | ✓ | ✓ |
| **Assign / edit RN Charge positions** | **✓** | **✗ (read-only)** |
| **Access 3-Shift Facility** | **✓ (always)** | **Requires admin grant** |
| **Set 3-Shift Facility access level** | **✓** | **✗** |
| Manage other user accounts | ✓ | ✗ |
| Access Danger Zone | ✓ | ✗ |

### Danger Zone — Reset Schedule Data

This tool clears calendar-based records without removing staff definitions or clinic configurations. Use it to reset data for a specific date range or wipe all historical records.

**What is deleted:** Provider schedules, coverage records, unavailability entries, clinic assignments, and RN charge assignments.

**What is preserved:** Staff member profiles, clinic definitions, user accounts.

> This action is irreversible. A confirmation prompt is required.

---

## 12. Common Workflows

### Morning Setup — Enter Today's Schedule

1. Go to **Schedule Management** → Day view (today's date is default)
2. Scan the **Conflict Banner** — resolve any flagged issues before proceeding
3. For each provider in Patient Care, confirm their LVN is assigned in the grid
4. Use the **Form C** button to bulk-enter any changes across multiple providers at once
5. Check **Special Clinics** (`/clinics`) to confirm clinic staff is assigned

### Handling a Sick Call

1. Go to **Rotations & Coverage** → Daily Coverage
2. Select the absent staff member, date, and affected shift
3. Click **Find Coverage** — review the suggested replacement (cross-trained, available, lowest cross-coverage count)
4. Confirm the assignment; it is automatically logged to the coverage history

### Exporting the Day Schedule for Email

1. Go to **Reports & Export** → Schedule Export tab
2. Set the date picker to the target date
3. Click **Copy Color Grid**
4. Open a new email in Outlook or Gmail and paste (`Ctrl+V` / `Cmd+V`)
5. The full colored table appears inline — ready to send

### Adding a New Specialty Clinic

1. Go to **Special Clinics**
2. Click **Add Clinic**
3. Select a preset name or choose **Other** and type a custom name
4. Set the days of the week, date range, hours, and staff needed
5. Save — the clinic now appears in the weekly calendar and can be staffed day by day

### Recording a Staff Absence

1. Go to **Availability & Absences** → Absences tab
2. Click **Add Absence**
3. Select the staff member, leave type, and date range
4. Optionally exclude specific dates within the range
5. Save — the person is automatically excluded from coverage suggestions and schedule exports for those dates

### Enabling 3-Shift Facility Access for Staff (Admin only)

1. Log in as an **Administrator** and go to **3-Shift Facility**
2. Find the **Access Control** panel at the top of the page
3. Choose one of the three settings:
   - **Staff Locked** — no access for non-admin staff (default)
   - **Trial — Sample Data** — staff can explore with pre-loaded example data (nothing is saved)
   - **Functional — Existing Data** — staff have full access to real facility data
4. The setting applies immediately; non-admin users on the page will see the change on their next visit

### Setting Up the APU Day

1. Go to **3-Shift Facility** using the sidebar link (ensure an admin has granted access if you are a non-admin)
2. Use the date navigator to select today
3. For each of the three shifts, assign a **Charge RN** and any **Shift Staff**
4. In the team cards, enter each team's **Total Patients** and **Acuity Breakdown**
5. Per bed slot, set the **Check Frequency** (Q15 or Q60) and flag any **PC 2603** patients
6. Data saves automatically as you make changes (note: no data is saved in Trial mode)

---

*MediSched — Internal Use Only · Ambulatory Care Center*
