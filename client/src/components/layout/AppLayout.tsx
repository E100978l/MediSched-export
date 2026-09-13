import { Link, useLocation } from "wouter";
import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  RefreshCw,
  Activity,
  CalendarOff,
  Stethoscope,
  BarChart3,
  LogOut,
  ShieldCheck,
  User as UserIcon,
  Building2,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useStaff } from "@/lib/store";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";

const NAV_ITEMS = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/" },
  { label: "Schedule", icon: CalendarDays, href: "/schedule" },
  { label: "Staff & Assignments", icon: Users, href: "/staff" },
  { label: "Availability", icon: CalendarOff, href: "/availability" },
  { label: "Rotations & Coverage", icon: RefreshCw, href: "/rotations" },
  { label: "Special Clinics", icon: Stethoscope, href: "/clinics" },
  { label: "Reports & Export", icon: BarChart3, href: "/reports" },
];

const THREE_SHIFT_NAV = { label: "3-Shift Facility", icon: Building2, href: "/three-shift" };

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { staff } = useStaff();
  const { user, logout } = useAuth();

  // Read 3-Shift Facility access mode so non-admins see a lock badge when it's restricted
  const [tsfAccessMode, setTsfAccessMode] = useState(() => localStorage.getItem("3sf_access_mode") ?? "locked");
  useEffect(() => {
    const onStorage = () => setTsfAccessMode(localStorage.getItem("3sf_access_mode") ?? "locked");
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const tsfLocked = user?.role !== "admin" && tsfAccessMode !== "trial" && tsfAccessMode !== "full";

  const providerCount = staff.filter(s => ['MD', 'DO', 'NP', 'PA'].includes(s.role)).length;
  const lvnCount = staff.filter(s => s.role === 'LVN' && !s.isFloatPool).length;
  const rnCount = staff.filter(s => s.role === 'RN' && !s.isFloatPool).length;
  const floatCount = staff.filter(s => s.isFloatPool).length;

  const handleLogout = async () => {
    await logout();
    toast({ title: "Signed out" });
  };

  const ADMIN_NAV_ITEMS = [
    { label: "User Management", icon: ShieldCheck, href: "/users", adminOnly: true },
  ];

  const navItems = user?.role === "admin"
    ? [...NAV_ITEMS.map(i => ({ ...i, adminOnly: false })), ...ADMIN_NAV_ITEMS]
    : NAV_ITEMS.map(i => ({ ...i, adminOnly: false }));

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card flex flex-col">
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center">
              <Activity className="h-5 w-5 text-primary-foreground" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-foreground font-heading">
              MediSched
            </h1>
          </div>
          <p className="text-xs text-muted-foreground mt-2 font-medium">
            Ambulatory Care Center
          </p>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <div
                  data-testid={`nav-${item.href.replace("/", "") || "home"}`}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors cursor-pointer",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : item.adminOnly
                        ? "text-violet-600 hover:bg-violet-50 hover:text-violet-700"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  <span className="flex-1">{item.label}</span>
                  {item.adminOnly && (
                    <Badge variant="outline" className="text-[9px] h-4 px-1 bg-violet-50 text-violet-600 border-violet-200 font-normal">
                      Admin
                    </Badge>
                  )}
                </div>
              </Link>
            );
          })}

          {/* 3-Shift Facility divider + button */}
          <div className="pt-2 pb-1">
            <div className="h-px bg-border" />
            <p className="text-[10px] font-medium text-muted-foreground px-3 pt-2 uppercase tracking-wider">Inpatient</p>
          </div>
          <Link href={THREE_SHIFT_NAV.href}>
            <div
              data-testid="nav-three-shift"
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors cursor-pointer",
                location === THREE_SHIFT_NAV.href
                  ? "bg-violet-500/10 text-violet-700"
                  : "text-muted-foreground hover:bg-violet-50 hover:text-violet-700"
              )}
            >
              <THREE_SHIFT_NAV.icon className="h-4 w-4" />
              <span className="flex-1">{THREE_SHIFT_NAV.label}</span>
              {tsfLocked ? (
                <Lock className="h-3 w-3 text-muted-foreground/60" title="Access restricted — contact an admin" />
              ) : (
                <span className="text-[9px] font-semibold text-violet-600 bg-violet-100 border border-violet-200 rounded px-1.5 py-0.5">
                  NEW
                </span>
              )}
            </div>
          </Link>
        </nav>

        <div className="p-4 border-t border-border space-y-3">
          {/* Current user info */}
          {user && (
            <div className="px-3 py-2 rounded-md bg-secondary/50 flex items-center gap-2">
              <div className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                {user.role === "admin"
                  ? <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                  : <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground truncate">{user.name}</p>
                <div className="flex items-center gap-1 mt-0.5">
                  <Badge variant={user.role === "admin" ? "default" : "secondary"} className="text-[10px] h-4">
                    {user.role === "admin" ? "Admin" : "Staff"}
                  </Badge>
                  {user.role !== "admin" && (
                    <span className="text-[9px] text-muted-foreground">Data access</span>
                  )}
                  {user.role === "admin" && (
                    <span className="text-[9px] text-muted-foreground">Full access</span>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground flex-shrink-0"
                data-testid="button-logout"
                onClick={handleLogout}
                title="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {/* Staff status */}
          <div className="px-3">
            <div className="bg-secondary/50 rounded-lg p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground mb-1">Status</p>
              <p>Providers: {providerCount}</p>
              <p>LVNs: {lvnCount}</p>
              <p>RNs: {rnCount}</p>
              {floatCount > 0 && <p className="text-amber-600">Float Pool: {floatCount}</p>}
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
