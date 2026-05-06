import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Shield, Terminal, Github } from "lucide-react";
import { DonateButton } from "@/components/donate-modal";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground font-sans">
      <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-14 items-center justify-between">
          <div className="flex items-center">
            <Link href="/" className="mr-6 flex items-center space-x-2">
              <Shield className="h-6 w-6 text-severity-critical" />
              <span className="font-mono font-bold tracking-tight text-lg">BLOODHOUND</span>
            </Link>
            <nav className="flex items-center space-x-6 text-sm font-medium">
              <Link
                href="/"
                className={`transition-colors hover:text-foreground/80 font-mono ${
                  location === "/" ? "text-foreground" : "text-foreground/60"
                }`}
              >
                Dashboard
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://github.com/prayingperceptions/bloodhound"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="View on GitHub"
            >
              <Github className="h-4 w-4" />
            </a>
            <DonateButton />
          </div>
        </div>
      </header>
      <main className="flex-1 flex-col flex container mx-auto py-8 px-4">
        {children}
      </main>
      <footer className="border-t border-border/50 py-4 md:px-8">
        <div className="container mx-auto flex flex-col items-center justify-between gap-2 md:h-16 md:flex-row">
          <p className="text-center text-xs leading-loose text-muted-foreground md:text-left font-mono">
            Bloodhound Autonomous Auditing Engine // v1.0.0
          </p>
          <div className="flex items-center gap-4 text-muted-foreground">
            <Terminal className="h-3.5 w-3.5" />
            <span className="text-xs font-mono">SYSTEM: ONLINE</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
