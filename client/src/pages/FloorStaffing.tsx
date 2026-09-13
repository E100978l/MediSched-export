import { useState, useMemo, useCallback } from "react";
import ExcelJS from "exceljs";
import { format, addDays, startOfMonth } from "date-fns";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useFloorUnits, useFloorStaff, useFloorShiftAssignments,
  useFloorRoomAcuity, useFloorShiftReports, useFloorShiftReport, useFloorDailyRooms,
  useFloorMonthlyAssignments,
  type FloorUnit, type FloorStaffMember, type FloorShiftAssignment,
  type FloorRoomAcuity, type FloorShiftReport, type FloorShift,
} from "@/lib/store";
import { useUnavailability, isStaffUnavailable } from "@/lib/store";
import {
  FLOOR_SHIFTS, FLOOR_SHIFT_LABELS, type AcuityLevel,
  type InsertFloorShiftReport,
} from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  ChevronLeft, ChevronRight, Download, Copy, Check,
  Mic, MicOff, ClipboardList, Zap, X, Settings, AlertCircle, Eye, Pencil,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const ACUITY_COLORS: Record<AcuityLevel, string> = {
  1: "bg-green-100 text-green-800 border-green-300",
  2: "bg-yellow-100 text-yellow-800 border-yellow-300",
  3: "bg-red-100 text-red-800 border-red-300",
};

const SHIFT_COLORS: Record<FloorShift, string> = {
  day: "border-l-blue-500",
  evening: "border-l-amber-500",
  night: "border-l-indigo-500",
};

const SHIFT_HEADER_BG: Record<FloorShift, string> = {
  day: "bg-blue-50 border-blue-200",
  evening: "bg-amber-50 border-amber-200",
  night: "bg-indigo-50 border-indigo-200",
};

type RoomNote = { room: number; note: string; acuity: AcuityLevel };

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface SpeechRecognitionConstructor {
  new(): SpeechRecognitionInstance;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

function useSpeechRecognition() {
  const [isListening, setIsListening] = useState(false);
  const [recognizerRef, setRecognizerRef] = useState<SpeechRecognitionInstance | null>(null);

  const startListening = useCallback((onResult: (text: string) => void) => {
    const SpeechRecognitionAPI = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      toast({ title: "Voice input not supported", description: "Your browser does not support voice input.", variant: "destructive" });
      return;
    }
    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = Array.from(event.results)
        .map((r: SpeechRecognitionResult) => r[0].transcript)
        .join(" ");
      onResult(transcript);
    };
    recognition.onerror = () => {
      setIsListening(false);
    };
    recognition.onend = () => {
      setIsListening(false);
    };
    recognition.start();
    setRecognizerRef(recognition);
    setIsListening(true);
  }, []);

  const stopListening = useCallback(() => {
    if (recognizerRef) {
      recognizerRef.stop();
      setIsListening(false);
    }
  }, [recognizerRef]);

  return { isListening, startListening, stopListening };
}

function VoiceButton({ onText, fieldId }: { onText: (t: string) => void; fieldId: string }) {
  const [activeField, setActiveField] = useState<string | null>(null);
  const { isListening, startListening, stopListening } = useSpeechRecognition();

  const toggle = () => {
    if (isListening && activeField === fieldId) {
      stopListening();
      setActiveField(null);
    } else {
      startListening((text) => onText(text));
      setActiveField(fieldId);
    }
  };

  const active = isListening && activeField === fieldId;
  return (
    <Button
      variant="ghost"
      size="icon"
      type="button"
      data-testid={`btn-voice-${fieldId}`}
      className={cn("h-7 w-7", active ? "text-red-500 animate-pulse" : "text-muted-foreground")}
      onClick={toggle}
      title={active ? "Stop listening" : "Voice input"}
    >
      {active ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
    </Button>
  );
}

interface ShiftReportModalProps {
  open: boolean;
  onClose: () => void;
  shift: FloorShift;
  unit: FloorUnit;
  date: string;
  chargeRnId: string;
  chargeRnName: string;
  assignments: FloorShiftAssignment[];
  staff: FloorStaffMember[];
  acuityRecords: FloorRoomAcuity[];
  existingReport: FloorShiftReport | undefined;
  onSave: (data: InsertFloorShiftReport) => Promise<FloorShiftReport>;
  prevReport?: FloorShiftReport | undefined;
  readOnly?: boolean;
}

function ShiftReportModal({
  open, onClose, shift, unit, date, chargeRnId, chargeRnName,
  assignments, acuityRecords, existingReport, onSave, prevReport, readOnly = false,
}: ShiftReportModalProps) {
  const allRooms = useMemo(() => {
    const rooms = new Set<number>();
    assignments.forEach(a => (a.rooms as number[]).forEach(r => rooms.add(r)));
    return Array.from(rooms).sort((a, b) => a - b);
  }, [assignments]);

  const parseRoomNotes = (raw: FloorShiftReport["roomNotes"]): RoomNote[] => {
    if (!raw) return [];
    return (raw as RoomNote[]);
  };

  const [roomNotes, setRoomNotes] = useState<RoomNote[]>(() => {
    if (existingReport?.roomNotes) return parseRoomNotes(existingReport.roomNotes);
    return allRooms.map(r => {
      const acuityRec = acuityRecords.find(a => a.roomNumber === r);
      return { room: r, note: "", acuity: (acuityRec?.acuityLevel ?? 1) as AcuityLevel };
    });
  });
  const [shiftSummary, setShiftSummary] = useState(existingReport?.shiftSummary ?? "");
  const [huddleTopics, setHuddleTopics] = useState(existingReport?.huddleTopics ?? "");
  const [saving, setSaving] = useState(false);

  const updateRoomNote = (room: number, field: "note" | "acuity", value: string | AcuityLevel) => {
    setRoomNotes(prev => prev.map(rn => rn.room === room ? { ...rn, [field]: value } : rn));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const now = new Date().toISOString();
      await onSave({
        unitId: unit.id,
        date,
        shift,
        chargeRnId,
        chargeRnName,
        roomNotes,
        shiftSummary,
        huddleTopics,
        createdAt: existingReport?.createdAt ?? now,
        updatedAt: now,
      });
      toast({ title: "Shift report saved" });
      onClose();
    } catch {
      toast({ title: "Failed to save report", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const carryForwardHuddle = () => {
    if (prevReport?.huddleTopics) {
      setHuddleTopics(prev => prev ? `${prev}\n\n[Carried from previous shift]\n${prevReport!.huddleTopics}` : `[Carried from previous shift]\n${prevReport!.huddleTopics}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            {readOnly ? "Incoming Shift Report" : "Shift Handoff Report"} — {FLOOR_SHIFT_LABELS[shift]} · {unit.name} · {date}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">Charge RN: {chargeRnName}</p>
          {readOnly && (
            <p className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-1 border border-amber-200">
              Read-only view of the previous shift's handoff report
            </p>
          )}
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!readOnly && prevReport && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="font-medium text-amber-800 mb-1">Previous Shift Huddle Topics</p>
              <p className="text-amber-700 whitespace-pre-wrap text-xs">{prevReport.huddleTopics || "None recorded"}</p>
              <Button size="sm" variant="outline" className="mt-2 text-xs h-7" onClick={carryForwardHuddle} data-testid="btn-carry-forward-huddle">
                Carry Forward to This Report
              </Button>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold mb-2">Per-Room Status Notes</h3>
            {roomNotes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No rooms assigned to this shift.</p>
            ) : (
              <div className="space-y-2">
                {roomNotes.map(rn => (
                  <div key={rn.room} className="flex items-start gap-2 p-2 rounded-md border bg-muted/20">
                    <div className="w-12 text-sm font-medium pt-1">Rm {rn.room}</div>
                    <div className="flex-shrink-0">
                      <Select
                        value={String(rn.acuity)}
                        onValueChange={(v) => !readOnly && updateRoomNote(rn.room, "acuity", Number(v) as AcuityLevel)}
                        disabled={readOnly}
                      >
                        <SelectTrigger className="h-8 w-20 text-xs" data-testid={`select-acuity-report-${rn.room}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Acuity 1</SelectItem>
                          <SelectItem value="2">Acuity 2</SelectItem>
                          <SelectItem value="3">Acuity 3</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1 flex items-center gap-1">
                      <Textarea
                        placeholder="Room status note (no patient identifiers)..."
                        className="min-h-[40px] text-sm resize-none"
                        value={rn.note}
                        onChange={e => !readOnly && updateRoomNote(rn.room, "note", e.target.value)}
                        readOnly={readOnly}
                        data-testid={`textarea-room-note-${rn.room}`}
                      />
                      {!readOnly && <VoiceButton fieldId={`room-${rn.room}`} onText={t => updateRoomNote(rn.room, "note", rn.note ? `${rn.note} ${t}` : t)} />}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label className="text-sm font-semibold">Shift Summary</Label>
            <div className="flex items-start gap-1 mt-1">
              <Textarea
                placeholder="Overall shift summary..."
                className="min-h-[80px] text-sm"
                value={shiftSummary}
                onChange={e => !readOnly && setShiftSummary(e.target.value)}
                readOnly={readOnly}
                data-testid="textarea-shift-summary"
              />
              {!readOnly && <VoiceButton fieldId="shift-summary" onText={t => setShiftSummary(prev => prev ? `${prev} ${t}` : t)} />}
            </div>
          </div>

          <div>
            <Label className="text-sm font-semibold">Huddle Topics (Safety / Equipment / Process)</Label>
            <div className="flex items-start gap-1 mt-1">
              <Textarea
                placeholder="Safety issues, equipment concerns, process notes to carry forward..."
                className="min-h-[80px] text-sm"
                value={huddleTopics}
                onChange={e => !readOnly && setHuddleTopics(e.target.value)}
                readOnly={readOnly}
                data-testid="textarea-huddle-topics"
              />
              {!readOnly && <VoiceButton fieldId="huddle-topics" onText={t => setHuddleTopics(prev => prev ? `${prev} ${t}` : t)} />}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{readOnly ? "Close" : "Cancel"}</Button>
          {!readOnly && (
            <Button onClick={handleSave} disabled={saving} data-testid="btn-save-shift-report">
              {saving ? "Saving…" : "Save Report"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface RoomEditModalProps {
  open: boolean;
  onClose: () => void;
  shift: FloorShift;
  staffId: string;
  staffName: string;
  currentRooms: number[];
  allRooms: number[];
  otherStaffAssignments: FloorShiftAssignment[];
  otherFloorStaff: FloorStaffMember[];
  onSave: (rooms: number[]) => Promise<void>;
}

function RoomEditModal({
  open, onClose, staffName, currentRooms, allRooms, otherStaffAssignments, otherFloorStaff, onSave,
}: RoomEditModalProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set(currentRooms));
  const [saving, setSaving] = useState(false);

  const getAssigneeName = (room: number): string | null => {
    const a = otherStaffAssignments.find(a => (a.rooms as number[]).includes(room));
    if (!a) return null;
    return otherFloorStaff.find(s => s.id === a.staffId)?.name ?? null;
  };

  const toggleRoom = (room: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(room)) next.delete(room); else next.add(room);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(Array.from(selected).sort((a, b) => a - b));
      toast({ title: "Room assignment updated" });
      onClose();
    } catch {
      toast({ title: "Failed to update rooms", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Rooms — {staffName}</DialogTitle>
          <p className="text-xs text-muted-foreground">Click rooms to toggle assignment. Rooms assigned to other staff are shown with their name.</p>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5 py-3">
          {allRooms.map(room => {
            const isSelected = selected.has(room);
            const assignee = getAssigneeName(room);
            return (
              <button
                key={room}
                type="button"
                onClick={() => toggleRoom(room)}
                data-testid={`room-toggle-${room}`}
                className={cn(
                  "px-2 py-1 rounded border text-xs font-medium transition-colors",
                  isSelected
                    ? "bg-primary text-primary-foreground border-primary"
                    : assignee
                      ? "bg-orange-50 text-orange-700 border-orange-300 hover:bg-orange-100"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
                title={assignee ? `Currently assigned to ${assignee}` : undefined}
              >
                {room}{assignee ? ` (${assignee.split(" ").pop()})` : ""}
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} data-testid="btn-save-room-edit">
            {saving ? "Saving…" : "Save Rooms"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface UnitsListModalProps {
  open: boolean;
  onClose: () => void;
  units: FloorUnit[];
  onAdd: () => void;
  onEdit: (unit: FloorUnit) => void;
  onDelete: (unit: FloorUnit) => void;
}

function UnitsListModal({ open, onClose, units, onAdd, onEdit, onDelete }: UnitsListModalProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage Floor Units</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          {units.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No units configured.</p>
          )}
          {units.map(u => (
            <div key={u.id} className="flex items-center justify-between border rounded-lg px-4 py-3">
              <div>
                <p className="font-medium text-sm">{u.name}</p>
                <p className="text-xs text-muted-foreground">Rooms {u.roomStart}–{u.roomEnd}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onEdit(u)} data-testid={`btn-edit-unit-${u.id}`}>
                  Edit
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => onDelete(u)} data-testid={`btn-delete-unit-${u.id}`}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={onAdd} data-testid="btn-add-unit-from-list">
            Add New Unit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface UnitManageModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: { name: string; roomStart: number; roomEnd: number; isActive: boolean }) => Promise<FloorUnit>;
  existing?: FloorUnit;
}

function UnitManageModal({ open, onClose, onSave, existing }: UnitManageModalProps) {
  const [name, setName] = useState(existing?.name ?? "");
  const [roomStart, setRoomStart] = useState(String(existing?.roomStart ?? 101));
  const [roomEnd, setRoomEnd] = useState(String(existing?.roomEnd ?? 130));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({ name, roomStart: Number(roomStart), roomEnd: Number(roomEnd), isActive: true });
      toast({ title: existing ? "Unit updated" : "Unit created" });
      onClose();
    } catch {
      toast({ title: "Failed to save unit", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Floor Unit" : "Add Floor Unit"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Unit Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. 3 West" data-testid="input-unit-name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Room Start</Label>
              <Input type="number" value={roomStart} onChange={e => setRoomStart(e.target.value)} data-testid="input-room-start" />
            </div>
            <div>
              <Label>Room End</Label>
              <Input type="number" value={roomEnd} onChange={e => setRoomEnd(e.target.value)} data-testid="input-room-end" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} data-testid="btn-save-unit">{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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

export default function FloorStaffing() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [date, setDate] = useState(new Date());
  const dateStr = format(date, "yyyy-MM-dd");
  const monthStart = format(startOfMonth(date), "yyyy-MM-dd");
  const [selectedUnitId, setSelectedUnitId] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const { units, isLoading: unitsLoading, createUnit, updateUnit, deleteUnit } = useFloorUnits();
  const { staff: allFloorStaff, isLoading: staffLoading } = useFloorStaff();
  const { unavailability } = useUnavailability();

  const activeUnits = units.filter(u => u.isActive);
  const unit = activeUnits.find(u => u.id === selectedUnitId) ?? activeUnits[0];
  const unitId = unit?.id ?? "";

  const { dailyRooms, upsertDailyRooms } = useFloorDailyRooms(unitId, dateStr);
  const { assignments, upsertAssignment, deleteAssignment, clearShift, refetch: refetchAssignments } = useFloorShiftAssignments(unitId, dateStr);
  const { reports, upsertReport } = useFloorShiftReports(unitId, dateStr);
  const { monthlyAssignments } = useFloorMonthlyAssignments(unitId, monthStart, dateStr);

  // Cross-date handoff: Day shift receives the night report from the PREVIOUS calendar date.
  const prevDateStr = format(addDays(date, -1), "yyyy-MM-dd");
  const { report: prevNightReport } = useFloorShiftReport(unitId, prevDateStr, "night");

  const openRoomCount = dailyRooms?.openRoomCount ?? (unit ? (unit.roomEnd - unit.roomStart + 1) : 0);

  const openRooms = useMemo(() => {
    if (!unit) return [];
    return Array.from({ length: openRoomCount }, (_, i) => unit.roomStart + i);
  }, [unit, openRoomCount]);

  const [reportModal, setReportModal] = useState<{ shift: FloorShift; readOnly?: boolean; crossDateReport?: FloorShiftReport | null } | null>(null);
  const [unitModal, setUnitModal] = useState<{ editing?: FloorUnit } | null>(null);
  const [showUnitsListModal, setShowUnitsListModal] = useState(false);
  const [openRoomEdit, setOpenRoomEdit] = useState<string | null>(null);
  const [roomCountEdit, setRoomCountEdit] = useState("");
  const [roomEditModal, setRoomEditModal] = useState<{ shift: FloorShift; staffId: string } | null>(null);

  // Per-shift authorization: is the current user a Charge RN for the given shift?
  const isChargeRnForShift = useCallback((shift: FloorShift): boolean => {
    if (isAdmin) return true;
    if (!user?.id) return false;
    const chargeAssignment = assignments.find(a => a.shift === shift && a.isChargeRn);
    if (!chargeAssignment) return false;
    const staffMember = allFloorStaff.find(s => s.id === chargeAssignment.staffId);
    return staffMember?.userId === user.id;
  }, [isAdmin, user?.id, assignments, allFloorStaff]);

  const getShiftAssignments = (shift: FloorShift) =>
    assignments.filter(a => a.shift === shift);

  const getChargeRn = (shift: FloorShift) => {
    const chargeAssignment = assignments.find(a => a.shift === shift && a.isChargeRn);
    if (!chargeAssignment) return null;
    return allFloorStaff.find(s => s.id === chargeAssignment.staffId) ?? null;
  };

  const getReport = (shift: FloorShift) => reports.find(r => r.shift === shift);

  const getAvailableStaff = (shift: FloorShift) =>
    allFloorStaff.filter(s =>
      s.isActive &&
      !isStaffUnavailable(unavailability, s.id, dateStr) &&
      (s.shiftPreference === "any" || s.shiftPreference === shift)
    );

  const getAssignedStaffIds = (shift: FloorShift) =>
    new Set(getShiftAssignments(shift).map(a => a.staffId));

  const computeAcuityLoad = (rooms: number[], acuityMap: Record<number, AcuityLevel>): number =>
    rooms.reduce((sum, r) => sum + (acuityMap[r] ?? 1), 0);

  const { acuityRecords: dayAcuity, upsertAcuity: upsertDayAcuity } = useFloorRoomAcuity(unitId, dateStr, "day");
  const { acuityRecords: eveningAcuity, upsertAcuity: upsertEveningAcuity } = useFloorRoomAcuity(unitId, dateStr, "evening");
  const { acuityRecords: nightAcuity, upsertAcuity: upsertNightAcuity } = useFloorRoomAcuity(unitId, dateStr, "night");

  const acuityByShift: Record<FloorShift, FloorRoomAcuity[]> = {
    day: dayAcuity,
    evening: eveningAcuity,
    night: nightAcuity,
  };

  type UpsertAcuityFn = (data: { unitId: string; date: string; shift: FloorShift; roomNumber: number; acuityLevel: AcuityLevel }) => Promise<FloorRoomAcuity>;

  const upsertAcuityByShift: Record<FloorShift, UpsertAcuityFn> = {
    day: upsertDayAcuity as UpsertAcuityFn,
    evening: upsertEveningAcuity as UpsertAcuityFn,
    night: upsertNightAcuity as UpsertAcuityFn,
  };

  const getAcuityMap = (shift: FloorShift): Record<number, AcuityLevel> => {
    const map: Record<number, AcuityLevel> = {};
    acuityByShift[shift].forEach(r => { map[r.roomNumber] = r.acuityLevel as AcuityLevel; });
    return map;
  };

  const handleSetAcuity = async (shift: FloorShift, room: number, level: AcuityLevel) => {
    if (!unit) return;
    await upsertAcuityByShift[shift]({
      unitId, date: dateStr, shift, roomNumber: room, acuityLevel: level,
    });
    const shiftAssignments = getShiftAssignments(shift);
    const newMap = { ...getAcuityMap(shift), [room]: level };
    for (const a of shiftAssignments) {
      const load = computeAcuityLoad(a.rooms as number[], newMap);
      await upsertAssignment({ ...a, acuityLoad: load });
    }
  };

  const handleAutoAssign = async (shift: FloorShift) => {
    if (!unit) return;
    const available = getAvailableStaff(shift);
    if (available.length === 0) {
      toast({ title: "No available staff for this shift", variant: "destructive" });
      return;
    }
    const acuityMap = getAcuityMap(shift);

    // Use true month-to-date cumulative load from the monthly assignments query
    const staffCumulativeLoad: Record<string, number> = {};
    for (const s of available) {
      const staffMonthly = monthlyAssignments.filter(a => a.staffId === s.id);
      staffCumulativeLoad[s.id] = staffMonthly.reduce((sum, a) => sum + a.acuityLoad, 0);
    }

    // Greedy assignment: assign one room at a time to staff with lowest combined load
    const staffRooms: Record<string, number[]> = {};
    available.forEach(s => { staffRooms[s.id] = []; });
    const currentLoad: Record<string, number> = {};
    available.forEach(s => { currentLoad[s.id] = staffCumulativeLoad[s.id] ?? 0; });

    for (const room of openRooms) {
      const acuity = acuityMap[room] ?? 1;
      let minStaffId = available[0].id;
      let minLoad = currentLoad[minStaffId];
      for (const s of available) {
        if (currentLoad[s.id] < minLoad) {
          minLoad = currentLoad[s.id];
          minStaffId = s.id;
        }
      }
      staffRooms[minStaffId].push(room);
      currentLoad[minStaffId] += acuity;
    }

    // Rebalancing pass: enforce <=1 acuity point spread among staff for this shift.
    // Compute shift-only loads (exclude cumulative) and rebalance by moving rooms.
    const shiftLoad = (sid: string) =>
      computeAcuityLoad(staffRooms[sid], acuityMap);
    let balanced = false;
    let iterations = 0;
    while (!balanced && iterations < 20) {
      iterations++;
      balanced = true;
      const loadedIds = available.map(s => s.id).filter(id => staffRooms[id].length > 0);
      if (loadedIds.length < 2) break;
      let maxId = loadedIds[0], minId = loadedIds[0];
      for (const id of loadedIds) {
        if (shiftLoad(id) > shiftLoad(maxId)) maxId = id;
        if (shiftLoad(id) < shiftLoad(minId)) minId = id;
      }
      const diff = shiftLoad(maxId) - shiftLoad(minId);
      if (diff > 1) {
        // Try to move the lowest-acuity room from maxId to minId to reduce spread.
        const movable = staffRooms[maxId]
          .slice()
          .sort((a, b) => (acuityMap[a] ?? 1) - (acuityMap[b] ?? 1));
        if (movable.length > 0) {
          const roomToMove = movable[0];
          const roomAcuity = acuityMap[roomToMove] ?? 1;
          // Only move if it actually reduces the spread.
          const newMaxLoad = shiftLoad(maxId) - roomAcuity;
          const newMinLoad = shiftLoad(minId) + roomAcuity;
          if (Math.abs(newMaxLoad - newMinLoad) < diff) {
            staffRooms[maxId] = staffRooms[maxId].filter(r => r !== roomToMove);
            staffRooms[minId] = [...staffRooms[minId], roomToMove];
            balanced = false;
          }
        }
      }
    }

    // Capture existing Charge RN designation before clearing so we can restore it.
    const existingChargeRnId = assignments.find(a => a.shift === shift && a.isChargeRn)?.staffId;

    await clearShift(shift);

    for (const s of available) {
      if (staffRooms[s.id].length > 0) {
        const load = computeAcuityLoad(staffRooms[s.id], acuityMap);
        await upsertAssignment({
          staffId: s.id,
          unitId,
          date: dateStr,
          shift,
          rooms: staffRooms[s.id],
          acuityLoad: load,
          isChargeRn: existingChargeRnId === s.id,
        });
      }
    }

    toast({ title: `Auto-assigned ${openRooms.length} rooms across ${available.length} staff` });
    refetchAssignments();
  };

  const handleSetChargeRn = async (shift: FloorShift, staffId: string) => {
    const shiftAssignments = getShiftAssignments(shift);
    for (const a of shiftAssignments) {
      await upsertAssignment({ ...a, isChargeRn: a.staffId === staffId });
    }
    if (!shiftAssignments.find(a => a.staffId === staffId)) {
      await upsertAssignment({
        staffId,
        unitId,
        date: dateStr,
        shift,
        rooms: [],
        acuityLoad: 0,
        isChargeRn: true,
      });
    }
  };

  const handleUpdateRoomCount = async () => {
    if (!unit || !openRoomEdit) return;
    const count = Number(roomCountEdit);
    if (isNaN(count) || count < 0) return;
    await upsertDailyRooms({ unitId, date: dateStr, openRoomCount: count });
    setOpenRoomEdit(null);
    setRoomCountEdit("");
    toast({ title: "Room count updated" });
  };

  const handleUpdateStaffRooms = async (shift: FloorShift, staffId: string, newRooms: number[]) => {
    const acuityMap = getAcuityMap(shift);
    const shiftAssignments = getShiftAssignments(shift);
    const newRoomSet = new Set(newRooms);

    // Remove newly claimed rooms from any other staff assignments first, then recalculate their loads
    for (const a of shiftAssignments) {
      if (a.staffId === staffId) continue;
      const currentRooms = a.rooms as number[];
      const filteredRooms = currentRooms.filter(r => !newRoomSet.has(r));
      if (filteredRooms.length !== currentRooms.length) {
        const updatedLoad = computeAcuityLoad(filteredRooms, acuityMap);
        await upsertAssignment({ ...a, rooms: filteredRooms, acuityLoad: updatedLoad });
      }
    }

    // Now assign the new room list to this staff member
    const load = computeAcuityLoad(newRooms, acuityMap);
    const existing = shiftAssignments.find(a => a.staffId === staffId);
    await upsertAssignment({
      staffId,
      unitId,
      date: dateStr,
      shift,
      rooms: newRooms,
      acuityLoad: load,
      isChargeRn: existing?.isChargeRn ?? false,
    });
    refetchAssignments();
  };

  const handleCopyOutlook = () => {
    if (!unit) return;
    let text = `Floor Staffing — ${unit.name} — ${dateStr}\n`;
    text += "=".repeat(50) + "\n\n";

    for (const shift of FLOOR_SHIFTS) {
      const shiftAssignments = getShiftAssignments(shift);
      const chargeRn = getChargeRn(shift);
      const report = getReport(shift);

      text += `${FLOOR_SHIFT_LABELS[shift].toUpperCase()}\n`;
      text += `Charge RN: ${chargeRn ? chargeRn.name : "Unassigned"}\n`;

      if (shiftAssignments.length === 0) {
        text += "  No staff assigned\n";
      } else {
        for (const a of shiftAssignments) {
          const s = allFloorStaff.find(x => x.id === a.staffId);
          if (!s) continue;
          const rooms = (a.rooms as number[]).join(", ");
          text += `  ${s.name} (${s.role}) | Rooms: ${rooms || "None"} | Load: ${a.acuityLoad}\n`;
        }
      }

      if (report?.shiftSummary) text += `  Summary: ${report.shiftSummary}\n`;
      if (report?.huddleTopics) text += `  Huddle: ${report.huddleTopics}\n`;
      text += "\n";
    }

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Copied to clipboard" });
    });
  };

  type ExcelRow = {
    "Shift": string;
    "Staff Name": string;
    "Role": string;
    "Rooms": string;
    "Acuity Load": number | string;
    "Shift Summary": string;
  };

  const handleDownloadExcel = async () => {
    if (!unit) return;
    const rows: ExcelRow[] = [];
    for (const shift of FLOOR_SHIFTS) {
      const shiftAssignments = getShiftAssignments(shift);
      const chargeRn = getChargeRn(shift);
      const report = getReport(shift);

      rows.push({
        "Shift": FLOOR_SHIFT_LABELS[shift],
        "Staff Name": "CHARGE RN",
        "Role": "RN",
        "Rooms": chargeRn ? chargeRn.name : "Unassigned",
        "Acuity Load": "",
        "Shift Summary": report?.shiftSummary ?? "",
      });

      for (const a of shiftAssignments) {
        const s = allFloorStaff.find(x => x.id === a.staffId);
        if (!s) continue;
        rows.push({
          "Shift": FLOOR_SHIFT_LABELS[shift],
          "Staff Name": s.name,
          "Role": s.role,
          "Rooms": (a.rooms as number[]).join(", "),
          "Acuity Load": a.acuityLoad,
          "Shift Summary": "",
        });
      }
    }

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("Floor Schedule");
    if (rows.length > 0) {
      ws.addRow(Object.keys(rows[0]));
      rows.forEach(r => ws.addRow(Object.values(r) as (string | number)[]));
    }
    await downloadWorkbook(workbook, `floor-schedule-${unit.name.replace(/\s/g, "-")}-${dateStr}.xlsx`);
  };

  if (unitsLoading || staffLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64" data-testid="floor-loading">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </AppLayout>
    );
  }

  if (activeUnits.length === 0) {
    return (
      <AppLayout>
        <div className="p-8 max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-3xl font-bold tracking-tight font-heading">Floor Staffing</h2>
              <p className="text-muted-foreground mt-1">Inpatient unit scheduling — 3-shift, acuity-weighted</p>
            </div>
            {isAdmin && (
              <Button onClick={() => setUnitModal({})} data-testid="btn-add-unit">
                <Settings className="h-4 w-4 mr-2" />
                Add Floor Unit
              </Button>
            )}
          </div>
          <Card className="border-dashed border-2">
            <CardContent className="py-12 text-center">
              <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium text-lg">No floor units configured</p>
              <p className="text-muted-foreground text-sm mt-1">Add a floor unit to get started with floor staffing.</p>
              {isAdmin && (
                <Button className="mt-4" onClick={() => setUnitModal({})} data-testid="btn-add-first-unit">
                  Add Floor Unit
                </Button>
              )}
            </CardContent>
          </Card>
          {unitModal !== null && (
            <UnitManageModal
              open
              onClose={() => setUnitModal(null)}
              onSave={(data) => createUnit(data)}
            />
          )}
          <UnitsListModal
            open={showUnitsListModal}
            onClose={() => setShowUnitsListModal(false)}
            units={activeUnits}
            onAdd={() => { setShowUnitsListModal(false); setUnitModal({}); }}
            onEdit={(u) => { setShowUnitsListModal(false); setUnitModal({ editing: u }); }}
            onDelete={async (u) => {
              try { await deleteUnit(u.id); toast({ title: `Unit "${u.name}" deleted` }); }
              catch { toast({ title: "Failed to delete unit", variant: "destructive" }); }
            }}
          />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-3xl font-bold tracking-tight font-heading">Floor Staffing</h2>
            <p className="text-muted-foreground mt-1">Inpatient unit scheduling — 3-shift, acuity-weighted</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={() => setShowUnitsListModal(true)} data-testid="btn-manage-units">
                <Settings className="h-4 w-4 mr-1" />
                Manage Units
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleCopyOutlook} data-testid="btn-copy-outlook">
              {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
              Copy for Outlook
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadExcel} data-testid="btn-download-excel">
              <Download className="h-4 w-4 mr-1" />
              Download Excel
            </Button>
          </div>
        </div>

        {/* Date picker + Unit selector */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 bg-muted/40 rounded-lg p-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDate(d => addDays(d, -1))} data-testid="btn-prev-day">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium px-2 min-w-[130px] text-center" data-testid="text-current-date">
              {format(date, "EEEE, MMM d, yyyy")}
            </span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDate(d => addDays(d, 1))} data-testid="btn-next-day">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Select value={selectedUnitId || unit?.id || ""} onValueChange={setSelectedUnitId} data-testid="select-unit">
            <SelectTrigger className="w-48" data-testid="trigger-unit-selector">
              <SelectValue placeholder="Select unit" />
            </SelectTrigger>
            <SelectContent>
              {activeUnits.map(u => (
                <SelectItem key={u.id} value={u.id} data-testid={`option-unit-${u.id}`}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {unit && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Open rooms:</span>
              {isAdmin && openRoomEdit === "edit" ? (
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    className="h-7 w-20 text-sm"
                    value={roomCountEdit}
                    onChange={e => setRoomCountEdit(e.target.value)}
                    data-testid="input-open-room-count"
                  />
                  <Button size="sm" className="h-7 text-xs" onClick={handleUpdateRoomCount} data-testid="btn-save-room-count">Save</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpenRoomEdit(null)}>Cancel</Button>
                </div>
              ) : (
                <span
                  className={`font-semibold ${isAdmin ? "cursor-pointer underline underline-offset-2 text-primary" : "text-primary"}`}
                  onClick={isAdmin ? () => { setOpenRoomEdit("edit"); setRoomCountEdit(String(openRoomCount)); } : undefined}
                  data-testid="text-open-room-count"
                >
                  {openRoomCount} (Rooms {unit.roomStart}–{unit.roomStart + openRoomCount - 1})
                </span>
              )}
            </div>
          )}
        </div>

        {/* 3-Shift Grid */}
        <div className="space-y-4">
          {FLOOR_SHIFTS.map(shift => {
            const shiftAssignments = getShiftAssignments(shift);
            const chargeRn = getChargeRn(shift);
            const available = getAvailableStaff(shift);
            const assignedIds = getAssignedStaffIds(shift);
            const acuityMap = getAcuityMap(shift);
            const report = getReport(shift);

            // Within-day handoff: evening receives from day, night receives from evening.
            // Cross-date handoff: day receives from previous night (prevNightReport).
            const prevShift: FloorShift | undefined = shift === "evening" ? "day" : shift === "night" ? "evening" : undefined;
            const prevReport = shift === "day"
              ? (prevNightReport ?? undefined)
              : (prevShift ? getReport(prevShift) : undefined);
            const prevReportShift: FloorShift | undefined = shift === "day" ? "night" : prevShift;

            return (
              <Card key={shift} className={cn("border-l-4", SHIFT_COLORS[shift])}>
                <CardHeader className={cn("py-3 border-b", SHIFT_HEADER_BG[shift])}>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <CardTitle className="text-base font-semibold">
                        {shift.charAt(0).toUpperCase() + shift.slice(1)} Shift — {FLOOR_SHIFT_LABELS[shift]}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {shiftAssignments.length} staff assigned · {openRooms.length} rooms open
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Charge RN selector — admin only */}
                      {isAdmin ? (
                        <div className="flex items-center gap-1 text-xs">
                          <span className="text-muted-foreground font-medium">Charge RN:</span>
                          <Select
                            value={chargeRn?.id ?? "none"}
                            onValueChange={v => v !== "none" && handleSetChargeRn(shift, v)}
                          >
                            <SelectTrigger className="h-7 text-xs w-40" data-testid={`select-charge-rn-${shift}`}>
                              <SelectValue placeholder="Assign charge RN" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">— Unassigned —</SelectItem>
                              {available.filter(s => s.role === "RN").map(s => (
                                <SelectItem key={s.id} value={s.id} data-testid={`option-charge-rn-${s.id}`}>{s.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : chargeRn ? (
                        <div className="flex items-center gap-1 text-xs">
                          <span className="text-muted-foreground font-medium">Charge RN:</span>
                          <span className="font-semibold" data-testid={`text-charge-rn-${shift}`}>{chargeRn.name}</span>
                        </div>
                      ) : null}

                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => handleAutoAssign(shift)}
                          data-testid={`btn-auto-assign-${shift}`}
                        >
                          <Zap className="h-3 w-3 mr-1" />
                          Auto-Assign
                        </Button>
                      )}

                      {/* View incoming shift report (read-only) — only incoming or outgoing Charge RN, or admin */}
                      {prevReport && prevReportShift && (isChargeRnForShift(shift) || isChargeRnForShift(prevReportShift)) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
                          onClick={() => setReportModal({ shift: prevReportShift, readOnly: true, crossDateReport: shift === "day" ? prevNightReport : undefined })}
                          data-testid={`btn-view-incoming-report-${shift}`}
                        >
                          <Eye className="h-3 w-3 mr-1" />
                          View Incoming Report
                        </Button>
                      )}

                      {/* Write / edit current shift report — only current shift's Charge RN or admin */}
                      {isChargeRnForShift(shift) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => setReportModal({ shift })}
                          data-testid={`btn-open-report-${shift}`}
                          disabled={!chargeRn}
                          title={!chargeRn ? "Assign a Charge RN first" : undefined}
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          {report ? "Edit Report" : "Write Report"}
                        </Button>
                      )}

                      {report && isChargeRnForShift(shift) && (
                        <Badge variant="outline" className="text-[10px] h-5 bg-green-50 text-green-700 border-green-300">
                          Report saved
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-4">
                  {/* Room Acuity Legend */}
                  <div className="flex items-center gap-3 mb-3 text-xs text-muted-foreground">
                    <span className="font-medium">Room Acuity:</span>
                    {([1, 2, 3] as AcuityLevel[]).map(l => (
                      <span key={l} className={cn("px-1.5 py-0.5 rounded border text-[10px] font-medium", ACUITY_COLORS[l])}>
                        {l} = {l === 1 ? "Routine" : l === 2 ? "Moderate" : "High"}
                      </span>
                    ))}
                    <span className="ml-auto text-[10px]">Click a chip to change acuity</span>
                  </div>

                  {/* Room chips with acuity */}
                  {openRooms.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-medium text-muted-foreground mb-2">Open Rooms</p>
                      <div className="flex flex-wrap gap-1.5">
                        {openRooms.map(room => {
                          const acuity = (acuityMap[room] ?? 1) as AcuityLevel;
                          const assignee = shiftAssignments.find(a => (a.rooms as number[]).includes(room));
                          const assigneeName = assignee ? allFloorStaff.find(s => s.id === assignee.staffId)?.name : null;
                          return (
                            <div key={room} className={cn("group relative flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium", ACUITY_COLORS[acuity])}>
                              <span data-testid={`room-chip-${shift}-${room}`}>Rm {room}</span>
                              {assigneeName && <span className="text-[9px] opacity-70">({assigneeName.split(" ").pop()})</span>}
                              {isAdmin && (
                              <div className="absolute hidden group-hover:flex items-center gap-0.5 -top-6 left-0 bg-popover border rounded shadow text-xs px-1 py-0.5 z-10 whitespace-nowrap">
                                {([1, 2, 3] as AcuityLevel[]).map(l => (
                                  <button
                                    key={l}
                                    className={cn("w-5 h-5 rounded text-[10px] font-bold border", ACUITY_COLORS[l])}
                                    onClick={() => handleSetAcuity(shift, room, l)}
                                    data-testid={`btn-set-acuity-${shift}-${room}-${l}`}
                                  >{l}</button>
                                ))}
                              </div>
                            )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Staff assignments */}
                  {shiftAssignments.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground text-sm border-2 border-dashed rounded-lg">
                      No staff assigned. Use Auto-Assign or add staff below.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
                      {shiftAssignments.map(a => {
                        const s = allFloorStaff.find(x => x.id === a.staffId);
                        if (!s) return null;
                        return (
                          <div
                            key={a.id}
                            className={cn("border rounded-lg p-3 bg-card shadow-sm", a.isChargeRn && "ring-2 ring-primary")}
                            data-testid={`staff-card-${shift}-${a.staffId}`}
                          >
                            <div className="flex items-start justify-between gap-1">
                              <div className="min-w-0">
                                <p className="font-medium text-sm truncate">{s.name}</p>
                                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                  <Badge variant="outline" className="text-[10px] h-4 px-1">{s.role}</Badge>
                                  {a.isChargeRn && <Badge className="text-[10px] h-4 px-1 bg-primary/10 text-primary border-primary/30">Charge RN</Badge>}
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <div className={cn(
                                  "text-sm font-bold px-2 py-0.5 rounded border",
                                  a.acuityLoad <= 5 ? "bg-green-50 text-green-700 border-green-200" :
                                  a.acuityLoad <= 10 ? "bg-yellow-50 text-yellow-700 border-yellow-200" :
                                  "bg-red-50 text-red-700 border-red-200"
                                )}
                                data-testid={`badge-load-${shift}-${a.staffId}`}
                                title="Acuity-weighted load"
                                >
                                  Load: {a.acuityLoad}
                                </div>
                                {isAdmin && (
                                  <>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 text-muted-foreground hover:text-primary"
                                      onClick={() => setRoomEditModal({ shift, staffId: a.staffId })}
                                      data-testid={`btn-edit-rooms-${shift}-${a.staffId}`}
                                      title="Edit room assignments"
                                    >
                                      <Pencil className="h-3 w-3" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                      onClick={() => deleteAssignment(a.id)}
                                      data-testid={`btn-remove-staff-${shift}-${a.staffId}`}
                                    >
                                      <X className="h-3 w-3" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {(a.rooms as number[]).length === 0 ? (
                                <span className="text-xs text-muted-foreground">{isAdmin ? "No rooms — click pencil to assign" : "No rooms assigned"}</span>
                              ) : (
                                (a.rooms as number[]).map(r => (
                                  <span key={r} className={cn("text-[10px] px-1 py-0.5 rounded border font-medium", ACUITY_COLORS[(acuityMap[r] ?? 1) as AcuityLevel])}>
                                    {r}
                                  </span>
                                ))
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Add unassigned staff — admin only */}
                  {isAdmin && available.filter(s => !assignedIds.has(s.id)).length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">Add Staff to Shift</p>
                      <div className="flex flex-wrap gap-1.5">
                        {available.filter(s => !assignedIds.has(s.id)).map(s => (
                          <Button
                            key={s.id}
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            data-testid={`btn-add-staff-${shift}-${s.id}`}
                            onClick={async () => {
                              await upsertAssignment({
                                staffId: s.id,
                                unitId,
                                date: dateStr,
                                shift,
                                rooms: [],
                                acuityLoad: 0,
                                isChargeRn: false,
                              });
                            }}
                          >
                            + {s.name} ({s.role})
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Shift Report Modal */}
      {reportModal && unit && (() => {
        const shift = reportModal.shift;
        const chargeRn = getChargeRn(shift);
        return (
          <ShiftReportModal
            open
            onClose={() => setReportModal(null)}
            shift={shift}
            unit={unit}
            date={dateStr}
            chargeRnId={chargeRn?.id ?? ""}
            chargeRnName={chargeRn?.name ?? ""}
            assignments={getShiftAssignments(shift)}
            staff={allFloorStaff}
            acuityRecords={acuityByShift[shift]}
            existingReport={
              // When viewing cross-date incoming report (day viewing yesterday's night),
              // the crossDateReport IS the report to display in read-only mode.
              reportModal?.crossDateReport !== undefined
                ? (reportModal.crossDateReport ?? undefined)
                : getReport(shift)
            }
            onSave={upsertReport}
            prevReport={
              // For write mode: show the previous shift's report for context.
              !reportModal?.readOnly ? (
                shift === "evening" ? getReport("day")
                : shift === "night" ? getReport("evening")
                : prevNightReport ?? undefined
              ) : undefined
            }
            readOnly={reportModal.readOnly}
          />
        );
      })()}

      {/* Room Edit Modal */}
      {roomEditModal && unit && (() => {
        const { shift, staffId } = roomEditModal;
        const shiftAssignments = getShiftAssignments(shift);
        const thisAssignment = shiftAssignments.find(a => a.staffId === staffId);
        const otherAssignments = shiftAssignments.filter(a => a.staffId !== staffId);
        const staffMember = allFloorStaff.find(s => s.id === staffId);
        return (
          <RoomEditModal
            open
            onClose={() => setRoomEditModal(null)}
            shift={shift}
            staffId={staffId}
            staffName={staffMember?.name ?? "Staff"}
            currentRooms={(thisAssignment?.rooms as number[]) ?? []}
            allRooms={openRooms}
            otherStaffAssignments={otherAssignments}
            otherFloorStaff={allFloorStaff}
            onSave={(rooms) => handleUpdateStaffRooms(shift, staffId, rooms)}
          />
        );
      })()}

      {/* Units List Modal */}
      <UnitsListModal
        open={showUnitsListModal}
        onClose={() => setShowUnitsListModal(false)}
        units={activeUnits}
        onAdd={() => {
          setShowUnitsListModal(false);
          setUnitModal({});
        }}
        onEdit={(u) => {
          setShowUnitsListModal(false);
          setUnitModal({ editing: u });
        }}
        onDelete={async (u) => {
          try {
            await deleteUnit(u.id);
            toast({ title: `Unit "${u.name}" deleted` });
          } catch {
            toast({ title: "Failed to delete unit", variant: "destructive" });
          }
        }}
      />

      {/* Unit Add / Edit Modal */}
      {unitModal !== null && (
        <UnitManageModal
          open
          onClose={() => setUnitModal(null)}
          existing={unitModal.editing}
          onSave={async (data) => {
            const result = unitModal.editing
              ? await updateUnit({ id: unitModal.editing.id, data })
              : await createUnit(data);
            setShowUnitsListModal(false);
            return result;
          }}
        />
      )}
    </AppLayout>
  );
}
