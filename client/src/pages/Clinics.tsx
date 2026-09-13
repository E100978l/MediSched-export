import { useState, useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { format, addDays, startOfDay, parseISO, addMonths } from "date-fns";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus, Pencil, Trash2, ChevronLeft, ChevronRight,
  Lock, Unlock, Users, Clock, Calendar, AlertTriangle, Shield, Phone, Mail, AlertCircle, RefreshCw, Sparkles, CheckCircle2,
} from "lucide-react";
import { useClinics, useStaff, useUnavailability, useProviderSchedules, isClinicOpen, isStaffUnavailable, isStaffEligibleForClinic, isLvnBusyOnShift, getLvnProviderStatus } from "@/lib/store";
import { useAuth } from "@/contexts/AuthContext";
import type { SpecialClinic, ClinicAssignment, ProviderSchedule } from "@/lib/store";
import { CLINIC_NAMES } from "@shared/schema";
import { toast } from "@/hooks/use-toast";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const COLORS = ["blue", "green", "orange", "purple", "red", "teal", "yellow"];

const COLOR_CLASSES: Record<string, string> = {
  blue: "bg-blue-100 border-blue-300 text-blue-800",
  green: "bg-green-100 border-green-300 text-green-800",
  orange: "bg-orange-100 border-orange-300 text-orange-800",
  purple: "bg-purple-100 border-purple-300 text-purple-800",
  red: "bg-red-100 border-red-300 text-red-800",
  teal: "bg-teal-100 border-teal-300 text-teal-800",
  yellow: "bg-yellow-100 border-yellow-300 text-yellow-800",
};

const today = format(new Date(), "yyyy-MM-dd");
const oneMonthOut = format(addMonths(new Date(), 1), "yyyy-MM-dd");

const emptyClinic: Omit<SpecialClinic, "id"> = {
  name: "Diabetic Education",
  daysOfWeek: [1, 2, 3, 4, 5],
  startTime: "08:00",
  endTime: "17:00",
  staffNeeded: 1,
  startDate: today,
  endDate: oneMonthOut,
  isActive: true,
  color: "blue",
};

function buildCalendarDays(startDate: string, months: number): string[] {
  const start = parseISO(startDate);
  const end = addMonths(start, months);
  const days: string[] = [];
  let cur = startOfDay(start);
  while (cur <= end) {
    days.push(format(cur, "yyyy-MM-dd"));
    cur = addDays(cur, 1);
  }
  return days;
}

export default function Clinics() {
  const { clinics, overrides, assignments, isLoading, isError, refetch,
    createClinic, updateClinic, deleteClinic,
    addOverride, deleteOverride,
    addAssignment, deleteAssignment,
  } = useClinics();
  const { staff, coverageHistory, isLoading: staffLoading, isError: staffError, refetch: staffRefetch } = useStaff();
  const { unavailability, isLoading: unavailLoading, isError: unavailError, refetch: unavailRefetch } = useUnavailability();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [selectedClinic, setSelectedClinic] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<SpecialClinic | null>(null);
  const [form, setForm] = useState<Omit<SpecialClinic, "id">>(emptyClinic);
  // Tracks whether "Other" is chosen in the name dropdown — separate from form.name
  // so typing a custom name doesn't collapse the text field.
  const [isOtherClinic, setIsOtherClinic] = useState(false);
  const [calMonths, setCalMonths] = useState(1);
  const [calOffset, setCalOffset] = useState(0);
  const [showAssignDialog, setShowAssignDialog] = useState<{ date: string; clinicId: string; clinicName: string } | null>(null);
  const [assignStaffId, setAssignStaffId] = useState("");
  const [assignShift, setAssignShift] = useState<"AM" | "PM" | "Full">("Full");
  const [adminOverrideActive, setAdminOverrideActive] = useState(false);

  const clinic = clinics.find(c => c.id === selectedClinic) ?? clinics[0] ?? null;

  const calDays = useMemo(() => {
    const base = format(addMonths(new Date(), calOffset), "yyyy-MM-dd").slice(0, 7) + "-01";
    return buildCalendarDays(base, calMonths);
  }, [calOffset, calMonths]);

  // Fetch persisted provider schedule data for the visible calendar window.
  // This allows checking whether a provider is off/admin/meeting on a given day.
  const scheduleStart = calDays[0] ?? format(new Date(), "yyyy-MM-dd");
  const scheduleEnd = calDays[calDays.length - 1] ?? scheduleStart;
  const { schedules: providerSchedules, isLoading: providerSchedulesLoading, isError: providerSchedulesError, refetch: providerSchedulesRefetch } = useProviderSchedules(scheduleStart, scheduleEnd);

  const combinedLoading = isLoading || staffLoading || unavailLoading || providerSchedulesLoading;
  const combinedError = isError || staffError || unavailError || providerSchedulesError;

  function openCreate() {
    setEditTarget(null);
    setForm({ ...emptyClinic });
    setIsOtherClinic(false);
    setShowForm(true);
  }

  function openEdit(c: SpecialClinic) {
    setEditTarget(c);
    // If the stored name isn't a known preset, treat it as a custom "Other" name.
    const isOther = !CLINIC_NAMES.includes(c.name as any);
    setIsOtherClinic(isOther);
    setForm({
      name: c.name,
      daysOfWeek: (c.daysOfWeek as number[]) ?? [1,2,3,4,5],
      startTime: c.startTime,
      endTime: c.endTime,
      staffNeeded: c.staffNeeded,
      startDate: c.startDate,
      endDate: c.endDate,
      isActive: c.isActive ?? true,
      color: c.color ?? "blue",
    });
    setShowForm(true);
  }

  async function saveClinic() {
    if (editTarget) {
      await updateClinic({ id: editTarget.id, ...form });
    } else {
      const created = await createClinic(form);
      setSelectedClinic(created.id);
    }
    setShowForm(false);
  }

  function toggleDay(d: number) {
    const days = (form.daysOfWeek as number[]) ?? [];
    setForm(f => ({
      ...f,
      daysOfWeek: days.includes(d) ? days.filter(x => x !== d) : [...days, d].sort(),
    }));
  }

  async function toggleDayOverride(date: string, clinicId: string) {
    const existing = overrides.find(o => o.clinicId === clinicId && o.date === date);
    if (existing) {
      await deleteOverride(existing.id);
    } else {
      await addOverride({ clinicId, date, isClosed: true, note: "Manually closed" });
    }
  }

  // Eligible staff for clinic assignment — filtered by cross-training for the clinic type.
  // Uses isLvnBusyOnShift for shift-aware conflict detection and getLvnProviderStatus
  // to surface which LVNs are needed by their provider on this date.
  function getEligibleStaff(date: string, clinicName: string, clinicId: string, shift: 'AM' | 'PM' | 'Full') {
    const assignedToThisClinic = assignments.filter(a => a.date === date && a.clinicId === clinicId).map(a => a.staffId);

    // Special clinics (Flu Clinic, Retinal AI, Nurse Visits, etc.) use LVN/Pharmacist staff only.
    // RNs are excluded from special clinic assignments per union rules.
    const isClinicalRole = (s: typeof staff[number]) =>
      s.role === 'LVN' || s.role === 'Pharmacist';

    // Staff eligible for this specific clinic (cross-trained or primary specialty matches)
    const eligibleRegular = staff.filter(s =>
      isClinicalRole(s) &&
      !s.isFloatPool &&
      isStaffEligibleForClinic(s, clinicName)
    );

    // If no one is cross-trained, fall back to all eligible clinical staff (still no RNs)
    const regularPool = eligibleRegular.length > 0
      ? eligibleRegular
      : staff.filter(s => isClinicalRole(s) && !s.isFloatPool);

    // Hard-blocked: shift conflict with another clinic assignment OR provider has confirmed Patient Care
    const blocked: { staff: typeof regularPool[number]; reason: string }[] = [];
    // Hard-blocked (confirmed provider-care): LVN's provider has an explicit DB record showing Patient Care
    const providerCareWarning: { staff: typeof regularPool[number]; providerName: string }[] = [];
    // Soft warning: provider schedule unconfirmed (no DB record exists, defaults assumed)
    const providerUnconfirmedWarning: { staff: typeof regularPool[number]; providerName: string }[] = [];

    // Helper: does ANY of this LVN's providers have an explicit DB record that shows Patient Care
    // on the specific shift being checked? This is the correct guard for a hard block —
    // a provider that has no record at all just defaults to "Patient Care" as a conservative
    // assumption, but that default is NOT a confirmed conflict.
    const hasExplicitPatientCare = (lvnId: string): boolean => {
      const lvn = staff.find(s => s.id === lvnId);
      if (!lvn?.assignedTo?.length) return false;
      return (lvn.assignedTo as string[]).some(pid => {
        const schedule = providerSchedules.find(ps => ps.providerId === pid && ps.date === date);
        if (!schedule) return false; // no record → default, not confirmed
        if (shift === 'AM') return schedule.am === 'Patient Care';
        if (shift === 'PM') return schedule.pm === 'Patient Care';
        return schedule.am === 'Patient Care' || schedule.pm === 'Patient Care';
      });
    };

    const available = regularPool.filter(s => {
      if (assignedToThisClinic.includes(s.id)) return false; // already in this clinic
      if (isStaffUnavailable(unavailability, s.id, date)) return false; // on vacation/sick
      // Use isLvnBusyOnShift as the single source of truth for shift conflicts
      const busy = isLvnBusyOnShift(s.id, date, shift, { clinicAssignments: assignments, excludeClinicId: clinicId });
      if (busy.busy) {
        blocked.push({ staff: s, reason: busy.detail ?? 'Shift conflict' });
        return false;
      }
      // Shift-aware provider Patient Care check — only hard-block when there is an explicit
      // saved schedule record that actually shows Patient Care on this shift.
      // Providers with no record at all default conservatively to Patient Care, but that
      // default is unconfirmed and should only produce a soft warning, not a hard block.
      const provStatus = getLvnProviderStatus(s, date, { staff, providerSchedules });
      const providerHasCareThisShift =
        shift === 'AM' ? provStatus.am === 'Patient Care' :
        shift === 'PM' ? provStatus.pm === 'Patient Care' :
        provStatus.am === 'Patient Care' || provStatus.pm === 'Patient Care';
      if (providerHasCareThisShift && provStatus.providerName) {
        if (hasExplicitPatientCare(s.id)) {
          // At least one provider has an explicit DB record showing Patient Care — hard block
          providerCareWarning.push({ staff: s, providerName: provStatus.providerName });
          return false;
        } else {
          // Patient Care comes from default (no DB record) — schedule unconfirmed, soft warning
          providerUnconfirmedWarning.push({ staff: s, providerName: provStatus.providerName });
          return true;
        }
      }
      return true;
    });

    // If all regular are truly available (not just provider-care blocked), allow float pool fallback
    // Provider-care-blocked staff are hard-unavailable, so float pool should activate when available is empty
    const allRegularBusy = available.length === 0;
    // Helper to check float staff eligibility (shared between both float filters)
    const isFloatEligible = (s: typeof staff[number], requireSpecialty: boolean) => {
      if (!isClinicalRole(s) || !s.isFloatPool) return false;
      if (assignedToThisClinic.includes(s.id)) return false;
      if (isStaffUnavailable(unavailability, s.id, date)) return false;
      if (requireSpecialty && !isStaffEligibleForClinic(s, clinicName)) return false;
      const busy = isLvnBusyOnShift(s.id, date, shift, { clinicAssignments: assignments, excludeClinicId: clinicId });
      if (busy.busy) return false;
      // Apply same confirmed-Patient-Care hard-stop as regular staff (unconfirmed = allow).
      // Only hard-block when there is an explicit DB record showing Patient Care on this shift —
      // not when Patient Care comes from the default (no record saved yet).
      if (hasExplicitPatientCare(s.id)) return false;
      return true;
    };

    const floatPool = allRegularBusy ? staff.filter(s => isFloatEligible(s, true)) : [];

    // If float pool is also empty with cross-training filter, show any float pool staff
    const anyFloatPool = floatPool.length === 0 && allRegularBusy
      ? staff.filter(s => isFloatEligible(s, false))
      : floatPool;

    return { available, floatPool: anyFloatPool, allRegularBusy, alreadyAssigned: assignedToThisClinic, blocked, providerCareWarning, providerUnconfirmedWarning };
  }

  // ── LVN Suggestion Engine ─────────────────────────────────────────────────
  // Priority: 1) Primary rotation (specialty match, non-float, lowest moves)
  //           2) Cross-trained regular (non-float, lowest moves)
  //           3) Float pool eligible (lowest moves)
  //           → Warning if none found
  type ClinicLvnSuggestion = {
    staff: typeof staff[number];
    label: 'Recommended' | 'Alternative' | 'Float Pool';
    reason: string;
    moveCount: number;
  };

  function computeClinicSuggestion(
    date: string,
    clinicName: string,
    clinicId: string,
    shift: 'AM' | 'PM' | 'Full'
  ): { primary: ClinicLvnSuggestion | null; alternative: ClinicLvnSuggestion | null; warning: string | null } {
    const monthPrefix = date.slice(0, 7);

    // Move count = coverage records + clinic assignments this month (equity metric)
    const moveCount = (staffId: string) =>
      coverageHistory.filter(r => r.staffId === staffId && r.date.startsWith(monthPrefix)).length +
      assignments.filter(a => a.staffId === staffId && a.date.startsWith(monthPrefix) && a.clinicId !== clinicId).length;

    const isClinicalRole = (s: typeof staff[number]) => s.role === 'LVN' || s.role === 'Pharmacist';

    const isAvailableForSlot = (s: typeof staff[number]) => {
      if (isStaffUnavailable(unavailability, s.id, date)) return false;
      // Already assigned to this same clinic on this date
      if (assignments.some(a => a.date === date && a.clinicId === clinicId && a.staffId === s.id)) return false;
      // Shift conflict with any other clinic on the same day (cross-clinic double-booking)
      const busy = isLvnBusyOnShift(s.id, date, shift, { clinicAssignments: assignments, excludeClinicId: clinicId });
      if (busy.busy) return false;
      return true;
    };

    // Tier 1 — primary rotation: specialty === clinicName, non-float, available
    const tier1 = staff
      .filter(s => isClinicalRole(s) && !s.isFloatPool && s.specialty === clinicName && isAvailableForSlot(s))
      .sort((a, b) => moveCount(a.id) - moveCount(b.id));

    if (tier1.length > 0) {
      const pick = tier1[0];
      const mc = moveCount(pick.id);
      return {
        primary: {
          staff: pick,
          label: 'Recommended',
          reason: `Primary Rotation — Available (${mc} move${mc !== 1 ? 's' : ''} this month)`,
          moveCount: mc,
        },
        alternative: null,
        warning: null,
      };
    }

    // Tier 2 — cross-trained regular (non-float), available, lowest moves
    const tier2 = staff
      .filter(s =>
        isClinicalRole(s) && !s.isFloatPool &&
        (s.crossTrained ?? []).includes(clinicName as typeof s.specialty) &&
        isAvailableForSlot(s)
      )
      .sort((a, b) => moveCount(a.id) - moveCount(b.id));

    if (tier2.length > 0) {
      const pick = tier2[0];
      const mc = moveCount(pick.id);
      return {
        primary: null,
        alternative: {
          staff: pick,
          label: 'Alternative',
          reason: `Cross-trained, ${mc} move${mc !== 1 ? 's' : ''} this month`,
          moveCount: mc,
        },
        warning: null,
      };
    }

    // Tier 3 — float pool, eligible (primary specialty or cross-trained), available, lowest moves
    const tier3 = staff
      .filter(s =>
        isClinicalRole(s) && s.isFloatPool &&
        isStaffEligibleForClinic(s, clinicName) &&
        isAvailableForSlot(s)
      )
      .sort((a, b) => moveCount(a.id) - moveCount(b.id));

    if (tier3.length > 0) {
      const pick = tier3[0];
      const mc = moveCount(pick.id);
      return {
        primary: null,
        alternative: {
          staff: pick,
          label: 'Float Pool',
          reason: `Float/Extra Help — ${mc} move${mc !== 1 ? 's' : ''} this month (lowest equity score)`,
          moveCount: mc,
        },
        warning: null,
      };
    }

    return {
      primary: null,
      alternative: null,
      warning: 'No available qualified LVN — consider float pool or reschedule',
    };
  }

  async function handleAssign() {
    if (!showAssignDialog || !assignStaffId) return;
    const member = staff.find(s => s.id === assignStaffId);
    if (!member) return;
    try {
      await addAssignment({
        clinicId: showAssignDialog.clinicId,
        clinicName: showAssignDialog.clinicName,
        date: showAssignDialog.date,
        staffId: member.id,
        staffName: member.name,
        staffRole: member.role,
        shift: assignShift,
      });
      setShowAssignDialog(null);
      setAssignStaffId("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to assign staff";
      toast({ title: "Scheduling Conflict", description: msg, variant: "destructive" });
    }
  }

  const dayAssignments = (date: string, clinicId: string): ClinicAssignment[] =>
    assignments.filter(a => a.date === date && a.clinicId === clinicId);

  if (combinedLoading) {
    return (
      <AppLayout>
        <div className="p-8 flex items-center justify-center min-h-[50vh]" data-testid="clinics-loading">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            <p className="text-sm">Loading clinics data…</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (combinedError) {
    return (
      <AppLayout>
        <div className="p-8 flex items-center justify-center min-h-[50vh]" data-testid="clinics-error">
          <div className="flex flex-col items-center gap-3 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="font-medium">Failed to load clinics data</p>
            <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
            <Button variant="outline" size="sm" onClick={() => { refetch(); staffRefetch(); unavailRefetch(); providerSchedulesRefetch(); }}>
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
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Special Clinics</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage clinic schedules, coverage needs, and daily assignments
          </p>
        </div>
        <Button onClick={openCreate} data-testid="button-add-clinic">
          <Plus className="h-4 w-4 mr-2" /> Add Clinic
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <div className="grid grid-cols-12 gap-6">
          {/* Clinic list */}
          <div className="col-span-3 space-y-2">
            {clinics.length === 0 && (
              <p className="text-sm text-muted-foreground">No clinics yet. Add one to get started.</p>
            )}
            {clinics.map(c => (
              <Card
                key={c.id}
                data-testid={`card-clinic-${c.id}`}
                className={`cursor-pointer border-2 transition-colors ${selectedClinic === c.id || (!selectedClinic && clinics[0]?.id === c.id) ? "border-primary" : "border-transparent hover:border-muted"}`}
                onClick={() => setSelectedClinic(c.id)}
              >
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.startTime}–{c.endTime}</p>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {((c.daysOfWeek as number[]) ?? []).map(d => (
                          <span key={d} className="text-xs bg-secondary rounded px-1">{DAYS[d]}</span>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={e => { e.stopPropagation(); openEdit(c); }} data-testid={`button-edit-clinic-${c.id}`}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={e => { e.stopPropagation(); deleteClinic(c.id); }} data-testid={`button-delete-clinic-${c.id}`}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2 items-center">
                    <Badge variant={c.isActive ? "default" : "secondary"} className="text-xs">
                      {c.isActive ? "Active" : "Inactive"}
                    </Badge>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Users className="h-3 w-3" /> {c.staffNeeded} needed
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Calendar view */}
          <div className="col-span-9">
            {clinic ? (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <span className={`inline-block w-3 h-3 rounded-full bg-${clinic.color ?? 'blue'}-500`} />
                      {clinic.name} — Calendar
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs">Months:</Label>
                      <Select value={String(calMonths)} onValueChange={v => setCalMonths(Number(v))}>
                        <SelectTrigger className="w-16 h-7 text-xs" data-testid="select-cal-months">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[1,2,3].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setCalOffset(o => o - 1)}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setCalOffset(o => o + 1)}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex gap-4 text-xs text-muted-foreground mt-1">
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{clinic.startTime}–{clinic.endTime}</span>
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" />Staff needed: {clinic.staffNeeded}</span>
                    <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{clinic.startDate} → {clinic.endDate}</span>
                  </div>
                </CardHeader>
                <CardContent>
                  {/* Day grid header */}
                  <div className="grid grid-cols-7 gap-1 mb-1">
                    {DAYS.map(d => (
                      <div key={d} className="text-center text-xs font-medium text-muted-foreground">{d}</div>
                    ))}
                  </div>

                  {/* Build weeks */}
                  {(() => {
                    if (calDays.length === 0) return null;
                    const firstDate = parseISO(calDays[0]);
                    const startDow = firstDate.getDay();
                    const cells: (string | null)[] = Array(startDow).fill(null).concat(calDays);
                    while (cells.length % 7 !== 0) cells.push(null);
                    const weeks: (string | null)[][] = [];
                    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

                    return weeks.map((week, wi) => (
                      <div key={wi} className="grid grid-cols-7 gap-1 mb-1">
                        {week.map((date, di) => {
                          if (!date) return <div key={di} className="min-h-[80px]" />;
                          const open = isClinicOpen(clinic, overrides, date);
                          const override = overrides.find(o => o.clinicId === clinic.id && o.date === date);
                          const dayAssigns = dayAssignments(date, clinic.id);
                          const needed = clinic.staffNeeded;
                          const filled = dayAssigns.length;
                          const isToday = date === today;
                          const isPast = date < today;

                          return (
                            <div
                              key={date}
                              data-testid={`cell-clinic-${date}`}
                              className={`min-h-[80px] border rounded p-1 text-xs relative ${
                                open
                                  ? filled >= needed
                                    ? "bg-green-50 border-green-300"
                                    : "bg-yellow-50 border-yellow-300"
                                  : isPast
                                  ? "bg-muted/30 border-muted"
                                  : "bg-red-50/50 border-red-200"
                              } ${isToday ? "ring-2 ring-primary" : ""}`}
                            >
                              <div className="flex justify-between items-start">
                                <span className={`font-medium ${isToday ? "text-primary" : ""}`}>
                                  {format(parseISO(date), "d")}
                                </span>
                                {!isPast && (
                                  <button
                                    onClick={() => toggleDayOverride(date, clinic.id)}
                                    title={open ? "Close this day" : "Reopen this day"}
                                    data-testid={`button-toggle-day-${date}`}
                                    className="text-muted-foreground hover:text-foreground"
                                  >
                                    {override ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3 opacity-30" />}
                                  </button>
                                )}
                              </div>

                              {open ? (
                                <>
                                  {dayAssigns.map(a => (
                                    <div key={a.id} className="flex items-center justify-between bg-white/80 rounded px-1 mb-0.5">
                                      <span className="truncate">{a.staffName}</span>
                                      <button onClick={() => deleteAssignment(a.id)} className="text-destructive hover:opacity-80 ml-1" data-testid={`button-remove-assign-${a.id}`}>×</button>
                                    </div>
                                  ))}
                                  {filled < needed && !isPast && (
                                    <button
                                      onClick={() => { setShowAssignDialog({ date, clinicId: clinic.id, clinicName: clinic.name }); setAssignStaffId(""); }}
                                      className="w-full mt-0.5 text-center border border-dashed border-muted-foreground/50 rounded text-muted-foreground hover:border-primary hover:text-primary py-0.5"
                                      data-testid={`button-assign-${date}`}
                                    >
                                      + Assign
                                    </button>
                                  )}
                                  <div className={`text-center text-xs mt-0.5 ${filled >= needed ? "text-green-600" : "text-yellow-700"}`}>
                                    {filled}/{needed}
                                  </div>
                                </>
                              ) : (
                                <div className="text-center text-muted-foreground/60 mt-2">
                                  {override ? "Closed" : "Not scheduled"}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ));
                  })()}
                </CardContent>
              </Card>
            ) : (
              <div className="flex items-center justify-center h-64 text-muted-foreground">
                Select or create a clinic to see its calendar
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create/Edit dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg" data-testid="dialog-clinic-form">
          <DialogHeader>
            <DialogTitle>{editTarget ? "Edit Clinic" : "Add Clinic"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Clinic Name</Label>
              <Select
                value={isOtherClinic ? "Other" : form.name}
                onValueChange={v => {
                  if (v === "Other") {
                    setIsOtherClinic(true);
                    setForm(f => ({ ...f, name: "" }));
                  } else {
                    setIsOtherClinic(false);
                    setForm(f => ({ ...f, name: v }));
                  }
                }}
                data-testid="select-clinic-name"
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLINIC_NAMES.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
              {isOtherClinic && (
                <Input
                  className="mt-1"
                  placeholder="Enter custom clinic name"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  data-testid="input-clinic-name-custom"
                  autoFocus
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start Date</Label>
                <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} data-testid="input-clinic-start-date" />
              </div>
              <div>
                <Label>End Date</Label>
                <Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} data-testid="input-clinic-end-date" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Open Time</Label>
                <Input type="time" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} data-testid="input-clinic-start-time" />
              </div>
              <div>
                <Label>Close Time</Label>
                <Input type="time" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} data-testid="input-clinic-end-time" />
              </div>
            </div>

            <div>
              <Label>Days of Week</Label>
              <div className="flex gap-2 mt-1">
                {DAYS.map((d, i) => {
                  const sel = ((form.daysOfWeek as number[]) ?? []).includes(i);
                  return (
                    <button
                      key={i}
                      onClick={() => toggleDay(i)}
                      data-testid={`button-day-${d}`}
                      className={`px-2 py-1 rounded text-sm font-medium border ${sel ? "bg-primary text-primary-foreground border-primary" : "border-muted-foreground/30"}`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Staff Needed</Label>
                <Input type="number" min={1} max={10} value={form.staffNeeded} onChange={e => setForm(f => ({ ...f, staffNeeded: Number(e.target.value) }))} data-testid="input-clinic-staff-needed" />
              </div>
              <div>
                <Label>Color</Label>
                <Select value={form.color ?? "blue"} onValueChange={v => setForm(f => ({ ...f, color: v }))} data-testid="select-clinic-color">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COLORS.map(c => (
                      <SelectItem key={c} value={c}>
                        <span className="flex items-center gap-2">
                          <span className={`inline-block w-3 h-3 rounded-full bg-${c}-500`} />
                          {c.charAt(0).toUpperCase() + c.slice(1)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isActive"
                checked={form.isActive ?? true}
                onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                data-testid="checkbox-clinic-active"
              />
              <Label htmlFor="isActive">Active (visible in calendar)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={saveClinic} data-testid="button-save-clinic">Save Clinic</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign staff dialog */}
      {showAssignDialog && (() => {
        const { available, floatPool, allRegularBusy, blocked, providerCareWarning, providerUnconfirmedWarning } = getEligibleStaff(showAssignDialog.date, showAssignDialog.clinicName, showAssignDialog.clinicId, assignShift);
        return (
          <Dialog open={true} onOpenChange={() => { setShowAssignDialog(null); setAdminOverrideActive(false); setAssignStaffId(""); }}>
            <DialogContent data-testid="dialog-assign-staff">
              <DialogHeader>
                <DialogTitle>
                  Assign Staff — {showAssignDialog.clinicName}
                  <span className="text-sm font-normal text-muted-foreground ml-2">
                    {format(parseISO(showAssignDialog.date), "EEE MMM d, yyyy")}
                  </span>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {/* Shift selector — pick shift first so available list updates */}
                <div>
                  <Label>Shift</Label>
                  <div className="flex gap-2 mt-1">
                    {(["AM", "PM", "Full"] as const).map(s => (
                      <button
                        key={s}
                        onClick={() => { setAssignShift(s); setAssignStaffId(""); setAdminOverrideActive(false); }}
                        data-testid={`button-shift-${s}`}
                        className={`px-3 py-1 rounded border text-sm ${assignShift === s ? "bg-primary text-primary-foreground border-primary" : "border-muted-foreground/30"}`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── LVN Suggestion Banner ─────────────────────────────── */}
                {(() => {
                  const suggestion = computeClinicSuggestion(
                    showAssignDialog.date, showAssignDialog.clinicName,
                    showAssignDialog.clinicId, assignShift
                  );
                  const pick = suggestion.primary ?? suggestion.alternative;
                  const isRecommended = !!suggestion.primary;
                  return (
                    <>
                      {pick && (
                        <div className={`flex items-start gap-3 p-3 rounded-md border text-sm ${
                          isRecommended
                            ? "bg-green-50 border-green-200"
                            : "bg-blue-50 border-blue-200"
                        }`}>
                          <Sparkles className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                            isRecommended ? "text-green-600" : "text-blue-600"
                          }`} />
                          <div className="flex-1 min-w-0">
                            <p className={`font-semibold text-sm ${
                              isRecommended ? "text-green-800" : "text-blue-800"
                            }`}>
                              {pick.label}: {pick.staff.name}{" "}
                              <span className="font-normal">({pick.staff.role})</span>
                            </p>
                            <p className={`text-xs mt-0.5 ${
                              isRecommended ? "text-green-700" : "text-blue-700"
                            }`}>
                              {pick.reason}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setAssignStaffId(pick.staff.id)}
                            data-testid="button-use-suggestion"
                            className={`flex-shrink-0 flex items-center gap-1 text-xs px-2.5 py-1 rounded border font-medium transition-colors ${
                              assignStaffId === pick.staff.id
                                ? isRecommended
                                  ? "bg-green-600 text-white border-green-700"
                                  : "bg-blue-600 text-white border-blue-700"
                                : isRecommended
                                  ? "bg-white border-green-400 text-green-800 hover:bg-green-100"
                                  : "bg-white border-blue-400 text-blue-800 hover:bg-blue-100"
                            }`}
                          >
                            {assignStaffId === pick.staff.id
                              ? <><CheckCircle2 className="w-3 h-3" /> Selected</>
                              : "Use Suggestion"
                            }
                          </button>
                        </div>
                      )}
                      {suggestion.warning && (
                        <div className="flex items-center gap-2 p-3 rounded-md border bg-amber-50 border-amber-200 text-sm text-amber-800">
                          <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-500" />
                          <span>{suggestion.warning}</span>
                        </div>
                      )}
                    </>
                  );
                })()}

                {allRegularBusy && floatPool.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-800">
                    All regular staff are assigned. Showing float pool staff.
                  </div>
                )}
                {allRegularBusy && floatPool.length === 0 && available.length === 0 && (
                  <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-800">
                    All regular and float pool staff are unavailable for this shift.
                  </div>
                )}

                <div>
                  <Label>Staff Member</Label>
                  <div className="mt-2 space-y-1 max-h-52 overflow-y-auto">
                    {[...available, ...floatPool].filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i).map(s => {
                      const isPrimary = s.specialty === showAssignDialog.clinicName;
                      const isCrossTrained = !isPrimary && (s.crossTrained ?? []).includes(showAssignDialog.clinicName as typeof s.specialty);
                      return (
                        <label
                          key={s.id}
                          className={`flex items-center gap-2 p-2 rounded border cursor-pointer ${assignStaffId === s.id ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/50"}`}
                          data-testid={`option-staff-${s.id}`}
                        >
                          <input type="radio" name="assign-staff" value={s.id} checked={assignStaffId === s.id} onChange={() => setAssignStaffId(s.id)} className="accent-primary" />
                          <span className="font-medium text-sm">{s.name}</span>
                          <Badge variant="outline" className="text-xs">{s.role}</Badge>
                          {isPrimary && <Badge className="text-xs bg-green-100 text-green-800 border-green-300">Primary</Badge>}
                          {isCrossTrained && <Badge className="text-xs bg-blue-100 text-blue-800 border-blue-300">Cross-trained</Badge>}
                          {s.isFloatPool && <Badge variant="secondary" className="text-xs">Float</Badge>}
                          <span className="text-xs text-muted-foreground ml-auto">{s.specialty}</span>
                        </label>
                      );
                    })}
                    {available.length === 0 && floatPool.length === 0 && blocked.length === 0 && providerCareWarning.length === 0 && providerUnconfirmedWarning.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-3">No eligible staff available — assign cross-training on the Staff page</p>
                    )}

                    {/* Unconfirmed schedule — assignable but provider schedule not saved to DB yet */}
                    {providerUnconfirmedWarning.length > 0 && (
                      <div className="pt-1 pb-1">
                        <p className="text-xs text-muted-foreground italic flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-yellow-400" />
                          Provider schedule unconfirmed for some staff — they remain assignable but verify with Schedule page
                        </p>
                      </div>
                    )}

                    {/* Provider-care blocked — admin can override */}
                    {providerCareWarning.length > 0 && (
                      <>
                        <div className="pt-2 pb-1 flex items-center justify-between">
                          <p className="text-xs font-medium text-amber-700 uppercase tracking-wide flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 text-amber-500" />
                            Provider in Patient Care — unavailable this shift
                          </p>
                          {isAdmin && (
                            <button
                              onClick={() => { setAdminOverrideActive(v => !v); setAssignStaffId(""); }}
                              data-testid="button-admin-override"
                              className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded border font-medium transition-colors ${
                                adminOverrideActive
                                  ? "bg-purple-600 text-white border-purple-700"
                                  : "bg-purple-50 text-purple-700 border-purple-300 hover:bg-purple-100"
                              }`}
                            >
                              <Shield className="w-3 h-3" />
                              {adminOverrideActive ? "Override Active" : "Admin Override"}
                            </button>
                          )}
                        </div>
                        {providerCareWarning.map(({ staff: s, providerName }) => (
                          adminOverrideActive && isAdmin ? (
                            <label
                              key={s.id}
                              className={`flex items-center gap-2 p-2 rounded border cursor-pointer ${assignStaffId === s.id ? "border-purple-500 bg-purple-50" : "border-purple-200 hover:bg-purple-50/50"}`}
                              data-testid={`option-override-care-${s.id}`}
                            >
                              <input type="radio" name="assign-staff" value={s.id} checked={assignStaffId === s.id} onChange={() => setAssignStaffId(s.id)} className="accent-purple-600" />
                              <span className="font-medium text-sm">{s.name}</span>
                              <Badge variant="outline" className="text-xs">{s.role}</Badge>
                              <Badge className="text-xs bg-purple-100 text-purple-800 border-purple-300">Override</Badge>
                              <span className="text-xs text-amber-700 ml-auto">Provider: {providerName}</span>
                              {s.phone && <a href={`tel:${s.phone}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1 text-xs text-blue-600 hover:underline"><Phone className="w-3 h-3" />{s.phone}</a>}
                              {s.email && <a href={`mailto:${s.email}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1 text-xs text-blue-600 hover:underline"><Mail className="w-3 h-3" />{s.email}</a>}
                            </label>
                          ) : (
                            <div
                              key={s.id}
                              className="flex items-center gap-2 p-2 rounded border border-dashed border-amber-200 bg-amber-50/30 opacity-60 cursor-not-allowed"
                              data-testid={`option-provider-care-${s.id}`}
                              title={`${s.name}'s provider (${providerName}) has Patient Care this shift — use Admin Override to force-assign`}
                            >
                              <span className="w-4 h-4 flex items-center justify-center">
                                <AlertTriangle className="w-3 h-3 text-amber-500" />
                              </span>
                              <span className="font-medium text-sm">{s.name}</span>
                              <Badge variant="outline" className="text-xs">{s.role}</Badge>
                              <span className="text-xs text-amber-700 ml-auto">Provider: {providerName}</span>
                            </div>
                          )
                        ))}
                      </>
                    )}

                    {/* Blocked staff — shift conflict; admin can override */}
                    {blocked.length > 0 && (
                      <>
                        <div className="pt-2 pb-1 flex items-center justify-between">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 text-orange-500" />
                            Already assigned — {assignShift} shift conflict
                          </p>
                          {isAdmin && !adminOverrideActive && (
                            <button
                              onClick={() => { setAdminOverrideActive(true); setAssignStaffId(""); }}
                              data-testid="button-admin-override-blocked"
                              className="flex items-center gap-1 text-xs px-2 py-0.5 rounded border font-medium bg-purple-50 text-purple-700 border-purple-300 hover:bg-purple-100"
                            >
                              <Shield className="w-3 h-3" />
                              Admin Override
                            </button>
                          )}
                        </div>
                        {blocked.map(({ staff: s, reason }) => (
                          adminOverrideActive && isAdmin ? (
                            <label
                              key={s.id}
                              className={`flex items-center gap-2 p-2 rounded border cursor-pointer ${assignStaffId === s.id ? "border-purple-500 bg-purple-50" : "border-purple-200 hover:bg-purple-50/50"}`}
                              data-testid={`option-override-blocked-${s.id}`}
                            >
                              <input type="radio" name="assign-staff" value={s.id} checked={assignStaffId === s.id} onChange={() => setAssignStaffId(s.id)} className="accent-purple-600" />
                              <span className="font-medium text-sm">{s.name}</span>
                              <Badge variant="outline" className="text-xs">{s.role}</Badge>
                              <Badge className="text-xs bg-purple-100 text-purple-800 border-purple-300">Override</Badge>
                              <span className="text-xs text-orange-700 ml-auto">Was in {reason}</span>
                              {s.phone && <a href={`tel:${s.phone}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1 text-xs text-blue-600 hover:underline"><Phone className="w-3 h-3" />{s.phone}</a>}
                              {s.email && <a href={`mailto:${s.email}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1 text-xs text-blue-600 hover:underline"><Mail className="w-3 h-3" />{s.email}</a>}
                            </label>
                          ) : (
                            <div
                              key={s.id}
                              className="flex items-center gap-2 p-2 rounded border border-dashed border-orange-200 bg-orange-50/50 opacity-60 cursor-not-allowed"
                              data-testid={`option-blocked-${s.id}`}
                              title={`Blocked: assigned to ${reason}${isAdmin ? " — use Admin Override to force-assign" : ""}`}
                            >
                              <span className="w-4 h-4 flex items-center justify-center">
                                <AlertTriangle className="w-3 h-3 text-orange-500" />
                              </span>
                              <span className="font-medium text-sm">{s.name}</span>
                              <Badge variant="outline" className="text-xs">{s.role}</Badge>
                              <span className="text-xs text-orange-700 ml-auto">In {reason}</span>
                            </div>
                          )
                        ))}
                      </>
                    )}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setShowAssignDialog(null); setAdminOverrideActive(false); }}>Cancel</Button>
                <Button
                  disabled={!assignStaffId}
                  onClick={handleAssign}
                  data-testid="button-confirm-assign"
                  className={adminOverrideActive ? "bg-purple-600 hover:bg-purple-700" : ""}
                >
                  {adminOverrideActive ? <><Shield className="w-4 h-4 mr-2" />Force Assign (Override)</> : "Assign"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}
    </div>
    </AppLayout>
  );
}
