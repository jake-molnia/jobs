import Link from "next/link";
import { Building2, ListIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function AppHeader({
  section = "collection",
}: {
  section?: "collection" | "organizations";
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-7 border-b border-border bg-background px-4 md:px-6">
      <Link
        href="/"
        aria-label="Index home"
        className="inline-flex items-center gap-2.5 rounded-sm text-sm font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex size-7 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
          <ListIcon className="size-4" />
        </span>
        Index
      </Link>
      <nav
        aria-label="Main"
        className="flex h-full items-stretch gap-5 text-xs"
      >
        <Link
          href="/"
          aria-current={section === "collection" ? "page" : undefined}
          className={cn(
            "flex items-center border-b-2 outline-none focus-visible:ring-2 focus-visible:ring-ring",
            section === "collection"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          Collection
        </Link>
        <Link
          href="/organizations"
          aria-current={section === "organizations" ? "page" : undefined}
          className={cn(
            "flex items-center gap-1.5 border-b-2 outline-none focus-visible:ring-2 focus-visible:ring-ring",
            section === "organizations"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Building2 className="hidden size-3.5 sm:block" />
          Organizations
        </Link>
      </nav>
    </header>
  );
}
