"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowUpRight, MapPin, ArrowRight, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  compensation,
  date,
  DueLabel,
  humanize,
  kindLabels,
  OrganizationMark,
  StatusBadge,
} from "./collection-display";
import { RecordHistory } from "./record-history";
import type { Entry } from "@/lib/records";

export function RecordDetails({ record }: { record: Entry }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.parentElement?.scrollTo({ top: 0 });
  }, [record.id]);
  return (
    <div ref={rootRef} className="p-6 min-[1500px]:p-7">
      <div className="mb-5 flex items-center justify-between">
        <OrganizationMark name={record.organization} large />
        <StatusBadge status={record.status} />
      </div>
      <h2 className="text-xl leading-7 font-semibold tracking-tight [overflow-wrap:anywhere]">
        {record.title}
      </h2>
      <Link
        href={`/?organizationId=${record.organizationId}`}
        className="mt-2 inline-flex max-w-full items-start gap-1.5 rounded text-sm text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {record.organization}
        </span>
        <ArrowRight className="mt-1 size-3.5 shrink-0" />
      </Link>
      {record.location && (
        <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
          <MapPin className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {record.location}
          </span>
        </p>
      )}
      <Button
        asChild
        variant="outline"
        className="mt-5 w-full justify-between border-primary/25 bg-primary/5 text-xs hover:bg-primary/10"
      >
        <a href={record.url} target="_blank" rel="noopener noreferrer">
          Open listing
          <ArrowUpRight className="size-4" />
        </a>
      </Button>
      {(record.nextAction || record.followUpAt) && (
        <section
          aria-label="Next step"
          className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-3.5"
        >
          <h3 className="mb-2 flex items-center gap-2 text-xs font-medium text-primary">
            <CalendarClock className="size-3.5" />
            Next step
          </h3>
          {record.nextAction && (
            <p className="text-xs leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {record.nextAction}
            </p>
          )}
          {record.followUpAt && (
            <div className="mt-2">
              <DueLabel value={record.followUpAt} label="Follow up" />
            </div>
          )}
        </section>
      )}
      <DetailSection title="Role">
        <DetailField label="Type" value={kindLabels[record.kind]} />
        <DetailField label="Department" value={record.department} />
        <DetailField
          label="Level"
          value={
            record.seniority !== "unspecified" ? humanize(record.seniority) : ""
          }
        />
        <DetailField
          label="Schedule"
          value={
            record.employmentType !== "unspecified"
              ? humanize(record.employmentType)
              : ""
          }
        />
        <DetailField
          label="Arrangement"
          value={
            record.arrangement !== "unspecified"
              ? humanize(record.arrangement)
              : ""
          }
        />
        <DetailField label="Compensation" value={compensation(record)} />
        {record.salary && (
          <DetailField label="Additional details" value={record.compensation} />
        )}
        <DetailField
          label="Visa sponsorship"
          value={
            record.visaSponsorship !== "unknown"
              ? humanize(record.visaSponsorship)
              : ""
          }
        />
        <DetailField
          label="Start"
          value={record.startDate && date(record.startDate)}
        />
      </DetailSection>
      {(record.deadline ||
        record.appliedAt ||
        record.closedReason ||
        record.contact ||
        record.priority !== "normal") && (
        <DetailSection title="Application">
          <DetailField label="Priority" value={humanize(record.priority)} />
          <DetailField
            label="Deadline"
            value={record.deadline && date(record.deadline)}
          />
          <DetailField
            label="Applied"
            value={record.appliedAt && date(record.appliedAt)}
          />
          <DetailField
            label="Outcome"
            value={record.closedReason && humanize(record.closedReason)}
          />
          {record.contact && (
            <div className="flex items-start justify-between gap-5">
              <dt className="shrink-0 text-muted-foreground">Contact</dt>
              <dd className="text-right leading-5 [overflow-wrap:anywhere]">
                {record.contact.email ? (
                  <a
                    className="text-primary hover:underline"
                    href={`mailto:${record.contact.email}`}
                  >
                    {record.contact.name}
                  </a>
                ) : record.contact.url ? (
                  <a
                    className="text-primary hover:underline"
                    href={record.contact.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {record.contact.name}
                    <ArrowUpRight className="ml-1 inline size-3" />
                  </a>
                ) : (
                  record.contact.name
                )}
              </dd>
            </div>
          )}
        </DetailSection>
      )}
      {record.academic &&
        (record.academic.supervisor ||
          record.academic.group ||
          record.academic.funding !== "unknown" ||
          record.academic.durationMonths ||
          record.academic.researchAreas.length > 0) && (
          <DetailSection title="Research">
            <DetailField
              label="Supervisor"
              value={record.academic.supervisor}
            />
            <DetailField label="Group" value={record.academic.group} />
            <DetailField
              label="Funding"
              value={
                record.academic.funding !== "unknown"
                  ? humanize(record.academic.funding)
                  : ""
              }
            />
            <DetailField
              label="Duration"
              value={
                record.academic.durationMonths
                  ? `${record.academic.durationMonths} months`
                  : ""
              }
            />
            <DetailField
              label="Areas"
              value={record.academic.researchAreas.join(", ")}
            />
          </DetailSection>
        )}
      {record.tags.length > 0 && (
        <div className="my-5 flex flex-wrap gap-1.5">
          {record.tags.map((tag) => (
            <Badge
              key={tag}
              className="max-w-full break-all bg-card font-normal text-muted-foreground"
            >
              {tag}
            </Badge>
          ))}
        </div>
      )}
      {record.description && (
        <TextSection title="Overview" text={record.description} />
      )}
      <ListSection title="Requirements" items={record.requirements} />
      <ListSection title="Benefits" items={record.benefits} />
      {record.notes && <TextSection title="Notes" text={record.notes} card />}
      <RecordHistory id={record.id} updatedAt={record.updatedAt} />
      <div className="mt-6 space-y-2 border-t border-border pt-4 text-[11px] text-muted-foreground">
        {record.source && <p>Source · {record.source}</p>}
        {record.postedAt && <p>Posted {date(record.postedAt)}</p>}
        <p>
          Added {date(record.createdAt)} · Updated {date(record.updatedAt)}
        </p>
        <a
          href={record.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex max-w-full items-center gap-1 rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate">{new URL(record.url).hostname}</span>
          <ArrowUpRight className="size-3 shrink-0" />
          <span className="sr-only">, opens in a new tab</span>
        </a>
      </div>
    </div>
  );
}
function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 border-t border-border pt-5">
      <h3 className="mb-4 text-xs font-medium">{title}</h3>
      <dl className="space-y-3 text-xs">{children}</dl>
    </section>
  );
}
function DetailField({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-5">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right leading-5 [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}
function TextSection({
  title,
  text,
  card = false,
}: {
  title: string;
  text: string;
  card?: boolean;
}) {
  return (
    <section className="my-6">
      <h3 className="mb-3 text-xs font-medium">{title}</h3>
      <p
        className={`${card ? "rounded-md border border-border bg-card p-3.5 " : ""}text-xs leading-[1.85] whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]`}
      >
        {text}
      </p>
    </section>
  );
}
function ListSection({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <section className="my-6">
      <h3 className="mb-3 text-xs font-medium">{title}</h3>
      <ul className="list-disc space-y-2 pl-4 text-xs leading-[1.8] text-muted-foreground marker:text-primary/60">
        {items.map((item, index) => (
          <li key={`${index}:${item}`} className="[overflow-wrap:anywhere]">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
