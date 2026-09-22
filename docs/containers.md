# Publish and run container images

The `Publish image` Depot CI workflow builds the Dockerfile on Depot's native x86-64 and ARM64 builders, then pushes one multi-platform image to `ghcr.io/jake-molnia/jobs`. Docker selects `linux/amd64` or `linux/arm64` automatically when pulling it. The workflow checks that the published manifest contains both platforms.

Depot CI runs `.depot/workflows/publish-image.yml`, alongside the test workflow. Depot's builders run the Dockerfile steps and retain the build cache. Publishing does not use a GitHub-hosted runner, so a GitHub Actions billing block cannot prevent the job from starting.

## One-time setup

This repository uses the `apply` Container Builds project in the `jakeshome` organization, project ID `mlg6jv05xx`. `depot.json` selects it for local builds, and the repository-scoped Depot CI variable `DEPOT_PROJECT_ID` is configured. Depot CI supplies authentication for builds in this organization automatically.

GHCR requires a separate credential when publishing from Depot CI. Its automatic `GITHUB_TOKEN` is a GitHub App token, which GitHub Packages does not accept. The GitHub OIDC trust relationship configured earlier applies to GitHub Actions and does not replace registry authentication.

1. Create a GitHub **personal access token classic** with `write:packages` for `jake-molnia`. Use [GitHub's token form with the package scope selected](https://github.com/settings/tokens/new?scopes=write:packages). Give it an expiry and rotate the Depot secret before it expires.
2. In [Depot CI settings](https://depot.dev/orgs/fhb0b1rbvv/workflows/settings), create a secret named `GHCR_TOKEN` and limit its availability to repository `jake-molnia/jobs` and workflow `.depot/workflows/publish-image.yml`. Store the token there, not in Git or chat. Alternatively, enter it at the CLI's secret prompt:

   ```sh
   depot ci secrets add GHCR_TOKEN --repo jake-molnia/jobs --workflow .depot/workflows/publish-image.yml
   ```

3. Merge the workflow into `main`. A push to `main` publishes the first image. To test the prepared workflow from your working tree, run:

   ```sh
   depot ci run --workflow .depot/workflows/publish-image.yml
   ```

For a fork or different project, also set `DEPOT_PROJECT_ID` in **Depot CI**, not GitHub Actions:

```sh
depot ci vars add DEPOT_PROJECT_ID --repo YOUR_OWNER/YOUR_REPO --value YOUR_PROJECT_ID
```

If a `jobs` package already exists, ensure the token's owner has write access to it. The workflow checks for the project variable and registry secret before building and reports a setup error if either is missing.

New GHCR packages default to private. To allow anyone to pull the image without logging in, open the `jobs` package's settings on GitHub and change its visibility to **Public** after the first publish. The source repository can remain private. Keeping the package private requires each consumer to have package access and log in with a personal access token classic with `read:packages`:

```sh
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

See [Depot CI's GitHub Packages authentication requirements](https://depot.dev/docs/ci/compatibility#github-packages-authentication) and [GitHub's container registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

## Tags

| Trigger | Published tags |
| --- | --- |
| Push to `main`, or manual run on `main` | `latest`, `sha-<full-commit-sha>` |
| Push a tag such as `v1.2.3`, or manual run on that tag | `v1.2.3`, `sha-<full-commit-sha>` |
| Manual run on another branch | `sha-<full-commit-sha>` |

Version tags, including prereleases, do not move `latest`. Pull requests do not publish. Manual runs on other branches publish only a commit tag, allowing verification before merge without moving `latest`. The image name follows the GitHub repository name in lowercase; update the Compose default if you fork or rename the repository.

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

This uses the project in `depot.json`. Publishing to GHCR uses the Depot CI workflow described above.
