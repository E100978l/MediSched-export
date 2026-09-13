import { useState } from "react";
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek } from "date-fns";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useFloorStaff, useFloorStaffWorkload, useUsers,
  type FloorStaffMember, type InsertFloorStaff, type FloorShift, type PublicUser,
} from "@/lib/store";
import {
  FLOOR_ROLES, FLOOR_SHIFT_PREFS, EMPLOYMENT_TYPES,
  type FloorRole, type FloorShiftPref, type EmploymentType,
} from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Search, UserPlus, Edit2, UserMinus, UserCheck, Phone, Mail, AlertCircle, BarChart3 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const SHIFT_PREF_LABEL: Record<FloorShiftPref, string> = {
  day: "Day (7a–3p)",
  evening: "Evening (3p–11p)",
  night: "Night (11p–7a)",
  any: "Any Shift",
};

const ROLE_COLORS: Record<FloorRole, string> = {
  RN: "bg-blue-50 text-blue-700 border-blue-200",
  LVN: "bg-green-50 text-green-700 border-green-200",
  CNA: "bg-purple-50 text-purple-700 border-purple-200",
};

function WorkloadBadge({ staffId }: { staffId: string }) {
  const today = new Date();
  const weekStart = format(startOfWeek(today), "yyyy-MM-dd");
  const weekEnd = format(endOfWeek(today), "yyyy-MM-dd");
  const monthStart = format(startOfMonth(today), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(today), "yyyy-MM-dd");

  const { totalAcuityLoad: weekLoad } = useFloorStaffWorkload(staffId, weekStart, weekEnd);
  const { totalAcuityLoad: monthLoad } = useFloorStaffWorkload(staffId, monthStart, monthEnd);

  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="flex items-center gap-1 text-xs">
        <BarChart3 className="h-3 w-3 text-muted-foreground" />
        <span className="text-muted-foreground">This week:</span>
        <span className="font-medium" data-testid={`workload-week-${staffId}`}>{weekLoad}</span>
        <span className="text-muted-foreground ml-2">Month:</span>
        <span className="font-medium" data-testid={`workload-month-${staffId}`}>{monthLoad}</span>
      </div>
    </div>
  );
}

interface StaffFormProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: Partial<InsertFloorStaff>) => Promise<FloorStaffMember>;
  existing?: FloorStaffMember;
  users?: PublicUser[];
}

function StaffFormModal({ open, onClose, onSave, existing, users = [] }: StaffFormProps) {
  const [name, setName] = useState(existing?.name ?? "");
  const [role, setRole] = useState<FloorRole>(existing?.role ?? "RN");
  const [shiftPreference, setShiftPreference] = useState<FloorShiftPref>(existing?.shiftPreference ?? "any");
  const [employmentType, setEmploymentType] = useState<EmploymentType>(existing?.employmentType ?? "Full-time");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [userId, setUserId] = useState<string | null>(existing?.userId ?? null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({ name, role, shiftPreference, employmentType, phone, email, userId, isActive: true });
      toast({ title: existing ? "Staff member updated" : "Staff member added" });
      onClose();
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Floor Staff" : "Add Floor Staff"}</DialogTitle>
          <DialogDescription>
            Floor staff are separate from outpatient clinic staff.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" data-testid="input-staff-name" />
          </div>
          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={v => setRole(v as FloorRole)}>
              <SelectTrigger data-testid="select-staff-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FLOOR_ROLES.map(r => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Shift Preference</Label>
            <Select value={shiftPreference} onValueChange={v => setShiftPreference(v as FloorShiftPref)}>
              <SelectTrigger data-testid="select-shift-preference">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FLOOR_SHIFT_PREFS.map(p => (
                  <SelectItem key={p} value={p}>{SHIFT_PREF_LABEL[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Employment Type</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {EMPLOYMENT_TYPES.map(et => (
                <button
                  key={et}
                  type="button"
                  onClick={() => setEmploymentType(et)}
                  className={cn(
                    "px-3 py-1.5 rounded-md border text-sm font-medium transition-all",
                    employmentType === et
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:border-foreground/40"
                  )}
                  data-testid={`btn-employment-type-${et.replace(/ /g, "-")}`}
                >
                  {et}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Phone</Label>
              <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 000-0000" data-testid="input-phone" />
            </div>
            <div>
              <Label>Email</Label>
              <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="name@hospital.org" data-testid="input-email" />
            </div>
          </div>
          {users.length > 0 && (
            <div>
              <Label>Linked User Account</Label>
              <p className="text-xs text-muted-foreground mb-1">Link to allow this staff member to submit shift reports.</p>
              <Select value={userId ?? "none"} onValueChange={v => setUserId(v === "none" ? null : v)}>
                <SelectTrigger data-testid="select-linked-user">
                  <SelectValue placeholder="No linked account" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No linked account</SelectItem>
                  {users.map(u => (
                    <SelectItem key={u.id} value={u.id}>{u.name} ({u.email})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()} data-testid="btn-save-staff">
            {saving ? "Saving…" : existing ? "Update" : "Add Staff"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function FloorStaffPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { staff, allStaff, isLoading, isError, refetch, createStaff, updateStaff, deactivateStaff, reactivateStaff } = useFloorStaff();
  const { users } = useUsers();

  const [searchQuery, setSearchQuery] = useState("");
  const [formModal, setFormModal] = useState<{ editing?: FloorStaffMember } | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const inactiveStaff = allStaff.filter(s => !s.isActive);

  const filteredStaff = staff.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDeactivate = async (id: string) => {
    try {
      await deactivateStaff(id);
      toast({ title: "Staff member deactivated" });
      setConfirmDeactivate(null);
    } catch {
      toast({ title: "Failed to deactivate", variant: "destructive" });
    }
  };

  const handleReactivate = async (id: string) => {
    try {
      await reactivateStaff(id);
      toast({ title: "Staff member reactivated" });
    } catch {
      toast({ title: "Failed to reactivate", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64" data-testid="floor-staff-loading">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </AppLayout>
    );
  }

  if (isError) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
            <p className="font-medium">Failed to load staff</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>Retry</Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-8 space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-3xl font-bold tracking-tight font-heading">Floor Staff</h2>
            <p className="text-muted-foreground mt-1">Inpatient nursing staff roster — RNs, LVNs, and CNAs</p>
          </div>
          {isAdmin && (
            <Button onClick={() => setFormModal({})} data-testid="btn-add-floor-staff">
              <UserPlus className="h-4 w-4 mr-2" />
              Add Staff
            </Button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {FLOOR_ROLES.map(role => {
            const count = staff.filter(s => s.role === role).length;
            return (
              <Card key={role}>
                <CardContent className="py-3 px-4">
                  <p className="text-xs text-muted-foreground">{role}s</p>
                  <p className="text-2xl font-bold" data-testid={`count-${role}`}>{count}</p>
                </CardContent>
              </Card>
            );
          })}
          <Card>
            <CardContent className="py-3 px-4">
              <p className="text-xs text-muted-foreground">Total Active</p>
              <p className="text-2xl font-bold" data-testid="count-total">{staff.length}</p>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or role..."
            className="pl-10"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            data-testid="input-search-staff"
          />
        </div>

        {/* Staff cards */}
        {filteredStaff.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
            <AlertCircle className="h-8 w-8 mx-auto mb-2" />
            <p>No floor staff found.</p>
            {isAdmin && <Button className="mt-3" onClick={() => setFormModal({})}>Add First Staff Member</Button>}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredStaff.map(member => (
              <Card key={member.id} className="hover:shadow-md transition-shadow" data-testid={`card-staff-${member.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base font-medium truncate">{member.name}</CardTitle>
                      <div className="flex flex-wrap gap-1 mt-1">
                        <Badge variant="outline" className={cn("text-[10px] h-4 px-1", ROLE_COLORS[member.role])}>
                          {member.role}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] h-4 px-1 bg-muted">
                          {SHIFT_PREF_LABEL[member.shiftPreference as FloorShiftPref]}
                        </Badge>
                        {member.employmentType !== "Full-time" && (
                          <Badge variant="outline" className="text-[10px] h-4 px-1 bg-amber-50 text-amber-700 border-amber-200">
                            {member.employmentType}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setFormModal({ editing: member })}
                          data-testid={`btn-edit-staff-${member.id}`}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => setConfirmDeactivate(member.id)}
                          data-testid={`btn-deactivate-staff-${member.id}`}
                        >
                          <UserMinus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {(member.phone || member.email) && (
                    <div className="flex items-center gap-3 text-xs mt-1">
                      {member.phone && (
                        <a href={`tel:${member.phone}`} className="flex items-center gap-1 text-blue-600 hover:underline" data-testid={`link-phone-${member.id}`}>
                          <Phone className="h-3 w-3" />{member.phone}
                        </a>
                      )}
                      {member.email && (
                        <a href={`mailto:${member.email}`} className="flex items-center gap-1 text-blue-600 hover:underline" data-testid={`link-email-${member.id}`}>
                          <Mail className="h-3 w-3" />{member.email}
                        </a>
                      )}
                    </div>
                  )}
                  <WorkloadBadge staffId={member.id} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Inactive staff section */}
        {isAdmin && inactiveStaff.length > 0 && (
          <div className="mt-6">
            <button
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground font-medium mb-3"
              onClick={() => setShowInactive(v => !v)}
              data-testid="btn-toggle-inactive"
            >
              Former Staff ({inactiveStaff.length})
            </button>
            {showInactive && (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {inactiveStaff.map(member => (
                  <Card key={member.id} className="opacity-60 border-dashed" data-testid={`card-inactive-staff-${member.id}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-base font-medium text-muted-foreground">{member.name}</CardTitle>
                          <div className="flex gap-1 mt-1">
                            <Badge variant="outline" className="text-[10px]">{member.role}</Badge>
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => handleReactivate(member.id)}
                          data-testid={`btn-reactivate-staff-${member.id}`}
                        >
                          <UserCheck className="h-3 w-3 mr-1" />
                          Reactivate
                        </Button>
                      </div>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add/Edit modal */}
      {formModal !== null && (
        <StaffFormModal
          open
          onClose={() => setFormModal(null)}
          existing={formModal.editing}
          users={users}
          onSave={async (data) => {
            if (formModal.editing) {
              return updateStaff({ id: formModal.editing.id, data });
            } else {
              return createStaff(data as InsertFloorStaff);
            }
          }}
        />
      )}

      {/* Confirm deactivate */}
      <Dialog open={!!confirmDeactivate} onOpenChange={() => setConfirmDeactivate(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Deactivate Staff Member?</DialogTitle>
            <DialogDescription>
              This will mark them as inactive. Their historical assignment data is preserved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeactivate(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => confirmDeactivate && handleDeactivate(confirmDeactivate)}
              data-testid="btn-confirm-deactivate"
            >
              Deactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
