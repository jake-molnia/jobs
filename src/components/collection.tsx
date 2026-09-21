"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { AppHeader } from "./app-header";
import { RecordDetails } from "./record-details";
import { OrganizationProfile } from "./organization-profile";
import {
  OrganizationMark,
  StatusBadge,
  DueLabel,
  compensation,
  kindLabels,
  statusLabels,
} from "./collection-display";
import {
  Archive,
  ArrowDownWideNarrow,
  ArrowUpRight,
  Bookmark,
  Check,
  Award,
  Flag,
  Inbox,
  ListFilter,
  ListIcon,
  LoaderCircle,
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
  recordSchema,
  listQuerySchema,
  type Entry,
  type RecordPage,
  type Status,
} from "@/lib/records";
import { cn } from "@/lib/utils";

const statuses = [
  { value: "all", label: "All", icon: Inbox },
  { value: "saved", label: "Saved", icon: Bookmark },
  { value: "applied", label: "Applied", icon: Check },
  { value: "interview", label: "Interview", icon: MessageCircle },
  { value: "offer", label: "Offer", icon: Award },
  { value: "closed", label: "Closed", icon: Archive },
] satisfies { value: "all" | Status; label: string; icon: typeof Inbox }[];
const pageSize = 50;
function subscribeToViewport(onChange: () => void) {
  const viewport = window.matchMedia("(max-width: 1199px)");
  viewport.addEventListener("change", onChange);
  return () => viewport.removeEventListener("change", onChange);
}
function mobileViewport() {
  return window.matchMedia("(max-width: 1199px)").matches;
}
function serverViewport() {
  return false;
}

export function Collection() {
  const searchParams = useSearchParams();
  const isMobile = useSyncExternalStore(
    subscribeToViewport,
    mobileViewport,
    serverViewport,
  );
  const query = listQuerySchema.shape.q
    .catch("")
    .parse(searchParams.get("q") ?? undefined);
  const status =
    listQuerySchema.shape.status
      .catch(undefined)
      .parse(searchParams.get("status") ?? undefined) ?? "all";
  const kind =
    listQuerySchema.shape.kind
      .catch(undefined)
      .parse(searchParams.get("kind") ?? undefined) ?? "all";
  const sort = listQuerySchema.shape.sort
    .catch("updated")
    .parse(searchParams.get("sort") ?? undefined);
  const priority = listQuerySchema.shape.priority
    .catch(undefined)
    .parse(searchParams.get("priority") ?? undefined);
  const due = listQuerySchema.shape.due
    .catch(undefined)
    .parse(searchParams.get("due") ?? undefined);
  const organizationId = listQuerySchema.shape.organizationId
    .catch(undefined)
    .parse(searchParams.get("organizationId") ?? undefined);
  const selectedId =
    recordSchema.shape.id.catch("").parse(searchParams.get("item") ?? "") ||
    null;
  const [pagination, setPagination] = useState({ baseKey: "", offset: 0 });
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    baseKey: string;
    page: RecordPage;
    nextOffset: number;
  } | null>(null);
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [linkedRecord, setLinkedRecord] = useState<Entry | null>(null);
  const [itemError, setItemError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const lastLoadRef = useRef<{
    baseKey: string;
    retry: number;
    page: RecordPage;
  } | null>(null);
  const baseKey = JSON.stringify({
    query,
    status,
    kind,
    sort,
    priority,
    due,
    organizationId,
  });
  const offset = pagination.baseKey === baseKey ? pagination.offset : 0;
  function setOffset(value: number) {
    setPagination({ baseKey, offset: value });
  }
  const requestKey = JSON.stringify({ baseKey, offset, retry });
  const page = result?.baseKey === baseKey ? result.page : null;
  const error = failure?.key === requestKey ? failure.message : null;
  const pending = result?.key !== requestKey && !error;
  const records = page?.records ?? [];
  const selected = selectedId
    ? (records.find((record) => record.id === selectedId) ??
      (linkedRecord?.id === selectedId ? linkedRecord : undefined))
    : records[0];
  const filtered = Boolean(
    query || status !== "all" || kind !== "all" || priority || due,
  );

  function updateFilters(updates: Record<string, string | null>) {
    const params = new URLSearchParams(window.location.search);
    params.delete("item");
    for (const [key, value] of Object.entries(updates)) {
      if (!value || value === "all") params.delete(key);
      else params.set(key, value);
    }
    setOffset(0);
    window.history.pushState(null, "", params.size ? `?${params}` : "/");
  }
  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/records/${selectedId}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Could not load item.");
        const data: unknown = await response.json();
        const parsed = recordSchema.parse(data);
        if (!controller.signal.aborted) {
          setLinkedRecord(parsed);
          setItemError(null);
        }
      } catch {
        if (!controller.signal.aborted) setItemError(selectedId);
      }
    })();
    return () => controller.abort();
  }, [selectedId, retry]);

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
    if (organizationId) params.set("organizationId", organizationId);
    if (priority) params.set("priority", priority);
    if (due) params.set("due", due);
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
        const previous = lastLoadRef.current;
        let first = await fetchPage(refreshAll ? 0 : offset);
        const existing =
          !refreshAll && offset > 0 && previous?.baseKey === baseKey
            ? previous.page.records
            : [];
        const existingIds = new Set(existing.map((record) => record.id));
        const collectionChanged =
          existing.length > 0 &&
          (first.total !== previous?.page.total ||
            first.records.some((record) => existingIds.has(record.id)));
        if (collectionChanged) first = await fetchPage(0);
        const reload = refreshAll || collectionChanged;
        const loadedRecords = [...first.records];
        let nextOffset = (reload ? 0 : offset) + first.records.length;
        if (reload) {
          for (
            let pageOffset = pageSize;
            pageOffset <= offset && pageOffset < first.total;
            pageOffset += pageSize
          ) {
            const nextPage = await fetchPage(pageOffset);
            loadedRecords.push(...nextPage.records);
            nextOffset = pageOffset + nextPage.records.length;
          }
        }
        if (controller.signal.aborted) return;
        const merged = new Map(
          [...(reload ? [] : existing), ...loadedRecords].map((record) => [
            record.id,
            record,
          ]),
        );
        const page = { ...first, records: [...merged.values()] };
        setResult({ key: requestKey, baseKey, page, nextOffset });
        lastLoadRef.current = { baseKey, retry, page };
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
  }, [
    baseKey,
    requestKey,
    query,
    sort,
    offset,
    status,
    kind,
    retry,
    organizationId,
    priority,
    due,
  ]);

  function clearFilters() {
    updateFilters({
      q: null,
      status: null,
      kind: null,
      priority: null,
      due: null,
    });
  }
  function openRecord(record: Entry, opener: HTMLButtonElement) {
    openerRef.current = opener;
    const params = new URLSearchParams(window.location.search);
    params.set("item", record.id);
    window.history.pushState(null, "", `?${params}`);
  }
  function closeRecord() {
    const params = new URLSearchParams(window.location.search);
    params.delete("item");
    window.history.replaceState(null, "", params.size ? `?${params}` : "/");
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <a
        href="#collection-list"
        className="sr-only z-50 rounded-md bg-primary p-3 text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to collection
      </a>
      <AppHeader />
      <div className="mx-auto flex min-h-0 w-full max-w-[1800px] flex-1 flex-col md:flex-row">
        <aside className="shrink-0 border-b border-border px-3 py-3 md:w-44 md:border-r md:border-b-0 md:px-4 md:py-6 lg:w-48">
          <p className="mb-3 hidden px-3 text-[10px] font-medium tracking-[0.16em] text-muted-foreground md:block">
            ALL ITEMS
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
                  updateFilters({ status: value });
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
                  title="Across the collection"
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
          {organizationId && (
            <OrganizationProfile id={organizationId} refresh={retry} />
          )}
          <div className="flex shrink-0 items-center justify-between px-5 pt-5 pb-4 md:px-7">
            <div className="flex items-baseline gap-3">
              <h1 className="text-xl font-semibold tracking-tight">
                {organizationId
                  ? "Collection"
                  : status === "all"
                    ? "Collection"
                    : statusLabels[status]}
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
          <div className="flex shrink-0 flex-wrap gap-2 border-b border-border px-5 pb-4 md:px-7">
            <CollectionSearch
              query={query}
              onSearch={(value) => updateFilters({ q: value })}
            />
            <div className="relative flex-1 sm:flex-none">
              <ListFilter className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
              <select
                aria-label="Filter by type"
                value={kind}
                onChange={(event) => {
                  updateFilters({ kind: event.target.value });
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
                  updateFilters({ sort: event.target.value });
                }}
                className="h-9 w-full rounded-md border border-input bg-card pr-2 pl-9 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-36"
              >
                <option value="updated">Last updated</option>
                <option value="deadline">Deadline</option>
                <option value="organization">Organization</option>
                <option value="priority">Priority</option>
                <option value="follow_up">Follow up</option>
              </select>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card/25 px-5 py-2 md:px-7">
            <select
              aria-label="Filter by priority"
              value={priority ?? "all"}
              onChange={(event) =>
                updateFilters({ priority: event.target.value })
              }
              className="h-7 min-w-0 rounded border border-transparent bg-transparent px-1 text-[11px] text-muted-foreground outline-none hover:border-border focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="all">Any priority</option>
              <option value="high">High priority</option>
              <option value="normal">Normal priority</option>
              <option value="low">Low priority</option>
            </select>
            <span className="h-3 w-px bg-border" />
            <select
              aria-label="Filter by date"
              value={due ?? "all"}
              onChange={(event) => updateFilters({ due: event.target.value })}
              className="h-7 min-w-0 rounded border border-transparent bg-transparent px-1 text-[11px] text-muted-foreground outline-none hover:border-border focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="all">Any date</option>
              <option value="follow_up">Follow up due</option>
              <option value="deadline">Deadline soon</option>
            </select>
            {filtered && (
              <button
                type="button"
                onClick={clearFilters}
                className="ml-auto shrink-0 rounded px-2 py-1 text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                Reset
              </button>
            )}
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
                        className="flex min-w-0 flex-1 gap-3 py-4 pr-0 pl-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:pl-6"
                      >
                        <OrganizationMark name={record.organization} />
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
                          <span className="mt-2.5 flex flex-wrap items-center gap-1.5">
                            <StatusBadge status={record.status} />
                            {record.priority === "high" && (
                              <span
                                title="High priority"
                                className="text-[#d9c797]"
                              >
                                <Flag className="size-3" />
                                <span className="sr-only">High priority</span>
                              </span>
                            )}
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
                          {(record.followUpAt ||
                            record.deadline ||
                            compensation(record)) && (
                            <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                              {record.followUpAt ? (
                                <DueLabel
                                  value={record.followUpAt}
                                  label="Follow up"
                                />
                              ) : record.deadline ? (
                                <DueLabel value={record.deadline} label="Due" />
                              ) : null}
                              {compensation(record) && (
                                <span className="text-[11px] text-muted-foreground">
                                  {compensation(record)}
                                </span>
                              )}
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
                  {result && result.nextOffset < page.total && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={Boolean(pending)}
                      onClick={() => setOffset(result.nextOffset)}
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
              className="hidden w-[380px] shrink-0 overflow-y-auto border-l border-border min-[1200px]:block min-[1500px]:w-[440px]"
            >
              {!isMobile && selected ? (
                <RecordDetails record={selected} />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-muted-foreground">
                  <ListIcon className="size-6 opacity-50" />
                  <p className="text-xs">
                    {selectedId
                      ? itemError === selectedId
                        ? "This item could not be loaded."
                        : "Loading details…"
                      : "Select an item to view details."}
                  </p>
                </div>
              )}
            </aside>
          </div>
        </main>
      </div>
      <Sheet
        open={Boolean(selectedId) && isMobile}
        onOpenChange={(open) => {
          if (!open) closeRecord();
        }}
      >
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
            {selected ? (
              <RecordDetails record={selected} />
            ) : (
              <p className="p-6 text-sm text-muted-foreground" role="status">
                {itemError === selectedId
                  ? "This item could not be loaded."
                  : "Loading details…"}
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function CollectionSearch({
  query,
  onSearch,
}: {
  query: string;
  onSearch: (value: string) => void;
}) {
  const [searchState, setSearch] = useState({ query, value: query });
  if (searchState.query !== query) setSearch({ query, value: query });
  const search = searchState.query === query ? searchState.value : query;
  const inputRef = useRef<HTMLInputElement>(null);
  const onSearchRef = useRef(onSearch);
  useEffect(() => {
    onSearchRef.current = onSearch;
  }, [onSearch]);
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = window.setTimeout(
      () => onSearchRef.current(search.trim()),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [search, query]);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !(
          event.target instanceof HTMLElement &&
          (event.target.matches("input, textarea, select") ||
            event.target.isContentEditable)
        )
      ) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  return (
    <div className="relative min-w-44 flex-1 basis-full sm:basis-0">
      <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
      <Input
        ref={inputRef}
        aria-label="Search collection"
        placeholder="Search collection…"
        value={search}
        maxLength={200}
        onChange={(event) => setSearch({ query, value: event.target.value })}
        className="bg-card pr-9 pl-9"
      />
      {search ? (
        <button
          type="button"
          onClick={() => setSearch({ query, value: "" })}
          aria-label="Clear search"
          className="absolute top-1 right-1 rounded p-1.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute top-2 right-3 rounded border border-border px-1 text-[10px] text-muted-foreground">
          /
        </kbd>
      )}
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
