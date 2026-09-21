"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArrowDownWideNarrow,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronRight,
  Circle,
  Inbox,
  ListFilter,
  ListIcon,
  LoaderCircle,
  MapPin,
  MessageCircle,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  recordPageSchema,
  kindSchema,
  listQuerySchema,
  type Entry,
  type ListQuery,
  type RecordPage,
  type Status,
} from "@/lib/records";
import { cn } from "@/lib/utils";

const statuses = [
  { value: "all", label: "All", icon: Inbox },
  { value: "saved", label: "Saved", icon: Bookmark },
  { value: "applied", label: "Applied", icon: Check },
  { value: "interview", label: "Interview", icon: MessageCircle },
  { value: "closed", label: "Closed", icon: Archive },
] satisfies { value: "all" | Status; label: string; icon: typeof Inbox }[];
const statusLabels: Record<Status, string> = {
  saved: "Saved",
  applied: "Applied",
  interview: "Interview",
  closed: "Closed",
};
const kindLabels: Record<Entry["kind"], string> = {
  role: "Role",
  phd: "PhD",
  research: "Research",
  other: "Other",
};
const statusStyles: Record<Status, string> = {
  saved: "text-muted-foreground",
  applied: "text-[#acc7df] border-[#394957] bg-[#24313b]/40",
  interview: "text-[#d9c797] border-[#504934] bg-[#393427]/40",
  closed: "text-muted-foreground bg-accent/40",
};
const pageSize = 50;
function initials(value: string) {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();
}
function date(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}
function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge className={cn("gap-1.5", statusStyles[status])}>
      <Circle className="size-1.5 fill-current" />
      {statusLabels[status]}
    </Badge>
  );
}

export function Collection() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | Status>("all");
  const [kind, setKind] = useState<"all" | Entry["kind"]>("all");
  const [sort, setSort] = useState<ListQuery["sort"]>("updated");
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    baseKey: string;
    page: RecordPage;
  } | null>(null);
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const lastLoadRef = useRef<{ baseKey: string; retry: number } | null>(null);
  const baseKey = JSON.stringify({ query, status, kind, sort });
  const requestKey = JSON.stringify({ baseKey, offset, retry });
  const page = result?.baseKey === baseKey ? result.page : null;
  const error = failure?.key === requestKey ? failure.message : null;
  const pending = result?.key !== requestKey && !error;
  const records = page?.records ?? [];
  const selected =
    records.find((record) => record.id === selectedId) ?? records[0];
  const filtered = Boolean(query || status !== "all" || kind !== "all");

  useEffect(() => {
    if (search.trim() === query) return;
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setOffset(0);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, query]);

  useEffect(() => {
    function refresh() {
      setRetry((value) => value + 1);
    }
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      q: query,
      sort,
      limit: String(pageSize),
      offset: String(offset),
    });
    if (status !== "all") params.set("status", status);
    if (kind !== "all") params.set("kind", kind);
    const refreshAll =
      lastLoadRef.current?.baseKey === baseKey &&
      lastLoadRef.current.retry !== retry;
    const resetScroll = lastLoadRef.current?.baseKey !== baseKey;
    async function fetchPage(pageOffset: number) {
      const pageParams = new URLSearchParams(params);
      pageParams.set("offset", String(pageOffset));
      const response = await fetch(`/api/records?${pageParams}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error("The collection could not be loaded.");
      const data: unknown = await response.json();
      return recordPageSchema.parse(data);
    }
    async function load() {
      try {
        const first = await fetchPage(refreshAll ? 0 : offset);
        const refreshedRecords = [...first.records];
        if (refreshAll) {
          for (
            let pageOffset = pageSize;
            pageOffset <= offset && pageOffset < first.total;
            pageOffset += pageSize
          ) {
            const nextPage = await fetchPage(pageOffset);
            refreshedRecords.push(...nextPage.records);
          }
        }
        if (controller.signal.aborted) return;
        setResult((previous) => {
          const existing =
            !refreshAll && offset > 0 && previous?.baseKey === baseKey
              ? previous.page.records
              : [];
          const merged = new Map(
            [...existing, ...refreshedRecords].map((record) => [
              record.id,
              record,
            ]),
          );
          return {
            key: requestKey,
            baseKey,
            page: { ...first, records: [...merged.values()] },
          };
        });
        lastLoadRef.current = { baseKey, retry };
        setFailure(null);
        if (resetScroll) listRef.current?.scrollTo({ top: 0 });
      } catch {
        if (!controller.signal.aborted)
          setFailure({
            key: requestKey,
            message:
              "The collection could not be loaded. Try again in a moment.",
          });
      }
    }
    void load();
    return () => controller.abort();
  }, [baseKey, requestKey, query, sort, offset, status, kind, retry]);

  function clearFilters() {
    setSearch("");
    setQuery("");
    setStatus("all");
    setKind("all");
    setOffset(0);
  }
  function openRecord(record: Entry, opener: HTMLButtonElement) {
    openerRef.current = opener;
    setSelectedId(record.id);
    if (window.matchMedia("(max-width: 1199px)").matches) setSheetOpen(true);
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <a
        href="#collection-list"
        className="sr-only z-50 rounded-md bg-primary p-3 text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to collection
      </a>
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-5 md:px-7">
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
        <span className="text-[11px] tracking-wide text-muted-foreground">
          Your collection
        </span>
      </header>
      <div className="mx-auto flex min-h-0 w-full max-w-[1800px] flex-1 flex-col md:flex-row">
        <aside className="shrink-0 border-b border-border px-3 py-3 md:w-52 md:border-r md:border-b-0 md:px-4 md:py-8 lg:w-56">
          <p className="mb-3 hidden px-3 text-[10px] font-medium tracking-[0.16em] text-muted-foreground md:block">
            COLLECTION
          </p>
          <nav
            aria-label="Status"
            className="flex gap-1 overflow-x-auto md:flex-col"
          >
            {statuses.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                aria-current={status === value ? "page" : undefined}
                onClick={() => {
                  setStatus(value);
                  setOffset(0);
                }}
                className={cn(
                  "flex min-h-10 shrink-0 items-center gap-2.5 rounded-md px-3 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  status === value
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <Icon
                  className={cn("size-4", status === value && "text-primary")}
                />
                <span>{label}</span>
                <span
                  className={cn(
                    "ml-auto pl-3 text-[11px] tabular-nums",
                    status === value ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {result?.page.counts[value] ?? "–"}
                </span>
              </button>
            ))}
          </nav>
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between px-5 pt-7 pb-5 md:px-8 md:pt-8">
            <div className="flex items-baseline gap-3">
              <h1 className="text-xl font-semibold tracking-tight">
                Collection
              </h1>
              <span className="text-xs text-muted-foreground tabular-nums">
                {page ? page.total : ""}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {status === "all" ? "All items" : statusLabels[status]}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Refresh collection"
                title="Refresh collection"
                disabled={Boolean(pending)}
                onClick={() => setRetry((value) => value + 1)}
                className="size-8 text-muted-foreground"
              >
                <RefreshCw
                  className={cn("size-3.5", pending && "animate-spin")}
                />
              </Button>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 border-b border-border px-5 pb-5 md:px-8">
            <div className="relative min-w-44 flex-1 basis-full sm:basis-0">
              <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
              <Input
                aria-label="Search collection"
                placeholder="Search collection…"
                value={search}
                maxLength={200}
                onChange={(event) => setSearch(event.target.value)}
                className="bg-card pr-9 pl-9"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="absolute top-1 right-1 rounded p-1.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            <div className="relative flex-1 sm:flex-none">
              <ListFilter className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
              <select
                aria-label="Filter by type"
                value={kind}
                onChange={(event) => {
                  setKind(
                    event.target.value === "all"
                      ? "all"
                      : kindSchema.parse(event.target.value),
                  );
                  setOffset(0);
                }}
                className="h-9 w-full rounded-md border border-input bg-card pr-2 pl-9 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-32"
              >
                <option value="all">All types</option>
                <option value="role">Role</option>
                <option value="phd">PhD</option>
                <option value="research">Research</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="relative flex-1 sm:flex-none">
              <ArrowDownWideNarrow className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
              <select
                aria-label="Sort collection"
                value={sort}
                onChange={(event) => {
                  setSort(listQuerySchema.shape.sort.parse(event.target.value));
                  setOffset(0);
                }}
                className="h-9 w-full rounded-md border border-input bg-card pr-2 pl-9 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-36"
              >
                <option value="updated">Last updated</option>
                <option value="deadline">Deadline</option>
                <option value="organization">Organization</option>
              </select>
            </div>
          </div>
          <div className="flex min-h-0 flex-1">
            <div
              ref={listRef}
              id="collection-list"
              tabIndex={-1}
              aria-label="Collection items"
              aria-busy={Boolean(pending)}
              className="min-w-0 flex-1 overflow-y-auto outline-none"
            >
              {pending && !page ? <CollectionSkeleton /> : null}
              {error ? (
                <div
                  role="alert"
                  className="m-5 flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-5 text-sm"
                >
                  <p>{error}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRetry((value) => value + 1)}
                  >
                    Try again
                  </Button>
                </div>
              ) : null}
              {!pending && !error && records.length === 0 ? (
                <div className="flex min-h-80 flex-col items-center justify-center px-6 py-14 text-center">
                  <span className="mb-5 flex size-12 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
                    {filtered ? (
                      <Search className="size-5" />
                    ) : (
                      <Inbox className="size-5" />
                    )}
                  </span>
                  <h2 className="text-sm font-medium">
                    {filtered ? "No matches" : "Nothing here yet"}
                  </h2>
                  <p className="mt-2 max-w-64 text-xs leading-relaxed text-muted-foreground">
                    {filtered
                      ? "Try another search or clear your filters."
                      : "Your saved items will appear here."}
                  </p>
                  {filtered && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-5"
                      onClick={clearFilters}
                    >
                      Clear filters
                    </Button>
                  )}
                </div>
              ) : null}
              {records.length > 0 && (
                <ul className="divide-y divide-border/80">
                  {records.map((record) => (
                    <li
                      key={record.id}
                      className={cn(
                        "group relative flex items-stretch border-l-2 transition-colors hover:bg-card",
                        selected?.id === record.id
                          ? "border-l-primary bg-card"
                          : "border-l-transparent",
                      )}
                    >
                      <button
                        type="button"
                        onClick={(event) =>
                          openRecord(record, event.currentTarget)
                        }
                        aria-label={`View ${record.title} at ${record.organization}`}
                        aria-pressed={selected?.id === record.id}
                        className="flex min-w-0 flex-1 gap-3.5 py-5 pr-0 pl-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:pl-7"
                      >
                        <span
                          aria-hidden="true"
                          className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-xs font-semibold text-muted-foreground"
                        >
                          {initials(record.organization)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] leading-5 font-medium text-foreground">
                            {record.title}
                          </span>
                          <span className="mt-1 block truncate text-xs text-muted-foreground">
                            {record.organization}
                            {record.location ? (
                              <>
                                <span className="px-1.5 text-muted-foreground/50">
                                  ·
                                </span>
                                {record.location}
                              </>
                            ) : null}
                          </span>
                          <span className="mt-3 flex flex-wrap items-center gap-1.5">
                            <StatusBadge status={record.status} />
                            <Badge className="border-transparent bg-accent/60 text-muted-foreground">
                              {kindLabels[record.kind]}
                            </Badge>
                            {record.tags.slice(0, 2).map((tag) => (
                              <span
                                key={tag}
                                className="hidden text-[11px] text-muted-foreground sm:inline"
                              >
                                <span className="px-1 text-muted-foreground/40">
                                  ·
                                </span>
                                {tag}
                              </span>
                            ))}
                          </span>
                          {record.deadline && (
                            <span className="mt-2 block text-[11px] text-muted-foreground">
                              Due {date(record.deadline)}
                            </span>
                          )}
                        </span>
                      </button>
                      <a
                        href={record.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open ${record.title} in a new tab`}
                        title="Open in new tab"
                        className="mt-4 mr-3 ml-2 flex size-8 shrink-0 items-center justify-center self-start rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:mr-5"
                      >
                        <ArrowUpRight className="size-4" />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {page && records.length > 0 && (
                <div className="flex min-h-20 items-center justify-between gap-3 px-5 py-5 md:px-7">
                  <span
                    role="status"
                    className="text-[11px] text-muted-foreground tabular-nums"
                  >
                    {records.length} of {page.total}
                  </span>
                  {records.length < page.total && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={Boolean(pending)}
                      onClick={() => setOffset(records.length)}
                    >
                      {pending ? (
                        <LoaderCircle className="animate-spin" />
                      ) : null}
                      {pending ? "Loading…" : "Load more"}
                    </Button>
                  )}
                </div>
              )}
            </div>
            <aside
              aria-label="Item details"
              className="hidden w-[360px] shrink-0 overflow-y-auto border-l border-border min-[1200px]:block min-[1500px]:w-[400px]"
            >
              {selected ? (
                <Details record={selected} />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-muted-foreground">
                  <ListIcon className="size-6 opacity-50" />
                  <p className="text-xs">Select an item to view details.</p>
                </div>
              )}
            </aside>
          </div>
        </main>
      </div>
      <Sheet open={sheetOpen && Boolean(selected)} onOpenChange={setSheetOpen}>
        <SheetContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            openerRef.current?.focus();
          }}
        >
          <SheetTitle className="sr-only">
            {selected?.title ?? "Details"}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Details for {selected?.organization ?? "this item"}
          </SheetDescription>
          <div className="min-h-0 flex-1 overflow-y-auto pt-8">
            {selected && <Details record={selected} />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Details({ record }: { record: Entry }) {
  return (
    <div className="p-6 min-[1500px]:p-7">
      <div className="mb-7 flex items-center justify-between">
        <span className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground">
          DETAILS
        </span>
        <StatusBadge status={record.status} />
      </div>
      <div className="mb-5 flex size-12 items-center justify-center rounded-xl border border-border bg-card text-sm font-medium text-primary">
        {initials(record.organization)}
      </div>
      <h2 className="text-lg leading-7 font-semibold tracking-tight [overflow-wrap:anywhere]">
        {record.title}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
        {record.organization}
      </p>
      {record.location && (
        <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
          <MapPin className="mt-0.5 size-3.5 shrink-0" />
          {record.location}
        </p>
      )}
      <Button
        asChild
        variant="outline"
        className="mt-6 w-full justify-between bg-card text-xs"
      >
        <a href={record.url} target="_blank" rel="noopener noreferrer">
          Open listing
          <ArrowUpRight className="size-4" />
        </a>
      </Button>
      <dl className="my-6 space-y-3.5 border-y border-border py-5 text-xs">
        <DetailField label="Type" value={kindLabels[record.kind]} />
        {record.arrangement !== "unspecified" && (
          <DetailField
            label="Arrangement"
            value={
              record.arrangement.charAt(0).toUpperCase() +
              record.arrangement.slice(1)
            }
          />
        )}
        {record.compensation && (
          <DetailField label="Compensation" value={record.compensation} />
        )}
        {record.deadline && (
          <DetailField label="Deadline" value={date(record.deadline)} />
        )}
        {record.appliedAt && (
          <DetailField label="Applied" value={date(record.appliedAt)} />
        )}
        <DetailField label="Updated" value={date(record.updatedAt)} />
      </dl>
      {record.tags.length > 0 && (
        <div className="mb-7 flex flex-wrap gap-1.5">
          {record.tags.map((tag) => (
            <Badge
              key={tag}
              className="max-w-full break-all bg-card text-muted-foreground"
            >
              {tag}
            </Badge>
          ))}
        </div>
      )}
      {record.description && (
        <section className="mb-7">
          <h3 className="mb-3 text-xs font-medium">Overview</h3>
          <p className="text-xs leading-[1.9] whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
            {record.description}
          </p>
        </section>
      )}
      {record.notes && (
        <section className="mb-7">
          <h3 className="mb-3 text-xs font-medium">Notes</h3>
          <p className="rounded-md border border-border bg-card p-3.5 text-xs leading-[1.9] whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
            {record.notes}
          </p>
        </section>
      )}
      <a
        href={record.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex max-w-full items-center gap-1 rounded text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="truncate">{new URL(record.url).hostname}</span>
        <ChevronRight className="size-3 shrink-0" />
        <span className="sr-only">, opens in a new tab</span>
      </a>
    </div>
  );
}
function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right leading-5 [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}
export function CollectionSkeleton() {
  return (
    <div
      aria-label="Loading collection"
      role="status"
      className="divide-y divide-border"
    >
      {[0, 1, 2, 3, 4].map((item) => (
        <div key={item} className="flex gap-4 px-6 py-6">
          <Skeleton className="size-10 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading collection</span>
    </div>
  );
}
