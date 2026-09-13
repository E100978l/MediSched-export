import { useState, useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useStaff, useUnavailability, useCallAvailability, useShiftDistributionLog } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CalendarOff, Plus, Trash2, AlertTriangle, Plane, Heart, Search,
  CalendarDays, Users, Phone, Mail, ChevronLeft, ChevronRight,
  BarChart3, CheckCircle2, X,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  format, parseISO, addDays, eachDayOfInterval, isWeekend,
  startOfMonth, endOfMonth, addMonths, getDay, getDaysInMonth,
} from "date-fns";
import { DayPicker } from "react-day-picker";
import type { DateRange } from "react-day-picker";
import "react-day-picker/style.css";
import { EMPLOYMENT_PRIORITY, type EmploymentType } from "@shared/schema";

const TYPE_CONFIG = {
  Vacation: { label: "Vacation", icon: Plane, color: "bg-blue-500/15 text-blue-700 border-blue-200" },
  Sick: { label: "Sick Leave", icon: AlertTriangle, color: "bg-red-500/15 text-red-700 border-red-200" },
  FMLA: { label: "FMLA", icon: Heart, color: "bg-purple-500/15 text-purple-700 border-purple-200" },
  Leave: { label: "Leave", icon: CalendarOff, color: "bg-amber-500/15 text-amber-700 border-amber-200" },
} as const;

const SHIFT_CONFIG = {
  Full: { label: "Full Day", color: "bg-green-500/15 text-green-700 border-green-200" },
  AM: { label: "AM Only", color: "bg-sky-500/15 text-sky-700 border-sky-200" },
  PM: { label: "PM Only", color: "bg-violet-500/15 text-violet-700 border-violet-200" },
} as const;

const EMPLOYMENT_BADGE: Record<EmploymentType, string> = {
  "Full-time": "bg-gray-100 text-gray-700 border-gray-200",
  "Part-time": "bg-blue-50 text-blue-700 border-blue-200",
  "Per Diem": "bg-amber-50 text-amber-700 border-amber-200",
  "Extra Help": "bg-orange-50 text-orange-700 border-orange-200",
};

const PRIORITY_LABEL: Record<EmploymentType, string> = {
  "Full-time": "Coded (Full-time)",
  "Part-time": "Coded (Part-time) — Preferred",
  "Per Diem": "Per Diem",
  "Extra Help": "Extra Help",
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Sort nurse availability entries by employment priority (Part-time coded first)
function sortByEmploymentPriority<T extends { staffId: string }>(
  records: T[],
  getEmploymentType: (staffId: string) => EmploymentType | undefined
): T[] {
  return [...records].sort((a, b) => {
    const pa = EMPLOYMENT_PRIORITY[getEmploymentType(a.staffId) ?? "Full-time"] ?? 0;
    const pb = EMPLOYMENT_PRIORITY[getEmploymentType(b.staffId) ?? "Full-time"] ?? 0;
    return pa - pb;
  });
}

export default function Availability() {
  const { staff, isLoading: staffLoading, isError: staffError, refetch: staffRefetch } = useStaff();
  const { unavailability, addUnavailability, updateUnavailability, deleteUnavailability, isLoading: unavailLoading, isError: unavailError, refetch: unavailRefetch } = useUnavailability();
  const { callAvailability, addCallAvailability, deleteCallAvailability, isLoading: callLoading, isError: callError, refetch: callRefetch } = useCallAvailability();
  const { shiftLog, addShiftLog, deleteShiftLog, isLoading: shiftLoading, isError: shiftError, refetch: shiftRefetch } = useShiftDistributionLog();

  // ── Absences tab state ───────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("absences");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [staffSearch, setStaffSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterRole, setFilterRole] = useState<string>("all");

  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [range, setRange] = useState<DateRange | undefined>();
  const [excludedDates, setExcludedDates] = useState<string[]>([]);
  const [unavailType, setUnavailType] = useState<"Vacation" | "Sick" | "FMLA" | "Leave">("Vacation");
  const [note, setNote] = useState("");
  const [managingId, setManagingId] = useState<string | null>(null);

  // ── Call Availability tab state ──────────────────────────────────────────
  const [calMonthOffset, setCalMonthOffset] = useState(0);
  const [selectedCallDate, setSelectedCallDate] = useState<string | null>(null);
  const [isCallAddOpen, setIsCallAddOpen] = useState(false);
  const [callAddStaffId, setCallAddStaffId] = useState("");
  const [callAddShift, setCallAddShift] = useState<"AM" | "PM" | "Full">("Full");
  const [callAddNote, setCallAddNote] = useState("");
  // Multi-date: set of toggled dates inside the add dialog
  const [callAddDates, setCallAddDates] = useState<Set<string>>(new Set());

  // ── Shift Distribution Log state ─────────────────────────────────────────
  const [isLogAddOpen, setIsLogAddOpen] = useState(false);
  const [logStaffId, setLogStaffId] = useState("");
  const [logDate, setLogDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [logShift, setLogShift] = useState<"AM" | "PM" | "Full">("Full");
  const [logContext, setLogContext] = useState("");
  const [logNote, setLogNote] = useState("");
  const [logExpandedStaff, setLogExpandedStaff] = useState<string | null>(null);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const today = format(new Date(), "yyyy-MM-dd");
  const twoMonthsOut = format(addMonths(new Date(), 2), "yyyy-MM-dd");

  const daysInRange = useMemo(() => {
    if (!range?.from || !range?.to) return [];
    return eachDayOfInterval({ start: range.from, end: range.to })
      .filter(d => !isWeekend(d))
      .map(d => format(d, "yyyy-MM-dd"));
  }, [range]);

  const toggleStaff = (id: string) => {
    setSelectedStaffIds(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const toggleExcluded = (date: string) => {
    setExcludedDates(prev =>
      prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date]
    );
  };

  const resetDialog = () => {
    setSelectedStaffIds([]);
    setRange(undefined);
    setExcludedDates([]);
    setUnavailType("Vacation");
    setNote("");
    setStaffSearch("");
  };

  const handleAdd = async () => {
    if (!selectedStaffIds.length || !range?.from || !range?.to) return;
    const startDate = format(range.from, "yyyy-MM-dd");
    const endDate = format(range.to, "yyyy-MM-dd");

    const names: string[] = [];
    for (const staffId of selectedStaffIds) {
      const member = staff.find(s => s.id === staffId);
      await addUnavailability({ staffId, startDate, endDate, type: unavailType, note, excludedDates });
      if (member) names.push(member.name);
    }
    toast({
      title: `Absence Recorded for ${names.length} staff member${names.length > 1 ? "s" : ""}`,
      description: `${names.join(", ")} · ${unavailType} · ${startDate} to ${endDate}${excludedDates.length ? ` (${excludedDates.length} day${excludedDates.length > 1 ? "s" : ""} excluded)` : ""}`,
    });
    setIsAddOpen(false);
    resetDialog();
  };

  const handleDelete = async (id: string, staffName: string) => {
    await deleteUnavailability(id);
    toast({ title: "Record Removed", description: `Unavailability removed for ${staffName}.` });
  };

  const handleToggleDay = async (recordId: string, date: string, currentExcluded: string[]) => {
    const newExcluded = currentExcluded.includes(date)
      ? currentExcluded.filter(d => d !== date)
      : [...currentExcluded, date];
    await updateUnavailability(recordId, { excludedDates: newExcluded });
  };

  // ── Call Availability helpers ────────────────────────────────────────────
  const toggleCallAddDate = (date: string) => {
    setCallAddDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const handleAddCallAvailability = async () => {
    if (!callAddStaffId || callAddDates.size === 0) return;
    const member = staff.find(s => s.id === callAddStaffId);
    if (!member) return;

    const dates = Array.from(callAddDates).sort();
    let created = 0;
    let skipped = 0;

    for (const date of dates) {
      try {
        await addCallAvailability({
          staffId: callAddStaffId,
          staffName: member.name,
          availableDate: date,
          shift: callAddShift,
          note: callAddNote,
        });
        created++;
      } catch {
        skipped++; // duplicate
      }
    }

    if (created > 0) {
      toast({
        title: "Availability Recorded",
        description: `${member.name} — ${created} date${created !== 1 ? "s" : ""} saved (${callAddShift} shift)${skipped ? `, ${skipped} duplicate${skipped !== 1 ? "s" : ""} skipped` : ""}.`,
      });
    } else {
      toast({ title: "No new entries", description: "All selected dates already have availability recorded.", variant: "destructive" });
    }

    setIsCallAddOpen(false);
    setCallAddStaffId("");
    setCallAddShift("Full");
    setCallAddNote("");
    setCallAddDates(new Set());
  };

  const handleDeleteCallAvailability = async (id: string, name: string) => {
    await deleteCallAvailability(id);
    toast({ title: "Availability Removed", description: `Availability removed for ${name}.` });
  };

  const getCallAvailForDate = (date: string) => callAvailability.filter(r => r.availableDate === date);

  const getEmploymentType = (staffId: string): EmploymentType | undefined =>
    (staff.find(s => s.id === staffId)?.employmentType as EmploymentType | undefined);

  // Build a month grid for the call availability calendar
  const buildMonthGrid = (monthOffset: number) => {
    const base = addMonths(new Date(), monthOffset);
    const firstDay = startOfMonth(base);
    const lastDay = endOfMonth(base);
    const days = eachDayOfInterval({ start: firstDay, end: lastDay });
    const startDow = getDay(firstDay);
    return { base, days, startDow };
  };

  // ── Shift Distribution Log helpers ───────────────────────────────────────
  const handleAddShiftLog = async () => {
    if (!logStaffId) return;
    const member = staff.find(s => s.id === logStaffId);
    if (!member) return;
    await addShiftLog({
      staffId: logStaffId,
      staffName: member.name,
      staffRole: member.role,
      employmentType: (member.employmentType as EmploymentType) ?? "Full-time",
      assignedDate: logDate,
      shift: logShift,
      context: logContext,
      note: logNote,
      loggedAt: new Date().toISOString(),
    });
    toast({ title: "Shift Logged", description: `${member.name} — ${logDate} (${logShift})` });
    setIsLogAddOpen(false);
    setLogStaffId("");
    setLogDate(today);
    setLogShift("Full");
    setLogContext("");
    setLogNote("");
  };

  // Staff eligible for shift distribution logging (non-full-time nurses)
  const extraStaff = staff.filter(s =>
    (s.role === "LVN" || s.role === "RN") &&
    s.isActive !== false &&
    s.employmentType &&
    s.employmentType !== "Full-time"
  ).sort((a, b) => {
    const pa = EMPLOYMENT_PRIORITY[(a.employmentType as EmploymentType) ?? "Full-time"];
    const pb = EMPLOYMENT_PRIORITY[(b.employmentType as EmploymentType) ?? "Full-time"];
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });

  // Group log entries by staff
  const logByStaff = useMemo(() => {
    const map: Record<string, typeof shiftLog> = {};
    for (const entry of shiftLog) {
      if (!map[entry.staffId]) map[entry.staffId] = [];
      map[entry.staffId].push(entry);
    }
    // Sort entries within each staff by date desc
    for (const id in map) {
      map[id].sort((a, b) => b.assignedDate.localeCompare(a.assignedDate));
    }
    return map;
  }, [shiftLog]);

  // Sort extra staff by shift count ascending (least utilized first = most equitable assignment)
  const sortedExtraStaff = [...extraStaff].sort((a, b) => {
    const pa = EMPLOYMENT_PRIORITY[(a.employmentType as EmploymentType) ?? "Full-time"];
    const pb = EMPLOYMENT_PRIORITY[(b.employmentType as EmploymentType) ?? "Full-time"];
    if (pa !== pb) return pa - pb;
    const countA = logByStaff[a.id]?.length ?? 0;
    const countB = logByStaff[b.id]?.length ?? 0;
    return countA - countB; // fewest shifts first within same type
  });

  // ── Derived data ─────────────────────────────────────────────────────────
  const enriched = unavailability.map(u => ({
    ...u,
    staff: staff.find(s => s.id === u.staffId),
  })).filter(u => u.staff);

  const twoWeeksOut = format(addDays(new Date(), 14), "yyyy-MM-dd");
  const upcoming = enriched.filter(u => u.endDate >= today && u.startDate <= twoWeeksOut);

  const filtered = enriched.filter(u => {
    const matchSearch = !searchQuery || u.staff!.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchType = filterType === "all" || u.type === filterType;
    const matchRole = filterRole === "all" ||
      (filterRole === "provider" ? ["MD","DO","NP","PA"].includes(u.staff!.role) : ["LVN","RN"].includes(u.staff!.role));
    return matchSearch && matchType && matchRole;
  }).sort((a, b) => a.startDate.localeCompare(b.startDate));

  const staffForSelect = staff
    .filter(s => ["MD","DO","NP","PA","LVN","RN"].includes(s.role) && s.isActive !== false)
    .filter(s => !staffSearch || s.name.toLowerCase().includes(staffSearch.toLowerCase()))
    .sort((a, b) => {
      const isProviderA = ["MD","DO","NP","PA"].includes(a.role);
      const isProviderB = ["MD","DO","NP","PA"].includes(b.role);
      if (isProviderA && !isProviderB) return -1;
      if (!isProviderA && isProviderB) return 1;
      return a.name.localeCompare(b.name);
    });

  const callStaffForSelect = staff
    .filter(s => ["LVN","RN","MA"].includes(s.role) && s.isActive !== false)
    .sort((a, b) => {
      const pa = EMPLOYMENT_PRIORITY[(a.employmentType as EmploymentType) ?? "Full-time"];
      const pb = EMPLOYMENT_PRIORITY[(b.employmentType as EmploymentType) ?? "Full-time"];
      if (pa !== pb) return pa - pb;
      return a.name.localeCompare(b.name);
    });

  const callStaffRNs  = callStaffForSelect.filter(s => s.role === "RN");
  const callStaffLVNs = callStaffForSelect.filter(s => s.role === "LVN");
  const callStaffMAs  = callStaffForSelect.filter(s => s.role === "MA");

  const managingRecord = managingId ? enriched.find(u => u.id === managingId) : null;

  const selectedDayRecords = useMemo(() => {
    if (!selectedCallDate) return [];
    const records = getCallAvailForDate(selectedCallDate);
    return sortByEmploymentPriority(records, getEmploymentType);
  }, [selectedCallDate, callAvailability, staff]);

  // Group day records by employment type for display
  const dayRecordsByType = useMemo(() => {
    const grouped: Partial<Record<EmploymentType, typeof selectedDayRecords>> = {};
    for (const r of selectedDayRecords) {
      const et: EmploymentType = (getEmploymentType(r.staffId)) ?? "Full-time";
      if (!grouped[et]) grouped[et] = [];
      grouped[et]!.push(r);
    }
    return grouped;
  }, [selectedDayRecords]);

  // Build the add-availability multi-date calendar
  const addCalDays = useMemo(() => {
    const months = [addMonths(new Date(), 0), addMonths(new Date(), 1)];
    return months.map(m => ({
      base: m,
      days: eachDayOfInterval({ start: startOfMonth(m), end: endOfMonth(m) }),
      startDow: getDay(startOfMonth(m)),
    }));
  }, []);

  const isLoading = staffLoading || unavailLoading || callLoading || shiftLoading;
  const isError = staffError || unavailError || callError || shiftError;

  if (isLoading) {
    return (
      <AppLayout>
        <div className="p-8 flex items-center justify-center min-h-[50vh]" data-testid="availability-loading">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            <p className="text-sm">Loading availability data…</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (isError) {
    return (
      <AppLayout>
        <div className="p-8 flex items-center justify-center min-h-[50vh]" data-testid="availability-error">
          <div className="flex flex-col items-center gap-3 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <p className="font-medium">Failed to load availability data</p>
            <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
            <Button onClick={() => { staffRefetch(); unavailRefetch(); callRefetch(); shiftRefetch(); }}>
              Retry
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-8 space-y-6 max-w-7xl mx-auto">
        <div>
          <h2 className="text-3xl font-bold tracking-tight font-heading text-foreground">Staff Availability</h2>
          <p className="text-muted-foreground mt-1">
            Record absences and manage who is available for on-call coverage.
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-2">
            <TabsTrigger value="absences" data-testid="tab-absences">
              <CalendarOff className="w-4 h-4 mr-2" />
              Absences &amp; Unavailability
            </TabsTrigger>
            <TabsTrigger value="call" data-testid="tab-call-availability">
              <CalendarDays className="w-4 h-4 mr-2" />
              Call Availability Calendar
            </TabsTrigger>
            <TabsTrigger value="distribution" data-testid="tab-shift-distribution">
              <BarChart3 className="w-4 h-4 mr-2" />
              Shift Distribution
            </TabsTrigger>
          </TabsList>

          {/* ── ABSENCES TAB ─────────────────────────────────────────────── */}
          <TabsContent value="absences" className="space-y-6">
            <div className="flex justify-between items-start">
              <p className="text-sm text-muted-foreground">
                Block providers, LVNs, and RNs for vacation, sick leave, FMLA, or leave.
                Absent staff are excluded from coverage rotation and clinic assignments.
              </p>
              <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if (!open) resetDialog(); }}>
                <DialogTrigger asChild>
                  <Button data-testid="button-add-unavailability">
                    <Plus className="w-4 h-4 mr-2" />
                    Record Absence
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Record Staff Absence</DialogTitle>
                    <DialogDescription>
                      Select one or more staff members, pick a date range, then cancel any specific days within the period.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="grid gap-6 py-2">
                    <div className="grid gap-2">
                      <Label>Absence Type</Label>
                      <div className="flex gap-2">
                        {(["Vacation", "Sick", "FMLA", "Leave"] as const).map(t => {
                          const cfg = TYPE_CONFIG[t];
                          return (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setUnavailType(t)}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm font-medium transition-all ${
                                unavailType === t
                                  ? cfg.color + " ring-2 ring-offset-1 ring-current"
                                  : "border-border text-muted-foreground hover:border-foreground/30"
                              }`}
                            >
                              <cfg.icon className="w-3.5 h-3.5" />
                              {cfg.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                      <div className="grid gap-2">
                        <Label className="flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5" />
                          Staff Members
                          {selectedStaffIds.length > 0 && (
                            <Badge className="ml-1 text-[10px] h-4 px-1">{selectedStaffIds.length} selected</Badge>
                          )}
                        </Label>
                        <div className="relative mb-1">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                          <Input
                            className="pl-8 h-8 text-sm"
                            placeholder="Search staff..."
                            value={staffSearch}
                            onChange={e => setStaffSearch(e.target.value)}
                          />
                        </div>
                        <ScrollArea className="h-[220px] border rounded-md p-2">
                          <div className="space-y-1">
                            {staffForSelect.map(s => (
                              <div
                                key={s.id}
                                className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/50 cursor-pointer"
                                onClick={() => toggleStaff(s.id)}
                              >
                                <Checkbox
                                  id={`staff-${s.id}`}
                                  checked={selectedStaffIds.includes(s.id)}
                                  onCheckedChange={() => toggleStaff(s.id)}
                                  onClick={e => e.stopPropagation()}
                                />
                                <label htmlFor={`staff-${s.id}`} className="flex-1 cursor-pointer text-sm">
                                  <span className="font-medium">{s.name}</span>
                                  <span className="text-muted-foreground ml-1.5 text-xs">{s.role}</span>
                                </label>
                              </div>
                            ))}
                            {staffForSelect.length === 0 && (
                              <p className="text-sm text-muted-foreground py-4 text-center">No staff found</p>
                            )}
                          </div>
                        </ScrollArea>
                      </div>

                      <div className="grid gap-2">
                        <Label className="flex items-center gap-1.5">
                          <CalendarDays className="w-3.5 h-3.5" />
                          Date Range
                        </Label>
                        <div className="border rounded-md overflow-hidden">
                          <DayPicker
                            mode="range"
                            selected={range}
                            onSelect={setRange}
                            disabled={[{ before: new Date() }]}
                          />
                        </div>
                      </div>
                    </div>

                    {daysInRange.length > 0 && (
                      <div className="grid gap-2">
                        <Label>Cancel Specific Days (click to mark as working)</Label>
                        <div className="flex flex-wrap gap-1.5 p-3 border rounded-md bg-muted/20">
                          {daysInRange.map(date => {
                            const isExcluded = excludedDates.includes(date);
                            return (
                              <button
                                key={date}
                                type="button"
                                onClick={() => toggleExcluded(date)}
                                className={`px-2.5 py-1 rounded text-xs font-medium border transition-all ${
                                  isExcluded
                                    ? "line-through bg-muted text-muted-foreground border-border opacity-60"
                                    : "bg-background text-foreground border-border hover:border-orange-400 hover:bg-orange-50 hover:text-orange-800"
                                }`}
                                data-testid={`toggle-day-${date}`}
                              >
                                {format(parseISO(date), "EEE M/d")}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {daysInRange.length - excludedDates.length} days absent · {excludedDates.length} cancelled
                        </p>
                      </div>
                    )}

                    <div className="grid gap-2">
                      <Label>Note (optional)</Label>
                      <Textarea
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder="e.g. Pre-approved vacation, FMLA paperwork on file..."
                        rows={2}
                        data-testid="input-note"
                      />
                    </div>
                  </div>

                  <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
                    <div className="text-xs text-muted-foreground flex-1">
                      {selectedStaffIds.length > 0 && range?.from && range?.to
                        ? `Will create ${selectedStaffIds.length} record${selectedStaffIds.length > 1 ? "s" : ""} (${daysInRange.length - excludedDates.length} working days absent)`
                        : "Select staff and a date range to continue"}
                    </div>
                    <Button variant="outline" onClick={() => { setIsAddOpen(false); resetDialog(); }}>Cancel</Button>
                    <Button
                      onClick={handleAdd}
                      disabled={!selectedStaffIds.length || !range?.from || !range?.to}
                      data-testid="button-confirm-absence"
                    >
                      Save Absence{selectedStaffIds.length > 1 ? `s (${selectedStaffIds.length})` : ""}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            {upcoming.length > 0 && (
              <Card className="border-orange-200 bg-orange-500/5">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2 text-orange-700">
                    <AlertTriangle className="w-4 h-4" />
                    {upcoming.length} Upcoming Absence{upcoming.length !== 1 ? "s" : ""} in the Next 14 Days
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {upcoming.map(u => {
                      const effectiveDays = eachDayOfInterval({
                        start: parseISO(u.startDate),
                        end: parseISO(u.endDate),
                      }).filter(d => !isWeekend(d) && !(u.excludedDates ?? []).includes(format(d, "yyyy-MM-dd"))).length;
                      return (
                        <Badge key={u.id} variant="outline" className={`${TYPE_CONFIG[u.type].color} text-xs`}>
                          {u.staff?.name} · {u.type} · {u.startDate === u.endDate ? u.startDate : `${u.startDate} – ${u.endDate}`}
                          {(u.excludedDates ?? []).length > 0 && ` (${effectiveDays} days)`}
                        </Badge>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search by name..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  data-testid="input-search"
                />
              </div>
              <Select value={filterRole} onValueChange={setFilterRole}>
                <SelectTrigger className="w-[160px]" data-testid="filter-role">
                  <SelectValue placeholder="All Roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  <SelectItem value="provider">Providers</SelectItem>
                  <SelectItem value="nurse">LVN / RN</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-[160px]" data-testid="filter-type">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="Vacation">Vacation</SelectItem>
                  <SelectItem value="Sick">Sick Leave</SelectItem>
                  <SelectItem value="FMLA">FMLA</SelectItem>
                  <SelectItem value="Leave">Leave</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarOff className="w-5 h-5" />
                  Absence Records
                </CardTitle>
                <CardDescription>
                  {filtered.length} record{filtered.length !== 1 ? "s" : ""}. Staff marked absent are removed from coverage rotation.
                  Click "Manage Days" to cancel individual days within a period.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Staff Member</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Date Range</TableHead>
                      <TableHead>Days Absent</TableHead>
                      <TableHead>Cancelled Days</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead className="w-[120px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(u => {
                      const start = parseISO(u.startDate);
                      const end = parseISO(u.endDate);
                      const allWorkDays = eachDayOfInterval({ start, end }).filter(d => !isWeekend(d)).map(d => format(d, "yyyy-MM-dd"));
                      const excluded = u.excludedDates ?? [];
                      const absentDays = allWorkDays.filter(d => !excluded.includes(d)).length;
                      const isActive = u.startDate <= today && u.endDate >= today && !excluded.includes(today);
                      const cfg = TYPE_CONFIG[u.type];
                      return (
                        <TableRow key={u.id} className={isActive ? "bg-orange-500/5" : ""} data-testid={`row-unavailability-${u.id}`}>
                          <TableCell className="font-medium">
                            {u.staff?.name}
                            {isActive && <Badge className="ml-2 text-[10px] bg-orange-500/15 text-orange-700 border-orange-200">Active</Badge>}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{u.staff?.role}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={`text-xs border ${cfg.color}`}>{cfg.label}</Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {u.startDate === u.endDate ? u.startDate : `${u.startDate} – ${u.endDate}`}
                          </TableCell>
                          <TableCell className="text-sm">
                            <span className={absentDays === 0 ? "text-muted-foreground" : "font-medium"}>
                              {absentDays} day{absentDays !== 1 ? "s" : ""}
                            </span>
                          </TableCell>
                          <TableCell>
                            {excluded.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {excluded.map(d => (
                                  <Badge key={d} variant="outline" className="text-[10px] h-4 px-1 line-through text-muted-foreground">
                                    {format(parseISO(d), "M/d")}
                                  </Badge>
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs max-w-[140px] truncate">{u.note || "—"}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs px-2"
                                onClick={() => setManagingId(u.id)}
                                data-testid={`button-manage-days-${u.id}`}
                              >
                                Manage Days
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => handleDelete(u.id, u.staff!.name)}
                                data-testid={`button-delete-unavailability-${u.id}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {filtered.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                          <CalendarOff className="w-8 h-8 mx-auto mb-2 opacity-30" />
                          <p>No absence records found.</p>
                          <p className="text-sm mt-1">Click "Record Absence" to add one.</p>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── CALL AVAILABILITY TAB ──────────────────────────────────────── */}
          <TabsContent value="call" className="space-y-6">
            <div className="flex justify-between items-start">
              <div className="max-w-xl space-y-1">
                <p className="text-sm text-muted-foreground">
                  LVNs and RNs register dates (up to 2 months ahead) when they can provide coverage.
                  Dates are sorted by preference: <strong>Part-time coded</strong> nurses appear first, then Per Diem, then Extra Help.
                </p>
                <p className="text-xs text-muted-foreground">
                  Click a day on the calendar to view who's available. Select multiple dates in the Add dialog to batch-enter availability.
                </p>
              </div>
              <Button
                onClick={() => {
                  if (selectedCallDate) setCallAddDates(new Set([selectedCallDate]));
                  setIsCallAddOpen(true);
                }}
                data-testid="button-add-call-availability"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Availability
              </Button>
            </div>

            <div className="grid lg:grid-cols-3 gap-6">
              {/* Left: 2-month grid calendar */}
              <div className="lg:col-span-2 space-y-4">
                <div className="flex items-center justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCalMonthOffset(Math.max(0, calMonthOffset - 1))}
                    disabled={calMonthOffset === 0}
                    data-testid="button-cal-prev"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="text-sm font-medium text-muted-foreground">
                    {calMonthOffset === 0 ? "Current & next month" : "Next two months"}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCalMonthOffset(Math.min(1, calMonthOffset + 1))}
                    disabled={calMonthOffset >= 1}
                    data-testid="button-cal-next"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  {[calMonthOffset, calMonthOffset + 1].map(offset => {
                    const { base, days, startDow } = buildMonthGrid(offset);
                    const monthLabel = format(base, "MMMM yyyy");

                    return (
                      <Card key={offset}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-semibold text-center">{monthLabel}</CardTitle>
                        </CardHeader>
                        <CardContent className="p-3">
                          <div className="grid grid-cols-7 mb-1">
                            {DAY_NAMES.map(d => (
                              <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-1">
                                {d}
                              </div>
                            ))}
                          </div>
                          <div className="grid grid-cols-7 gap-px">
                            {Array.from({ length: startDow }).map((_, i) => (
                              <div key={`empty-${i}`} />
                            ))}
                            {days.map(day => {
                              const dateStr = format(day, "yyyy-MM-dd");
                              const isWknd = isWeekend(day);
                              const isPast = dateStr < today;
                              const isTooFar = dateStr > twoMonthsOut;
                              const isSelected = selectedCallDate === dateStr;
                              const avail = getCallAvailForDate(dateStr);
                              const isToday = dateStr === today;

                              return (
                                <button
                                  key={dateStr}
                                  type="button"
                                  disabled={isWknd || isPast || isTooFar}
                                  onClick={() => !isWknd && !isPast && !isTooFar && setSelectedCallDate(dateStr)}
                                  className={`relative rounded p-1 text-center text-xs transition-colors min-h-[44px] flex flex-col items-center justify-start pt-1 ${
                                    isWknd || isPast || isTooFar
                                      ? "text-muted-foreground/30 cursor-default"
                                      : isSelected
                                        ? "bg-primary text-primary-foreground ring-2 ring-primary"
                                        : isToday
                                          ? "bg-primary/10 text-primary font-bold hover:bg-primary/20 cursor-pointer"
                                          : "hover:bg-muted cursor-pointer"
                                  }`}
                                  data-testid={`cal-day-${dateStr}`}
                                >
                                  <span className="text-xs leading-none">{format(day, "d")}</span>
                                  {avail.length > 0 && (
                                    <div className="flex flex-wrap gap-px justify-center mt-0.5">
                                      {avail.slice(0, 4).map(r => (
                                        <span
                                          key={r.id}
                                          className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"
                                          title={r.staffName}
                                        />
                                      ))}
                                      {avail.length > 4 && (
                                        <span className="text-[9px] text-green-700 leading-none">+{avail.length - 4}</span>
                                      )}
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-2 text-center">
                            {getDaysInMonth(base)} days · green dots = available staff
                          </p>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>

              {/* Right: Day detail panel */}
              <div>
                <Card className="sticky top-4">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <CalendarDays className="w-4 h-4" />
                      {selectedCallDate
                        ? format(parseISO(selectedCallDate), "EEEE, MMMM d yyyy")
                        : "Select a date"}
                    </CardTitle>
                    {selectedCallDate && (
                      <CardDescription>
                        {selectedDayRecords.length === 0
                          ? "No one listed availability for this day."
                          : `${selectedDayRecords.length} staff member${selectedDayRecords.length !== 1 ? "s" : ""} available — sorted by preference`}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {!selectedCallDate && (
                      <p className="text-sm text-muted-foreground py-4 text-center">
                        Click a working day to see who is available.
                      </p>
                    )}

                    {selectedCallDate && selectedDayRecords.length === 0 && (
                      <div className="text-center py-6 text-muted-foreground">
                        <Users className="w-6 h-6 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">No availability recorded yet.</p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-3"
                          onClick={() => { setCallAddDates(new Set([selectedCallDate])); setIsCallAddOpen(true); }}
                          disabled={selectedCallDate > twoMonthsOut || selectedCallDate < today}
                          data-testid="button-add-from-panel"
                        >
                          <Plus className="w-3.5 h-3.5 mr-1.5" />
                          Add Availability
                        </Button>
                      </div>
                    )}

                    {/* Render each employment type group in priority order */}
                    {(["Part-time", "Per Diem", "Extra Help", "Full-time"] as EmploymentType[]).map(et => {
                      const records = dayRecordsByType[et];
                      if (!records || records.length === 0) return null;
                      return (
                        <div key={et}>
                          <div className="flex items-center gap-2 mb-2">
                            <p className={`text-[11px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${EMPLOYMENT_BADGE[et]}`}>
                              {PRIORITY_LABEL[et]}
                            </p>
                          </div>
                          <div className="space-y-2">
                            {records.map(r => {
                              const member = staff.find(s => s.id === r.staffId);
                              const shiftCfg = SHIFT_CONFIG[r.shift as keyof typeof SHIFT_CONFIG];
                              return (
                                <div key={r.id} className="flex items-start justify-between p-2.5 border rounded-md bg-background gap-2" data-testid={`call-avail-row-${r.id}`}>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="font-medium text-sm">{r.staffName}</span>
                                      <Badge variant="outline" className="text-[10px] h-4 px-1">{member?.role}</Badge>
                                      <Badge className={`text-[10px] border ${shiftCfg.color}`}>{shiftCfg.label}</Badge>
                                    </div>
                                    {(member?.phone || member?.email) && (
                                      <div className="flex flex-wrap gap-2 mt-1">
                                        {member?.phone && (
                                          <a href={`tel:${member.phone}`} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                                            <Phone className="w-3 h-3" />{member.phone}
                                          </a>
                                        )}
                                        {member?.email && (
                                          <a href={`mailto:${member.email}`} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                                            <Mail className="w-3 h-3" />{member.email}
                                          </a>
                                        )}
                                      </div>
                                    )}
                                    {r.note && <p className="text-xs text-muted-foreground mt-0.5 truncate">{r.note}</p>}
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                                    onClick={() => handleDeleteCallAvailability(r.id, r.staffName)}
                                    data-testid={`button-delete-call-avail-${r.id}`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}

                    {selectedCallDate && selectedDayRecords.length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => { setCallAddDates(new Set([selectedCallDate])); setIsCallAddOpen(true); }}
                        disabled={selectedCallDate > twoMonthsOut || selectedCallDate < today}
                        data-testid="button-add-more-call-avail"
                      >
                        <Plus className="w-3.5 h-3.5 mr-1.5" />
                        Add Another
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* ── SHIFT DISTRIBUTION TAB ────────────────────────────────────── */}
          <TabsContent value="distribution" className="space-y-6">
            <div className="flex justify-between items-start">
              <div className="max-w-xl space-y-1">
                <p className="text-sm text-muted-foreground">
                  Track how additional shifts are distributed among Part-time, Per Diem, and Extra Help nurses.
                  Preference order: <strong>Part-time coded</strong> nurses are offered shifts before Per Diem, and Per Diem before Extra Help.
                </p>
                <p className="text-xs text-muted-foreground">
                  Staff with the fewest logged shifts are listed first within each category for equitable distribution.
                </p>
              </div>
              <Button onClick={() => setIsLogAddOpen(true)} data-testid="button-log-shift">
                <Plus className="w-4 h-4 mr-2" />
                Log Shift
              </Button>
            </div>

            {/* Preference rules card */}
            <Card className="border-blue-200 bg-blue-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-blue-800 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Preferential Approval Order
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-1.5">
                  {(["Part-time", "Per Diem", "Extra Help"] as EmploymentType[]).map((et, i) => (
                    <li key={et} className="flex items-center gap-2 text-sm">
                      <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center font-bold shrink-0">{i + 1}</span>
                      <Badge variant="outline" className={`text-xs ${EMPLOYMENT_BADGE[et]}`}>{et}</Badge>
                      <span className="text-muted-foreground">{et === "Part-time" ? "Coded part-time nurses have first preference for additional shifts in their work unit." : et === "Per Diem" ? "Per Diem nurses are offered shifts after Part-time coded nurses." : "Extra Help nurses are offered shifts last."}</span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>

            {extraStaff.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>No Part-time, Per Diem, or Extra Help nurses in the system.</p>
                  <p className="text-sm mt-1">Add employment type to nurses on the Staff page.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {(["Part-time", "Per Diem", "Extra Help"] as EmploymentType[]).map(et => {
                  const group = sortedExtraStaff.filter(s => s.employmentType === et);
                  if (group.length === 0) return null;
                  return (
                    <div key={et}>
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className={`text-xs ${EMPLOYMENT_BADGE[et]}`}>{PRIORITY_LABEL[et]}</Badge>
                        <span className="text-xs text-muted-foreground">{group.length} nurse{group.length !== 1 ? "s" : ""}</span>
                      </div>
                      <Card>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Name</TableHead>
                              <TableHead>Role</TableHead>
                              <TableHead>Total Shifts Logged</TableHead>
                              <TableHead>Last Assigned</TableHead>
                              <TableHead className="w-[80px]"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {group.map(s => {
                              const entries = logByStaff[s.id] ?? [];
                              const lastEntry = entries[0];
                              const isExpanded = logExpandedStaff === s.id;
                              return (
                                <>
                                  <TableRow key={s.id} className="cursor-pointer" onClick={() => setLogExpandedStaff(isExpanded ? null : s.id)} data-testid={`dist-row-${s.id}`}>
                                    <TableCell className="font-medium">
                                      {s.name}
                                      {entries.length === 0 && (
                                        <Badge variant="outline" className="ml-2 text-[10px] h-4 px-1 text-green-700 border-green-200 bg-green-50">No shifts yet</Badge>
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      <Badge variant="outline" className="text-xs">{s.role}</Badge>
                                    </TableCell>
                                    <TableCell>
                                      <span className={`font-semibold ${entries.length === 0 ? "text-green-600" : entries.length >= 5 ? "text-orange-600" : ""}`}>
                                        {entries.length} shift{entries.length !== 1 ? "s" : ""}
                                      </span>
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                      {lastEntry ? `${lastEntry.assignedDate} (${lastEntry.shift})` : "—"}
                                    </TableCell>
                                    <TableCell>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 text-xs px-2"
                                        onClick={e => { e.stopPropagation(); setLogExpandedStaff(isExpanded ? null : s.id); }}
                                      >
                                        {isExpanded ? "Hide" : "View"}
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                  {isExpanded && entries.length > 0 && (
                                    <TableRow key={`${s.id}-expanded`}>
                                      <TableCell colSpan={5} className="bg-muted/20 py-2 px-4">
                                        <div className="space-y-1.5">
                                          {entries.map(e => (
                                            <div key={e.id} className="flex items-start justify-between text-xs py-1 border-b border-border/30 last:border-0" data-testid={`log-entry-${e.id}`}>
                                              <div className="flex gap-3 flex-wrap">
                                                <span className="font-medium">{e.assignedDate}</span>
                                                <Badge className={`text-[10px] border ${SHIFT_CONFIG[e.shift].color}`}>{SHIFT_CONFIG[e.shift].label}</Badge>
                                                {e.context && <span className="text-muted-foreground">{e.context}</span>}
                                                {e.note && <span className="text-muted-foreground italic">{e.note}</span>}
                                              </div>
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-5 w-5 text-muted-foreground hover:text-destructive shrink-0"
                                                onClick={() => deleteShiftLog(e.id)}
                                                data-testid={`button-delete-log-${e.id}`}
                                              >
                                                <X className="w-3 h-3" />
                                              </Button>
                                            </div>
                                          ))}
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  )}
                                  {isExpanded && entries.length === 0 && (
                                    <TableRow key={`${s.id}-empty`}>
                                      <TableCell colSpan={5} className="bg-muted/20 py-3 text-center text-xs text-muted-foreground">
                                        No shifts logged yet for {s.name}.
                                      </TableCell>
                                    </TableRow>
                                  )}
                                </>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </Card>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Manage Days Dialog */}
      <Dialog open={!!managingId} onOpenChange={(open) => !open && setManagingId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage Individual Days</DialogTitle>
            <DialogDescription>
              {managingRecord && (
                <>
                  {managingRecord.staff?.name} · {managingRecord.type} ·{" "}
                  {managingRecord.startDate} to {managingRecord.endDate}
                  <br />
                  Click any working day to cancel it (mark as working) or restore it as absent.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {managingRecord && (() => {
            const workDays = eachDayOfInterval({
              start: parseISO(managingRecord.startDate),
              end: parseISO(managingRecord.endDate),
            }).filter(d => !isWeekend(d)).map(d => format(d, "yyyy-MM-dd"));
            const excluded = managingRecord.excludedDates ?? [];
            return (
              <div className="py-2">
                <div className="flex flex-wrap gap-1.5 p-3 border rounded-md bg-muted/20">
                  {workDays.map(date => {
                    const isExcluded = excluded.includes(date);
                    return (
                      <button
                        key={date}
                        type="button"
                        onClick={() => handleToggleDay(managingRecord.id, date, excluded)}
                        className={`px-2.5 py-1.5 rounded text-xs font-medium border transition-all ${
                          isExcluded
                            ? "line-through bg-muted text-muted-foreground border-border opacity-60"
                            : "bg-background text-foreground border-border hover:border-orange-400 hover:bg-orange-50 hover:text-orange-800"
                        }`}
                        title={isExcluded ? "Click to restore as absent" : "Click to cancel (mark as working)"}
                        data-testid={`manage-day-${date}`}
                      >
                        {format(parseISO(date), "EEE MMM d")}
                      </button>
                    );
                  })}
                  {workDays.length === 0 && (
                    <p className="text-sm text-muted-foreground py-2">No working days in this range.</p>
                  )}
                </div>
                <div className="mt-3 text-sm text-muted-foreground flex justify-between">
                  <span>
                    <span className="font-medium text-foreground">{workDays.length - excluded.length}</span> absent ·{" "}
                    <span className="font-medium text-foreground">{excluded.length}</span> cancelled
                  </span>
                  {excluded.length > 0 && (
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => updateUnavailability(managingRecord.id, { excludedDates: [] })}
                    >
                      Restore all
                    </button>
                  )}
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button onClick={() => setManagingId(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Call Availability Dialog — with multi-date selection */}
      <Dialog open={isCallAddOpen} onOpenChange={(open) => {
        setIsCallAddOpen(open);
        if (!open) { setCallAddStaffId(""); setCallAddShift("Full"); setCallAddNote(""); setCallAddDates(new Set()); }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Call Availability</DialogTitle>
            <DialogDescription>
              Select a staff member, their available shift, and one or more dates. Click dates to toggle selection.
            </DialogDescription>
          </DialogHeader>
          <div className="grid md:grid-cols-2 gap-6 py-2">
            {/* Left: staff + shift + note */}
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label>Staff Member</Label>
                <Select value={callAddStaffId} onValueChange={setCallAddStaffId}>
                  <SelectTrigger data-testid="select-call-staff">
                    <SelectValue placeholder="Select staff member...">
                      {callAddStaffId && (() => {
                        const m = callStaffForSelect.find(s => s.id === callAddStaffId);
                        return m ? `${m.name} (${m.role})` : "Select staff member...";
                      })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-72 overflow-y-auto">
                    {callStaffRNs.length > 0 && (
                      <SelectGroup>
                        <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 py-1.5 bg-muted/50">
                          RN Staff (Charge &amp; Extra)
                        </SelectLabel>
                        {callStaffRNs.map(s => (
                          <SelectItem key={s.id} value={s.id} data-testid={`call-staff-option-${s.id}`}>
                            {s.name}{" "}
                            <span className="text-muted-foreground text-xs">
                              (RN{s.employmentType && s.employmentType !== "Full-time" ? ` · ${s.employmentType}` : ""})
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {callStaffLVNs.length > 0 && (
                      <SelectGroup>
                        <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 py-1.5 bg-muted/50">
                          LVN Staff
                        </SelectLabel>
                        {callStaffLVNs.map(s => (
                          <SelectItem key={s.id} value={s.id} data-testid={`call-staff-option-${s.id}`}>
                            {s.name}{" "}
                            <span className="text-muted-foreground text-xs">
                              (LVN{s.employmentType && s.employmentType !== "Full-time" ? ` · ${s.employmentType}` : ""})
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {callStaffMAs.length > 0 && (
                      <SelectGroup>
                        <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 py-1.5 bg-muted/50">
                          Medical Assistants
                        </SelectLabel>
                        {callStaffMAs.map(s => (
                          <SelectItem key={s.id} value={s.id} data-testid={`call-staff-option-${s.id}`}>
                            {s.name}{" "}
                            <span className="text-muted-foreground text-xs">
                              (MA{s.employmentType && s.employmentType !== "Full-time" ? ` · ${s.employmentType}` : ""})
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {callStaffForSelect.length === 0 && (
                      <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                        No eligible staff found.
                      </div>
                    )}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Staff ordered by preference: Part-time coded first.</p>
              </div>

              <div className="grid gap-2">
                <Label>Available Shift</Label>
                <div className="flex gap-2">
                  {(["Full", "AM", "PM"] as const).map(shift => {
                    const cfg = SHIFT_CONFIG[shift];
                    return (
                      <button
                        key={shift}
                        type="button"
                        onClick={() => setCallAddShift(shift)}
                        className={`flex-1 px-3 py-2 rounded-md border text-sm font-medium transition-all ${
                          callAddShift === shift
                            ? cfg.color + " ring-2 ring-offset-1 ring-current"
                            : "border-border text-muted-foreground hover:border-foreground/30"
                        }`}
                        data-testid={`shift-btn-${shift}`}
                      >
                        {cfg.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Note (optional)</Label>
                <Input
                  value={callAddNote}
                  onChange={e => setCallAddNote(e.target.value)}
                  placeholder="e.g. Available after 9am, limited to pediatrics..."
                  data-testid="input-call-avail-note"
                />
              </div>

              {callAddDates.size > 0 && (
                <div className="p-3 bg-primary/5 border border-primary/20 rounded-md">
                  <p className="text-xs font-medium mb-2">{callAddDates.size} date{callAddDates.size !== 1 ? "s" : ""} selected:</p>
                  <div className="flex flex-wrap gap-1">
                    {Array.from(callAddDates).sort().map(d => (
                      <Badge key={d} variant="outline" className="text-xs gap-1 cursor-pointer hover:bg-destructive/10" onClick={() => toggleCallAddDate(d)}>
                        {format(parseISO(d), "M/d (EEE)")}
                        <X className="w-2.5 h-2.5" />
                      </Badge>
                    ))}
                  </div>
                  <button type="button" className="text-xs text-muted-foreground hover:text-foreground mt-1.5" onClick={() => setCallAddDates(new Set())}>
                    Clear all
                  </button>
                </div>
              )}
            </div>

            {/* Right: multi-date calendar */}
            <div className="space-y-3">
              <Label>Select Dates (click to toggle)</Label>
              {addCalDays.map(({ base, days, startDow }) => (
                <div key={format(base, "yyyy-MM")}>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">{format(base, "MMMM yyyy")}</p>
                  <div className="grid grid-cols-7 gap-px">
                    {DAY_NAMES.map(d => (
                      <div key={d} className="text-center text-[9px] text-muted-foreground py-0.5">{d}</div>
                    ))}
                    {Array.from({ length: startDow }).map((_, i) => <div key={`e-${i}`} />)}
                    {days.map(day => {
                      const dateStr = format(day, "yyyy-MM-dd");
                      const isWknd = isWeekend(day);
                      const isPast = dateStr < today;
                      const isTooFar = dateStr > twoMonthsOut;
                      const isSelected = callAddDates.has(dateStr);
                      const isToday = dateStr === today;
                      const disabled = isWknd || isPast || isTooFar;
                      return (
                        <button
                          key={dateStr}
                          type="button"
                          disabled={disabled}
                          onClick={() => !disabled && toggleCallAddDate(dateStr)}
                          className={`rounded text-xs py-1 text-center transition-colors ${
                            disabled
                              ? "text-muted-foreground/30 cursor-default"
                              : isSelected
                                ? "bg-primary text-primary-foreground font-semibold"
                                : isToday
                                  ? "bg-primary/10 text-primary font-bold hover:bg-primary/20"
                                  : "hover:bg-muted cursor-pointer"
                          }`}
                          data-testid={`add-cal-day-${dateStr}`}
                        >
                          {format(day, "d")}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCallAddOpen(false)}>Cancel</Button>
            <Button
              onClick={handleAddCallAvailability}
              disabled={!callAddStaffId || callAddDates.size === 0}
              data-testid="button-confirm-call-avail"
            >
              Save {callAddDates.size > 0 ? `${callAddDates.size} Date${callAddDates.size !== 1 ? "s" : ""}` : "Availability"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Log Shift Dialog */}
      <Dialog open={isLogAddOpen} onOpenChange={(open) => {
        setIsLogAddOpen(open);
        if (!open) { setLogStaffId(""); setLogDate(today); setLogShift("Full"); setLogContext(""); setLogNote(""); }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Log an Assigned Shift</DialogTitle>
            <DialogDescription>
              Record that a Part-time, Per Diem, or Extra Help nurse was assigned an additional shift.
              This tracks equitable distribution of extra shifts.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Staff Member</Label>
              <Select value={logStaffId} onValueChange={setLogStaffId}>
                <SelectTrigger data-testid="select-log-staff">
                  <SelectValue placeholder="Select nurse..." />
                </SelectTrigger>
                <SelectContent>
                  {extraStaff.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} <span className="text-muted-foreground text-xs ml-1">({s.role} · {s.employmentType})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={logDate}
                  onChange={e => setLogDate(e.target.value)}
                  data-testid="input-log-date"
                />
              </div>
              <div className="grid gap-2">
                <Label>Shift</Label>
                <Select value={logShift} onValueChange={(v) => setLogShift(v as "AM" | "PM" | "Full")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Full">Full Day</SelectItem>
                    <SelectItem value="AM">AM Only</SelectItem>
                    <SelectItem value="PM">PM Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Coverage Context</Label>
              <Input
                value={logContext}
                onChange={e => setLogContext(e.target.value)}
                placeholder="e.g. Coverage for Pediatrics, Retinal AI Clinic..."
                data-testid="input-log-context"
              />
            </div>

            <div className="grid gap-2">
              <Label>Note (optional)</Label>
              <Input
                value={logNote}
                onChange={e => setLogNote(e.target.value)}
                placeholder="Any additional notes..."
                data-testid="input-log-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsLogAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAddShiftLog} disabled={!logStaffId} data-testid="button-confirm-log-shift">
              Log Shift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
