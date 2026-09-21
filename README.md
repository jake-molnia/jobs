# Index

A small, read-only dashboard for saved listings and applications. Search and filter records, open their details, and follow the original link in a new tab. The interface has no login and no add or edit forms.

Next.js, React, TypeScript, shadcn/ui, Tailwind, and SQLite. A separate MCP process reads and writes through the HTTP API.

## Run locally

Use Node.js 24 LTS and npm.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. The database is created on first use and starts empty. Set `WRITE_TOKEN` in `.env.local` to enable API writes. Generate a token with `openssl rand -hex 32`.

Optional sample content:

```sh
npm run seed
```

The seed contains fictional listings with example.com URLs. It is only for trying the interface; it does not represent current vacancies. Re-running the seed updates the same examples by URL. Scripts use environment variables from the shell; if you customize `DATABASE_PATH`, pass that same path when running the seed.

## Add and read records

The dashboard and read API are public by design. Anyone who can reach the app can read descriptions and notes. Keep the app on a private network if the collection should be private.

API writes require `Authorization: Bearer <WRITE_TOKEN>`. Writes are disabled if the server has no token configured. Use HTTPS for remote connections.

```sh
# Export the same token configured in the server's .env.local.
export WRITE_TOKEN=your-server-write-token

curl http://localhost:3000/api/records

curl http://localhost:3000/api/records \
  -H "Authorization: Bearer $WRITE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Research engineer","organization":"Example Lab","url":"https://example.com/opening","status":"saved","kind":"research","location":"Remote","tags":["Python","HCI"],"notes":"Read the recent papers."}'
```

| Endpoint                 | Behavior                                                               |
| ------------------------ | ---------------------------------------------------------------------- |
| `GET /api/records`       | List records with `q`, `status`, `kind`, `sort`, `limit`, and `offset` |
| `GET /api/records/:id`   | Read one record                                                        |
| `POST /api/records`      | Create a record or replace the record matching its URL; token required |
| `PATCH /api/records/:id` | Update only supplied fields; token required                            |
| `GET /api/health`        | Database readiness check                                               |

List responses contain `records`, the filtered `total`, and global status `counts`. The default page size is 50, with a maximum of 100. Sort values are `updated`, `deadline`, and `organization`.

Required fields are `title`, `organization`, and an HTTP or HTTPS `url`. Optional fields are `status` (`saved`, `applied`, `interview`, `closed`), `kind` (`role`, `phd`, `research`, `other`), `location`, `arrangement` (`remote`, `hybrid`, `onsite`, `unspecified`), `compensation`, `description`, `notes`, `tags`, `deadline`, and `appliedAt`. Dates use `YYYY-MM-DD`; date fields can be `null`. Descriptions and notes are plain text.

POST is a full upsert: omitted optional fields take their defaults, including when updating an existing URL. Use PATCH for partial updates. Storage assigns UUIDs and UTC creation/update timestamps. Source URLs are the duplicate key. There is no delete endpoint in this scaffold.

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

Set `APPLY_API_URL` to your deployment's HTTPS URL to manage it remotely. The MCP adapter runs locally over stdio and offers `list_records`, `get_record`, `upsert_record`, and `update_record`. Omit the token for read-only access. MCP stdout contains only protocol messages; logs go to stderr.

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

Back up SQLite using its online backup command, for example `sqlite3 /persistent/apply.db ".backup '/backups/apply.db'"`. Copying only the database file while the app is writing can miss data in its WAL. Restore with the app stopped.

## Logs and checks

Pino emits structured JSON logs to stderr. `LOG_LEVEL` defaults to `info`. API logs include request IDs, method, path, response status, and duration. Write events identify the record; tokens, request bodies, search strings, and notes are not logged. Capture stderr in your host's log collector. Monitor `/api/health` for readiness and non-2xx responses for failures.

```sh
npm run check
npm run build
npx playwright install chromium
npm run test:e2e
```

Unit and integration tests use temporary SQLite databases. Browser tests run a separate app on port 3100 with a disposable database under `test-results`. Local database files, tokens, and generated test artifacts are excluded from Git.
