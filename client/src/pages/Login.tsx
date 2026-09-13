import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";

type ResetStep = "email" | "code";

export default function Login() {
  const { login } = useAuth();
  const [setupNeeded, setSetupNeeded] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"login" | "setup">("login");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  // Forgot password modal state
  const [showReset, setShowReset] = useState(false);
  const [resetStep, setResetStep] = useState<ResetStep>("email");
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetNewPw, setResetNewPw] = useState("");
  const [resetConfirmPw, setResetConfirmPw] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/setup-needed")
      .then(r => r.json())
      .then(d => {
        setSetupNeeded(d.setupNeeded);
        if (d.setupNeeded) setMode("setup");
      });
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      toast({ title: "Login failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role: "admin" }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Registration failed");
      }
      await login(email, password);
      toast({ title: "Admin account created", description: "Welcome to MediSched!" });
    } catch (err: any) {
      toast({ title: "Setup failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const openResetModal = () => {
    setResetStep("email");
    setResetEmail("");
    setResetCode("");
    setResetNewPw("");
    setResetConfirmPw("");
    setShowReset(true);
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail) return;
    setResetLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to send code");
      toast({ title: "Code sent", description: "Check your email for the 6-character code." });
      setResetStep("code");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setResetLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resetNewPw !== resetConfirmPw) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    if (resetNewPw.length < 6) {
      toast({ title: "Password too short", description: "Minimum 6 characters.", variant: "destructive" });
      return;
    }
    setResetLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail, code: resetCode, newPassword: resetNewPw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Reset failed");
      toast({ title: "Password updated", description: "You can now sign in with your new password." });
      setShowReset(false);
    } catch (err: any) {
      toast({ title: "Reset failed", description: err.message, variant: "destructive" });
    } finally {
      setResetLoading(false);
    }
  };

  if (setupNeeded === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="h-12 w-12 bg-primary rounded-xl flex items-center justify-center shadow-lg">
            <Activity className="h-7 w-7 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">MediSched</h1>
            <p className="text-sm text-muted-foreground">Ambulatory Care Center</p>
          </div>
        </div>

        <Card className="shadow-xl border-0">
          <CardHeader className="pb-4">
            <CardTitle>
              {mode === "setup" ? "Create Admin Account" : "Sign In"}
            </CardTitle>
            <CardDescription>
              {mode === "setup"
                ? "Set up your administrator account to get started."
                : "Enter your credentials to access the scheduling system."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {mode === "setup" ? (
              <form onSubmit={handleSetup} className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="setup-name">Full Name</Label>
                  <Input
                    id="setup-name"
                    data-testid="input-name"
                    placeholder="Jane Smith"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="setup-email">Email</Label>
                  <Input
                    id="setup-email"
                    data-testid="input-email"
                    type="email"
                    placeholder="admin@clinic.org"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="setup-password">Password</Label>
                  <Input
                    id="setup-password"
                    data-testid="input-password"
                    type="password"
                    placeholder="Minimum 6 characters"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="setup-confirm">Confirm Password</Label>
                  <Input
                    id="setup-confirm"
                    data-testid="input-confirm"
                    type="password"
                    placeholder="Repeat password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    required
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  data-testid="button-setup"
                  disabled={loading}
                >
                  {loading ? "Creating account…" : "Create Admin Account"}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    data-testid="input-email"
                    type="email"
                    placeholder="you@clinic.org"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="login-password">Password</Label>
                    <button
                      type="button"
                      data-testid="link-forgot-password"
                      className="text-xs text-primary hover:underline"
                      onClick={openResetModal}
                    >
                      Forgot Password?
                    </button>
                  </div>
                  <Input
                    id="login-password"
                    data-testid="input-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  data-testid="button-login"
                  disabled={loading}
                >
                  {loading ? "Signing in…" : "Sign In"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        {!setupNeeded && (
          <p className="text-center text-xs text-muted-foreground mt-4">
            Need an account? Ask your administrator.
          </p>
        )}
      </div>

      {/* ── Forgot Password Modal ─────────────────────────────────── */}
      <Dialog open={showReset} onOpenChange={open => { if (!open) setShowReset(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              {resetStep === "email"
                ? "Enter your account email and we'll send a 6-character reset code."
                : `Enter the code sent to ${resetEmail} and choose a new password.`}
            </DialogDescription>
          </DialogHeader>

          {resetStep === "email" ? (
            <form onSubmit={handleSendCode} className="space-y-4 pt-1">
              <div className="space-y-1">
                <Label htmlFor="reset-email">Email address</Label>
                <Input
                  id="reset-email"
                  data-testid="input-reset-email"
                  type="email"
                  placeholder="you@clinic.org"
                  value={resetEmail}
                  onChange={e => setResetEmail(e.target.value)}
                  required
                />
              </div>
              <DialogFooter className="gap-2">
                <Button type="button" variant="ghost" onClick={() => setShowReset(false)}>Cancel</Button>
                <Button type="submit" data-testid="button-send-code" disabled={resetLoading}>
                  {resetLoading ? "Sending…" : "Send Code"}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <form onSubmit={handleResetPassword} className="space-y-4 pt-1">
              <div className="space-y-1">
                <Label htmlFor="reset-code">6-Character Code</Label>
                <Input
                  id="reset-code"
                  data-testid="input-reset-code"
                  placeholder="e.g. A3K9BZ"
                  value={resetCode}
                  onChange={e => setResetCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  required
                  className="font-mono tracking-widest text-center text-lg"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="reset-new-pw">New Password</Label>
                <Input
                  id="reset-new-pw"
                  data-testid="input-reset-new-password"
                  type="password"
                  placeholder="Minimum 6 characters"
                  value={resetNewPw}
                  onChange={e => setResetNewPw(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="reset-confirm-pw">Confirm New Password</Label>
                <Input
                  id="reset-confirm-pw"
                  data-testid="input-reset-confirm-password"
                  type="password"
                  placeholder="Repeat new password"
                  value={resetConfirmPw}
                  onChange={e => setResetConfirmPw(e.target.value)}
                  required
                />
              </div>
              <DialogFooter className="gap-2 flex-wrap">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setResetStep("email")}
                >
                  ← Back
                </Button>
                <Button type="submit" data-testid="button-reset-password" disabled={resetLoading}>
                  {resetLoading ? "Updating…" : "Set New Password"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
