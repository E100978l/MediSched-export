/**
 * 3-Shift Facility — Completely standalone module.
 *
 * ISOLATION RULES (enforced throughout this file):
 * - All data lives in localStorage under the "3sf_" prefix.
 * - This module has NO connection to outpatient schedule data, Med Home, OB/GYN,
 *   or any other section. No imports from the outpatient store, staff hooks, or
 *   schedule state.
 * - Provider teams (Red / Blue / Green) are for PATIENT INTAKE ROTATION ONLY.
 *   They have nothing to do with RNs, LVNs, or MAs.
 * - Exactly ONE Charge RN per shift.
 * - LVNs and MAs are assigned to the SHIFT AS A WHOLE — not to any team or provider.
 * - Patient volume is variable and may change. No hardcoded targets.
 * - High-acuity (Level 3) patients require 1 dedicated sitter each (24/7 observation).
 *   Sitters are fully dedicated and cannot be assigned to any other task.
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { format, addDays, subDays, differenceInCalendarDays } from "date-fns";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  ChevronLeft, ChevronRight, Users, Plus, X, Building2,
  CalendarDays, AlertCircle, Info, Eye, ShieldAlert,
  Lock, FlaskConical, Database, ShieldCheck, Unlock,
  CheckCircle2, Clock, ChevronDown, ChevronUp, FileText,
  Pill, ClipboardCheck, TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type TSFRole = "Charge RN" | "RN" | "LVN" | "MA";
type TeamColor = "red" | "blue" | "green";
type ShiftId = "day" | "evening" | "night";

interface TSFStaff {
  id: string;
  name: string;
  role: TSFRole;
}

interface TSFShiftData {
  chargeRnId: string;
  assignedStaffIds: string[];
}

interface TSFTeamData {
  totalPatients: number;
  acuity: { level1: number; level2: number; level3: number };
}

type CheckFreq = "q15" | "hourly";

interface MedPassStatusEntry {
  status: "passed" | "unavailable";
  reason?: string;
  reasonText?: string;
  lvnId: string;
  lvnName: string;
  timestamp: string;
}

interface TSFDayData {
  date: string;
  shifts: Record<ShiftId, TSFShiftData>;
  teams: Record<TeamColor, TSFTeamData>;
  // Keyed by "${teamId}-${slotIndex}" (e.g. "red-0"). No patient identifiers — bed slot only.
  patientChecks: Record<string, CheckFreq>;
  // true = patient in this bed slot is under Penal Code 2603 (court-ordered involuntary psychiatric medication).
  pc2603: Record<string, boolean>;
  // Med pass & RN documentation — all keys use "${shiftId}_${...}" pattern.
  // Optional so existing saved data loads cleanly without migration.
  rnCellAssignments?: Record<string, string[]>;       // key: "${shiftId}_${rnId}" → cellKey[]
  medPassStatus?: Record<string, MedPassStatusEntry>; // key: "${shiftId}_${cellKey}"
  cellDocumentation?: Record<string, { note: string; documented: boolean }>; // key: "${shiftId}_${cellKey}"
  rnAttestations?: Record<string, { attested: boolean; timestamp: string }>;  // key: "${shiftId}_${rnId}"
  medUnavailableReasons?: Record<string, string>;     // key: "${shiftId}_${cellKey}" → RN reason text
  nextAdmitRnId?: Record<string, string>;             // key: shiftId → rnId who is up for the next admit
  lvnSupervisors?: Record<string, string>;            // key: "${shiftId}_${lvnId}" → supervising rnId
  rnAdverseAcknowledgments?: Record<string, { rnId: string; note: string; timestamp: string }>; // key: "${shiftId}_${lvnId}_${cellKey}"
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_STAFF_KEY = "3sf_staff";
const STORAGE_DAY_PREFIX = "3sf_day_";
const STORAGE_ACCESS_KEY = "3sf_access_mode";

const UNAVAILABILITY_REASONS = [
  "Not available in Pyxis",
  "Patient refused",
  "Hold order",
  "Medication not stocked",
  "Other",
] as const;

type AccessMode = "locked" | "trial" | "full";

const SHIFTS: { id: ShiftId; label: string; time: string; accentColor: string; borderColor: string; headerBg: string; pillBg: string }[] = [
  {
    id: "day",
    label: "Day",
    time: "7a – 3p",
    accentColor: "text-sky-300",
    borderColor: "border-sky-600",
    headerBg: "bg-sky-900/60",
    pillBg: "bg-sky-800/50 text-sky-200",
  },
  {
    id: "evening",
    label: "Evening",
    time: "3p – 11p",
    accentColor: "text-amber-300",
    borderColor: "border-amber-600",
    headerBg: "bg-amber-900/50",
    pillBg: "bg-amber-800/50 text-amber-200",
  },
  {
    id: "night",
    label: "Night",
    time: "11p – 7a",
    accentColor: "text-indigo-300",
    borderColor: "border-indigo-500",
    headerBg: "bg-indigo-900/60",
    pillBg: "bg-indigo-800/50 text-indigo-200",
  },
];

const TEAMS: { id: TeamColor; label: string; dotBg: string; borderColor: string; headerBg: string; intakeBadge: string }[] = [
  {
    id: "red",
    label: "Team Red",
    dotBg: "bg-red-400",
    borderColor: "border-red-700",
    headerBg: "bg-red-900/50",
    intakeBadge: "bg-red-600 text-white",
  },
  {
    id: "blue",
    label: "Team Blue",
    dotBg: "bg-blue-400",
    borderColor: "border-blue-700",
    headerBg: "bg-blue-900/50",
    intakeBadge: "bg-blue-600 text-white",
  },
  {
    id: "green",
    label: "Team Green",
    dotBg: "bg-emerald-400",
    borderColor: "border-emerald-700",
    headerBg: "bg-emerald-900/50",
    intakeBadge: "bg-emerald-600 text-white",
  },
];

const TEAM_ORDER: TeamColor[] = ["red", "blue", "green"];

// Patient intake rotates: Team Red → Blue → Green → Red …
// Calculated from a fixed epoch so it's deterministic across page loads.
const EPOCH_DATE = new Date("2024-01-01");
function getIntakeTeam(date: Date): TeamColor {
  const daysSinceEpoch = differenceInCalendarDays(date, EPOCH_DATE);
  return TEAM_ORDER[((daysSinceEpoch % 3) + 3) % 3];
}

const EMPTY_SHIFT: TSFShiftData = { chargeRnId: "", assignedStaffIds: [] };

function emptyDayData(dateStr: string): TSFDayData {
  return {
    date: dateStr,
    shifts: { day: { ...EMPTY_SHIFT }, evening: { ...EMPTY_SHIFT }, night: { ...EMPTY_SHIFT } },
    teams: {
      red:   { totalPatients: 0, acuity: { level1: 0, level2: 0, level3: 0 } },
      blue:  { totalPatients: 0, acuity: { level1: 0, level2: 0, level3: 0 } },
      green: { totalPatients: 0, acuity: { level1: 0, level2: 0, level3: 0 } },
    },
    patientChecks: {},
    pc2603: {},
  };
}

const ROLE_BADGE: Record<TSFRole, string> = {
  "Charge RN": "bg-violet-900/60 text-violet-200 border-violet-600",
  "RN":        "bg-blue-900/60 text-blue-200 border-blue-600",
  "LVN":       "bg-teal-900/60 text-teal-200 border-teal-600",
  "MA":        "bg-amber-900/60 text-amber-200 border-amber-600",
};

const DEFAULT_STAFF: TSFStaff[] = [
  { id: "tsf-s1", name: "Charge RN A", role: "Charge RN" },
  { id: "tsf-s2", name: "Charge RN B", role: "Charge RN" },
  { id: "tsf-s3", name: "Charge RN C", role: "Charge RN" },
  { id: "tsf-rn1", name: "RN 1",       role: "RN" },
  { id: "tsf-rn2", name: "RN 2",       role: "RN" },
  { id: "tsf-s4", name: "LVN 1",       role: "LVN" },
  { id: "tsf-s5", name: "LVN 2",       role: "LVN" },
  { id: "tsf-s6", name: "LVN 3",       role: "LVN" },
  { id: "tsf-s7", name: "MA 1",        role: "MA" },
  { id: "tsf-s8", name: "MA 2",        role: "MA" },
];

// ── Trial-mode sample data ─────────────────────────────────────────────────────
// Used when an administrator grants "Trial" access to non-admin users.
// Sample data only — never persisted to localStorage.

const TRIAL_STAFF: TSFStaff[] = [
  { id: "tr-s1",  name: "Sarah Mitchell",  role: "Charge RN" },
  { id: "tr-s2",  name: "David Park",      role: "Charge RN" },
  { id: "tr-s3",  name: "Lisa Torres",     role: "Charge RN" },
  { id: "tr-rn1", name: "Rachel Adams",    role: "RN" },
  { id: "tr-rn2", name: "Michael Chen",    role: "RN" },
  { id: "tr-rn3", name: "Sofia Patel",     role: "RN" },
  { id: "tr-s4",  name: "Maria Gomez",     role: "LVN" },
  { id: "tr-s5",  name: "James Okoro",     role: "LVN" },
  { id: "tr-s6",  name: "Priya Sharma",    role: "LVN" },
  { id: "tr-s7",  name: "Kevin Nguyen",    role: "MA" },
  { id: "tr-s8",  name: "Ana Reyes",       role: "MA" },
];

function trialDayData(dateStr: string): TSFDayData {
  return {
    date: dateStr,
    shifts: {
      day:     { chargeRnId: "tr-s1", assignedStaffIds: ["tr-rn1", "tr-rn2", "tr-s4", "tr-s5", "tr-s7"] },
      evening: { chargeRnId: "tr-s2", assignedStaffIds: ["tr-rn3", "tr-s6", "tr-s8"] },
      night:   { chargeRnId: "tr-s3", assignedStaffIds: ["tr-s5"] },
    },
    teams: {
      red:   { totalPatients: 8, acuity: { level1: 4, level2: 3, level3: 1 } },
      blue:  { totalPatients: 7, acuity: { level1: 3, level2: 3, level3: 1 } },
      green: { totalPatients: 6, acuity: { level1: 3, level2: 2, level3: 1 } },
    },
    patientChecks: { "red-0": "q15", "blue-0": "q15", "green-0": "q15" },
    pc2603: { "red-2": true },
    // Sample RN cell assignments for Day shift
    // Charge RN (Sarah Mitchell) carries a lighter patient load — she also manages shift duties.
    // Regular RNs (Rachel, Michael) carry the larger share. All rotate admits.
    rnCellAssignments: {
      "day_tr-s1":  ["red-6","red-7"],
      "day_tr-rn1": ["red-0","red-1","red-2","red-3","blue-0","blue-1","blue-2"],
      "day_tr-rn2": ["red-4","red-5","blue-3","blue-4","blue-5","blue-6","green-0","green-1","green-2","green-3","green-4","green-5"],
      "evening_tr-s2":  ["red-5","red-6","red-7"],
      "evening_tr-rn3": ["red-0","red-1","red-2","red-3","red-4","blue-0","blue-1","blue-2","blue-3","blue-4","blue-5","blue-6","green-0","green-1","green-2","green-3","green-4","green-5"],
    },
    // Sample LVN med pass status for Day shift
    medPassStatus: {
      "day_red-0": { status: "passed",      lvnId: "tr-s4", lvnName: "Maria Gomez",  timestamp: `${dateStr}T08:14:00` },
      "day_red-1": { status: "passed",      lvnId: "tr-s4", lvnName: "Maria Gomez",  timestamp: `${dateStr}T08:17:00` },
      "day_red-2": { status: "unavailable", reason: "Patient refused", lvnId: "tr-s4", lvnName: "Maria Gomez", timestamp: `${dateStr}T08:21:00` },
      "day_red-3": { status: "passed",      lvnId: "tr-s5", lvnName: "James Okoro",  timestamp: `${dateStr}T08:30:00` },
      "day_red-6": { status: "passed",      lvnId: "tr-s4", lvnName: "Maria Gomez",  timestamp: `${dateStr}T08:35:00` },
      "day_red-7": { status: "passed",      lvnId: "tr-s4", lvnName: "Maria Gomez",  timestamp: `${dateStr}T08:38:00` },
      "day_blue-0": { status: "passed",     lvnId: "tr-s5", lvnName: "James Okoro",  timestamp: `${dateStr}T08:45:00` },
      "day_blue-1": { status: "passed",     lvnId: "tr-s5", lvnName: "James Okoro",  timestamp: `${dateStr}T08:48:00` },
    },
    // Sample RN documentation
    cellDocumentation: {
      "day_red-0": { note: "Patient alert and cooperative. Vitals stable.", documented: true },
      "day_red-1": { note: "Resting comfortably. No new complaints.", documented: true },
      "day_red-2": { note: "", documented: false },
      "day_red-6": { note: "Patient calm, cooperative with morning care.", documented: true },
      "day_red-7": { note: "Oriented x3. Requesting family contact info verified.", documented: true },
      "day_blue-0": { note: "Patient oriented x3. Ambulating with assist.", documented: true },
    },
    // Sample RN attestations — Sarah Mitchell (Charge RN) and Rachel Adams attested, Michael Chen has not
    rnAttestations: {
      "day_tr-s1":  { attested: true, timestamp: `${dateStr}T09:05:00` },
      "day_tr-rn1": { attested: true, timestamp: `${dateStr}T09:15:00` },
    },
    // Sample RN-provided reason for med unavailability
    medUnavailableReasons: {
      "day_red-2": "Patient verbally refused and declined re-attempt. Attending notified.",
    },
    // Michael Chen (tr-rn2) is up for the next admit on day shift — he has the lightest load after attestations
    nextAdmitRnId: { day: "tr-rn2" },
  };
}

// ── Local-storage helpers ─────────────────────────────────────────────────────

function loadStaff(): TSFStaff[] {
  try {
    const raw = localStorage.getItem(STORAGE_STAFF_KEY);
    if (raw) return JSON.parse(raw) as TSFStaff[];
  } catch {}
  return DEFAULT_STAFF;
}

function saveStaff(staff: TSFStaff[]) {
  localStorage.setItem(STORAGE_STAFF_KEY, JSON.stringify(staff));
}

function loadDayData(dateStr: string): TSFDayData {
  try {
    const raw = localStorage.getItem(STORAGE_DAY_PREFIX + dateStr);
    if (raw) return JSON.parse(raw) as TSFDayData;
  } catch {}
  return emptyDayData(dateStr);
}

function saveDayData(data: TSFDayData) {
  localStorage.setItem(STORAGE_DAY_PREFIX + data.date, JSON.stringify(data));
}

function nanToZero(v: number) {
  return isNaN(v) ? 0 : v;
}

// ── Med Pass Section ─────────────────────────────────────────────────────────
// Completely self-contained sub-component rendered below the shift panels.

interface MedPassSectionProps {
  staff: TSFStaff[];
  dayData: TSFDayData;
  setDayData: React.Dispatch<React.SetStateAction<TSFDayData>>;
}

function MedPassSection({ staff, dayData, setDayData }: MedPassSectionProps) {
  const [activeShift, setActiveShift] = useState<ShiftId>("day");
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [unavailForms, setUnavailForms] = useState<Record<string, { reason: string; reasonText: string }>>({});
  const [ackNoteForms, setAckNoteForms] = useState<Record<string, string>>({}); // key: "${shiftId}_${lvnId}_${cellKey}"

  const rnCellAssignments        = dayData.rnCellAssignments        ?? {};
  const medPassStatus            = dayData.medPassStatus            ?? {};
  const cellDocumentation        = dayData.cellDocumentation        ?? {};
  const rnAttestations           = dayData.rnAttestations           ?? {};
  const medUnavailReasons        = dayData.medUnavailableReasons    ?? {};
  const nextAdmitRnId            = dayData.nextAdmitRnId            ?? {};
  const lvnSupervisors           = dayData.lvnSupervisors           ?? {};
  const rnAdverseAcknowledgments = dayData.rnAdverseAcknowledgments ?? {};

  const shiftData = dayData.shifts[activeShift];

  const allCells = useMemo(() =>
    TEAM_ORDER.flatMap(t =>
      Array.from({ length: dayData.teams[t].totalPatients }, (_, i) => `${t}-${i}`)
    ), [dayData.teams]);

  // Include the Charge RN first — they rotate admits alongside regular RNs.
  const rnsOnShift: TSFStaff[] = useMemo(() => {
    const chargeRn = shiftData.chargeRnId ? staff.find(s => s.id === shiftData.chargeRnId) : undefined;
    const regularRns = shiftData.assignedStaffIds
      .map(id => staff.find(s => s.id === id))
      .filter((s): s is TSFStaff => !!s && s.role === "RN");
    return chargeRn ? [chargeRn, ...regularRns] : regularRns;
  }, [shiftData.chargeRnId, shiftData.assignedStaffIds, staff]);

  const lvnsOnShift: TSFStaff[] = useMemo(() =>
    shiftData.assignedStaffIds
      .map(id => staff.find(s => s.id === id))
      .filter((s): s is TSFStaff => !!s && s.role === "LVN"),
    [shiftData.assignedStaffIds, staff]);

  const cellOwnerMap = useMemo(() => {
    const map: Record<string, string> = {};
    rnsOnShift.forEach(rn => {
      const cells = rnCellAssignments[`${activeShift}_${rn.id}`] ?? [];
      cells.forEach(ck => { map[ck] = rn.id; });
    });
    return map;
  }, [rnsOnShift, rnCellAssignments, activeShift]);

  // ── Mutators ──────────────────────────────────────────────────────────────

  const toggleCellForRn = useCallback((rnId: string, cellKey: string) => {
    setDayData(prev => {
      const key = `${activeShift}_${rnId}`;
      const existing = (prev.rnCellAssignments ?? {})[key] ?? [];
      const isAssigned = existing.includes(cellKey);
      const newCells = isAssigned
        ? existing.filter(c => c !== cellKey)
        : [...existing, cellKey];
      const prevAssignments = { ...(prev.rnCellAssignments ?? {}) };
      // Remove from any other RN first
      if (!isAssigned) {
        rnsOnShift.forEach(rn => {
          if (rn.id !== rnId) {
            const rk = `${activeShift}_${rn.id}`;
            if (prevAssignments[rk]?.includes(cellKey)) {
              prevAssignments[rk] = prevAssignments[rk].filter(c => c !== cellKey);
            }
          }
        });
      }
      return { ...prev, rnCellAssignments: { ...prevAssignments, [key]: newCells } };
    });
  }, [activeShift, rnsOnShift, setDayData]);

  const saveMedPass = useCallback((cellKey: string, entry: MedPassStatusEntry) => {
    setDayData(prev => ({
      ...prev,
      medPassStatus: { ...(prev.medPassStatus ?? {}), [`${activeShift}_${cellKey}`]: entry },
    }));
  }, [activeShift, setDayData]);

  const clearMedPass = useCallback((cellKey: string) => {
    setDayData(prev => {
      const passKey = `${activeShift}_${cellKey}`;
      const lvnId = prev.medPassStatus?.[passKey]?.lvnId;

      const nextMedPass = { ...(prev.medPassStatus ?? {}) };
      delete nextMedPass[passKey];

      const nextReasons = { ...(prev.medUnavailableReasons ?? {}) };
      delete nextReasons[passKey];

      const nextAcks = { ...(prev.rnAdverseAcknowledgments ?? {}) };
      if (lvnId) {
        delete nextAcks[`${activeShift}_${lvnId}_${cellKey}`];
      }

      return {
        ...prev,
        medPassStatus: nextMedPass,
        medUnavailableReasons: nextReasons,
        rnAdverseAcknowledgments: nextAcks,
      };
    });
  }, [activeShift, setDayData]);

  const setCellDoc = useCallback((cellKey: string, note: string, documented: boolean) => {
    setDayData(prev => ({
      ...prev,
      cellDocumentation: {
        ...(prev.cellDocumentation ?? {}),
        [`${activeShift}_${cellKey}`]: { note, documented },
      },
    }));
  }, [activeShift, setDayData]);

  const setUnavailableReason = useCallback((cellKey: string, reason: string) => {
    setDayData(prev => ({
      ...prev,
      medUnavailableReasons: {
        ...(prev.medUnavailableReasons ?? {}),
        [`${activeShift}_${cellKey}`]: reason,
      },
    }));
  }, [activeShift, setDayData]);

  const attestRn = useCallback((rnId: string) => {
    setDayData(prev => ({
      ...prev,
      rnAttestations: {
        ...(prev.rnAttestations ?? {}),
        [`${activeShift}_${rnId}`]: { attested: true, timestamp: new Date().toISOString() },
      },
    }));
  }, [activeShift, setDayData]);

  const setNextAdmit = useCallback((rnId: string) => {
    setDayData(prev => ({
      ...prev,
      nextAdmitRnId: {
        ...(prev.nextAdmitRnId ?? {}),
        [activeShift]: rnId,
      },
    }));
  }, [activeShift, setDayData]);

  const setLvnSupervisor = useCallback((lvnId: string, rnId: string) => {
    setDayData(prev => ({
      ...prev,
      lvnSupervisors: {
        ...(prev.lvnSupervisors ?? {}),
        [`${activeShift}_${lvnId}`]: rnId,
      },
    }));
  }, [activeShift, setDayData]);

  const acknowledgeAdverseEvent = useCallback((lvnId: string, cellKey: string, note: string) => {
    const ackKey = `${activeShift}_${lvnId}_${cellKey}`;
    const supervisorRnId = lvnSupervisors[`${activeShift}_${lvnId}`] ?? "";
    setDayData(prev => ({
      ...prev,
      rnAdverseAcknowledgments: {
        ...(prev.rnAdverseAcknowledgments ?? {}),
        [ackKey]: { rnId: supervisorRnId, note, timestamp: new Date().toISOString() },
      },
    }));
    setAckNoteForms(f => { const n = { ...f }; delete n[ackKey]; return n; });
  }, [activeShift, lvnSupervisors, setDayData]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const canAttest = useCallback((rnId: string): boolean => {
    const cells = rnCellAssignments[`${activeShift}_${rnId}`] ?? [];
    if (cells.length === 0) return false;
    const allDocumented = cells.every(ck => cellDocumentation[`${activeShift}_${ck}`]?.documented === true);
    const unavailCells = cells.filter(ck => medPassStatus[`${activeShift}_${ck}`]?.status === "unavailable");
    const allUnavailHaveReasons = unavailCells.every(ck => {
      const r = medUnavailReasons[`${activeShift}_${ck}`];
      return r && r.trim().length > 0;
    });
    if (!allDocumented || !allUnavailHaveReasons) return false;
    // Block attestation if any supervised LVN has unacknowledged adverse events
    const supervisedLvns = lvnsOnShift.filter(
      lvn => lvnSupervisors[`${activeShift}_${lvn.id}`] === rnId
    );
    for (const lvn of supervisedLvns) {
      const lvnAdverse = allCells.filter(ck =>
        medPassStatus[`${activeShift}_${ck}`]?.status === "unavailable" &&
        medPassStatus[`${activeShift}_${ck}`]?.lvnId === lvn.id
      );
      for (const ck of lvnAdverse) {
        if (!rnAdverseAcknowledgments[`${activeShift}_${lvn.id}_${ck}`]?.timestamp) return false;
      }
    }
    return true;
  }, [rnCellAssignments, cellDocumentation, medPassStatus, medUnavailReasons, activeShift,
      lvnsOnShift, lvnSupervisors, rnAdverseAcknowledgments, allCells]);

  const formatTime = (iso: string) => {
    try { return format(new Date(iso), "h:mm a"); } catch { return iso; }
  };

  const teamLabel = (cellKey: string) => {
    const [team] = cellKey.split("-");
    return team.charAt(0).toUpperCase() + team.slice(1);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <Pill className="h-5 w-5 text-teal-400" />
        <h2 className="text-base font-semibold text-slate-100 uppercase tracking-wider">
          Medication Pass &amp; Documentation
        </h2>
      </div>

      {/* Shift selector tabs */}
      <div className="flex gap-1 border border-slate-700 rounded-lg p-1 bg-slate-800/60 w-fit">
        {SHIFTS.map(s => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActiveShift(s.id)}
            data-testid={`medpass-tab-${s.id}`}
            className={cn(
              "px-4 py-1.5 rounded text-sm font-medium transition-all",
              activeShift === s.id
                ? cn("bg-slate-700 text-white shadow", s.accentColor)
                : "text-slate-400 hover:text-slate-200"
            )}
          >
            {s.label}
            <span className="text-xs ml-1 text-slate-500">{s.time}</span>
          </button>
        ))}
      </div>

      {allCells.length === 0 && (
        <p className="text-sm text-slate-400 italic border border-dashed border-slate-600 rounded-lg p-4 bg-slate-800/40">
          No patient beds recorded yet. Enter patient counts in the Patient Distribution section above to unlock medication pass tracking.
        </p>
      )}

      {allCells.length > 0 && (
        <div className="grid grid-cols-1 gap-4">

          {/* ── Panel 0: Admit Rotation ────────────────────────────────────── */}
          <Card className="border border-slate-700 bg-slate-800/70">
            <CardHeader className="py-3 px-4 bg-slate-800 rounded-t-lg border-b border-slate-700">
              <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Users className="h-4 w-4 text-emerald-400" />
                Admit Rotation
                <span className="text-xs font-normal text-slate-400 ml-1">
                  — Charge RN assigns the next patient based on workload
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {rnsOnShift.length === 0 ? (
                <p className="text-sm text-slate-400 italic">
                  No Charge RN or RN staff assigned to this shift.
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-500 mb-3">
                    Current cell counts reflect assigned beds. Click <strong className="text-slate-300">Set as Next Admit</strong> to designate who takes the next incoming patient.
                  </p>

                  {/* Workload + next admit selection rows */}
                  {(() => {
                    const maxCells = Math.max(1, ...rnsOnShift.map(rn =>
                      (rnCellAssignments[`${activeShift}_${rn.id}`] ?? []).length
                    ));
                    return rnsOnShift.map(rn => {
                      const cells = rnCellAssignments[`${activeShift}_${rn.id}`] ?? [];
                      const isNext = nextAdmitRnId[activeShift] === rn.id;
                      const attested = rnAttestations[`${activeShift}_${rn.id}`]?.attested;
                      const barPct = cells.length === 0 ? 0 : Math.round((cells.length / maxCells) * 100);

                      return (
                        <div
                          key={rn.id}
                          data-testid={`admit-rotation-row-${activeShift}-${rn.id}`}
                          className={cn(
                            "flex items-center gap-3 rounded-lg px-3 py-2.5 border transition-colors",
                            isNext
                              ? "bg-emerald-900/25 border-emerald-600/60"
                              : "bg-slate-800/40 border-slate-700"
                          )}
                        >
                          {/* Role + name */}
                          <div className="flex items-center gap-2 min-w-[160px]">
                            <Badge variant="outline" className={cn("text-[10px] h-4 px-1 border shrink-0", ROLE_BADGE[rn.role])}>
                              {rn.role}
                            </Badge>
                            <span className={cn("text-sm font-medium", isNext ? "text-emerald-200" : "text-slate-200")}>
                              {rn.name}
                            </span>
                          </div>

                          {/* Workload bar */}
                          <div className="flex items-center gap-2 flex-1">
                            <span className="text-xs text-slate-400 w-16 shrink-0">
                              {cells.length} {cells.length === 1 ? "patient" : "patients"}
                            </span>
                            <div className="flex-1 h-2 rounded-full bg-slate-700 overflow-hidden">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all",
                                  cells.length === 0
                                    ? "bg-slate-600"
                                    : cells.length >= maxCells
                                      ? "bg-red-500"
                                      : cells.length >= maxCells * 0.7
                                        ? "bg-amber-500"
                                        : "bg-emerald-500"
                                )}
                                style={{ width: `${barPct}%` }}
                              />
                            </div>
                          </div>

                          {/* Next admit badge / button */}
                          <div className="shrink-0">
                            {isNext ? (
                              <span
                                data-testid={`badge-next-admit-${activeShift}-${rn.id}`}
                                className="flex items-center gap-1 text-[11px] font-bold text-emerald-300 bg-emerald-800/50 border border-emerald-600 rounded-full px-2.5 py-1"
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                Next Admit
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setNextAdmit(rn.id)}
                                data-testid={`btn-set-next-admit-${activeShift}-${rn.id}`}
                                className="text-[11px] font-medium px-2.5 py-1 rounded-full border border-slate-600 text-slate-400 hover:border-emerald-600 hover:text-emerald-300 hover:bg-emerald-900/20 transition-colors"
                              >
                                Set as Next Admit
                              </button>
                            )}
                          </div>

                          {/* Attested indicator */}
                          {attested && (
                            <span className="text-[10px] text-emerald-500 shrink-0 flex items-center gap-0.5">
                              <CheckCircle2 className="h-3 w-3" />
                              Attested
                            </span>
                          )}
                        </div>
                      );
                    });
                  })()}

                  {/* No one designated callout */}
                  {!nextAdmitRnId[activeShift] && (
                    <p className="text-xs text-amber-400 flex items-center gap-1.5 mt-1">
                      <TriangleAlert className="h-3.5 w-3.5" />
                      No RN designated for the next admit yet.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Panel 1: RN Cell Assignments ──────────────────────────────── */}
          <Card className="border border-slate-700 bg-slate-800/70">
            <CardHeader className="py-3 px-4 bg-slate-800 rounded-t-lg border-b border-slate-700">
              <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Users className="h-4 w-4 text-blue-400" />
                RN Cell Assignments
                <span className="text-xs font-normal text-slate-400 ml-1">— Charge RN &amp; RNs all rotate admits; click a cell to assign</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {rnsOnShift.length === 0 ? (
                <p className="text-sm text-slate-400 italic">
                  No Charge RN or RN staff assigned to the {activeShift} shift. Assign a Charge RN and add RN staff in the Shift Assignments panel above.
                </p>
              ) : (
                <div className="space-y-4">
                  {/* Unassigned cells callout */}
                  {(() => {
                    const unassigned = allCells.filter(ck => !cellOwnerMap[ck]);
                    if (unassigned.length === 0) return null;
                    return (
                      <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-900/20 border border-amber-700/40 rounded px-3 py-2">
                        <TriangleAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>
                          <strong>{unassigned.length}</strong> bed slot{unassigned.length !== 1 ? "s" : ""} unassigned:{" "}
                          {unassigned.map(c => <span key={c} className="font-mono bg-amber-900/40 rounded px-1 mr-1">{c}</span>)}
                        </span>
                      </div>
                    );
                  })()}

                  {rnsOnShift.map(rn => {
                    const myCells = rnCellAssignments[`${activeShift}_${rn.id}`] ?? [];
                    return (
                      <div key={rn.id} data-testid={`rn-assignment-${activeShift}-${rn.id}`}>
                        <p className="text-xs font-semibold text-blue-300 mb-2 flex items-center gap-1.5">
                          <Badge variant="outline" className={cn("text-[10px] h-4 px-1 border", ROLE_BADGE[rn.role])}>{rn.role}</Badge>
                          {rn.name}
                          <span className="text-slate-500 font-normal">— {myCells.length} cells</span>
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {allCells.map(ck => {
                            const isOwned = myCells.includes(ck);
                            const ownedByOther = !isOwned && !!cellOwnerMap[ck];
                            return (
                              <button
                                key={ck}
                                type="button"
                                disabled={ownedByOther}
                                onClick={() => toggleCellForRn(rn.id, ck)}
                                data-testid={`cell-assign-${activeShift}-${rn.id}-${ck}`}
                                title={ownedByOther ? `Assigned to another RN` : isOwned ? `Remove ${ck} from ${rn.name}` : `Assign ${ck} to ${rn.name}`}
                                className={cn(
                                  "px-2 py-1 rounded border text-[11px] font-mono font-semibold transition-all select-none",
                                  isOwned
                                    ? "bg-blue-700/60 border-blue-500 text-blue-100 hover:bg-blue-600/70"
                                    : ownedByOther
                                      ? "bg-slate-800/40 border-slate-700 text-slate-600 cursor-not-allowed"
                                      : "bg-slate-700/60 border-slate-600 text-slate-400 hover:border-blue-500 hover:text-blue-300"
                                )}
                              >
                                {ck}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Panel 1.5: LVN Supervision Assignments ────────────────────── */}
          {lvnsOnShift.length > 0 && (
            <Card className="border border-slate-700 bg-slate-800/70">
              <CardHeader className="py-3 px-4 bg-slate-800 rounded-t-lg border-b border-slate-700">
                <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-amber-400" />
                  LVN Supervision Assignments
                  <span className="text-xs font-normal text-slate-400 ml-1">
                    — Each LVN must have a designated supervising RN who is responsible for their actions and adverse event reports
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                {rnsOnShift.length === 0 ? (
                  <p className="text-sm text-slate-400 italic">
                    Assign a Charge RN or RN staff to this shift before designating LVN supervisors.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[11px] text-slate-500 mb-3">
                      The supervising RN is notified of all adverse occurrences reported by their LVN and must acknowledge each event before attesting their shift.
                    </p>
                    {lvnsOnShift.map(lvn => {
                      const supervisorId = lvnSupervisors[`${activeShift}_${lvn.id}`];
                      const supervisorRn = supervisorId ? rnsOnShift.find(r => r.id === supervisorId) : undefined;
                      const lvnAdverse = allCells.filter(ck =>
                        medPassStatus[`${activeShift}_${ck}`]?.status === "unavailable" &&
                        medPassStatus[`${activeShift}_${ck}`]?.lvnId === lvn.id
                      );
                      const pendingAck = supervisorId
                        ? lvnAdverse.filter(ck => !rnAdverseAcknowledgments[`${activeShift}_${lvn.id}_${ck}`]?.timestamp)
                        : [];
                      return (
                        <div
                          key={lvn.id}
                          data-testid={`lvn-supervision-row-${activeShift}-${lvn.id}`}
                          className={cn(
                            "flex flex-wrap items-center gap-3 rounded-lg px-3 py-2.5 border",
                            !supervisorId
                              ? "bg-red-900/15 border-red-700/50"
                              : pendingAck.length > 0
                                ? "bg-amber-900/15 border-amber-700/50"
                                : "bg-slate-800/40 border-slate-700"
                          )}
                        >
                          {/* LVN identity */}
                          <div className="flex items-center gap-2 min-w-[140px]">
                            <Badge variant="outline" className="text-[10px] h-4 px-1 border bg-teal-900/60 text-teal-200 border-teal-600 shrink-0">
                              LVN
                            </Badge>
                            <span className="text-sm font-medium text-slate-200">{lvn.name}</span>
                          </div>

                          {/* Supervisor select */}
                          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                            <span className="text-[11px] text-slate-500 shrink-0">Supervising RN:</span>
                            <Select
                              value={supervisorId ?? "__none__"}
                              onValueChange={val => setLvnSupervisor(lvn.id, val === "__none__" ? "" : val)}
                            >
                              <SelectTrigger
                                className={cn(
                                  "h-7 text-xs flex-1 max-w-[220px] bg-slate-800 text-slate-200",
                                  !supervisorId ? "border-red-600/60" : "border-slate-600"
                                )}
                                data-testid={`select-lvn-supervisor-${activeShift}-${lvn.id}`}
                              >
                                <SelectValue placeholder="— assign supervisor —" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">— unassigned —</SelectItem>
                                {rnsOnShift.map(rn => (
                                  <SelectItem key={rn.id} value={rn.id}>
                                    {rn.name} ({rn.role})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Status indicators */}
                          <div className="flex items-center gap-2 ml-auto">
                            {!supervisorId && (
                              <span className="flex items-center gap-1 text-[11px] font-semibold text-red-400">
                                <AlertCircle className="h-3.5 w-3.5" />
                                No supervisor assigned
                              </span>
                            )}
                            {supervisorId && pendingAck.length > 0 && (
                              <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-400">
                                <TriangleAlert className="h-3.5 w-3.5" />
                                {pendingAck.length} adverse event{pendingAck.length !== 1 ? "s" : ""} pending review by {supervisorRn?.name ?? "supervisor"}
                              </span>
                            )}
                            {supervisorId && pendingAck.length === 0 && lvnAdverse.length > 0 && (
                              <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                All adverse events acknowledged
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {/* Warning if any LVN is unassigned */}
                    {lvnsOnShift.some(lvn => !lvnSupervisors[`${activeShift}_${lvn.id}`]) && (
                      <div className="flex items-start gap-2 text-xs text-red-400 bg-red-900/20 border border-red-700/40 rounded px-3 py-2 mt-2">
                        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>
                          All LVNs must have a designated supervising RN. Assign supervisors above before the LVN begins their medication pass.
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Panel 2: LVN Medication Pass ──────────────────────────────── */}
          <Card className="border border-slate-700 bg-slate-800/70">
            <CardHeader className="py-3 px-4 bg-slate-800 rounded-t-lg border-b border-slate-700">
              <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Pill className="h-4 w-4 text-teal-400" />
                LVN Medication Pass
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {lvnsOnShift.length === 0 ? (
                <p className="text-sm text-slate-400 italic">
                  No LVNs are assigned to the {activeShift} shift.
                </p>
              ) : allCells.length === 0 ? (
                <p className="text-sm text-slate-400 italic">No patient beds recorded.</p>
              ) : (
                <div className="space-y-5">
                  {lvnsOnShift.map(lvn => {
                    const lvnSupervisorId = lvnSupervisors[`${activeShift}_${lvn.id}`];
                    const lvnSupervisorRn = lvnSupervisorId ? rnsOnShift.find(r => r.id === lvnSupervisorId) : undefined;
                    return (
                      <div key={lvn.id}>
                        <div className="flex flex-wrap items-center gap-3 mb-2">
                          <p className="text-xs font-semibold text-teal-300 flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[10px] h-4 px-1 border bg-teal-900/60 text-teal-200 border-teal-600">LVN</Badge>
                            {lvn.name}
                          </p>
                          {lvnSupervisorRn ? (
                            <span className="text-[11px] flex items-center gap-1 text-slate-400">
                              <ShieldAlert className="h-3 w-3 text-amber-400" />
                              Supervised by: <span className="font-medium text-slate-200 ml-0.5">{lvnSupervisorRn.name}</span>
                              <span className="text-slate-600">({lvnSupervisorRn.role})</span>
                            </span>
                          ) : (
                            <span className="text-[11px] flex items-center gap-1 text-red-400">
                              <AlertCircle className="h-3 w-3" />
                              No supervising RN assigned — assign one above
                            </span>
                          )}
                        </div>
                        <div className="rounded-lg border border-slate-700 overflow-hidden">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-slate-800 border-b border-slate-700">
                                <th className="text-left px-3 py-2 text-slate-400 font-semibold">Bed</th>
                                <th className="text-left px-3 py-2 text-slate-400 font-semibold">Team</th>
                                <th className="text-left px-3 py-2 text-slate-400 font-semibold">Assigned RN</th>
                                <th className="text-left px-3 py-2 text-slate-400 font-semibold">Status</th>
                                <th className="px-3 py-2 text-slate-400 font-semibold text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {allCells.filter(ck => cellOwnerMap[ck]).length === 0 && (
                                <tr>
                                  <td colSpan={5} className="px-3 py-3 text-xs text-slate-500 italic text-center">
                                    No beds are assigned to an RN yet. Assign beds in the RN Cell Assignments panel before recording medication pass status.
                                  </td>
                                </tr>
                              )}
                              {allCells.filter(ck => cellOwnerMap[ck]).map((ck, idx) => {
                                const pKey = `${activeShift}_${ck}`;
                                const pass = medPassStatus[pKey];
                                const ownerRnId = cellOwnerMap[ck];
                                const ownerRn = ownerRnId ? staff.find(s => s.id === ownerRnId) : undefined;
                                const formState = unavailForms[pKey];
                                return (
                                  <React.Fragment key={ck}>
                                    <tr
                                      className={cn(
                                        "border-b border-slate-700/50 transition-colors",
                                        idx % 2 === 0 ? "bg-slate-800/30" : "bg-slate-800/10",
                                        pass?.status === "passed" ? "opacity-70" : ""
                                      )}
                                      data-testid={`lvn-pass-row-${activeShift}-${ck}`}
                                    >
                                      <td className="px-3 py-2 font-mono font-bold text-slate-300">{ck}</td>
                                      <td className="px-3 py-2 text-slate-400">{teamLabel(ck)}</td>
                                      <td className="px-3 py-2 text-slate-300">{ownerRn?.name ?? <span className="text-slate-600 italic">Unassigned</span>}</td>
                                      <td className="px-3 py-2">
                                        {!pass && <span className="text-slate-500 italic">Pending</span>}
                                        {pass?.status === "passed" && (
                                          <span className="flex flex-wrap items-center gap-1 text-emerald-400">
                                            <CheckCircle2 className="h-3.5 w-3.5" />
                                            Passed
                                            <span className="text-slate-500 ml-1">{formatTime(pass.timestamp)}</span>
                                            {pass.lvnName && (
                                              <span className="text-slate-500">by {pass.lvnName}</span>
                                            )}
                                          </span>
                                        )}
                                        {pass?.status === "unavailable" && (
                                          <span className="flex flex-wrap items-center gap-1 text-amber-400">
                                            <TriangleAlert className="h-3.5 w-3.5" />
                                            {pass.reason ?? "Unavailable"}
                                            {pass.reasonText && <span className="text-slate-400 ml-1">— {pass.reasonText}</span>}
                                            <span className="text-slate-500 ml-1">{formatTime(pass.timestamp)}</span>
                                            {pass.lvnName && (
                                              <span className="text-slate-500">by {pass.lvnName}</span>
                                            )}
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-3 py-2 text-right">
                                        {!pass && (
                                          <div className="flex items-center justify-end gap-1">
                                            <button
                                              type="button"
                                              onClick={() => saveMedPass(ck, {
                                                status: "passed",
                                                lvnId: lvn.id,
                                                lvnName: lvn.name,
                                                timestamp: new Date().toISOString(),
                                              })}
                                              data-testid={`btn-pass-${activeShift}-${ck}`}
                                              className="flex items-center gap-1 px-2 py-0.5 rounded border border-emerald-700 bg-emerald-900/30 text-emerald-300 hover:bg-emerald-800/50 text-[11px] font-semibold transition-colors"
                                            >
                                              <CheckCircle2 className="h-3 w-3" />
                                              Passed
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => setUnavailForms(f => ({
                                                ...f,
                                                [pKey]: f[pKey] ?? { reason: UNAVAILABILITY_REASONS[0], reasonText: "" },
                                              }))}
                                              data-testid={`btn-unavail-${activeShift}-${ck}`}
                                              className="flex items-center gap-1 px-2 py-0.5 rounded border border-amber-700 bg-amber-900/30 text-amber-300 hover:bg-amber-800/50 text-[11px] font-semibold transition-colors"
                                            >
                                              <TriangleAlert className="h-3 w-3" />
                                              Unavailable
                                            </button>
                                          </div>
                                        )}
                                        {pass && (
                                          <button
                                            type="button"
                                            onClick={() => clearMedPass(ck)}
                                            data-testid={`btn-clear-pass-${activeShift}-${ck}`}
                                            className="px-2 py-0.5 rounded border border-slate-600 text-slate-400 hover:text-red-400 hover:border-red-600 text-[11px] transition-colors"
                                          >
                                            Clear
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                    {/* Unavailability form row */}
                                    {formState && !pass && (
                                      <tr className="bg-amber-950/30 border-b border-amber-800/30">
                                        <td colSpan={5} className="px-3 py-3">
                                          <div className="flex flex-wrap items-end gap-2">
                                            <div>
                                              <label className="text-[10px] text-amber-400 font-semibold uppercase tracking-wide block mb-1">Reason</label>
                                              <Select
                                                value={formState.reason}
                                                onValueChange={r => setUnavailForms(f => ({ ...f, [pKey]: { ...f[pKey], reason: r } }))}
                                              >
                                                <SelectTrigger
                                                  className="h-7 text-xs w-48 bg-slate-800 border-amber-700/50 text-slate-200"
                                                  data-testid={`select-unavail-reason-${activeShift}-${ck}`}
                                                >
                                                  <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  {UNAVAILABILITY_REASONS.map(r => (
                                                    <SelectItem key={r} value={r}>{r}</SelectItem>
                                                  ))}
                                                </SelectContent>
                                              </Select>
                                            </div>
                                            <div className="flex-1 min-w-[200px]">
                                              <label className="text-[10px] text-amber-400 font-semibold uppercase tracking-wide block mb-1">Notes (optional)</label>
                                              <Input
                                                value={formState.reasonText}
                                                onChange={e => setUnavailForms(f => ({ ...f, [pKey]: { ...f[pKey], reasonText: e.target.value } }))}
                                                placeholder="Additional notes…"
                                                className="h-7 text-xs bg-slate-800 border-slate-600 text-slate-200"
                                                data-testid={`input-unavail-text-${activeShift}-${ck}`}
                                              />
                                            </div>
                                            <div className="flex gap-1">
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  saveMedPass(ck, {
                                                    status: "unavailable",
                                                    reason: formState.reason,
                                                    reasonText: formState.reasonText,
                                                    lvnId: lvn.id,
                                                    lvnName: lvn.name,
                                                    timestamp: new Date().toISOString(),
                                                  });
                                                  setUnavailForms(f => {
                                                    const next = { ...f };
                                                    delete next[pKey];
                                                    return next;
                                                  });
                                                  const supervisorName = lvnSupervisorRn?.name;
                                                  toast({
                                                    title: "Adverse occurrence recorded",
                                                    description: supervisorName
                                                      ? `Bed ${ck} flagged. ${supervisorName} (supervising RN) has been notified and must acknowledge this report.`
                                                      : `Bed ${ck} flagged. Assign a supervising RN in the LVN Supervision panel to complete the reporting chain.`,
                                                    variant: supervisorName ? "default" : "destructive",
                                                  });
                                                }}
                                                data-testid={`btn-confirm-unavail-${activeShift}-${ck}`}
                                                className="px-3 py-1 rounded border border-amber-600 bg-amber-700/40 text-amber-200 hover:bg-amber-700/60 text-xs font-semibold"
                                              >
                                                Save &amp; Report to RN
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => setUnavailForms(f => { const n = { ...f }; delete n[pKey]; return n; })}
                                                className="px-2 py-1 rounded border border-slate-600 text-slate-400 hover:text-white text-xs"
                                              >
                                                Cancel
                                              </button>
                                            </div>
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Panel 3: RN Documentation ─────────────────────────────────── */}
          <Card className="border border-slate-700 bg-slate-800/70">
            <CardHeader className="py-3 px-4 bg-slate-800 rounded-t-lg border-b border-slate-700">
              <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <FileText className="h-4 w-4 text-violet-400" />
                RN Documentation
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {rnsOnShift.length === 0 ? (
                <p className="text-sm text-slate-400 italic">No Charge RN or RN staff assigned to the {activeShift} shift.</p>
              ) : (
                <div className="space-y-5">
                  {rnsOnShift.map(rn => {
                    const attestKey = `${activeShift}_${rn.id}`;
                    const attestRecord = rnAttestations[attestKey];
                    const attested = attestRecord?.attested === true;
                    const myCells = rnCellAssignments[`${activeShift}_${rn.id}`] ?? [];
                    const docCount = myCells.filter(ck => cellDocumentation[`${activeShift}_${ck}`]?.documented).length;
                    const unavailCells = myCells.filter(ck => medPassStatus[`${activeShift}_${ck}`]?.status === "unavailable");
                    const pendingReasons = unavailCells.filter(ck => !medUnavailReasons[`${activeShift}_${ck}`]?.trim());
                    const ready = canAttest(rn.id);
                    // LVN supervision: find all LVNs whose supervisor is this RN
                    const supervisedLvns = lvnsOnShift.filter(
                      lvn => lvnSupervisors[`${activeShift}_${lvn.id}`] === rn.id
                    );
                    // Collect all adverse events (unavailable meds) from supervised LVNs
                    const lvnAdverseEvents: { lvn: TSFStaff; cellKey: string }[] = [];
                    supervisedLvns.forEach(lvn => {
                      allCells.forEach(ck => {
                        const pass = medPassStatus[`${activeShift}_${ck}`];
                        if (pass?.status === "unavailable" && pass.lvnId === lvn.id) {
                          lvnAdverseEvents.push({ lvn, cellKey: ck });
                        }
                      });
                    });
                    const pendingLvnEvents = lvnAdverseEvents.filter(
                      ({ lvn, cellKey: ck }) => !rnAdverseAcknowledgments[`${activeShift}_${lvn.id}_${ck}`]?.timestamp
                    );
                    const acknowledgedLvnEvents = lvnAdverseEvents.filter(
                      ({ lvn, cellKey: ck }) => !!rnAdverseAcknowledgments[`${activeShift}_${lvn.id}_${ck}`]?.timestamp
                    );

                    return (
                      <div
                        key={rn.id}
                        data-testid={`rn-doc-panel-${activeShift}-${rn.id}`}
                        className={cn(
                          "rounded-lg border p-4 space-y-3",
                          attested ? "border-emerald-700/50 bg-emerald-900/10" : "border-slate-700 bg-slate-800/40"
                        )}
                      >
                        {/* RN header row */}
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={cn("text-[10px] h-4 px-1 border", ROLE_BADGE[rn.role])}>{rn.role}</Badge>
                            <span className="text-sm font-semibold text-slate-200">{rn.name}</span>
                            {myCells.length > 0 && (
                              <span className="text-xs text-slate-400">
                                {docCount}/{myCells.length} documented
                              </span>
                            )}
                          </div>
                          {attested ? (
                            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                              <CheckCircle2 className="h-4 w-4" />
                              Attested — {formatTime(attestRecord.timestamp)}
                            </span>
                          ) : (
                            <div className="flex flex-col items-end gap-1">
                              <button
                                type="button"
                                disabled={!ready}
                                onClick={() => {
                                  attestRn(rn.id);
                                  toast({ title: "Attestation recorded", description: `${rn.name} has attested for the ${activeShift} shift.` });
                                }}
                                data-testid={`btn-attest-${activeShift}-${rn.id}`}
                                className={cn(
                                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all",
                                  ready
                                    ? "border-emerald-600 bg-emerald-800/40 text-emerald-300 hover:bg-emerald-700/50 cursor-pointer"
                                    : "border-slate-700 bg-slate-800/40 text-slate-600 cursor-not-allowed"
                                )}
                              >
                                <ClipboardCheck className="h-3.5 w-3.5" />
                                Attest — All Documentation Complete
                              </button>
                              {!ready && pendingLvnEvents.length > 0 && (
                                <span className="text-[10px] text-red-400 flex items-center gap-1">
                                  <ShieldAlert className="h-3 w-3" />
                                  Blocked: {pendingLvnEvents.length} LVN adverse event{pendingLvnEvents.length !== 1 ? "s" : ""} require your review
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {myCells.length === 0 && (
                          <p className="text-xs text-slate-500 italic">No cells assigned. Use the RN Cell Assignments panel above to assign beds to this RN.</p>
                        )}

                        {/* ── LVN Adverse Events ──────────────────────────────────────── */}
                        {(pendingLvnEvents.length > 0 || acknowledgedLvnEvents.length > 0) && (
                          <div className={cn(
                            "rounded border p-3 space-y-3",
                            pendingLvnEvents.length > 0
                              ? "border-red-700/60 bg-red-900/15"
                              : "border-emerald-800/40 bg-emerald-900/10"
                          )}>
                            <p className={cn(
                              "text-xs font-semibold flex items-center gap-1.5",
                              pendingLvnEvents.length > 0 ? "text-red-400" : "text-emerald-400"
                            )}>
                              {pendingLvnEvents.length > 0 ? (
                                <><ShieldAlert className="h-3.5 w-3.5" />
                                LVN Adverse Event Report — Action Required ({pendingLvnEvents.length} pending)</>
                              ) : (
                                <><CheckCircle2 className="h-3.5 w-3.5" />
                                LVN Adverse Events — All Acknowledged</>
                              )}
                            </p>

                            {pendingLvnEvents.length > 0 && !attested && (
                              <p className="text-[11px] text-slate-400">
                                As supervising RN you must review and acknowledge each adverse medication occurrence reported by your LVN staff before attesting this shift.
                              </p>
                            )}

                            {/* Pending events — must acknowledge */}
                            {pendingLvnEvents.map(({ lvn, cellKey: ck }) => {
                              const pass = medPassStatus[`${activeShift}_${ck}`]!;
                              const ackKey = `${activeShift}_${lvn.id}_${ck}`;
                              const noteVal = ackNoteForms[ackKey] ?? "";
                              const elapsed = (() => {
                                try {
                                  const mins = Math.round((Date.now() - new Date(pass.timestamp).getTime()) / 60000);
                                  if (mins < 1) return "just now";
                                  if (mins < 60) return `${mins} min ago`;
                                  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
                                } catch { return ""; }
                              })();
                              return (
                                <div
                                  key={ck}
                                  data-testid={`lvn-adverse-event-${activeShift}-${rn.id}-${ck}`}
                                  className="rounded border border-red-800/40 bg-red-950/20 p-3 space-y-2"
                                >
                                  <div className="flex flex-wrap items-start gap-2">
                                    <Badge variant="outline" className="text-[10px] h-4 px-1 border bg-teal-900/60 text-teal-200 border-teal-600 shrink-0">
                                      LVN
                                    </Badge>
                                    <span className="text-sm font-semibold text-red-200">{lvn.name}</span>
                                    <span className="font-mono text-[11px] text-slate-300 bg-slate-800 rounded px-1.5 py-0.5">{ck}</span>
                                    <span className="text-[11px] text-amber-300 flex items-center gap-1">
                                      <TriangleAlert className="h-3 w-3" />
                                      {pass.reason ?? "Unavailable"}{pass.reasonText ? ` — ${pass.reasonText}` : ""}
                                    </span>
                                    <span className="text-[11px] text-slate-500 ml-auto">{elapsed}</span>
                                  </div>
                                  {!attested && (
                                    <div className="space-y-1.5">
                                      <label className="text-[10px] text-red-400 font-semibold uppercase tracking-wide block">
                                        Your acknowledgment &amp; clinical response
                                      </label>
                                      <Textarea
                                        value={noteVal}
                                        onChange={e => setAckNoteForms(f => ({ ...f, [ackKey]: e.target.value }))}
                                        placeholder="Document your awareness and any clinical action taken…"
                                        rows={2}
                                        data-testid={`textarea-lvn-ack-${activeShift}-${rn.id}-${ck}`}
                                        className="text-xs bg-slate-900 border-red-800/40 text-slate-200 placeholder:text-slate-600 resize-none w-full"
                                      />
                                      <button
                                        type="button"
                                        disabled={!noteVal.trim()}
                                        onClick={() => {
                                          acknowledgeAdverseEvent(lvn.id, ck, noteVal.trim());
                                          toast({
                                            title: "Adverse event acknowledged",
                                            description: `${rn.name} acknowledged LVN ${lvn.name}'s report for bed ${ck}.`,
                                          });
                                        }}
                                        data-testid={`btn-ack-lvn-event-${activeShift}-${rn.id}-${ck}`}
                                        className={cn(
                                          "flex items-center gap-1.5 px-3 py-1 rounded border text-xs font-semibold transition-all",
                                          noteVal.trim()
                                            ? "border-red-600 bg-red-800/40 text-red-200 hover:bg-red-700/50 cursor-pointer"
                                            : "border-slate-700 bg-slate-800/30 text-slate-600 cursor-not-allowed"
                                        )}
                                      >
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                        Acknowledge &amp; Document
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}

                            {/* Already acknowledged events — summary */}
                            {acknowledgedLvnEvents.length > 0 && (
                              <div className="space-y-1">
                                {acknowledgedLvnEvents.map(({ lvn, cellKey: ck }) => {
                                  const ackRecord = rnAdverseAcknowledgments[`${activeShift}_${lvn.id}_${ck}`]!;
                                  return (
                                    <div
                                      key={ck}
                                      data-testid={`lvn-event-acked-${activeShift}-${rn.id}-${ck}`}
                                      className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 bg-slate-800/30 rounded px-2 py-1.5"
                                    >
                                      <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                                      <span className="text-emerald-400 font-medium">{lvn.name}</span>
                                      <span className="font-mono bg-slate-800 rounded px-1">{ck}</span>
                                      <span>acknowledged {formatTime(ackRecord.timestamp)}</span>
                                      {ackRecord.note && (
                                        <span className="text-slate-500 italic">"{ackRecord.note}"</span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Unavailability reason prompts */}
                        {pendingReasons.length > 0 && !attested && (
                          <div className="rounded border border-amber-700/50 bg-amber-900/20 p-3 space-y-2">
                            <p className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                              <TriangleAlert className="h-3.5 w-3.5" />
                              Medication unavailability noted — provide your reason before attesting
                            </p>
                            {pendingReasons.map(ck => (
                              <div key={ck} className="flex items-start gap-2">
                                <span className="font-mono text-[11px] text-amber-300 bg-amber-900/40 rounded px-1.5 py-0.5 mt-0.5">{ck}</span>
                                <div className="flex-1">
                                  <span className="text-[11px] text-amber-200">LVN reason: {medPassStatus[`${activeShift}_${ck}`]?.reason}</span>
                                  <Textarea
                                    value={medUnavailReasons[`${activeShift}_${ck}`] ?? ""}
                                    onChange={e => setUnavailableReason(ck, e.target.value)}
                                    placeholder="Enter your clinical reason for the unavailability…"
                                    disabled={attested}
                                    rows={2}
                                    data-testid={`textarea-unavail-rn-reason-${activeShift}-${ck}`}
                                    className="mt-1 text-xs bg-slate-800 border-amber-700/40 text-slate-200 placeholder:text-slate-500 resize-none"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Cell documentation table */}
                        {myCells.length > 0 && (
                          <div className="rounded-lg border border-slate-700 overflow-hidden">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-slate-800 border-b border-slate-700">
                                  <th className="text-left px-3 py-2 text-slate-400 font-semibold w-20">Bed</th>
                                  <th className="text-left px-3 py-2 text-slate-400 font-semibold">Med Pass</th>
                                  <th className="text-left px-3 py-2 text-slate-400 font-semibold">Shift Note</th>
                                  <th className="px-3 py-2 text-slate-400 font-semibold text-center w-24">Documented</th>
                                </tr>
                              </thead>
                              <tbody>
                                {myCells.map((ck, idx) => {
                                  const dKey = `${activeShift}_${ck}`;
                                  const pKey = `${activeShift}_${ck}`;
                                  const doc = cellDocumentation[dKey] ?? { note: "", documented: false };
                                  const pass = medPassStatus[pKey];
                                  return (
                                    <tr
                                      key={ck}
                                      className={cn(
                                        "border-b border-slate-700/50",
                                        idx % 2 === 0 ? "bg-slate-800/30" : "bg-slate-800/10",
                                        doc.documented ? "opacity-70" : ""
                                      )}
                                      data-testid={`rn-doc-row-${activeShift}-${rn.id}-${ck}`}
                                    >
                                      <td className="px-3 py-2 font-mono font-bold text-slate-300 align-top">{ck}</td>
                                      <td className="px-3 py-2 align-top">
                                        {!pass && <span className="text-slate-500 italic">Pending</span>}
                                        {pass?.status === "passed" && (
                                          <span className="text-emerald-400 flex flex-wrap items-center gap-1">
                                            <CheckCircle2 className="h-3 w-3" />
                                            Passed
                                            {pass.lvnName && (
                                              <span className="text-slate-500 text-[11px]">by {pass.lvnName} {formatTime(pass.timestamp)}</span>
                                            )}
                                          </span>
                                        )}
                                        {pass?.status === "unavailable" && (
                                          <span className="text-amber-400 flex flex-wrap items-center gap-1">
                                            <TriangleAlert className="h-3 w-3" />
                                            {pass.reason}
                                            {pass.lvnName && (
                                              <span className="text-slate-500 text-[11px]">by {pass.lvnName}</span>
                                            )}
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-3 py-2">
                                        <Textarea
                                          value={doc.note}
                                          onChange={e => setCellDoc(ck, e.target.value, doc.documented)}
                                          placeholder="Enter shift note…"
                                          disabled={attested}
                                          rows={2}
                                          data-testid={`textarea-cell-note-${activeShift}-${rn.id}-${ck}`}
                                          className="text-xs bg-slate-800 border-slate-600 text-slate-200 placeholder:text-slate-500 resize-none w-full"
                                        />
                                      </td>
                                      <td className="px-3 py-2 text-center align-top">
                                        <Checkbox
                                          checked={doc.documented}
                                          disabled={attested}
                                          onCheckedChange={checked => setCellDoc(ck, doc.note, checked === true)}
                                          data-testid={`checkbox-documented-${activeShift}-${rn.id}-${ck}`}
                                          className="border-slate-500 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                                        />
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Panel 4: Shift Handoff Summary (collapsible) ──────────────── */}
          <Card className="border border-slate-700 bg-slate-800/70">
            <button
              type="button"
              onClick={() => setHandoffOpen(v => !v)}
              data-testid={`handoff-toggle-${activeShift}`}
              className="w-full"
            >
              <CardHeader className="py-3 px-4 bg-slate-800 rounded-t-lg border-b border-slate-700 hover:bg-slate-700/60 transition-colors">
                <CardTitle className="text-sm font-semibold text-slate-200 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <ClipboardCheck className="h-4 w-4 text-sky-400" />
                    Shift Handoff Report
                    <span className="text-xs font-normal text-slate-400">— {SHIFTS.find(s => s.id === activeShift)?.label} Shift</span>
                  </span>
                  {handoffOpen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                </CardTitle>
              </CardHeader>
            </button>

            {handoffOpen && (
              <CardContent className="p-4 space-y-4">
                {/* RN Attestation status */}
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">RN Attestation Status</p>
                  {rnsOnShift.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">No Charge RN or RN staff on this shift.</p>
                  ) : (
                    <div className="space-y-1">
                      {rnsOnShift.map(rn => {
                        const att = rnAttestations[`${activeShift}_${rn.id}`];
                        const cells = rnCellAssignments[`${activeShift}_${rn.id}`] ?? [];
                        const docCount = cells.filter(ck => cellDocumentation[`${activeShift}_${ck}`]?.documented).length;
                        return (
                          <div
                            key={rn.id}
                            className="flex items-center justify-between rounded px-3 py-2 bg-slate-800/50"
                            data-testid={`handoff-rn-row-${activeShift}-${rn.id}`}
                          >
                            <span className="text-sm text-slate-200">{rn.name}</span>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-slate-400">{docCount}/{cells.length} cells documented</span>
                              {att?.attested ? (
                                <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Attested {formatTime(att.timestamp)}
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-xs font-semibold text-amber-400">
                                  <Clock className="h-3.5 w-3.5" />
                                  Pending
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Next Admit designation */}
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Next Admit</p>
                  {(() => {
                    const nextRnId = nextAdmitRnId[activeShift];
                    const nextRn = nextRnId ? rnsOnShift.find(r => r.id === nextRnId) : undefined;
                    if (!nextRn) {
                      return (
                        <p className="text-xs text-amber-400 flex items-center gap-1.5">
                          <TriangleAlert className="h-3.5 w-3.5" />
                          No RN designated for the next admit — set this in the Admit Rotation panel above.
                        </p>
                      );
                    }
                    const cells = rnCellAssignments[`${activeShift}_${nextRn.id}`] ?? [];
                    return (
                      <div className="flex items-center gap-3 rounded-lg px-3 py-2 bg-emerald-900/20 border border-emerald-700/50">
                        <Badge variant="outline" className={cn("text-[10px] h-4 px-1 border shrink-0", ROLE_BADGE[nextRn.role])}>
                          {nextRn.role}
                        </Badge>
                        <span className="text-sm font-semibold text-emerald-200">{nextRn.name}</span>
                        <span className="text-xs text-slate-400">{cells.length} {cells.length === 1 ? "patient" : "patients"} currently</span>
                        <span className="ml-auto flex items-center gap-1 text-[11px] font-bold text-emerald-300">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Next Admit
                        </span>
                      </div>
                    );
                  })()}
                </div>

                {/* Med unavailability flags */}
                {(() => {
                  const flags = allCells.filter(ck => medPassStatus[`${activeShift}_${ck}`]?.status === "unavailable");
                  if (flags.length === 0) return null;
                  return (
                    <div>
                      <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <TriangleAlert className="h-3.5 w-3.5" />
                        Medication Unavailability Flags ({flags.length})
                      </p>
                      <div className="space-y-1.5">
                        {flags.map(ck => {
                          const pass = medPassStatus[`${activeShift}_${ck}`]!;
                          const rnReason = medUnavailReasons[`${activeShift}_${ck}`];
                          return (
                            <div
                              key={ck}
                              className="rounded border border-amber-800/40 bg-amber-900/15 px-3 py-2 text-xs"
                              data-testid={`handoff-unavail-${activeShift}-${ck}`}
                            >
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <span className="font-mono font-bold text-amber-300">{ck}</span>
                                <span className="text-slate-400">LVN: {pass.lvnName}</span>
                                <span className="text-amber-200">Reason: {pass.reason}</span>
                                {pass.reasonText && <span className="text-slate-400">— {pass.reasonText}</span>}
                              </div>
                              {rnReason ? (
                                <p className="mt-1 text-emerald-300 flex items-start gap-1">
                                  <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
                                  RN reason: {rnReason}
                                </p>
                              ) : (
                                <p className="mt-1 text-red-400 flex items-center gap-1">
                                  <TriangleAlert className="h-3 w-3" />
                                  RN reason not yet provided
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* LVN Adverse Event Acknowledgment Status */}
                {(() => {
                  const allLvnEvents: { lvn: TSFStaff; cellKey: string; supervisorRn: TSFStaff | undefined; acked: boolean }[] = [];
                  lvnsOnShift.forEach(lvn => {
                    const supervisorId = lvnSupervisors[`${activeShift}_${lvn.id}`];
                    const supervisorRn = supervisorId ? rnsOnShift.find(r => r.id === supervisorId) : undefined;
                    allCells.forEach(ck => {
                      const pass = medPassStatus[`${activeShift}_${ck}`];
                      if (pass?.status === "unavailable" && pass.lvnId === lvn.id) {
                        const acked = !!rnAdverseAcknowledgments[`${activeShift}_${lvn.id}_${ck}`]?.timestamp;
                        allLvnEvents.push({ lvn, cellKey: ck, supervisorRn, acked });
                      }
                    });
                  });
                  if (allLvnEvents.length === 0) return null;
                  const unacked = allLvnEvents.filter(e => !e.acked);
                  return (
                    <div>
                      <p className={cn(
                        "text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5",
                        unacked.length > 0 ? "text-red-400" : "text-emerald-400"
                      )}>
                        {unacked.length > 0 ? (
                          <><ShieldAlert className="h-3.5 w-3.5" />LVN Adverse Event Acknowledgments — {unacked.length} Pending</>
                        ) : (
                          <><CheckCircle2 className="h-3.5 w-3.5" />LVN Adverse Events — All Acknowledged by Supervising RNs</>
                        )}
                      </p>
                      <div className="space-y-1.5">
                        {allLvnEvents.map(({ lvn, cellKey: ck, supervisorRn, acked }) => {
                          const ackRecord = rnAdverseAcknowledgments[`${activeShift}_${lvn.id}_${ck}`];
                          const pass = medPassStatus[`${activeShift}_${ck}`]!;
                          return (
                            <div
                              key={`${lvn.id}_${ck}`}
                              data-testid={`handoff-lvn-ack-${activeShift}-${lvn.id}-${ck}`}
                              className={cn(
                                "rounded border px-3 py-2 text-xs",
                                acked ? "border-emerald-800/40 bg-emerald-900/10" : "border-red-700/50 bg-red-900/15"
                              )}
                            >
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <span className="font-mono font-bold text-slate-300">{ck}</span>
                                <span className="text-teal-300">LVN: {lvn.name}</span>
                                <span className="text-amber-300">{pass.reason ?? "Unavailable"}</span>
                                <span className="text-slate-500">
                                  Supervisor: {supervisorRn?.name ?? <span className="text-red-400">Unassigned</span>}
                                </span>
                              </div>
                              {acked ? (
                                <p className="mt-1 text-emerald-400 flex items-start gap-1">
                                  <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
                                  Acknowledged {formatTime(ackRecord!.timestamp)} by {supervisorRn?.name ?? "RN"}
                                  {ackRecord?.note && <span className="text-slate-400 ml-1">— "{ackRecord.note}"</span>}
                                </p>
                              ) : (
                                <p className="mt-1 text-red-400 flex items-center gap-1">
                                  <TriangleAlert className="h-3 w-3" />
                                  Awaiting acknowledgment from supervising RN
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Undocumented cells summary */}
                {(() => {
                  const undoc: string[] = [];
                  rnsOnShift.forEach(rn => {
                    const att = rnAttestations[`${activeShift}_${rn.id}`];
                    if (att?.attested) return;
                    const cells = rnCellAssignments[`${activeShift}_${rn.id}`] ?? [];
                    cells.forEach(ck => {
                      if (!cellDocumentation[`${activeShift}_${ck}`]?.documented) undoc.push(ck);
                    });
                  });
                  if (undoc.length === 0 && rnsOnShift.length > 0) {
                    return (
                      <div className="flex items-center gap-2 text-xs text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        All assigned cells are documented.
                      </div>
                    );
                  }
                  if (undoc.length === 0) return null;
                  return (
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                        Undocumented Cells ({undoc.length})
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {undoc.map(ck => (
                          <span key={ck} className="font-mono text-[11px] bg-red-900/30 border border-red-700/40 rounded px-2 py-0.5 text-red-300">{ck}</span>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            )}
          </Card>

        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ThreeShiftFacility() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  // ── Access control ─────────────────────────────────────────────────────────
  // Admins always have full access.
  // Non-admins need an admin to grant access: "trial" (sample data) or "full" (real data).
  const [accessMode, setAccessModeRaw] = useState<AccessMode>(() => {
    const v = localStorage.getItem(STORAGE_ACCESS_KEY);
    return (v === "trial" || v === "full") ? v : "locked";
  });

  const setAccessMode = useCallback((mode: AccessMode) => {
    localStorage.setItem(STORAGE_ACCESS_KEY, mode);
    setAccessModeRaw(mode);
  }, []);

  // Non-admin in trial mode sees sample data that is NOT persisted.
  const isTrialMode = !isAdmin && accessMode === "trial";

  const [currentDate, setCurrentDate] = useState(new Date());
  const dateStr = format(currentDate, "yyyy-MM-dd");

  // Facility staff — isolated to 3-Shift Facility, sourced from localStorage["3sf_staff"]
  const [staff, setStaff] = useState<TSFStaff[]>(() => loadStaff());

  // Daily data — per-date shift assignments + team patient counts
  const [dayData, setDayData] = useState<TSFDayData>(() => loadDayData(dateStr));

  // When trial mode is active for non-admins, load sample data into state
  useEffect(() => {
    if (isTrialMode) {
      setStaff(TRIAL_STAFF);
      setDayData(trialDayData(dateStr));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTrialMode]);

  // Modals
  const [showStaffDialog, setShowStaffDialog] = useState(false);
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffRole, setNewStaffRole] = useState<TSFRole>("LVN");

  // Per-shift staff picker state
  const [addingStaffToShift, setAddingStaffToShift] = useState<ShiftId | null>(null);
  const [staffPickerValue, setStaffPickerValue] = useState("");

  // Load day data when date changes
  useEffect(() => {
    setDayData(isTrialMode ? trialDayData(dateStr) : loadDayData(dateStr));
  }, [dateStr, isTrialMode]);

  // Persist day data on every change (skipped in trial mode — sample data must not overwrite real data)
  useEffect(() => {
    if (isTrialMode) return;
    saveDayData(dayData);
  }, [dayData, isTrialMode]);

  // Persist staff on every change (skipped in trial mode)
  useEffect(() => {
    if (isTrialMode) return;
    saveStaff(staff);
  }, [staff, isTrialMode]);

  const intakeTeam = useMemo(() => getIntakeTeam(currentDate), [currentDate]);

  const totalPatients = useMemo(() =>
    TEAM_ORDER.reduce((sum, t) => sum + dayData.teams[t].totalPatients, 0),
    [dayData.teams]
  );

  // Total high-acuity (Level 3) patients across all teams.
  // Each requires exactly 1 dedicated sitter — they cannot be assigned to any other task.
  const totalHighAcuity = useMemo(() =>
    TEAM_ORDER.reduce((sum, t) => sum + dayData.teams[t].acuity.level3, 0),
    [dayData.teams]
  );

  // Charge RNs and other staff eligible for shift assignment
  const chargeRnOptions = useMemo(() => staff.filter(s => s.role === "Charge RN" || s.role === "RN"), [staff]);
  const shiftStaffOptions = useMemo(() => staff.filter(s => s.role === "LVN" || s.role === "MA" || s.role === "RN"), [staff]);

  // ── Date navigation ───────────────────────────────────────────────────────────

  const goToday = useCallback(() => setCurrentDate(new Date()), []);
  const goPrev = useCallback(() => setCurrentDate(d => subDays(d, 1)), []);
  const goNext = useCallback(() => setCurrentDate(d => addDays(d, 1)), []);

  // ── Day-data mutators ─────────────────────────────────────────────────────────

  const setChargeRn = useCallback((shiftId: ShiftId, staffId: string) => {
    setDayData(prev => ({
      ...prev,
      shifts: {
        ...prev.shifts,
        [shiftId]: { ...prev.shifts[shiftId], chargeRnId: staffId },
      },
    }));
  }, []);

  const addStaffToShift = useCallback((shiftId: ShiftId, staffId: string) => {
    setDayData(prev => {
      const current = prev.shifts[shiftId].assignedStaffIds;
      if (current.includes(staffId)) return prev;
      return {
        ...prev,
        shifts: {
          ...prev.shifts,
          [shiftId]: { ...prev.shifts[shiftId], assignedStaffIds: [...current, staffId] },
        },
      };
    });
  }, []);

  const removeStaffFromShift = useCallback((shiftId: ShiftId, staffId: string) => {
    setDayData(prev => ({
      ...prev,
      shifts: {
        ...prev.shifts,
        [shiftId]: {
          ...prev.shifts[shiftId],
          assignedStaffIds: prev.shifts[shiftId].assignedStaffIds.filter(id => id !== staffId),
        },
      },
    }));
  }, []);

  const setTeamField = useCallback((team: TeamColor, field: keyof TSFTeamData["acuity"] | "totalPatients", value: number) => {
    setDayData(prev => {
      const teamData = { ...prev.teams[team] };
      if (field === "totalPatients") {
        teamData.totalPatients = value;
      } else {
        teamData.acuity = { ...teamData.acuity, [field]: value };
      }
      return { ...prev, teams: { ...prev.teams, [team]: teamData } };
    });
  }, []);

  // Toggle or set check frequency for a single patient slot.
  // Key format: "${teamId}-${slotIndex}" — no patient identifiers stored.
  const setPatientCheck = useCallback((key: string, freq: CheckFreq) => {
    setDayData(prev => ({
      ...prev,
      patientChecks: { ...(prev.patientChecks ?? {}), [key]: freq },
    }));
  }, []);

  // Toggle PC 2603 status for a single bed slot.
  const setPatientPc2603 = useCallback((key: string, val: boolean) => {
    setDayData(prev => ({
      ...prev,
      pc2603: { ...(prev.pc2603 ?? {}), [key]: val },
    }));
  }, []);

  // Filter: show only beds flagged PC 2603 across all team cards.
  const [showOnlyPc2603, setShowOnlyPc2603] = useState(false);

  // Total PC 2603 beds across all teams today.
  const totalPc2603 = useMemo(() =>
    Object.values(dayData.pc2603 ?? {}).filter(Boolean).length,
    [dayData.pc2603]
  );

  // ── Staff management ──────────────────────────────────────────────────────────

  const handleAddStaff = useCallback(() => {
    if (!newStaffName.trim()) return;
    const newMember: TSFStaff = {
      id: `tsf-${Date.now()}`,
      name: newStaffName.trim(),
      role: newStaffRole,
    };
    setStaff(prev => [...prev, newMember]);
    setNewStaffName("");
    toast({ title: "Staff added", description: `${newMember.name} (${newMember.role}) added to 3-Shift Facility.` });
  }, [newStaffName, newStaffRole]);

  const handleRemoveStaff = useCallback((id: string) => {
    setStaff(prev => prev.filter(s => s.id !== id));
    setDayData(prev => {
      const shifts = { ...prev.shifts };
      (["day", "evening", "night"] as ShiftId[]).forEach(shift => {
        shifts[shift] = {
          ...shifts[shift],
          chargeRnId: shifts[shift].chargeRnId === id ? "" : shifts[shift].chargeRnId,
          assignedStaffIds: shifts[shift].assignedStaffIds.filter(sid => sid !== id),
        };
      });
      return { ...prev, shifts };
    });
  }, []);

  // ── Validation helpers ────────────────────────────────────────────────────────

  const getShiftWarnings = useCallback((shiftId: ShiftId): string[] => {
    const warnings: string[] = [];
    const shift = dayData.shifts[shiftId];
    if (!shift.chargeRnId) warnings.push("No Charge RN assigned");
    if (shift.chargeRnId) {
      const others = (["day", "evening", "night"] as ShiftId[]).filter(s => s !== shiftId);
      const doubleBooked = others.some(s => dayData.shifts[s].chargeRnId === shift.chargeRnId);
      if (doubleBooked) warnings.push("Charge RN is assigned to another shift");
    }
    return warnings;
  }, [dayData.shifts]);

  // ── Render ────────────────────────────────────────────────────────────────────

  // Non-admin gate: access not granted → show lock screen
  if (!isAdmin && accessMode === "locked") {
    return (
      <AppLayout>
        <div className="min-h-full bg-slate-900 text-slate-100 flex items-center justify-center p-8">
          <div className="max-w-md w-full text-center space-y-6">
            <div className="mx-auto h-20 w-20 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center shadow-lg">
              <Lock className="h-10 w-10 text-slate-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">Access Restricted</h2>
              <p className="text-slate-400 mt-2 leading-relaxed">
                The 3-Shift Facility module is not yet enabled for your account.
                Please contact an administrator to request access.
              </p>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 text-left space-y-2">
              <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider">What administrators can grant</p>
              <div className="flex items-start gap-3">
                <FlaskConical className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-300">Trial Access</p>
                  <p className="text-xs text-slate-400">Explore with pre-loaded sample data. No changes are saved.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Database className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-emerald-300">Full Access</p>
                  <p className="text-xs text-slate-400">Work with real facility data. All changes are saved.</p>
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              Administrators manage access from within this page under <span className="text-slate-300 font-medium">Access Control</span>.
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      {/* Dark navy page wrapper — visually distinct from the outpatient sections */}
      <div className="min-h-full bg-slate-900 text-slate-100">
        <div className="p-6 max-w-[1400px] mx-auto space-y-6">

          {/* ── Admin Access Control Panel (admin-only) ── */}
          {isAdmin && (
            <div className="rounded-xl border border-slate-600 bg-slate-800/70 p-4">
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck className="h-4 w-4 text-violet-400" />
                <span className="text-sm font-semibold text-violet-300">Access Control</span>
                <span className="text-xs text-slate-400 ml-1">— Set which version non-admin staff can access</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setAccessMode("locked")}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all",
                    accessMode === "locked"
                      ? "bg-slate-600 border-slate-400 text-white"
                      : "border-slate-600 text-slate-400 hover:border-slate-400 hover:text-slate-200"
                  )}
                  data-testid="btn-access-locked"
                >
                  <Lock className="h-3.5 w-3.5" />
                  Staff Locked
                </button>
                <button
                  onClick={() => setAccessMode("trial")}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all",
                    accessMode === "trial"
                      ? "bg-amber-600/30 border-amber-500 text-amber-200"
                      : "border-slate-600 text-slate-400 hover:border-amber-600 hover:text-amber-300"
                  )}
                  data-testid="btn-access-trial"
                >
                  <FlaskConical className="h-3.5 w-3.5" />
                  Trial — Sample Data
                </button>
                <button
                  onClick={() => setAccessMode("full")}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all",
                    accessMode === "full"
                      ? "bg-emerald-700/30 border-emerald-500 text-emerald-200"
                      : "border-slate-600 text-slate-400 hover:border-emerald-600 hover:text-emerald-300"
                  )}
                  data-testid="btn-access-full"
                >
                  <Database className="h-3.5 w-3.5" />
                  Functional — Existing Data
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Current setting: <span className={cn(
                  "font-semibold",
                  accessMode === "locked" ? "text-slate-300" :
                  accessMode === "trial"  ? "text-amber-300" : "text-emerald-300"
                )}>
                  {accessMode === "locked" ? "Locked (staff cannot access)" :
                   accessMode === "trial"  ? "Trial Access (sample data, no saves)" :
                   "Full Access (real data, saves enabled)"}
                </span>
              </p>
            </div>
          )}

          {/* ── Trial Mode Banner (non-admin in trial mode) ── */}
          {isTrialMode && (
            <div className="rounded-xl border border-amber-600/50 bg-amber-900/20 p-4 flex items-start gap-3">
              <FlaskConical className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-300">Trial Mode — Sample Data</p>
                <p className="text-xs text-amber-200/70 mt-0.5">
                  You are viewing pre-loaded sample data. Changes you make here are for exploration only and will not be saved.
                  Contact an administrator to enable Full Access with your facility's real data.
                </p>
              </div>
            </div>
          )}

          {/* ── Header ── */}
          <div className="flex items-center justify-between flex-wrap gap-3 pt-2">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 bg-navy-800 bg-slate-700 rounded-xl flex items-center justify-center border border-slate-600 shadow-lg">
                <Building2 className="h-6 w-6 text-sky-300" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white tracking-tight">3-Shift Facility</h1>
                <p className="text-sm text-slate-400 mt-0.5">
                  Inpatient staffing — isolated from outpatient schedule
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => setShowStaffDialog(true)}
              data-testid="button-manage-staff"
              className="gap-2 border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white"
            >
              <Users className="h-4 w-4" />
              Manage Staff Roster
            </Button>
          </div>

          {/* ── Isolation + variable volume notice ── */}
          <div className="flex items-start gap-2 p-3 rounded-lg border border-slate-600 bg-slate-800/70 text-sm text-slate-300">
            <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-sky-400" />
            <span>
              <strong className="text-white">Isolated module.</strong>{" "}
              Data here is stored separately and has no connection to outpatient Med Home, OB/GYN, or Schedule Management.
              Provider teams (Red / Blue / Green) are for <strong className="text-white">patient intake rotation only</strong> — they have no role in nursing staff assignments.
              <span className="block mt-1 text-slate-400 italic">
                Patient volume is variable and may change.
              </span>
            </span>
          </div>

          {/* ── Date navigation ── */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={goPrev}
              data-testid="button-prev-day"
              className="border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-slate-400" />
              <span className="font-semibold text-lg min-w-[220px] text-center text-white">
                {format(currentDate, "EEEE, MMMM d, yyyy")}
              </span>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={goNext}
              data-testid="button-next-day"
              className="border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={goToday}
              data-testid="button-today"
              className="border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700"
            >
              Today
            </Button>
          </div>

          {/* ── Patient Distribution ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-slate-100 uppercase tracking-wider">
                Patient Distribution
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                {totalPc2603 > 0 && (
                  <span className="text-xs border rounded px-2 py-0.5 bg-purple-900/40 border-purple-600 text-purple-300">
                    <strong>{totalPc2603}</strong> PC 2603
                  </span>
                )}
                {totalPatients > 0 && (
                  <span className="text-xs text-slate-400 border border-slate-600 rounded px-2 py-0.5">
                    Total: <strong className="text-slate-200">{totalPatients}</strong> patients
                  </span>
                )}
                {totalPc2603 > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowOnlyPc2603(v => !v)}
                    data-testid="button-filter-pc2603"
                    className={cn(
                      "text-xs rounded px-2.5 py-0.5 border font-semibold transition-colors cursor-pointer",
                      showOnlyPc2603
                        ? "bg-purple-700 border-purple-500 text-white"
                        : "bg-slate-800 border-slate-600 text-slate-300 hover:border-purple-500 hover:text-purple-300"
                    )}
                  >
                    {showOnlyPc2603 ? "✕ Clear filter" : "Filter: PC 2603 only"}
                  </button>
                )}
              </div>
            </div>

            {/* High-acuity sitter requirement — shown whenever any Level 3 patients are recorded */}
            {totalHighAcuity > 0 && (
              <div className="mb-3 flex items-start gap-2 p-3 rounded-lg border border-red-700/60 bg-red-900/30 text-sm text-red-200">
                <ShieldAlert className="h-4 w-4 mt-0.5 flex-shrink-0 text-red-400" />
                <span>
                  <strong className="text-red-300">
                    {totalHighAcuity} high-acuity patient{totalHighAcuity !== 1 ? "s" : ""} (Level 3) →{" "}
                    {totalHighAcuity} dedicated sitter{totalHighAcuity !== 1 ? "s" : ""} required.
                  </strong>{" "}
                  Sitters are 1:1 for 24/7 observation and{" "}
                  <strong className="text-red-300">cannot be assigned to any other task</strong> during their shift.
                </span>
              </div>
            )}

            {/* Sitter info blurb when no high-acuity yet recorded */}
            {totalHighAcuity === 0 && totalPatients === 0 && (
              <div className="mb-3 flex items-start gap-2 p-2.5 rounded border border-dashed border-slate-600 bg-slate-800/40 text-xs text-slate-400">
                <Eye className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-slate-500" />
                <span>
                  Enter patient counts and acuity levels below. If any <strong className="text-slate-300">Level 3 (high-acuity)</strong> patients are present, the system will calculate how many dedicated sitters are required.
                </span>
              </div>
            )}

            {/* Provider team intake rotation note */}
            <div className="mb-3 p-2.5 rounded border border-dashed border-slate-600 bg-slate-800/40 text-xs text-slate-400 flex items-center gap-2">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
              <span>
                <strong className="text-slate-300">New patient intake today:</strong>{" "}
                <span className={cn("font-semibold", {
                  "text-red-400":     intakeTeam === "red",
                  "text-blue-400":    intakeTeam === "blue",
                  "text-emerald-400": intakeTeam === "green",
                })}>
                  Team {intakeTeam.charAt(0).toUpperCase() + intakeTeam.slice(1)}
                </span>
                {" "}(rotating Red → Blue → Green). Teams are provider intake groups only — not related to nursing staff.
              </span>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {TEAMS.map(team => {
                const teamData = dayData.teams[team.id];
                const acuityTotal = teamData.acuity.level1 + teamData.acuity.level2 + teamData.acuity.level3;
                const acuityMismatch = acuityTotal !== teamData.totalPatients && teamData.totalPatients > 0 && acuityTotal > 0;
                const sittersNeeded = teamData.acuity.level3;
                return (
                  <Card key={team.id} className={cn(
                    "border-2 bg-slate-800 shadow-lg",
                    team.borderColor,
                    team.id === intakeTeam ? "ring-2 ring-offset-2 ring-offset-slate-900 ring-sky-400" : ""
                  )}>
                    <CardHeader className={cn("py-3 px-4 rounded-t-[5px]", team.headerBg)}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={cn("h-2.5 w-2.5 rounded-full", team.dotBg)} />
                          <CardTitle className="text-sm font-semibold text-slate-100">{team.label}</CardTitle>
                        </div>
                        {team.id === intakeTeam && (
                          <Badge className={cn("text-[10px] h-5 border-0 px-2", team.intakeBadge)}>
                            New Patients ▶
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="pt-3 pb-4 px-4 space-y-3">
                      {/* Total patients input — no hardcoded max */}
                      <div>
                        <Label className="text-xs text-slate-400">Total Patients</Label>
                        <Input
                          type="number"
                          min={0}
                          value={teamData.totalPatients || ""}
                          placeholder="0"
                          data-testid={`input-patients-${team.id}`}
                          className="h-8 mt-1 text-center text-base font-bold bg-slate-700 border-slate-600 text-white placeholder:text-slate-500"
                          onChange={e => setTeamField(team.id, "totalPatients", nanToZero(parseInt(e.target.value)))}
                        />
                      </div>

                      {/* Acuity breakdown */}
                      <div>
                        <Label className="text-xs text-slate-400">Acuity Breakdown</Label>
                        <div className="grid grid-cols-3 gap-1.5 mt-1">
                          {(["level1", "level2", "level3"] as const).map((lvl, i) => (
                            <div key={lvl} className="flex flex-col items-center">
                              <span className={cn("text-[10px] font-semibold rounded px-1 mb-0.5", {
                                "bg-green-900/60 text-green-300":  i === 0,
                                "bg-yellow-900/60 text-yellow-300": i === 1,
                                "bg-red-900/60 text-red-300":      i === 2,
                              })}>
                                L{i + 1}
                              </span>
                              <Input
                                type="number"
                                min={0}
                                value={teamData.acuity[lvl] || ""}
                                placeholder="0"
                                data-testid={`input-acuity-${team.id}-${lvl}`}
                                className="h-7 text-center text-sm p-1 bg-slate-700 border-slate-600 text-white placeholder:text-slate-500"
                                onChange={e => setTeamField(team.id, lvl, nanToZero(parseInt(e.target.value)))}
                              />
                            </div>
                          ))}
                        </div>
                        {acuityMismatch && (
                          <p className="text-[10px] text-amber-400 mt-1 flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" />
                            Acuity total ({acuityTotal}) ≠ patient count ({teamData.totalPatients})
                          </p>
                        )}
                        {/* Per-team sitter note */}
                        {sittersNeeded > 0 && (
                          <div className="mt-2 flex items-center gap-1.5 rounded px-2 py-1 bg-red-900/40 border border-red-700/50">
                            <Eye className="h-3 w-3 text-red-400 flex-shrink-0" />
                            <span className="text-[11px] text-red-300 font-medium">
                              {sittersNeeded} sitter{sittersNeeded !== 1 ? "s" : ""} required — dedicated, 1:1
                            </span>
                          </div>
                        )}
                      </div>

                      {/* ── Per-patient check frequency — one slot per patient, no identifiers ── */}
                      {teamData.totalPatients > 0 && (
                        <div>
                          <Label className="text-xs text-slate-400">Check Frequency per Bed</Label>
                          <div className="mt-1.5 flex flex-wrap gap-2">
                            {Array.from({ length: teamData.totalPatients }, (_, i) => {
                              const key = `${team.id}-${i}`;
                              const freq: CheckFreq = (dayData.patientChecks ?? {})[key] ?? "hourly";
                              const isPC2603: boolean = !!(dayData.pc2603 ?? {})[key];
                              // Apply filter: skip beds not flagged when filter is active.
                              if (showOnlyPc2603 && !isPC2603) return null;
                              return (
                                <div key={key} className="flex flex-col items-center gap-0.5">
                                  {/* Check-frequency toggle */}
                                  <button
                                    type="button"
                                    data-testid={`check-freq-${key}`}
                                    title={freq === "q15" ? "15-min checks — click to switch to Hourly" : "Hourly checks — click to switch to 15-min"}
                                    onClick={() => setPatientCheck(key, freq === "q15" ? "hourly" : "q15")}
                                    className={cn(
                                      "flex flex-col items-center rounded px-2 py-1 border text-[10px] font-semibold transition-colors cursor-pointer select-none",
                                      freq === "q15"
                                        ? "bg-red-900/50 border-red-600 text-red-300 hover:bg-red-800/60"
                                        : "bg-blue-900/50 border-blue-600 text-blue-300 hover:bg-blue-800/60"
                                    )}
                                  >
                                    <span className="text-[9px] text-slate-400 leading-tight">Bed {i + 1}</span>
                                    <span className="leading-tight mt-0.5">
                                      {freq === "q15" ? "Q15" : "Q60"}
                                    </span>
                                  </button>
                                  {/* PC 2603 toggle */}
                                  <button
                                    type="button"
                                    data-testid={`pc2603-${key}`}
                                    title={isPC2603 ? "PC 2603 — click to remove" : "Mark as Penal Code 2603 (court-ordered med)"}
                                    onClick={() => setPatientPc2603(key, !isPC2603)}
                                    className={cn(
                                      "rounded px-1.5 py-0.5 border text-[9px] font-bold transition-colors cursor-pointer select-none leading-tight",
                                      isPC2603
                                        ? "bg-purple-800/70 border-purple-500 text-purple-200 hover:bg-purple-700/80"
                                        : "bg-slate-800/60 border-slate-600 text-slate-500 hover:border-purple-600 hover:text-purple-400"
                                    )}
                                  >
                                    {isPC2603 ? "PC 2603" : "2603?"}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                          <p className="text-[10px] text-slate-500 mt-1.5 flex items-center flex-wrap gap-x-2 gap-y-1">
                            <span className="inline-flex items-center gap-1">
                              <span className="h-2 w-2 rounded-sm bg-red-600/70" />
                              <span className="text-red-400">Q15</span> = 15-min checks
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <span className="h-2 w-2 rounded-sm bg-blue-600/70" />
                              <span className="text-blue-400">Q60</span> = Hourly checks
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <span className="h-2 w-2 rounded-sm bg-purple-600/70" />
                              <span className="text-purple-400">PC 2603</span> = Court-ordered med
                            </span>
                            · tap to toggle
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* ── Shift Assignments ── */}
          <div>
            <h2 className="text-base font-semibold text-slate-100 uppercase tracking-wider mb-3">
              Shift Assignments
            </h2>
            <div className="grid grid-cols-3 gap-4">
              {SHIFTS.map(shift => {
                const shiftData = dayData.shifts[shift.id];
                const warnings = getShiftWarnings(shift.id);
                const assignedStaff = shiftData.assignedStaffIds
                  .map(id => staff.find(s => s.id === id))
                  .filter((s): s is TSFStaff => !!s);
                const chargeRn = staff.find(s => s.id === shiftData.chargeRnId);
                const availableToAdd = shiftStaffOptions.filter(
                  s => !shiftData.assignedStaffIds.includes(s.id)
                );

                return (
                  <Card key={shift.id} className={cn(
                    "border-l-4 border-t border-r border-b bg-slate-800 shadow-lg",
                    shift.borderColor
                  )}>
                    <CardHeader className={cn("py-3 px-4 rounded-tl-[1px]", shift.headerBg)}>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className={cn("text-sm font-bold", shift.accentColor)}>
                            {shift.label} Shift
                          </CardTitle>
                          <p className="text-xs text-slate-400">{shift.time}</p>
                        </div>
                        {warnings.length > 0 && (
                          <AlertCircle className="h-4 w-4 text-amber-400" />
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="pt-4 pb-4 px-4 space-y-4">

                      {/* Warnings */}
                      {warnings.map((w, i) => (
                        <p key={i} className="text-[11px] text-amber-300 bg-amber-900/30 border border-amber-700/50 rounded px-2 py-1 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3 flex-shrink-0" />
                          {w}
                        </p>
                      ))}

                      {/* Charge RN — exactly one per shift */}
                      <div>
                        <Label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                          Charge RN (1 required)
                        </Label>
                        <Select
                          value={shiftData.chargeRnId || "none"}
                          onValueChange={v => setChargeRn(shift.id, v === "none" ? "" : v)}
                        >
                          <SelectTrigger
                            className="h-8 mt-1 text-sm bg-slate-700 border-slate-600 text-slate-200"
                            data-testid={`select-charge-rn-${shift.id}`}
                          >
                            <SelectValue placeholder="Assign Charge RN…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">
                              <span className="text-muted-foreground">— Unassigned —</span>
                            </SelectItem>
                            {chargeRnOptions.map(s => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name}
                                {s.role === "RN" && (
                                  <span className="text-muted-foreground text-xs ml-1">(RN)</span>
                                )}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {chargeRn && (
                          <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1">
                            ✓ {chargeRn.name}
                            <span className="text-slate-500 ml-1">— {chargeRn.role}</span>
                          </p>
                        )}
                      </div>

                      {/* LVN / MA / RN assigned to the shift — NOT to any team or provider */}
                      <div>
                        <Label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                          LVN / MA Staff
                        </Label>
                        <p className="text-[10px] text-slate-500 mb-1.5">
                          Assigned to this shift as a whole — not to teams or providers
                        </p>

                        {assignedStaff.length === 0 && (
                          <p className="text-xs text-slate-500 italic mb-2">No staff added yet</p>
                        )}

                        <div className="space-y-1 mb-2">
                          {assignedStaff.map(s => (
                            <div
                              key={s.id}
                              className="flex items-center justify-between bg-slate-700/60 rounded px-2 py-1"
                              data-testid={`staff-row-${shift.id}-${s.id}`}
                            >
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className={cn("text-[10px] h-4 px-1 border", ROLE_BADGE[s.role])}>
                                  {s.role}
                                </Badge>
                                <span className="text-xs font-medium text-slate-200">{s.name}</span>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 text-slate-500 hover:text-red-400"
                                onClick={() => removeStaffFromShift(shift.id, s.id)}
                                data-testid={`button-remove-staff-${shift.id}-${s.id}`}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                        </div>

                        {/* Add staff picker */}
                        {addingStaffToShift === shift.id ? (
                          <div className="flex gap-1">
                            <Select
                              value={staffPickerValue}
                              onValueChange={v => {
                                if (v) {
                                  addStaffToShift(shift.id, v);
                                  setStaffPickerValue("");
                                  setAddingStaffToShift(null);
                                }
                              }}
                            >
                              <SelectTrigger
                                className="h-7 text-xs flex-1 bg-slate-700 border-slate-600 text-slate-200"
                                data-testid={`select-add-staff-${shift.id}`}
                              >
                                <SelectValue placeholder="Select staff…" />
                              </SelectTrigger>
                              <SelectContent>
                                {availableToAdd.length === 0 && (
                                  <SelectItem value="__none" disabled>No available staff</SelectItem>
                                )}
                                {availableToAdd.map(s => (
                                  <SelectItem key={s.id} value={s.id}>
                                    <span className="flex items-center gap-2">
                                      <span>{s.name}</span>
                                      <span className="text-muted-foreground text-xs">({s.role})</span>
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-slate-400 hover:text-white"
                              onClick={() => { setAddingStaffToShift(null); setStaffPickerValue(""); }}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs gap-1 w-full border-slate-600 bg-slate-700/50 text-slate-300 hover:bg-slate-600 hover:text-white"
                            onClick={() => { setAddingStaffToShift(shift.id); setStaffPickerValue(""); }}
                            data-testid={`button-add-staff-${shift.id}`}
                          >
                            <Plus className="h-3 w-3" />
                            Add LVN / MA
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* ── Medication Pass & Documentation ── */}
          <MedPassSection
            staff={staff}
            dayData={dayData}
            setDayData={setDayData}
          />

        </div>
      </div>

      {/* ── Staff Management Dialog ───────────────────────────────────────────── */}
      <Dialog open={showStaffDialog} onOpenChange={setShowStaffDialog}>
        <DialogContent className="max-w-lg bg-slate-800 border-slate-700 text-slate-100">
          <DialogHeader>
            <DialogTitle className="text-white">3-Shift Facility — Staff Roster</DialogTitle>
            <p className="text-xs text-slate-400 mt-1 border border-slate-600 bg-slate-700/50 rounded p-2">
              This roster is <strong className="text-slate-200">completely separate</strong> from the outpatient schedule. Staff added here only appear in the 3-Shift Facility section.
            </p>
          </DialogHeader>

          {/* Add new staff */}
          {showAddStaff ? (
            <div className="border border-slate-600 rounded-lg p-3 bg-slate-700/50 space-y-3">
              <p className="text-sm font-medium text-slate-200">Add New Staff Member</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-slate-400">Name</Label>
                  <Input
                    value={newStaffName}
                    onChange={e => setNewStaffName(e.target.value)}
                    placeholder="Full name"
                    className="h-8 mt-1 text-sm bg-slate-700 border-slate-600 text-white placeholder:text-slate-500"
                    data-testid="input-new-staff-name"
                    onKeyDown={e => e.key === "Enter" && handleAddStaff()}
                  />
                </div>
                <div>
                  <Label className="text-xs text-slate-400">Role</Label>
                  <Select value={newStaffRole} onValueChange={v => setNewStaffRole(v as TSFRole)}>
                    <SelectTrigger className="h-8 mt-1 text-sm bg-slate-700 border-slate-600 text-slate-200" data-testid="select-new-staff-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["Charge RN", "RN", "LVN", "MA"] as TSFRole[]).map(r => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAddStaff} data-testid="button-confirm-add-staff">
                  Add Staff
                </Button>
                <Button size="sm" variant="ghost" className="text-slate-300 hover:text-white" onClick={() => { setShowAddStaff(false); setNewStaffName(""); }}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-1 self-start border-slate-600 bg-slate-700/50 text-slate-300 hover:bg-slate-600 hover:text-white"
              onClick={() => setShowAddStaff(true)}
              data-testid="button-show-add-staff"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Staff Member
            </Button>
          )}

          {/* Staff list */}
          <div className="space-y-1 max-h-[340px] overflow-y-auto">
            {(["Charge RN", "RN", "LVN", "MA"] as TSFRole[]).map(role => {
              const roleStaff = staff.filter(s => s.role === role);
              if (roleStaff.length === 0) return null;
              return (
                <div key={role}>
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-1 pt-2 pb-1">
                    {role}s
                  </p>
                  {roleStaff.map(s => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between px-3 py-2 rounded hover:bg-slate-700/60"
                      data-testid={`staff-roster-row-${s.id}`}
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={cn("text-[10px] h-4 px-1 border", ROLE_BADGE[s.role])}>
                          {s.role}
                        </Badge>
                        <span className="text-sm text-slate-200">{s.name}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-slate-500 hover:text-red-400"
                        onClick={() => handleRemoveStaff(s.id)}
                        data-testid={`button-remove-roster-${s.id}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="border-slate-600 bg-slate-700 text-slate-200 hover:bg-slate-600"
              onClick={() => setShowStaffDialog(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
