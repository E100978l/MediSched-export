import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SPECIALTIES } from "@/lib/mockData";
import { useStaff, useUnavailability, useClinics, isStaffUnavailable } from "@/lib/store";
import {
  format, startOfQuarter, endOfQuarter, addDays, isWeekend,
  startOfWeek,
} from "date-fns";
import {
  Users, TrendingUp, CalendarOff, Stethoscope, ShieldCheck,
  ChevronRight, AlertCircle, RefreshCw, Calendar, ChevronDown, ChevronUp,
} from "lucide-react";

const CONFIRMED_FULL_TIME_RNS = 4;

export default function Dashboard() {
  const { staff, coverageHistory, isLoading: staffLoading, isError: staffError, refetch: staffRefetch } = useStaff();
  const { unavailability, isLoading: unavailLoading, isError: unavailError, refetch: unavailRefetch } = useUnavailability();
  const { assignments: clinicAssignments, isLoading: clinicsLoading, isError: clinicsError, refetch: clinicsRefetch } = useClinics();
  const isLoading = staffLoading || unavailLoading || clinicsLoading;
  const isError = staffError || unavailError || clinicsError;
  const refetch = () => { staffRefetch(); unavailRefetch(); clinicsRefetch(); };

  const [showWeekCalendar, setShowWeekCalendar] = useState(false);
  const [showClinicDetails, setShowClinicDetails] = useState(false);

  const now = new Date();
  const today = format(now, 'yyyy-MM-dd');
  const thisMonth = format(now, 'yyyy-MM');

  // --- Staff counts by role ---
  const providerCount = staff.filter(s => ['MD', 'DO', 'NP', 'PA'].includes(s.role)).length;
  const lvnCount = staff.filter(s => s.role === 'LVN').length;
  const rnCount = staff.filter(s => s.role === 'RN').length;

  // --- Out today ---
  const outToday = staff.filter(s => !!isStaffUnavailable(unavailability, s.id, today));
  const outTodayIds = new Set(outToday.map(s => s.id));

  // --- Available counts (exclude vacation/sick/leave) ---
  const availableProviderCount = providerCount - outToday.filter(s => ['MD', 'DO', 'NP', 'PA'].includes(s.role)).length;
  const availableLvnCount = lvnCount - outToday.filter(s => s.role === 'LVN').length;
  const availableRnCount = rnCount - outToday.filter(s => s.role === 'RN').length;

  // --- Week calendar (Mon–Fri of current week) for Out Today ---
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i));

  // Med Home 1 and Med Home 2 are the same specialty family — moves between them
  // are NOT cross-coverage (they share the same 2nd-floor patient population).
  const MED_HOME = new Set([
    'Internal/Family Med (Met Home 1)',
    'Internal/Family Med (Met Home 2)',
  ]);
  const isSameFamily = (a: string, b: string) => MED_HOME.has(a) && MED_HOME.has(b);

  // --- Cross-coverage this month ---
  const coverageThisMonth = coverageHistory.filter(h =>
    h.date.startsWith(thisMonth) &&
    h.coveredSpecialty !== h.originalSpecialty &&
    !isSameFamily(h.coveredSpecialty, h.originalSpecialty)
  );

  // --- Clinic assignments today ---
  const clinicAssignmentsToday = clinicAssignments.filter(a => a.date === today);

  // --- Quarterly rotation stats ---
  const qStart = startOfQuarter(now);
  const qEnd = endOfQuarter(now);
  const qStartStr = format(qStart, 'yyyy-MM-dd');
  const qEndStr = format(qEnd, 'yyyy-MM-dd');
  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  const quarterLabel = `Q${quarter} ${now.getFullYear()}`;
  const quarterEndLabel = format(qEnd, 'MMM d');

  const nurses = staff.filter(s => s.role === 'LVN' || s.role === 'RN');
  const crossThisQuarter = coverageHistory.filter(h =>
    h.date >= qStartStr && h.date <= qEndStr &&
    h.coveredSpecialty !== h.originalSpecialty &&
    !isSameFamily(h.coveredSpecialty, h.originalSpecialty)
  );
  const nursesWithCross = new Set(crossThisQuarter.map(h => h.staffId));
  const crossPct = nurses.length > 0 ? Math.round((nursesWithCross.size / nurses.length) * 100) : 0;

  // Specialty bar max: highest count among all specialties (avoids hardcoded /10)
  const specCounts = SPECIALTIES.map(spec => staff.filter(s => s.specialty === spec).length);
  const maxSpecCount = Math.max(...specCounts, 1);

  // --- Upcoming clinic assignments (next 7 weekdays) ---
  const upcomingDays = Array.from({ length: 14 }, (_, i) => addDays(now, i + 1))
    .filter(d => !isWeekend(d))
    .slice(0, 7);
  const upcomingAssignments = upcomingDays.flatMap(d => {
    const ds = format(d, 'yyyy-MM-dd');
    return clinicAssignments
      .filter(a => a.date === ds)
      .map(a => ({ ...a, dateObj: d, dateStr: ds }));
  });

  // --- Available staff count for a given date (nurses not out) ---
  const availableNursesOnDay = (dateStr: string): number => {
    return nurses.filter(s => !isStaffUnavailable(unavailability, s.id, dateStr)).length;
  };

  // --- Cross-coverage: LVN-only (per union rules) ---
  const lvnCrossThisMonth = coverageThisMonth.filter(h => {
    const member = staff.find(s => s.id === h.staffId);
    return member?.role === 'LVN';
  });

  if (isLoading) {
    return (
      <AppLayout>
        <div className="p-8 flex items-center justify-center min-h-[50vh]" data-testid="dashboard-loading">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            <p className="text-sm">Loading dashboard data…</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (isError) {
    return (
      <AppLayout>
        <div className="p-8 flex items-center justify-center min-h-[50vh]" data-testid="dashboard-error">
          <div className="flex flex-col items-center gap-3 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="font-medium">Failed to load dashboard data</p>
            <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
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
      <div className="p-8 space-y-8 max-w-7xl mx-auto">
        <div>
          <h2 className="text-3xl font-bold tracking-tight font-heading text-foreground">Dashboard</h2>
          <p className="text-muted-foreground mt-1">
            Overview of clinic staffing, coverage, and rotation status.
          </p>
        </div>

        {/* Stats Grid — Row 1: Providers | LVNs | RNs | Out Today */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">

          {/* Providers Card */}
          <Card data-testid="card-total-providers">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Providers</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-total-providers">{providerCount}</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Active Today:{" "}
                <span className={availableProviderCount < providerCount ? "text-amber-600 font-semibold" : "font-semibold"}>
                  {availableProviderCount}
                </span>
                {availableProviderCount < providerCount && (
                  <span className="ml-1 text-amber-500">({providerCount - availableProviderCount} out)</span>
                )}
              </p>
            </CardContent>
          </Card>

          {/* LVNs Card */}
          <Card data-testid="card-total-lvns">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">LVNs</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-total-lvns">{lvnCount}</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Available Today:{" "}
                <span className={availableLvnCount < lvnCount ? "text-amber-600 font-semibold" : "font-semibold"}>
                  {availableLvnCount}
                </span>
                {availableLvnCount < lvnCount && (
                  <span className="ml-1 text-amber-500">({lvnCount - availableLvnCount} out)</span>
                )}
              </p>
            </CardContent>
          </Card>

          {/* RNs Card */}
          <Card data-testid="card-total-rns">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">RNs</CardTitle>
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-total-rns">{rnCount}</div>
              <div className="space-y-0.5 mt-0.5">
                <p className="text-xs text-muted-foreground">
                  Full-Time (Confirmed):{" "}
                  <span className="font-semibold text-foreground" data-testid="text-fulltime-rns">
                    {CONFIRMED_FULL_TIME_RNS}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Available Today:{" "}
                  <span className={availableRnCount < rnCount ? "text-amber-600 font-semibold" : "font-semibold"}>
                    {availableRnCount}
                  </span>
                  {availableRnCount < rnCount && (
                    <span className="ml-1 text-amber-500">({rnCount - availableRnCount} out)</span>
                  )}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Out Today Card — with week calendar toggle */}
          <Card className={outToday.length > 0 ? 'border-amber-200' : ''} data-testid="card-out-today">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Out Today</CardTitle>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  title="Week overview"
                  data-testid="button-week-calendar-toggle"
                  onClick={() => setShowWeekCalendar(v => !v)}
                >
                  <Calendar className={`h-4 w-4 ${showWeekCalendar ? 'text-primary' : 'text-muted-foreground'}`} />
                </Button>
                <CalendarOff className={`h-4 w-4 ${outToday.length > 0 ? 'text-amber-500' : 'text-muted-foreground'}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${outToday.length > 0 ? 'text-amber-600' : ''}`} data-testid="text-out-today">
                {outToday.length}
              </div>
              <p className="text-xs text-muted-foreground">
                {outToday.length === 0
                  ? 'All staff present today'
                  : outToday.slice(0, 2).map(s => s.name.split(' ')[0]).join(', ') +
                    (outToday.length > 2 ? ` +${outToday.length - 2} more` : '')}
              </p>

              {/* Week calendar mini-view */}
              {showWeekCalendar && (
                <div className="mt-3 border-t border-border pt-3 space-y-1.5" data-testid="week-calendar-overview">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                    This Week — {format(weekStart, 'MMM d')}–{format(addDays(weekStart, 4), 'MMM d')}
                  </p>
                  {weekDays.map(d => {
                    const ds = format(d, 'yyyy-MM-dd');
                    const outOnDay = staff.filter(s => !!isStaffUnavailable(unavailability, s.id, ds));
                    const isToday = ds === today;
                    return (
                      <div key={ds} className={`flex items-start gap-1.5 text-xs rounded px-1.5 py-1 ${isToday ? 'bg-primary/8 border border-primary/20' : ''}`}>
                        <span className={`w-8 shrink-0 font-medium ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
                          {format(d, 'EEE')}
                        </span>
                        {outOnDay.length === 0 ? (
                          <span className="text-green-600 text-[11px]">All in</span>
                        ) : (
                          <span className="text-amber-700 text-[11px] leading-snug">
                            {outOnDay.map(s => s.name.split(' ')[0]).join(', ')}
                            <span className="text-muted-foreground ml-1">({outOnDay.length})</span>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Stats Grid — Row 2: LVN Cross-Coverage | Clinic Assignments Today */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card data-testid="card-cross-coverage">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">LVN Cross-Coverage This Month</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-cross-coverage">{lvnCrossThisMonth.length}</div>
              <p className="text-xs text-muted-foreground">
                {format(now, 'MMMM yyyy')} · LVN cross-specialty shifts only
              </p>
            </CardContent>
          </Card>

          {/* Specialty Clinics Assigned Today — with View Details */}
          <Card data-testid="card-clinic-today">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Specialty Clinics Assigned Today</CardTitle>
              <div className="flex items-center gap-1">
                {clinicAssignmentsToday.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs px-2 gap-0.5"
                    data-testid="button-clinic-details-toggle"
                    onClick={() => setShowClinicDetails(v => !v)}
                  >
                    View Details
                    {showClinicDetails ? (
                      <ChevronUp className="h-3 w-3 ml-0.5" />
                    ) : (
                      <ChevronDown className="h-3 w-3 ml-0.5" />
                    )}
                  </Button>
                )}
                <Stethoscope className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-clinic-today">{clinicAssignmentsToday.length}</div>
              <p className="text-xs text-muted-foreground">
                {clinicAssignmentsToday.length === 1
                  ? '1 staff on clinic duty'
                  : `${clinicAssignmentsToday.length} staff on clinic duty`}
              </p>

              {/* Expanded clinic assignment details */}
              {showClinicDetails && clinicAssignmentsToday.length > 0 && (
                <div className="mt-3 border-t border-border pt-3 space-y-1.5" data-testid="clinic-details-expanded">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                    Today's Assignments — {format(now, 'EEEE, MMM d')}
                  </p>
                  {clinicAssignmentsToday.map(a => (
                    <div
                      key={a.id}
                      className="flex items-center gap-2 bg-primary/5 border border-primary/10 rounded px-2.5 py-1.5"
                      data-testid={`clinic-assignment-detail-${a.id}`}
                    >
                      <span className="text-xs font-medium flex-1">{a.staffName}</span>
                      <Badge variant="outline" className="text-[10px] h-4 px-1">{a.clinicName}</Badge>
                      <span className="text-[10px] text-muted-foreground">{a.shift}</span>
                      <Badge
                        variant="secondary"
                        className="text-[10px] h-4 px-1 capitalize"
                      >
                        {a.staffRole}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Staff out today detail panel */}
        {outToday.length > 0 && (
          <Card className="border-amber-200 bg-amber-50/30" data-testid="card-out-today-detail">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-amber-700 text-sm">
                <CalendarOff className="w-4 h-4" />
                Staff Out Today — {format(now, 'EEEE, MMMM d')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {outToday.map(s => {
                  const rec = isStaffUnavailable(unavailability, s.id, today)!;
                  return (
                    <div key={s.id}
                      className="flex items-center gap-1.5 bg-white border border-amber-200 rounded-md px-3 py-1.5 shadow-xs"
                      data-testid={`chip-out-today-${s.id}`}>
                      <span className="text-sm font-medium">{s.name}</span>
                      <span className="text-xs text-muted-foreground">({s.role})</span>
                      <Badge variant="outline" className="text-[10px] px-1 h-4 border-amber-400 text-amber-700 ml-1">
                        {rec.type}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Upcoming Clinic Assignments (next 7 weekdays) — with Available Staff count */}
        <Card data-testid="card-upcoming-assignments">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ChevronRight className="w-4 h-4 text-primary" />
              Upcoming Clinic Assignments — Next 7 Weekdays
            </CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingDays.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No upcoming clinic assignments found.</p>
            ) : (
              <div className="space-y-2">
                {upcomingDays.map(d => {
                  const ds = format(d, 'yyyy-MM-dd');
                  const dayAssignments = upcomingAssignments.filter(a => a.dateStr === ds);
                  const availableStaff = availableNursesOnDay(ds);
                  return (
                    <div key={ds} className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0">
                      <div className="w-24 shrink-0 text-xs font-medium text-muted-foreground">{format(d, 'EEE, MMM d')}</div>
                      {dayAssignments.length === 0 ? (
                        <span className="text-xs text-muted-foreground italic flex-1">No clinic assignments</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 flex-1">
                          {dayAssignments.map(a => (
                            <div key={a.id} className="flex items-center gap-1 bg-primary/5 border border-primary/10 rounded px-2 py-0.5">
                              <span className="text-xs font-medium">{a.staffName}</span>
                              <Badge variant="outline" className="text-[10px] h-4 px-1">{a.clinicName}</Badge>
                              <span className="text-[10px] text-muted-foreground">{a.shift}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div
                        className="shrink-0 text-[11px] text-muted-foreground whitespace-nowrap"
                        data-testid={`available-staff-${ds}`}
                        title="Available nurses (LVNs + RNs) not on leave"
                      >
                        <span className="font-medium text-foreground">{availableStaff}</span> avail.
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Specialty Breakdown + Quarterly Rotation */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card className="col-span-2">
            <CardHeader>
              <CardTitle>Staffing by Specialty</CardTitle>
            </CardHeader>
            <CardContent>
              {staff.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No staff added yet.</p>
              ) : (
                <div className="space-y-3">
                  {SPECIALTIES.map((spec, i) => {
                    const count = staff.filter(s => s.specialty === spec).length;
                    if (count === 0) return null;
                    return (
                      <div key={spec} className="flex items-center gap-3">
                        <div className="w-52 text-sm font-medium text-muted-foreground truncate shrink-0">{spec}</div>
                        <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${(count / maxSpecCount) * 100}%` }}
                          />
                        </div>
                        <div className="text-sm font-bold w-6 text-right shrink-0">{count}</div>
                      </div>
                    );
                  })}
                  {SPECIALTIES.every(spec => staff.filter(s => s.specialty === spec).length === 0) && (
                    <p className="text-sm text-muted-foreground italic">No specialty assignments yet.</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quarterly Rotation Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="p-4 border border-border rounded-lg bg-accent/10">
                  <div className="text-sm font-medium mb-1">Current Cycle</div>
                  <div className="text-2xl font-bold text-primary" data-testid="text-quarter">{quarterLabel}</div>
                  <div className="text-xs text-muted-foreground mt-1">Ends {quarterEndLabel}</div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Cross-Coverage Participation</span>
                    <span className="font-bold" data-testid="text-cross-pct">{crossPct}%</span>
                  </div>
                  <div className="h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${crossPct >= 75 ? 'bg-green-500' : crossPct >= 40 ? 'bg-amber-400' : 'bg-red-400'}`}
                      style={{ width: `${crossPct}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {nursesWithCross.size} of {nurses.length} LVNs/RNs covered cross-specialty this quarter
                  </p>
                </div>

                {crossThisQuarter.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1.5">
                    <ShieldCheck className="w-3 h-3 shrink-0" />
                    {crossThisQuarter.length} cross-specialty shift{crossThisQuarter.length !== 1 ? 's' : ''} logged this quarter
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
