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

## Viewer merge and latency follow-up (2026-11-18)

Merged viewer commit `c34d374` into the deployment branch and redeployed it.
The app remained running throughout verification except for the platform deployment restart.

The initial 20 sequential probes all returned `noDecision` at the old four-second deadline.
Client min/median/p95 were 4,462/4,609.5/5,525 ms, which are censored timeout measurements rather than completed inference latencies.
The first concurrent baseline attempt used idle sessions that had expired and was discarded.
All subsequent concurrency probes created five fresh sessions immediately before the simultaneous calls.

After deploying duration-only diagnostics and a 15-second deadline, measured successful calls were:

| Workload | Success | Server min/median/p95 | Client min/median/p95 |
| --- | --- | --- | --- |
| 20 sequential, identical observation | 20/20 | 149 / 161.5 / 719 ms | 615 / 666 / 1,327 ms |
| 5 concurrent, identical observation | 5/5 | 156 / 620 / 692 ms | 669 / 1,154 / 1,205 ms |
| 20 sequential, changing game tick | 20/20 | 147 / 158 / 170 ms | 604 / 647 / 721 ms |
| 5 concurrent, changing game tick | 5/5 | 162 / 183 / 817 ms | 623 / 654 / 1,287 ms |

Percentiles use the nearest-rank method; five concurrent samples provide only a small tail-latency sample.
Each sequential call used the same session and waited 450 ms after the previous response.
Test sessions were deleted after each run.

The first instrumented call spent 222 ms acquiring its OAuth token and 901 ms in the upstream HTTP request, totaling 1,123 ms.
Subsequent calls spent 0 ms on cached token lookup and 0 ms serializing the approximately 931-byte payload.
Successful sequential upstream times then settled near 150-170 ms, and five concurrent requests overlapped successfully.
This rules out a persistent token-fetch, payload-serialization, or application serialization bottleneck in these runs.
Duration logs include request bytes, attempts, token, serialization, upstream, and total time; they omit observations and credentials.

A contemporaneous control using the user OAuth token directly against the workspace also showed slow calls: three tiny WAIT-only calls took 9,574, 9,031, and 3,507 ms, and three full gameplay requests took 9,310, 2,886, and 4,003 ms.
A further tiny control request exceeded its 30-second probe timeout.
The slowdown therefore is not inherent to the app service principal or the full gameplay request size.
The evidence points to variable latency in the upstream AI Decide path; these HTTP measurements cannot separate model/backend queueing from upstream network routing or establish a region-specific cause.
Later live browser gameplay returned real decisions around 139-480 ms server time.
The faster later runs are not evidence that increasing the timeout made inference faster.

The decision deadline is now 15 seconds so observed multi-second upstream spikes can finish instead of being discarded at four seconds.
The separate OAuth acquisition deadline remains four seconds.
Keep `intervalMs` at 400 ms for one to seven sessions, scaling to 667 ms at twelve sessions, with one request in flight per browser and the existing global budget.
No local fallback policy or inference retries were added.

### Deployed Chrome verification

Used chrome-devtools-axi with an isolated Chrome and a workspace OAuth bearer token restricted to the deployed app origin because the default browser could not satisfy Okta's managed-profile requirement.
No credentials were stored in the repository or browser scripts.
Doom rendered with the real WASM engine, live HUD latency and decision counts, and real AI actions.
The 27 MB engine data download completed in about 17.9 seconds in this browser run.
Pause kept completed decision requests fixed at 74 and the game tick fixed at 2,828 over a three-second observation after settling any in-flight request.
Resume restarted gameplay.
At 1x, 2x, 4x, and 8x, approximately 1.5-second samples advanced 53, 105, 212, and 420 ticks respectively.
The selected speed button matched the engine speed.
At 1280 by 900, the 960 by 720 canvas was centered, the controls and HUD were visible, and the document had no overflow.
Screenshots were captured for playing, paused at 8x, and a narrow viewport under the gitignored `.polly/artifacts/` directory.
The app was left deployed; browser gameplay was paused after checking it.

The narrow viewport check found a black canvas when resizing while paused because SDL cleared its drawing buffer and the paused bridge skipped rendering.
The bridge now presents the frozen framebuffer while paused, without running game ticks or sending decisions.
Both production and debug WASM artifacts were rebuilt with the pinned Emscripten 3.1.74 toolchain.
A screenshot-pixel regression test verifies that resizing preserves visible scene pixels and leaves the game tick unchanged.
