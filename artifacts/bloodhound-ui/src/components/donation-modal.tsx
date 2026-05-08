import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useVerifyDonation } from "@workspace/api-client-react";
import { Copy, ExternalLink, CheckCircle2, Zap, Shield, Crown } from "lucide-react";

const DONATION_ADDRESS = "0x2091125bFE4259b2CfA889165Beb6290d0Df5DeA";

const TIERS = [
  {
    label: "Hunter",
    eth: "0.01 ETH",
    hunts: "30 hunts",
    duration: "30 days",
    icon: Zap,
    color: "text-[hsl(var(--severity-gas))]",
    border: "border-[hsl(var(--severity-gas))]/30",
    bg: "bg-[hsl(var(--severity-gas))]/5",
  },
  {
    label: "Specialist",
    eth: "0.1 ETH",
    hunts: "30 hunts",
    duration: "360 days",
    icon: Shield,
    color: "text-primary",
    border: "border-primary/30",
    bg: "bg-primary/5",
  },
  {
    label: "Lifetime Sponsor",
    eth: "1+ ETH",
    hunts: "Unlimited",
    duration: "Forever",
    icon: Crown,
    color: "text-[hsl(var(--severity-high))]",
    border: "border-[hsl(var(--severity-high))]/30",
    bg: "bg-[hsl(var(--severity-high))]/5",
  },
];

interface DonationModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  isFreeLimit?: boolean;
}

export function DonationModal({ open, onClose, onSuccess, isFreeLimit }: DonationModalProps) {
  const [txHash, setTxHash] = useState("");
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const verifyDonation = useVerifyDonation();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(DONATION_ADDRESS);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleVerify = () => {
    if (!txHash.trim()) return;
    verifyDonation.mutate(
      { data: { txHash: txHash.trim() } },
      {
        onSuccess: (status) => {
          toast({
            title: "Donation verified",
            description: `${status.tier === "lifetime" ? "Welcome, Sponsor! Unlimited hunts unlocked." : `${status.huntsRemaining} hunts unlocked.`}`,
          });
          setTxHash("");
          onSuccess();
          onClose();
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error ?? err?.message ?? "Verification failed.";
          toast({ title: "Verification failed", description: msg, variant: "destructive" });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg bg-card border-border/60 font-mono">
        <DialogHeader>
          <DialogTitle className="font-mono text-lg flex items-center gap-2">
            <Crown className="h-5 w-5 text-[hsl(var(--severity-high))]" />
            {isFreeLimit ? "DAILY_LIMIT_REACHED" : "UNLOCK_HUNT_QUOTA"}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs text-muted-foreground">
            {isFreeLimit
              ? "Free tier allows 1 hunt per day. Donate ETH to unlock more."
              : "Your current quota is exhausted. Donate ETH to continue hunting."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-2">
            {TIERS.map((t) => {
              const Icon = t.icon;
              return (
                <div key={t.label} className={`rounded-md border ${t.border} ${t.bg} p-3 space-y-1`}>
                  <div className={`flex items-center gap-1 ${t.color}`}>
                    <Icon className="h-3.5 w-3.5" />
                    <span className="text-[10px] font-bold uppercase">{t.label}</span>
                  </div>
                  <div className="text-base font-bold">{t.eth}</div>
                  <div className="text-[10px] text-muted-foreground">{t.hunts}</div>
                  <div className="text-[10px] text-muted-foreground">{t.duration}</div>
                </div>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Donation_Address (Ethereum Mainnet)</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[10px] bg-background/60 border border-border/40 rounded px-2 py-2 truncate text-primary">
                {DONATION_ADDRESS}
              </code>
              <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={handleCopy}>
                {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" asChild>
                <a
                  href={`https://etherscan.io/address/${DONATION_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="txHash" className="text-xs uppercase tracking-wider text-muted-foreground">
              Transaction_Hash (after sending)
            </Label>
            <Input
              id="txHash"
              placeholder="0x..."
              value={txHash}
              onChange={(e) => setTxHash(e.target.value)}
              className="font-mono text-xs bg-background/50 border-primary/20"
            />
            <p className="text-[10px] text-muted-foreground">
              Verified on-chain. No account needed.
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 font-mono text-xs uppercase"
              onClick={onClose}
            >
              Run 1/day Free
            </Button>
            <Button
              className="flex-1 font-mono text-xs uppercase"
              onClick={handleVerify}
              disabled={!txHash.trim() || verifyDonation.isPending}
            >
              {verifyDonation.isPending ? "Verifying..." : "Verify & Unlock"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
