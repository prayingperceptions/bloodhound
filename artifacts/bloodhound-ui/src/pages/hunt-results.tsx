import { useEffect, useState, useRef } from "react";
import { useParams, Link } from "wouter";
import { useGetHunt, getGetHuntQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Terminal, AlertTriangle, CheckCircle2, Info, Flame, Zap, Shield, ShieldAlert, Download, Loader2, Activity, ChevronLeft } from "lucide-react";
import { type Finding, HuntStatus } from "@workspace/api-client-react";
import { DonateButton } from "@/components/donate-modal";

type StreamEvent = {
  phase: string;
  message: string;
  progress?: number;
  done?: boolean;
};

export function HuntResults() {
  const params = useParams();
  const id = params.id as string;
  const queryClient = useQueryClient();
  const [streamEvents, setStreamEvents] = useState<StreamEvent[]>([]);
  const [progress, setProgress] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const { data: hunt, isLoading, error } = useGetHunt(id, {
    query: {
      enabled: !!id,
      queryKey: getGetHuntQueryKey(id),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return (status === HuntStatus.pending || status === HuntStatus.running) ? 3000 : false;
      }
    }
  });

  useEffect(() => {
    if (!id) return;
    if (hunt?.status === HuntStatus.complete || hunt?.status === HuntStatus.failed) {
      if (eventSourceRef.current) eventSourceRef.current.close();
      return;
    }

    const eventSource = new EventSource(`/api/hunts/${id}/progress`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as StreamEvent;
        setStreamEvents((prev) => [...prev, data]);
        if (data.progress != null) setProgress(data.progress);
        if (data.done) {
          eventSource.close();
          queryClient.invalidateQueries({ queryKey: getGetHuntQueryKey(id) });
        }
      } catch {}
    };

    eventSource.onerror = () => eventSource.close();

    return () => eventSource.close();
  }, [id, hunt?.status, queryClient]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [streamEvents]);

  const handleDownload = () => {
    if (!hunt?.reportMarkdown) return;
    const blob = new Blob([hunt.reportMarkdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bloodhound-${hunt.repoName?.replace("/", "-") ?? hunt.id}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (isLoading && !hunt) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !hunt) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <ShieldAlert className="h-12 w-12 text-destructive" />
        <h2 className="text-xl font-mono text-destructive">Intel Not Found</h2>
        <p className="text-muted-foreground font-mono text-sm">The requested operation could not be located.</p>
        <Button variant="outline" asChild className="font-mono text-xs">
          <Link href="/">Back to Command Center</Link>
        </Button>
      </div>
    );
  }

  const isRunning = hunt.status === HuntStatus.pending || hunt.status === HuntStatus.running;

  const groupedFindings = hunt.findings?.reduce((acc, finding) => {
    const key = finding.contract;
    if (!acc[key]) acc[key] = [];
    acc[key].push(finding);
    return acc;
  }, {} as Record<string, Finding[]>) || {};

  const severityCounts = (hunt.findings ?? []).reduce((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div className="space-y-1">
          <Link href="/" className="inline-flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors mb-2">
            <ChevronLeft className="h-3 w-3" />
            Command Center
          </Link>
          <h1 className="text-2xl font-bold font-mono tracking-tight flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            OP: {hunt.repoName}
          </h1>
          <p className="text-sm text-muted-foreground font-mono">{hunt.repoUrl}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={hunt.status} />
          {isRunning && <DonateButton />}
          {hunt.status === HuntStatus.complete && (
            <Button variant="outline" className="font-mono text-xs h-8" onClick={handleDownload}>
              <Download className="h-3 w-3 mr-2" />
              Download Intel (.md)
            </Button>
          )}
        </div>
      </div>

      {/* Running state */}
      {isRunning ? (
        <Card className="border-border/50 bg-black/40 relative overflow-hidden">
          <div className="absolute top-0 left-0 h-0.5 bg-primary/30 w-full">
            <div
              className="h-full bg-primary transition-all duration-700"
              style={{ width: `${progress}%` }}
            />
          </div>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="font-mono text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Live Telemetry Feed
              </CardTitle>
              <span className="font-mono text-xs text-primary">{progress}%</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="font-mono text-xs space-y-1.5 h-72 overflow-y-auto bg-black p-4 rounded border border-white/5">
              {streamEvents.length === 0 ? (
                <div className="text-muted-foreground animate-pulse">Initializing auditor agent...</div>
              ) : (
                streamEvents.map((evt, i) => (
                  <div key={i} className="flex items-start gap-3 animate-in fade-in duration-200">
                    <span className="text-muted-foreground/60 shrink-0 tabular-nums">[{evt.phase}]</span>
                    <span className="text-primary/80">{evt.message}</span>
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </CardContent>
        </Card>
      ) : hunt.status === HuntStatus.failed ? (
        <Card className="border-destructive/50 bg-destructive/10">
          <CardHeader>
            <CardTitle className="font-mono text-destructive flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" />
              MISSION FAILED
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-sm">{hunt.errorMessage || "Unknown fatal error occurred during execution."}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {/* Stats row */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="bg-card/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-mono text-muted-foreground uppercase">Findings</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono">{hunt.findings?.length || 0}</div>
              </CardContent>
            </Card>
            <Card className="bg-card/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-mono text-muted-foreground uppercase">Contracts Checked</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono">{hunt.contractsFound || 0}</div>
              </CardContent>
            </Card>
            <Card className="bg-destructive/10 border-destructive/30 md:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-mono text-destructive uppercase">Critical / High</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono text-destructive">
                  {hunt.findings?.filter(f => f.severity === "critical" || f.severity === "high").length || 0}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Severity summary bar */}
          {hunt.findings && hunt.findings.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Severity Breakdown</span>
              <div className="flex gap-3 flex-wrap">
                {(["critical", "high", "medium", "low", "informational", "gas"] as const).map((sev) =>
                  severityCounts[sev] ? (
                    <div key={sev} className="flex items-center gap-1.5">
                      <SeverityBadge severity={sev} count={severityCounts[sev]} />
                    </div>
                  ) : null
                )}
              </div>
            </div>
          )}

          {/* Findings by contract */}
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-border/50 pb-2">
              <h3 className="font-mono text-lg">IDENTIFIED THREATS</h3>
              <DonateButton />
            </div>
            {Object.keys(groupedFindings).length === 0 ? (
              <p className="font-mono text-muted-foreground text-sm">No vulnerabilities detected.</p>
            ) : (
              Object.entries(groupedFindings).map(([contract, findings]) => (
                <div key={contract} className="space-y-4">
                  <h4 className="font-mono text-primary font-bold flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    {contract}
                  </h4>
                  <div className="space-y-4 pl-6 border-l border-border/50">
                    {findings.map(finding => (
                      <Card key={finding.id} className="bg-black/20 border-border/50">
                        <CardHeader className="pb-2">
                          <div className="flex items-start justify-between gap-4">
                            <div className="space-y-1">
                              <CardTitle className="text-base font-bold font-mono">{finding.title}</CardTitle>
                              {finding.function && (
                                <CardDescription className="font-mono text-xs text-muted-foreground">
                                  Function: {finding.function}
                                </CardDescription>
                              )}
                            </div>
                            <SeverityBadge severity={finding.severity} />
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-4 text-sm">
                          <div className="space-y-1">
                            <span className="font-mono text-xs text-muted-foreground uppercase block">Description</span>
                            <p className="text-foreground/90">{finding.description}</p>
                          </div>
                          <div className="grid md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                              <span className="font-mono text-xs text-muted-foreground uppercase block">Impact</span>
                              <p className="text-foreground/80">{finding.impact}</p>
                            </div>
                            <div className="space-y-1">
                              <span className="font-mono text-xs text-muted-foreground uppercase block">Recommendation</span>
                              <p className="text-foreground/80">{finding.recommendation}</p>
                            </div>
                          </div>
                          {finding.codeSnippet && (
                            <div className="space-y-1 pt-2">
                              <span className="font-mono text-xs text-muted-foreground uppercase block">Vulnerable Code</span>
                              <pre className="bg-black p-4 rounded-md overflow-x-auto text-xs font-mono text-primary/90 border border-white/5">
                                <code>{finding.codeSnippet}</code>
                              </pre>
                            </div>
                          )}
                          {finding.proofOfConcept && (
                            <div className="space-y-1 pt-2">
                              <span className="font-mono text-xs text-amber-400/80 uppercase block flex items-center gap-1.5">
                                <Zap className="h-3 w-3" />
                                Proof of Concept
                              </span>
                              <pre className="bg-amber-950/20 border border-amber-500/20 p-4 rounded-md overflow-x-auto text-xs font-mono text-amber-100/80 whitespace-pre-wrap">
                                <code>{finding.proofOfConcept}</code>
                              </pre>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "complete":
      return <Badge className="bg-[hsl(var(--severity-gas))]/20 text-[hsl(var(--severity-gas))] hover:bg-[hsl(var(--severity-gas))]/30 border-[hsl(var(--severity-gas))]/50 font-mono uppercase text-xs px-3 py-1">Complete</Badge>;
    case "running":
      return <Badge className="bg-[hsl(var(--severity-medium))]/20 text-[hsl(var(--severity-medium))] hover:bg-[hsl(var(--severity-medium))]/30 border-[hsl(var(--severity-medium))]/50 font-mono uppercase text-xs px-3 py-1 animate-pulse">Running</Badge>;
    case "failed":
      return <Badge className="bg-destructive/20 text-destructive hover:bg-destructive/30 border-destructive/50 font-mono uppercase text-xs px-3 py-1">Failed</Badge>;
    default:
      return <Badge variant="outline" className="font-mono uppercase text-xs px-3 py-1 text-muted-foreground">{status}</Badge>;
  }
}

function SeverityBadge({ severity, count }: { severity: string; count?: number }) {
  const getSeverityStyles = (sev: string) => {
    switch (sev) {
      case "critical": return { icon: <AlertTriangle className="h-3 w-3 mr-1" />, classes: "bg-[hsl(var(--severity-critical))]/20 text-[hsl(var(--severity-critical))] border-[hsl(var(--severity-critical))]/50" };
      case "high":     return { icon: <Flame className="h-3 w-3 mr-1" />,         classes: "bg-[hsl(var(--severity-high))]/20 text-[hsl(var(--severity-high))] border-[hsl(var(--severity-high))]/50" };
      case "medium":   return { icon: <Activity className="h-3 w-3 mr-1" />,      classes: "bg-[hsl(var(--severity-medium))]/20 text-[hsl(var(--severity-medium))] border-[hsl(var(--severity-medium))]/50" };
      case "low":      return { icon: <Info className="h-3 w-3 mr-1" />,           classes: "bg-[hsl(var(--severity-low))]/20 text-[hsl(var(--severity-low))] border-[hsl(var(--severity-low))]/50" };
      case "gas":      return { icon: <Zap className="h-3 w-3 mr-1" />,            classes: "bg-[hsl(var(--severity-gas))]/20 text-[hsl(var(--severity-gas))] border-[hsl(var(--severity-gas))]/50" };
      default:         return { icon: <Info className="h-3 w-3 mr-1" />,           classes: "bg-[hsl(var(--severity-informational))]/20 text-[hsl(var(--severity-informational))] border-[hsl(var(--severity-informational))]/50" };
    }
  };
  const style = getSeverityStyles(severity);
  return (
    <Badge variant="outline" className={`font-mono uppercase text-[10px] whitespace-nowrap ${style.classes}`}>
      {style.icon}
      {severity}{count != null ? ` (${count})` : ""}
    </Badge>
  );
}
