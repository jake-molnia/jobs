import { z } from "zod";

export const statusSchema = z.enum(["saved", "applied", "interview", "closed"]);
export const kindSchema = z.enum(["role", "phd", "research", "other"]);
const dateSchema = z.iso.date();
export const recordInputSchema = z.object({
  title: z.string().trim().min(1).max(240),
  organization: z.string().trim().min(1).max(160),
  url: z.url({ protocol: /^https?$/ }).max(2048),
  status: statusSchema.default("saved"),
  kind: kindSchema.default("role"),
  location: z.string().trim().max(200).default(""),
  arrangement: z.enum(["remote", "hybrid", "onsite", "unspecified"]).default("unspecified"),
  compensation: z.string().trim().max(200).default(""),
  description: z.string().trim().max(20000).default(""),
  notes: z.string().trim().max(20000).default(""),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).transform((tags) => [...new Set(tags)]).default([]),
  deadline: dateSchema.nullable().default(null),
  appliedAt: dateSchema.nullable().default(null),
}).strict();
export const recordPatchSchema = recordInputSchema.partial().extend({
  status: recordInputSchema.shape.status.removeDefault().optional(),
  kind: recordInputSchema.shape.kind.removeDefault().optional(),
  location: recordInputSchema.shape.location.removeDefault().optional(),
  arrangement: recordInputSchema.shape.arrangement.removeDefault().optional(),
  compensation: recordInputSchema.shape.compensation.removeDefault().optional(),
  description: recordInputSchema.shape.description.removeDefault().optional(),
  notes: recordInputSchema.shape.notes.removeDefault().optional(),
  tags: recordInputSchema.shape.tags.removeDefault().optional(),
  deadline: recordInputSchema.shape.deadline.removeDefault().optional(),
  appliedAt: recordInputSchema.shape.appliedAt.removeDefault().optional(),
}).refine((patch) => Object.values(patch).some((value) => value !== undefined), "Provide at least one field.");
export const recordSchema = recordInputSchema.extend({
  id: z.string().uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const listQuerySchema = z.object({
  q: z.string().trim().max(200).default(""),
  status: statusSchema.optional(),
  kind: kindSchema.optional(),
  sort: z.enum(["updated", "deadline", "organization"]).default("updated"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export const recordPageSchema = z.object({
  records: z.array(recordSchema),
  total: z.number().int(),
  counts: z.object({ all: z.number().int(), saved: z.number().int(), applied: z.number().int(), interview: z.number().int(), closed: z.number().int() }),
});
export type Entry = z.infer<typeof recordSchema>;
export type RecordInput = z.infer<typeof recordInputSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
export type RecordPage = z.infer<typeof recordPageSchema>;
export type Status = z.infer<typeof statusSchema>;
