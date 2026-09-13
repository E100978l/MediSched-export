import { useState, useMemo } from "react";
import { format, parseISO, addDays, addWeeks, startOfWeek } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Lightbulb,
  CalendarDays,
  Stethoscope,
  Clock,
  UserCheck,
} from "lucide-react";
import {
  useStaff,
  useUnavailability,
  useClinics,
  useProviderSchedules,
  isStaffUnavailable,
  isStaffEligibleForClinic,
  isLvnBusyOnShift,
  shiftsOverlap,
} from "@/lib/store";
import type { StaffMember, ClinicAssignment } from "@/lib/store";

interface Props {
  staffId: string | null;
  onClose: () => void;
}

type ViewMode = "day" | "week";

const STATUS_CHIP: Record<string, string> = {
  "Patient Care": "bg-blue-100 text-blue-800 border-blue-300",
  Admin: "bg-purple-100 text-purple-800 border-purple-300",
  Off: "bg-gray-100 text-gray-500 border-gray-300",
  Meeting: "bg-yellow-100 text-yellow-800 border-yellow-300",
  Unconfirmed: "bg-muted text-muted-foreground border-muted",
};

const ABSENCE_CHIP: Record<string, string> = {
  Sick: "bg-red-100 text-red-800 border-red-300",
  FMLA: "bg-orange-100 text-orange-800 border-orange-300",
  Leave: "bg-amber-100 text-amber-800 border-amber-300",
  Vacation: "bg-teal-100 text-teal-800 border-teal-300",
};

function isWeekendDate(dateStr: string): boolean {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return dow === 0 || dow === 6;
}

function isProvider(s: StaffMember) {
  return ["MD", "DO", "NP", "PA"].includes(s.role);
}

export function StaffLookupModal({ staffId, onClose }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [baseDate, setBaseDate] = useState(() => format(new Date(), "yyyy-MM-dd"));

  const dates = useMemo(() => {
    if (viewMode === "day") return [baseDate];
    const base = parseISO(baseDate + "T12:00:00");
    const monday = startOfWeek(base, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) =>
      format(addDays(monday, i), "yyyy-MM-dd")
    );
  }, [viewMode, baseDate]);

  const startDate = dates[0];
  const endDate = dates[dates.length - 1];

  const { staff, coverageHistory } = useStaff();
  const { unavailability } = useUnavailability();
  const { assignments: clinicAssignments } = useClinics();
  const { schedules: providerSchedules } = useProviderSchedules(startDate, endDate);

  const member = staff.find((s) => s.id === staffId) ?? null;

  function navigate(dir: 1 | -1) {
    if (viewMode === "day") {
      setBaseDate((prev) => format(addDays(parseISO(prev + "T12:00:00"), dir), "yyyy-MM-dd"));
    } else {
      setBaseDate((prev) => format(addWeeks(parseISO(prev + "T12:00:00"), dir), "yyyy-MM-dd"));
    }
  }

  function getProviderStatus(providerId: string, date: string) {
    const schedule = providerSchedules.find(
      (ps) => ps.providerId === providerId && ps.date === date
    );
    if (schedule) {
      return { am: schedule.am, pm: schedule.pm, confirmed: true };
    }
    return { am: "Unconfirmed", pm: "Unconfirmed", confirmed: false };
  }

  function isSuggestHardBlockedByProvider(
    candidate: StaffMember,
    date: string,
    shift: "AM" | "PM" | "Full"
  ): boolean {
    const assignedProviderIds = candidate.assignedTo as string[] ?? [];
    for (const pid of assignedProviderIds) {
      const schedule = providerSchedules.find((ps) => ps.providerId === pid && ps.date === date);
      if (!schedule) continue;
      const hasPatientCare =
        shift === "AM"
          ? schedule.am === "Patient Care"
          : shift === "PM"
          ? schedule.pm === "Patient Care"
          : schedule.am === "Patient Care" || schedule.pm === "Patient Care";
      if (hasPatientCare) return true;
    }
    return false;
  }

  function findSuggestions(date: string, assignment: ClinicAssignment): StaffMember[] {
    const shift = assignment.shift as "AM" | "PM" | "Full";
    return staff
      .filter((s) => {
        if (s.id === staffId) return false;
        if (!s.isActive) return false;
        if (s.role !== "LVN") return false;
        if (!isStaffEligibleForClinic(s, assignment.clinicName)) return false;
        if (isStaffUnavailable(unavailability, s.id, date)) return false;
        if (isSuggestHardBlockedByProvider(s, date, shift)) return false;
        const busy = isLvnBusyOnShift(
          s.id,
          date,
          shift,
          { clinicAssignments, coverageRecords: coverageHistory }
        );
        return !busy.busy;
      })
      .slice(0, 3);
  }

  function getDayData(date: string) {
    if (!member) return null;

    const clinicDayAssigns = clinicAssignments.filter(
      (a) => a.staffId === member.id && a.date === date
    );
    const coverageDay = coverageHistory.filter(
      (r) => r.staffId === member.id && r.date === date
    );
    const absence = isStaffUnavailable(unavailability, member.id, date);

    const providerStatuses: Array<{
      name: string;
      id: string;
      am: string;
      pm: string;
      confirmed: boolean;
    }> = [];

    if ((member.role === "LVN" || member.role === "RN") && (member.assignedTo ?? []).length > 0) {
      for (const pid of member.assignedTo as string[]) {
        const p = staff.find((s) => s.id === pid);
        if (!p) continue;
        const status = getProviderStatus(pid, date);
        providerStatuses.push({ name: p.name, id: pid, ...status });
      }
    } else if (isProvider(member)) {
      const status = getProviderStatus(member.id, date);
      providerStatuses.push({ name: member.name, id: member.id, ...status });
    }

    interface Conflict {
      description: string;
      shift: string;
      suggestions: StaffMember[];
    }
    const conflicts: Conflict[] = [];
    const seen = new Set<string>();

    // --- Conflicts involving a clinic assignment ---
    for (const ca of clinicDayAssigns) {
      const caShift = ca.shift as "AM" | "PM" | "Full";

      // Clinic assignment vs confirmed provider Patient Care
      for (const ps of providerStatuses) {
        if (!ps.confirmed) continue;
        const hasCare =
          caShift === "AM"
            ? ps.am === "Patient Care"
            : caShift === "PM"
            ? ps.pm === "Patient Care"
            : ps.am === "Patient Care" || ps.pm === "Patient Care";
        if (hasCare) {
          const key = `pc:${ca.id}:${ps.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            conflicts.push({
              description: `${ca.clinicName} (${ca.shift}) assigned while ${ps.name} has confirmed Patient Care`,
              shift: ca.shift,
              suggestions: findSuggestions(date, ca),
            });
          }
        }
      }

      // Clinic assignment vs coverage duty on same date
      for (const cr of coverageDay) {
        const key = `cov:${ca.id}:${cr.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          conflicts.push({
            description: `${ca.clinicName} (${ca.shift}) AND covering for ${cr.providerName} (${cr.coveredSpecialty})`,
            shift: ca.shift,
            suggestions: findSuggestions(date, ca),
          });
        }
      }

      // Double-booked clinic assignments on overlapping shifts
      for (const other of clinicDayAssigns) {
        if (other.id === ca.id) continue;
        if (shiftsOverlap(caShift, other.shift as "AM" | "PM" | "Full")) {
          const key = [ca.id, other.id].sort().join(":");
          if (!seen.has(key)) {
            seen.add(key);
            conflicts.push({
              description: `Double-booked: ${ca.clinicName} (${ca.shift}) and ${other.clinicName} (${other.shift})`,
              shift: ca.shift,
              suggestions: findSuggestions(date, ca),
            });
          }
        }
      }
    }

    // --- Coverage duty vs confirmed provider Patient Care (always checked) ---
    for (const cr of coverageDay) {
      for (const ps of providerStatuses) {
        if (!ps.confirmed) continue;
        const hasCareAM = ps.am === "Patient Care";
        const hasCarePM = ps.pm === "Patient Care";
        if (hasCareAM || hasCarePM) {
          const key = `cov-pc:${cr.id}:${ps.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            const shift = hasCareAM && hasCarePM ? "Full" : hasCareAM ? "AM" : "PM";
            conflicts.push({
              description: `Covering for ${cr.providerName} (${cr.coveredSpecialty}) while provider ${ps.name} has confirmed Patient Care`,
              shift,
              suggestions: [],
            });
          }
        }
      }
    }

    return { clinicDayAssigns, coverageDay, absence, providerStatuses, conflicts };
  }

  if (!member) return null;

  const rangeLabel =
    viewMode === "day"
      ? format(parseISO(dates[0] + "T12:00:00"), "EEEE, MMMM d, yyyy")
      : `${format(parseISO(dates[0] + "T12:00:00"), "MMM d")} – ${format(
          parseISO(dates[dates.length - 1] + "T12:00:00"),
          "MMM d, yyyy"
        )}`;

  return (
    <Dialog open={!!staffId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="dialog-staff-lookup">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            <CalendarDays className="h-5 w-5 text-muted-foreground shrink-0" />
            <span>{member.name} — Schedule Overview</span>
            <Badge variant="outline">{member.role}</Badge>
            {member.employmentType && member.employmentType !== "Full-time" && (
              <Badge variant="secondary" className="text-xs">
                {member.employmentType}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 pb-3 border-b">
          <div className="flex rounded-md border overflow-hidden text-sm">
            <button
              onClick={() => setViewMode("day")}
              className={`px-3 py-1.5 font-medium transition-colors ${
                viewMode === "day"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
              data-testid="button-lookup-day"
            >
              Day
            </button>
            <button
              onClick={() => setViewMode("week")}
              className={`px-3 py-1.5 font-medium transition-colors ${
                viewMode === "week"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
              data-testid="button-lookup-week"
            >
              Week
            </button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => navigate(-1)}
            data-testid="button-lookup-prev"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium flex-1 text-center min-w-0 truncate">
            {rangeLabel}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => navigate(1)}
            data-testid="button-lookup-next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <input
            type="date"
            value={baseDate}
            onChange={(e) => e.target.value && setBaseDate(e.target.value)}
            className="h-8 text-sm border rounded px-2 bg-background w-[130px]"
            data-testid="input-lookup-date"
          />
        </div>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-3 pr-1">
            {dates.map((date) => {
              const data = getDayData(date);
              if (!data) return null;
              const { clinicDayAssigns, coverageDay, absence, providerStatuses, conflicts } = data;
              const weekend = isWeekendDate(date);
              const dateLabel = format(parseISO(date + "T12:00:00"), "EEE, MMM d");
              const hasContent =
                absence ||
                providerStatuses.length > 0 ||
                clinicDayAssigns.length > 0 ||
                coverageDay.length > 0 ||
                conflicts.length > 0;

              if (viewMode === "week" && !hasContent && weekend) return null;

              return (
                <div
                  key={date}
                  className={`rounded-lg border p-3 space-y-2.5 ${
                    weekend ? "bg-muted/30" : "bg-background"
                  }`}
                  data-testid={`lookup-day-${date}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">{dateLabel}</span>
                    <div className="flex items-center gap-1.5">
                      {absence && (
                        <Badge
                          className={`text-xs border ${ABSENCE_CHIP[absence.type] ?? "bg-gray-100 text-gray-700 border-gray-300"}`}
                        >
                          {absence.type}
                        </Badge>
                      )}
                      {conflicts.length > 0 && (
                        <Badge className="text-xs bg-red-100 text-red-800 border border-red-300">
                          {conflicts.length} conflict{conflicts.length > 1 ? "s" : ""}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {providerStatuses.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                        <Stethoscope className="h-3 w-3" />
                        {isProvider(member) ? "My Schedule" : "Provider Status"}
                      </p>
                      {providerStatuses.map((ps) => (
                        <div key={ps.id} className="flex items-center gap-2 text-xs flex-wrap">
                          <span className="font-medium min-w-[90px] truncate max-w-[140px]">
                            {ps.name}
                          </span>
                          <span className="text-muted-foreground text-[11px]">AM</span>
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[11px] font-medium ${
                              STATUS_CHIP[ps.am] ?? "bg-muted text-muted-foreground border-muted"
                            }`}
                          >
                            {ps.am}
                          </span>
                          <span className="text-muted-foreground text-[11px]">PM</span>
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[11px] font-medium ${
                              STATUS_CHIP[ps.pm] ?? "bg-muted text-muted-foreground border-muted"
                            }`}
                          >
                            {ps.pm}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {clinicDayAssigns.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Clinic Assignments
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {clinicDayAssigns.map((a) => (
                          <span
                            key={a.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium bg-blue-50 text-blue-800 border-blue-300"
                            data-testid={`lookup-clinic-${a.id}`}
                          >
                            {a.clinicName}
                            <span className="ml-0.5 px-1 py-0 rounded text-[10px] bg-blue-200 text-blue-900 font-semibold">
                              {a.shift}
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {coverageDay.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                        <UserCheck className="h-3 w-3" />
                        Covering For
                      </p>
                      {coverageDay.map((cr) => (
                        <div
                          key={cr.id}
                          className="flex items-center gap-1.5 text-xs"
                          data-testid={`lookup-coverage-${cr.id}`}
                        >
                          <span className="px-1.5 py-0.5 rounded border text-[11px] bg-green-50 text-green-800 border-green-300 font-medium">
                            {cr.coveredSpecialty}
                          </span>
                          <span className="text-muted-foreground">→ {cr.providerName}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {absence && (absence.note || absence.startDate !== absence.endDate) && (
                    <p className="text-[11px] text-muted-foreground">
                      {absence.note
                        ? `Note: ${absence.note}`
                        : `${absence.startDate} – ${absence.endDate}`}
                    </p>
                  )}

                  {!absence && providerStatuses.length === 0 && clinicDayAssigns.length === 0 && coverageDay.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-1">
                      No assignments or schedule data
                    </p>
                  )}

                  {conflicts.length > 0 && (
                    <div className="space-y-2 pt-1 border-t">
                      {conflicts.map((conflict, i) => (
                        <div
                          key={i}
                          className="rounded-md bg-red-50 border border-red-200 p-2.5 space-y-1.5"
                          data-testid={`lookup-conflict-${date}-${i}`}
                        >
                          <div className="flex items-start gap-1.5 text-xs text-red-800">
                            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-500" />
                            <span className="font-medium">{conflict.description}</span>
                          </div>
                          {conflict.suggestions.length > 0 ? (
                            <div className="flex items-start gap-1.5 text-xs">
                              <Lightbulb className="h-3.5 w-3.5 mt-0.5 shrink-0 text-yellow-500" />
                              <span className="text-muted-foreground">
                                <span className="font-medium text-foreground">Suggested: </span>
                                {conflict.suggestions.map((s, idx) => (
                                  <span key={s.id}>
                                    <span className="text-foreground">{s.name}</span>
                                    <span className="ml-0.5 mr-1 text-[10px] text-muted-foreground">
                                      {" "}· {s.role} · {s.specialty}
                                    </span>
                                    {idx < conflict.suggestions.length - 1 && "· "}
                                  </span>
                                ))}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Lightbulb className="h-3.5 w-3.5 text-yellow-500" />
                              <span>No available substitutes found</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
