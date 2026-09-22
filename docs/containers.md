# Publish and run container images

The `Publish image` GitHub Actions workflow builds the Dockerfile on Depot's native x86-64 and ARM64 builders, then pushes one multi-platform image to `ghcr.io/jake-molnia/jobs`. Docker selects `linux/amd64` or `linux/arm64` automatically when pulling it. The workflow checks that the published manifest contains both platforms.

The GitHub runner coordinates the build; Depot runs the Dockerfile steps and retains the build cache. This workflow lives in `.github/workflows/publish-image.yml`, separate from the test workflow in `.depot/workflows/check.yml`. Depot CI's GitHub Code Access connection does not configure container-build authentication.

## One-time setup

This repository has a Container Builds project named `apply` in the `jakeshome` organization, project ID `mlg6jv05xx`. `depot.json` selects it for local builds. The GitHub repository variable `DEPOT_PROJECT_ID` and Depot's GitHub trust relationship for `jake-molnia/jobs` are configured. The first GitHub Actions run will verify OIDC authentication. For this repository, continue at step 4 below; steps 1 through 3 are already done.

1. Create or choose a **Container Builds** project in Depot. Copy its project ID.
2. In that project's **Settings → Trust Relationships**, add a GitHub trust relationship with user `jake-molnia` and repository `jobs`. This lets the workflow obtain a temporary Depot token through OIDC.
3. In the GitHub repository's **Settings → Secrets and variables → Actions → Variables**, add `DEPOT_PROJECT_ID` with that ID. You can also run:

   ```sh
   gh variable set DEPOT_PROJECT_ID --repo jake-molnia/jobs --body YOUR_PROJECT_ID
   ```

4. Merge the workflow into `main`. A push to `main` publishes the first image. You can rerun it from **Actions → Publish image → Run workflow**, selecting `main`.

No stored Depot token or registry password is required. The workflow uses `id-token: write` for Depot and the automatic `GITHUB_TOKEN` with `packages: write` for GHCR. If a `jobs` package already exists, grant this repository Actions access in the package settings before publishing.

New GHCR packages default to private. To allow anyone to pull the image without logging in, open the `jobs` package's settings on GitHub and change its visibility to **Public** after the first publish. The source repository can remain private. Keeping the package private requires each consumer to have package access and log in with a personal access token classic with `read:packages`:

```sh
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

See [Depot's GitHub Actions setup](https://depot.dev/docs/container-builds/integrations/github-actions) and [GitHub's container registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

## Tags

| Trigger | Published tags |
| --- | --- |
| Push to `main`, or manual run on `main` | `latest`, `sha-<full-commit-sha>` |
| Push a tag such as `v1.2.3`, or manual run on that tag | `v1.2.3`, `sha-<full-commit-sha>` |

Version tags, including prereleases, do not move `latest`. Pull requests and manual runs on other branches do not publish. The image name follows the GitHub repository name in lowercase; update the Compose default if you fork or rename the repository.

The publishing workflow builds the production app but does not wait for the separate Depot `Check` workflow. Require that check before merging to `main`, and create version tags from verified commits.

The workflow attaches source and revision labels, build provenance, and an SBOM. Its run summary includes the image digest. Use `ghcr.io/jake-molnia/jobs@sha256:...` when a deployment must keep the exact same image across pulls; rerunning a build can update a commit or version tag when base images change.

## Run the published image

After the first publish, use the registry Compose file to pull an image without building locally:

```sh
export WRITE_TOKEN=your-server-write-token
docker compose -f compose.registry.yaml pull
docker compose -f compose.registry.yaml up -d
curl --fail http://localhost:3000/api/health
```

Set `APPLY_IMAGE=ghcr.io/jake-molnia/jobs:v1.2.3` to choose a version, or use an image digest. Repeat `pull` and `up -d` to update. Keep using the same Compose project name and directory when upgrading so Compose reuses the database volume. Both Compose files use `apply-data` mounted at `/app/data`; do not run `docker compose down -v` unless you intend to delete that database.

The container runs as the non-root `node` user on port 3000. `WRITE_TOKEN`, `LOG_LEVEL`, and `WEBHOOK_ALLOWED_ORIGINS` are runtime settings. Keep one app instance per database and put HTTPS in front for remote access. See the README's deployment section for SQLite backup instructions. The image runs the dashboard and HTTP API; the MCP stdio adapter runs separately on the client's machine.

To inspect the available platforms:

```sh
docker buildx imagetools inspect ghcr.io/jake-molnia/jobs:latest
```

For local source builds, the original `docker compose up --build -d` command still works.

To build both architectures from your working tree with Depot and save the result in its private registry:

```sh
depot login
depot build --platform linux/amd64,linux/arm64 --save --save-tag preview .
```

This uses the project in `depot.json`. Publishing to GHCR uses the GitHub Actions workflow described above.
