import { useState, useMemo, useCallback } from "react";
import { format, parseISO, startOfMonth, endOfMonth, subMonths, isWeekend } from "date-fns";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, FileText, Table2, AlertTriangle, Phone, Mail, Copy, AlertCircle, RefreshCw, Check, Printer, CalendarDays } from "lucide-react";
import {
  useStaff, useClinics, useUnavailability, useRnAssignments, useProviderSchedules,
  isStaffUnavailable, isClinicOpen,
} from "@/lib/store";
import { RN_POSITIONS } from "@shared/schema";
import { toast } from "@/hooks/use-toast";
import ExcelJS from "exceljs";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ── Schedule-export palettes (mirrors Schedule.tsx) ───────────────────────────
const SPECIALTY_PALETTE: Record<string, { bg: string; headerBg: string; headerColor: string }> = {
  "Internal Medicine": { bg: "#eff6ff", headerBg: "#1d4ed8", headerColor: "#ffffff" },
  "Family Medicine":   { bg: "#f0fdf4", headerBg: "#15803d", headerColor: "#ffffff" },
  "Pediatrics":        { bg: "#fdf4ff", headerBg: "#7e22ce", headerColor: "#ffffff" },
  "OB/GYN":            { bg: "#fff7ed", headerBg: "#c2410c", headerColor: "#ffffff" },
  "Cardiology":        { bg: "#fef2f2", headerBg: "#b91c1c", headerColor: "#ffffff" },
};
const DEFAULT_PALETTE  = { bg: "#f1f5f9", headerBg: "#475569", headerColor: "#ffffff" };
const CLINIC_PALETTE   = { bg: "#f0fdf4", headerBg: "#166534", headerColor: "#ffffff" };

const today = new Date();

function fmtDate(d: string) {
  try { return format(parseISO(d), "MM/dd/yyyy"); } catch { return d; }
}

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

export default function Reports() {
  const { staff, coverageHistory, isLoading: staffLoading, isError: staffError, refetch: staffRefetch } = useStaff();
  const { clinics, assignments, overrides, isLoading: clinicsLoading, isError: clinicsError, refetch: clinicsRefetch } = useClinics();
  const { unavailability } = useUnavailability();
  const isLoading = staffLoading || clinicsLoading;
  const isError = staffError || clinicsError;
  const refetch = () => { staffRefetch(); clinicsRefetch(); };

  const [startDate, setStartDate] = useState(format(startOfMonth(subMonths(today, 2)), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(format(endOfMonth(today), "yyyy-MM-dd"));
  const [roleFilter, setRoleFilter] = useState<"All" | "LVN" | "RN">("All");
  const [exportFormat, setExportFormat] = useState<"excel" | "pdf">("excel");

  // ── Schedule Export state ────────────────────────────────────────────────────
  const [exportDate, setExportDate] = useState(format(today, "yyyy-MM-dd"));
  const [copiedSchedule, setCopiedSchedule] = useState(false);
  const [downloadedSchedule, setDownloadedSchedule] = useState(false);

  const exportRangeStart = `${new Date().getFullYear() - 1}-01-01`;
  const exportRangeEnd   = `${new Date().getFullYear() + 1}-12-31`;
  const { schedules: dbSchedules } = useProviderSchedules(exportRangeStart, exportRangeEnd);
  const { assignments: clinicAssignmentsAll } = useClinics();
  const { assignments: rnAssignmentsExport } = useRnAssignments(exportDate);

  const scheduleState = useMemo(() => {
    const map: Record<string, { providerId: string; date: string; am: string; pm: string; assignments: { lvnId: string; status: string; clinicAssignment: string | null }[] }> = {};
    dbSchedules.forEach((s: any) => {
      map[`${s.providerId}-${s.date}`] = {
        providerId: s.providerId,
        date: s.date,
        am: s.am,
        pm: s.pm,
        assignments: (s.assignments ?? []).map((a: any) => ({ lvnId: a.lvnId, status: a.status ?? 'Active', clinicAssignment: a.clinicAssignment ?? null })),
      };
    });
    return map;
  }, [dbSchedules]);

  const getExportDayState = useCallback((providerId: string, dateStr: string) => {
    const key = `${providerId}-${dateStr}`;
    return scheduleState[key] || {
      providerId,
      date: dateStr,
      am: isWeekend(new Date(dateStr + 'T12:00:00')) ? 'Off' : 'Patient Care',
      pm: isWeekend(new Date(dateStr + 'T12:00:00')) ? 'Off' : 'Patient Care',
      assignments: staff.filter((s: any) => s.assignedTo?.includes(providerId)).map((lvn: any) => ({
        lvnId: lvn.id, status: 'Active', clinicAssignment: null,
      })),
    };
  }, [scheduleState, staff]);

  const buildScheduleHtml = useCallback((dateStr: string) => {
    const dateLabel = format(new Date(dateStr + 'T12:00:00'), 'EEEE, MMMM d, yyyy');
    const cell = (content: string, style = '') =>
      `<td style="padding:5px 8px;border:1px solid #cbd5e1;font-size:12px;${style}">${content}</td>`;
    const headerCell = (content: string, colspan = 1, bg = '#1e293b', color = '#fff') =>
      `<td colspan="${colspan}" style="padding:5px 8px;border:1px solid #cbd5e1;font-size:12px;font-weight:bold;background:${bg};color:${color};">${content}</td>`;
    const row = (cells: string, bg = '') =>
      `<tr style="${bg ? `background:${bg};` : ''}">${cells}</tr>`;

    const allProviders = staff.filter((s: any) => ['MD', 'DO', 'NP', 'PA'].includes(s.role));
    const allDayState = allProviders.map((p: any) => getExportDayState(p.id, dateStr));
    const groupedBySpecialty: Record<string, typeof allDayState> = {};
    allDayState.forEach((r: any) => {
      const spec = allProviders.find((s: any) => s.id === r.providerId)?.specialty ?? 'Other';
      if (!groupedBySpecialty[spec]) groupedBySpecialty[spec] = [];
      groupedBySpecialty[spec].push(r);
    });

    const lvnCellContent = (provAssignments: any[]) => {
      if (!provAssignments.length) return '<span style="color:#94a3b8;font-style:italic;">—</span>';
      return provAssignments.map((a: any) => {
        const lvn = staff.find((s: any) => s.id === a.lvnId);
        const absent = isStaffUnavailable(unavailability, a.lvnId, dateStr);
        const name = lvn?.name ?? a.lvnId;
        const tags: string[] = [];
        if (absent) tags.push(`<span style="color:#dc2626;">[${(absent as any).type}]</span>`);
        if (a.status !== 'Active') tags.push(`<span style="color:#ea580c;">[${a.status}]</span>`);
        if (a.clinicAssignment) tags.push(`<span style="color:#0891b2;">→ ${a.clinicAssignment}</span>`);
        return `<span style="font-weight:500;">${name}</span>${tags.length ? ' ' + tags.join(' ') : ''}`;
      }).join('<br/>');
    };

    let providerRowsHtml = '';
    Object.entries(groupedBySpecialty).forEach(([specialty, rows]) => {
      const palette = SPECIALTY_PALETTE[specialty] ?? DEFAULT_PALETTE;
      providerRowsHtml += row(headerCell(specialty, 4, palette.headerBg, palette.headerColor));
      rows.forEach((r: any) => {
        const provider = allProviders.find((s: any) => s.id === r.providerId);
        const amColor = r.am === 'Patient Care' ? '#166534' : r.am === 'Off' ? '#64748b' : '#92400e';
        const pmColor = r.pm === 'Patient Care' ? '#166534' : r.pm === 'Off' ? '#64748b' : '#92400e';
        providerRowsHtml += row([
          cell(provider?.name ?? r.providerId),
          cell(`<span style="color:${amColor};font-weight:500;">${r.am}</span>`),
          cell(`<span style="color:${pmColor};font-weight:500;">${r.pm}</span>`),
          cell(lvnCellContent(r.assignments), 'width:220px;'),
        ].join(''), palette.bg);
      });
    });

    const activeClinics = clinics.filter((c: any) => isClinicOpen(c, overrides, dateStr));
    let clinicRowsHtml = '';
    if (activeClinics.length > 0) {
      clinicRowsHtml += row(`<td colspan="4" style="padding:6px;border:none;background:#f8fafc;">&nbsp;</td>`);
      clinicRowsHtml += row(headerCell('SPECIALTY CLINICS', 4, CLINIC_PALETTE.headerBg, CLINIC_PALETTE.headerColor));
      activeClinics.forEach((clinic: any) => {
        const assigned = clinicAssignmentsAll.filter((a: any) => a.clinicId === clinic.id && a.date === dateStr);
        const staffDisplay = assigned.length > 0
          ? assigned.map((a: any) => `<span style="font-weight:500;">${a.staffName}</span>`).join('<br/>')
          : '<span style="color:#dc2626;font-style:italic;">Needs coverage</span>';
        const filledStatus = `<span style="color:${assigned.length >= clinic.staffNeeded ? '#166534' : '#dc2626'};font-weight:500;">${assigned.length}/${clinic.staffNeeded} filled</span>`;
        clinicRowsHtml += row([
          cell(`<strong>${clinic.name}</strong>`),
          cell(`${clinic.startTime} – ${clinic.endTime}`, 'color:#475569;'),
          cell(filledStatus),
          cell(staffDisplay, 'width:220px;'),
        ].join(''), CLINIC_PALETTE.bg);
      });
    }

    let rnRowsHtml = '';
    rnRowsHtml += row(`<td colspan="4" style="padding:6px;border:none;background:#f8fafc;">&nbsp;</td>`);
    rnRowsHtml += row(headerCell('RN CHARGE ASSIGNMENTS', 4, '#1e40af', '#ffffff'));
    ([...RN_POSITIONS] as any[]).forEach((pos: any) => {
      const assignment = rnAssignmentsExport.find((a: any) => a.positionId === pos.id);
      const rnDisplay = assignment
        ? `<span style="font-weight:500;">${assignment.rnName}</span>`
        : '<span style="color:#94a3b8;font-style:italic;">— Unassigned</span>';
      rnRowsHtml += row([
        cell(`<strong style="color:${pos.headerBg};">${pos.label}</strong><br/><span style="font-size:10px;color:#64748b;">${pos.areas.join(', ')}</span>`),
        cell('&nbsp;'), cell('&nbsp;'),
        cell(rnDisplay, 'width:220px;'),
      ].join(''), '#eff6ff');
    });

    return {
      html: `<html><body>
<p style="font-family:Arial;font-size:13px;font-weight:bold;margin-bottom:4px;">Daily Schedule — ${dateLabel}</p>
<p style="font-family:Arial;font-size:11px;color:#64748b;margin-top:0;margin-bottom:8px;">Generated by MediSched · ${format(new Date(), 'MMM d, yyyy h:mm a')}</p>
<table style="border-collapse:collapse;font-family:Arial;font-size:12px;width:100%;max-width:750px;">
  <thead><tr style="background:#1e293b;color:#fff;">
    <th style="padding:6px 8px;border:1px solid #334155;text-align:left;">Provider</th>
    <th style="padding:6px 8px;border:1px solid #334155;text-align:left;width:90px;">AM</th>
    <th style="padding:6px 8px;border:1px solid #334155;text-align:left;width:90px;">PM</th>
    <th style="padding:6px 8px;border:1px solid #334155;text-align:left;">LVN / Staff</th>
  </tr></thead>
  <tbody>${providerRowsHtml}${clinicRowsHtml}${rnRowsHtml}</tbody>
</table></body></html>`,
      groupedBySpecialty,
      allProviders,
      allDayState,
      activeClinics,
      dateLabel,
    };
  }, [staff, unavailability, clinics, overrides, clinicAssignmentsAll, rnAssignmentsExport, getExportDayState]);

  const handleCopyColorGrid = useCallback(async () => {
    const { html } = buildScheduleHtml(exportDate);
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
    if (!copied) {
      try {
        const htmlBlob = new Blob([html], { type: 'text/html' });
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': htmlBlob })]);
      } catch {
        toast({ title: "Copy failed", description: "Browser blocked clipboard access.", variant: "destructive" });
        return;
      }
    }
    setCopiedSchedule(true);
    toast({ title: "Copied!", description: "Formatted color table copied — paste directly into Outlook or Gmail." });
    setTimeout(() => setCopiedSchedule(false), 2500);
  }, [buildScheduleHtml, exportDate]);

  const handleDownloadScheduleExcel = useCallback(async () => {
    const { groupedBySpecialty, allProviders, activeClinics, dateLabel } = buildScheduleHtml(exportDate);
    const rows: string[][] = [];
    rows.push([`Daily Schedule — ${dateLabel}`, '', '', '']);
    rows.push([`Generated by MediSched · ${format(new Date(), 'MMM d, yyyy h:mm a')}`, '', '', '']);
    rows.push(['', '', '', '']);
    rows.push(['Provider', 'AM', 'PM', 'LVN / Staff']);
    Object.entries(groupedBySpecialty).forEach(([specialty, specRows]) => {
      rows.push([`— ${specialty} —`, '', '', '']);
      (specRows as any[]).forEach((r: any) => {
        const provider = (allProviders as any[]).find((s: any) => s.id === r.providerId);
        const activeAssignments = r.assignments.filter((a: any) => a.status === 'Active');
        const lvnValue = activeAssignments.length > 0
          ? activeAssignments.map((a: any) => staff.find((s: any) => s.id === a.lvnId)?.name ?? a.lvnId).join(', ')
          : '— Unassigned';
        rows.push([provider?.name ?? r.providerId, r.am, r.pm, lvnValue]);
      });
    });
    rows.push(['', '', '', '']);
    if ((activeClinics as any[]).length > 0) {
      rows.push(['SPECIALTY CLINICS', '', '', '']);
      rows.push(['Clinic', 'Time', 'Filled', 'Staff Assigned']);
      (activeClinics as any[]).forEach((clinic: any) => {
        const assigned = clinicAssignmentsAll.filter((a: any) => a.clinicId === clinic.id && a.date === exportDate);
        rows.push([clinic.name, `${clinic.startTime} – ${clinic.endTime}`, `${assigned.length}/${clinic.staffNeeded}`, assigned.map((a: any) => a.staffName).join(', ') || '— Needs coverage']);
      });
      rows.push(['', '', '', '']);
    }
    rows.push(['RN CHARGE ASSIGNMENTS', '', '', '']);
    rows.push(['Position', 'Areas', '', 'Assigned RN']);
    ([...RN_POSITIONS] as any[]).forEach((pos: any) => {
      const assignment = rnAssignmentsExport.find((a: any) => a.positionId === pos.id);
      rows.push([pos.label, pos.areas.join(', '), '', assignment ? assignment.rnName : '— Unassigned']);
    });
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Day Schedule');
    ws.addRows(rows);
    [30, 14, 14, 36].forEach((width, idx) => {
      ws.getColumn(idx + 1).width = width;
    });
    rows.forEach((r, i) => {
      if (r[1] === '' && r[2] === '' && r[3] === '') ws.mergeCells(i + 1, 1, i + 1, 4);
    });
    await downloadWorkbook(workbook, `MediSched_${exportDate}.xlsx`);
    setDownloadedSchedule(true);
    toast({ title: "Downloaded!", description: `MediSched_${exportDate}.xlsx saved.` });
    setTimeout(() => setDownloadedSchedule(false), 3000);
  }, [buildScheduleHtml, exportDate, clinicAssignmentsAll, rnAssignmentsExport, staff]);

  const handlePrintSchedule = useCallback(() => {
    const { html } = buildScheduleHtml(exportDate);
    const win = window.open('', '_blank');
    if (!win) { toast({ title: "Popup blocked", description: "Allow popups to use Print.", variant: "destructive" }); return; }
    const body = html.replace('<html><body>', '').replace('</body></html>', '');
    win.document.write(`<!DOCTYPE html><html><head><title>MediSched — ${exportDate}</title>
<style>body{font-family:Arial,sans-serif;margin:16px;}@media print{body{margin:0;}}</style>
</head><body>${body}<script>window.onload=function(){window.print();window.close();};<\/script></body></html>`);
    win.document.close();
  }, [buildScheduleHtml, exportDate]);

  // --- Cross-coverage report ---
  const filteredCoverage = useMemo(() => {
    return coverageHistory.filter(r =>
      r.date >= startDate && r.date <= endDate &&
      (roleFilter === "All" || staff.find(s => s.id === r.staffId)?.role === roleFilter)
    );
  }, [coverageHistory, startDate, endDate, roleFilter, staff]);

  // Summary by staff member
  const staffSummary = useMemo(() => {
    const map = new Map<string, {
      staffId: string; staffName: string; role: string; specialty: string;
      totalCoverage: number;
      coverageByProvider: Map<string, { providerName: string; coveredSpecialty: string; count: number; dates: string[] }>;
    }>();

    filteredCoverage.forEach(r => {
      if (!map.has(r.staffId)) {
        const member = staff.find(s => s.id === r.staffId);
        map.set(r.staffId, {
          staffId: r.staffId,
          staffName: r.staffName,
          role: member?.role ?? "LVN",
          specialty: r.originalSpecialty,
          totalCoverage: 0,
          coverageByProvider: new Map(),
        });
      }
      const entry = map.get(r.staffId)!;
      entry.totalCoverage++;
      const provKey = r.providerId;
      if (!entry.coverageByProvider.has(provKey)) {
        entry.coverageByProvider.set(provKey, {
          providerName: r.providerName,
          coveredSpecialty: r.coveredSpecialty,
          count: 0,
          dates: [],
        });
      }
      const prov = entry.coverageByProvider.get(provKey)!;
      prov.count++;
      prov.dates.push(r.date);
    });

    return Array.from(map.values()).sort((a, b) => b.totalCoverage - a.totalCoverage);
  }, [filteredCoverage, staff]);

  // --- Clinic assignments report ---
  const filteredAssignments = useMemo(() => {
    return assignments.filter(a => a.date >= startDate && a.date <= endDate);
  }, [assignments, startDate, endDate]);

  const clinicSummary = useMemo(() => {
    const map = new Map<string, {
      staffId: string; staffName: string; role: string;
      clinicBreakdown: Map<string, { clinicName: string; count: number; dates: string[] }>;
      total: number;
    }>();

    filteredAssignments.forEach(a => {
      if (!map.has(a.staffId)) {
        map.set(a.staffId, { staffId: a.staffId, staffName: a.staffName, role: a.staffRole, clinicBreakdown: new Map(), total: 0 });
      }
      const entry = map.get(a.staffId)!;
      entry.total++;
      if (!entry.clinicBreakdown.has(a.clinicId)) {
        entry.clinicBreakdown.set(a.clinicId, { clinicName: a.clinicName, count: 0, dates: [] });
      }
      const cb = entry.clinicBreakdown.get(a.clinicId)!;
      cb.count++;
      cb.dates.push(a.date);
    });

    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filteredAssignments]);

  // --- Scheduling Conflicts Detection ---
  // Find cases where the same staff member has both a clinic assignment AND a coverage record on the same date
  const schedulingConflicts = useMemo(() => {
    const conflicts: {
      staffId: string; staffName: string; role: string; phone?: string; email?: string;
      date: string; type: string; details: string;
    }[] = [];

    // Conflict type 1: Staff assigned to a clinic AND logged as coverage provider on same date
    filteredAssignments.forEach(a => {
      const sameDayCoverage = filteredCoverage.filter(
        c => c.staffId === a.staffId && c.date === a.date
      );
      if (sameDayCoverage.length > 0) {
        const member = staff.find(s => s.id === a.staffId);
        sameDayCoverage.forEach(cov => {
          conflicts.push({
            staffId: a.staffId,
            staffName: a.staffName,
            role: a.staffRole,
            phone: member?.phone ?? undefined,
            email: member?.email ?? undefined,
            date: a.date,
            type: "Double Assignment",
            details: `Assigned to ${a.clinicName} clinic AND providing coverage for ${cov.providerName} (${cov.coveredSpecialty}) on same day`,
          });
        });
      }
    });

    // Conflict type 2: Staff assigned to multiple clinics on same date
    const clinicsByDateStaff = new Map<string, typeof filteredAssignments>();
    filteredAssignments.forEach(a => {
      const key = `${a.staffId}__${a.date}`;
      if (!clinicsByDateStaff.has(key)) clinicsByDateStaff.set(key, []);
      clinicsByDateStaff.get(key)!.push(a);
    });
    clinicsByDateStaff.forEach((aList) => {
      if (aList.length > 1) {
        const a = aList[0];
        const member = staff.find(s => s.id === a.staffId);
        const clinicNames = aList.map(x => x.clinicName).join(", ");
        conflicts.push({
          staffId: a.staffId,
          staffName: a.staffName,
          role: a.staffRole,
          phone: member?.phone ?? undefined,
          email: member?.email ?? undefined,
          date: a.date,
          type: "Multi-Clinic Overlap",
          details: `Assigned to multiple clinics on same day: ${clinicNames}`,
        });
      }
    });

    // Conflict type 3: RN appearing in coverage records (policy violation — should be LVN only)
    filteredCoverage.forEach(c => {
      const member = staff.find(s => s.id === c.staffId);
      if (member?.role === 'RN') {
        conflicts.push({
          staffId: c.staffId,
          staffName: c.staffName,
          role: 'RN',
          phone: member?.phone ?? undefined,
          email: member?.email ?? undefined,
          date: c.date,
          type: "Policy Violation",
          details: `RN (${c.staffName}) recorded as provider fill-in for ${c.providerName} — RNs are excluded from provider coverage per policy`,
        });
      }
    });

    return conflicts.sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredAssignments, filteredCoverage, staff]);

  async function handleCopyConflictsToOutlook() {
    const lines: string[] = [
      `MediSched — Scheduling Conflict Report`,
      `Date Range: ${fmtDate(startDate)} – ${fmtDate(endDate)}`,
      `Generated: ${format(today, "MM/dd/yyyy HH:mm")}`,
      `Total Conflicts Detected: ${schedulingConflicts.length}`,
      "",
    ];
    schedulingConflicts.forEach((c, i) => {
      lines.push(`${i + 1}. [${c.type}] — ${fmtDate(c.date)}`);
      lines.push(`   Staff: ${c.staffName} (${c.role})`);
      if (c.phone) lines.push(`   Phone: ${c.phone}`);
      if (c.email) lines.push(`   Email: ${c.email}`);
      lines.push(`   ${c.details}`);
      lines.push("");
    });
    if (schedulingConflicts.length === 0) {
      lines.push("No scheduling conflicts detected in this date range.");
    }
    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied!", description: "Conflict report copied — paste into Outlook or email." });
    } catch {
      toast({ title: "Copy failed", description: "Please select and copy manually.", variant: "destructive" });
    }
  }

  // --- Excel Export ---
  async function exportExcel() {
    const workbook = new ExcelJS.Workbook();

    function addJsonSheet(wb: ExcelJS.Workbook, data: object[], sheetName: string) {
      const ws = wb.addWorksheet(sheetName);
      if (data.length > 0) {
        ws.addRow(Object.keys(data[0]));
        data.forEach(r => ws.addRow(Object.values(r) as (string | number)[]));
      }
    }

    // Sheet 1: Cross-Coverage Detail
    const coverageRows = filteredCoverage.map(r => ({
      Date: fmtDate(r.date),
      "Staff Name": r.staffName,
      Role: staff.find(s => s.id === r.staffId)?.role ?? "",
      "Original Specialty": r.originalSpecialty,
      "Covered Provider": r.providerName,
      "Covered Specialty": r.coveredSpecialty,
    }));
    addJsonSheet(workbook, coverageRows.length > 0 ? coverageRows : [{ "No data": "No coverage records in range" }], "Cross-Coverage Detail");

    // Sheet 2: Coverage Summary by Staff
    const summaryRows: object[] = [];
    staffSummary.forEach(s => {
      s.coverageByProvider.forEach(prov => {
        summaryRows.push({
          "Staff Name": s.staffName,
          "Role": s.role,
          "Original Specialty": s.specialty,
          "Covered Provider": prov.providerName,
          "Covered Specialty": prov.coveredSpecialty,
          "# Times Covered": prov.count,
          Dates: prov.dates.map(fmtDate).join(", "),
          "Total Cross-Coverage": s.totalCoverage,
        });
      });
      if (s.coverageByProvider.size === 0) {
        summaryRows.push({
          "Staff Name": s.staffName, "Role": s.role, "Original Specialty": s.specialty,
          "Covered Provider": "", "Covered Specialty": "", "# Times Covered": 0,
          Dates: "", "Total Cross-Coverage": 0,
        });
      }
    });
    addJsonSheet(workbook, summaryRows.length > 0 ? summaryRows : [{ "No data": "No records" }], "Coverage Summary");

    // Sheet 3: Clinic Assignments
    const clinicRows: object[] = [];
    filteredAssignments.forEach(a => {
      clinicRows.push({
        Date: fmtDate(a.date),
        Clinic: a.clinicName,
        "Staff Name": a.staffName,
        Role: a.staffRole,
        Shift: a.shift,
      });
    });
    addJsonSheet(workbook, clinicRows.length > 0 ? clinicRows : [{ "No data": "No clinic assignments in range" }], "Clinic Assignments");

    // Sheet 4: Clinic Staff Summary
    const clinicSummaryRows: object[] = [];
    clinicSummary.forEach(s => {
      s.clinicBreakdown.forEach(cb => {
        clinicSummaryRows.push({
          "Staff Name": s.staffName,
          Role: s.role,
          Clinic: cb.clinicName,
          "# Assignments": cb.count,
          Dates: cb.dates.map(fmtDate).join(", "),
          "Total Assignments": s.total,
        });
      });
    });
    addJsonSheet(workbook, clinicSummaryRows.length > 0 ? clinicSummaryRows : [{ "No data": "No data" }], "Clinic Staff Summary");

    const fname = `MediSched_Report_${startDate}_to_${endDate}.xlsx`;
    await downloadWorkbook(workbook, fname);
  }

  // --- PDF Export ---
  function exportPDF() {
    const doc = new jsPDF({ orientation: "landscape" });
    const title = `MediSched Scheduling Report: ${fmtDate(startDate)} – ${fmtDate(endDate)}`;
    doc.setFontSize(14);
    doc.text(title, 14, 15);
    doc.setFontSize(9);
    doc.text(`Generated: ${format(today, "MM/dd/yyyy HH:mm")}`, 14, 22);

    let y = 30;

    // Section 1: Cross-Coverage Summary
    doc.setFontSize(11);
    doc.text("Cross-Coverage Summary by Staff Member", 14, y);
    y += 4;

    const summaryData: string[][] = [];
    staffSummary.forEach(s => {
      s.coverageByProvider.forEach(prov => {
        summaryData.push([
          s.staffName,
          s.role,
          s.specialty,
          prov.providerName,
          prov.coveredSpecialty,
          String(prov.count),
          prov.dates.slice(0, 5).map(fmtDate).join(", ") + (prov.dates.length > 5 ? " ..." : ""),
        ]);
      });
    });

    autoTable(doc, {
      startY: y,
      head: [["Staff Name", "Role", "Own Specialty", "Covered Provider", "Covered Specialty", "# Times", "Dates"]],
      body: summaryData.length > 0 ? summaryData : [["No cross-coverage records in this date range", "", "", "", "", "", ""]],
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [59, 130, 246] },
    });

    // Section 2: Clinic Assignments
    const afterTable1 = (doc as any).lastAutoTable?.finalY ?? y + 40;
    doc.addPage();
    doc.setFontSize(11);
    doc.text("Clinic Assignments by Staff Member", 14, 15);

    const clinicData: string[][] = [];
    clinicSummary.forEach(s => {
      s.clinicBreakdown.forEach(cb => {
        clinicData.push([
          s.staffName,
          s.role,
          cb.clinicName,
          String(cb.count),
          cb.dates.slice(0, 5).map(fmtDate).join(", ") + (cb.dates.length > 5 ? " ..." : ""),
        ]);
      });
    });

    autoTable(doc, {
      startY: 20,
      head: [["Staff Name", "Role", "Clinic", "# Assignments", "Dates"]],
      body: clinicData.length > 0 ? clinicData : [["No clinic assignments in this date range", "", "", "", ""]],
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [34, 197, 94] },
    });

    // Section 3: Cross-Coverage Detail
    doc.addPage();
    doc.setFontSize(11);
    doc.text("Cross-Coverage Detail Log", 14, 15);

    const detailData = filteredCoverage.map(r => [
      fmtDate(r.date),
      r.staffName,
      staff.find(s => s.id === r.staffId)?.role ?? "",
      r.originalSpecialty,
      r.providerName,
      r.coveredSpecialty,
    ]);

    autoTable(doc, {
      startY: 20,
      head: [["Date", "Staff Name", "Role", "Own Specialty", "Covered Provider", "Covered Specialty"]],
      body: detailData.length > 0 ? detailData : [["No records", "", "", "", "", ""]],
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [168, 85, 247] },
    });

    doc.save(`MediSched_Report_${startDate}_to_${endDate}.pdf`);
  }

  function handleExport() {
    if (exportFormat === "excel") exportExcel();
    else exportPDF();
  }

  if (isLoading) {
    return (
      <AppLayout>
        <div className="p-8 flex items-center justify-center min-h-[50vh]" data-testid="reports-loading">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            <p className="text-sm">Loading report data…</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (isError) {
    return (
      <AppLayout>
        <div className="p-8 flex items-center justify-center min-h-[50vh]" data-testid="reports-error">
          <div className="flex flex-col items-center gap-3 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="font-medium">Failed to load report data</p>
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
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reports & Export</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Cross-coverage history, clinic assignment reports, and scheduling conflict audit — export as Excel or PDF
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Select value={exportFormat} onValueChange={v => setExportFormat(v as "excel" | "pdf")} data-testid="select-export-format">
            <SelectTrigger className="w-28" data-testid="select-export-format-trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="excel"><span className="flex items-center gap-2"><Table2 className="h-4 w-4" />Excel</span></SelectItem>
              <SelectItem value="pdf"><span className="flex items-center gap-2"><FileText className="h-4 w-4" />PDF</span></SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleExport} data-testid="button-export">
            <Download className="h-4 w-4 mr-2" /> Export Report
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <Label className="text-xs">From Date</Label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-36 mt-1" data-testid="input-report-start" />
            </div>
            <div>
              <Label className="text-xs">To Date</Label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-36 mt-1" data-testid="input-report-end" />
            </div>
            <div>
              <Label className="text-xs">Role</Label>
              <Select value={roleFilter} onValueChange={v => setRoleFilter(v as "All" | "LVN" | "RN")} data-testid="select-role-filter">
                <SelectTrigger className="w-24 mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All</SelectItem>
                  <SelectItem value="LVN">LVN</SelectItem>
                  <SelectItem value="RN">RN</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-3 text-sm text-muted-foreground">
              <span><strong className="text-foreground">{filteredCoverage.length}</strong> coverage records</span>
              <span><strong className="text-foreground">{filteredAssignments.length}</strong> clinic assignments</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="schedule-export">
        <TabsList data-testid="tabs-reports">
          <TabsTrigger value="schedule-export" data-testid="tab-schedule-export">
            <CalendarDays className="w-3.5 h-3.5 mr-1.5" />
            Schedule Export
          </TabsTrigger>
          <TabsTrigger value="coverage" data-testid="tab-coverage">Cross-Coverage</TabsTrigger>
          <TabsTrigger value="clinics" data-testid="tab-clinics">Clinic Assignments</TabsTrigger>
          <TabsTrigger value="conflicts" data-testid="tab-conflicts" className="relative">
            Scheduling Conflicts
            {schedulingConflicts.length > 0 && (
              <Badge className="ml-1.5 bg-red-500 text-white text-[10px] h-4 px-1 absolute -top-1 -right-1">
                {schedulingConflicts.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Schedule Export Tab ────────────────────────────────────── */}
        <TabsContent value="schedule-export">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-primary" />
                Daily Schedule Export
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Pick a date, then copy the full color grid into Outlook/Gmail, download as Excel, or print.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Date picker */}
              <div className="flex items-end gap-3">
                <div>
                  <Label className="text-xs">Schedule Date</Label>
                  <Input
                    type="date"
                    value={exportDate}
                    onChange={e => setExportDate(e.target.value)}
                    className="w-40 mt-1"
                    data-testid="input-export-date"
                  />
                </div>
                <span className="text-sm text-muted-foreground pb-1">
                  {format(new Date(exportDate + 'T12:00:00'), 'EEEE, MMMM d, yyyy')}
                </span>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  onClick={handleCopyColorGrid}
                  data-testid="button-copy-color-grid"
                  className="flex items-center gap-2"
                >
                  {copiedSchedule
                    ? <><Check className="w-4 h-4 text-green-600" /> Copied!</>
                    : <><Copy className="w-4 h-4" /> Copy Color Grid</>}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleDownloadScheduleExcel}
                  data-testid="button-download-schedule-excel"
                  className="flex items-center gap-2"
                >
                  {downloadedSchedule
                    ? <><Check className="w-4 h-4 text-green-600" /> Saved!</>
                    : <><Download className="w-4 h-4" /> Download Excel</>}
                </Button>
                <Button
                  variant="outline"
                  onClick={handlePrintSchedule}
                  data-testid="button-print-schedule"
                  className="flex items-center gap-2"
                >
                  <Printer className="w-4 h-4" /> Print Schedule
                </Button>
              </div>

              {/* Description of each action */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-muted-foreground">
                <div className="flex items-start gap-2 p-3 rounded-md border border-border bg-muted/30">
                  <Copy className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary" />
                  <div>
                    <p className="font-medium text-foreground mb-0.5">Copy Color Grid</p>
                    Copies a fully formatted, color-coded HTML table. Paste directly into Outlook or Gmail and colors are preserved.
                  </div>
                </div>
                <div className="flex items-start gap-2 p-3 rounded-md border border-border bg-muted/30">
                  <Download className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary" />
                  <div>
                    <p className="font-medium text-foreground mb-0.5">Download Excel</p>
                    Saves a .xlsx file grouped by specialty with LVN assignments, clinic coverage, and RN charge positions.
                  </div>
                </div>
                <div className="flex items-start gap-2 p-3 rounded-md border border-border bg-muted/30">
                  <Printer className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary" />
                  <div>
                    <p className="font-medium text-foreground mb-0.5">Print Schedule</p>
                    Opens a print-ready version of the full day schedule in a new window — includes all sections.
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Cross-Coverage Tab */}
        <TabsContent value="coverage" className="space-y-4">
          {staffSummary.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center text-muted-foreground">
                No cross-coverage records found for the selected date range. Assign coverage in the Rotations & Coverage page.
              </CardContent>
            </Card>
          ) : (
            staffSummary.map(s => {
              const member = staff.find(m => m.id === s.staffId);
              return (
              <Card key={s.staffId} data-testid={`card-staff-report-${s.staffId}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        {s.staffName}
                        <Badge variant="outline">{s.role}</Badge>
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">Own specialty: {s.specialty}</p>
                      {(member?.phone || member?.email) && (
                        <div className="flex items-center gap-3 mt-1">
                          {member.phone && (
                            <a href={`tel:${member.phone}`} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                              <Phone className="w-3 h-3" />{member.phone}
                            </a>
                          )}
                          {member.email && (
                            <a href={`mailto:${member.email}`} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                              <Mail className="w-3 h-3" />{member.email}
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="text-2xl font-bold text-primary">{s.totalCoverage}</span>
                      <span className="text-xs text-muted-foreground ml-1">cross-coverage shifts</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left pb-1 pr-4 text-xs text-muted-foreground font-medium">Covered Provider</th>
                          <th className="text-left pb-1 pr-4 text-xs text-muted-foreground font-medium">Specialty Covered</th>
                          <th className="text-left pb-1 pr-4 text-xs text-muted-foreground font-medium"># Times</th>
                          <th className="text-left pb-1 text-xs text-muted-foreground font-medium">Dates</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from(s.coverageByProvider.values()).map((prov, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="py-1 pr-4">{prov.providerName}</td>
                            <td className="py-1 pr-4 text-muted-foreground">{prov.coveredSpecialty}</td>
                            <td className="py-1 pr-4">
                              <Badge variant="secondary">{prov.count}</Badge>
                            </td>
                            <td className="py-1 text-xs text-muted-foreground">
                              {prov.dates.slice(0, 6).map(fmtDate).join(", ")}
                              {prov.dates.length > 6 && ` +${prov.dates.length - 6} more`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
              );
            })
          )}
        </TabsContent>

        {/* Clinic Assignments Tab */}
        <TabsContent value="clinics" className="space-y-4">
          {clinicSummary.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center text-muted-foreground">
                No clinic assignments found for the selected date range. Assign staff in the Clinics page.
              </CardContent>
            </Card>
          ) : (
            clinicSummary.map(s => {
              const member = staff.find(m => m.id === s.staffId);
              return (
              <Card key={s.staffId} data-testid={`card-clinic-report-${s.staffId}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        {s.staffName}
                        <Badge variant="outline">{s.role}</Badge>
                      </CardTitle>
                      {(member?.phone || member?.email) && (
                        <div className="flex items-center gap-3 mt-1">
                          {member.phone && (
                            <a href={`tel:${member.phone}`} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                              <Phone className="w-3 h-3" />{member.phone}
                            </a>
                          )}
                          {member.email && (
                            <a href={`mailto:${member.email}`} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                              <Mail className="w-3 h-3" />{member.email}
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="text-2xl font-bold text-green-600">{s.total}</span>
                      <span className="text-xs text-muted-foreground ml-1">clinic shifts</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left pb-1 pr-4 text-xs text-muted-foreground font-medium">Clinic</th>
                          <th className="text-left pb-1 pr-4 text-xs text-muted-foreground font-medium"># Shifts</th>
                          <th className="text-left pb-1 text-xs text-muted-foreground font-medium">Dates</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from(s.clinicBreakdown.values()).map((cb, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="py-1 pr-4">{cb.clinicName}</td>
                            <td className="py-1 pr-4"><Badge variant="secondary">{cb.count}</Badge></td>
                            <td className="py-1 text-xs text-muted-foreground">
                              {cb.dates.slice(0, 6).map(fmtDate).join(", ")}
                              {cb.dates.length > 6 && ` +${cb.dates.length - 6} more`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
              );
            })
          )}
        </TabsContent>

        {/* Scheduling Conflicts Tab */}
        <TabsContent value="conflicts" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">
                Automatically detected scheduling overlaps, double assignments, and policy violations in the selected date range.
              </p>
            </div>
            {schedulingConflicts.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleCopyConflictsToOutlook} data-testid="button-copy-conflicts">
                <Copy className="h-4 w-4 mr-2" /> Copy to Outlook/Email
              </Button>
            )}
          </div>

          {schedulingConflicts.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center text-muted-foreground">
                <div className="flex flex-col items-center gap-2">
                  <AlertTriangle className="h-8 w-8 text-green-500" />
                  <p>No scheduling conflicts detected in this date range.</p>
                  <p className="text-xs">All clinic assignments, coverage records, and policy rules are consistent.</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
                <p className="text-sm text-red-700 font-medium">
                  {schedulingConflicts.length} conflict{schedulingConflicts.length !== 1 ? 's' : ''} detected — review and resolve as needed.
                </p>
              </div>
              {schedulingConflicts.map((c, i) => (
                <Card key={i} data-testid={`card-conflict-${i}`} className="border-red-200">
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge
                            className={
                              c.type === "Policy Violation"
                                ? "bg-purple-100 text-purple-800 border-purple-300"
                                : c.type === "Double Assignment"
                                ? "bg-red-100 text-red-800 border-red-300"
                                : "bg-orange-100 text-orange-800 border-orange-300"
                            }
                          >
                            {c.type}
                          </Badge>
                          <span className="text-sm font-medium">{c.staffName}</span>
                          <Badge variant="outline" className="text-xs">{c.role}</Badge>
                          <span className="text-xs text-muted-foreground">{fmtDate(c.date)}</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{c.details}</p>
                        {(c.phone || c.email) && (
                          <div className="flex items-center gap-3 mt-1.5">
                            {c.phone && (
                              <a href={`tel:${c.phone}`} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                                <Phone className="w-3 h-3" />{c.phone}
                              </a>
                            )}
                            {c.email && (
                              <a href={`mailto:${c.email}`} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                                <Mail className="w-3 h-3" />{c.email}
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
    </AppLayout>
  );
}
