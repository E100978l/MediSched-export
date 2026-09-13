import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { UserPlus, Trash2, ShieldCheck, User as UserIcon, AlertTriangle, RotateCcw } from "lucide-react";
import type { PublicUser } from "@shared/schema";

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || res.statusText);
  }
  return res.json();
}

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "user">("user");
  const [saving, setSaving] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetStartDate, setResetStartDate] = useState("");
  const [resetEndDate, setResetEndDate] = useState("");
  const [resetScope, setResetScope] = useState<"all" | "range">("range");

  const { data: users = [], isLoading } = useQuery<PublicUser[]>({
    queryKey: ["/api/auth/users"],
    queryFn: () => apiFetch("/api/auth/users"),
    refetchInterval: 15000,
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      apiFetch(`/api/auth/users/${id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/users"] });
      toast({ title: "Role updated" });
    },
    onError: (err: any) => toast({ title: "Failed to update role", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/auth/users/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/users"] });
      toast({ title: "User removed" });
    },
    onError: (err: any) => toast({ title: "Failed to delete user", description: err.message, variant: "destructive" }),
  });

  const closeResetDialog = () => {
    setShowResetConfirm(false);
    setResetConfirmText("");
    setResetStartDate("");
    setResetEndDate("");
    setResetScope("range");
  };

  const rangeValid = resetScope === "all" || (resetStartDate !== "" && resetEndDate !== "" && resetStartDate <= resetEndDate);

  const handleResetSchedule = async () => {
    setResetting(true);
    try {
      const body: Record<string, string> = {};
      if (resetScope === "range" && resetStartDate && resetEndDate) {
        body.startDate = resetStartDate;
        body.endDate = resetEndDate;
      }
      const res = await fetch("/api/admin/reset-schedule", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || "Reset failed");
      }
      const rangeDesc = resetScope === "range" && resetStartDate && resetEndDate
        ? ` from ${resetStartDate} to ${resetEndDate}`
        : " (all dates)";
      toast({
        title: "Schedule data cleared",
        description: `Scheduling records${rangeDesc} have been removed. Staff members are intact.`,
      });
      closeResetDialog();
    } catch (err: any) {
      toast({ title: "Reset failed", description: err.message, variant: "destructive" });
    } finally {
      setResetting(false);
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ name: newName, email: newEmail, password: newPassword, role: newRole }),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/users"] });
      toast({ title: "User added", description: `${newName} can now log in.` });
      setShowAdd(false);
      setNewName(""); setNewEmail(""); setNewPassword(""); setNewRole("user");
    } catch (err: any) {
      toast({ title: "Failed to add user", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">User Management</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage who can access MediSched and their permissions.</p>
          </div>
          <Button data-testid="button-add-user" onClick={() => setShowAdd(true)}>
            <UserPlus className="h-4 w-4 mr-2" /> Add User
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {users.length} {users.length === 1 ? "user" : "users"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : (
              <div className="space-y-3">
                {users.map(u => (
                  <div
                    key={u.id}
                    data-testid={`row-user-${u.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border bg-background"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                        {u.role === "admin"
                          ? <ShieldCheck className="h-4 w-4 text-primary" />
                          : <UserIcon className="h-4 w-4 text-muted-foreground" />}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{u.name}</p>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                        {u.role === "admin" ? "Admin" : "User"}
                      </Badge>
                      {u.id === currentUser?.id ? (
                        <Badge variant="outline" className="text-xs">You</Badge>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`button-toggle-role-${u.id}`}
                            onClick={() => updateRoleMutation.mutate({ id: u.id, role: u.role === "admin" ? "user" : "admin" })}
                          >
                            {u.role === "admin" ? "Make User" : "Make Admin"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            data-testid={`button-delete-user-${u.id}`}
                            onClick={() => {
                              if (confirm(`Remove ${u.name}?`)) deleteMutation.mutate(u.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-amber-800 font-medium">Role Permissions</p>
            <div className="mt-2 grid grid-cols-2 gap-4 text-xs text-amber-700">
              <div>
                <p className="font-semibold mb-1">Admin</p>
                <ul className="space-y-0.5 list-disc list-inside">
                  <li>All data operations</li>
                  <li>Add / remove users</li>
                  <li>Change user roles</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold mb-1">User</p>
                <ul className="space-y-0.5 list-disc list-inside">
                  <li>Add / edit providers &amp; LVNs</li>
                  <li>Manage schedules &amp; clinics</li>
                  <li>Availability &amp; coverage</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Danger Zone — admin only */}
        {currentUser?.role === "admin" && (
          <Card className="border-destructive/40 bg-destructive/5" data-testid="card-danger-zone">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
              </div>
              <CardDescription>
                Irreversible actions. Staff members will not be affected.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between rounded-lg border border-destructive/30 p-4 bg-white">
                <div>
                  <p className="text-sm font-medium">Reset Schedule Data</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Clears all schedules, coverage, unavailability, clinic assignments, and call availability.
                    Staff members and clinic definitions are preserved.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  data-testid="button-reset-schedule"
                  onClick={() => { setResetConfirmText(""); setShowResetConfirm(true); }}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  Reset Schedule
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Reset schedule confirmation dialog */}
      <Dialog open={showResetConfirm} onOpenChange={open => { if (!open) closeResetDialog(); else setShowResetConfirm(true); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" /> Reset Schedule Data
            </DialogTitle>
            <DialogDescription className="pt-1">
              Permanently removes scheduling records. Staff members are never affected.
            </DialogDescription>
          </DialogHeader>

          {/* Scope toggle */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Timeframe to reset</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                data-testid="scope-range"
                onClick={() => setResetScope("range")}
                className={`rounded-lg border px-3 py-2 text-sm text-left transition-colors ${
                  resetScope === "range"
                    ? "border-destructive bg-destructive/10 text-destructive font-medium"
                    : "border-border hover:bg-muted"
                }`}
              >
                Date range
                <p className="text-xs text-muted-foreground font-normal mt-0.5">Clear a specific period</p>
              </button>
              <button
                type="button"
                data-testid="scope-all"
                onClick={() => setResetScope("all")}
                className={`rounded-lg border px-3 py-2 text-sm text-left transition-colors ${
                  resetScope === "all"
                    ? "border-destructive bg-destructive/10 text-destructive font-medium"
                    : "border-border hover:bg-muted"
                }`}
              >
                All dates
                <p className="text-xs text-muted-foreground font-normal mt-0.5">Wipe everything</p>
              </button>
            </div>
          </div>

          {/* Date inputs — shown when range is selected */}
          {resetScope === "range" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="reset-start" className="text-xs text-muted-foreground">From</Label>
                <Input
                  id="reset-start"
                  type="date"
                  data-testid="input-reset-start"
                  value={resetStartDate}
                  onChange={e => setResetStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="reset-end" className="text-xs text-muted-foreground">To</Label>
                <Input
                  id="reset-end"
                  type="date"
                  data-testid="input-reset-end"
                  value={resetEndDate}
                  min={resetStartDate || undefined}
                  onChange={e => setResetEndDate(e.target.value)}
                />
              </div>
              {resetStartDate && resetEndDate && resetStartDate > resetEndDate && (
                <p className="col-span-2 text-xs text-destructive">"From" date must be before or equal to "To" date.</p>
              )}
            </div>
          )}

          {/* What will be deleted */}
          <ul className="text-xs space-y-1 text-muted-foreground list-disc list-inside bg-muted/40 rounded-lg p-3">
            <li>Provider AM/PM schedules</li>
            <li>Coverage & fill-in records</li>
            <li>Staff unavailability (vacation, sick, FMLA)</li>
            <li>Clinic staff assignments & day closures</li>
            <li>Call availability entries</li>
            <li>Shift distribution log</li>
          </ul>

          {/* Confirmation word */}
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              Type <span className="font-mono font-bold text-foreground">RESET</span> to confirm:
            </p>
            <Input
              data-testid="input-reset-confirm"
              placeholder="RESET"
              value={resetConfirmText}
              onChange={e => setResetConfirmText(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeResetDialog}>Cancel</Button>
            <Button
              variant="destructive"
              data-testid="button-confirm-reset"
              disabled={resetConfirmText !== "RESET" || !rangeValid || resetting}
              onClick={handleResetSchedule}
            >
              {resetting ? "Resetting…" : "Yes, Reset Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddUser} className="space-y-4">
            <div className="space-y-1">
              <Label>Full Name</Label>
              <Input data-testid="input-new-name" value={newName} onChange={e => setNewName(e.target.value)} required placeholder="Jane Smith" />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input data-testid="input-new-email" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} required placeholder="jane@clinic.org" />
            </div>
            <div className="space-y-1">
              <Label>Temporary Password</Label>
              <Input data-testid="input-new-password" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required placeholder="Minimum 6 characters" />
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <Select value={newRole} onValueChange={v => setNewRole(v as "admin" | "user")}>
                <SelectTrigger data-testid="select-new-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User — can manage all data</SelectItem>
                  <SelectItem value="admin">Admin — user management + all data</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button type="submit" data-testid="button-save-user" disabled={saving}>
                {saving ? "Adding…" : "Add User"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
