import { z } from "zod";
import { recordSchema, statusSchema } from "./records";

export const eventTypeSchema = z.enum([
  "application.created",
  "application.updated",
  "application.status_changed",
]);
export const applicationEventSchema = z.object({
  id: z.uuid(),
  version: z.literal(1),
  type: eventTypeSchema,
  timestamp: z.iso.datetime(),
  data: z.object({
    record: recordSchema,
    previousStatus: statusSchema.nullable(),
    changedFields: z.array(z.string()),
  }),
});
export const applicationEventPageSchema = z.object({
  events: z.array(applicationEventSchema),
  total: z.number().int().nonnegative(),
});
export type ApplicationEvent = z.infer<typeof applicationEventSchema>;

const subscriptionFields = z
  .object({
    url: z.url({ protocol: /^https?$/ }).max(2048),
    events: z.array(eventTypeSchema).min(1).max(eventTypeSchema.options.length),
    statuses: z.array(statusSchema).max(statusSchema.options.length),
    enabled: z.boolean(),
  })
  .strict();
export const webhookInputSchema = subscriptionFields.extend({
  events: subscriptionFields.shape.events.default(eventTypeSchema.options),
  statuses: subscriptionFields.shape.statuses.default([]),
  enabled: subscriptionFields.shape.enabled.default(true),
});
export const webhookPatchSchema = subscriptionFields
  .partial()
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    "Provide at least one field.",
  );
export const webhookSchema = subscriptionFields.extend({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const webhookCreatedSchema = webhookSchema.extend({
  secret: z.string().length(64),
});
export const webhookListSchema = z.object({
  subscriptions: z.array(webhookSchema),
});
export const webhookHistoryQuerySchema = z.object({
  recordId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export const webhookDeliveryQuerySchema = webhookHistoryQuerySchema
  .omit({ recordId: true })
  .extend({
    subscriptionId: z.uuid().optional(),
  });
export const webhookDeliverySchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  subscriptionId: z.uuid(),
  state: z.enum(["pending", "inflight", "succeeded", "failed"]),
  attempts: z.number().int(),
  nextAttemptAt: z.number(),
  leaseUntil: z.number().nullable(),
  lastStatus: z.number().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});
export const webhookDeliveryPageSchema = z.object({
  deliveries: z.array(webhookDeliverySchema),
});
export const webhookEventPageSchema = applicationEventPageSchema;
