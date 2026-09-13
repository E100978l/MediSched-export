import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useStaff } from "@/lib/store";
import { useAuth } from "@/contexts/AuthContext";
import { SPECIALTIES, PROVIDER_SPECIALTIES, CLINIC_AREAS, StaffMember, StaffType, Specialty } from "@/lib/mockData";
import { EMPLOYMENT_TYPES, RN_POSITIONS, type EmploymentType } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, UserPlus, Lock, Edit2, ShieldCheck, Stethoscope, Star, UserMinus, UserCheck, ChevronDown, ChevronRight, CalendarDays, Phone, Mail, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StaffLookupModal } from "@/components/StaffLookupModal";

export default function Staff() {
  const { staff, inactiveStaff, updateStaffMember, addStaffMember, deactivateStaffMember, reactivateStaffMember, isLoading, isError, refetch } = useStaff();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [searchQuery, setSearchQuery] = useState("");
  
  // Edit State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSpecialty, setEditSpecialty] = useState<Specialty>(SPECIALTIES[0]);
  // For LVNs: assigned Providers
  const [editAssignedTo, setEditAssignedTo] = useState<string[]>([]);
  // For LVNs: cross-trained specialties
  const [editCrossTrained, setEditCrossTrained] = useState<Specialty[]>([]);
  // For Providers: assigned LVNs (derived/managed via LVN update logic)
  const [editProviderAssignedLvns, setEditProviderAssignedLvns] = useState<string[]>([]);
  // For Providers: how many LVNs they need
  const [editLvnsRequired, setEditLvnsRequired] = useState<number>(1);

  // Add State
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<StaffType>("LVN");
  const [newSpecialty, setNewSpecialty] = useState<Specialty>(SPECIALTIES[0]);

  // Contact info edit state
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");

  // Employment type state
  const [editEmploymentType, setEditEmploymentType] = useState<EmploymentType>("Full-time");
  const [newEmploymentType, setNewEmploymentType] = useState<EmploymentType>("Full-time");

  // Default charge position (RNs only)
  const [editDefaultChargePositionId, setEditDefaultChargePositionId] = useState<string | null>(null);

  // Deactivate confirmation state (inside edit dialog)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  // Former staff section
  const [showFormerStaff, setShowFormerStaff] = useState(false);

  // Lookup modal
  const [lookupStaffId, setLookupStaffId] = useState<string | null>(null);

  // Coverage State
  const [isCoverageOpen, setIsCoverageOpen] = useState(false);
  const [coverageSpecialty, setCoverageSpecialty] = useState<Specialty | "">("");

  // Helper to get names of providers an LVN is assigned to
  const getAssignedProviderNames = (providerIds?: string[]) => {
      if (!providerIds || providerIds.length === 0) return 'Unassigned';
      return providerIds.map(id => staff.find(p => p.id === id)?.name).filter(Boolean).join(', ');
  };

  const filteredStaff = staff.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.role.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.specialty.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleEditOpen = (staffMember: StaffMember) => {
    setEditingId(staffMember.id);
    setEditName(staffMember.name);
    setEditSpecialty(staffMember.specialty);
    setEditPhone(staffMember.phone || "");
    setEditEmail(staffMember.email || "");
    setEditEmploymentType((staffMember.employmentType as EmploymentType) || "Full-time");

    if (staffMember.role === 'LVN' || staffMember.role === 'RN') {
      setEditAssignedTo(staffMember.assignedTo || []);
      setEditCrossTrained(staffMember.crossTrained || []);
      setEditDefaultChargePositionId(staffMember.role === 'RN' ? (staffMember.defaultChargePositionId ?? null) : null);
    } else if (['MD', 'DO', 'NP', 'PA'].includes(staffMember.role)) {
      // Find LVNs assigned to this provider
      const assignedLvns = staff.filter(s => s.role === 'LVN' && s.assignedTo?.includes(staffMember.id)).map(s => s.id);
      setEditProviderAssignedLvns(assignedLvns);
      setEditLvnsRequired(staffMember.lvnsRequired ?? 1);
    }
  };

  const handleSave = () => {
    if (editingId && editName.trim()) {
      const member = staff.find(s => s.id === editingId);
      if (!member) return;

      const updatedMember = { ...member, name: editName, specialty: editSpecialty, phone: editPhone, email: editEmail, employmentType: editEmploymentType };

      if (member.role === 'LVN' || member.role === 'RN') {
         // Update LVN/RN assignment and cross-training
         updatedMember.assignedTo = editAssignedTo;
         updatedMember.crossTrained = editCrossTrained;
         if (member.role === 'RN') {
           updatedMember.defaultChargePositionId = editDefaultChargePositionId ?? null;
         }
         updateStaffMember(updatedMember);
      } else {
         // Provider update — include lvnsRequired
         updatedMember.lvnsRequired = editLvnsRequired;
         // Update the provider first
         updateStaffMember(updatedMember);
         
         // Now update related LVNs
         // 1. Add this provider to newly checked LVNs
         staff.filter(s => s.role === 'LVN' && editProviderAssignedLvns.includes(s.id) && !s.assignedTo?.includes(editingId))
              .forEach(lvn => {
                  updateStaffMember({
                      ...lvn,
                      assignedTo: [...(lvn.assignedTo || []), editingId]
                  });
              });

         // 2. Remove this provider from unchecked LVNs
         staff.filter(s => s.role === 'LVN' && !editProviderAssignedLvns.includes(s.id) && s.assignedTo?.includes(editingId))
              .forEach(lvn => {
                  updateStaffMember({
                      ...lvn,
                      assignedTo: lvn.assignedTo?.filter(pid => pid !== editingId) || []
                  });
              });
      }

      setEditingId(null);
      setEditName("");
      setEditSpecialty(SPECIALTIES[0]);
      setEditAssignedTo([]);
      setEditCrossTrained([]);
      setEditProviderAssignedLvns([]);
      setEditLvnsRequired(1);
    }
  };

  const toggleAssignedProvider = (providerId: string) => {
    setEditAssignedTo(prev => 
      prev.includes(providerId) 
        ? prev.filter(id => id !== providerId)
        : [...prev, providerId]
    );
  };

  const toggleProviderLvn = (lvnId: string) => {
    setEditProviderAssignedLvns(prev => 
      prev.includes(lvnId)
        ? prev.filter(id => id !== lvnId)
        : [...prev, lvnId]
    );
  };

  const toggleCrossTrained = (specialty: Specialty) => {
    setEditCrossTrained(prev => 
      prev.includes(specialty)
        ? prev.filter(s => s !== specialty)
        : [...prev, specialty]
    );
  };

  const handleDeactivateStaff = (id: string) => {
    deactivateStaffMember(id);
    setEditingId(null);
    setConfirmDeactivate(false);
  };

  const handleCloseEditDialog = () => {
    setEditingId(null);
    setConfirmDeactivate(false);
  };

  const handleAddStaff = () => {
    if (newName.trim()) {
      addStaffMember({
        name: newName,
        role: newRole,
        specialty: newSpecialty,
        crossTrained: [],
        assignedTo: [],
        isFloatPool: false,
        lvnsRequired: 1,
        phone: "",
        email: "",
        employmentType: newEmploymentType,
        isActive: true,
      });
      setIsAddOpen(false);
      setNewName("");
      setNewRole("LVN");
      setNewSpecialty(SPECIALTIES[0]);
      setNewEmploymentType("Full-time");
    }
  };

  // Get all providers for the LVN assignment list
  const allProviders = staff.filter(s => ['MD', 'DO', 'NP', 'PA'].includes(s.role));
  // Get all LVNs for the Provider assignment list
  const allLvns = staff.filter(s => s.role === 'LVN');

  const getCoverageStaff = () => {
    if (!coverageSpecialty) return [];
    return staff.filter(s => 
      (s.role === 'LVN' || s.role === 'RN') && 
      (s.specialty === coverageSpecialty || s.crossTrained?.includes(coverageSpecialty as Specialty))
    );
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="p-8 flex items-center justify-center min-h-[50vh]" data-testid="staff-loading">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            <p className="text-sm">Loading staff data…</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (isError) {
    return (
      <AppLayout>
        <div className="p-8 flex items-center justify-center min-h-[50vh]" data-testid="staff-error">
          <div className="flex flex-col items-center gap-3 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="font-medium">Failed to load staff data</p>
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
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-bold tracking-tight font-heading text-foreground">Staff & Assignments</h2>
            <p className="text-muted-foreground mt-1">
              Directory of all providers, nurses, and support staff.
            </p>
          </div>
          
          <div className="flex gap-2">
            <Dialog open={isCoverageOpen} onOpenChange={setIsCoverageOpen}>
              <DialogTrigger asChild>
                <Button variant="secondary">
                  <Stethoscope className="w-4 h-4 mr-2" />
                  Find Coverage
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Find Sick Call Coverage</DialogTitle>
                  <DialogDescription>
                    Locate staff capable of covering a specific specialty.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label>Specialty Needed</Label>
                    <Select value={coverageSpecialty} onValueChange={(v) => setCoverageSpecialty(v as Specialty)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select specialty..." />
                      </SelectTrigger>
                      <SelectContent>
                        {SPECIALTIES.map(spec => (
                          <SelectItem key={spec} value={spec}>{spec}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {coverageSpecialty && (
                    <div className="grid gap-2">
                      <Label>Available Staff ({getCoverageStaff().length})</Label>
                      <ScrollArea className="h-[300px] border rounded-md p-4 bg-muted/10">
                        {getCoverageStaff().length === 0 ? (
                          <div className="text-sm text-muted-foreground text-center py-8">
                            No staff found with training in {coverageSpecialty}
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {getCoverageStaff().map(s => (
                              <div key={s.id} className="flex items-center justify-between bg-card p-3 rounded-md border shadow-sm">
                                <div>
                                  <div className="font-medium text-sm">{s.name}</div>
                                  <div className="text-xs text-muted-foreground flex gap-2 items-center flex-wrap">
                                    <Badge variant="outline" className="text-[10px] h-4 px-1">{s.role}</Badge>
                                    {s.specialty === coverageSpecialty ? (
                                      <span className="text-green-600 font-medium">Primary Specialty</span>
                                    ) : (
                                      <span className="text-blue-600">Cross-Trained</span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    {s.phone && (
                                      <a href={`tel:${s.phone}`} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                                        <Phone className="w-3 h-3" />{s.phone}
                                      </a>
                                    )}
                                    {s.email && (
                                      <a href={`mailto:${s.email}`} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                                        <Mail className="w-3 h-3" />{s.email}
                                      </a>
                                    )}
                                    {!s.phone && !s.email && (
                                      <span className="text-xs text-muted-foreground italic">No contact info</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </ScrollArea>
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="w-4 h-4 mr-2" />
                Add Staff
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Staff Member</DialogTitle>
                <DialogDescription>
                  Create a new provider or nurse profile.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="new-name">Name</Label>
                  <Input 
                    id="new-name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Nurse Jane Doe"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="new-role">Role</Label>
                  <Select value={newRole} onValueChange={(v: StaffType) => setNewRole(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MD">MD</SelectItem>
                      <SelectItem value="DO">DO</SelectItem>
                      <SelectItem value="NP">NP</SelectItem>
                      <SelectItem value="PA">PA</SelectItem>
                      <SelectItem value="LVN">LVN</SelectItem>
                      <SelectItem value="RN">RN</SelectItem>
                      <SelectItem value="Pharmacist">Pharmacist / Pharm D</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="new-specialty">Specialty</Label>
                  <Select value={newSpecialty} onValueChange={(v: Specialty) => setNewSpecialty(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select specialty" />
                    </SelectTrigger>
                    <SelectContent>
                      {SPECIALTIES.map(spec => (
                        <SelectItem key={spec} value={spec}>{spec}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {(newRole === 'LVN' || newRole === 'RN') && (
                  <div className="grid gap-2">
                    <Label>Employment Type</Label>
                    <div className="flex flex-wrap gap-2">
                      {EMPLOYMENT_TYPES.map(et => (
                        <button
                          key={et}
                          type="button"
                          onClick={() => setNewEmploymentType(et)}
                          className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-all ${
                            newEmploymentType === et
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-border text-muted-foreground hover:border-foreground/40"
                          }`}
                          data-testid={`new-employment-type-${et.replace(/ /g, "-")}`}
                        >
                          {et}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                <Button onClick={handleAddStaff}>Create Staff</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        <div className="flex items-center gap-4 mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search staff by name or role..." 
              className="pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {filteredStaff.map((staffMember) => (
            <Card key={staffMember.id} className="overflow-hidden hover:shadow-md transition-shadow group">
              <CardHeader className="border-b border-border/50 bg-muted/20 pb-4">
                <div className="flex justify-between items-start gap-2">
                  <div className="flex-1">
                    <CardTitle className="text-lg font-medium flex items-center gap-2 flex-wrap">
                      {staffMember.name}
                      {staffMember.isFloatPool && (
                        <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-800 border-amber-300">
                          <Star className="h-3 w-3 mr-1" />Float Pool
                        </Badge>
                      )}
                      {staffMember.role === 'RN' && staffMember.defaultChargePositionId && (() => {
                        const pos = RN_POSITIONS.find(p => p.id === staffMember.defaultChargePositionId);
                        return pos ? (
                          <Badge variant="secondary" className="text-xs bg-emerald-100 text-emerald-800 border-emerald-300"
                            data-testid={`badge-default-charge-${staffMember.id}`}>
                            Default · {pos.label}
                          </Badge>
                        ) : null;
                      })()}
                    </CardTitle>
                    <div className="text-sm text-muted-foreground mt-1 flex items-center flex-wrap gap-2">
                      <Badge variant="outline" className="bg-background">{staffMember.role}</Badge>
                      <span>{staffMember.specialty}</span>
                      {(staffMember.role === 'LVN' || staffMember.role === 'RN') && staffMember.employmentType && staffMember.employmentType !== 'Full-time' && (
                        <Badge variant="outline" className={
                          staffMember.employmentType === 'Part-time' ? "text-xs bg-blue-50 text-blue-700 border-blue-200" :
                          staffMember.employmentType === 'Per Diem' ? "text-xs bg-amber-50 text-amber-700 border-amber-200" :
                          "text-xs bg-orange-50 text-orange-700 border-orange-200"
                        }>
                          {staffMember.employmentType}
                        </Badge>
                      )}
                    </div>
                    {(staffMember.phone || staffMember.email) && (
                      <div className="flex items-center flex-wrap gap-3 mt-1.5">
                        {staffMember.phone && (
                          <a
                            href={`tel:${staffMember.phone}`}
                            className="flex items-center gap-1 text-xs text-blue-600 hover:underline hover:text-blue-800"
                            data-testid={`link-phone-${staffMember.id}`}
                          >
                            <Phone className="w-3 h-3" />{staffMember.phone}
                          </a>
                        )}
                        {staffMember.email && (
                          <a
                            href={`mailto:${staffMember.email}`}
                            className="flex items-center gap-1 text-xs text-blue-600 hover:underline hover:text-blue-800"
                            data-testid={`link-email-${staffMember.id}`}
                          >
                            <Mail className="w-3 h-3" />{staffMember.email}
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => setLookupStaffId(staffMember.id)}
                          data-testid={`button-lookup-${staffMember.id}`}
                        >
                          <CalendarDays className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>View schedule</TooltipContent>
                    </Tooltip>
                    {(staffMember.role === 'LVN' || staffMember.role === 'RN') && isAdmin && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={`h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity ${staffMember.isFloatPool ? "text-amber-500 opacity-100" : ""}`}
                            onClick={() => updateStaffMember({ ...staffMember, isFloatPool: !staffMember.isFloatPool })}
                            data-testid={`button-float-pool-${staffMember.id}`}
                          >
                            <Star className={`h-4 w-4 ${staffMember.isFloatPool ? "fill-amber-400" : ""}`} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {staffMember.isFloatPool ? "Remove from float pool" : "Mark as float pool (extra help)"}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  <Dialog open={editingId === staffMember.id} onOpenChange={(open) => !open && setEditingId(null)}>
                    <DialogTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handleEditOpen(staffMember)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-md">
                      <DialogHeader>
                        <DialogTitle>Edit Staff</DialogTitle>
                        <DialogDescription>
                          Update details for {staffMember.name}
                        </DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-6 py-4">
                        <div className="grid gap-2">
                          <Label htmlFor="name">Name</Label>
                          <Input 
                            id="name"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder="Enter name..."
                            data-testid="input-edit-name"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="grid gap-2">
                            <Label htmlFor="edit-phone">Phone</Label>
                            <Input
                              id="edit-phone"
                              type="tel"
                              value={editPhone}
                              onChange={(e) => setEditPhone(e.target.value)}
                              placeholder="(555) 555-5555"
                              data-testid="input-edit-phone"
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor="edit-email">Email</Label>
                            <Input
                              id="edit-email"
                              type="email"
                              value={editEmail}
                              onChange={(e) => setEditEmail(e.target.value)}
                              placeholder="name@example.com"
                              data-testid="input-edit-email"
                            />
                          </div>
                        </div>

                        <div className="grid gap-2">
                           <Label>Specialty</Label>
                           <Select value={editSpecialty} onValueChange={(v: Specialty) => setEditSpecialty(v)}>
                             <SelectTrigger>
                               <SelectValue placeholder="Select specialty" />
                             </SelectTrigger>
                             <SelectContent>
                               {SPECIALTIES.map(spec => (
                                 <SelectItem key={spec} value={spec}>{spec}</SelectItem>
                               ))}
                             </SelectContent>
                           </Select>
                        </div>

                        {/* Employment Type (nurses only) */}
                        {(staffMember.role === 'LVN' || staffMember.role === 'RN') && (
                          <div className="grid gap-2">
                            <Label className="flex items-center gap-1.5">
                              Employment Type
                              <Badge variant="outline" className="text-[10px] h-4 px-1 bg-violet-50 text-violet-700 border-violet-200 gap-0.5 font-normal">
                                <ShieldCheck className="w-2.5 h-2.5" />Admin
                              </Badge>
                            </Label>
                            <div className="flex flex-wrap gap-2">
                              {EMPLOYMENT_TYPES.map(et => (
                                <button
                                  key={et}
                                  type="button"
                                  onClick={() => setEditEmploymentType(et)}
                                  className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-all ${
                                    editEmploymentType === et
                                      ? "bg-primary text-primary-foreground border-primary"
                                      : "border-border text-muted-foreground hover:border-foreground/40"
                                  }`}
                                  data-testid={`employment-type-btn-${et.replace(/ /g, "-")}`}
                                >
                                  {et}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Default Charge Position — RN only, admin only */}
                        {staffMember.role === 'RN' && isAdmin && (
                          <div className="grid gap-2">
                            <Label className="flex items-center gap-1.5">
                              Default Charge Position
                              <Badge variant="outline" className="text-[10px] h-4 px-1 bg-violet-50 text-violet-700 border-violet-200 gap-0.5 font-normal">
                                <ShieldCheck className="w-2.5 h-2.5" />Admin
                              </Badge>
                            </Label>
                            <p className="text-xs text-muted-foreground">
                              Designates this RN as the permanent/default charge nurse for a unit. Only one RN should be set per position.
                            </p>
                            <Select
                              value={editDefaultChargePositionId ?? "__none__"}
                              onValueChange={v => setEditDefaultChargePositionId(v === "__none__" ? null : v)}
                            >
                              <SelectTrigger data-testid="select-default-charge-position">
                                <SelectValue placeholder="None — not a default charge RN" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">None — not a default charge RN</SelectItem>
                                {RN_POSITIONS.map(pos => {
                                  const currentHolder = staff.find(s => s.role === 'RN' && s.defaultChargePositionId === pos.id && s.id !== staffMember.id);
                                  return (
                                    <SelectItem key={pos.id} value={pos.id}>
                                      {pos.label}{currentHolder ? ` (currently: ${currentHolder.name})` : ''}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {/* LVN/RN Edit View */}
                        {(staffMember.role === 'LVN' || staffMember.role === 'RN') && isAdmin && (
                          <>
                            {staffMember.role === 'LVN' && (
                              <div className="grid gap-2">
                                <Label className="flex items-center gap-1.5">
                                  Assigned Providers
                                  <Badge variant="outline" className="text-[10px] h-4 px-1 bg-violet-50 text-violet-700 border-violet-200 gap-0.5 font-normal">
                                    <ShieldCheck className="w-2.5 h-2.5" />Admin
                                  </Badge>
                                </Label>
                                <ScrollArea className="h-[150px] border rounded-md p-4">
                                  <div className="space-y-4">
                                    {allProviders.map(provider => (
                                      <div key={provider.id} className="flex items-center space-x-2">
                                        <Checkbox 
                                          id={`assign-${provider.id}`} 
                                          checked={editAssignedTo.includes(provider.id)}
                                          onCheckedChange={() => toggleAssignedProvider(provider.id)}
                                          data-testid={`checkbox-assign-${provider.id}`}
                                        />
                                        <div className="grid gap-1.5 leading-none">
                                          <label
                                            htmlFor={`assign-${provider.id}`}
                                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                          >
                                            {provider.name}
                                          </label>
                                          <p className="text-xs text-muted-foreground">
                                            {provider.specialty}
                                          </p>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </ScrollArea>
                                {editAssignedTo.length > 1 && (
                                  <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800"
                                    data-testid="warn-multiple-providers">
                                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
                                    <span>
                                      <span className="font-semibold">Multi-provider assignment:</span> This LVN is on {editAssignedTo.length} providers' permanent panels. If both providers are in Patient Care on the same day, the schedule validator will flag this as a double-booking. Only assign an LVN to multiple providers if their shifts don't overlap (e.g. AM-only and PM-only).
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}

                            <div className="grid gap-2">
                              <Label className="flex items-center gap-1.5">
                                Cross-Trained Areas
                                <Badge variant="outline" className="text-[10px] h-4 px-1 bg-violet-50 text-violet-700 border-violet-200 gap-0.5 font-normal">
                                  <ShieldCheck className="w-2.5 h-2.5" />Admin
                                </Badge>
                              </Label>
                              <ScrollArea className="h-[200px] border rounded-md p-3">
                                <div className="space-y-3">
                                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Provider Specialties</p>
                                  {PROVIDER_SPECIALTIES.filter(s => s !== staffMember.specialty).map(spec => (
                                    <div key={spec} className="flex items-center space-x-2">
                                      <Checkbox
                                        id={`cross-${spec}`}
                                        checked={editCrossTrained.includes(spec)}
                                        onCheckedChange={() => toggleCrossTrained(spec)}
                                        data-testid={`checkbox-cross-${spec}`}
                                      />
                                      <label
                                        htmlFor={`cross-${spec}`}
                                        className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                      >
                                        {spec}
                                      </label>
                                    </div>
                                  ))}
                                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">Clinic Areas</p>
                                  {CLINIC_AREAS.map(area => (
                                    <div key={area} className="flex items-center space-x-2">
                                      <Checkbox
                                        id={`cross-${area}`}
                                        checked={editCrossTrained.includes(area)}
                                        onCheckedChange={() => toggleCrossTrained(area)}
                                        data-testid={`checkbox-cross-${area}`}
                                      />
                                      <label
                                        htmlFor={`cross-${area}`}
                                        className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                      >
                                        {area}
                                      </label>
                                    </div>
                                  ))}
                                </div>
                              </ScrollArea>
                            </div>
                          </>
                        )}

                        {/* Non-admin notice when editing LVN/RN */}
                        {(staffMember.role === 'LVN' || staffMember.role === 'RN') && !isAdmin && (
                          <div className="flex items-start gap-2 rounded-md border border-violet-200 bg-violet-50 p-3 text-sm text-violet-800">
                            <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
                            <span>Provider assignments, cross-training areas, float pool designation, and default charge position are managed by an administrator.</span>
                          </div>
                        )}

                        {/* Provider Edit View: LVNs Required + Assigned LVNs — admin only */}
                        {['MD', 'DO', 'NP', 'PA'].includes(staffMember.role) && isAdmin && (
                          <>
                            <div className="grid gap-2">
                              <Label className="flex items-center gap-1.5">
                                LVNs Required
                                <Badge variant="outline" className="text-[10px] h-4 px-1 bg-violet-50 text-violet-700 border-violet-200 gap-0.5 font-normal">
                                  <ShieldCheck className="w-2.5 h-2.5" />Admin
                                </Badge>
                              </Label>
                              <p className="text-xs text-muted-foreground">How many LVNs this provider needs. (Use 2 for OB/GYN MDs; Diabetic Education shares 1 LVN across both providers.)</p>
                              <Select
                                value={String(editLvnsRequired)}
                                onValueChange={v => setEditLvnsRequired(Number(v))}
                              >
                                <SelectTrigger data-testid="select-lvns-required">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="1">1 LVN</SelectItem>
                                  <SelectItem value="2">2 LVNs</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="grid gap-2">
                              <Label className="flex items-center gap-1.5">
                                Assigned LVNs
                                <Badge variant="outline" className="text-[10px] h-4 px-1 bg-violet-50 text-violet-700 border-violet-200 gap-0.5 font-normal">
                                  <ShieldCheck className="w-2.5 h-2.5" />Admin
                                </Badge>
                              </Label>
                              <ScrollArea className="h-[200px] border rounded-md p-4">
                                <div className="space-y-4">
                                  {allLvns.map(lvn => (
                                    <div key={lvn.id} className="flex items-center space-x-2">
                                      <Checkbox 
                                        id={`lvn-${lvn.id}`} 
                                        checked={editProviderAssignedLvns.includes(lvn.id)}
                                        onCheckedChange={() => toggleProviderLvn(lvn.id)}
                                      />
                                      <div className="grid gap-1.5 leading-none">
                                        <label
                                          htmlFor={`lvn-${lvn.id}`}
                                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                        >
                                          {lvn.name}
                                        </label>
                                        <p className="text-xs text-muted-foreground">
                                          {lvn.specialty}
                                        </p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </ScrollArea>
                            </div>
                          </>
                        )}

                        {/* Non-admin notice when editing a provider */}
                        {['MD', 'DO', 'NP', 'PA'].includes(staffMember.role) && !isAdmin && (
                          <div className="flex items-start gap-2 rounded-md border border-violet-200 bg-violet-50 p-3 text-sm text-violet-800">
                            <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
                            <span>LVN assignments, staffing requirements, and structural configurations are managed by an administrator.</span>
                          </div>
                        )}

                      </div>
                      <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                        {isAdmin && !confirmDeactivate && (
                          <Button
                            variant="outline"
                            className="text-destructive border-destructive/40 hover:bg-destructive/10"
                            onClick={() => setConfirmDeactivate(true)}
                            data-testid="button-deactivate-staff"
                          >
                            <UserMinus className="w-4 h-4 mr-2" />
                            No Longer Working
                          </Button>
                        )}
                        {isAdmin && confirmDeactivate && (
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-destructive font-medium">Remove from active staff?</span>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleDeactivateStaff(staffMember.id)}
                              data-testid="button-confirm-deactivate"
                            >
                              Yes, remove
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setConfirmDeactivate(false)}>
                              Cancel
                            </Button>
                          </div>
                        )}
                        {!isAdmin && <div />}
                        <div className="flex gap-2">
                          <Button variant="outline" onClick={handleCloseEditDialog}>Cancel</Button>
                          <Button onClick={handleSave}>Save Changes</Button>
                        </div>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4 space-y-3">
                {staffMember.role === 'LVN' && (
                  <div className="space-y-1">
                      <div className="flex items-center justify-between">
                         <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Assigned To</div>
                         {(staffMember.specialty === 'Internal/Family Med (Met Home 1)' || staffMember.specialty === 'Internal/Family Med (Met Home 2)') && (
                           <TooltipProvider>
                             <Tooltip>
                               <TooltipTrigger>
                                 <Badge variant="outline" className="text-[10px] px-1 py-0 h-5 bg-blue-50 text-blue-700 border-blue-200 gap-1">
                                   <Lock className="w-3 h-3" /> Quarterly Pair
                                 </Badge>
                               </TooltipTrigger>
                               <TooltipContent>
                                 <p>Stable 1:1 pairing. Changes only for sick/vacation.</p>
                               </TooltipContent>
                             </Tooltip>
                           </TooltipProvider>
                         )}
                      </div>
                      <div className="text-sm font-medium line-clamp-2" title={getAssignedProviderNames(staffMember.assignedTo ?? undefined)}>
                         {getAssignedProviderNames(staffMember.assignedTo ?? undefined)}
                      </div>
                  </div>
                )}
                
                {(staffMember.role === 'LVN' || staffMember.role === 'RN') && staffMember.crossTrained && staffMember.crossTrained.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Cross Trained</div>
                    <div className="flex flex-wrap gap-1">
                      {staffMember.crossTrained.map(spec => (
                        <Badge key={spec} variant="secondary" className="text-xs font-normal">
                          {spec}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {(staffMember.role === 'MD' || staffMember.role === 'DO' || staffMember.role === 'NP') && (
                   <div className="flex items-center justify-between text-sm pt-2">
                      <span className="text-muted-foreground">Weekly Hours</span>
                      <span className="font-medium">32.0</span>
                   </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Former Staff section — admin only */}
        {isAdmin && (
          <div className="border rounded-lg overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-5 py-3 bg-muted/50 hover:bg-muted text-sm font-medium text-muted-foreground transition-colors"
              onClick={() => setShowFormerStaff(v => !v)}
              data-testid="button-toggle-former-staff"
            >
              <span className="flex items-center gap-2">
                <UserMinus className="w-4 h-4" />
                Former Staff
                {inactiveStaff.length > 0 && (
                  <Badge variant="secondary" className="text-xs h-5">
                    {inactiveStaff.length}
                  </Badge>
                )}
              </span>
              {showFormerStaff ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>

            {showFormerStaff && (
              <div className="p-4">
                {inactiveStaff.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No former staff members.</p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {inactiveStaff.map(member => (
                      <div
                        key={member.id}
                        className="flex items-center justify-between p-3 rounded-md border bg-muted/30 opacity-70"
                        data-testid={`card-former-staff-${member.id}`}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{member.name}</p>
                          <p className="text-xs text-muted-foreground">{member.role} · {member.specialty}</p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-2 shrink-0 text-green-700 border-green-300 hover:bg-green-50"
                          onClick={() => reactivateStaffMember(member.id)}
                          data-testid={`button-reactivate-${member.id}`}
                        >
                          <UserCheck className="w-3.5 h-3.5 mr-1" />
                          Reactivate
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <StaffLookupModal
        staffId={lookupStaffId}
        onClose={() => setLookupStaffId(null)}
      />
    </AppLayout>
  );
}
