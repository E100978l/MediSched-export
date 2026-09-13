import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import ExcelJS from "exceljs";
import { AppLayout } from "@/components/layout/AppLayout";
import { useStaff, useUnavailability, useClinics, useRnAssignments, useWeeklyRnAssignments, useCallAvailability, useProviderSchedules, isStaffUnavailable, isClinicOpen } from "@/lib/store";
import { RN_POSITIONS, EMPLOYMENT_PRIORITY } from "@shared/schema";
import { SPECIALTIES, SHARED_LVN_SPECIALTIES, StaffMember, Specialty } from "@/lib/mockData";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Filter, AlertCircle, Edit2, Copy, Check, AlertTriangle, CalendarOff, Star, Phone, UserPlus, ClipboardList, Trash2, Plus, Info, RefreshCw, Mail, Lock, ShieldCheck, Download } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { format, addDays, startOfMonth, endOfMonth, eachDayOfInterval, isWeekend, differenceInCalendarDays, startOfWeek, endOfWeek, addWeeks, isValid } from "date-fns";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";

// ── Permanent charge RN cross-cover groups ────────────────────────────────────
// Which positions can cross-cover which (same merge group, 2-way)
const PERM_RN_CROSS_COVER: Record<string, string[]> = {
  'charge-med-home-1':  ['charge-med-home-2'],
  'charge-med-home-2':  ['charge-med-home-1'],
  'charge-ob-peds':     ['floor-allergy-peds'],
  'floor-allergy-peds': ['charge-ob-peds'],
};

interface FormCEntry {
  id: string;
  startDate: string;
  endDate: string;
  am: 'Patient Care' | 'Off' | 'Admin' | 'Meeting';
  pm: 'Patient Care' | 'Off' | 'Admin' | 'Meeting';
}

interface AssignmentState {
  lvnId: string;
  status: 'Active' | 'Sick' | 'Vacation';
  clinicAssignment?: 'Flu Clinic' | 'Retinal AI' | null;
}

interface ProviderDayState {
  providerId: string;
  date: string;
  am: 'Patient Care' | 'Admin' | 'Off' | 'Meeting';
  pm: 'Patient Care' | 'Admin' | 'Off' | 'Meeting';
  assignments: AssignmentState[];
}

const generateInitialMonthState = (year: number, month: number, staff: StaffMember[]) => {
  const startDate = startOfMonth(new Date(year, month));
  const endDate = endOfMonth(startDate);
  const days = eachDayOfInterval({ start: startDate, end: endDate });
  const state: Record<string, ProviderDayState> = {};

  days.forEach(day => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const providers = staff.filter(s => ['MD', 'DO', 'NP', 'PA'].includes(s.role));
    providers.forEach(provider => {
      const key = `${provider.id}-${dateStr}`;
      const assignedLvns = staff.filter(s => s.assignedTo && s.assignedTo.includes(provider.id));
      state[key] = {
        providerId: provider.id,
        date: dateStr,
        am: isWeekend(day) ? 'Off' : 'Patient Care',
        pm: isWeekend(day) ? 'Off' : 'Patient Care',
        assignments: assignedLvns.map(lvn => ({ lvnId: lvn.id, status: 'Active' as const, clinicAssignment: null })),
      };
    });
  });
  return state;
};

// ── Specialty → visual style (used for both HTML copy and in-app display)
const SPECIALTY_PALETTE: Record<string, { bg: string; headerBg: string; headerColor: string }> = {
  'Internal/Family Med (Met Home 1)': { bg: '#dbeafe', headerBg: '#1d4ed8', headerColor: '#ffffff' },
  'Internal/Family Med (Met Home 2)': { bg: '#dcfce7', headerBg: '#15803d', headerColor: '#ffffff' },
  'OB/GYN':              { bg: '#fce7f3', headerBg: '#be185d', headerColor: '#ffffff' },
  'Pediatrics':          { bg: '#fef9c3', headerBg: '#a16207', headerColor: '#ffffff' },
  'Allergy':             { bg: '#ffedd5', headerBg: '#c2410c', headerColor: '#ffffff' },
  'Optometry':           { bg: '#f3e8ff', headerBg: '#7c3aed', headerColor: '#ffffff' },
  'Diabetic Education':  { bg: '#ccfbf1', headerBg: '#0f766e', headerColor: '#ffffff' },
};
const CLINIC_PALETTE = { bg: '#f0fdf4', headerBg: '#166534', headerColor: '#ffffff' };
const DEFAULT_PALETTE = { bg: '#f1f5f9', headerBg: '#475569', headerColor: '#ffffff' };

async function downloadWorkbook(workbook: ExcelJS.Workbook, filename: string) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function Schedule() {
  const { staff, updateStaffMember, coverageHistory, addCoverageRecord, isLoading: staffLoading, isError: staffError, refetch: staffRefetch } = useStaff();
  const { unavailability, isLoading: unavailLoading, isError: unavailError, refetch: unavailRefetch } = useUnavailability();
  const { clinics, overrides, assignments: clinicAssignments, isLoading: clinicsLoading, isError: clinicsError, refetch: clinicsRefetch } = useClinics();
  const [date, setDate] = useState(new Date());
  const dateStr0 = format(date, 'yyyy-MM-dd');
  const { assignments: rnAssignmentsToday, upsertAssignment: upsertRnAssignment, deleteAssignment: deleteRnAssignment, isLoading: rnLoading, isError: rnError, refetch: rnRefetch } = useRnAssignments(dateStr0);
  const { callAvailability: allCallAvailability, isLoading: callLoading, isError: callError, refetch: callRefetch } = useCallAvailability();
  const rns = staff.filter(s => s.role === 'RN');
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  // RNs who submitted availability for dateStr0, sorted by employment priority (Part-time first, then Per Diem, Extra Help, Full-time)
  const rnAvailableToday = useMemo(() => {
    const availRecords = allCallAvailability.filter(r => r.availableDate === dateStr0);
    return rns
      .map(rn => {
        const avail = availRecords.find(r => r.staffId === rn.id);
        return avail ? { rn, avail } : null;
      })
      .filter((x): x is { rn: typeof rns[0]; avail: typeof allCallAvailability[0] } => x !== null)
      .sort((a, b) => {
        const pa = EMPLOYMENT_PRIORITY[a.rn.employmentType as keyof typeof EMPLOYMENT_PRIORITY] ?? 99;
        const pb = EMPLOYMENT_PRIORITY[b.rn.employmentType as keyof typeof EMPLOYMENT_PRIORITY] ?? 99;
        return pa - pb;
      });
  }, [allCallAvailability, rns, dateStr0]);

  // ── Permanent RNs: derived from each RN's defaultChargePositionId field ─────
  // Built from staff data so any admin change on the Staff page is reflected here immediately.
  const permanentRns = useMemo(() => {
    const result: Record<string, typeof rns[number] | null> = {};
    rns.forEach(r => {
      if (r.defaultChargePositionId) {
        result[r.defaultChargePositionId] = r;
      }
    });
    return result;
  }, [rns]);

  // Returns the next-qualified RN (cascade: cross-cover perm → extra help → last resort)
  const getNextQualifiedRn = (positionId: string, dateStr: string) => {
    // Tier 1: permanent cross-cover partner (same group, not absent)
    for (const crossPosId of (PERM_RN_CROSS_COVER[positionId] ?? [])) {
      const crossRn = permanentRns[crossPosId];
      if (crossRn && !isStaffUnavailable(unavailability, crossRn.id, dateStr)) {
        return { rn: crossRn, type: 'cross-cover' as const };
      }
    }
    // Tier 2: Extra Help RN with confirmed availability today, not absent
    const extras = rnAvailableToday.filter(
      ({ rn }) => rn.employmentType === 'Extra Help' && !isStaffUnavailable(unavailability, rn.id, dateStr)
    );
    if (extras.length > 0) return { rn: extras[0].rn, type: 'extra-help' as const };
    // Tier 3: last resort (ANM or double cover)
    return { rn: null, type: 'last-resort' as const };
  };

  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month' | 'outlook'>('day');
  // Multi-specialty filter — empty array means "all selected"
  const [selectedSpecialties, setSelectedSpecialties] = useState<string[]>([]);
  const [copiedDay, setCopiedDay] = useState(false);
  const [downloadedDay, setDownloadedDay] = useState(false);
  const [copiedWeek, setCopiedWeek] = useState(false);
  // Week view: LVN override/swap state. Key = `${providerId}-${dateStr}-am` | `-pm` | `-full`
  const [weekLvnSwap, setWeekLvnSwap] = useState<Record<string, string>>({});
  // Coverage dropdown state: key = `${providerId}-${dateStr}-am` or `-pm`
  const [selectedCoverage, setSelectedCoverage] = useState<Record<string, string>>({});
  const [assigningKey, setAssigningKey] = useState<string | null>(null);

  // Day view inline coverage state: key = `day-${providerId}-${dateStr}-${shift}`
  const [dayViewCoverage, setDayViewCoverage] = useState<Record<string, string>>({});
  const [dayViewAssigningKey, setDayViewAssigningKey] = useState<string | null>(null);

  // Conflict banner dismiss — reset whenever the date changes
  const [dismissedConflictDate, setDismissedConflictDate] = useState<string | null>(null);

  // Validate All dialog
  const [showValidateDialog, setShowValidateDialog] = useState(false);
  type ValidateIssue = { dateStr: string; severity: 'error' | 'warning'; message: string };
  const [validateResults, setValidateResults] = useState<ValidateIssue[]>([]);

  // Block Save on Conflict — when true, any shift-level LVN double-book is HARD-BLOCKED (no Force Anyway).
  // Admins can toggle this off to permit override assignments.
  const [blockSaveOnConflict, setBlockSaveOnConflict] = useState(true);

  // Conflict suggestion dialog — populated when a shift conflict is detected
  type ConflictSuggestionEntry = { lvn: StaffMember; reason: string; moveCount: number; sameSpecialty: boolean };
  const [conflictSuggestion, setConflictSuggestion] = useState<{
    blockedLvnName: string;
    conflictMessage: string;
    suggestions: ConflictSuggestionEntry[];
    onForceAnyway: () => void;
    onAutoAssign: (lvnId: string) => void;
  } | null>(null);

  const [scheduleState, setScheduleState] = useState<Record<string, ProviderDayState>>(() =>
    generateInitialMonthState(date.getFullYear(), date.getMonth(), staff)
  );

  const [editingSlot, setEditingSlot] = useState<{ providerId: string; date: string } | null>(null);
  const [editAm, setEditAm] = useState<string>("");
  const [editPm, setEditPm] = useState<string>("");
  const [editAssignments, setEditAssignments] = useState<AssignmentState[]>([]);

  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [editStaffName, setEditStaffName] = useState("");
  const [editStaffSpecialty, setEditStaffSpecialty] = useState<Specialty>(SPECIALTIES[0]);

  // ── Form C — bulk schedule entry ─────────────────────────────────────────────
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [showFormC, setShowFormC] = useState(false);
  const [formCProviderId, setFormCProviderId] = useState('');
  const [formCSkipWeekends, setFormCSkipWeekends] = useState(true);
  const [formCApplying, setFormCApplying] = useState(false);
  const [formCEntries, setFormCEntries] = useState<FormCEntry[]>([
    { id: '1', startDate: todayStr, endDate: todayStr, am: 'Patient Care', pm: 'Patient Care' },
  ]);

  const addFormCEntry = () => {
    setFormCEntries(prev => [
      ...prev,
      { id: String(Date.now()), startDate: todayStr, endDate: todayStr, am: 'Patient Care', pm: 'Patient Care' },
    ]);
  };

  const removeFormCEntry = (id: string) => {
    setFormCEntries(prev => prev.filter(e => e.id !== id));
  };

  const updateFormCEntry = (id: string, field: keyof Omit<FormCEntry, 'id'>, value: string) => {
    setFormCEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  };

  const openFormC = () => {
    const todayFresh = format(new Date(), 'yyyy-MM-dd');
    setFormCProviderId('');
    setFormCSkipWeekends(true);
    setFormCEntries([{ id: '1', startDate: todayFresh, endDate: todayFresh, am: 'Patient Care', pm: 'Patient Care' }]);
    setShowFormC(true);
  };

  const handleFormCApply = async () => {
    if (!formCProviderId) {
      toast({ title: "No provider selected", description: "Please select a provider before applying.", variant: "destructive" });
      return;
    }
    if (formCEntries.length === 0) {
      toast({ title: "No entries", description: "Add at least one schedule entry row.", variant: "destructive" });
      return;
    }

    // Expand every entry's date range into individual dates.
    // Use a Map keyed by date so later rows overwrite earlier ones for the same date (last-row-wins).
    const dateMap = new Map<string, { am: FormCEntry['am']; pm: FormCEntry['pm'] }>();
    for (let rowIdx = 0; rowIdx < formCEntries.length; rowIdx++) {
      const entry = formCEntries[rowIdx];
      const start = new Date(entry.startDate + 'T12:00:00');
      const end   = new Date(entry.endDate   + 'T12:00:00');

      // Guard against blank or invalid date inputs
      if (!entry.startDate || !entry.endDate || !isValid(start) || !isValid(end)) {
        toast({ title: "Invalid date", description: `Row ${rowIdx + 1} has a blank or invalid date. Please fill in both start and end dates.`, variant: "destructive" });
        return;
      }
      if (start > end) {
        toast({ title: "Invalid date range", description: `Row ${rowIdx + 1}: start date must be on or before end date.`, variant: "destructive" });
        return;
      }

      const days = eachDayOfInterval({ start, end });
      for (const day of days) {
        if (formCSkipWeekends && isWeekend(day)) continue;
        dateMap.set(format(day, 'yyyy-MM-dd'), { am: entry.am, pm: entry.pm });
      }
    }

    const datesToSave = Array.from(dateMap.entries()).map(([date, { am, pm }]) => ({ date, am, pm }));

    if (datesToSave.length === 0) {
      toast({ title: "No weekdays in range", description: "All selected dates fall on weekends. Uncheck 'Skip weekends' or choose different dates.", variant: "destructive" });
      return;
    }

    setFormCApplying(true);
    let savedCount = 0;
    const errors: string[] = [];

    for (const { date, am, pm } of datesToSave) {
      try {
        await saveSchedule({ providerId: formCProviderId, date, am, pm });
        // Also update local scheduleState for instant UI refresh
        const key = `${formCProviderId}-${date}`;
        setScheduleState(prev => ({
          ...prev,
          [key]: { ...getProviderDayState(formCProviderId, date), am: am as ProviderDayState['am'], pm: pm as ProviderDayState['pm'] },
        }));
        savedCount++;
      } catch {
        errors.push(date);
      }
    }

    setFormCApplying(false);

    if (errors.length === 0) {
      toast({ title: "Form C applied", description: `${savedCount} day${savedCount !== 1 ? 's' : ''} saved successfully.` });
      setShowFormC(false);
    } else {
      toast({
        title: `Saved ${savedCount} of ${datesToSave.length} days`,
        description: `Could not save: ${errors.join(', ')}. Please try again.`,
        variant: "destructive",
      });
    }
  };

  const handleDateChange = (days: number) => setDate(prev => addDays(prev, days));

  const getProviderDayState = (providerId: string, dateStr: string): ProviderDayState => {
    const key = `${providerId}-${dateStr}`;
    return scheduleState[key] || {
      providerId,
      date: dateStr,
      am: isWeekend(new Date(dateStr + 'T12:00:00')) ? 'Off' : 'Patient Care',
      pm: isWeekend(new Date(dateStr + 'T12:00:00')) ? 'Off' : 'Patient Care',
      assignments: staff.filter(s => s.assignedTo?.includes(providerId)).map(lvn => ({
        lvnId: lvn.id, status: 'Active' as const, clinicAssignment: null,
      })),
    };
  };

  // Returns a conflict description if this LVN is already committed to ANOTHER provider's patient-care
  // shift on the given date. Excludes `excludeProviderId` (the target provider, so self-assignment is OK).
  const checkLvnShiftConflict = (
    lvnId: string,
    dateStr: string,
    shift: 'am' | 'pm',
    excludeProviderId?: string
  ): { providerName: string } | null => {
    const allProv = staff.filter(s => ['MD', 'DO', 'NP', 'PA'].includes(s.role));
    const conflict = allProv.find(p => {
      if (excludeProviderId && p.id === excludeProviderId) return false;
      if (isStaffUnavailable(unavailability, p.id, dateStr)) return false;
      const ps = getProviderDayState(p.id, dateStr);
      const providerInShift = shift === 'am' ? ps.am === 'Patient Care' : ps.pm === 'Patient Care';
      if (!providerInShift) return false;
      return ps.assignments.some(a => a.lvnId === lvnId && a.status === 'Active');
    });
    if (conflict) return { providerName: conflict.name };
    // Also conflict if LVN has a clinic assignment on the same shift
    const clinicConflict = clinicAssignments.find(a => {
      if (a.staffId !== lvnId || a.date !== dateStr) return false;
      const cs = a.shift;
      return cs === 'Full' || (shift === 'am' && cs === 'AM') || (shift === 'pm' && cs === 'PM');
    });
    return clinicConflict ? { providerName: clinicConflict.clinicName } : null;
  };

  // Returns true if the LVN has a clinic assignment whose shift overlaps the given provider shift.
  // 'full' means checking both AM and PM (any clinic blocks).
  const lvnClinicConflictsWithShift = (lvnId: string, dateStr: string, providerShift: 'am' | 'pm' | 'full'): boolean => {
    return clinicAssignments.some(a => {
      if (a.staffId !== lvnId || a.date !== dateStr) return false;
      const cs = a.shift; // 'AM' | 'PM' | 'Full'
      if (cs === 'Full') return true;
      if (providerShift === 'full') return true;
      return (providerShift === 'am' && cs === 'AM') || (providerShift === 'pm' && cs === 'PM');
    });
  };

  // Builds the hover tooltip text for an LVN option: "Full Day Schedule: AM – X · PM – Y"
  const getLvnScheduleTooltip = (lvn: StaffMember, dateStr: string): string => {
    const providerMembers = (lvn.assignedTo ?? [])
      .map(pid => staff.find(s => s.id === pid))
      .filter((p): p is StaffMember => !!p);
    if (providerMembers.length === 0) return 'Full Day Schedule: AM – Float · PM – Float';
    const getShiftLabel = (shift: 'am' | 'pm') =>
      providerMembers.map(p => {
        const ps = getProviderDayState(p.id, dateStr);
        return (shift === 'am' ? ps.am : ps.pm) === 'Patient Care' ? p.name : 'Off';
      }).join(', ');
    const covRecs = coverageHistory.filter(h => h.staffId === lvn.id && h.date === dateStr);
    const covStr = covRecs.length > 0 ? ` · Covering: ${covRecs.map(r => r.providerName).join(', ')}` : '';
    return `Full Day Schedule: AM – ${getShiftLabel('am')} · PM – ${getShiftLabel('pm')}${covStr}`;
  };

  // Finds up to 3 free, qualified LVNs to suggest when a conflict is detected
  const computeConflictSuggestions = (
    forProviderId: string,
    dateStr: string,
    shift: 'am' | 'pm',
    excludeLvnId: string
  ): ConflictSuggestionEntry[] => {
    const provider = staff.find(s => s.id === forProviderId);
    if (!provider) return [];
    const monthPrefix = format(startOfMonth(new Date()), 'yyyy-MM');
    return staff
      .filter(lvn => {
        if (lvn.role !== 'LVN') return false;
        if (lvn.id === excludeLvnId) return false;
        if (isStaffUnavailable(unavailability, lvn.id, dateStr)) return false;
        if (lvnClinicConflictsWithShift(lvn.id, dateStr, shift)) return false;
        if (checkLvnShiftConflict(lvn.id, dateStr, shift, forProviderId)) return false;
        return lvn.specialty === provider.specialty || (lvn.crossTrained ?? []).includes(provider.specialty as Specialty);
      })
      .map(lvn => {
        const sameSpecialty = lvn.specialty === provider.specialty;
        const moveCount = coverageHistory.filter(h => h.staffId === lvn.id && h.date.startsWith(monthPrefix)).length;
        const reason = sameSpecialty
          ? `Primary specialty match${moveCount === 0 ? ', not moved this month' : `, moved ${moveCount}× this month`}`
          : `Cross-trained in ${provider.specialty}${moveCount === 0 ? ', not moved this month' : `, moved ${moveCount}× this month`}`;
        return { lvn, sameSpecialty, moveCount, reason };
      })
      .sort((a, b) => {
        if (a.sameSpecialty !== b.sameSpecialty) return a.sameSpecialty ? -1 : 1;
        return a.moveCount - b.moveCount;
      })
      .slice(0, 3);
  };

  // Scans the next 4 weeks for LVN conflicts, overbooking, and missing LVN coverage
  const runValidateAll = () => {
    const issues: ValidateIssue[] = [];
    const allProv = staff.filter(s => ['MD', 'DO', 'NP', 'PA'].includes(s.role));
    const lvns = staff.filter(s => s.role === 'LVN');
    const scanDays = Array.from({ length: 28 }, (_, i) => addDays(new Date(), i))
      .filter(d => !isWeekend(d));

    scanDays.forEach(day => {
      const ds = format(day, 'yyyy-MM-dd');
      const dayLabel = format(day, 'EEE MMM d');

      // Check each LVN for same-shift double-assignment
      lvns.forEach(lvn => {
        // Pre-flag: LVN's permanent panel lists multiple providers (each one being in patient care)
        const panelProviders = allProv.filter(p => lvn.assignedTo?.includes(p.id));
        if (panelProviders.length > 1) {
          const allInPC = panelProviders.filter(p =>
            !isStaffUnavailable(unavailability, p.id, ds) &&
            (getProviderDayState(p.id, ds).am === 'Patient Care' || getProviderDayState(p.id, ds).pm === 'Patient Care')
          );
          if (allInPC.length > 1) {
            issues.push({
              dateStr: ds,
              severity: 'error',
              message: `${dayLabel}: ${lvn.name} is on the permanent panel of ${allInPC.map(p => p.name).join(' & ')} simultaneously. Fix: open Staff page → edit ${lvn.name} → remove from one provider's panel, or mark ${lvn.name} as Sick/Cover for that day on the schedule.`,
            });
          }
        }

        const amConflicts = allProv.filter(p => {
          if (isStaffUnavailable(unavailability, p.id, ds)) return false;
          const ps = getProviderDayState(p.id, ds);
          return ps.am === 'Patient Care' && ps.assignments.some(a => a.lvnId === lvn.id && a.status === 'Active');
        });
        const pmConflicts = allProv.filter(p => {
          if (isStaffUnavailable(unavailability, p.id, ds)) return false;
          const ps = getProviderDayState(p.id, ds);
          return ps.pm === 'Patient Care' && ps.assignments.some(a => a.lvnId === lvn.id && a.status === 'Active');
        });
        if (amConflicts.length > 1)
          issues.push({ dateStr: ds, severity: 'error', message: `${dayLabel}: ${lvn.name} double-booked AM — active for ${amConflicts.map(p => p.name).join(' & ')} at the same time. Fix: set ${lvn.name} to Sick/Cover for one provider on this day, or adjust their permanent panel in Staff.` });
        if (pmConflicts.length > 1)
          issues.push({ dateStr: ds, severity: 'error', message: `${dayLabel}: ${lvn.name} double-booked PM — active for ${pmConflicts.map(p => p.name).join(' & ')} at the same time. Fix: set ${lvn.name} to Sick/Cover for one provider on this day, or adjust their permanent panel in Staff.` });

        // Coverage record + regular assignment overlap (soft warning)
        const covRecs = coverageHistory.filter(h => h.staffId === lvn.id && h.date === ds);
        if (covRecs.length > 0 && (amConflicts.length > 0 || pmConflicts.length > 0)) {
          covRecs.forEach(rec => {
            issues.push({ dateStr: ds, severity: 'warning', message: `${dayLabel}: ${lvn.name} has a coverage record for ${rec.providerName} AND is still active on their regular schedule — verify they aren't in two places at once.` });
          });
        }
      });

      // Check each provider for missing LVN
      allProv.forEach(p => {
        if (isStaffUnavailable(unavailability, p.id, ds)) return;
        const ps = getProviderDayState(p.id, ds);
        if (ps.am !== 'Patient Care' && ps.pm !== 'Patient Care') return;
        const activeAssignments = ps.assignments.filter(a => a.status === 'Active' && !isStaffUnavailable(unavailability, a.lvnId, ds));
        const covCount = coverageHistory.filter(r => r.providerId === p.id && r.date === ds).length;
        const lvnsRequired = p.lvnsRequired ?? 1;
        if (activeAssignments.length + covCount < lvnsRequired)
          issues.push({ dateStr: ds, severity: 'warning', message: `${dayLabel}: ${p.name} (${p.specialty}) — only ${activeAssignments.length + covCount}/${lvnsRequired} LVN${lvnsRequired !== 1 ? 's' : ''}` });
      });
    });

    setValidateResults(issues);
    setShowValidateDialog(true);
  };

  const specialtyMatches = (sp: string) =>
    selectedSpecialties.length === 0 || selectedSpecialties.includes(sp);

  const currentDayState = useMemo(() => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const providers = staff.filter(s => ['MD', 'DO', 'NP', 'PA'].includes(s.role));
    const filtered = providers.filter(p => specialtyMatches(p.specialty));
    return filtered.map(provider => getProviderDayState(provider.id, dateStr));
  }, [date, scheduleState, selectedSpecialties, staff]);

  // ── Daily Conflict Detection ─────────────────────────────────────────────────
  const dailyConflicts = useMemo(() => {
    if (viewMode !== 'day') return [];
    const dateStr = format(date, 'yyyy-MM-dd');
    const allProviders = staff.filter(s => ['MD', 'DO', 'NP', 'PA'].includes(s.role));
    const lvns = staff.filter(s => s.role === 'LVN');
    type ConflictSuggestion = { id: string; name: string; phone: string; email: string; reason: string };
    type Conflict = { type: string; title: string; detail: string; suggestions: ConflictSuggestion[] };
    const conflicts: Conflict[] = [];

    // LVNs assigned to specialty clinics today
    const activeClinicsToday = clinics.filter(c => isClinicOpen(c, overrides, dateStr));
    const clinicLvnIds = new Set<string>();
    activeClinicsToday.forEach(clinic => {
      clinicAssignments.filter(a => a.clinicId === clinic.id && a.date === dateStr).forEach(a => clinicLvnIds.add(a.staffId));
    });

    // LVNs fully occupied today (provider in Patient Care for BOTH shifts).
    // If a provider is AM-only or PM-only, the LVN still has the other shift free for clinics / coverage.
    const busyProviderLvnIds = new Set<string>();
    allProviders.forEach(p => {
      const st = getProviderDayState(p.id, dateStr);
      if (st.am === 'Patient Care' && st.pm === 'Patient Care') {
        st.assignments.filter(a => a.status === 'Active' && !isStaffUnavailable(unavailability, a.lvnId, dateStr))
          .forEach(a => busyProviderLvnIds.add(a.lvnId));
      }
    });

    // CONFLICT 1 — Provider in patient care with no active LVN
    allProviders.forEach(p => {
      const st = getProviderDayState(p.id, dateStr);
      if (st.am !== 'Patient Care' && st.pm !== 'Patient Care') return;
      if (isStaffUnavailable(unavailability, p.id, dateStr)) return;
      const activeAssignments = st.assignments.filter(
        a => a.status === 'Active' && !isStaffUnavailable(unavailability, a.lvnId, dateStr)
      );
      if (activeAssignments.length === 0) {
        const suggestions = lvns
          .filter(l => !isStaffUnavailable(unavailability, l.id, dateStr))
          .filter(l => l.crossTrained?.includes(p.specialty as any) || l.assignedTo?.includes(p.id))
          .slice(0, 3)
          .map(l => ({ id: l.id, name: l.name, phone: l.phone ?? '', email: l.email ?? '', reason: `Cross-trained: ${p.specialty}` }));
        conflicts.push({
          type: 'missing-lvn',
          title: `No LVN — ${p.name} (${p.specialty})`,
          detail: `${p.name} is in patient care with no active LVN assigned.`,
          suggestions,
        });
      }
    });

    // CONFLICT 2 — LVN on provider panel AND specialty clinic with overlapping shifts
    // Non-overlapping is allowed (e.g. LVN covers AM provider, then PM clinic).
    allProviders.forEach(p => {
      if (isStaffUnavailable(unavailability, p.id, dateStr)) return;
      const st = getProviderDayState(p.id, dateStr);
      st.assignments.filter(a => a.status === 'Active').forEach(a => {
        if (!clinicLvnIds.has(a.lvnId)) return;
        const clinicRec = clinicAssignments.find(ca => ca.staffId === a.lvnId && ca.date === dateStr);
        if (!clinicRec) return;
        const cs = clinicRec.shift; // 'AM' | 'PM' | 'Full'
        const amOverlap = st.am === 'Patient Care' && (cs === 'AM' || cs === 'Full');
        const pmOverlap = st.pm === 'Patient Care' && (cs === 'PM' || cs === 'Full');
        if (!amOverlap && !pmOverlap) return; // shifts don't overlap — allowed
        const lvn = staff.find(s => s.id === a.lvnId);
        const overlapShift = amOverlap && pmOverlap ? 'AM & PM' : amOverlap ? 'AM' : 'PM';
        if (!conflicts.some(c => c.type === 'double-assigned' && c.title.includes(lvn?.name ?? ''))) {
          conflicts.push({
            type: 'double-assigned',
            title: `Shift overlap — ${lvn?.name ?? a.lvnId}`,
            detail: `${lvn?.name ?? a.lvnId} is assigned to both ${p.name}'s panel and ${clinicRec.clinicName} during ${overlapShift}. Fix: change the clinic assignment to a non-overlapping shift, or mark the LVN as Sick/Cover for one of the assignments.`,
            suggestions: [],
          });
        }
      });
    });

    // CONFLICT 3 — Specialty clinic open but understaffed
    activeClinicsToday.forEach(clinic => {
      const assigned = clinicAssignments.filter(a => a.clinicId === clinic.id && a.date === dateStr);
      if (assigned.length < clinic.staffNeeded) {
        const freeLvns = lvns
          .filter(l => !isStaffUnavailable(unavailability, l.id, dateStr) && !busyProviderLvnIds.has(l.id))
          .slice(0, 3)
          .map(l => ({ id: l.id, name: l.name, phone: l.phone ?? '', email: l.email ?? '', reason: 'Available — not assigned to a provider today' }));
        conflicts.push({
          type: 'clinic-unstaffed',
          title: `Understaffed — ${clinic.name}`,
          detail: `${clinic.name} needs ${clinic.staffNeeded} staff but only ${assigned.length} assigned (${clinic.startTime}–${clinic.endTime}).`,
          suggestions: freeLvns,
        });
      }
    });

    // CONFLICT 4 — RN charge position unassigned
    RN_POSITIONS.forEach(pos => {
      if (!rnAssignmentsToday.find(a => a.positionId === pos.id)) {
        const availRns = staff
          .filter(s => s.role === 'RN' && !isStaffUnavailable(unavailability, s.id, dateStr))
          .filter(r => allCallAvailability.some(ca => ca.availableDate === dateStr && ca.staffId === r.id))
          .slice(0, 3)
          .map(r => ({ id: r.id, name: r.name, phone: r.phone ?? '', email: r.email ?? '', reason: 'Submitted availability for today' }));
        conflicts.push({
          type: 'rn-unassigned',
          title: `Unassigned — ${pos.label}`,
          detail: `${pos.label} has no RN assigned for ${format(date, 'EEEE, MMM d')}.`,
          suggestions: availRns,
        });
      }
    });

    return conflicts;
  }, [date, viewMode, scheduleState, staff, unavailability, clinics, overrides, clinicAssignments, rnAssignmentsToday, allCallAvailability]);

  // Charge RN email list for conflict notification
  const chargeRnEmailHref = useMemo(() => {
    if (dailyConflicts.length === 0) return '';
    const dateLabel = format(date, 'EEEE, MMMM d, yyyy');
    const assignedRnEmails = rnAssignmentsToday
      .map(a => staff.find(s => s.id === a.rnId)?.email)
      .filter(Boolean) as string[];
    const allRnEmails = staff.filter(s => s.role === 'RN' && s.email).map(s => s.email);
    const emails = assignedRnEmails.length > 0 ? assignedRnEmails : allRnEmails;
    const subject = encodeURIComponent(`Scheduling Conflict Alert — ${dateLabel}`);
    const bodyLines = [
      `Dear Charge RN Team,`,
      ``,
      `The following scheduling conflicts have been identified for ${dateLabel}:`,
      ``,
      ...dailyConflicts.map((c, i) => `${i + 1}. ${c.title}\n   ${c.detail}`),
      ``,
      `Suggested coverage options:`,
      ...dailyConflicts.flatMap(c =>
        c.suggestions.length > 0
          ? c.suggestions.map(s => `  • ${s.name} — ${s.reason}${s.phone ? ' | ' + s.phone : ''}`)
          : []
      ),
      ``,
      `Please reply with any available solutions or additional coverage options at your earliest convenience.`,
      ``,
      `— MediSched Scheduling System`,
    ];
    const body = encodeURIComponent(bodyLines.join('\n'));
    return `mailto:${emails.join(';')}?subject=${subject}&body=${body}`;
  }, [dailyConflicts, rnAssignmentsToday, staff, date]);

  const handleEditClick = (providerId: string, dateStr: string) => {
    const state = getProviderDayState(providerId, dateStr);
    setEditingSlot({ providerId, date: dateStr });
    setEditAm(state.am);
    setEditPm(state.pm);
    setEditAssignments(state.assignments.map(a => ({ ...a })));
  };

  const handleSaveEdit = async () => {
    if (editingSlot) {
      const key = `${editingSlot.providerId}-${editingSlot.date}`;
      const previousState = getProviderDayState(editingSlot.providerId, editingSlot.date);
      const newState: ProviderDayState = {
        ...previousState,
        am: editAm as ProviderDayState['am'],
        pm: editPm as ProviderDayState['pm'],
        assignments: editAssignments,
      };
      // Optimistic update: apply locally for instant UI response
      setScheduleState(prev => ({ ...prev, [key]: newState }));
      // Capture slot reference before closing dialog
      const savedSlot = { ...editingSlot };
      setEditingSlot(null);
      // Persist to database
      try {
        await saveSchedule({
          providerId: savedSlot.providerId,
          date: savedSlot.date,
          am: editAm,
          pm: editPm,
        });
      } catch {
        // Roll back to the previous known good state
        setScheduleState(prev => ({ ...prev, [key]: previousState }));
        toast({
          title: "Save failed",
          description: "Could not save schedule to server. Rolled back to last saved state.",
          variant: "destructive",
          action: (
            <ToastAction
              altText="Retry"
              onClick={() => {
                setEditingSlot(savedSlot);
                setEditAm(newState.am);
                setEditPm(newState.pm);
                setEditAssignments(newState.assignments);
              }}
            >
              Retry
            </ToastAction>
          ),
        });
      }
    }
  };

  const handleInlineScheduleChange = async (providerId: string, dateStr: string, field: 'am' | 'pm', value: string) => {
    const key = `${providerId}-${dateStr}`;
    const previous = getProviderDayState(providerId, dateStr);
    const newAm = field === 'am' ? value as ProviderDayState['am'] : previous.am;
    const newPm = field === 'pm' ? value as ProviderDayState['pm'] : previous.pm;
    setScheduleState(prev => ({ ...prev, [key]: { ...previous, am: newAm, pm: newPm } }));
    try {
      await saveSchedule({ providerId, date: dateStr, am: newAm, pm: newPm });
    } catch {
      // Roll back to previous state on failure
      setScheduleState(prev => ({ ...prev, [key]: previous }));
      toast({
        title: "Save failed",
        description: "Could not save schedule. Rolled back to last saved state.",
        variant: "destructive",
        action: (
          <ToastAction altText="Retry" onClick={() => handleInlineScheduleChange(providerId, dateStr, field, value)}>
            Retry
          </ToastAction>
        ),
      });
    }
  };

  const updateAssignment = (lvnId: string, updates: Partial<AssignmentState>) => {
    setEditAssignments(prev => prev.map(a => a.lvnId === lvnId ? { ...a, ...updates } : a));
  };

  const handleStaffEditClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const member = staff.find(s => s.id === id);
    if (member) { setEditingStaffId(id); setEditStaffName(member.name); setEditStaffSpecialty(member.specialty); }
  };

  const handleStaffSave = () => {
    if (editingStaffId && editStaffName.trim()) {
      const member = staff.find(s => s.id === editingStaffId);
      if (member) updateStaffMember({ ...member, name: editStaffName, specialty: editStaffSpecialty });
      setEditingStaffId(null);
    }
  };

  // ── Provider schedule persistence ────────────────────────────────────────────
  // Fetch 2 years of schedule data from DB so navigation across months never loses data
  const scheduleRangeStart = `${new Date().getFullYear() - 1}-01-01`;
  const scheduleRangeEnd   = `${new Date().getFullYear() + 1}-12-31`;
  const { schedules: dbSchedules, saveSchedule, isLoading: providerSchedulesLoading, isError: providerSchedulesError, refetch: providerSchedulesRefetch } = useProviderSchedules(scheduleRangeStart, scheduleRangeEnd);

  // Merge DB records into local scheduleState whenever the DB data arrives/updates
  useEffect(() => {
    if (dbSchedules.length === 0) return;
    setScheduleState(prev => {
      const merged = { ...prev };
      dbSchedules.forEach(s => {
        const key = `${s.providerId}-${s.date}`;
        merged[key] = {
          ...merged[key],
          providerId: s.providerId,
          date: s.date,
          am: s.am as ProviderDayState['am'],
          pm: s.pm as ProviderDayState['pm'],
          // Preserve existing LVN assignment overrides; fall back to defaults from staffMembers
          assignments: merged[key]?.assignments ?? staff
            .filter(st => st.assignedTo?.includes(s.providerId))
            .map(lvn => ({ lvnId: lvn.id, status: 'Active' as const, clinicAssignment: null })),
        };
      });
      return merged;
    });
  }, [dbSchedules]);

  // Weekly RN assignments — computed at component level so hook rules aren't broken inside IIFE
  const weekStart = useMemo(() => startOfWeek(date, { weekStartsOn: 1 }), [date]);
  const weekEnd = useMemo(() => addDays(weekStart, 4), [weekStart]);
  const weekStartStr = format(weekStart, 'yyyy-MM-dd');
  const weekEndStr = format(weekEnd, 'yyyy-MM-dd');
  const { assignments: weeklyRnAssignments } = useWeeklyRnAssignments(weekStartStr, weekEndStr);

  const monthDays = useMemo(() => eachDayOfInterval({ start: startOfMonth(date), end: endOfMonth(date) }), [date]);

  const getProviderName = (id: string) => staff.find(s => s.id === id)?.name || id;
  const getLvnName = (id: string) => staff.find(s => s.id === id)?.name || id;

  // -- Day Export --
  const handleCopyDayView = async () => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const dateLabel = format(date, 'EEEE, MMMM d, yyyy');

    // ── Helpers ──────────────────────────────────────────────────
    const cell = (content: string, style = '') =>
      `<td style="padding:5px 8px;border:1px solid #cbd5e1;font-size:12px;${style}">${content}</td>`;
    const headerCell = (content: string, colspan = 1, bg = '#1e293b', color = '#fff') =>
      `<td colspan="${colspan}" style="padding:5px 8px;border:1px solid #cbd5e1;font-size:12px;font-weight:bold;background:${bg};color:${color};">${content}</td>`;
    const row = (cells: string, bg = '') =>
      `<tr style="${bg ? `background:${bg};` : ''}">${cells}</tr>`;

    // AM/PM label → display
    const schedLabel = (s: string) => {
      const m: Record<string, string> = { 'Patient Care': 'Patient Care', 'Admin': 'Admin', 'Off': 'Off', 'Meeting': 'Meeting' };
      return m[s] ?? s;
    };

    // Build LVN cell content for a provider row
    const lvnCellContent = (assignments: typeof currentDayState[0]['assignments']) => {
      if (!assignments.length) return '<span style="color:#94a3b8;font-style:italic;">—</span>';
      return assignments.map(a => {
        const lvn = staff.find(s => s.id === a.lvnId);
        const absent = isStaffUnavailable(unavailability, a.lvnId, dateStr);
        const name = lvn?.name ?? a.lvnId;
        const tags: string[] = [];
        if (absent) tags.push(`<span style="color:#dc2626;">[${absent.type}]</span>`);
        if (a.status !== 'Active') tags.push(`<span style="color:#ea580c;">[${a.status}]</span>`);
        if (a.clinicAssignment) tags.push(`<span style="color:#0891b2;">&#8594; ${a.clinicAssignment}</span>`);
        const contactParts: string[] = [];
        if (lvn?.phone) contactParts.push(`<a href="tel:${lvn.phone}" style="color:#2563eb;text-decoration:none;">&#128222; ${lvn.phone}</a>`);
        if (lvn?.email) contactParts.push(`<a href="mailto:${lvn.email}" style="color:#2563eb;text-decoration:none;">&#9993; ${lvn.email}</a>`);
        const contactLine = contactParts.length
          ? `<br/><span style="font-size:10px;color:#64748b;">${contactParts.join(' &nbsp; ')}</span>`
          : '';
        return `<span style="font-weight:500;">${name}</span>${tags.length ? ' ' + tags.join(' ') : ''}${contactLine}`;
      }).join('<br/>');
    };

    // ── Group ALL providers by specialty (ignore active filter for the export) ──
    const allProviders = staff.filter(s => ['MD', 'DO', 'NP', 'PA'].includes(s.role));
    const allDayState = allProviders.map(p => getProviderDayState(p.id, dateStr));
    const groupedBySpecialty: Record<string, typeof allDayState> = {};
    allDayState.forEach(r => {
      const provider = allProviders.find(s => s.id === r.providerId);
      const spec = provider?.specialty ?? 'Other';
      if (!groupedBySpecialty[spec]) groupedBySpecialty[spec] = [];
      groupedBySpecialty[spec].push(r);
    });

    // ── Build provider rows HTML ──────────────────────────────────
    let providerRowsHtml = '';
    Object.entries(groupedBySpecialty).forEach(([specialty, rows]) => {
      const palette = SPECIALTY_PALETTE[specialty] ?? DEFAULT_PALETTE;
      // Specialty group header row (4 columns)
      providerRowsHtml += row(
        headerCell(specialty, 4, palette.headerBg, palette.headerColor)
      );
      rows.forEach(r => {
        const provider = allProviders.find(s => s.id === r.providerId);
        const amColor = r.am === 'Patient Care' ? '#166534' : r.am === 'Off' ? '#64748b' : '#92400e';
        const pmColor = r.pm === 'Patient Care' ? '#166534' : r.pm === 'Off' ? '#64748b' : '#92400e';
        const lvnsRequired = provider?.lvnsRequired ?? 1;
        const lvnsLabel = lvnsRequired > 1 ? ` <span style="font-size:10px;color:#dc2626;">(needs ${lvnsRequired})</span>` : '';
        providerRowsHtml += row([
          cell(`${provider?.name ?? r.providerId}${lvnsLabel}`),
          cell(`<span style="color:${amColor};font-weight:500;">${schedLabel(r.am)}</span>`),
          cell(`<span style="color:${pmColor};font-weight:500;">${schedLabel(r.pm)}</span>`),
          cell(lvnCellContent(r.assignments), 'width:220px;'),
        ].join(''), palette.bg);
      });
    });

    // ── Specialty Clinics section ─────────────────────────────────
    const activeClinics = clinics.filter(c => isClinicOpen(c, overrides, dateStr));

    let clinicRowsHtml = '';
    if (activeClinics.length > 0) {
      // Spacer row
      clinicRowsHtml += row(`<td colspan="4" style="padding:6px;border:none;background:#f8fafc;">&nbsp;</td>`);
      // Clinics section header
      clinicRowsHtml += row(
        headerCell('SPECIALTY CLINICS', 4, CLINIC_PALETTE.headerBg, CLINIC_PALETTE.headerColor)
      );

      // LVNs available for PM / full-day (not absent, not assigned to a provider in PM)
      const pmBusyLvnIds = new Set<string>();
      allDayState.forEach(r => {
        if (r.pm === 'Patient Care') {
          r.assignments.forEach(a => {
            const absent = isStaffUnavailable(unavailability, a.lvnId, dateStr);
            if (!absent && a.status === 'Active') pmBusyLvnIds.add(a.lvnId);
          });
        }
      });
      const pmAvailableLvns = staff.filter(s =>
        s.role === 'LVN' &&
        !s.isFloatPool &&
        !pmBusyLvnIds.has(s.id) &&
        !isStaffUnavailable(unavailability, s.id, dateStr)
      );

      activeClinics.forEach(clinic => {
        const assigned = clinicAssignments.filter(a => a.clinicId === clinic.id && a.date === dateStr);
        const assignedStaff = assigned.map(a => {
          const member = staff.find(s => s.id === a.staffId);
          const contactParts: string[] = [];
          if (member?.phone) contactParts.push(`<a href="tel:${member.phone}" style="color:#2563eb;text-decoration:none;">&#128222; ${member.phone}</a>`);
          if (member?.email) contactParts.push(`<a href="mailto:${member.email}" style="color:#2563eb;text-decoration:none;">&#9993; ${member.email}</a>`);
          const contactLine = contactParts.length
            ? `<br/><span style="font-size:10px;color:#64748b;">${contactParts.join(' &nbsp; ')}</span>`
            : '';
          const name = member ? member.name : a.staffName;
          return `<span style="font-weight:500;">${name}</span>${contactLine}`;
        });

        // Fill remaining slots from PM-available LVNs
        const needed = clinic.staffNeeded - assigned.length;
        const suggestions = needed > 0
          ? pmAvailableLvns
              .filter(l => !assigned.some(a => a.staffId === l.id))
              .slice(0, needed)
              .map(l => {
                const contactParts: string[] = [];
                if (l.phone) contactParts.push(`<a href="tel:${l.phone}" style="color:#2563eb;text-decoration:none;">&#128222; ${l.phone}</a>`);
                if (l.email) contactParts.push(`<a href="mailto:${l.email}" style="color:#2563eb;text-decoration:none;">&#9993; ${l.email}</a>`);
                const contactLine = contactParts.length
                  ? `<br/><span style="font-size:10px;color:#64748b;">${contactParts.join(' &nbsp; ')}</span>`
                  : '';
                return `<span style="color:#0369a1;font-style:italic;">${l.name} (suggested)</span>${contactLine}`;
              })
          : [];

        const staffDisplay = [
          ...assignedStaff,
          ...suggestions,
        ].join('<br/>') || '<span style="color:#dc2626;font-style:italic;">Needs coverage</span>';

        const times = `${clinic.startTime} – ${clinic.endTime}`;
        const filledStatus = `<span style="color:${assigned.length >= clinic.staffNeeded ? '#166534' : '#dc2626'};font-weight:500;">${assigned.length}/${clinic.staffNeeded} filled</span>`;
        clinicRowsHtml += row([
          cell(`<strong>${clinic.name}</strong>`),
          cell(times, 'color:#475569;'),
          cell(filledStatus),
          cell(staffDisplay, 'width:220px;'),
        ].join(''), CLINIC_PALETTE.bg);
      });
    }

    // ── RN Charge Assignments section ────────────────────────────
    let rnRowsHtml = '';
    {
      rnRowsHtml += row(`<td colspan="4" style="padding:6px;border:none;background:#f8fafc;">&nbsp;</td>`);
      rnRowsHtml += row(headerCell('RN CHARGE ASSIGNMENTS', 4, '#1e40af', '#ffffff'));
      RN_POSITIONS.forEach(pos => {
        const assignment = rnAssignmentsToday.find(a => a.positionId === pos.id);
        let rnDisplay = '<span style="color:#94a3b8;font-style:italic;">— Unassigned</span>';
        if (assignment) {
          const rn = staff.find(s => s.id === assignment.rnId);
          const contactParts: string[] = [];
          if (rn?.phone) contactParts.push(`<a href="tel:${rn.phone}" style="color:#2563eb;text-decoration:none;">&#128222; ${rn.phone}</a>`);
          if (rn?.email) contactParts.push(`<a href="mailto:${rn.email}" style="color:#2563eb;text-decoration:none;">&#9993; ${rn.email}</a>`);
          const contactLine = contactParts.length
            ? `<br/><span style="font-size:10px;color:#64748b;">${contactParts.join(' &nbsp; ')}</span>`
            : '';
          rnDisplay = `<span style="font-weight:500;">${assignment.rnName}</span>${contactLine}`;
        }
        const areasHtml = pos.areas.join(', ');
        rnRowsHtml += row([
          cell(`<strong style="color:${pos.headerBg};">${pos.label}</strong><br/><span style="font-size:10px;color:#64748b;">${areasHtml}</span>`),
          cell('&nbsp;'),
          cell('&nbsp;'),
          cell(rnDisplay, 'width:220px;'),
        ].join(''), '#eff6ff');
      });
    }

    // ── Assemble full HTML ────────────────────────────────────────
    const html = `
<html><body>
<p style="font-family:Arial;font-size:13px;font-weight:bold;margin-bottom:4px;">Daily Schedule — ${dateLabel}</p>
<p style="font-family:Arial;font-size:11px;color:#64748b;margin-top:0;margin-bottom:8px;">Generated by MediSched · ${format(new Date(), 'MMM d, yyyy h:mm a')}</p>
<table style="border-collapse:collapse;font-family:Arial;font-size:12px;width:100%;max-width:750px;">
  <thead>
    <tr style="background:#1e293b;color:#fff;">
      <th style="padding:6px 8px;border:1px solid #334155;text-align:left;">Provider</th>
      <th style="padding:6px 8px;border:1px solid #334155;text-align:left;width:90px;">AM</th>
      <th style="padding:6px 8px;border:1px solid #334155;text-align:left;width:90px;">PM</th>
      <th style="padding:6px 8px;border:1px solid #334155;text-align:left;">LVN / Staff</th>
    </tr>
  </thead>
  <tbody>
    ${providerRowsHtml}
    ${clinicRowsHtml}
    ${rnRowsHtml}
  </tbody>
</table>
</body></html>`;

    // Plain-text fallback
    const plainLines: string[] = [`Daily Schedule — ${dateLabel}`, ''];
    Object.entries(groupedBySpecialty).forEach(([spec, rows]) => {
      plainLines.push(`== ${spec} ==`);
      rows.forEach(r => {
        const provider = allProviders.find(s => s.id === r.providerId);
        const lvns = r.assignments.map(a => staff.find(s => s.id === a.lvnId)?.name ?? a.lvnId).join(', ') || '—';
        plainLines.push(`  ${provider?.name ?? r.providerId} | AM: ${r.am} | PM: ${r.pm} | LVN: ${lvns}`);
      });
      plainLines.push('');
    });
    if (activeClinics.length > 0) {
      plainLines.push('== SPECIALTY CLINICS ==');
      activeClinics.forEach(c => {
        const assigned = clinicAssignments.filter(a => a.clinicId === c.id && a.date === dateStr).map(a => a.staffName).join(', ') || 'Needs coverage';
        plainLines.push(`  ${c.name} | ${c.startTime}–${c.endTime} | Staff: ${assigned}`);
      });
    }
    plainLines.push('');
    plainLines.push('== RN CHARGE ASSIGNMENTS ==');
    RN_POSITIONS.forEach(pos => {
      const assignment = rnAssignmentsToday.find(a => a.positionId === pos.id);
      plainLines.push(`  ${pos.label}: ${assignment ? assignment.rnName : '— Unassigned'}`);
    });

    // Primary: execCommand approach — creates CF_HTML clipboard format Outlook understands
    let copied = false;
    try {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none;';
      el.innerHTML = html;
      document.body.appendChild(el);
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection?.removeAllRanges();
      selection?.addRange(range);
      copied = document.execCommand('copy');
      selection?.removeAllRanges();
      document.body.removeChild(el);
    } catch { /* fall through */ }

    // Secondary: modern Clipboard API
    if (!copied) {
      try {
        const htmlBlob = new Blob([html], { type: 'text/html' });
        const textBlob = new Blob([plainLines.join('\n')], { type: 'text/plain' });
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob })]);
      } catch {
        await navigator.clipboard.writeText(plainLines.join('\n'));
      }
    }

    setCopiedDay(true);
    toast({ title: "Copied!", description: "Formatted table copied — paste directly into Outlook or email." });
    setTimeout(() => setCopiedDay(false), 2000);
  };

  // ── Excel Download ─────────────────────────────────────────────
  const handleDownloadExcel = async () => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const dateLabel = format(date, 'EEEE, MMMM d, yyyy');

    const allProviders = staff.filter(s => ['MD', 'DO', 'NP', 'PA'].includes(s.role));
    const allDayState = allProviders.map(p => getProviderDayState(p.id, dateStr));
    const groupedBySpecialty: Record<string, typeof allDayState> = {};
    allDayState.forEach(r => {
      const spec = allProviders.find(s => s.id === r.providerId)?.specialty ?? 'Other';
      if (!groupedBySpecialty[spec]) groupedBySpecialty[spec] = [];
      groupedBySpecialty[spec].push(r);
    });

    // LVNs fully occupied (provider both AM+PM patient care)
    const busyAllDayLvnIds = new Set<string>();
    allDayState.forEach(r => {
      if (r.am === 'Patient Care' && r.pm === 'Patient Care') {
        r.assignments.filter(a => a.status === 'Active' && !isStaffUnavailable(unavailability, a.lvnId, dateStr))
          .forEach(a => busyAllDayLvnIds.add(a.lvnId));
      }
    });
    const availableLvns = staff.filter(s =>
      s.role === 'LVN' &&
      !isStaffUnavailable(unavailability, s.id, dateStr) &&
      !busyAllDayLvnIds.has(s.id)
    );
    const availableNames = availableLvns.map(l => l.name);

    const activeClinics = clinics.filter(c => isClinicOpen(c, overrides, dateStr));

    const rows: string[][] = [];
    const xlsxValidations: Array<{ sqref: string; options: string[] }> = [];

    // Title rows
    rows.push([`Daily Schedule — ${dateLabel}`, '', '', '']);
    rows.push([`Generated by MediSched · ${format(new Date(), 'MMM d, yyyy h:mm a')}`, '', '', '']);
    rows.push(['', '', '', '']);
    // Column headers
    rows.push(['Provider', 'AM', 'PM', 'LVN / Staff']);

    // Provider rows grouped by specialty
    Object.entries(groupedBySpecialty).forEach(([specialty, specRows]) => {
      rows.push([`— ${specialty} —`, '', '', '']);
      specRows.forEach(r => {
        const provider = allProviders.find(s => s.id === r.providerId);
        const amLabel = r.am;
        const pmLabel = r.pm;
        const activeAssignments = r.assignments.filter(a => a.status === 'Active');
        let lvnValue: string;
        if (activeAssignments.length > 0) {
          lvnValue = activeAssignments.map(a => {
            const lvn = staff.find(s => s.id === a.lvnId);
            const absent = isStaffUnavailable(unavailability, a.lvnId, dateStr);
            const name = lvn?.name ?? a.lvnId;
            return absent ? `${name} [${absent.type}]` : name;
          }).join(', ');
        } else if (r.am === 'Patient Care' || r.pm === 'Patient Care') {
          lvnValue = availableNames.length > 0 ? availableNames[0] : '— Unassigned';
          if (availableNames.length > 0) {
            // Excel row is 1-based; rows.length before push = future 0-based index = future 1-based row
            xlsxValidations.push({ sqref: `D${rows.length + 1}`, options: availableNames });
          }
        } else {
          lvnValue = '—';
        }
        rows.push([provider?.name ?? r.providerId, amLabel, pmLabel, lvnValue]);
      });
    });

    rows.push(['', '', '', '']);

    // Specialty Clinics section
    if (activeClinics.length > 0) {
      rows.push(['SPECIALTY CLINICS', '', '', '']);
      rows.push(['Clinic', 'Time', 'Filled', 'Staff Assigned']);
      activeClinics.forEach(clinic => {
        const assigned = clinicAssignments.filter(a => a.clinicId === clinic.id && a.date === dateStr);
        const staffNames = assigned.length > 0 ? assigned.map(a => a.staffName).join(', ') : '— Needs coverage';
        rows.push([clinic.name, `${clinic.startTime} – ${clinic.endTime}`, `${assigned.length}/${clinic.staffNeeded}`, staffNames]);
      });
      rows.push(['', '', '', '']);
    }

    // RN Charge Assignments section
    rows.push(['RN CHARGE ASSIGNMENTS', '', '', '']);
    rows.push(['Position', 'Areas', '', 'Assigned RN']);
    RN_POSITIONS.forEach(pos => {
      const assignment = rnAssignmentsToday.find(a => a.positionId === pos.id);
      rows.push([pos.label, pos.areas.join(', '), '', assignment ? assignment.rnName : '— Unassigned']);
    });

    // Build workbook
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Day Schedule');
    ws.addRows(rows);

    // Column widths
    [30, 14, 14, 36].forEach((width, idx) => {
      ws.getColumn(idx + 1).width = width;
    });

    // Merges: title rows and section headers span all 4 columns
    rows.forEach((r, i) => {
      if (r[1] === '' && r[2] === '' && r[3] === '') {
        ws.mergeCells(i + 1, 1, i + 1, 4);
      }
    });

    // Data validation dropdowns for unassigned LVN cells
    xlsxValidations.forEach(v => {
      ws.getCell(v.sqref).dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: [`"${v.options.slice(0, 30).join(',')}"`],
        showInputMessage: true,
        promptTitle: 'Select LVN',
        prompt: 'Choose an available LVN from the list',
      };
    });

    await downloadWorkbook(workbook, `MediSched_${dateStr}.xlsx`);

    setDownloadedDay(true);
    toast({ title: "Downloaded!", description: `MediSched_${dateStr}.xlsx saved — open in Excel to use LVN dropdowns.` });
    setTimeout(() => setDownloadedDay(false), 3000);
  };

  // -- 2-Week Outlook Gap Detection --
  const twoWeekDays = useMemo(() => {
    const days = [];
    for (let i = 0; i < 14; i++) {
      const d = addDays(new Date(), i);
      if (!isWeekend(d)) days.push(d); // Skip weekends
    }
    return days;
  }, []);

  const providers = useMemo(() => {
    const provs = staff.filter(s => ['MD', 'DO', 'NP', 'PA'].includes(s.role));
    return provs.filter(p => specialtyMatches(p.specialty));
  }, [staff, selectedSpecialties]);

  const THREE_WEEKS = 21;

  const gapData = useMemo(() => {
    const today = new Date();
    return twoWeekDays.map(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const daysUntil = differenceInCalendarDays(day, today);
      const contactMode: 'advance' | 'emergent' = daysUntil >= THREE_WEEKS ? 'advance' : 'emergent';

      // Helpers used throughout gap computation for this date
      const isLvnFullyBusy = (lvnId: string): boolean => {
        const l = staff.find(s => s.id === lvnId);
        if (!l?.assignedTo?.length) return false;
        return l.assignedTo.every(pid => {
          const ps = getProviderDayState(pid, dateStr);
          return ps.am === 'Patient Care' && ps.pm === 'Patient Care';
        });
      };
      const getLvnShiftAvail = (lvnId: string): { am: boolean; pm: boolean; label: string } => {
        const l = staff.find(s => s.id === lvnId);
        if (!l?.assignedTo?.length) return { am: true, pm: true, label: '' };
        const amFree = l.assignedTo.every(pid => getProviderDayState(pid, dateStr).am !== 'Patient Care');
        const pmFree = l.assignedTo.every(pid => getProviderDayState(pid, dateStr).pm !== 'Patient Care');
        if (amFree && pmFree) return { am: true, pm: true, label: 'Provider Off' };
        if (amFree) return { am: true, pm: false, label: 'Provider AM Off' };
        if (pmFree) return { am: false, pm: true, label: 'Provider PM Off' };
        return { am: false, pm: false, label: '' };
      };

      const gaps: Array<{
        provider: StaffMember;
        // Extra providers in a shared-LVN group (e.g. Diabetic Education)
        groupedProviders?: StaffMember[];
        lvnsNeeded: number;
        amGap: boolean;
        pmGap: boolean;
        noLvnAssigned?: boolean;
        absentLvns: Array<{ lvn: StaffMember; reason: string }>;
        regularCoverage: Array<{ lvn: StaffMember; crossCount: number; lvnProviderOff?: boolean; shiftAvailable: { am: boolean; pm: boolean; label: string } }>;
        floatCoverage: Array<{ lvn: StaffMember; crossCount: number; lvnProviderOff?: boolean; shiftAvailable: { am: boolean; pm: boolean; label: string } }>;
        isFloatOnly: boolean;
        daysUntil: number;
        contactMode: 'advance' | 'emergent';
      }> = [];

      const crossCount = (lvn: StaffMember) =>
        coverageHistory.filter(h => h.staffId === lvn.id && h.coveredSpecialty !== h.originalSpecialty).length;

      // Track which providers have already been handled (for shared-LVN groups)
      const handledProviderIds = new Set<string>();

      providers.forEach(provider => {
        if (handledProviderIds.has(provider.id)) return;

        const dayState = getProviderDayState(provider.id, dateStr);
        const amActive = dayState.am === 'Patient Care';
        const pmActive = dayState.pm === 'Patient Care';
        if (!amActive && !pmActive) return;

        // Check if this specialty uses a shared LVN pool
        const sharedRequirement = SHARED_LVN_SPECIALTIES[provider.specialty as keyof typeof SHARED_LVN_SPECIALTIES];

        if (sharedRequirement !== undefined) {
          // --- SHARED LVN SPECIALTY (e.g. Diabetic Education) ---
          const groupProviders = providers.filter(p => p.specialty === provider.specialty);
          groupProviders.forEach(p => handledProviderIds.add(p.id));

          // Check if any provider in the group is on patient care today
          const anyActive = groupProviders.some(p => {
            const ds = getProviderDayState(p.id, dateStr);
            return ds.am === 'Patient Care' || ds.pm === 'Patient Care';
          });
          if (!anyActive) return;

          // Pool all LVNs assigned to any provider in the group
          const pooledLvns = staff.filter(s =>
            (s.role === 'LVN' || s.role === 'RN') &&
            groupProviders.some(p => s.assignedTo?.includes(p.id))
          );
          const uniquePooled = Array.from(new Map(pooledLvns.map(l => [l.id, l])).values());

          const absentLvns: Array<{ lvn: StaffMember; reason: string }> = [];
          uniquePooled.forEach(lvn => {
            const unavail = isStaffUnavailable(unavailability, lvn.id, dateStr);
            // Check any provider's day state for this LVN
            const anyMarkedAbsent = groupProviders.some(p => {
              const ds = getProviderDayState(p.id, dateStr);
              const a = ds.assignments.find(x => x.lvnId === lvn.id);
              return a && a.status !== 'Active';
            });
            if (unavail) absentLvns.push({ lvn, reason: unavail.type });
            else if (anyMarkedAbsent) absentLvns.push({ lvn, reason: 'Absent' });
          });

          const availableInPool = uniquePooled.length - absentLvns.length;
          // Coverage records already assigned for this group on this date count toward filling the gap
          const existingGroupCoverage = coverageHistory.filter(r =>
            groupProviders.some(p => p.id === r.providerId) && r.date === dateStr
          ).length;
          if (availableInPool + existingGroupCoverage < sharedRequirement) {
            const lvnsNeeded = sharedRequirement - availableInPool;
            const gapShift = amActive && pmActive ? 'full' : amActive ? 'am' : 'pm';
            const regularEligible = staff.filter(s =>
              s.role === 'LVN' &&
              !s.isFloatPool &&
              !uniquePooled.some(al => al.id === s.id) &&
              (s.specialty === provider.specialty || s.crossTrained?.includes(provider.specialty as Specialty)) &&
              !isStaffUnavailable(unavailability, s.id, dateStr) &&
              !lvnClinicConflictsWithShift(s.id, dateStr, gapShift) &&
              !isLvnFullyBusy(s.id)
            );
            const floatEligible = staff.filter(s =>
              s.role === 'LVN' &&
              s.isFloatPool &&
              !uniquePooled.some(al => al.id === s.id) &&
              !isStaffUnavailable(unavailability, s.id, dateStr) &&
              !lvnClinicConflictsWithShift(s.id, dateStr, gapShift) &&
              !isLvnFullyBusy(s.id)
            );
            const regularCoverage = regularEligible
              .map(lvn => {
                const shiftAvailable = getLvnShiftAvail(lvn.id);
                const lvnProviderOff = shiftAvailable.am && shiftAvailable.pm;
                return { lvn, crossCount: crossCount(lvn), lvnProviderOff, shiftAvailable };
              })
              .sort((a, b) => {
                if (a.lvnProviderOff && !b.lvnProviderOff) return -1;
                if (!a.lvnProviderOff && b.lvnProviderOff) return 1;
                return a.crossCount - b.crossCount;
              });
            const floatCoverage = floatEligible
              .map(lvn => {
                const shiftAvailable = getLvnShiftAvail(lvn.id);
                const lvnProviderOff = shiftAvailable.am && shiftAvailable.pm;
                return { lvn, crossCount: crossCount(lvn), lvnProviderOff, shiftAvailable };
              })
              .sort((a, b) => {
                if (a.lvnProviderOff && !b.lvnProviderOff) return -1;
                if (!a.lvnProviderOff && b.lvnProviderOff) return 1;
                return a.crossCount - b.crossCount;
              });
            gaps.push({
              provider,
              groupedProviders: groupProviders.filter(p => p.id !== provider.id),
              lvnsNeeded,
              amGap: amActive,
              pmGap: pmActive,
              absentLvns,
              regularCoverage,
              floatCoverage,
              isFloatOnly: regularCoverage.length === 0,
              daysUntil,
              contactMode,
            });
          }
          return;
        }

        // --- INDIVIDUAL PROVIDER ---
        const lvnsRequired = provider.lvnsRequired ?? 1;
        const assignedLvns = staff.filter(s => s.assignedTo?.includes(provider.id) && (s.role === 'LVN' || s.role === 'RN'));
        const absentLvns: Array<{ lvn: StaffMember; reason: string }> = [];

        assignedLvns.forEach(lvn => {
          const unavail = isStaffUnavailable(unavailability, lvn.id, dateStr);
          const assignment = dayState.assignments.find(a => a.lvnId === lvn.id);
          const markedAbsent = assignment && assignment.status !== 'Active';
          if (unavail) absentLvns.push({ lvn, reason: unavail.type });
          else if (markedAbsent) absentLvns.push({ lvn, reason: assignment!.status });
        });

        // Gap exists if available assigned LVNs fall below the required number
        const availableAssigned = assignedLvns.length - absentLvns.length;
        // Coverage records already saved for this provider+date count as filled slots
        const existingCoverageCount = coverageHistory.filter(
          r => r.providerId === provider.id && r.date === dateStr
        ).length;
        if (availableAssigned + existingCoverageCount < lvnsRequired) {
          const lvnsNeeded = lvnsRequired - availableAssigned;

          // Regular (non-float-pool) eligible LVN staff — RNs excluded (RNs only for charge/specialty roles)
          const provGapShift = amActive && pmActive ? 'full' : amActive ? 'am' : 'pm';
          const regularEligible = staff.filter(s =>
            s.role === 'LVN' &&
            !s.isFloatPool &&
            !assignedLvns.some(al => al.id === s.id) &&
            (s.specialty === provider.specialty || s.crossTrained?.includes(provider.specialty as Specialty)) &&
            !isStaffUnavailable(unavailability, s.id, dateStr) &&
            !lvnClinicConflictsWithShift(s.id, dateStr, provGapShift) &&
            !isLvnFullyBusy(s.id)
          );

          // For each eligible LVN, capture shift-specific availability
          const regularCoverage = regularEligible
            .map(lvn => {
              const shiftAvailable = getLvnShiftAvail(lvn.id);
              const lvnProviderOff = shiftAvailable.am && shiftAvailable.pm;
              return { lvn, crossCount: crossCount(lvn), lvnProviderOff, shiftAvailable };
            })
            .sort((a, b) => {
              if (a.lvnProviderOff && !b.lvnProviderOff) return -1;
              if (!a.lvnProviderOff && b.lvnProviderOff) return 1;
              const aPartial = !a.lvnProviderOff && a.shiftAvailable.label !== '';
              const bPartial = !b.lvnProviderOff && b.shiftAvailable.label !== '';
              if (aPartial && !bPartial) return -1;
              if (!aPartial && bPartial) return 1;
              return a.crossCount - b.crossCount;
            });

          // Float pool LVN staff only — exclude clinic-conflicted (shift-aware) + fully busy
          const floatEligible = staff.filter(s =>
            s.role === 'LVN' &&
            s.isFloatPool &&
            !assignedLvns.some(al => al.id === s.id) &&
            !isStaffUnavailable(unavailability, s.id, dateStr) &&
            !lvnClinicConflictsWithShift(s.id, dateStr, provGapShift) &&
            !isLvnFullyBusy(s.id)
          );
          const floatCoverage = floatEligible
            .map(lvn => {
              const shiftAvailable = getLvnShiftAvail(lvn.id);
              const lvnProviderOff = shiftAvailable.am && shiftAvailable.pm;
              return { lvn, crossCount: crossCount(lvn), lvnProviderOff, shiftAvailable };
            })
            .sort((a, b) => {
              if (a.lvnProviderOff && !b.lvnProviderOff) return -1;
              if (!a.lvnProviderOff && b.lvnProviderOff) return 1;
              return a.crossCount - b.crossCount;
            });

          gaps.push({
            provider,
            lvnsNeeded,
            amGap: amActive,
            pmGap: pmActive,
            noLvnAssigned: assignedLvns.length === 0,
            absentLvns,
            regularCoverage,
            floatCoverage,
            isFloatOnly: regularCoverage.length === 0,
            daysUntil,
            contactMode,
          });
        }
      });

      return { date: day, dateStr, gaps };
    });
  }, [twoWeekDays, providers, staff, scheduleState, unavailability, coverageHistory, clinicAssignments]);

  const totalGaps = gapData.reduce((sum, d) => sum + d.gaps.length, 0);

  // ── Staffing email: works on every view mode ─────────────────────────────────
  const staffingEmailHref = useMemo(() => {
    const allRnEmails = staff.filter(s => s.role === 'RN' && s.email).map(s => s.email as string);
    const dayRnEmails = rnAssignmentsToday
      .map(a => staff.find(s => s.id === a.rnId)?.email)
      .filter(Boolean) as string[];
    const toEmails = viewMode === 'day' && dayRnEmails.length > 0 ? dayRnEmails : allRnEmails;

    const allProviders = staff.filter(s => ['MD', 'DO', 'NP', 'PA'].includes(s.role));
    const timestamp = format(new Date(), 'MMM d, yyyy h:mm a');

    let subject = '';
    const bodyLines: string[] = [];

    // Group providers by specialty (reused across views)
    const groupBySpec = (provs: typeof allProviders) => {
      const grouped: Record<string, typeof allProviders> = {};
      provs.forEach(p => { if (!grouped[p.specialty]) grouped[p.specialty] = []; grouped[p.specialty].push(p); });
      return grouped;
    };

    const providerLine = (p: typeof allProviders[0], dateStr: string) => {
      const state = getProviderDayState(p.id, dateStr);
      const provOut = isStaffUnavailable(unavailability, p.id, dateStr);
      if (provOut) return `    ${p.name} | OUT: ${provOut.type}`;
      const lvns = state.assignments.map(a => {
        const lvn = staff.find(s => s.id === a.lvnId);
        const lvnOut = isStaffUnavailable(unavailability, a.lvnId, dateStr);
        const name = lvn?.name ?? a.lvnId;
        if (lvnOut) return `${name} [${lvnOut.type}]`;
        if (a.status !== 'Active') return `${name} [${a.status}]`;
        return name;
      }).join(', ') || '—';
      return `    ${p.name} | AM: ${state.am} | PM: ${state.pm} | LVN: ${lvns}`;
    };

    if (viewMode === 'day') {
      const dateStr = format(date, 'yyyy-MM-dd');
      const dateLabel = format(date, 'EEEE, MMMM d, yyyy');
      subject = `Staffing Update - Daily - ${dateLabel}`;
      bodyLines.push(`Daily Staffing Update - ${dateLabel}`, `Generated by MediSched · ${timestamp}`, '');
      bodyLines.push('PROVIDER SCHEDULE:', '');
      Object.entries(groupBySpec(allProviders)).forEach(([spec, provs]) => {
        bodyLines.push(`  [${spec}]`);
        provs.forEach(p => bodyLines.push(providerLine(p, dateStr)));
        bodyLines.push('');
      });
      const activeClinics = clinics.filter(c => isClinicOpen(c, overrides, dateStr));
      if (activeClinics.length > 0) {
        bodyLines.push('SPECIALTY CLINICS:', '');
        activeClinics.forEach(c => {
          const asgns = clinicAssignments.filter(a => a.clinicId === c.id && a.date === dateStr);
          bodyLines.push(`  ${c.name} (${c.startTime}–${c.endTime}): ${asgns.length}/${c.staffNeeded} — ${asgns.map(a => a.staffName).join(', ') || 'NEEDS COVERAGE'}`);
        });
        bodyLines.push('');
      }
      bodyLines.push('RN CHARGE ASSIGNMENTS:', '');
      RN_POSITIONS.forEach(pos => {
        const asgn = rnAssignmentsToday.find(a => a.positionId === pos.id);
        bodyLines.push(`  ${pos.label}: ${asgn ? asgn.rnName : '— UNASSIGNED'}`);
      });
      bodyLines.push('');
      const outToday = staff.filter(s => !!isStaffUnavailable(unavailability, s.id, dateStr));
      if (outToday.length > 0) {
        bodyLines.push('STAFF OUT TODAY:', '');
        outToday.forEach(s => {
          const rec = isStaffUnavailable(unavailability, s.id, dateStr)!;
          bodyLines.push(`  ${s.name} (${s.role}) — ${rec.type}`);
        });
        bodyLines.push('');
      }

    } else if (viewMode === 'week') {
      const wkStart = startOfWeek(date, { weekStartsOn: 1 });
      const wkDays = Array.from({ length: 5 }, (_, i) => addDays(wkStart, i));
      const periodLabel = `${format(wkDays[0], 'MMM d')}–${format(wkDays[4], 'MMM d, yyyy')}`;
      subject = `Staffing Update - Weekly - ${periodLabel}`;
      bodyLines.push(`Weekly Staffing Update - ${periodLabel}`, `Generated by MediSched · ${timestamp}`, '');
      wkDays.forEach(d => {
        const dateStr = format(d, 'yyyy-MM-dd');
        bodyLines.push(`${format(d, 'EEEE, MMM d')}:`);
        Object.entries(groupBySpec(allProviders)).forEach(([spec, provs]) => {
          bodyLines.push(`  [${spec}]`);
          provs.forEach(p => bodyLines.push(providerLine(p, dateStr)));
        });
        const activeClinics = clinics.filter(c => isClinicOpen(c, overrides, dateStr));
        if (activeClinics.length > 0) {
          bodyLines.push('  Clinics:');
          activeClinics.forEach(c => {
            const asgns = clinicAssignments.filter(a => a.clinicId === c.id && a.date === dateStr);
            bodyLines.push(`    ${c.name}: ${asgns.map(a => a.staffName).join(', ') || 'Needs coverage'}`);
          });
        }
        const dayRnAsgns = weeklyRnAssignments.filter(a => a.date === dateStr);
        if (dayRnAsgns.length > 0) {
          bodyLines.push('  RN Charge:');
          RN_POSITIONS.forEach(pos => {
            const asgn = dayRnAsgns.find(a => a.positionId === pos.id);
            if (asgn) bodyLines.push(`    ${pos.label}: ${asgn.rnName}`);
          });
        }
        bodyLines.push('');
      });

    } else if (viewMode === 'month') {
      const monthLabel = format(date, 'MMMM yyyy');
      subject = `Staffing Update - Monthly - ${monthLabel}`;
      bodyLines.push(`Monthly Staffing Update - ${monthLabel}`, `Generated by MediSched · ${timestamp}`, '');
      const mDays = eachDayOfInterval({ start: startOfMonth(date), end: endOfMonth(date) });
      const workDays = mDays.filter(d => !isWeekend(d));
      bodyLines.push(`Provider Summary (${workDays.length} weekdays in ${monthLabel}):`, '');
      Object.entries(groupBySpec(allProviders)).forEach(([spec, provs]) => {
        bodyLines.push(`[${spec}]`);
        provs.forEach(p => {
          let pcDays = 0, offDays = 0, adminDays = 0;
          workDays.forEach(d => {
            const ds = format(d, 'yyyy-MM-dd');
            const provOut = isStaffUnavailable(unavailability, p.id, ds);
            if (provOut) { offDays++; return; }
            const st = getProviderDayState(p.id, ds);
            if (st.am === 'Patient Care' || st.pm === 'Patient Care') pcDays++;
            else if (st.am === 'Off' && st.pm === 'Off') offDays++;
            else adminDays++;
          });
          bodyLines.push(`  ${p.name}: Patient Care=${pcDays}d, Off=${offDays}d, Admin/Mtg=${adminDays}d`);
        });
        bodyLines.push('');
      });
      const monthAbsences = staff.filter(s => workDays.some(d => !!isStaffUnavailable(unavailability, s.id, format(d, 'yyyy-MM-dd'))));
      if (monthAbsences.length > 0) {
        bodyLines.push('STAFF ABSENCES THIS MONTH:', '');
        monthAbsences.forEach(s => {
          const absDays = workDays.filter(d => !!isStaffUnavailable(unavailability, s.id, format(d, 'yyyy-MM-dd'))).length;
          bodyLines.push(`  ${s.name} (${s.role}): ${absDays} day${absDays !== 1 ? 's' : ''} out`);
        });
        bodyLines.push('');
      }

    } else {
      // 2-Week Outlook
      const twoWeekEndDate = addDays(new Date(), 13);
      const periodLabel = `${format(new Date(), 'MMM d')}–${format(twoWeekEndDate, 'MMM d, yyyy')}`;
      subject = `Staffing Update - 2-Week Outlook - ${periodLabel}`;
      bodyLines.push(`2-Week Staffing Outlook - ${periodLabel}`, `Generated by MediSched · ${timestamp}`, '');
      bodyLines.push(`Coverage Gaps: ${totalGaps} gap${totalGaps !== 1 ? 's' : ''} detected in the next 14 weekdays.`, '');
      gapData.forEach(({ date: day, dateStr, gaps }) => {
        if (gaps.length === 0) {
          bodyLines.push(`${format(day, 'EEEE, MMM d')}: Fully Covered ✓`);
        } else {
          bodyLines.push(`${format(day, 'EEEE, MMM d')}: ${gaps.length} gap${gaps.length !== 1 ? 's' : ''}`);
          gaps.forEach(gap => {
            const absentNames = gap.absentLvns.map(al => `${al.lvn.name} (${al.reason})`).join(', ');
            bodyLines.push(`  - ${gap.provider.name} | LVN out: ${absentNames}`);
            if (gap.regularCoverage.length > 0) {
              bodyLines.push(`    Recommended coverage: ${gap.regularCoverage[0].lvn.name}`);
            } else if (gap.floatCoverage.length > 0) {
              bodyLines.push(`    Float pool option: ${gap.floatCoverage[0].lvn.name}`);
            } else {
              bodyLines.push('    ⚠ No coverage available — manual escalation needed');
            }
          });
        }
        bodyLines.push('');
      });
    }

    bodyLines.push('— MediSched Scheduling System');

    const body = encodeURIComponent(bodyLines.join('\n'));
    return `mailto:${toEmails.join(';')}?subject=${encodeURIComponent(subject)}&body=${body}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, date, staff, unavailability, clinicAssignments, clinics, overrides, rnAssignmentsToday, weeklyRnAssignments, gapData, scheduleState, totalGaps]);

  // Day / Week view: compute fill-in LVN candidates for a specific provider+date+shift.
  // LVN-only (RNs are reserved for charge/specialty roles).
  // Returns candidates sorted by: provider fully off first, then partial shift free, then fewest cross-specialty assignments.
  const getDayCoverageCandidates = (forProviderId: string, dateStr: string, shift: 'am' | 'pm' | 'full') => {
    const provider = staff.find(s => s.id === forProviderId);
    if (!provider) return [];
    const alreadyAssigned = staff.filter(s => s.assignedTo?.includes(forProviderId) && s.role === 'LVN');
    const allProviderIds = staff.filter(s => ['MD', 'DO', 'NP', 'PA'].includes(s.role)).map(s => s.id);

    return staff.filter(s =>
      s.role === 'LVN' &&
      !alreadyAssigned.some(al => al.id === s.id) &&
      (s.specialty === provider.specialty || (s.crossTrained ?? []).includes(provider.specialty as Specialty)) &&
      !isStaffUnavailable(unavailability, s.id, dateStr) &&
      !lvnClinicConflictsWithShift(s.id, dateStr, shift)
    ).map(lvn => {
      const providers = lvn.assignedTo ?? [];
      if (providers.length > 0) {
        // Exclude if provider has BOTH AM and PM patient care (fully occupied)
        const fullyBusy = providers.every(pid => {
          const ps = getProviderDayState(pid, dateStr);
          return ps.am === 'Patient Care' && ps.pm === 'Patient Care';
        });
        if (fullyBusy) return null;
        // For AM or PM: require free for that specific shift
        if (shift !== 'full') {
          const shiftFree = providers.every(pid => {
            const ps = getProviderDayState(pid, dateStr);
            return shift === 'am' ? ps.am !== 'Patient Care' : ps.pm !== 'Patient Care';
          });
          if (!shiftFree) return null;
        }
      }
      const amFree = !providers.length || providers.every(pid => getProviderDayState(pid, dateStr).am !== 'Patient Care');
      const pmFree = !providers.length || providers.every(pid => getProviderDayState(pid, dateStr).pm !== 'Patient Care');
      let label = '';
      if (amFree && pmFree) label = 'Provider Off';
      else if (amFree && shift === 'am') label = 'Provider AM Off';
      else if (pmFree && shift === 'pm') label = 'Provider PM Off';
      const xCount = coverageHistory.filter(h => h.staffId === lvn.id && h.coveredSpecialty !== h.originalSpecialty).length;
      // Total daily load: coverage records today + shifts covered by regular provider assignments.
      // Count by shift (AM=1, PM=1, full=2) so an AM-only provider assignment is worth less than a full-day one.
      const covToday = coverageHistory.filter(h => h.staffId === lvn.id && h.date === dateStr).length;
      const assignedShifts = allProviderIds.reduce((sum, pid) => {
        const st = getProviderDayState(pid, dateStr);
        if (!st.assignments.some(a => a.lvnId === lvn.id && a.status === 'Active')) return sum;
        return sum + (st.am === 'Patient Care' ? 1 : 0) + (st.pm === 'Patient Care' ? 1 : 0);
      }, 0);
      const totalCount = covToday + assignedShifts;
      const monthPrefix = format(startOfMonth(new Date()), 'yyyy-MM');
      const moveCount = coverageHistory.filter(h => h.staffId === lvn.id && h.date.startsWith(monthPrefix)).length;
      const scheduleTooltip = getLvnScheduleTooltip(lvn, dateStr);
      // ── Shift-conflict detection (LVN already on another provider's panel) ──
      const shiftsToCheck: Array<'am' | 'pm'> = shift === 'full' ? ['am', 'pm'] : [shift];
      const shiftConflictResult = shiftsToCheck
        .map(s => checkLvnShiftConflict(lvn.id, dateStr, s, forProviderId))
        .find(Boolean) ?? null;
      const shiftConflicted = !!shiftConflictResult;
      const conflictProviderName = shiftConflictResult?.providerName ?? null;
      return { lvn, crossCount: xCount, label, providerOff: amFree && pmFree, totalCount, scheduleTooltip, moveCount, shiftConflicted, conflictProviderName };
    }).filter((x): x is { lvn: StaffMember; crossCount: number; label: string; providerOff: boolean; totalCount: number; scheduleTooltip: string; moveCount: number; shiftConflicted: boolean; conflictProviderName: string | null } => x !== null)
      .sort((a, b) => {
        // Conflicted LVNs always go to the bottom of the list
        if (a.shiftConflicted !== b.shiftConflicted) return a.shiftConflicted ? 1 : -1;
        if (a.providerOff && !b.providerOff) return -1;
        if (!a.providerOff && b.providerOff) return 1;
        const aPartial = !a.providerOff && a.label !== '';
        const bPartial = !b.providerOff && b.label !== '';
        if (aPartial && !bPartial) return -1;
        if (!aPartial && bPartial) return 1;
        return a.totalCount - b.totalCount;
      });
  };

  const handleAssignDayCoverage = async (
    forProviderId: string,
    dateStr: string,
    shift: 'am' | 'pm',
    coverLvnId: string,
    forceAssign = false
  ) => {
    const key = `day-${forProviderId}-${dateStr}-${shift}`;
    const provider = staff.find(s => s.id === forProviderId);
    const coverLvn = staff.find(s => s.id === coverLvnId);
    if (!provider || !coverLvn) return;

    if (!forceAssign) {
      // Shift-specific conflict: already on another provider's panel at the same shift → show suggestion dialog
      const shiftConflict = checkLvnShiftConflict(coverLvnId, dateStr, shift, forProviderId);
      if (shiftConflict) {
        const suggestions = computeConflictSuggestions(forProviderId, dateStr, shift, coverLvnId);
        setConflictSuggestion({
          blockedLvnName: coverLvn.name,
          conflictMessage: `Already on ${shiftConflict.providerName}'s panel for ${shift.toUpperCase()} on ${format(new Date(dateStr + 'T12:00:00'), 'MMM d')}.`,
          suggestions,
          onForceAnyway: () => { setConflictSuggestion(null); handleAssignDayCoverage(forProviderId, dateStr, shift, coverLvnId, true); },
          onAutoAssign: (lvnId) => { setConflictSuggestion(null); handleAssignDayCoverage(forProviderId, dateStr, shift, lvnId); },
        });
        return;
      }
      // Soft warning: already has a coverage record for a different provider on this date
      const covRecord = coverageHistory.find(h => h.staffId === coverLvnId && h.date === dateStr && h.providerId !== forProviderId);
      if (covRecord) {
        if (blockSaveOnConflict) {
          toast({
            title: `Cannot assign — ${coverLvn.name} already covering`,
            description: `${coverLvn.name} is already covering ${covRecord.providerName} on ${format(new Date(dateStr + 'T12:00:00'), 'MMM d')}. Turn off "Block Save on Conflict" to override.`,
            variant: "destructive",
          });
        } else {
          toast({
            title: `Already covering — ${coverLvn.name}`,
            description: `${coverLvn.name} already has a coverage record for ${covRecord.providerName} on ${format(new Date(dateStr + 'T12:00:00'), 'MMM d')}. Assign anyway?`,
            variant: "destructive",
            action: (
              <ToastAction altText="Assign Anyway" onClick={() => handleAssignDayCoverage(forProviderId, dateStr, shift, coverLvnId, true)}>
                Assign Anyway
              </ToastAction>
            ),
          });
        }
        return;
      }
    }

    setDayViewAssigningKey(key);
    try {
      await addCoverageRecord({
        date: dateStr,
        staffId: coverLvn.id,
        staffName: coverLvn.name,
        originalSpecialty: coverLvn.specialty,
        coveredSpecialty: provider.specialty,
        providerId: provider.id,
        providerName: provider.name,
      });
      toast({
        title: "Coverage Assigned",
        description: `${coverLvn.name} covering ${provider.name} (${shift.toUpperCase()}) on ${dateStr}`,
      });
      setDayViewCoverage(prev => ({ ...prev, [key]: "" }));
    } finally {
      setDayViewAssigningKey(null);
    }
  };

  const handleAssignCoverage = async (
    gap: { provider: StaffMember; regularCoverage: Array<{ lvn: StaffMember; crossCount: number; lvnProviderOff?: boolean; shiftAvailable: { am: boolean; pm: boolean; label: string } }>; floatCoverage: Array<{ lvn: StaffMember; crossCount: number; lvnProviderOff?: boolean; shiftAvailable: { am: boolean; pm: boolean; label: string } }> },
    dateStr: string,
    shift: 'am' | 'pm',
    lvnId: string,
    forceDouble = false
  ) => {
    const key = `${gap.provider.id}-${dateStr}-${shift}`;
    const lvn = [...gap.regularCoverage, ...gap.floatCoverage].find(c => c.lvn.id === lvnId)?.lvn
      ?? staff.find(s => s.id === lvnId);
    if (!lvn) return;

    // Shift-specific conflict: LVN already on another provider's patient-care panel at the same shift → show suggestion dialog
    if (!forceDouble) {
      const shiftConflict = checkLvnShiftConflict(lvnId, dateStr, shift, gap.provider.id);
      if (shiftConflict) {
        const suggestions = computeConflictSuggestions(gap.provider.id, dateStr, shift, lvnId);
        setConflictSuggestion({
          blockedLvnName: lvn.name,
          conflictMessage: `Already on ${shiftConflict.providerName}'s panel for ${shift.toUpperCase()} on ${format(new Date(dateStr + 'T12:00:00'), 'MMM d')}.`,
          suggestions,
          onForceAnyway: () => { setConflictSuggestion(null); handleAssignCoverage(gap, dateStr, shift, lvnId, true); },
          onAutoAssign: (suggestedId) => { setConflictSuggestion(null); handleAssignCoverage(gap, dateStr, shift, suggestedId); },
        });
        return;
      }
      // Coverage-record double-booking guard
      const existingRecord = coverageHistory.find(h => h.staffId === lvnId && h.date === dateStr && h.providerId !== gap.provider.id);
      if (existingRecord) {
        if (blockSaveOnConflict) {
          toast({
            title: `Cannot assign — ${lvn.name} already covering`,
            description: `${lvn.name} is already covering ${existingRecord.providerName} on ${format(new Date(dateStr + 'T12:00:00'), 'MMM d')}. Turn off "Block Save on Conflict" to override.`,
            variant: "destructive",
          });
        } else {
          toast({
            title: `Already covering — ${lvn.name}`,
            description: `${lvn.name} is already covering ${existingRecord.providerName} on ${format(new Date(dateStr + 'T12:00:00'), 'MMM d')}. Assign anyway?`,
            variant: "destructive",
            action: (
              <ToastAction altText="Assign Anyway" onClick={() => handleAssignCoverage(gap, dateStr, shift, lvnId, true)}>
                Assign Anyway
              </ToastAction>
            ),
          });
        }
        return;
      }
    }

    setAssigningKey(key);
    try {
      await addCoverageRecord({
        date: dateStr,
        staffId: lvn.id,
        staffName: lvn.name,
        originalSpecialty: lvn.specialty,
        coveredSpecialty: gap.provider.specialty,
        providerId: gap.provider.id,
        providerName: gap.provider.name,
      });
      toast({
        title: "Coverage Assigned",
        description: `${lvn.name} assigned to cover ${gap.provider.name} (${shift.toUpperCase()}) on ${dateStr}`,
      });
      setSelectedCoverage(prev => ({ ...prev, [key]: "" }));
    } finally {
      setAssigningKey(null);
    }
  };

  const schedulePageLoading = staffLoading || unavailLoading || clinicsLoading || rnLoading || callLoading || providerSchedulesLoading;
  const schedulePageError = staffError || unavailError || clinicsError || rnError || callError || providerSchedulesError;

  if (schedulePageLoading) {
    return (
      <AppLayout>
        <div className="p-8 flex items-center justify-center min-h-[50vh]" data-testid="schedule-loading">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            <p className="text-sm">Loading schedule…</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (schedulePageError) {
    return (
      <AppLayout>
        <div className="p-8 flex items-center justify-center min-h-[50vh]" data-testid="schedule-error">
          <div className="flex flex-col items-center gap-3 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="font-medium">Failed to load schedule data</p>
            <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
            <Button variant="outline" size="sm" onClick={() => { staffRefetch(); unavailRefetch(); clinicsRefetch(); rnRefetch(); callRefetch(); providerSchedulesRefetch(); }}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-8 space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight font-heading text-foreground">Schedule Management</h2>
            <p className="text-muted-foreground mt-1">Manage provider shifts, staff assignments, and plan coverage gaps.</p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)}>
              <TabsList>
                <TabsTrigger value="day">Day</TabsTrigger>
                <TabsTrigger value="week">Week</TabsTrigger>
                <TabsTrigger value="month">Month</TabsTrigger>
                <TabsTrigger value="outlook" className="flex items-center gap-1">
                  {totalGaps > 0 && <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold">{totalGaps}</span>}
                  2-Week Outlook
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {viewMode !== 'outlook' && (
              <div className="flex items-center gap-2 bg-card p-1 rounded-lg border border-border shadow-sm">
                <Button variant="ghost" size="icon" onClick={() => {
                  if (viewMode === 'day') handleDateChange(-1);
                  else if (viewMode === 'week') setDate(prev => addWeeks(prev, -1));
                  else handleDateChange(-30);
                }}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="flex items-center gap-2 px-4 font-medium min-w-[200px] justify-center">
                  <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                  {viewMode === 'day'
                    ? format(date, 'MMM d, yyyy')
                    : viewMode === 'week'
                    ? (() => {
                        const wStart = startOfWeek(date, { weekStartsOn: 1 });
                        const wEnd = endOfWeek(date, { weekStartsOn: 1 });
                        return `${format(wStart, 'MMM d')} – ${format(wEnd, 'MMM d, yyyy')}`;
                      })()
                    : format(date, 'MMMM yyyy')}
                </div>
                <Button variant="ghost" size="icon" onClick={() => {
                  if (viewMode === 'day') handleDateChange(1);
                  else if (viewMode === 'week') setDate(prev => addWeeks(prev, 1));
                  else handleDateChange(30);
                }}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}

            <Button variant="outline" onClick={openFormC} data-testid="button-form-c">
              <ClipboardList className="w-4 h-4 mr-2" />
              Form C
            </Button>
          </div>
        </div>

        {/* ── CONFLICT BANNER ──────────────────────────────────────────── */}
        {viewMode === 'day' && dailyConflicts.length > 0 && dismissedConflictDate !== dateStr0 && (
          <div
            className="rounded-lg border border-red-300 bg-red-50 shadow-sm overflow-hidden"
            data-testid="conflict-banner"
            role="alert"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-red-600 text-white">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="font-semibold text-sm">
                  {dailyConflicts.length} Scheduling Conflict{dailyConflicts.length !== 1 ? 's' : ''} Detected — {format(date, 'EEEE, MMMM d')}
                </span>
              </div>
              <button
                onClick={() => setDismissedConflictDate(dateStr0)}
                className="text-red-200 hover:text-white transition-colors"
                aria-label="Dismiss conflict banner"
                data-testid="button-dismiss-conflicts"
              >✕</button>
            </div>

            {/* Conflict list */}
            <div className="divide-y divide-red-100">
              {dailyConflicts.map((conflict, idx) => {
                const typeBadge: Record<string, string> = {
                  'missing-lvn':     'bg-red-100 text-red-800 border-red-200',
                  'double-assigned': 'bg-orange-100 text-orange-800 border-orange-200',
                  'clinic-unstaffed': 'bg-amber-100 text-amber-800 border-amber-200',
                  'rn-unassigned':   'bg-blue-100 text-blue-800 border-blue-200',
                };
                const typeLabel: Record<string, string> = {
                  'missing-lvn':     'Missing LVN',
                  'double-assigned': 'Double Assigned',
                  'clinic-unstaffed': 'Clinic Understaffed',
                  'rn-unassigned':   'RN Position Open',
                };
                return (
                  <div key={idx} className="px-4 py-3 space-y-2" data-testid={`conflict-item-${idx}`}>
                    <div className="flex items-start gap-2 flex-wrap">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${typeBadge[conflict.type] ?? 'bg-gray-100 text-gray-800 border-gray-200'}`}>
                        {typeLabel[conflict.type] ?? conflict.type}
                      </span>
                      <span className="text-sm font-semibold text-red-900">{conflict.title}</span>
                    </div>
                    <p className="text-xs text-red-700 leading-relaxed">{conflict.detail}</p>
                    {conflict.suggestions.length > 0 && (
                      <div className="mt-1 space-y-1">
                        <p className="text-[10px] font-semibold text-red-600 uppercase tracking-wide">Suggested Coverage:</p>
                        {conflict.suggestions.map(s => (
                          <div key={s.id} className="flex items-center gap-2 flex-wrap text-xs text-gray-700 bg-white/70 rounded px-2 py-1 border border-red-100">
                            <span className="font-medium">{s.name}</span>
                            <span className="text-gray-400">·</span>
                            <span className="text-gray-500 italic">{s.reason}</span>
                            {s.phone && (
                              <a href={`tel:${s.phone}`} className="text-blue-600 hover:underline flex items-center gap-0.5">
                                <Phone className="w-3 h-3" />{s.phone}
                              </a>
                            )}
                            {s.email && (
                              <a href={`mailto:${s.email}`} className="text-blue-600 hover:underline">{s.email}</a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footer — email action */}
            <div className="px-4 py-2.5 bg-red-50 border-t border-red-200 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-red-600">
                Request input from charge RNs on how to resolve these coverage gaps.
              </p>
              <a
                href={chargeRnEmailHref}
                data-testid="button-email-charge-rns"
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors whitespace-nowrap"
              >
                <AlertCircle className="w-3.5 h-3.5" />
                Email Charge RNs for Input
              </a>
            </div>
          </div>
        )}

        {/* Specialty filter pills */}
        {(() => {
          const MED_HOME_1 = 'Internal/Family Med (Met Home 1)';
          const MED_HOME_2 = 'Internal/Family Med (Met Home 2)';
          const FLOOR3 = ['OB/GYN', 'Pediatrics', 'Allergy', 'Optometry', 'Diabetic Education'] as const;

          const isSelected = (sp: string) => selectedSpecialties.includes(sp);
          const toggle = (sp: string) => setSelectedSpecialties(prev =>
            prev.includes(sp) ? prev.filter(s => s !== sp) : [...prev, sp]
          );
          const bothSelected = isSelected(MED_HOME_1) && isSelected(MED_HOME_2);
          const toggleBoth = () => {
            if (bothSelected) {
              setSelectedSpecialties(prev => prev.filter(s => s !== MED_HOME_1 && s !== MED_HOME_2));
            } else {
              setSelectedSpecialties(prev => Array.from(new Set([...prev, MED_HOME_1, MED_HOME_2])));
            }
          };
          const pillBase = "px-2.5 py-1 rounded-full text-xs font-medium border cursor-pointer transition-colors select-none";
          const pillOn  = "bg-primary text-primary-foreground border-primary";
          const pillOff = "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground";

          return (
            <div className="flex flex-wrap items-center gap-1.5 py-1" data-testid="specialty-filter">
              <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span
                data-testid="filter-all"
                className={`${pillBase} ${selectedSpecialties.length === 0 ? pillOn : pillOff}`}
                onClick={() => setSelectedSpecialties([])}
              >All</span>

              <span className="text-[10px] text-muted-foreground ml-1 font-semibold uppercase tracking-wide">2nd Floor</span>
              <span data-testid="filter-med-home-both" className={`${pillBase} ${bothSelected ? pillOn : pillOff}`} onClick={toggleBoth}>Both Med Home</span>
              <span data-testid="filter-med-home-1" className={`${pillBase} ${isSelected(MED_HOME_1) ? pillOn : pillOff}`} onClick={() => toggle(MED_HOME_1)}>Met Home 1</span>
              <span data-testid="filter-med-home-2" className={`${pillBase} ${isSelected(MED_HOME_2) ? pillOn : pillOff}`} onClick={() => toggle(MED_HOME_2)}>Met Home 2</span>

              <span className="text-[10px] text-muted-foreground ml-1 font-semibold uppercase tracking-wide">3rd Floor</span>
              {FLOOR3.map(sp => (
                <span key={sp} data-testid={`filter-${sp.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
                  className={`${pillBase} ${isSelected(sp) ? pillOn : pillOff}`}
                  onClick={() => toggle(sp)}
                >{sp}</span>
              ))}
            </div>
          );
        })()}

        {/* DAY VIEW */}
        {viewMode === 'day' && (
          <div className="border border-border rounded-lg overflow-hidden bg-card shadow-sm">
            <div className="grid grid-cols-[250px_250px_1fr_1fr] bg-muted/50 divide-x divide-border border-b border-border">
              <div className="p-4 font-medium text-sm text-muted-foreground">Provider</div>
              <div className="p-4 font-medium text-sm text-muted-foreground">Assigned Staff</div>
              <div className="p-4 font-medium text-sm text-muted-foreground text-center">AM (08:00–12:00)</div>
              <div className="p-4 font-medium text-sm text-muted-foreground text-center">PM (13:00–17:00)</div>
            </div>

            <div className="divide-y divide-border">
              {currentDayState.map(row => {
                const dateStr = format(date, 'yyyy-MM-dd');
                return (
                  <div key={row.providerId} className="grid grid-cols-[250px_250px_1fr_1fr] divide-x divide-border hover:bg-accent/5 transition-colors group">
                    {/* Provider Column */}
                    <div className="p-4 flex flex-col justify-center relative group/provider">
                      <div className="flex items-center justify-between">
                        <div className="font-medium text-foreground">{getProviderName(row.providerId)}</div>
                        <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover/provider:opacity-100 transition-opacity"
                          onClick={e => handleStaffEditClick(e, row.providerId)}>
                          <Edit2 className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {staff.find(s => s.id === row.providerId)?.specialty}
                      </div>
                    </div>

                    {/* Staff Assignment */}
                    <div className="p-4 flex flex-col justify-center gap-2">
                      {row.assignments.length > 0 ? (
                        row.assignments.map(assignment => {
                          const unavailRecord = isStaffUnavailable(unavailability, assignment.lvnId, dateStr);
                          const isOut = assignment.status !== 'Active' || !!unavailRecord;
                          // Determine which shifts have a gap (provider has Patient Care but LVN is out)
                          const gapShifts: Array<'am' | 'pm'> = isOut ? [
                            ...(row.am === 'Patient Care' ? ['am' as const] : []),
                            ...(row.pm === 'Patient Care' ? ['pm' as const] : []),
                          ] : [];
                          return (
                            <div key={assignment.lvnId} className="flex flex-col gap-1 group/lvn">
                              <div className={`flex items-center gap-2 p-2 rounded-md border shadow-xs transition-all ${
                                isOut ? 'border-red-200 bg-red-50 opacity-80' :
                                assignment.clinicAssignment ? 'border-orange-200 bg-orange-50' : 'border-border bg-background'}`}>
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                                  isOut ? 'bg-red-100 text-red-700' :
                                  assignment.clinicAssignment ? 'bg-orange-100 text-orange-700' : 'bg-indigo-100 text-indigo-700'}`}>
                                  L
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex justify-between items-center">
                                    <div className={`text-sm font-medium truncate ${isOut ? 'line-through text-muted-foreground' : ''}`}>
                                      {getLvnName(assignment.lvnId)}
                                    </div>
                                    <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover/lvn:opacity-100 transition-opacity"
                                      onClick={e => handleStaffEditClick(e, assignment.lvnId)}>
                                      <Edit2 className="h-3 w-3" />
                                    </Button>
                                  </div>
                                  {unavailRecord && (
                                    <div className="text-[10px] text-red-600 flex items-center gap-1">
                                      <CalendarOff className="w-3 h-3" />{unavailRecord.type}
                                    </div>
                                  )}
                                  {assignment.status !== 'Active' && !unavailRecord && (
                                    <div className="text-[10px] text-red-600">{assignment.status}</div>
                                  )}
                                  {assignment.clinicAssignment && !isOut && (
                                    <div className="text-[10px] text-orange-600">{assignment.clinicAssignment}</div>
                                  )}
                                  {/* Shift coverage badges — only shown when not absent and provider is partial-day */}
                                  {!isOut && (row.am === 'Patient Care' || row.pm === 'Patient Care') && (
                                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                      {row.am === 'Patient Care' && (
                                        <span className="text-[9px] font-semibold px-1.5 py-0 rounded bg-sky-100 text-sky-700 leading-4">AM</span>
                                      )}
                                      {row.pm === 'Patient Care' && (
                                        <span className="text-[9px] font-semibold px-1.5 py-0 rounded bg-indigo-100 text-indigo-700 leading-4">PM</span>
                                      )}
                                      {row.am !== 'Patient Care' && (
                                        <span className="text-[9px] text-muted-foreground leading-4">AM free</span>
                                      )}
                                      {row.pm !== 'Patient Care' && (
                                        <span className="text-[9px] text-muted-foreground leading-4">PM free</span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Inline fill-in panel — shown when LVN is absent and provider has patient care */}
                              {gapShifts.length > 0 && (
                                <div className="ml-1 pl-2 border-l-2 border-amber-300 space-y-2 pt-1 pb-0.5">
                                  <div className="text-[10px] font-semibold text-amber-700 flex items-center gap-1">
                                    <UserPlus className="w-3 h-3" /> Equitable fill-in:
                                  </div>
                                  {gapShifts.map(shift => {
                                    const candidates = getDayCoverageCandidates(row.providerId, dateStr, shift);
                                    const key = `day-${row.providerId}-${dateStr}-${shift}`;
                                    const selectedVal = dayViewCoverage[key] ?? "";
                                    const isAssigning = dayViewAssigningKey === key;
                                    return (
                                      <div key={shift} className="space-y-1">
                                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                                          shift === 'am' ? 'bg-sky-100 text-sky-700' : 'bg-indigo-100 text-indigo-700'}`}>
                                          {shift.toUpperCase()}
                                        </span>
                                        <div className="flex gap-1 mt-0.5">
                                          <select
                                            data-testid={`select-day-coverage-${row.providerId}-${dateStr}-${shift}`}
                                            value={selectedVal}
                                            onChange={e => setDayViewCoverage(prev => ({ ...prev, [key]: e.target.value }))}
                                            className="flex-1 text-xs border border-input rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                                          >
                                            {candidates.length === 0 ? (
                                              <option disabled value="">No available LVNs — check rotations?</option>
                                            ) : (
                                              <>
                                                <option value="">— Select fill-in LVN —</option>
                                                {candidates.map(({ lvn, totalCount, label, scheduleTooltip, shiftConflicted, conflictProviderName }, idx) => (
                                                  <option
                                                    key={lvn.id}
                                                    value={lvn.id}
                                                    title={shiftConflicted ? `⚠ Already assigned to ${conflictProviderName} this shift` : scheduleTooltip}
                                                    disabled={shiftConflicted}
                                                  >
                                                    {shiftConflicted
                                                      ? `⚠ ${lvn.name} — Booked (${conflictProviderName})`
                                                      : `${idx === 0 ? '★ ' : ''}${lvn.name}${label ? ` · ${label}` : ''} — Current assignments: ${totalCount}`
                                                    }
                                                  </option>
                                                ))}
                                              </>
                                            )}
                                          </select>
                                          {candidates.length > 0 && (
                                            <Button
                                              size="sm"
                                              className="h-7 text-xs px-2 shrink-0"
                                              disabled={!selectedVal || isAssigning}
                                              data-testid={`button-day-assign-${row.providerId}-${dateStr}-${shift}`}
                                              onClick={() => handleAssignDayCoverage(row.providerId, dateStr, shift, selectedVal)}
                                            >
                                              {isAssigning ? "…" : "Assign"}
                                            </Button>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        /* No LVN assigned at all — show fill-in dropdown if provider needs patient care */
                        (() => {
                          const needsAm = row.am === 'Patient Care';
                          const needsPm = row.pm === 'Patient Care';
                          if (!needsAm && !needsPm) {
                            return <div className="text-sm text-muted-foreground italic px-2">No assignment</div>;
                          }
                          const noAssignShifts: Array<'am' | 'pm'> = [
                            ...(needsAm ? ['am' as const] : []),
                            ...(needsPm ? ['pm' as const] : []),
                          ];
                          return (
                            <div className="ml-1 pl-2 border-l-2 border-red-300 space-y-2 pt-1 pb-0.5">
                              <div className="text-[10px] font-semibold text-red-700 flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" /> No LVN assigned — fill in:
                              </div>
                              {noAssignShifts.map(shift => {
                                const candidates = getDayCoverageCandidates(row.providerId, dateStr, shift);
                                const key = `day-${row.providerId}-${dateStr}-${shift}`;
                                const selectedVal = dayViewCoverage[key] ?? "";
                                const isAssigning = dayViewAssigningKey === key;
                                return (
                                  <div key={shift} className="space-y-1">
                                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                                      shift === 'am' ? 'bg-sky-100 text-sky-700' : 'bg-indigo-100 text-indigo-700'}`}>
                                      {shift.toUpperCase()}
                                    </span>
                                    <div className="flex gap-1 mt-0.5">
                                      <select
                                        data-testid={`select-day-noassign-${row.providerId}-${dateStr}-${shift}`}
                                        value={selectedVal}
                                        onChange={e => setDayViewCoverage(prev => ({ ...prev, [key]: e.target.value }))}
                                        className="flex-1 text-xs border border-input rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                                      >
                                        {candidates.length === 0 ? (
                                          <option disabled value="">No available LVNs — check rotations?</option>
                                        ) : (
                                          <>
                                            <option value="">— Select fill-in LVN —</option>
                                            {candidates.map(({ lvn, totalCount, label, scheduleTooltip, shiftConflicted, conflictProviderName }, idx) => (
                                              <option
                                                key={lvn.id}
                                                value={lvn.id}
                                                title={shiftConflicted ? `⚠ Already assigned to ${conflictProviderName} this shift` : scheduleTooltip}
                                                disabled={shiftConflicted}
                                              >
                                                {shiftConflicted
                                                  ? `⚠ ${lvn.name} — Booked (${conflictProviderName})`
                                                  : `${idx === 0 ? '★ ' : ''}${lvn.name}${label ? ` · ${label}` : ''} — Current assignments: ${totalCount}`
                                                }
                                              </option>
                                            ))}
                                          </>
                                        )}
                                      </select>
                                      {candidates.length > 0 && (
                                        <Button
                                          size="sm"
                                          className="h-7 text-xs px-2 shrink-0"
                                          disabled={!selectedVal || isAssigning}
                                          data-testid={`button-day-noassign-${row.providerId}-${dateStr}-${shift}`}
                                          onClick={() => handleAssignDayCoverage(row.providerId, dateStr, shift, selectedVal)}
                                        >
                                          {isAssigning ? "…" : "Assign"}
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()
                      )}
                    </div>

                    {/* AM Shift */}
                    <div className="p-2">
                      <select
                        data-testid={`select-am-${row.providerId}-${row.date}`}
                        value={row.am}
                        onChange={e => handleInlineScheduleChange(row.providerId, row.date, 'am', e.target.value)}
                        className={`w-full rounded-md border px-2 py-1.5 text-sm font-medium cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring ${
                          row.am === 'Patient Care' ? 'bg-primary/10 border-primary/20 text-primary' :
                          row.am === 'Off' ? 'bg-slate-100 border-slate-200 text-slate-500' :
                          row.am === 'Admin' ? 'bg-amber-50 border-amber-200 text-amber-700' :
                          'bg-purple-50 border-purple-200 text-purple-700'}`}
                      >
                        {(['Patient Care', 'Admin', 'Off', 'Meeting'] as const).map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </div>

                    {/* PM Shift */}
                    <div className="p-2">
                      <select
                        data-testid={`select-pm-${row.providerId}-${row.date}`}
                        value={row.pm}
                        onChange={e => handleInlineScheduleChange(row.providerId, row.date, 'pm', e.target.value)}
                        className={`w-full rounded-md border px-2 py-1.5 text-sm font-medium cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring ${
                          row.pm === 'Patient Care' ? 'bg-primary/10 border-primary/20 text-primary' :
                          row.pm === 'Off' ? 'bg-slate-100 border-slate-200 text-slate-500' :
                          row.pm === 'Admin' ? 'bg-amber-50 border-amber-200 text-amber-700' :
                          'bg-purple-50 border-purple-200 text-purple-700'}`}
                      >
                        {(['Patient Care', 'Admin', 'Off', 'Meeting'] as const).map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* SPECIAL CLINICS — Day View */}
        {viewMode === 'day' && (() => {
          const dateStr = format(date, 'yyyy-MM-dd');
          const activeClinicsToday = clinics.filter(c => isClinicOpen(c, overrides, dateStr));
          if (activeClinicsToday.length === 0) return null;
          return (
            <div className="space-y-2 mt-1">
              <div className="flex items-center gap-2 px-1">
                <div className="w-1 h-4 rounded-full bg-purple-600" />
                <h3 className="font-semibold text-sm text-foreground">Special Clinics</h3>
                <span className="text-xs text-muted-foreground">{format(date, 'EEEE, MMMM d')}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {activeClinicsToday.map(clinic => {
                  const assigned = clinicAssignments.filter(a => a.clinicId === clinic.id && a.date === dateStr);
                  const needed = clinic.staffNeeded;
                  const isFull = assigned.length >= needed;
                  return (
                    <div key={clinic.id} className={`border rounded-lg p-3 space-y-2 ${isFull ? 'border-green-200 bg-green-50/30' : 'border-amber-200 bg-amber-50/30'}`}
                      data-testid={`card-clinic-day-${clinic.id}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${isFull ? 'bg-green-500' : 'bg-amber-400'}`} />
                          <span className="font-medium text-sm">{clinic.name}</span>
                        </div>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${isFull ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                          {assigned.length}/{needed} staffed
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">{clinic.startTime}–{clinic.endTime}</div>
                      {assigned.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {assigned.map(a => (
                            <span key={a.id} className="text-xs bg-white border border-border rounded px-2 py-0.5 font-medium">
                              {a.staffName} <span className="text-muted-foreground font-normal">({a.shift})</span>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-amber-700 font-medium">⚠ No staff assigned — assign from Clinics page</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* RN CHARGE ASSIGNMENTS — Day View */}
        {viewMode === 'day' && (
          <div className="space-y-3 mt-1">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <div className="w-1 h-4 rounded-full bg-blue-600" />
                <h3 className="font-semibold text-sm text-foreground">RN Charge Assignments</h3>
                <span className="text-xs text-muted-foreground">{format(date, 'EEEE, MMMM d')}</span>
                {!isAdmin && (
                  <span className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5 font-medium">
                    <Lock className="w-3 h-3" /> Admin only
                  </span>
                )}
              </div>
              {rnAvailableToday.length > 0 && (
                <span className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-0.5 font-medium">
                  {rnAvailableToday.length} RN{rnAvailableToday.length !== 1 ? 's' : ''} available today
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {RN_POSITIONS.map(pos => {
                const assignment = rnAssignmentsToday.find(a => a.positionId === pos.id);
                const groupPartner = RN_POSITIONS.find(p => p.id !== pos.id && p.mergeGroup === pos.mergeGroup);
                const partnerAssignment = groupPartner ? rnAssignmentsToday.find(a => a.positionId === groupPartner.id) : undefined;
                const coversBoth = !!assignment && !!partnerAssignment && assignment.rnId === partnerAssignment.rnId;
                const assignedRnAbsent = assignment ? !!isStaffUnavailable(unavailability, assignment.rnId, dateStr0) : false;

                // RNs with availability for this date — these are the primary checkboxes
                const availableHere = rnAvailableToday.filter(
                  ({ rn }) => !isStaffUnavailable(unavailability, rn.id, dateStr0)
                );

                // If assigned RN did NOT submit availability, show them separately at the top
                const assignedWithNoAvail = assignment && !rnAvailableToday.find(x => x.rn.id === assignment.rnId)
                  ? rns.find(r => r.id === assignment.rnId)
                  : null;

                const handleCheck = async (rnId: string, rnName: string, checked: boolean) => {
                  try {
                    if (checked) {
                      await upsertRnAssignment({ date: dateStr0, positionId: pos.id, rnId, rnName, note: "" });
                    } else {
                      if (assignment && assignment.rnId === rnId) await deleteRnAssignment(assignment.id);
                    }
                  } catch {
                    toast({ title: "Failed to save RN assignment", variant: "destructive" });
                  }
                };

                // ── Permanent RN status for this position ──────────────────
                const permRn = permanentRns[pos.id];
                const permRnAbsent = permRn ? !!isStaffUnavailable(unavailability, permRn.id, dateStr0) : false;
                const nextQualResult = permRnAbsent ? getNextQualifiedRn(pos.id, dateStr0) : null;

                return (
                  <div key={pos.id} className="rounded-lg border border-border overflow-hidden shadow-sm"
                    data-testid={`card-rn-position-${pos.id}`}>
                    {/* Coloured header */}
                    <div className="px-3 py-2 text-white text-xs font-semibold leading-tight"
                      style={{ background: pos.headerBg }}>
                      {pos.label}
                    </div>

                    <div className="p-3 space-y-2.5" style={{ background: pos.bg + '44' }}>
                      {/* Coverage areas */}
                      <div className="flex flex-wrap gap-1">
                        {pos.areas.map(area => (
                          <span key={area} className="text-xs bg-white/80 rounded px-1.5 py-0.5 border border-white/60 text-gray-700">{area}</span>
                        ))}
                        {'supervisedAreas' in pos && Array.isArray((pos as any).supervisedAreas) && (pos as any).supervisedAreas.map((area: string) => (
                          <span key={area} className="text-xs bg-white/40 rounded px-1.5 py-0.5 border border-white/30 text-gray-500 italic">↗ {area}</span>
                        ))}
                      </div>

                      {/* ── Permanent RN block ─────────────────────────────── */}
                      {permRn ? (
                        <div className={`rounded-md border p-2 ${permRnAbsent ? 'bg-amber-50 border-amber-300' : 'bg-emerald-50 border-emerald-200'}`}
                          data-testid={`permanent-rn-block-${pos.id}`}>
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full shrink-0 ${permRnAbsent ? 'bg-amber-400' : 'bg-emerald-500'}`} />
                            <div className="flex-1 min-w-0">
                              <span className={`text-sm font-semibold ${permRnAbsent ? 'line-through text-amber-700 opacity-70' : 'text-emerald-800'}`}>
                                {permRn.name}
                              </span>
                              <span className="text-xs ml-1.5 text-muted-foreground">
                                {permRnAbsent ? '(Absent today)' : '· Permanent assignment'}
                              </span>
                            </div>
                            {!permRnAbsent && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200 font-medium shrink-0">Home Unit</span>
                            )}
                          </div>

                          {permRnAbsent && (
                            <div className="mt-2 space-y-1.5">
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800"
                                data-testid={`badge-perm-rn-absent-${pos.id}`}>
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                Permanent RN Absent — Next Qualified Assigned
                              </div>

                              {nextQualResult?.rn ? (
                                <div className={`flex items-center gap-2 p-2 rounded border ${
                                  nextQualResult.type === 'cross-cover'
                                    ? 'bg-blue-50 border-blue-200'
                                    : 'bg-orange-50 border-orange-200'
                                }`}>
                                  <div className="flex-1 min-w-0">
                                    <span className={`text-xs font-semibold ${
                                      nextQualResult.type === 'cross-cover' ? 'text-blue-800' : 'text-orange-800'
                                    }`}>
                                      Next Qualified: {nextQualResult.rn.name}
                                    </span>
                                    <span className={`text-[10px] ml-1.5 ${
                                      nextQualResult.type === 'cross-cover' ? 'text-blue-600' : 'text-orange-600'
                                    }`}>
                                      {nextQualResult.type === 'cross-cover' ? '(Cross-unit coverage)' : '(Extra Help)'}
                                    </span>
                                  </div>
                                  <button
                                    className={`text-[10px] px-2 py-1 rounded border font-semibold shrink-0 transition-colors ${
                                      !isAdmin || assignment?.rnId === nextQualResult.rn.id
                                        ? 'bg-gray-100 text-gray-500 border-gray-200 cursor-not-allowed'
                                        : nextQualResult.type === 'cross-cover'
                                          ? 'bg-blue-600 text-white border-blue-700 hover:bg-blue-700'
                                          : 'bg-orange-500 text-white border-orange-600 hover:bg-orange-600'
                                    }`}
                                    data-testid={`button-assign-next-qualified-${pos.id}`}
                                    disabled={!isAdmin || assignment?.rnId === nextQualResult.rn.id}
                                    onClick={() => isAdmin && nextQualResult.rn && upsertRnAssignment({
                                      date: dateStr0,
                                      positionId: pos.id,
                                      rnId: nextQualResult.rn.id,
                                      rnName: nextQualResult.rn.name,
                                      note: nextQualResult.type === 'cross-cover' ? 'Cross-unit coverage' : 'Extra Help',
                                    })}
                                  >
                                    {assignment?.rnId === nextQualResult.rn.id ? '✓ Assigned' : 'Use →'}
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2"
                                  data-testid={`badge-perm-rn-last-resort-${pos.id}`}>
                                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                  <span>No qualified relief — contact ANM or flag as <strong>Double Cover</strong></span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-[10px] text-muted-foreground italic px-1">
                          Permanent RN: {permanentRns[pos.id]?.name ?? 'Not configured'} (not found in staff)
                        </div>
                      )}

                      {/* Manually-assigned RN that has no availability record */}
                      {assignedWithNoAvail && (
                        <div className="flex items-center gap-2 p-2 rounded-md bg-blue-50 border border-blue-200">
                          <input type="checkbox" checked readOnly className="h-4 w-4 accent-blue-600 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-blue-800">{assignedWithNoAvail.name}</div>
                            <div className="text-xs text-blue-600">✓ Confirmed — {format(date, 'MMM d')}</div>
                          </div>
                          {isAdmin && (
                            <button
                              className="text-blue-400 hover:text-blue-700 text-xs shrink-0"
                              onClick={() => assignment && deleteRnAssignment(assignment.id)}
                            >✕</button>
                          )}
                        </div>
                      )}

                      {/* Available RN checkboxes */}
                      {availableHere.length > 0 ? (
                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Available today</p>
                          {availableHere.map(({ rn, avail }) => {
                            const isChecked = assignment?.rnId === rn.id;
                            const empType = rn.employmentType as string;
                            const empBadgeColor = empType === 'Part-time' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                              empType === 'Per Diem' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                              empType === 'Extra Help' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                              'bg-gray-100 text-gray-600 border-gray-200';
                            return (
                              <label
                                key={rn.id}
                                data-testid={`checkbox-rn-${pos.id}-${rn.id}`}
                                className={`flex items-start gap-2.5 p-2 rounded-md border transition-all select-none ${
                                  isAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'
                                } ${
                                  isChecked
                                    ? 'bg-green-50 border-green-300 ring-1 ring-green-200'
                                    : 'bg-white/80 border-white/60 hover:bg-white hover:border-gray-200'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  disabled={!isAdmin}
                                  className="h-4 w-4 mt-0.5 shrink-0 accent-green-600 disabled:cursor-not-allowed"
                                  onChange={e => isAdmin && handleCheck(rn.id, rn.name, e.target.checked)}
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className={`text-sm font-medium ${isChecked ? 'text-green-800' : 'text-foreground'}`}>
                                      {rn.name}
                                    </span>
                                    {empType && empType !== 'Full-time' && (
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${empBadgeColor}`}>
                                        {empType}
                                      </span>
                                    )}
                                    {avail.shift !== 'Full' && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded border bg-sky-50 text-sky-700 border-sky-200">
                                        {avail.shift} only
                                      </span>
                                    )}
                                  </div>
                                  {isChecked && (
                                    <div className="text-xs text-green-700 mt-0.5 font-medium">
                                      ✓ Confirmed for {format(date, 'MMM d, yyyy')}
                                    </div>
                                  )}
                                  {avail.note && (
                                    <div className="text-xs text-muted-foreground mt-0.5 italic">{avail.note}</div>
                                  )}
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">
                          {rns.length === 0 ? 'No RN staff added yet.' : 'No availability submitted for this date.'}
                        </p>
                      )}

                      {/* Fallback: assign any RN not in availability list (admin only) */}
                      {isAdmin && rns.filter(r => !rnAvailableToday.find(x => x.rn.id === r.id)).length > 0 && (
                        <details className="group">
                          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground list-none flex items-center gap-1">
                            <span className="group-open:hidden">▸</span>
                            <span className="hidden group-open:inline">▾</span>
                            Assign RN without availability…
                          </summary>
                          <select
                            className="mt-1.5 w-full text-xs rounded border border-gray-200 bg-white px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            value={assignedWithNoAvail ? assignment?.rnId || "" : ""}
                            data-testid={`select-rn-fallback-${pos.id}`}
                            onChange={async (e) => {
                              const rnId = e.target.value;
                              try {
                                if (!rnId) {
                                  if (assignment && assignedWithNoAvail) await deleteRnAssignment(assignment.id);
                                } else {
                                  const rn = rns.find(r => r.id === rnId);
                                  if (rn) await upsertRnAssignment({ date: dateStr0, positionId: pos.id, rnId, rnName: rn.name, note: "" });
                                }
                              } catch {
                                toast({ title: "Failed to save RN assignment", variant: "destructive" });
                              }
                            }}
                          >
                            <option value="">— Select RN —</option>
                            {(() => {
                              const notAvail = rns.filter(r => !rnAvailableToday.find(x => x.rn.id === r.id));
                              // Build sorted list: permanent first, then cross-cover, then rest
                              const thisPerm = notAvail.find(r => r.id === permRn?.id);
                              const crossPosIds = PERM_RN_CROSS_COVER[pos.id] ?? [];
                              const crossPermRns = crossPosIds
                                .map(cid => permanentRns[cid])
                                .filter((r): r is typeof rns[number] => !!r && notAvail.some(n => n.id === r.id));
                              const priorityIds = new Set([
                                ...(thisPerm ? [thisPerm.id] : []),
                                ...crossPermRns.map(r => r.id),
                              ]);
                              const rest = notAvail.filter(r => !priorityIds.has(r.id));
                              const makeOpt = (rn: typeof rns[number], label?: string) => {
                                const absent = !!isStaffUnavailable(unavailability, rn.id, dateStr0);
                                return (
                                  <option key={rn.id} value={rn.id} disabled={absent}>
                                    {absent ? '⚠ ' : ''}{rn.name}{label ? ` ${label}` : ''}{absent ? ' (absent)' : ''}
                                  </option>
                                );
                              };
                              return (
                                <>
                                  {thisPerm && <optgroup label="Permanent RN">{makeOpt(thisPerm, '· Home Unit')}</optgroup>}
                                  {crossPermRns.length > 0 && (
                                    <optgroup label="Cross-Unit (Same Group)">
                                      {crossPermRns.map(r => makeOpt(r, '· Cross-unit'))}
                                    </optgroup>
                                  )}
                                  {rest.length > 0 && (
                                    <optgroup label="Other RNs">
                                      {rest.map(rn => makeOpt(rn))}
                                    </optgroup>
                                  )}
                                </>
                              );
                            })()}
                          </select>
                        </details>
                      )}

                      {/* Merge / absent badges */}
                      {coversBoth && (
                        <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1"
                          data-testid={`badge-covers-both-${pos.id}`}>
                          <span>⚡</span><span>{pos.mergeLabel}</span>
                        </div>
                      )}
                      {assignedRnAbsent && (
                        <div className="flex items-center gap-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                          <span>⚠</span><span>Assigned RN is marked absent today</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {rns.length === 0 && (
              <p className="text-sm text-muted-foreground italic px-1">
                No RN staff members found. Add RNs on the Staff page to enable charge assignments.
              </p>
            )}
          </div>
        )}

        {/* WEEK VIEW */}
        {viewMode === 'week' && (() => {
          const wkStart = startOfWeek(date, { weekStartsOn: 1 });
          const weekDays = Array.from({ length: 5 }, (_, i) => addDays(wkStart, i));
          const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

          const allProviders = staff.filter(s => ['MD', 'DO', 'NP', 'PA'].includes(s.role));
          const filtered = allProviders.filter(p => specialtyMatches(p.specialty));

          // Group providers by specialty for section headers
          const specialtyOrder = Array.from(new Set(filtered.map(p => p.specialty)));
          const groupedProviders: Record<string, typeof filtered> = {};
          specialtyOrder.forEach(sp => { groupedProviders[sp] = filtered.filter(p => p.specialty === sp); });

          const slotColor: Record<string, string> = {
            'Patient Care': 'bg-green-100 text-green-800',
            'Admin': 'bg-blue-100 text-blue-800',
            'Off': 'bg-gray-100 text-gray-500',
            'Meeting': 'bg-amber-100 text-amber-800',
          };

          // Returns Extra Help / float LVNs available to substitute for a specific date+slot+specialty
          const getSwapLvns = (dateStr: string, slot: 'am' | 'pm' | 'full', specialty: string) => {
            const availForDate = allCallAvailability.filter(r => r.availableDate === dateStr);
            return staff.filter(lvn => {
              if (lvn.role !== 'LVN') return false;
              if (isStaffUnavailable(unavailability, lvn.id, dateStr)) return false;
              if (lvn.employmentType !== 'Extra Help' && !lvn.isFloatPool) return false;
              const avail = availForDate.find(r => r.staffId === lvn.id);
              if (!avail) return false;
              if (slot === 'am' && avail.shift === 'PM') return false;
              if (slot === 'pm' && avail.shift === 'AM') return false;
              // Their provider must be off for this slot (making the LVN free)
              const providerIds = lvn.assignedTo ?? [];
              const isFreeForSlot = providerIds.length === 0 || providerIds.every(pid => {
                const ps = getProviderDayState(pid, dateStr);
                const pa = isStaffUnavailable(unavailability, pid, dateStr);
                if (pa) return true;
                if (slot === 'am') return ps.am !== 'Patient Care';
                if (slot === 'pm') return ps.pm !== 'Patient Care';
                return ps.am !== 'Patient Care' && ps.pm !== 'Patient Care';
              });
              if (!isFreeForSlot) return false;
              // Competency for this specialty
              return lvn.specialty === specialty ||
                (lvn.crossTrained ?? []).includes(specialty as any) ||
                !!lvn.isFloatPool;
            });
          };

          // Inline LVN cell
          // Renders a single AM or PM fill-in dropdown for a gap slot inside the Week view
          const WeekShiftDropdown = ({
            providerId, dateStr: ds, shift, variant,
          }: { providerId: string; dateStr: string; shift: 'am' | 'pm'; variant: 'no-lvn' | 'absent' }) => {
            const swapKey = `${providerId}-${ds}-${shift}`;
            const candidates = getDayCoverageCandidates(providerId, ds, shift);
            const selectedId = weekLvnSwap[swapKey];
            const selectedLvn = selectedId ? staff.find(s => s.id === selectedId) : null;
            const shiftLabel = shift === 'am' ? 'AM' : 'PM';
            const borderColor = variant === 'no-lvn' ? 'border-red-300 focus:ring-red-400' : 'border-amber-300 focus:ring-amber-400';
            return (
              <div className="space-y-0.5">
                <span className={`inline-block text-[9px] font-bold uppercase px-1 py-0.5 rounded ${
                  shift === 'am' ? 'bg-sky-100 text-sky-700' : 'bg-indigo-100 text-indigo-700'}`}>
                  {shiftLabel}
                </span>
                {selectedLvn ? (
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[10px] font-medium text-green-700">↪ {selectedLvn.name}</span>
                    <button
                      className="text-[9px] text-muted-foreground hover:text-red-600 shrink-0"
                      data-testid={`button-week-clear-${providerId}-${ds}-${shift}`}
                      onClick={() => setWeekLvnSwap(prev => { const n = { ...prev }; delete n[swapKey]; return n; })}
                    >✕</button>
                  </div>
                ) : (
                  <select
                    className={`w-full text-[10px] rounded border bg-white px-1 py-0.5 focus:outline-none focus:ring-1 ${borderColor}`}
                    value=""
                    data-testid={`select-week-${variant === 'no-lvn' ? 'lvn' : 'lvnswap'}-${providerId}-${ds}-${shift}`}
                    onChange={e => { if (e.target.value) setWeekLvnSwap(prev => ({ ...prev, [swapKey]: e.target.value })); }}
                  >
                    {candidates.length === 0 ? (
                      <option disabled value="">No available LVNs — check rotations?</option>
                    ) : (
                      <>
                        <option value="">— Select fill-in LVN —</option>
                        {candidates.map(({ lvn: cLvn, totalCount, label, scheduleTooltip, shiftConflicted, conflictProviderName }, idx) => (
                          <option
                            key={cLvn.id}
                            value={cLvn.id}
                            title={shiftConflicted ? `⚠ Already assigned to ${conflictProviderName} this shift` : scheduleTooltip}
                            disabled={shiftConflicted}
                          >
                            {shiftConflicted
                              ? `⚠ ${cLvn.name} — Booked (${conflictProviderName})`
                              : `${idx === 0 ? '★ ' : ''}${cLvn.name}${label ? ` · ${label}` : ''} — Current assignments: ${totalCount}`
                            }
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                )}
              </div>
            );
          };

          const LvnCell = ({ provider, dateStr }: { provider: typeof staff[0]; dateStr: string }) => {
            const provState = getProviderDayState(provider.id, dateStr);
            const isProvAbsent = isStaffUnavailable(unavailability, provider.id, dateStr);
            const amIsPC = !isProvAbsent && provState.am === 'Patient Care';
            const pmIsPC = !isProvAbsent && provState.pm === 'Patient Care';
            const assignedLvns = provState.assignments
              .filter(a => a.status === 'Active')
              .map(a => ({ ...a, lvn: staff.find(s => s.id === a.lvnId) }));

            // Shift-aware overbooking: returns a warning string if the LVN has simultaneous patient-care
            // obligations at the SAME shift. Provider off in PM → LVN free PM → not an overbook.
            const getOverbookWarning = (lvnId: string): string | null => {
              const allProv = staff.filter(s => ['MD', 'DO', 'NP', 'PA'].includes(s.role));
              const amConflicts = allProv.filter(p => {
                if (isStaffUnavailable(unavailability, p.id, dateStr)) return false;
                const ps = getProviderDayState(p.id, dateStr);
                return ps.am === 'Patient Care' && ps.assignments.some(a => a.lvnId === lvnId && a.status === 'Active');
              });
              const pmConflicts = allProv.filter(p => {
                if (isStaffUnavailable(unavailability, p.id, dateStr)) return false;
                const ps = getProviderDayState(p.id, dateStr);
                return ps.pm === 'Patient Care' && ps.assignments.some(a => a.lvnId === lvnId && a.status === 'Active');
              });
              const parts: string[] = [];
              if (amConflicts.length > 1) parts.push(`AM: ${amConflicts.map(p => p.name).join(' & ')}`);
              if (pmConflicts.length > 1) parts.push(`PM: ${pmConflicts.map(p => p.name).join(' & ')}`);
              return parts.length > 0 ? parts.join(' | ') : null;
            };
            const needsCoverage = amIsPC || pmIsPC;
            const amFree = !amIsPC;
            const pmFree = !pmIsPC;

            if (assignedLvns.length === 0 && !needsCoverage) {
              return <div className="text-[10px] text-muted-foreground italic">—</div>;
            }

            // No LVN assigned at all — show per-shift dropdowns for Patient Care shifts
            if (assignedLvns.length === 0 && needsCoverage) {
              return (
                <div className="space-y-1.5">
                  <div className="text-[10px] text-red-600 font-medium italic flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0" /> No LVN assigned
                  </div>
                  {amIsPC && (
                    <WeekShiftDropdown
                      providerId={provider.id} dateStr={dateStr} shift="am" variant="no-lvn" />
                  )}
                  {pmIsPC && (
                    <WeekShiftDropdown
                      providerId={provider.id} dateStr={dateStr} shift="pm" variant="no-lvn" />
                  )}
                </div>
              );
            }

            return (
              <div className="space-y-2">
                {assignedLvns.map(({ lvnId, lvn }) => {
                  const absent = isStaffUnavailable(unavailability, lvnId, dateStr);
                  const name = lvn?.name ?? lvnId;
                  const empType = lvn?.employmentType as string | undefined;
                  const empBadge = empType === 'Part-time' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                    empType === 'Per Diem' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                    empType === 'Extra Help' ? 'bg-orange-50 text-orange-700 border-orange-200' : '';
                  const empShort = empType === 'Per Diem' ? 'PD' : empType === 'Extra Help' ? 'EH' : empType === 'Part-time' ? 'PT' : '';
                  const freeChips: string[] = [];
                  if (!absent) {
                    if (amFree && pmFree) freeChips.push('Free Full Day');
                    else if (amFree) freeChips.push('Free AM');
                    else if (pmFree) freeChips.push('Free PM');
                  }

                  // LVN is absent — show per-shift fill-in dropdowns for each Patient Care shift
                  if (absent && needsCoverage) {
                    return (
                      <div key={lvnId} className="space-y-1">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-[10px] font-medium line-through opacity-50">{name}</span>
                          <span className="text-[9px] px-1 py-0.5 rounded bg-red-100 text-red-700 font-medium">{absent.type}</span>
                        </div>
                        {amIsPC && (
                          <WeekShiftDropdown
                            providerId={provider.id} dateStr={dateStr} shift="am" variant="absent" />
                        )}
                        {pmIsPC && (
                          <WeekShiftDropdown
                            providerId={provider.id} dateStr={dateStr} shift="pm" variant="absent" />
                        )}
                      </div>
                    );
                  }

                  return (
                    <div key={lvnId} className="space-y-0.5">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-[10px] font-medium text-foreground">{name}</span>
                        {empShort && empBadge && (
                          <span className={`text-[9px] px-1 py-0.5 rounded border font-medium ${empBadge}`}>{empShort}</span>
                        )}
                        {(() => { const warn = getOverbookWarning(lvnId); return warn ? (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-red-100 text-red-700 border border-red-200 font-bold" title={warn}>⚠ Overbooked - Check!</span>
                        ) : null; })()}
                      </div>
                      {freeChips.length > 0 && (
                        <div className="flex gap-1 flex-wrap">
                          {freeChips.map(c => (
                            <span key={c} className="text-[9px] px-1 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 font-medium">{c}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          };

          // ── Copy Week to Clipboard ──────────────────────────────────────────────
          const handleCopyWeek = async () => {
            const html = `<html><body>
<p style="font-family:Arial;font-size:13px;font-weight:bold;margin-bottom:4px;">Weekly Schedule — ${format(weekDays[0], 'MMM d')}–${format(weekDays[4], 'MMM d, yyyy')}</p>
<p style="font-family:Arial;font-size:11px;color:#64748b;margin-top:0;margin-bottom:8px;">Generated by MediSched · ${format(new Date(), 'MMM d, yyyy h:mm a')}</p>
<table style="border-collapse:collapse;font-family:Arial;font-size:11px;width:100%;">
<thead>
<tr style="background:#1e293b;color:#fff;">
  <th style="padding:5px 8px;border:1px solid #334155;text-align:left;min-width:140px;">Provider</th>
  ${weekDays.map(d => `<th colspan="2" style="padding:5px 8px;border:1px solid #334155;text-align:center;">${format(d, 'EEE MMM d')}</th>`).join('')}
</tr>
<tr style="background:#334155;color:#94a3b8;">
  <th style="padding:3px 8px;border:1px solid #334155;"></th>
  ${weekDays.flatMap(() => ['<th style="padding:3px 6px;border:1px solid #334155;text-align:center;width:80px;">Schedule</th>', '<th style="padding:3px 6px;border:1px solid #334155;text-align:center;width:130px;">LVN</th>']).join('')}
</tr>
</thead>
<tbody>
${specialtyOrder.map(sp => {
  const palette = SPECIALTY_PALETTE[sp] ?? DEFAULT_PALETTE;
  const spRows = groupedProviders[sp] ?? [];
  return `<tr><td colspan="11" style="padding:4px 8px;border:1px solid #cbd5e1;font-weight:bold;font-size:11px;background:${palette.headerBg};color:${palette.headerColor};">${sp}</td></tr>
${spRows.map(p => {
  return `<tr style="background:${palette.bg};">
  <td style="padding:4px 8px;border:1px solid #cbd5e1;font-weight:500;">${p.name}${(p.lvnsRequired ?? 1) > 1 ? ` <span style="color:#dc2626;font-size:10px;">(needs ${p.lvnsRequired})</span>` : ''}</td>
  ${weekDays.map(d => {
    const ds = format(d, 'yyyy-MM-dd');
    const st = getProviderDayState(p.id, ds);
    const abs = isStaffUnavailable(unavailability, p.id, ds);
    const amLabel = abs ? abs.type : st.am;
    const pmLabel = abs ? abs.type : st.pm;
    const amColor = amLabel === 'Patient Care' ? '#166534' : amLabel === 'Off' ? '#64748b' : '#92400e';
    const pmColor = pmLabel === 'Patient Care' ? '#166534' : pmLabel === 'Off' ? '#64748b' : '#92400e';
    const swapKey = `${p.id}-${ds}-full`;
    const swapKeyAm = `${p.id}-${ds}-am`;
    const swapKeyPm = `${p.id}-${ds}-pm`;
    const lvnsHtml = st.assignments.filter(a => a.status === 'Active').map(a => {
      const lvn = staff.find(s => s.id === a.lvnId);
      const absentLvn = isStaffUnavailable(unavailability, a.lvnId, ds);
      const swapId = weekLvnSwap[swapKey] ?? weekLvnSwap[swapKeyAm] ?? weekLvnSwap[swapKeyPm];
      const swapLvn = swapId ? staff.find(s => s.id === swapId) : null;
      const clinicTag = a.clinicAssignment ? ` <span style="color:#0891b2;font-size:10px;">&#8594; ${a.clinicAssignment}</span>` : '';
      if (absentLvn && swapLvn) return `<s style="color:#94a3b8">${lvn?.name ?? a.lvnId}</s> ↪ <strong>${swapLvn.name}</strong>${clinicTag}`;
      if (absentLvn) return `<s style="color:#94a3b8">${lvn?.name ?? a.lvnId}</s> [${absentLvn.type}]${clinicTag}`;
      return `<strong>${lvn?.name ?? a.lvnId}</strong>${clinicTag}`;
    }).join('<br/>') || '<span style="color:#94a3b8;font-style:italic;">—</span>';
    return `<td style="padding:4px 6px;border:1px solid #cbd5e1;text-align:center;font-size:10px;white-space:nowrap;">
  <div style="color:${amColor}">AM: ${amLabel}</div>
  <div style="color:${pmColor}">PM: ${pmLabel}</div>
</td>
<td style="padding:4px 6px;border:1px solid #cbd5e1;font-size:10px;">${lvnsHtml}</td>`;
  }).join('')}
</tr>`;
}).join('')}`;
}).join('')}
</tbody>
</table>

<p style="font-family:Arial;font-size:12px;font-weight:bold;margin:14px 0 4px;color:#0e7490;">&#128197; Specialty Clinics</p>
<table style="border-collapse:collapse;font-family:Arial;font-size:11px;width:100%;">
<thead>
<tr style="background:#0e7490;color:#fff;">
  <th style="padding:4px 8px;border:1px solid #0e7490;text-align:left;min-width:140px;">Clinic</th>
  ${weekDays.map(d => `<th style="padding:4px 8px;border:1px solid #0e7490;text-align:center;">${format(d, 'EEE MMM d')}</th>`).join('')}
</tr>
</thead>
<tbody>
${(() => {
  const allWeekClinics = new Map<string, typeof clinics[0]>();
  weekDays.forEach(d => {
    const ds = format(d, 'yyyy-MM-dd');
    clinics.filter(c => isClinicOpen(c, overrides, ds)).forEach(c => allWeekClinics.set(c.id, c));
  });
  if (allWeekClinics.size === 0) return `<tr><td colspan="6" style="padding:4px 8px;border:1px solid #e2e8f0;color:#94a3b8;font-style:italic;">No specialty clinics this week</td></tr>`;
  return Array.from(allWeekClinics.values()).map(clinic => {
    const cells = weekDays.map(d => {
      const ds = format(d, 'yyyy-MM-dd');
      if (!isClinicOpen(clinic, overrides, ds)) return `<td style="padding:3px 6px;border:1px solid #e2e8f0;background:#f8fafc;text-align:center;color:#94a3b8;">—</td>`;
      const asgns = clinicAssignments.filter(a => a.clinicId === clinic.id && a.date === ds);
      const names = asgns.map(a => {
        const m = staff.find(s => s.id === a.staffId);
        return `<strong>${m ? m.name : a.staffName}</strong>`;
      }).join('<br/>') || `<span style="color:#dc2626;font-style:italic;">Needs coverage</span>`;
      const filled = asgns.length >= clinic.staffNeeded;
      return `<td style="padding:3px 6px;border:1px solid #e2e8f0;background:${filled ? '#f0fdf4' : '#fef2f2'};font-size:10px;">${names}</td>`;
    }).join('');
    return `<tr><td style="padding:3px 8px;border:1px solid #e2e8f0;font-weight:500;">${clinic.name}<br/><span style="font-size:10px;color:#64748b;">${clinic.startTime}–${clinic.endTime}</span></td>${cells}</tr>`;
  }).join('');
})()}
</tbody>
</table>

<p style="font-family:Arial;font-size:12px;font-weight:bold;margin:14px 0 4px;color:#1e40af;">&#128101; RN Charge Assignments</p>
<table style="border-collapse:collapse;font-family:Arial;font-size:11px;width:100%;">
<thead>
<tr style="background:#1e40af;color:#fff;">
  <th style="padding:4px 8px;border:1px solid #1e40af;text-align:left;min-width:180px;">Position</th>
  ${weekDays.map(d => `<th style="padding:4px 8px;border:1px solid #1e40af;text-align:center;">${format(d, 'EEE MMM d')}</th>`).join('')}
</tr>
</thead>
<tbody>
${RN_POSITIONS.map(pos => {
  const cells = weekDays.map(d => {
    const ds = format(d, 'yyyy-MM-dd');
    const asgn = weeklyRnAssignments.find(a => a.positionId === pos.id && a.date === ds);
    if (!asgn) return `<td style="padding:3px 6px;border:1px solid #e2e8f0;text-align:center;color:#94a3b8;font-style:italic;">—</td>`;
    const rn = staff.find(s => s.id === asgn.rnId);
    const phone = rn?.phone ? ` <a href="tel:${rn.phone}" style="color:#2563eb;text-decoration:none;font-size:9px;">&#128222;</a>` : '';
    return `<td style="padding:3px 6px;border:1px solid #e2e8f0;background:#eff6ff;font-size:10px;"><strong>${asgn.rnName}</strong>${phone}</td>`;
  }).join('');
  return `<tr><td style="padding:3px 8px;border:1px solid #e2e8f0;font-weight:500;color:${pos.headerBg};">${pos.label}<br/><span style="font-size:10px;color:#64748b;font-weight:normal;">${pos.areas.join(', ')}</span></td>${cells}</tr>`;
}).join('')}
</tbody>
</table>
</body></html>`;

            const plainClinicSection = (() => {
              const allWeekClinics = new Map<string, typeof clinics[0]>();
              weekDays.forEach(d => {
                const ds = format(d, 'yyyy-MM-dd');
                clinics.filter(c => isClinicOpen(c, overrides, ds)).forEach(c => allWeekClinics.set(c.id, c));
              });
              if (allWeekClinics.size === 0) return '';
              return '\n\n== SPECIALTY CLINICS ==\n' +
                Array.from(allWeekClinics.values()).map(clinic =>
                  `  ${clinic.name}:\n` + weekDays.map(d => {
                    const ds = format(d, 'yyyy-MM-dd');
                    if (!isClinicOpen(clinic, overrides, ds)) return `    ${format(d, 'EEE')}: Closed`;
                    const asgns = clinicAssignments.filter(a => a.clinicId === clinic.id && a.date === ds);
                    return `    ${format(d, 'EEE')}: ${asgns.map(a => a.staffName).join(', ') || 'Needs coverage'}`;
                  }).join('\n')
                ).join('\n');
            })();

            const plainRnSection = '\n\n== RN CHARGE ASSIGNMENTS ==\n' +
              RN_POSITIONS.map(pos =>
                `  ${pos.label}:\n` + weekDays.map(d => {
                  const ds = format(d, 'yyyy-MM-dd');
                  const asgn = weeklyRnAssignments.find(a => a.positionId === pos.id && a.date === ds);
                  return `    ${format(d, 'EEE')}: ${asgn ? asgn.rnName : '— Unassigned'}`;
                }).join('\n')
              ).join('\n');

            const plain = `Weekly Schedule — ${format(weekDays[0], 'MMM d')}–${format(weekDays[4], 'MMM d, yyyy')}\n\n` +
              specialtyOrder.map(sp => {
                const spRows = groupedProviders[sp] ?? [];
                return `== ${sp} ==\n` + spRows.map(p =>
                  `  ${p.name}:\n` + weekDays.map(d => {
                    const ds = format(d, 'yyyy-MM-dd');
                    const st = getProviderDayState(p.id, ds);
                    const lvns = st.assignments.filter(a => a.status === 'Active')
                      .map(a => {
                        const name = staff.find(s => s.id === a.lvnId)?.name ?? a.lvnId;
                        return a.clinicAssignment ? `${name} → ${a.clinicAssignment}` : name;
                      }).join(', ') || '—';
                    return `    ${format(d, 'EEE')}: AM=${st.am} PM=${st.pm} | LVN: ${lvns}`;
                  }).join('\n')
                ).join('\n') + '\n';
              }).join('\n') + plainClinicSection + plainRnSection;

            try {
              const htmlBlob = new Blob([html], { type: 'text/html' });
              const textBlob = new Blob([plain], { type: 'text/plain' });
              await navigator.clipboard.write([new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob })]);
            } catch {
              await navigator.clipboard.writeText(plain);
            }
            setCopiedWeek(true);
            toast({ title: "Week Copied!", description: "Color-coded weekly grid copied — paste into Outlook or email." });
            setTimeout(() => setCopiedWeek(false), 2000);
          };

          const TOTAL_COLS = 11; // 1 provider + 5 days × 2 sub-cols

          return (
            <div className="space-y-4">
              {/* Toolbar: Copy Week */}
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  {format(weekDays[0], 'MMM d')} – {format(weekDays[4], 'MMM d, yyyy')} · Grouped by specialty
                </div>
                <Button variant="outline" size="sm" onClick={handleCopyWeek} data-testid="button-copy-week">
                  {copiedWeek
                    ? <><Check className="w-4 h-4 mr-2 text-green-600" />Copied!</>
                    : <><Copy className="w-4 h-4 mr-2" />Copy Week</>}
                </Button>
              </div>

              {/* Provider / LVN table — grouped by specialty */}
              <div className="border border-border rounded-lg overflow-x-auto bg-card shadow-sm">
                <table className="border-collapse text-sm" style={{ minWidth: '1240px' }}>
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="sticky left-0 z-10 bg-muted/90 px-4 py-3 text-left font-medium text-muted-foreground border-r border-border" style={{ minWidth: 180 }}>Provider</th>
                      {weekDays.map((d, i) => (
                        <th key={d.toString()} colSpan={2} className="px-2 py-3 text-center font-medium text-muted-foreground border-l border-border" style={{ minWidth: 280 }}>
                          <div className="text-xs font-semibold">{DAY_LABELS[i]}</div>
                          <div className="text-[11px] font-normal">{format(d, 'MMM d')}</div>
                        </th>
                      ))}
                    </tr>
                    <tr className="bg-muted/30 border-b border-border text-[11px] text-muted-foreground">
                      <th className="sticky left-0 z-10 bg-muted/60 px-4 py-1 border-r border-border" />
                      {weekDays.flatMap((_, i) => [
                        <th key={`sch-h-${i}`} className="px-2 py-1.5 text-center border-l border-border font-medium" style={{ width: 110 }}>Schedule</th>,
                        <th key={`lvn-h-${i}`} className="px-2 py-1.5 text-center border-l border-border/50 font-medium">LVN Assignment</th>,
                      ])}
                    </tr>
                  </thead>
                  <tbody>
                    {specialtyOrder.map(specialty => {
                      const palette = SPECIALTY_PALETTE[specialty] ?? DEFAULT_PALETTE;
                      const spProviders = groupedProviders[specialty];
                      return [
                        <tr key={`hdr-${specialty}`}>
                          <td colSpan={TOTAL_COLS} className="px-4 py-2 font-semibold text-xs tracking-wide border-b border-t border-border"
                            style={{ background: palette.headerBg, color: palette.headerColor }}>
                            {specialty}
                          </td>
                        </tr>,
                        ...spProviders.map(provider => (
                          <tr key={provider.id} className="hover:bg-accent/5 transition-colors border-b border-border/50">
                            <td className="sticky left-0 z-10 bg-card px-4 py-3 border-r border-border align-top" style={{ minWidth: 180 }}>
                              <div className="font-medium text-foreground leading-tight text-sm">{provider.name}</div>
                              <div className="text-[10px] mt-0.5 px-1.5 py-0.5 rounded inline-block font-medium truncate max-w-[155px]"
                                style={{ background: palette.headerBg, color: palette.headerColor }}>
                                {provider.specialty.length > 20 ? provider.specialty.slice(0, 20) + '…' : provider.specialty}
                              </div>
                              {(provider.lvnsRequired ?? 1) > 1 && (
                                <div className="text-[10px] text-red-600 mt-0.5">Needs {provider.lvnsRequired} LVNs</div>
                              )}
                            </td>
                            {weekDays.flatMap((d, di) => {
                              const dateStr = format(d, 'yyyy-MM-dd');
                              const state = getProviderDayState(provider.id, dateStr);
                              const isUnavail = isStaffUnavailable(unavailability, provider.id, dateStr);
                              return [
                                <td key={`sch-${provider.id}-${di}`} className="px-1 py-2 border-l border-border align-top">
                                  {isUnavail ? (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium block text-center">{isUnavail.type}</span>
                                  ) : (
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-0.5">
                                        <span className="text-[9px] text-muted-foreground w-4 shrink-0">AM</span>
                                        <select
                                          data-testid={`select-week-am-${provider.id}-${dateStr}`}
                                          value={state.am}
                                          onChange={e => handleInlineScheduleChange(provider.id, dateStr, 'am', e.target.value)}
                                          className={`flex-1 text-[10px] rounded border px-1 py-0.5 cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring font-medium ${
                                            state.am === 'Patient Care' ? 'bg-green-50 border-green-200 text-green-800' :
                                            state.am === 'Off' ? 'bg-slate-50 border-slate-200 text-slate-500' :
                                            state.am === 'Admin' ? 'bg-amber-50 border-amber-200 text-amber-700' :
                                            'bg-purple-50 border-purple-200 text-purple-700'}`}
                                        >
                                          {(['Patient Care', 'Admin', 'Off', 'Meeting'] as const).map(o => <option key={o} value={o}>{o}</option>)}
                                        </select>
                                      </div>
                                      <div className="flex items-center gap-0.5">
                                        <span className="text-[9px] text-muted-foreground w-4 shrink-0">PM</span>
                                        <select
                                          data-testid={`select-week-pm-${provider.id}-${dateStr}`}
                                          value={state.pm}
                                          onChange={e => handleInlineScheduleChange(provider.id, dateStr, 'pm', e.target.value)}
                                          className={`flex-1 text-[10px] rounded border px-1 py-0.5 cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring font-medium ${
                                            state.pm === 'Patient Care' ? 'bg-green-50 border-green-200 text-green-800' :
                                            state.pm === 'Off' ? 'bg-slate-50 border-slate-200 text-slate-500' :
                                            state.pm === 'Admin' ? 'bg-amber-50 border-amber-200 text-amber-700' :
                                            'bg-purple-50 border-purple-200 text-purple-700'}`}
                                        >
                                          {(['Patient Care', 'Admin', 'Off', 'Meeting'] as const).map(o => <option key={o} value={o}>{o}</option>)}
                                        </select>
                                      </div>
                                    </div>
                                  )}
                                </td>,
                                <td key={`lvn-${provider.id}-${di}`} className="px-2 py-2.5 border-l border-border/50 align-top" style={{ minWidth: 160 }}>
                                  <LvnCell provider={provider} dateStr={dateStr} />
                                </td>,
                              ];
                            })}
                          </tr>
                        )),
                      ];
                    })}
                  </tbody>
                </table>
              </div>

              {/* RN Charge Nurse weekly overview */}
              <div className="border border-border rounded-lg overflow-x-auto bg-card shadow-sm">
                <table className="border-collapse text-sm" style={{ minWidth: '1000px' }}>
                  <thead>
                    <tr style={{ background: '#1e3a5f' }}>
                      <td colSpan={6} className="px-4 py-2 text-white font-semibold text-xs tracking-wide">
                        RN Charge Assignments — {format(weekDays[0], 'MMM d')}–{format(weekDays[4], 'MMM d')}
                      </td>
                    </tr>
                    <tr className="bg-muted/30 border-b border-border text-[11px] text-muted-foreground">
                      <th className="px-4 py-2 text-left font-medium border-r border-border" style={{ minWidth: 200 }}>Position</th>
                      {weekDays.map((d, i) => (
                        <th key={d.toString()} className="px-3 py-2 text-center font-medium border-l border-border" style={{ minWidth: 160 }}>
                          <div className="font-semibold">{DAY_LABELS[i]}</div>
                          <div className="font-normal">{format(d, 'MMM d')}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {RN_POSITIONS.map(pos => (
                      <tr key={pos.id} className="border-b border-border/50 hover:bg-accent/5">
                        <td className="px-4 py-2.5 border-r border-border align-middle" style={{ background: pos.bg + '55' }}>
                          <div className="text-xs font-semibold leading-tight" style={{ color: pos.headerBg }}>{pos.label}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{pos.areas.join(', ')}</div>
                        </td>
                        {weekDays.map((d, di) => {
                          const dateStr = format(d, 'yyyy-MM-dd');
                          const assignment = weeklyRnAssignments.find(a => a.date === dateStr && a.positionId === pos.id);
                          const assignedRn = assignment ? staff.find(s => s.id === assignment.rnId) : null;
                          const isAbsent = assignment ? !!isStaffUnavailable(unavailability, assignment.rnId, dateStr) : false;
                          const weekPermRn = permanentRns[pos.id];
                          const weekPermAbsent = weekPermRn ? !!isStaffUnavailable(unavailability, weekPermRn.id, dateStr) : false;
                          const isCrossCover = assignment && weekPermRn && assignment.rnId !== weekPermRn.id;
                          return (
                            <td key={di} className={`px-3 py-2.5 text-center border-l border-border align-middle ${weekPermAbsent && !assignment ? 'bg-amber-50/60' : ''}`}>
                              {assignment ? (
                                <div className="space-y-0.5">
                                  <div className={`text-[10px] font-medium ${isAbsent ? 'line-through opacity-50' : ''}`}>
                                    {assignedRn?.name ?? assignment.rnName}
                                  </div>
                                  {isAbsent ? (
                                    <span className="text-[9px] text-red-600 font-medium">Absent</span>
                                  ) : isCrossCover ? (
                                    <span className="text-[9px] text-blue-600 font-medium">↔ Cross-unit</span>
                                  ) : (
                                    <span className="text-[9px] text-green-600 font-medium">✓ Perm</span>
                                  )}
                                </div>
                              ) : (
                                <div className="space-y-0.5">
                                  <div className={`text-[10px] italic ${weekPermAbsent ? 'text-amber-600 line-through opacity-60' : 'text-muted-foreground opacity-60'}`}>
                                    {permanentRns[pos.id]?.name ?? '—'}
                                  </div>
                                  <span className={`text-[9px] ${weekPermAbsent ? 'text-amber-600 font-semibold' : 'text-muted-foreground'}`}>
                                    {weekPermAbsent ? '⚠ Absent' : 'Default'}
                                  </span>
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* MONTH VIEW */}
        {viewMode === 'month' && (
          <div className="border border-border rounded-lg overflow-x-auto bg-card shadow-sm">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-muted/90 p-4 text-left text-sm font-medium text-muted-foreground border-b border-r min-w-[200px]">Provider</th>
                  {monthDays.map(d => (
                    <th key={d.toString()} className={`p-2 min-w-[40px] text-center text-xs font-medium text-muted-foreground border-b border-border ${isWeekend(d) ? 'opacity-40' : ''}`}>
                      {format(d, 'd')}
                      <div className="text-[10px] font-normal opacity-70">{format(d, 'EEEEE')}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentDayState.map(row => {
                  const providerId = row.providerId;
                  const provider = staff.find(s => s.id === providerId);
                  if (!provider) return null;
                  return (
                    <tr key={providerId} className="hover:bg-accent/5 group">
                      <td className="sticky left-0 z-10 bg-card p-3 border-r border-b text-sm font-medium group-hover:bg-accent/5 relative group/pm">
                        <div className="flex justify-between items-center">
                          <div className="truncate w-[150px]">{provider.name}</div>
                          <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover/pm:opacity-100 transition-opacity"
                            onClick={e => handleStaffEditClick(e, provider.id)}>
                            <Edit2 className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="text-xs text-muted-foreground truncate w-[180px]">{provider.specialty}</div>
                      </td>
                      {monthDays.map(d => {
                        const dateStr = format(d, 'yyyy-MM-dd');
                        const cellData = getProviderDayState(providerId, dateStr);
                        let statusColor = 'bg-gray-200';
                        if (cellData?.am === 'Patient Care' || cellData?.pm === 'Patient Care') statusColor = 'bg-green-500';
                        if (cellData?.am === 'Off' && cellData?.pm === 'Off') statusColor = 'bg-gray-300';
                        return (
                          <td key={dateStr} className={`border-b border-border p-1 text-center cursor-pointer hover:bg-accent/10 ${isWeekend(d) ? 'opacity-40' : ''}`}
                            onClick={() => handleEditClick(providerId, dateStr)}>
                            <div className={`w-3 h-3 rounded-full mx-auto ${statusColor}`} title={`${cellData?.am}/${cellData?.pm}`} />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 2-WEEK OUTLOOK */}
        {viewMode === 'outlook' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                {totalGaps === 0 ? (
                  <div className="flex items-center gap-2 text-green-700 bg-green-500/10 border border-green-200 rounded-lg p-3">
                    <Check className="w-4 h-4" />
                    <span className="text-sm font-medium">No coverage gaps detected in the next 14 weekdays.</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-red-700 bg-red-500/10 border border-red-200 rounded-lg p-3">
                    <AlertCircle className="w-4 h-4" />
                    <span className="text-sm font-medium">
                      <strong>{totalGaps}</strong> coverage gap{totalGaps !== 1 ? 's' : ''} detected. Select a replacement LVN from each dropdown to record coverage.
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {gapData.map(({ date: day, dateStr, gaps }) => {
                const isToday = dateStr === format(new Date(), 'yyyy-MM-dd');
                return (
                  <Card key={dateStr} className={`${gaps.length > 0 ? 'border-red-200' : 'border-border'} ${isToday ? 'ring-2 ring-primary/30' : ''}`}>
                    <CardHeader className="py-3 px-4">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                          {isToday && <Badge className="text-[10px] bg-primary/15 text-primary border-primary/20">Today</Badge>}
                          {format(day, 'EEEE, MMMM d')}
                        </CardTitle>
                        <div className="flex items-center gap-2">
                          {gaps.length > 0 ? (
                            <Badge className="bg-red-500/15 text-red-700 border-red-200 text-xs">
                              <AlertTriangle className="w-3 h-3 mr-1" />
                              {gaps.length} gap{gaps.length !== 1 ? 's' : ''}
                            </Badge>
                          ) : (
                            <Badge className="bg-green-500/15 text-green-700 border-green-200 text-xs">
                              <Check className="w-3 h-3 mr-1" /> Fully Covered
                            </Badge>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    {gaps.length > 0 && (
                      <CardContent className="pt-0 pb-4 px-4 space-y-3">
                        {gaps.map((gap) => {
                          const { provider, groupedProviders, lvnsNeeded, absentLvns, amGap, pmGap, noLvnAssigned, regularCoverage, floatCoverage, isFloatOnly, contactMode } = gap;
                          const shifts: Array<'am' | 'pm'> = [...(amGap ? ['am' as const] : []), ...(pmGap ? ['pm' as const] : [])];
                          const allGroupProviders = [provider, ...(groupedProviders ?? [])];
                          const isGroup = (groupedProviders ?? []).length > 0;

                          return (
                            <div key={provider.id} className="bg-red-500/5 border border-red-100 rounded-lg p-3 space-y-3">
                              {/* Provider info + absent LVNs */}
                              <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  {isGroup ? (
                                    <div className="flex flex-col gap-0.5">
                                      <span className="font-medium text-sm">{provider.specialty} — Shared LVN Coverage</span>
                                      <span className="text-xs text-muted-foreground">
                                        {allGroupProviders.map(p => p.name).join(' · ')}
                                      </span>
                                    </div>
                                  ) : (
                                    <>
                                      <span className="font-medium text-sm">{provider.name}</span>
                                      <span className="text-xs text-muted-foreground">— {provider.specialty}</span>
                                    </>
                                  )}
                                  <div className="flex gap-1 ml-auto flex-wrap">
                                    {lvnsNeeded > 1 && (
                                      <Badge variant="outline" className="text-xs h-5 px-1.5 border-red-400 text-red-700 bg-red-50">
                                        Needs {lvnsNeeded} LVNs
                                      </Badge>
                                    )}
                                    {amGap && <Badge variant="outline" className="text-xs h-5 px-1.5 border-orange-300 text-orange-700">AM</Badge>}
                                    {pmGap && <Badge variant="outline" className="text-xs h-5 px-1.5 border-orange-300 text-orange-700">PM</Badge>}
                                  </div>
                                </div>
                                <div className="mt-1.5 space-y-0.5">
                                  {noLvnAssigned ? (
                                    <div className="flex items-center gap-1.5 text-xs text-red-700">
                                      <AlertCircle className="w-3 h-3 shrink-0" />
                                      <span>No LVN permanently assigned — unscheduled gap</span>
                                    </div>
                                  ) : (
                                    absentLvns.map(({ lvn, reason }) => (
                                      <div key={lvn.id} className="flex items-center gap-1.5 text-xs text-red-700">
                                        <CalendarOff className="w-3 h-3 shrink-0" />
                                        <span><strong>{lvn.name}</strong> — {reason}</span>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>

                              {/* Float-only warning */}
                              {isFloatOnly && floatCoverage.length > 0 && (
                                <div className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs font-medium ${
                                  contactMode === 'advance'
                                    ? 'bg-amber-50 border border-amber-200 text-amber-800'
                                    : 'bg-red-50 border border-red-200 text-red-800'
                                }`}>
                                  {contactMode === 'advance'
                                    ? <><Star className="w-3 h-3 shrink-0" /> No regular staff available — float pool shown. Contact 3+ weeks in advance.</>
                                    : <><Phone className="w-3 h-3 shrink-0" /> No regular staff available — <strong>EMERGENT: Contact float pool now.</strong></>
                                  }
                                </div>
                              )}
                              {isFloatOnly && floatCoverage.length === 0 && (
                                <div className="flex items-center gap-2 rounded px-2 py-1.5 text-xs bg-red-100 border border-red-300 text-red-800 font-medium">
                                  <AlertCircle className="w-3 h-3 shrink-0" /> No regular or float pool staff available. Manual escalation required.
                                </div>
                              )}

                              {/* Per-shift dropdown rows */}
                              <div className="space-y-2">
                                {shifts.map(shift => {
                                  const key = `${provider.id}-${dateStr}-${shift}`;
                                  const selectedLvnId = selectedCoverage[key] ?? "";
                                  const isAssigning = assigningKey === key;

                                  // Build per-date booking map: lvnId → providerName they're covering
                                  const bookedThisDate = new Map<string, string>();
                                  coverageHistory.filter(h => h.date === dateStr).forEach(h => {
                                    bookedThisDate.set(h.staffId, h.providerName);
                                  });
                                  // Also flag LVNs already selected in other gap dropdowns on same date+shift
                                  gapData.find(d => d.dateStr === dateStr)?.gaps.forEach(g => {
                                    const otherKey = `${g.provider.id}-${dateStr}-${shift}`;
                                    if (otherKey !== key && selectedCoverage[otherKey] && !bookedThisDate.has(selectedCoverage[otherKey])) {
                                      bookedThisDate.set(selectedCoverage[otherKey], g.provider.name);
                                    }
                                  });

                                  // Total assignments today for an LVN: coverage records + regular provider assignments
                                  const getLvnTotalCount = (lvnId: string) => {
                                    const fromHistory = coverageHistory.filter(h => h.date === dateStr && h.staffId === lvnId).length;
                                    const fromAssigned = staff.filter(s => ['MD', 'DO', 'NP', 'PA'].includes(s.role)).filter(p => {
                                      const st = getProviderDayState(p.id, dateStr);
                                      return st.assignments.some(a => a.lvnId === lvnId && a.status === 'Active');
                                    }).length;
                                    return fromHistory + fromAssigned;
                                  };

                                  // Filter candidates for this specific shift
                                  const shiftRegular = regularCoverage.filter(c =>
                                    shift === 'am' ? c.shiftAvailable.am : c.shiftAvailable.pm
                                  );
                                  const shiftFloat = floatCoverage.filter(c =>
                                    shift === 'am' ? c.shiftAvailable.am : c.shiftAvailable.pm
                                  );

                                  // Split available vs already-booked for this date
                                  const regularAvail = shiftRegular.filter(c => !bookedThisDate.has(c.lvn.id));
                                  const regularBooked = shiftRegular.filter(c => bookedThisDate.has(c.lvn.id));
                                  const floatAvail = shiftFloat.filter(c => !bookedThisDate.has(c.lvn.id));
                                  const floatBooked = shiftFloat.filter(c => bookedThisDate.has(c.lvn.id));
                                  const shiftFloatOnly = regularAvail.length === 0;
                                  const hasAnyOption = regularAvail.length > 0 || floatAvail.length > 0 || regularBooked.length > 0 || floatBooked.length > 0;

                                  return (
                                    <div key={shift} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                                      <span className={`shrink-0 text-xs font-semibold uppercase rounded px-2 py-1 ${
                                        shift === 'am' ? 'bg-sky-100 text-sky-700' : 'bg-indigo-100 text-indigo-700'
                                      }`}>
                                        {shift === 'am' ? 'AM' : 'PM'}
                                      </span>

                                      <div className="flex-1">
                                        <select
                                          data-testid={`select-coverage-${provider.id}-${dateStr}-${shift}`}
                                          value={selectedLvnId}
                                          onChange={e => setSelectedCoverage(prev => ({ ...prev, [key]: e.target.value }))}
                                          className="w-full text-sm border border-input rounded-md px-3 py-2 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                                          style={{ minHeight: 40 }}
                                        >
                                          <option value="">— Select coverage LVN —</option>

                                          {/* Available regular staff */}
                                          {regularAvail.length > 0 && (
                                            <optgroup label="Available LVN Staff">
                                              {regularAvail.map(({ lvn, crossCount, shiftAvailable }, idx) => {
                                                const total = getLvnTotalCount(lvn.id);
                                                return (
                                                  <option key={lvn.id} value={lvn.id} title={getLvnScheduleTooltip(lvn, dateStr)}>
                                                    {idx === 0 ? '★ ' : ''}{lvn.name}{shiftAvailable.label ? ` · ${shiftAvailable.label}` : ''} — {total} assignment{total !== 1 ? 's' : ''} today · {crossCount} cross
                                                  </option>
                                                );
                                              })}
                                            </optgroup>
                                          )}

                                          {/* Available float pool (only if no regular staff) */}
                                          {shiftFloatOnly && floatAvail.length > 0 && (
                                            <optgroup label={`Float Pool LVN${contactMode === 'advance' ? ' — Contact 3 Weeks Advance' : ' — EMERGENT'}`}>
                                              {floatAvail.map(({ lvn, shiftAvailable }) => {
                                                const total = getLvnTotalCount(lvn.id);
                                                return (
                                                  <option key={lvn.id} value={lvn.id} title={getLvnScheduleTooltip(lvn, dateStr)}>
                                                    ⭐ {lvn.name}{shiftAvailable.label ? ` · ${shiftAvailable.label}` : ''} — {total} assignment{total !== 1 ? 's' : ''} today — Float Pool
                                                  </option>
                                                );
                                              })}
                                            </optgroup>
                                          )}

                                          {/* Already-booked LVNs — shown for override; double-book prompt fires on Assign */}
                                          {(regularBooked.length > 0 || floatBooked.length > 0) && (
                                            <optgroup label="⚠ Already Covering Another Provider (override to pull)">
                                              {[...regularBooked, ...floatBooked].map(({ lvn, shiftAvailable }) => {
                                                const bookedFor = bookedThisDate.get(lvn.id) ?? '?';
                                                const total = getLvnTotalCount(lvn.id);
                                                return (
                                                  <option key={lvn.id} value={lvn.id} title={getLvnScheduleTooltip(lvn, dateStr)}>
                                                    {lvn.name}{shiftAvailable.label ? ` · ${shiftAvailable.label}` : ''} — Already covering {bookedFor} · {total} assignment{total !== 1 ? 's' : ''} today
                                                  </option>
                                                );
                                              })}
                                            </optgroup>
                                          )}

                                          {!hasAnyOption && (
                                            <option disabled>No LVN staff available for this shift</option>
                                          )}
                                        </select>
                                      </div>

                                      <Button
                                        size="sm"
                                        disabled={!selectedLvnId || isAssigning}
                                        onClick={() => handleAssignCoverage(gap, dateStr, shift, selectedLvnId)}
                                        data-testid={`button-assign-coverage-${provider.id}-${dateStr}-${shift}`}
                                        className="shrink-0"
                                      >
                                        {isAssigning ? "Saving…" : "Assign"}
                                      </Button>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Form C — Bulk Schedule Entry Dialog */}
        <Dialog open={showFormC} onOpenChange={open => !open && setShowFormC(false)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ClipboardList className="w-5 h-5" />
                Form C — Bulk Schedule Entry
              </DialogTitle>
              <DialogDescription>
                Select a provider and add one or more date ranges to open or close their schedule in bulk.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5 py-2">
              {/* Provider selector */}
              <div className="space-y-1.5">
                <Label htmlFor="formC-provider">Provider</Label>
                <Select value={formCProviderId} onValueChange={setFormCProviderId} disabled={formCApplying}>
                  <SelectTrigger id="formC-provider" data-testid="select-formc-provider">
                    <SelectValue placeholder="Select a provider…" />
                  </SelectTrigger>
                  <SelectContent>
                    {staff
                      .filter(s => ['MD', 'DO', 'NP', 'PA'].includes(s.role) && s.isActive !== false)
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map(p => (
                        <SelectItem key={p.id} value={p.id} data-testid={`option-provider-${p.id}`}>
                          {p.name} ({p.role})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Entry rows */}
              <div className="space-y-3">
                <Label>Schedule Entries</Label>
                {formCEntries.map((entry, idx) => (
                  <div key={entry.id} className="border border-border rounded-lg p-3 space-y-3 bg-muted/30">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-muted-foreground">Row {idx + 1}</span>
                      {formCEntries.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => removeFormCEntry(entry.id)}
                          data-testid={`button-remove-entry-${entry.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>

                    {/* Date range */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Start date</Label>
                        <Input
                          type="date"
                          value={entry.startDate}
                          onChange={e => updateFormCEntry(entry.id, 'startDate', e.target.value)}
                          disabled={formCApplying}
                          data-testid={`input-start-date-${entry.id}`}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">End date</Label>
                        <Input
                          type="date"
                          value={entry.endDate}
                          min={entry.startDate}
                          onChange={e => updateFormCEntry(entry.id, 'endDate', e.target.value)}
                          disabled={formCApplying}
                          data-testid={`input-end-date-${entry.id}`}
                        />
                      </div>
                    </div>

                    {/* AM / PM selectors */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">AM</Label>
                        <Select value={entry.am} onValueChange={v => updateFormCEntry(entry.id, 'am', v)} disabled={formCApplying}>
                          <SelectTrigger data-testid={`select-am-${entry.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Patient Care">Open — Patient Care</SelectItem>
                            <SelectItem value="Off">Close — Off</SelectItem>
                            <SelectItem value="Admin">Admin</SelectItem>
                            <SelectItem value="Meeting">Meeting</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">PM</Label>
                        <Select value={entry.pm} onValueChange={v => updateFormCEntry(entry.id, 'pm', v)} disabled={formCApplying}>
                          <SelectTrigger data-testid={`select-pm-${entry.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Patient Care">Open — Patient Care</SelectItem>
                            <SelectItem value="Off">Close — Off</SelectItem>
                            <SelectItem value="Admin">Admin</SelectItem>
                            <SelectItem value="Meeting">Meeting</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                ))}

                <Button variant="outline" size="sm" onClick={addFormCEntry} disabled={formCApplying} data-testid="button-add-entry" className="w-full">
                  <Plus className="w-4 h-4 mr-2" />
                  Add another date range
                </Button>
              </div>

              {/* Example hint */}
              <div className="flex gap-2 rounded-md bg-muted/50 border border-border px-3 py-2.5 text-xs text-muted-foreground">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                <div className="space-y-0.5 leading-relaxed">
                  <span className="font-medium text-foreground">Example:</span>{' '}
                  Select Dr. Doe → Row 1: Apr 1–3, AM = Open (Patient Care), PM = Open (Patient Care) → Row 2: Apr 4, AM = Close (Off), PM = Close (Off) → click <span className="font-medium text-foreground">Apply</span> to save all at once.
                </div>
              </div>

              {/* Skip weekends toggle */}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="formC-skip-weekends"
                  checked={formCSkipWeekends}
                  onCheckedChange={v => setFormCSkipWeekends(!!v)}
                  data-testid="checkbox-skip-weekends"
                />
                <Label htmlFor="formC-skip-weekends" className="cursor-pointer">
                  Skip weekends (Mon–Fri only)
                </Label>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowFormC(false)} disabled={formCApplying} data-testid="button-formc-cancel">
                Cancel
              </Button>
              <Button onClick={handleFormCApply} disabled={formCApplying || !formCProviderId} data-testid="button-formc-apply">
                {formCApplying ? 'Saving…' : 'Apply'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Schedule Edit Dialog */}
        <Dialog open={!!editingSlot} onOpenChange={open => { if (!open) handleSaveEdit(); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Schedule</DialogTitle>
              <DialogDescription>
                {editingSlot && `Modifying schedule for ${getProviderName(editingSlot.providerId)} on ${editingSlot.date}`}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-6 py-4">
              <div className="space-y-4">
                <Label className="text-base">AM Shift</Label>
                <RadioGroup value={editAm} onValueChange={setEditAm} className="grid grid-cols-2 gap-4">
                  {['Patient Care', 'Admin', 'Off', 'Meeting'].map(type => (
                    <div key={`am-${type}`} className="flex items-center space-x-2">
                      <RadioGroupItem value={type} id={`am-${type}`} />
                      <Label htmlFor={`am-${type}`}>{type}</Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
              <div className="space-y-4">
                <Label className="text-base">PM Shift</Label>
                <RadioGroup value={editPm} onValueChange={setEditPm} className="grid grid-cols-2 gap-4">
                  {['Patient Care', 'Admin', 'Off', 'Meeting'].map(type => (
                    <div key={`pm-${type}`} className="flex items-center space-x-2">
                      <RadioGroupItem value={type} id={`pm-${type}`} />
                      <Label htmlFor={`pm-${type}`}>{type}</Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
              {editAssignments.length > 0 && (
                <div className="space-y-4 border-t pt-4">
                  <Label className="text-base">Assigned Staff</Label>
                  <div className="space-y-4">
                    {editAssignments.map(assignment => (
                      <div key={assignment.lvnId} className="border rounded-lg p-3 space-y-3 bg-muted/20">
                        <div className="font-medium flex items-center gap-2">
                          <Badge variant="outline">{getLvnName(assignment.lvnId)}</Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-xs">Status</Label>
                            <Select value={assignment.status} onValueChange={(v: any) => updateAssignment(assignment.lvnId, { status: v })}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Active">Active</SelectItem>
                                <SelectItem value="Sick">Sick</SelectItem>
                                <SelectItem value="Vacation">Vacation</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {assignment.status === 'Active' ? (
                            <div className="space-y-2">
                              <Label className="text-xs">Clinic / Override</Label>
                              <Select value={assignment.clinicAssignment || "none"}
                                onValueChange={v => updateAssignment(assignment.lvnId, { clinicAssignment: v === "none" ? null : v as any })}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">Assigned to Provider</SelectItem>
                                  <SelectItem value="Flu Clinic">Flu Clinic</SelectItem>
                                  <SelectItem value="Retinal AI">Retinal AI</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground">Coverage</Label>
                              <div className="text-xs text-muted-foreground italic pt-1">Use Rotations page to assign coverage</div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={handleSaveEdit} data-testid="button-save-schedule">Save & Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Staff Quick Edit Dialog */}
        <Dialog open={!!editingStaffId} onOpenChange={open => !open && setEditingStaffId(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Staff Member</DialogTitle>
              <DialogDescription>Quick edit for name and specialty</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="quick-name">Name</Label>
                <Input id="quick-name" value={editStaffName} onChange={e => setEditStaffName(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Specialty</Label>
                <Select value={editStaffSpecialty} onValueChange={(v: Specialty) => setEditStaffSpecialty(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SPECIALTIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingStaffId(null)}>Cancel</Button>
              <Button onClick={handleStaffSave}>Save Details</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Conflict Suggestion Dialog ────────────────────────────── */}
        <Dialog open={!!conflictSuggestion} onOpenChange={open => { if (!open) setConflictSuggestion(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-700">
                <AlertCircle className="w-5 h-5 shrink-0" />
                Scheduling Conflict — {conflictSuggestion?.blockedLvnName}
              </DialogTitle>
              <DialogDescription className="text-red-600 font-medium">
                {conflictSuggestion?.conflictMessage}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              {/* Suggestions */}
              {conflictSuggestion && conflictSuggestion.suggestions.length > 0 ? (
                <>
                  <p className="text-sm font-semibold text-foreground">Suggested alternatives:</p>
                  {conflictSuggestion.suggestions.map((s, i) => (
                    <div
                      key={s.lvn.id}
                      data-testid={`conflict-suggestion-${i}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {i === 0 ? '★ ' : ''}{s.lvn.name}
                        </p>
                        <p className="text-xs text-muted-foreground">{s.reason}</p>
                      </div>
                      <Button
                        size="sm"
                        className="shrink-0 h-7 text-xs"
                        data-testid={`button-conflict-autoassign-${i}`}
                        onClick={() => conflictSuggestion.onAutoAssign(s.lvn.id)}
                      >
                        Auto-assign
                      </Button>
                    </div>
                  ))}
                </>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  No qualified free LVNs — check rotations?
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 flex-wrap items-center">
              {blockSaveOnConflict ? (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-auto">
                  <Lock className="w-3.5 h-3.5 text-red-500" />
                  <span>Save blocked — choose an alternative above, or turn off <strong>Block Save</strong> to override.</span>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="button-conflict-force"
                  onClick={() => conflictSuggestion?.onForceAnyway()}
                >
                  Reassign {conflictSuggestion?.blockedLvnName} anyway
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConflictSuggestion(null)}
              >
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Validate All Dialog ───────────────────────────────────── */}
        <Dialog open={showValidateDialog} onOpenChange={setShowValidateDialog}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                Schedule Validation — Next 4 Weeks
              </DialogTitle>
              <DialogDescription>
                Scans all providers and LVNs for conflicts, overbooking, and missing coverage. Errors (red) are definite problems; warnings (amber) need review.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              {validateResults.length === 0 ? (
                <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded-lg p-4">
                  <Check className="w-5 h-5 shrink-0" />
                  <span className="text-sm font-medium">No conflicts or coverage gaps found in the next 4 weeks.</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <span className="font-medium text-red-700">{validateResults.filter(r => r.severity === 'error').length} errors</span>
                    <span>·</span>
                    <span className="font-medium text-amber-700">{validateResults.filter(r => r.severity === 'warning').length} warnings</span>
                  </div>
                  {validateResults.map((issue, i) => (
                    <div
                      key={i}
                      data-testid={`validate-issue-${i}`}
                      className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
                        issue.severity === 'error'
                          ? 'bg-red-50 border border-red-200 text-red-800'
                          : 'bg-amber-50 border border-amber-200 text-amber-800'
                      }`}
                    >
                      {issue.severity === 'error'
                        ? <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      }
                      <span>{issue.message}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
            <DialogFooter className="gap-2 flex-wrap items-center">
              {blockSaveOnConflict && validateResults.some(r => r.severity === 'error') && (
                <div className="flex items-center gap-1.5 text-xs text-red-700 mr-auto">
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                  <span>Assignments blocked until errors are resolved or Block Save is turned off.</span>
                </div>
              )}
              <Button variant="outline" size="sm" onClick={runValidateAll}>
                <RefreshCw className="w-4 h-4 mr-2" /> Re-scan
              </Button>
              <Button onClick={() => setShowValidateDialog(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
