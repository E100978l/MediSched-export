import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useStaff, useUnavailability, useClinics, useProviderSchedules, isStaffUnavailable, isLvnBusyOnShift, getLvnProviderStatus } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, AlertTriangle, CheckCircle2, ArrowRight, ArrowLeftRight, History, Download, Stethoscope, UserX, CalendarOff, Mail, Phone, AlertCircle } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function Rotations() {
  const { staff, updateStaffMember, coverageHistory, addCoverageRecord, isLoading: staffLoading, isError: staffError, refetch: staffRefetch } = useStaff();
  const { unavailability, isLoading: unavailLoading, isError: unavailError, refetch: unavailRefetch } = useUnavailability();
  const { assignments: clinicAssignments, isLoading: clinicsLoading, isError: clinicsError, refetch: clinicsRefetch } = useClinics();

  // LVN only — RNs are never candidates for provider fill-in or rotation per policy
  const lvns = staff.filter(s => s.role === 'LVN');
  // All clinical nurses (LVN + RN) for the "who is absent" dropdown
  const nurses = staff.filter(s => s.role === 'LVN' || s.role === 'RN');
  const providers = staff.filter(s => ['MD', 'DO', 'NP', 'PA'].includes(s.role));

  // Rotation State
  const [selectedLvnId, setSelectedLvnId] = useState<string>("");
  const [targetProviderId, setTargetProviderId] = useState<string>("");
  const [isRotationDialogOpen, setIsRotationDialogOpen] = useState(false);

  // Coverage State
  const [absentStaffId, setAbsentStaffId] = useState<string>("");
  const [coverageDate, setCoverageDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [coverageShift, setCoverageShift] = useState<'AM' | 'PM' | 'Both'>('Both');

  // Fetch provider schedules for the coverage date window (±7 days for flexibility)
  const { schedules: providerSchedules, isLoading: providerSchedulesLoading, isError: providerSchedulesError, refetch: providerSchedulesRefetch } = useProviderSchedules(coverageDate, coverageDate);

  // Combined page-level loading/error state (all required data sources)
  const isLoading = staffLoading || unavailLoading || clinicsLoading || providerSchedulesLoading;
  const isError = staffError || unavailError || clinicsError || providerSchedulesError;
  const refetch = () => { staffRefetch(); unavailRefetch(); clinicsRefetch(); providerSchedulesRefetch(); };
  const [isCoverageDialogOpen, setIsCoverageDialogOpen] = useState(false);
  const [selectedCoverageLvnId, setSelectedCoverageLvnId] = useState<string>("");

  // -- Rotation Logic --
  const handleRotation = () => {
    if (!selectedLvnId || !targetProviderId) return;
    const lvn = staff.find(s => s.id === selectedLvnId);
    const provider = staff.find(s => s.id === targetProviderId);
    if (lvn && provider) {
      updateStaffMember({ ...lvn, assignedTo: [provider.id], specialty: provider.specialty });
      toast({
        title: "Rotation Confirmed",
        description: `${lvn.name} has been rotated to ${provider.name} (${provider.specialty}).`,
      });
      setIsRotationDialogOpen(false);
      setSelectedLvnId("");
      setTargetProviderId("");
    }
  };

  const getAssignedProviderNames = (providerIds?: string[]) => {
    if (!providerIds || providerIds.length === 0) return 'Unassigned';
    return providerIds.map(id => staff.find(p => p.id === id)?.name).filter(Boolean).join(', ');
  };

  const getEligibleProviders = () => {
    if (!selectedLvnId) return [];
    const lvn = staff.find(s => s.id === selectedLvnId);
    if (!lvn || !lvn.crossTrained) return [];
    return staff.filter(s =>
      ['MD', 'DO', 'NP', 'PA'].includes(s.role) &&
      lvn.crossTrained?.includes(s.specialty)
    );
  };

  // -- Coverage Logic --
  const getAbsentStaffProvider = () => {
    const absent = staff.find(s => s.id === absentStaffId);
    if (!absent || !absent.assignedTo || absent.assignedTo.length === 0) return null;
    return staff.find(p => p.id === absent.assignedTo![0]);
  };

  const getEligibleCoverageStaff = () => {
    const provider = getAbsentStaffProvider();
    if (!provider) return [];

    // Find staff cross-trained in this provider's specialty, excluding the absent staff
    // Exclude staff on Vacation entirely — they are not contactable for coverage
    const eligible = staff.filter(s => {
      if (s.role !== 'LVN') return false; // RNs are never provider fill-in candidates
      if (s.id === absentStaffId) return false;
      if (s.specialty !== provider.specialty && !s.crossTrained?.includes(provider.specialty)) return false;
      // Hard exclude anyone on Vacation (not just gray them out)
      const unavailRecord = isStaffUnavailable(unavailability, s.id, coverageDate);
      if (unavailRecord?.type === 'Vacation') return false;
      return true;
    });

    return eligible.map(s => {
      const unavailRecord = isStaffUnavailable(unavailability, s.id, coverageDate);
      const timesCovered = coverageHistory.filter(h => h.staffId === s.id).length;
      // Count only cross-specialty coverage for equity sorting
      const crossCoverageCount = coverageHistory.filter(h => h.staffId === s.id && h.coveredSpecialty !== h.originalSpecialty).length;
      const lastCovered = coverageHistory.find(h => h.staffId === s.id)?.date || 'Never';

      // Use isLvnBusyOnShift as single source of truth for shift/clinic conflicts
      const shiftArg: 'AM' | 'PM' | 'Full' = coverageShift === 'Both' ? 'Full' : coverageShift;
      const busyStatus = isLvnBusyOnShift(s.id, coverageDate, shiftArg, {
        clinicAssignments,
        coverageRecords: coverageHistory,
      });

      const alreadyCovering = busyStatus.busy;
      const busyReason = busyStatus.detail;
      const busyReasonType = busyStatus.reason;

      // Provider schedule status — prioritize LVNs whose provider is free today
      const providerStatus = getLvnProviderStatus(s, coverageDate, { staff, providerSchedules });

      return {
        ...s,
        timesCovered,
        crossCoverageCount,
        lastCovered,
        unavailRecord,
        alreadyCovering,
        busyReason,
        busyReasonType,
        providerStatus,
        isAvailable: !unavailRecord && !alreadyCovering,
      };
    }).sort((a, b) => {
      // Available first
      if (a.isAvailable && !b.isAvailable) return -1;
      if (!a.isAvailable && b.isAvailable) return 1;
      if (!a.isAvailable && !b.isAvailable) return 0;
      // Among available: provider-free first (Off/Admin/Meeting all day = best candidate)
      if (a.providerStatus.providerFree && !b.providerStatus.providerFree) return -1;
      if (!a.providerStatus.providerFree && b.providerStatus.providerFree) return 1;
      // Then by fewest cross-specialty shifts (equitable)
      return a.crossCoverageCount - b.crossCoverageCount;
    });
  };

  const buildCoverageEmailLink = () => {
    const provider = getAbsentStaffProvider();
    const absentStaff = staff.find(s => s.id === absentStaffId);
    if (!provider || !absentStaff) return "#";
    const subject = encodeURIComponent(`Coverage Needed — ${provider.specialty} with ${provider.name} on ${coverageDate}`);
    const body = encodeURIComponent(
      `Hello,\n\nWe are in need of coverage for the ${coverageShift} shift on ${coverageDate}.\n\n` +
      `Provider: ${provider.name} (${provider.specialty})\n` +
      `Absent Staff: ${absentStaff.name}\n\n` +
      `Please reply if you are available to cover this position.\n\nThank you.`
    );
    return `mailto:?subject=${subject}&body=${body}`;
  };

  const handleConfirmCoverage = async () => {
    const coveringStaff = staff.find(s => s.id === selectedCoverageLvnId);
    const absentStaff = staff.find(s => s.id === absentStaffId);
    const provider = getAbsentStaffProvider();

    if (!coveringStaff || !absentStaff || !provider) return;

    // Pre-flight: confirm the selected person is still shown as available in the current list
    const candidate = eligibleList.find(s => s.id === selectedCoverageLvnId);
    if (!candidate?.isAvailable) {
      toast({
        title: "Scheduling Conflict",
        description: `${coveringStaff.name} is no longer available for coverage on ${coverageDate}. Please select another staff member.`,
        variant: "destructive",
      });
      setSelectedCoverageLvnId("");
      return;
    }

    try {
      await addCoverageRecord({
        date: coverageDate,
        staffId: coveringStaff.id,
        staffName: coveringStaff.name,
        originalSpecialty: coveringStaff.specialty,
        coveredSpecialty: provider.specialty,
        providerId: provider.id,
        providerName: provider.name,
      });
      toast({
        title: "Coverage Assigned",
        description: `${coveringStaff.name} is covering ${coverageShift} for ${absentStaff.name} with ${provider.name}.`,
      });
      setIsCoverageDialogOpen(false);
      setAbsentStaffId("");
      setSelectedCoverageLvnId("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to assign coverage";
      toast({ title: "Scheduling Conflict", description: msg, variant: "destructive" });
    }
  };

  const handleExportHistory = () => {
    const headers = ['Date', 'Staff Member', 'Covered Specialty', 'Provider', 'Original Specialty'];
    const csvContent = [
      headers.join(','),
      ...coverageHistory.map(row =>
        [row.date, `"${row.staffName}"`, `"${row.coveredSpecialty}"`, `"${row.providerName}"`, `"${row.originalSpecialty}"`].join(',')
      )
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `coverage_history_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const eligibleList = getEligibleCoverageStaff();
  const availableCount = eligibleList.filter(s => s.isAvailable).length;

  if (isLoading) {
    return (
      <AppLayout>
        <div className="p-8 flex items-center justify-center min-h-[50vh]" data-testid="rotations-loading">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            <p className="text-sm">Loading rotations data…</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (isError) {
    return (
      <AppLayout>
        <div className="p-8 flex items-center justify-center min-h-[50vh]" data-testid="rotations-error">
          <div className="flex flex-col items-center gap-3 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="font-medium">Failed to load rotations data</p>
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
      <div className="p-8 space-y-6 max-w-7xl mx-auto">
        <div>
          <h2 className="text-3xl font-bold tracking-tight font-heading text-foreground">Rotations & Coverage</h2>
          <p className="text-muted-foreground mt-1">
            Manage long-term rotations and daily sick call coverage.
          </p>
        </div>

        <Tabs defaultValue="coverage" className="space-y-6">
          <TabsList>
            <TabsTrigger value="coverage" className="flex gap-2">
              <Stethoscope className="w-4 h-4" /> Daily Coverage & Vacancies
            </TabsTrigger>
            <TabsTrigger value="rotations" className="flex gap-2">
              <RefreshCw className="w-4 h-4" /> Quarterly Rotations
            </TabsTrigger>
          </TabsList>

          <TabsContent value="coverage" className="space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
              {/* Vacancy Manager */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <UserX className="w-5 h-5 text-orange-500" />
                    Report Absence / Find Coverage
                  </CardTitle>
                  <CardDescription>Identify an absent staff member to find equitable coverage.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2">
                    <Label>Absent Staff Member</Label>
                    <Select value={absentStaffId} onValueChange={v => { setAbsentStaffId(v); setSelectedCoverageLvnId(""); }}>
                      <SelectTrigger data-testid="select-absent-staff">
                        <SelectValue placeholder="Who is out today?" />
                      </SelectTrigger>
                      <SelectContent>
                        {nurses.map(lvn => (
                          <SelectItem key={lvn.id} value={lvn.id}>{lvn.name} ({lvn.role})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-2">
                      <Label>Coverage Date</Label>
                      <Input
                        type="date"
                        value={coverageDate}
                        onChange={e => { setCoverageDate(e.target.value); setSelectedCoverageLvnId(""); }}
                        data-testid="input-coverage-date"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Shift Needed</Label>
                      <Select value={coverageShift} onValueChange={(v: any) => setCoverageShift(v)}>
                        <SelectTrigger data-testid="select-shift">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="AM">AM Only</SelectItem>
                          <SelectItem value="PM">PM Only</SelectItem>
                          <SelectItem value="Both">Full Day (AM + PM)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {absentStaffId && (
                    <div className="p-4 bg-muted/50 rounded-lg border space-y-3">
                      <div className="text-sm">
                        <span className="font-medium">Assigned To:</span> {getAssignedProviderNames(staff.find(s => s.id === absentStaffId)?.assignedTo ?? undefined)}
                      </div>
                      <div className="text-sm">
                        <span className="font-medium">Specialty:</span> {staff.find(s => s.id === absentStaffId)?.specialty}
                      </div>
                      {!getAbsentStaffProvider() && (
                        <p className="text-sm text-destructive">This staff member has no provider assigned. Cannot find coverage.</p>
                      )}
                      {getAbsentStaffProvider() && (
                        <Button
                          onClick={() => setIsCoverageDialogOpen(true)}
                          className="w-full"
                          data-testid="button-find-coverage"
                        >
                          <Stethoscope className="w-4 h-4 mr-2" />
                          Find Equitable Coverage
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Quick Stats */}
              <Card>
                <CardHeader>
                  <CardTitle>Coverage Stats</CardTitle>
                  <CardDescription>Running coverage history tracking.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{coverageHistory.length}</div>
                  <p className="text-sm text-muted-foreground">Total coverage shifts recorded</p>
                  <div className="mt-4 pt-4 border-t">
                    <Button variant="outline" size="sm" onClick={handleExportHistory} data-testid="button-export-coverage">
                      <Download className="w-4 h-4 mr-2" />
                      Export to Excel (CSV)
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* History Table */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="w-5 h-5" />
                  Coverage History
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Staff Member</TableHead>
                      <TableHead>Covered Specialty</TableHead>
                      <TableHead>For Provider</TableHead>
                      <TableHead>Original Role</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {coverageHistory.map(record => (
                      <TableRow key={record.id} data-testid={`row-coverage-${record.id}`}>
                        <TableCell>{record.date}</TableCell>
                        <TableCell className="font-medium">{record.staffName}</TableCell>
                        <TableCell><Badge variant="secondary">{record.coveredSpecialty}</Badge></TableCell>
                        <TableCell>{record.providerName}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{record.originalSpecialty}</TableCell>
                      </TableRow>
                    ))}
                    {coverageHistory.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          No coverage history recorded yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rotations">
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-6 gap-4">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-primary/10 rounded-full text-primary">
                    <RefreshCw className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">Next Rotation Cycle: Q2 2026</h3>
                    <p className="text-sm text-muted-foreground">Scheduled for April 1st, 2026. Review cross-training eligibility below.</p>
                  </div>
                </div>

                <Dialog open={isRotationDialogOpen} onOpenChange={setIsRotationDialogOpen}>
                  <DialogTrigger asChild>
                    <Button className="w-full sm:w-auto" data-testid="button-plan-rotation">
                      <ArrowLeftRight className="w-4 h-4 mr-2" />
                      Plan New Rotation
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Plan Staff Rotation</DialogTitle>
                      <DialogDescription>
                        Rotate an LVN to a new provider. Only LVNs are eligible for provider rotation — RNs are excluded per policy. Only providers in eligible cross-trained specialties are shown.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label>Select LVN Staff</Label>
                        <Select value={selectedLvnId} onValueChange={v => { setSelectedLvnId(v); setTargetProviderId(""); }}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select staff member..." />
                          </SelectTrigger>
                          <SelectContent>
                            {lvns.map(lvn => (
                              <SelectItem key={lvn.id} value={lvn.id}>{lvn.name} ({lvn.specialty})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label>Target Provider</Label>
                        <Select value={targetProviderId} onValueChange={setTargetProviderId} disabled={!selectedLvnId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select new provider..." />
                          </SelectTrigger>
                          <SelectContent>
                            {getEligibleProviders().map(provider => (
                              <SelectItem key={provider.id} value={provider.id}>
                                {provider.name} ({provider.specialty})
                              </SelectItem>
                            ))}
                            {selectedLvnId && getEligibleProviders().length === 0 && (
                              <SelectItem value="none" disabled>No eligible providers (check cross-training)</SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button onClick={handleRotation} disabled={!selectedLvnId || !targetProviderId}>
                        Confirm Rotation
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>

            <div className="grid gap-6 mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>LVN Rotation Status</CardTitle>
                  <CardDescription>Current LVN assignments and eligibility for quarterly rotation. RNs are excluded from provider fill-in per policy.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {lvns.map(lvn => (
                      <div key={lvn.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border border-border rounded-lg hover:bg-muted/50 transition-colors gap-4">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center font-bold text-sm shrink-0">
                            {lvn.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                          </div>
                          <div>
                            <div className="font-medium">{lvn.name}</div>
                            <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-2">
                              <span>{lvn.role} · {lvn.specialty}</span>
                              <span className="hidden sm:inline text-border">|</span>
                              <span>Assigned to: {getAssignedProviderNames(lvn.assignedTo ?? undefined)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                          <div className="text-right hidden md:block">
                            <div className="text-xs font-medium text-muted-foreground uppercase mb-1">Can Rotate To</div>
                            <div className="flex gap-1 justify-end flex-wrap">
                              {lvn.crossTrained?.map(spec => (
                                <Badge key={spec} variant="outline" className="text-[10px] py-0 h-5">
                                  {spec.replace('Internal/Family Med', 'IM/FM')}
                                </Badge>
                              ))}
                              {(!lvn.crossTrained || lvn.crossTrained.length === 0) && (
                                <span className="text-xs text-muted-foreground italic">No cross-training</span>
                              )}
                            </div>
                          </div>
                          <div className="w-32 text-right">
                            {lvn.crossTrained && lvn.crossTrained.length > 0 ? (
                              <Badge className="bg-green-500/15 text-green-700 hover:bg-green-500/25 border-green-200">
                                <CheckCircle2 className="w-3 h-3 mr-1" /> Eligible
                              </Badge>
                            ) : (
                              <Badge variant="destructive" className="bg-orange-500/15 text-orange-700 hover:bg-orange-500/25 border-orange-200">
                                <AlertTriangle className="w-3 h-3 mr-1" /> Needs Training
                              </Badge>
                            )}
                          </div>
                          <Button variant="ghost" size="icon">
                            <ArrowRight className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        {/* Coverage Finder Dialog */}
        <Dialog open={isCoverageDialogOpen} onOpenChange={open => { setIsCoverageDialogOpen(open); if (!open) setSelectedCoverageLvnId(""); }}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Find Equitable Coverage</DialogTitle>
              <DialogDescription>
                Covering for <strong>{staff.find(s => s.id === absentStaffId)?.name}</strong> with{' '}
                <strong>{getAbsentStaffProvider()?.name}</strong> ({getAbsentStaffProvider()?.specialty}) on{' '}
                <strong>{coverageDate}</strong> — {coverageShift} shift.
                LVN candidates only — RNs are not eligible for provider fill-in. Staff on vacation are excluded. Sorted by fewest cross-specialty shifts.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <div className="flex items-center justify-between text-sm bg-muted p-2 rounded">
                <span>Available: <strong className="text-green-700">{availableCount}</strong></span>
                <span>Unavailable/Busy: <strong className="text-red-700">{eligibleList.length - availableCount}</strong></span>
                <span className="text-muted-foreground text-xs italic">(Staff on Vacation are not shown)</span>
              </div>

              {/* No internal coverage available — email draft */}
              {availableCount === 0 && eligibleList.length >= 0 && (
                <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                  <div className="text-sm text-amber-800 font-medium">
                    No internal staff available for this coverage slot.
                  </div>
                  <Button asChild size="sm" variant="outline" className="border-amber-400 text-amber-800 hover:bg-amber-100">
                    <a href={buildCoverageEmailLink()} data-testid="link-draft-coverage-email">
                      <Mail className="w-4 h-4 mr-2" />
                      Draft Coverage Request Email
                    </a>
                  </Button>
                </div>
              )}

              <div className="h-[380px] overflow-y-auto border rounded-md relative">
                {(() => {
                  const lvnList = eligibleList.filter(s => s.role === 'LVN');
                  const rnList = eligibleList.filter(s => s.role === 'RN');
                  const renderRows = (list: typeof eligibleList) => list.map(s => (
                    <TableRow
                      key={s.id}
                      className={`transition-colors ${
                        !s.isAvailable
                          ? 'opacity-50 bg-muted/30 cursor-not-allowed'
                          : selectedCoverageLvnId === s.id
                            ? 'bg-primary/5 cursor-pointer'
                            : 'cursor-pointer hover:bg-muted/40'
                      }`}
                      onClick={() => s.isAvailable && setSelectedCoverageLvnId(s.id)}
                      data-testid={`row-coverage-candidate-${s.id}`}
                    >
                      <TableCell>
                        <div className="flex items-center justify-center">
                          <input
                            type="radio"
                            name="coverage-selection"
                            className="w-4 h-4 cursor-pointer accent-primary"
                            checked={selectedCoverageLvnId === s.id}
                            disabled={!s.isAvailable}
                            onChange={() => s.isAvailable && setSelectedCoverageLvnId(s.id)}
                            onClick={e => e.stopPropagation()}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1.5">
                          {s.name}
                          {s.crossCoverageCount === 0 && s.isAvailable && (
                            <Badge className="bg-green-500/15 text-green-700 border-green-200 text-[10px]">Most Equitable</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{s.specialty}</div>
                        <div className="flex items-center gap-3 mt-0.5">
                          {s.phone && (
                            <a href={`tel:${s.phone}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                              <Phone className="w-3 h-3" />{s.phone}
                            </a>
                          )}
                          {s.email && (
                            <a href={`mailto:${s.email}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                              <Mail className="w-3 h-3" />{s.email}
                            </a>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <span className="font-bold">{s.crossCoverageCount}</span>
                          <span className="text-xs text-muted-foreground">cross shifts</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{s.lastCovered}</TableCell>
                      <TableCell>
                        {s.unavailRecord ? (
                          <Badge className="bg-red-500/15 text-red-700 border-red-200 text-[10px] flex items-center gap-1">
                            <CalendarOff className="w-3 h-3" />
                            {s.unavailRecord.type}
                          </Badge>
                        ) : s.alreadyCovering ? (
                          <Badge className={`text-[10px] flex items-center gap-1 ${s.busyReasonType === 'clinic' ? 'bg-orange-500/15 text-orange-700 border-orange-200' : 'bg-amber-500/15 text-amber-700 border-amber-200'}`}>
                            {s.busyReasonType === 'clinic' && <AlertTriangle className="w-3 h-3" />}
                            {s.busyReason ?? 'Already Covering'}
                          </Badge>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            <Badge className="bg-green-500/15 text-green-700 border-green-200 text-[10px]">
                              Available
                            </Badge>
                            {s.providerStatus?.providerFree && (
                              <Badge className="bg-blue-500/15 text-blue-700 border-blue-200 text-[10px]">
                                Provider Off
                              </Badge>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ));

                  return (
                    <Table>
                      <TableHeader className="bg-muted/50 sticky top-0 z-10 shadow-sm">
                        <TableRow>
                          <TableHead className="w-[50px]"></TableHead>
                          <TableHead>Staff Member</TableHead>
                          <TableHead>Cross-Coverage Count</TableHead>
                          <TableHead>Last Covered</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lvnList.length > 0 && (
                          <>
                            <TableRow className="bg-blue-50/60 hover:bg-blue-50/60 pointer-events-none">
                              <TableCell colSpan={5} className="py-1.5 px-4 text-[11px] font-semibold uppercase tracking-wider text-blue-700">
                                LVN
                              </TableCell>
                            </TableRow>
                            {renderRows(lvnList)}
                          </>
                        )}
                        {rnList.length > 0 && (
                          <>
                            <TableRow className="bg-purple-50/60 hover:bg-purple-50/60 pointer-events-none">
                              <TableCell colSpan={5} className="py-1.5 px-4 text-[11px] font-semibold uppercase tracking-wider text-purple-700">
                                RN
                              </TableCell>
                            </TableRow>
                            {renderRows(rnList)}
                          </>
                        )}
                        {eligibleList.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                              No eligible staff found for this specialty. Check cross-training records.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  );
                })()}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCoverageDialogOpen(false)}>Cancel</Button>
              <Button
                onClick={handleConfirmCoverage}
                disabled={!selectedCoverageLvnId}
                data-testid="button-assign-coverage"
              >
                Assign Coverage
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
