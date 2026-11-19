# doom-databricks

Doom runs in the browser as a Databricks App and is played only by the `ai_decide` REST endpoint.

Viewers watch.
Keyboard and mouse never drive the game.

## Prerequisites

1. Databricks CLI `>= 0.250.0` and a configured workspace profile.
2. **AI Decide Preview** enabled by a workspace admin.
   Without it, `POST /api/2.0/ai-functions/ai-decide` returns `PERMISSION_DENIED` with text like `AI Decide Preview is not enabled`.
3. Node 22 available for local runs and for the app runtime.

## Cost warning

Every gameplay decision calls `ai_decide` and spends workspace budget.
Paused or hidden tabs stop calling.
Sessions end after 15 minutes or 60 seconds idle.
At most 12 concurrent games per deploy.
Destroy the app when you are done.

## License notice

The game engine is Chocolate Doom (GPL-2.0+).
Game data is Freedoom (BSD-style).
No commercial Doom WAD is included.
GPL source and license files ship in this repo.

## Bundle variables

Default `app_name` is `doom-databricks` (15 chars).
Databricks app names must be 2-30 characters, only lowercase letters, digits, and hyphens, unique in the workspace (see [Databricks Apps](https://docs.databricks.com/aws/en/dev-tools/databricks-apps) / create-app docs).
Do not use underscores.
If that name is taken, pass a different valid `app_name` (for example `doom-databricks-alice`).
Optional `app_users` grants a group `CAN_USE` on the app.
Leave `app_users` empty for deployer-only access.

Pass the same `app_name` / `app_users` on validate, deploy, run, and destroy.
Persist them so destroy targets the same app, for example:

```bash
export BUNDLE_VAR_app_name='doom-databricks-alice'
export BUNDLE_VAR_app_users='my-group'   # optional; omit or leave empty for deployer-only
```

Or keep a gitignored local override (for example `databricks.local.yml` / your team's usual pattern) and load the same values every time.

## Agent deploy (non-interactive)

Use your own CLI profile.
Do not put host, profile, or IDs into `databricks.yml`.

```bash
# Optional overrides (or use BUNDLE_VAR_* as above)
VARS=(--var='app_name=doom-databricks-alice' --var='app_users=my-group')

# 1) Preflight (CLI version, auth, ai_decide enabled)
./scripts/preflight.sh YOUR_PROFILE

# 2) Validate
databricks bundle validate -t dev --profile YOUR_PROFILE "${VARS[@]}"

# 3) Deploy
databricks bundle deploy -t dev --profile YOUR_PROFILE "${VARS[@]}"

# 4) Open / run the app (prints the app URL)
databricks bundle run doom -t dev --profile YOUR_PROFILE "${VARS[@]}"
```

`app.yaml` starts the server with `npm run start`.
The platform installs Node dependencies from `package.json` on deploy (from the server-api work).

## Agent destroy (non-interactive)

Use the same `app_name` / `app_users` (or the same `BUNDLE_VAR_*`) as deploy.

```bash
VARS=(--var='app_name=doom-databricks-alice' --var='app_users=my-group')
databricks bundle destroy -t dev --auto-approve --profile YOUR_PROFILE "${VARS[@]}"
```

Confirm nothing remains:

```bash
databricks apps list --profile YOUR_PROFILE
```

## Local development

```bash
npm install
npm start
```

The server binds `0.0.0.0` on `DATABRICKS_APP_PORT` (fallback `8000`).

## What this bundle deploys

Only one Databricks App (`resources.apps.doom`).
No SQL warehouse.
`bundle destroy` removes the app and leaves no warehouse behind.

## Deployment verification (2026-11-18)

A real workspace deployment reached compute `ACTIVE`, app `RUNNING`, and deployment `SUCCEEDED`.
The 27 MB `public/engine/doom.data` uploaded and was included in the running deployment.
The lockfile uses public npm registry URLs because the original proxy returned HTTP 404 during the Apps dependency install.
Bundle sync excludes tests and engine source archives; `.gitignore` excludes `node_modules` and `.worktrees`.
Engine source remains available in this repository for GPL compliance.

Authenticated requests using a workspace OAuth bearer token produced these single-session measurements:

| Request | Status | Client elapsed | Result |
| --- | --- | --- | --- |
| GET `/healthz` | 200 | 462 ms | Healthy |
| POST `/api/session` | 201 | 485 ms | Session created, interval 400 ms |
| POST `/api/decide`, probe 1 | 200 | 4,465 ms | `noDecision` |
| POST `/api/decide`, probe 2 | 200 | 4,464 ms | `MOVE_FORWARD`, server latency 3,935 ms, hold 300 ms |
| POST `/api/decide`, probe 3 | 200 | 5,144 ms | `noDecision` |
| DELETE test session | 204 | 580 ms | Session released |

The real action confirms the app service principal obtained an `ai-functions` token and called AI Decide successfully without user token forwarding or additional user scopes.
Two of three probes returned `noDecision`, consistent with inference exceeding the existing four-second timeout.
These are smoke-test observations, not sustained throughput measurements or browser gameplay verification.
No cadence constants were changed from this small sample.
The app was left running for inspection; destroy was deliberately skipped.
