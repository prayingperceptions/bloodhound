import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Shield, Radar, History, Settings, Terminal } from "lucide-react";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground font-sans">
      <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-14 items-center">
          <div className="mr-4 flex">
            <Link href="/" className="mr-6 flex items-center space-x-2">
              <Shield className="h-6 w-6 text-severity-critical" />
              <span className="font-mono font-bold tracking-tight text-lg">BLOODHOUND</span>
            </Link>
            <nav className="flex items-center space-x-6 text-sm font-medium">
              <Link
                href="/"
                className={`transition-colors hover:text-foreground/80 ${
                  location === "/" ? "text-foreground" : "text-foreground/60"
                }`}
              >
                Dashboard
              </Link>
            </nav>
          </div>
        </div>
      </header>
      <main className="flex-1 flex-col flex container mx-auto py-8">
        {children}
      </main>
      <footer className="border-t border-border/50 py-6 md:px-8 md:py-0">
        <div className="container mx-auto flex flex-col items-center justify-between gap-4 md:h-24 md:flex-row">
          <p className="text-center text-sm leading-loose text-muted-foreground md:text-left font-mono">
            Bloodhound Autonomous Auditing Engine // v1.0.0
          </p>
          <div className="flex items-center gap-4 text-muted-foreground">
            <Terminal className="h-4 w-4" />
            <span className="text-xs font-mono">SYSTEM: ONLINE</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
