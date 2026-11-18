# doom-databricks

Doom runs in the browser as a Databricks App and is played only by the `ai_decide` REST endpoint.

Viewers watch.
Keyboard and mouse never drive the game.

## Prerequisites

1. Databricks CLI `>= 0.250.0` and a configured workspace profile.
2. **AI Decide Preview** enabled by a workspace admin.
   Without it, `POST /api/2.0/ai-functions/ai-decide` returns `PERMISSION_DENIED`.
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

## Agent deploy (non-interactive)

Use your own CLI profile.
Do not put host, profile, or IDs into `databricks.yml`.

```bash
# 0) Optional: name the app and grant a group CAN_USE (DAB level CAN_VIEW)
#    --var="app_name=my-doom" --var="app_users=my-group"

# 1) Preflight (CLI version, auth, ai_decide enabled)
./scripts/preflight.sh YOUR_PROFILE

# 2) Validate
databricks bundle validate -t dev --profile YOUR_PROFILE

# 3) Deploy
databricks bundle deploy -t dev --profile YOUR_PROFILE

# 4) Open / run the app (prints the app URL)
databricks bundle run doom -t dev --profile YOUR_PROFILE
```

`app.yaml` starts the server with `npm run start`.
The platform installs Node dependencies from `package.json` on deploy.

## Agent destroy (non-interactive)

```bash
databricks bundle destroy -t dev --auto-approve --profile YOUR_PROFILE
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
