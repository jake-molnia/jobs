"use client";
import { useEffect, useRef, useState } from "react";
import { Circle, History } from "lucide-react";
import {
  applicationEventPageSchema,
  type ApplicationEvent,
} from "@/lib/webhook-schemas";
import { date, humanize, statusLabels } from "./collection-display";
import { Button } from "./ui/button";

export function RecordHistory({
  id,
  updatedAt,
}: {
  id: string;
  updatedAt: string;
}) {
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    events: ApplicationEvent[];
    total: number;
    nextOffset: number;
  } | null>(null);
  const cache = useRef<typeof result>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pagination, setPagination] = useState({ id, offset: 0 });
  const offset = pagination.id === id ? pagination.offset : 0;
  const key = JSON.stringify({ id, updatedAt });
  const requestKey = JSON.stringify({ key, offset, retry });
  const [loadedRequest, setLoadedRequest] = useState("");
  const pending = loadedRequest !== requestKey && failure !== requestKey;
  const events = result?.key === key ? result.events : [];
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const previous = cache.current;
        const retained = previous?.key === key ? previous : null;
        const all = new Map(retained?.events.map((event) => [event.id, event]));
        let total = retained?.total ?? 0;
        let nextOffset = retained?.nextOffset ?? 0;
        let appending = retained !== null;
        for (
          let pageOffset = nextOffset;
          pageOffset <= offset;
          pageOffset += 20
        ) {
          const response = await fetch(
            `/api/records/${id}/events?limit=20&offset=${pageOffset}`,
            { signal: controller.signal, cache: "no-store" },
          );
          if (!response.ok) throw new Error("Could not load history.");
          const data: unknown = await response.json();
          const page = applicationEventPageSchema.parse(data);
          if (
            appending &&
            (page.total !== total ||
              !page.events.length ||
              page.events.some((event) => all.has(event.id)))
          ) {
            all.clear();
            appending = false;
            pageOffset = -20;
            continue;
          }
          for (const event of page.events) all.set(event.id, event);
          total = page.total;
          nextOffset = page.events.length
            ? pageOffset + page.events.length
            : total;
          if (!page.events.length || nextOffset >= total) break;
        }
        if (!controller.signal.aborted) {
          const next = { key, events: [...all.values()], total, nextOffset };
          cache.current = next;
          setResult(next);
          setLoadedRequest(requestKey);
          setFailure(null);
        }
      } catch {
        if (!controller.signal.aborted) setFailure(requestKey);
      }
    })();
    return () => controller.abort();
  }, [id, key, requestKey, offset]);
  return (
    <section
      className="mt-6 border-t border-border pt-5"
      aria-label="Activity history"
    >
      <h3 className="mb-4 flex items-center gap-2 text-xs font-medium">
        <History className="size-3.5 text-muted-foreground" />
        Activity
      </h3>
      {failure === requestKey ? (
        <div className="text-xs text-muted-foreground" role="alert">
          Activity could not be loaded.
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {pending && events.length === 0 && (
        <p className="text-xs text-muted-foreground" role="status">
          Loading activity…
        </p>
      )}
      {!pending && failure !== requestKey && !events.length && (
        <p className="text-xs text-muted-foreground">
          No activity recorded yet.
        </p>
      )}
      <ol className="space-y-4">
        {events.map((event) => (
          <li key={event.id} className="relative flex gap-3 text-xs">
            <Circle className="mt-1 size-1.5 shrink-0 fill-current text-primary/60" />
            <div className="min-w-0">
              <p className="leading-5">
                {event.type === "application.created"
                  ? "Added to collection"
                  : event.type === "application.status_changed"
                    ? `${event.data.previousStatus ? statusLabels[event.data.previousStatus] : "Created"} → ${statusLabels[event.data.record.status]}`
                    : "Details updated"}
              </p>
              {event.type === "application.updated" && (
                <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                  {event.data.changedFields.map(humanize).join(", ")}
                </p>
              )}
              <time
                dateTime={event.timestamp}
                title={new Date(event.timestamp).toUTCString()}
                className="mt-0.5 block text-[10px] text-muted-foreground"
              >
                {date(event.timestamp)} ·{" "}
                {new Intl.DateTimeFormat("en", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "UTC",
                }).format(new Date(event.timestamp))}{" "}
                UTC
              </time>
            </div>
          </li>
        ))}
      </ol>
      {result?.key === key && result.nextOffset < result.total && (
        <Button
          className="mt-4"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setPagination({ id, offset: result.nextOffset })}
        >
          {pending ? "Loading…" : "Earlier activity"}
        </Button>
      )}
    </section>
  );
}
