# Index

A small, read-only dashboard for saved listings and applications. Search the collection, browse organizations, inspect a record, and open its source in a new tab. The interface has no login or editing forms.

Next.js, React, TypeScript, shadcn/ui, Tailwind, and SQLite. A separate MCP process reads and writes through the HTTP API. Outgoing webhooks let other apps react to application changes.

## Run locally

Use Node.js 24 LTS and npm.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. The database is created on first use and starts empty. Set `WRITE_TOKEN` in `.env.local` to enable API writes and webhook management. Generate a token with `openssl rand -hex 32`.

Optional sample content:

```sh
npm run seed
```

The seed contains 14 fictional listings with example.com URLs, organization profiles, and example metadata. Re-running it replaces those examples by URL and profiles by name. Scripts use environment variables from the shell; pass the same `DATABASE_PATH` when using a custom database path.

Existing databases migrate automatically on startup. Existing records receive organization IDs and defaults for the new optional fields. Migration does not send historical application webhooks.

## Add and read records

The dashboard and read API are public by design. Anyone who can reach the app can read descriptions, notes, contacts, and application history. Keep the app on a private network if the collection should be private.

API writes and webhook management require `Authorization: Bearer <WRITE_TOKEN>`. These operations are disabled if the server has no token configured. Use HTTPS for remote connections.

```sh
# Export the same token configured in the server's .env.local.
export WRITE_TOKEN=your-server-write-token

curl http://localhost:3000/api/records

curl http://localhost:3000/api/records \
  -H "Authorization: Bearer $WRITE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Research engineer","organization":"Example Lab","url":"https://example.com/opening","status":"saved","kind":"research","priority":"high","location":"Remote","tags":["Python","HCI"],"nextAction":"Read the recent papers.","followUpAt":"2026-10-01"}'
```

| Endpoint                       | Behavior                                                       |
| ------------------------------ | -------------------------------------------------------------- |
| `GET /api/records`             | Search, filter, sort, and page through records                 |
| `GET /api/records/:id`         | Read one record                                                |
| `POST /api/records`            | Create or replace the record matching its URL; token required  |
| `PATCH /api/records/:id`       | Update only supplied fields; token required                    |
| `GET /api/records/:id/events`  | Read a record's application history                            |
| `GET /api/organizations`       | Search the organization directory and read record counts       |
| `GET /api/organizations/:id`   | Read an organization profile and counts                        |
| `POST /api/organizations`      | Create or replace a profile by normalized name; token required |
| `PATCH /api/organizations/:id` | Update supplied profile fields; token required                 |
| `GET /api/health`              | Database readiness check                                       |

Record list responses contain `records`, the filtered `total`, and global status `counts`. The default page size is 50, with a maximum of 100. All lists use `limit` and `offset`.

| Record query     | Values                                                                                |
| ---------------- | ------------------------------------------------------------------------------------- |
| `q`              | Text search across the record's content                                               |
| `status`         | `saved`, `applied`, `interview`, `offer`, `closed`                                    |
| `kind`           | `role`, `phd`, `research`, `other`                                                    |
| `organizationId` | Stable organization UUID                                                              |
| `priority`       | `low`, `normal`, `high`                                                               |
| `due`            | `follow_up` or `deadline`; includes dates on or before today, excludes closed records |
| `sort`           | `updated`, `deadline`, `organization`, `priority`, `follow_up`                        |

POST is a full upsert. Omitted optional fields take their defaults, including when replacing an existing URL. Use PATCH for partial updates. Nested `salary`, `contact`, and `academic` objects are replaced as whole objects when supplied. Source URLs are the duplicate key. There is no record or organization delete endpoint.

See [the data reference](docs/data.md) for every metadata field and examples.

## Organization directory

Organizations have a stable UUID, a name, a kind, a website, a careers URL, a location, and a description. A record's `organization` name automatically finds or creates its directory entry; name matching ignores casing and repeated whitespace. `organizationId` is derived by the server and cannot be supplied as a record input field.

Organization responses include per-status `counts`. Use `GET /api/organizations?q=example&sort=records` to find profiles, then `GET /api/records?organizationId=<id>` to retrieve all their records. The directory supports `sort=name` or `sort=records`. Profiles can exist before any records are added.

Renaming a profile updates the displayed name on all its records while preserving its ID. A conflicting existing normalized name is rejected. Renaming a profile does not emit application events.

## Connect MCP

Start the dashboard first. Add this server to your MCP client's configuration, replacing the project path and token:

```json
{
  "mcpServers": {
    "index": {
      "command": "/absolute/path/to/apply/node_modules/.bin/tsx",
      "args": ["/absolute/path/to/apply/scripts/mcp.ts"],
      "env": {
        "APPLY_API_URL": "http://localhost:3000",
        "WRITE_TOKEN": "your-server-write-token"
      }
    }
  }
}
```

Set `APPLY_API_URL` to the deployment's HTTPS URL to manage it remotely. The adapter runs locally over stdio. MCP stdout contains only protocol messages; logs go to stderr.

| Tools                                               | Use                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| `list_records`, `get_record`                        | Search by organization, status, priority, or due date; read full metadata |
| `upsert_record`, `update_record`                    | Create or replace by URL; patch selected fields                           |
| `list_organizations`, `get_organization`            | Browse profiles and counts                                                |
| `upsert_organization`, `update_organization`        | Maintain organization profiles                                            |
| `list_webhooks`, `create_webhook`, `update_webhook` | Manage outgoing subscriptions; token required for reads and writes        |
| `list_record_events`, `list_webhook_deliveries`     | Inspect application changes and delivery outcomes; token required         |

Omit the token for public record and organization reads. The dashboard owns destination allowlisting; the MCP adapter does not need the server's webhook configuration.

## Webhooks

Register an HTTPS endpoint, choose event types and optional resulting statuses, and other apps receive signed JSON whenever a matching record changes. Set `WEBHOOK_ALLOWED_ORIGINS` on the dashboard before registering a destination. Subscription management is available through the API and MCP.

See [webhook setup and verification](docs/webhooks.md) for registration, signatures, filtering, delivery attempts, and a receiver example.

## Deploy

Run a single app instance on a host with a persistent disk. SQLite should live on a local persistent volume, not an ephemeral serverless filesystem or shared network filesystem.

```sh
npm ci
npm run build
DATABASE_PATH=/persistent/apply.db WRITE_TOKEN=your-token npm start
```

Or build the included container:

```sh
WRITE_TOKEN=your-token docker compose up --build -d
```

Compose persists the database in the `apply-data` volume. Place a reverse proxy with HTTPS in front for remote access. The container runs as the non-root `node` user and checks `/api/health`. No hosting service is provisioned by this repository.

Back up SQLite using its online backup command, for example `sqlite3 /persistent/apply.db ".backup '/backups/apply.db'"`. Copying only the database file while the app is writing can miss data in its WAL. Restore with the app stopped. The database contains webhook signing secrets as well as the collection; protect its file and backups.

## Logs and checks

Pino emits structured JSON logs to stderr. `LOG_LEVEL` defaults to `info`. API logs include request IDs, method, path, response status, and duration. Record changes identify the record; delivery logs identify subscriptions, events, attempts, and outcomes. Tokens, webhook secrets, destination URLs, request bodies, search strings, and notes are not logged. Capture stderr in the host's log collector. Monitor `/api/health`, failed API requests, and webhook deliveries that reach `failed`.

```sh
npm run check
npm run build
npx playwright install chromium
npm run test:e2e
```

Unit and integration tests use temporary SQLite databases. Browser tests run a separate app on port 3100 with a disposable database under `test-results`. Local database files, tokens, and generated test artifacts are excluded from Git.

## Continuous integration

The GitHub Actions `Check` workflow uses the `depot-ubuntu-24.04` runner. It runs lint, type checking, unit/integration tests, the production build, and Chromium browser tests.

Depot managed GitHub Actions runners require an organization-owned repository. Connect that GitHub organization through the Depot dashboard and grant the Depot GitHub App access to this repository before enabling the workflow. For public repositories, also allow public repositories in the organization’s runner group. See the [Depot runner setup guide](https://depot.dev/docs/github-actions/quickstart).
