import { z } from "zod";
import { countsSchema, httpUrlSchema } from "./records";
const fields = z
  .object({
    name: z.string().trim().min(1).max(160),
    kind: z.enum(["company", "university", "institute", "other"]),
    website: httpUrlSchema.nullable(),
    careersUrl: httpUrlSchema.nullable(),
    location: z.string().trim().max(200),
    description: z.string().trim().max(5000),
  })
  .strict();
export const organizationInputSchema = fields.extend({
  kind: fields.shape.kind.default("company"),
  website: fields.shape.website.default(null),
  careersUrl: fields.shape.careersUrl.default(null),
  location: fields.shape.location.default(""),
  description: fields.shape.description.default(""),
});
export const organizationPatchSchema = fields
  .partial()
  .refine(
    (value) => Object.values(value).some((item) => item !== undefined),
    "Provide at least one field.",
  );
export const organizationSchema = organizationInputSchema.extend({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  counts: countsSchema,
});
export const organizationQuerySchema = z.object({
  q: z.string().trim().max(200).default(""),
  sort: z.enum(["name", "records"]).default("name"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export const organizationPageSchema = z.object({
  organizations: z.array(organizationSchema),
  total: z.number().int(),
});
export type Organization = z.infer<typeof organizationSchema>;
export type OrganizationInput = z.infer<typeof organizationInputSchema>;
export type OrganizationQuery = z.infer<typeof organizationQuerySchema>;
