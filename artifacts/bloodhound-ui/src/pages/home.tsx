import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useGetHuntStats,
  useListHunts,
  useCreateHunt,
  useGetDonationStatus,
  useListSponsors,
  getListHuntsQueryKey,
  getGetHuntStatsQueryKey,
  getGetDonationStatusQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ShieldAlert, Crosshair, Radar, Terminal, Activity, Bug, Download, Zap, Brain, Cpu, Crown, Clock } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HuntMode } from "@workspace/api-client-react";
import { DonationModal } from "@/components/donation-modal";

const MODELS = [
  {
    id: "anthropic/claude-haiku-4.5",
    label: "Haiku 4.5",
    desc: "Fast & cheap — quick triage",
    icon: Zap,
    color: "text-[hsl(var(--severity-gas))]",
  },
  {
    id: "anthropic/claude-sonnet-4",
    label: "Sonnet 4",
    desc: "Balanced — recommended",
    icon: Cpu,
    color: "text-primary",
  },
  {
    id: "anthropic/claude-opus-4",
    label: "Opus 4",
    desc: "Deepest analysis — high-value targets",
    icon: Brain,
    color: "text-[hsl(var(--severity-high))]",
  },
] as const;

type ModelId = typeof MODELS[number]["id"];

export function Dashboard() {
  const [repoUrl, setRepoUrl] = useState("");
  const [mode, setMode] = useState<typeof HuntMode[keyof typeof HuntMode]>(HuntMode.code4rena);
  const [model, setModel] = useState<ModelId>("anthropic/claude-sonnet-4");
  const [donationModalOpen, setDonationModalOpen] = useState(false);
  const [isFreeLimit, setIsFreeLimit] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: stats, isLoading: statsLoading } = useGetHuntStats();
  const { data: hunts, isLoading: huntsLoading } = useListHunts();
  const { data: donationStatus } = useGetDonationStatus();
  const { data: sponsors } = useListSponsors();

  const createHunt = useCreateHunt();

  const handleStartHunt = (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl) return;

    createHunt.mutate(
      { data: { repoUrl, mode, model } },
      {
        onSuccess: (hunt) => {
          toast({
            title: "Hunt initialized",
            description: `Target acquired: ${repoUrl}`,
          });
          queryClient.invalidateQueries({ queryKey: getListHuntsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetHuntStatsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDonationStatusQueryKey() });
          setLocation(`/hunts/${hunt.id}`);
        },
        onError: (err: any) => {
          const data = err?.response?.data;
          if (data?.donationRequired) {
            setIsFreeLimit(data.error?.includes("Free tier") ?? false);
            setDonationModalOpen(true);
            return;
          }
          toast({
            title: "Initialization failed",
            description: err.message || "Failed to start hunt",
            variant: "destructive",
          });
        },
      }
    );
  };

  const tierBadge = () => {
    if (!donationStatus) return null;
    const { tier, huntsRemaining, expiresAt } = donationStatus;
    if (tier === "free") {
      return (
        <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground gap-1">
          <Clock className="h-3 w-3" />
          FREE · 1/day
        </Badge>
      );
    }
    if (tier === "lifetime") {
      return (
        <Badge className="font-mono text-[10px] bg-[hsl(var(--severity-high))]/20 text-[hsl(var(--severity-high))] border-[hsl(var(--severity-high))]/40 gap-1">
          <Crown className="h-3 w-3" />
          SPONSOR · ∞
        </Badge>
      );
    }
    const daysLeft = expiresAt ? Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000) : null;
    return (
      <Badge className="font-mono text-[10px] bg-primary/10 text-primary border-primary/30 gap-1">
        <Zap className="h-3 w-3" />
        {huntsRemaining ?? 0} hunts · {daysLeft}d left
      </Badge>
    );
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <DonationModal
        open={donationModalOpen}
        onClose={() => setDonationModalOpen(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: getGetDonationStatusQueryKey() });
        }}
        isFreeLimit={isFreeLimit}
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight font-mono flex items-center gap-2">
            <Terminal className="h-6 w-6" />
            COMMAND_CENTER
          </h1>
          <div className="flex items-center gap-2">
            {tierBadge()}
            {donationStatus?.tier === "free" && (
              <Button
                variant="outline"
                size="sm"
                className="font-mono text-[10px] uppercase h-7 border-[hsl(var(--severity-high))]/40 text-[hsl(var(--severity-high))] hover:bg-[hsl(var(--severity-high))]/10"
                onClick={() => { setIsFreeLimit(false); setDonationModalOpen(true); }}
              >
                <Crown className="h-3 w-3 mr-1" />
                Unlock
              </Button>
            )}
          </div>
        </div>
        <p className="text-muted-foreground font-mono text-sm">
          Threat intelligence dashboard. Monitoring smart contract vulnerabilities.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium font-mono">Total_Targets</CardTitle>
            <Crosshair className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{statsLoading ? "-" : stats?.totalHunts || 0}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium font-mono">Vulnerabilities</CardTitle>
            <Bug className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{statsLoading ? "-" : stats?.totalFindings || 0}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-destructive/20 relative overflow-hidden group">
          <div className="absolute inset-0 bg-destructive/5 opacity-0 group-hover:opacity-100 transition-opacity" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
            <CardTitle className="text-sm font-medium font-mono text-destructive">Critical_Threats</CardTitle>
            <ShieldAlert className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent className="relative z-10">
            <div className="text-2xl font-bold font-mono text-destructive">{statsLoading ? "-" : stats?.criticalFindings || 0}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-[hsl(var(--severity-high))]/20 relative overflow-hidden group">
          <div className="absolute inset-0 bg-[hsl(var(--severity-high))]/5 opacity-0 group-hover:opacity-100 transition-opacity" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
            <CardTitle className="text-sm font-medium font-mono text-[hsl(var(--severity-high))]">High_Severity</CardTitle>
            <Activity className="h-4 w-4 text-[hsl(var(--severity-high))]" />
          </CardHeader>
          <CardContent className="relative z-10">
            <div className="text-2xl font-bold font-mono text-[hsl(var(--severity-high))]">{statsLoading ? "-" : stats?.highFindings || 0}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-7">
        <Card className="lg:col-span-3 bg-card/40 border-border/50 border">
          <CardHeader>
            <CardTitle className="font-mono flex items-center gap-2 text-lg">
              <Radar className="h-5 w-5 text-primary" />
              INITIALIZE_HUNT
            </CardTitle>
            <CardDescription className="font-mono text-xs">Deploy auditor agent to target repository.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleStartHunt} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="repoUrl" className="font-mono text-xs uppercase tracking-wider">Target_URL (GitHub)</Label>
                <Input
                  id="repoUrl"
                  placeholder="https://github.com/org/repo"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  className="font-mono bg-background/50 border-primary/20 focus-visible:ring-primary focus-visible:border-primary transition-all"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mode" className="font-mono text-xs uppercase tracking-wider">Report_Format</Label>
                <Select value={mode} onValueChange={(val) => setMode(val as typeof HuntMode[keyof typeof HuntMode])}>
                  <SelectTrigger className="font-mono bg-background/50">
                    <SelectValue placeholder="Select mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={HuntMode.code4rena} className="font-mono">Code4rena</SelectItem>
                    <SelectItem value={HuntMode.immunefi} className="font-mono">Immunefi</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider">AI_Model</Label>
                <div className="grid grid-cols-3 gap-2">
                  {MODELS.map((m) => {
                    const Icon = m.icon;
                    const active = model === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setModel(m.id)}
                        className={`flex flex-col items-center gap-1 rounded-md border p-2 text-center transition-all cursor-pointer
                          ${active
                            ? "border-primary bg-primary/10"
                            : "border-border/40 bg-background/30 hover:border-border hover:bg-background/60"
                          }`}
                      >
                        <Icon className={`h-4 w-4 ${active ? m.color : "text-muted-foreground"}`} />
                        <span className={`font-mono text-[10px] font-bold uppercase ${active ? m.color : "text-muted-foreground"}`}>
                          {m.label}
                        </span>
                        <span className="font-mono text-[9px] text-muted-foreground leading-tight">{m.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <Button
                type="submit"
                className="w-full font-mono uppercase tracking-widest group relative overflow-hidden bg-primary text-primary-foreground hover:bg-primary/90"
                disabled={createHunt.isPending}
              >
                {createHunt.isPending ? (
                  <span className="flex items-center gap-2">
                    <Terminal className="h-4 w-4 animate-pulse" />
                    Initializing...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Crosshair className="h-4 w-4 group-hover:scale-110 transition-transform" />
                    Engage Target
                  </span>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-4 bg-card/40 border-border/50">
          <CardHeader>
            <CardTitle className="font-mono text-lg">RECENT_MISSIONS</CardTitle>
            <CardDescription className="font-mono text-xs">Log of recent autonomous hunts.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {huntsLoading ? (
              <div className="p-6 text-center font-mono text-muted-foreground animate-pulse">Loading intel...</div>
            ) : hunts?.length === 0 ? (
              <div className="p-6 text-center font-mono text-muted-foreground">No operations found.</div>
            ) : (
              <div className="divide-y divide-border/30">
                {hunts?.slice(0, 5).map((hunt) => (
                  <div key={hunt.id} className="flex items-center justify-between p-4 hover:bg-muted/20 transition-colors">
                    <div className="space-y-1">
                      <Link href={`/hunts/${hunt.id}`} className="font-mono font-medium hover:underline flex items-center gap-2">
                        {hunt.repoName}
                      </Link>
                      <div className="text-xs text-muted-foreground font-mono flex items-center gap-2">
                        <span>{new Date(hunt.createdAt).toLocaleString()}</span>
                        <span>•</span>
                        <span className="uppercase">{hunt.mode}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={hunt.status} />
                      {hunt.status === "complete" && hunt.reportMarkdown && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Download report"
                          onClick={() => {
                            const blob = new Blob([hunt.reportMarkdown!], { type: "text/markdown" });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = `${hunt.repoName?.replace("/", "-") ?? hunt.id}-bloodhound.md`;
                            a.click();
                            URL.revokeObjectURL(url);
                          }}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" asChild>
                        <Link href={`/hunts/${hunt.id}`}>
                          <Terminal className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
          <CardFooter className="p-4 border-t border-border/30">
            <Button variant="link" className="w-full font-mono text-xs text-muted-foreground hover:text-foreground" asChild>
              <Link href="/">View all operations</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>

      {sponsors && sponsors.length > 0 && (
        <Card className="bg-card/30 border-[hsl(var(--severity-high))]/20">
          <CardHeader className="pb-3">
            <CardTitle className="font-mono text-sm flex items-center gap-2 text-[hsl(var(--severity-high))]">
              <Crown className="h-4 w-4" />
              LIFETIME_SPONSORS
            </CardTitle>
            <CardDescription className="font-mono text-xs">
              Supporters who donated 1+ ETH. Thank you.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {sponsors.map((s) => (
                <a
                  key={s.address}
                  href={`https://etherscan.io/address/${s.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-[hsl(var(--severity-high))] bg-[hsl(var(--severity-high))]/10 border border-[hsl(var(--severity-high))]/20 rounded px-2 py-1 hover:bg-[hsl(var(--severity-high))]/20 transition-colors"
                >
                  {s.address.slice(0, 6)}…{s.address.slice(-4)}
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "complete":
      return <Badge className="bg-[hsl(var(--severity-gas))]/20 text-[hsl(var(--severity-gas))] hover:bg-[hsl(var(--severity-gas))]/30 border-[hsl(var(--severity-gas))]/50 font-mono uppercase text-[10px]">Complete</Badge>;
    case "running":
      return <Badge className="bg-[hsl(var(--severity-medium))]/20 text-[hsl(var(--severity-medium))] hover:bg-[hsl(var(--severity-medium))]/30 border-[hsl(var(--severity-medium))]/50 font-mono uppercase text-[10px] animate-pulse">Running</Badge>;
    case "failed":
      return <Badge className="bg-destructive/20 text-destructive hover:bg-destructive/30 border-destructive/50 font-mono uppercase text-[10px]">Failed</Badge>;
    default:
      return <Badge variant="outline" className="font-mono uppercase text-[10px] text-muted-foreground">{status}</Badge>;
  }
}
