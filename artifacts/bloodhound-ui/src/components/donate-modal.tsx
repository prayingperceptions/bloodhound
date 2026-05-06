import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Check, Heart } from "lucide-react";

const ETH_ADDRESS = "0x2091125bFE4259b2CfA889165Beb6290d0Df5DeA";

interface DonateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DonateModal({ open, onOpenChange }: DonateModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(ETH_ADDRESS);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border/50 font-mono max-w-md">
        <DialogHeader className="space-y-3">
          <DialogTitle className="font-mono text-lg flex items-center gap-2">
            <Heart className="h-4 w-4 text-severity-critical" />
            Support Bloodhound
          </DialogTitle>
          <DialogDescription className="font-mono text-xs text-muted-foreground leading-relaxed">
            Bloodhound is a free autonomous auditing engine. If it helps you find real vulnerabilities,
            consider supporting continued development.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">ETH / EVM Address</span>
            <div className="flex items-center gap-2 bg-black/60 border border-border/40 rounded-md p-3">
              <code className="text-xs text-primary flex-1 break-all leading-relaxed">
                {ETH_ADDRESS}
              </code>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={handleCopy}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-severity-gas" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
            {copied && (
              <p className="text-xs text-severity-gas font-mono animate-in fade-in duration-200">
                Address copied to clipboard.
              </p>
            )}
          </div>

          <p className="text-xs text-muted-foreground border-t border-border/30 pt-4">
            Compatible with Ethereum, Base, Arbitrum, Optimism, and all EVM networks.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DonateButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="font-mono text-xs border-severity-critical/40 text-severity-critical hover:bg-severity-critical/10 hover:text-severity-critical"
        onClick={() => setOpen(true)}
      >
        <Heart className="h-3 w-3 mr-1.5" />
        Donate ETH
      </Button>
      <DonateModal open={open} onOpenChange={setOpen} />
    </>
  );
}
