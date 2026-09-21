# Data reference

Record inputs require `title`, `organization`, and an HTTP or HTTPS `url`. All other fields have defaults. The API rejects unknown fields and invalid enum values. Descriptions, notes, and list items are plain text.

| Field             | Type and default         | Purpose                                                                         |
| ----------------- | ------------------------ | ------------------------------------------------------------------------------- |
| `title`           | Text, required           | Listing title, up to 240 characters                                             |
| `organization`    | Text, required           | Organization name, up to 160 characters; resolves to a directory profile        |
| `url`             | HTTP/HTTPS URL, required | Original listing and upsert key                                                 |
| `status`          | `saved` by default       | `saved`, `applied`, `interview`, `offer`, `closed`                              |
| `kind`            | `role` by default        | `role`, `phd`, `research`, `other`                                              |
| `priority`        | `normal` by default      | `low`, `normal`, `high`                                                         |
| `location`        | Text, empty              | Location or eligible region                                                     |
| `arrangement`     | `unspecified` by default | `remote`, `hybrid`, `onsite`, `unspecified`                                     |
| `department`      | Text, empty              | Team, department, or lab                                                        |
| `seniority`       | `unspecified` by default | `unspecified`, `intern`, `junior`, `mid`, `senior`, `lead`, `principal`         |
| `employmentType`  | `unspecified` by default | `unspecified`, `full_time`, `part_time`, `contract`, `internship`, `fixed_term` |
| `compensation`    | Text, empty              | Freeform compensation or funding summary                                        |
| `salary`          | Object or `null`         | Structured compensation; see below                                              |
| `description`     | Text, empty              | Listing details, up to 20,000 characters                                        |
| `notes`           | Text, empty              | Personal context, up to 20,000 characters                                       |
| `tags`            | Unique text array, `[]`  | Up to 20 tags, each up to 50 characters                                         |
| `requirements`    | Text array, `[]`         | Up to 30 requirements, each up to 500 characters                                |
| `benefits`        | Text array, `[]`         | Up to 20 benefits, each up to 300 characters                                    |
| `visaSponsorship` | `unknown` by default     | `unknown`, `available`, `unavailable`                                           |
| `contact`         | Object or `null`         | Named contact; see below                                                        |
| `academic`        | Object or `null`         | Academic details; see below                                                     |
| `source`          | Text, empty              | Where the listing came from                                                     |
| `postedAt`        | Date or `null`           | Listing publication date                                                        |
| `deadline`        | Date or `null`           | Application deadline                                                            |
| `appliedAt`       | Date or `null`           | Date submitted                                                                  |
| `startDate`       | Date or `null`           | Expected start date                                                             |
| `followUpAt`      | Date or `null`           | Next follow-up date                                                             |
| `nextAction`      | Text, empty              | Next step, up to 1,000 characters                                               |
| `closedReason`    | Enum or `null`           | `accepted`, `rejected`, `withdrawn`, `expired`, `not_proceeding`                |

Short text fields allow up to 200 characters unless specified otherwise. Dates use `YYYY-MM-DD`; `null` clears a date. The database assigns `id`, `organizationId`, `createdAt`, and `updatedAt`. Timestamps use ISO 8601 UTC.

A `salary` object requires nonnegative `min` and `max`, a three-letter uppercase `currency`, and `period` as `hour`, `month`, or `year`. `max` must be at least `min`. Keep `compensation` for details such as equity, funding terms, or negotiation context.

A `contact` object requires `name`; `email` and HTTP/HTTPS `url` default to `null`. Academic details accept `supervisor` and `group` as text, `funding` as `funded`, `partial`, `unfunded`, or `unknown`, `durationMonths` as an integer from 1 to 120 or `null`, and `researchAreas` as a unique text array. Academic fields have empty or unknown defaults.

```json
{
  "title": "PhD in interactive systems",
  "organization": "Example University",
  "url": "https://example.com/positions/interactive-systems",
  "kind": "phd",
  "status": "saved",
  "priority": "high",
  "employmentType": "fixed_term",
  "department": "Computer science",
  "academic": {
    "supervisor": "Dr. Example",
    "group": "Interaction group",
    "funding": "funded",
    "durationMonths": 36,
    "researchAreas": ["Human-AI collaboration", "HCI"]
  },
  "salary": { "min": 32000, "max": 36000, "currency": "EUR", "period": "year" },
  "contact": { "name": "Dr. Example", "email": "supervisor@example.com" },
  "requirements": ["Research proposal", "Two academic references"],
  "deadline": "2026-11-01",
  "followUpAt": "2026-10-01",
  "nextAction": "Send a proposal outline to the supervisor."
}
```

PATCH changes only supplied top-level fields. It replaces supplied nested objects and arrays in full, so send the complete desired `salary`, `contact`, or `academic` object. Use `null` to clear any of those objects. An empty patch is rejected. For example, `{"status":"applied","appliedAt":"2026-09-21"}` preserves all other metadata.

## Organization profiles

| Field         | Type and default                                                    |
| ------------- | ------------------------------------------------------------------- |
| `name`        | Required text, up to 160 characters                                 |
| `kind`        | `company`, `university`, `institute`, or `other`; default `company` |
| `website`     | HTTP/HTTPS URL or `null`                                            |
| `careersUrl`  | HTTP/HTTPS URL or `null`                                            |
| `location`    | Text, up to 200 characters; empty by default                        |
| `description` | Text, up to 5,000 characters; empty by default                      |

Responses add `id`, `createdAt`, `updatedAt`, and `counts`. Counts contain `all`, `saved`, `applied`, `interview`, `offer`, and `closed`. The directory list returns `{ "organizations": [...], "total": 0 }`. An organization can have zero records.

Profiles automatically created from a record name use kind `other` until you classify them. Creating a profile explicitly through the organization API defaults to `company`.
