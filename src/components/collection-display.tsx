import { Circle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Entry, Status } from "@/lib/records";

export const statusLabels: Record<Status, string> = {
  saved: "Saved",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  closed: "Closed",
};
export const kindLabels: Record<Entry["kind"], string> = {
  role: "Role",
  phd: "PhD",
  research: "Research",
  other: "Other",
};
const statusStyles: Record<Status, string> = {
  saved: "text-muted-foreground bg-accent/30",
  applied: "text-[#acc7df] border-[#394957] bg-[#24313b]/40",
  interview: "text-[#ddc998] border-[#504934] bg-[#393427]/40",
  offer: "text-[#b7d7bb] border-[#385440] bg-[#263c2c]/40",
  closed: "text-muted-foreground bg-accent/40",
};
export function initials(value: string) {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();
}
export function OrganizationMark({
  name,
  large = false,
}: {
  name: string;
  large?: boolean;
}) {
  const tone =
    [...name].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 4;
  const tones = [
    "text-[#b6c9b7] bg-[#26312b] border-[#3a493e]",
    "text-[#b6c5d6] bg-[#272e36] border-[#394451]",
    "text-[#c6bbd6] bg-[#2d2934] border-[#443b50]",
    "text-[#d0c3a8] bg-[#322e25] border-[#4c4436]",
  ];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg border text-xs font-medium tracking-wide",
        large ? "size-12 text-sm" : "size-9",
        tones[tone],
      )}
    >
      {initials(name)}
    </span>
  );
}
export function date(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}
export function humanize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
}
export function compensation(record: Entry) {
  if (!record.salary) return record.compensation;
  const { min, max, currency, period } = record.salary;
  const number = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
  return `${currency} ${number.format(min)}${max !== min ? ` – ${number.format(max)}` : ""} / ${period}`;
}
export function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge className={cn("gap-1.5 font-normal", statusStyles[status])}>
      <Circle className="size-1.5 fill-current" />
      {statusLabels[status]}
    </Badge>
  );
}
export function DueLabel({ value, label }: { value: string; label: string }) {
  const days = Math.round(
    (new Date(`${value}T00:00:00Z`).getTime() -
      Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) /
      86400000,
  );
  const relative =
    days < 0
      ? `${Math.abs(days)}d overdue`
      : days === 0
        ? "Today"
        : days === 1
          ? "Tomorrow"
          : date(value);
  return (
    <span
      title={`${label}: ${date(value)}`}
      className={cn(
        "text-[11px]",
        days < 0
          ? "text-[#dfab9f]"
          : days <= 7
            ? "text-[#d9c797]"
            : "text-muted-foreground",
      )}
      suppressHydrationWarning
    >
      {label} · {relative}
    </span>
  );
}
