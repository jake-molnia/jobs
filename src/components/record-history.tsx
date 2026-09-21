"use client";
import { useEffect, useState } from "react";
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
  } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pagination, setPagination] = useState({ id, offset: 0 });
  const offset = pagination.id === id ? pagination.offset : 0;
  const key = JSON.stringify({ id, updatedAt, retry });
  const requestKey = JSON.stringify({ key, offset });
  const [loadedRequest, setLoadedRequest] = useState("");
  const pending = loadedRequest !== requestKey && failure !== requestKey;
  const events = result?.key === key ? result.events : [];
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const all: ApplicationEvent[] = [];
        let total = 0;
        for (let pageOffset = 0; pageOffset <= offset; pageOffset += 20) {
          const response = await fetch(
            `/api/records/${id}/events?limit=20&offset=${pageOffset}`,
            { signal: controller.signal, cache: "no-store" },
          );
          if (!response.ok) throw new Error("Could not load history.");
          const data: unknown = await response.json();
          const page = applicationEventPageSchema.parse(data);
          all.push(...page.events);
          total = page.total;
          if (all.length >= total) break;
        }
        if (!controller.signal.aborted) {
          setResult({ key, events: all, total });
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
      {result?.key === key && events.length < result.total && (
        <Button
          className="mt-4"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setPagination({ id, offset: events.length })}
        >
          {pending ? "Loading…" : "Earlier activity"}
        </Button>
      )}
    </section>
  );
}
