"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, MapPin } from "lucide-react";
import { organizationSchema, type Organization } from "@/lib/organizations";
import { OrganizationMark, humanize } from "./collection-display";
import { Button } from "./ui/button";

export function OrganizationProfile({
  id,
  refresh,
}: {
  id: string;
  refresh: number;
}) {
  const [result, setResult] = useState<{
    id: string;
    organization: Organization;
  } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const organization = result?.id === id ? result.organization : null;
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/organizations/${id}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Could not load organization.");
        const data: unknown = await response.json();
        const parsed = organizationSchema.parse(data);
        if (!controller.signal.aborted) {
          setResult({ id, organization: parsed });
          setFailure(null);
        }
      } catch {
        if (!controller.signal.aborted) setFailure(id);
      }
    })();
    return () => controller.abort();
  }, [id, refresh]);
  return (
    <section
      aria-label="Organization profile"
      className="max-h-[35dvh] shrink-0 overflow-y-auto border-b border-border bg-card/35 px-5 py-5 md:px-7"
    >
      <Link
        href="/organizations"
        className="mb-4 inline-flex items-center gap-1.5 rounded text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-3" />
        Organizations
      </Link>
      {organization ? (
        <>
          <div className="flex items-start gap-3">
            <OrganizationMark name={organization.name} large />
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold tracking-tight [overflow-wrap:anywhere]">
                {organization.name}
              </h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{humanize(organization.kind)}</span>
                {organization.location && (
                  <span className="inline-flex min-w-0 max-w-full items-start gap-1">
                    <MapPin className="mt-0.5 size-3 shrink-0" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      {organization.location}
                    </span>
                  </span>
                )}
              </p>
            </div>
          </div>
          {organization.description && (
            <p className="mt-3 max-w-3xl text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
              {organization.description}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {organization.website && (
              <Button asChild variant="outline" size="sm">
                <a
                  href={organization.website}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Website
                  <ArrowUpRight />
                </a>
              </Button>
            )}
            {organization.careersUrl && (
              <Button asChild variant="outline" size="sm">
                <a
                  href={organization.careersUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Openings
                  <ArrowUpRight />
                </a>
              </Button>
            )}
            <span className="ml-auto text-[11px] text-muted-foreground">
              {organization.counts.all}{" "}
              {organization.counts.all === 1 ? "item" : "items"} ·{" "}
              {organization.counts.applied +
                organization.counts.interview +
                organization.counts.offer}{" "}
              active
            </span>
          </div>
        </>
      ) : (
        <p
          className="text-sm text-muted-foreground"
          role={failure === id ? "alert" : "status"}
        >
          {failure === id
            ? "Organization could not be loaded. Refresh to try again."
            : "Loading organization…"}
        </p>
      )}
    </section>
  );
}
