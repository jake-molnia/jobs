"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Building2,
  MapPin,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { AppHeader } from "./app-header";
import { OrganizationMark, humanize } from "./collection-display";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  organizationPageSchema,
  organizationQuerySchema,
} from "@/lib/organizations";
import { cn } from "@/lib/utils";
import type { z } from "zod";

export function Organizations() {
  const params = useSearchParams();
  const query = organizationQuerySchema.shape.q
    .catch("")
    .parse(params.get("q") ?? undefined);
  const sort = organizationQuerySchema.shape.sort
    .catch("name")
    .parse(params.get("sort") ?? undefined);
  const [searchState, setSearch] = useState({ query, value: query });
  if (searchState.query !== query) setSearch({ query, value: query });
  const search = searchState.query === query ? searchState.value : query;
  const [refresh, setRefresh] = useState(0);
  const [retry, setRetry] = useState(0);
  const baseKey = JSON.stringify({ query, sort });
  const [pagination, setPagination] = useState({ baseKey, offset: 0 });
  const offset = pagination.baseKey === baseKey ? pagination.offset : 0;
  const key = JSON.stringify({ baseKey, offset, refresh, retry });
  const [result, setResult] = useState<{
    key: string;
    baseKey: string;
    refresh: number;
    nextOffset: number;
    page: z.infer<typeof organizationPageSchema>;
  } | null>(null);
  const cache = useRef<typeof result>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const page = result?.baseKey === baseKey ? result.page : null;
  const pending = result?.key !== key && failure !== key;
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(window.location.search);
      if (search.trim()) next.set("q", search.trim());
      else next.delete("q");
      window.history.pushState(
        null,
        "",
        `/organizations${next.size ? `?${next}` : ""}`,
      );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, query]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const previous = cache.current;
        const retained =
          previous?.baseKey === baseKey && previous.refresh === refresh
            ? previous
            : null;
        const organizations = new Map(
          retained?.page.organizations.map((organization) => [
            organization.id,
            organization,
          ]),
        );
        let total = retained?.page.total ?? 0;
        let nextOffset = retained?.nextOffset ?? 0;
        let appending = retained !== null;
        for (
          let pageOffset = nextOffset;
          pageOffset <= offset;
          pageOffset += 50
        ) {
          const response = await fetch(
            `/api/organizations?${new URLSearchParams({ q: query, sort, limit: "50", offset: String(pageOffset) })}`,
            { signal: controller.signal, cache: "no-store" },
          );
          if (!response.ok) throw new Error("Could not load organizations.");
          const data: unknown = await response.json();
          const parsed = organizationPageSchema.parse(data);
          if (
            appending &&
            (parsed.total !== total ||
              !parsed.organizations.length ||
              parsed.organizations.some((organization) =>
                organizations.has(organization.id),
              ))
          ) {
            organizations.clear();
            appending = false;
            pageOffset = -50;
            continue;
          }
          for (const organization of parsed.organizations) {
            organizations.set(organization.id, organization);
          }
          total = parsed.total;
          nextOffset = parsed.organizations.length
            ? pageOffset + parsed.organizations.length
            : total;
          if (!parsed.organizations.length || nextOffset >= total) break;
        }
        if (!controller.signal.aborted) {
          const next = {
            key,
            baseKey,
            refresh,
            nextOffset,
            page: { total, organizations: [...organizations.values()] },
          };
          cache.current = next;
          setResult(next);
          setFailure(null);
        }
      } catch {
        if (!controller.signal.aborted) setFailure(key);
      }
    })();
    return () => controller.abort();
  }, [key, baseKey, query, sort, offset, refresh]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [baseKey]);
  useEffect(() => {
    const onFocus = () => setRefresh((value) => value + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AppHeader section="organizations" />
      <main className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-5 md:px-8">
        <div className="flex shrink-0 items-center justify-between pt-8 pb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Organizations{" "}
              <span className="ml-2 align-middle text-xs font-normal text-muted-foreground tabular-nums">
                {page?.total}
              </span>
            </h1>
            <p className="mt-2 text-xs text-muted-foreground">
              Browse the collection by place.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh organizations"
            disabled={pending}
            onClick={() => setRefresh((value) => value + 1)}
          >
            <RefreshCw
              className={cn(
                "size-4 text-muted-foreground",
                pending && "animate-spin",
              )}
            />
          </Button>
        </div>
        <div className="mb-6 flex shrink-0 gap-3">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input
              aria-label="Search organizations"
              placeholder="Search organizations…"
              value={search}
              maxLength={200}
              onChange={(event) =>
                setSearch({ query, value: event.target.value })
              }
              className="bg-card pr-9 pl-9"
            />
            {search && (
              <button
                aria-label="Clear search"
                type="button"
                onClick={() => setSearch({ query, value: "" })}
                className="absolute top-1 right-1 rounded p-1.5 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <select
            aria-label="Sort organizations"
            value={sort}
            onChange={(event) => {
              const next = new URLSearchParams(window.location.search);
              next.set("sort", event.target.value);
              window.history.pushState(null, "", `?${next}`);
            }}
            className="h-9 w-32 rounded-md border border-input bg-card px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="name">Name</option>
            <option value="records">Most items</option>
          </select>
        </div>
        <div
          ref={listRef}
          aria-label="Organization directory"
          aria-busy={pending}
          className="min-h-0 flex-1 overflow-y-auto pb-8"
        >
          {failure === key && (
            <div
              role="alert"
              className="mb-5 flex items-center justify-between rounded-lg border border-border p-5 text-sm"
            >
              Organizations could not be loaded.
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRetry((value) => value + 1)}
              >
                Try again
              </Button>
            </div>
          )}
          {pending && !page && (
            <p
              role="status"
              className="py-12 text-center text-xs text-muted-foreground"
            >
              Loading organizations…
            </p>
          )}
          {page && (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {page.organizations.map((organization) => (
                <li key={organization.id}>
                  <Link
                    href={`/?organizationId=${organization.id}`}
                    aria-label={`View ${organization.name}`}
                    className="group flex h-full min-h-48 flex-col rounded-lg border border-border bg-card/60 p-5 outline-none transition-colors hover:border-primary/35 hover:bg-card focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-center gap-3">
                      <OrganizationMark name={organization.name} />
                      <div className="min-w-0">
                        <h2 className="truncate text-sm font-medium">
                          {organization.name}
                        </h2>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {humanize(organization.kind)}
                        </p>
                      </div>
                      <ArrowRight className="ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                    </div>
                    {organization.location && (
                      <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <MapPin className="size-3 shrink-0" />
                        <span className="truncate">
                          {organization.location}
                        </span>
                      </p>
                    )}
                    {organization.description && (
                      <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {organization.description}
                      </p>
                    )}
                    <div className="mt-auto flex flex-wrap items-center gap-2 pt-5 text-[11px]">
                      <span className="rounded border border-border bg-background px-2 py-1 tabular-nums">
                        {organization.counts.all}{" "}
                        {organization.counts.all === 1 ? "item" : "items"}
                      </span>
                      {organization.counts.applied +
                        organization.counts.interview +
                        organization.counts.offer >
                        0 && (
                        <span className="text-primary">
                          {organization.counts.applied +
                            organization.counts.interview +
                            organization.counts.offer}{" "}
                          active
                        </span>
                      )}
                      {organization.counts.saved > 0 && (
                        <span className="ml-auto text-muted-foreground">
                          {organization.counts.saved} saved
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {!pending && page?.total === 0 && (
            <div className="flex min-h-64 flex-col items-center justify-center text-center">
              <Building2 className="mb-4 size-7 text-muted-foreground/60" />
              <h2 className="text-sm font-medium">
                {query ? "No matches" : "No organizations yet"}
              </h2>
              <p className="mt-2 text-xs text-muted-foreground">
                {query
                  ? "Try another search."
                  : "Organizations appear as items are added."}
              </p>
            </div>
          )}
          {page && page.organizations.length > 0 && (
            <div className="mt-5 flex items-center justify-between text-[11px] text-muted-foreground">
              <span role="status">
                {page.organizations.length} of {page.total}
              </span>
              {result && result.nextOffset < page.total && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    setPagination({
                      baseKey,
                      offset: result.nextOffset,
                    })
                  }
                >
                  {pending ? "Loading…" : "Load more"}
                </Button>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
