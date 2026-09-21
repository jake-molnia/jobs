import { z } from "zod";

export const statusSchema = z.enum([
  "saved",
  "applied",
  "interview",
  "offer",
  "closed",
]);
export const kindSchema = z.enum(["role", "phd", "research", "other"]);
export const httpUrlSchema = z.url({ protocol: /^https?$/ }).max(2048);
const dateSchema = z.iso.date();
const shortText = z.string().trim().max(200);
const tagsSchema = z
  .array(z.string().trim().min(1).max(50))
  .max(20)
  .refine((tags) => new Set(tags).size === tags.length, "Tags must be unique.");
export const salarySchema = z
  .object({
    min: z.number().nonnegative(),
    max: z.number().nonnegative(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, "Use a three-letter currency code, such as GBP."),
    period: z.enum(["hour", "month", "year"]),
  })
  .strict()
  .refine(
    (value) => value.max >= value.min,
    "Maximum compensation must be at least the minimum.",
  );
export const contactSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    email: z.email().max(254).nullable().default(null),
    url: httpUrlSchema.nullable().default(null),
  })
  .strict();
export const academicSchema = z
  .object({
    supervisor: shortText.default(""),
    group: shortText.default(""),
    funding: z
      .enum(["funded", "partial", "unfunded", "unknown"])
      .default("unknown"),
    durationMonths: z.number().int().min(1).max(120).nullable().default(null),
    researchAreas: tagsSchema.default([]),
  })
  .strict();

const recordFields = z
  .object({
    title: z.string().trim().min(1).max(240),
    organization: z.string().trim().min(1).max(160),
    url: httpUrlSchema,
    status: statusSchema,
    kind: kindSchema,
    location: shortText,
    arrangement: z.enum(["remote", "hybrid", "onsite", "unspecified"]),
    compensation: shortText,
    description: z.string().trim().max(20000),
    notes: z.string().trim().max(20000),
    tags: tagsSchema,
    deadline: dateSchema.nullable(),
    appliedAt: dateSchema.nullable(),
    priority: z.enum(["low", "normal", "high"]),
    department: shortText,
    seniority: z.enum([
      "unspecified",
      "intern",
      "junior",
      "mid",
      "senior",
      "lead",
      "principal",
    ]),
    employmentType: z.enum([
      "unspecified",
      "full_time",
      "part_time",
      "contract",
      "internship",
      "fixed_term",
    ]),
    salary: salarySchema.nullable(),
    requirements: z.array(z.string().trim().min(1).max(500)).max(30),
    benefits: z.array(z.string().trim().min(1).max(300)).max(20),
    visaSponsorship: z.enum(["unknown", "available", "unavailable"]),
    contact: contactSchema.nullable(),
    academic: academicSchema.nullable(),
    source: shortText,
    postedAt: dateSchema.nullable(),
    startDate: dateSchema.nullable(),
    followUpAt: dateSchema.nullable(),
    nextAction: z.string().trim().max(1000),
    closedReason: z
      .enum(["accepted", "rejected", "withdrawn", "expired", "not_proceeding"])
      .nullable(),
  })
  .strict();
export const recordInputSchema = recordFields.extend({
  status: recordFields.shape.status.default("saved"),
  kind: recordFields.shape.kind.default("role"),
  location: recordFields.shape.location.default(""),
  arrangement: recordFields.shape.arrangement.default("unspecified"),
  compensation: recordFields.shape.compensation.default(""),
  description: recordFields.shape.description.default(""),
  notes: recordFields.shape.notes.default(""),
  tags: recordFields.shape.tags.default([]),
  deadline: recordFields.shape.deadline.default(null),
  appliedAt: recordFields.shape.appliedAt.default(null),
  priority: recordFields.shape.priority.default("normal"),
  department: recordFields.shape.department.default(""),
  seniority: recordFields.shape.seniority.default("unspecified"),
  employmentType: recordFields.shape.employmentType.default("unspecified"),
  salary: recordFields.shape.salary.default(null),
  requirements: recordFields.shape.requirements.default([]),
  benefits: recordFields.shape.benefits.default([]),
  visaSponsorship: recordFields.shape.visaSponsorship.default("unknown"),
  contact: recordFields.shape.contact.default(null),
  academic: recordFields.shape.academic.default(null),
  source: recordFields.shape.source.default(""),
  postedAt: recordFields.shape.postedAt.default(null),
  startDate: recordFields.shape.startDate.default(null),
  followUpAt: recordFields.shape.followUpAt.default(null),
  nextAction: recordFields.shape.nextAction.default(""),
  closedReason: recordFields.shape.closedReason.default(null),
});
export const recordPatchSchema = recordFields
  .partial()
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    "Provide at least one field.",
  );
export const recordSchema = recordInputSchema.extend({
  id: z.uuid(),
  organizationId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const listQuerySchema = z.object({
  q: z.string().trim().max(200).default(""),
  status: statusSchema.optional(),
  kind: kindSchema.optional(),
  organizationId: z.uuid().optional(),
  priority: recordFields.shape.priority.optional(),
  due: z.enum(["follow_up", "deadline"]).optional(),
  sort: z
    .enum(["updated", "deadline", "organization", "priority", "follow_up"])
    .default("updated"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export const countsSchema = z.object({
  all: z.number().int(),
  saved: z.number().int(),
  applied: z.number().int(),
  interview: z.number().int(),
  offer: z.number().int().default(0),
  closed: z.number().int(),
});
export const recordPageSchema = z.object({
  records: z.array(recordSchema),
  total: z.number().int(),
  counts: countsSchema,
});
export type Entry = z.infer<typeof recordSchema>;
export type RecordInput = z.infer<typeof recordInputSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
export type RecordPage = z.infer<typeof recordPageSchema>;
export type Status = z.infer<typeof statusSchema>;
