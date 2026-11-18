# Agent instructions for doom-databricks

This file is for coding agents that deploy or destroy this project unattended.

## Hard rules

- Do not hard-code workspace host, CLI profile, warehouse IDs, or app IDs into bundle files.
- Do not create a SQL warehouse.
- Do not forward keyboard or mouse into the game.
- Do not deploy a commercial Doom WAD.
- Chocolate Doom is GPL-2.0+; Freedoom is BSD-style; keep license files intact.
- Prefer non-interactive CLI flags (`--auto-approve`, `--profile`).

## Prerequisite: AI Decide Preview

A workspace admin must enable **AI Decide Preview**.
If the REST call fails with text like `AI Decide Preview is not enabled`, stop and tell the user the preview is not enabled.
Other `PERMISSION_DENIED` responses are different grant problems; report them as such.
Do not invent a local gameplay policy to work around a missing preview.

## Cost warning

Each decision calls `ai_decide` and costs money.
Keep sessions short, pause when idle, and destroy the app when finished.

## Bundle variables (keep deploy and destroy aligned)

Default `app_name` is `doom-databricks-${workspace.current_user.short_name}`.
Optional `app_users` is the account group granted `CAN_USE` on the app (resource-level permission; leave empty for deployer-only).

Pass the same values on validate, deploy, run, and destroy.
Persist them so destroy uses the same app name, for example:

```bash
export BUNDLE_VAR_app_name='doom-databricks-alice'
export BUNDLE_VAR_app_users='SOME_GROUP'   # optional
```

Or use a gitignored local override that your session reloads every time.
Do not set `app_name` only on deploy and then destroy with defaults.

## Exact deploy steps

Replace `YOUR_PROFILE` with the deployer's Databricks CLI profile name.

```bash
VARS=(--var='app_name=doom-databricks-alice' --var='app_users=SOME_GROUP')

./scripts/preflight.sh YOUR_PROFILE
databricks bundle validate -t dev --profile YOUR_PROFILE "${VARS[@]}"
databricks bundle deploy -t dev --profile YOUR_PROFILE "${VARS[@]}"
databricks bundle run doom -t dev --profile YOUR_PROFILE "${VARS[@]}"
```

If you rely on defaults / `BUNDLE_VAR_*` instead, omit `"${VARS[@]}"` but keep the same persisted values for destroy.

`app_users` is optional.
Leave it empty for deployer-only access.
When set, the group receives resource-level `CAN_USE`.

`app.yaml` runs `npm run start`.
That script and `package.json` come from the server-api work (PR #1).
Do not change the start command unless that script changes.

## Exact destroy steps

```bash
VARS=(--var='app_name=doom-databricks-alice' --var='app_users=SOME_GROUP')
databricks bundle destroy -t dev --auto-approve --profile YOUR_PROFILE "${VARS[@]}"
databricks apps list --profile YOUR_PROFILE
```

Destroy must leave no app and no warehouse from this project.

## Preflight behavior

`./scripts/preflight.sh [profile]` checks:

1. Databricks CLI version `>= 0.250.0`
2. Auth for the given profile
3. That `ai_decide` REST works

If the error text includes `AI Decide Preview is not enabled`, print that the preview is disabled and exit non-zero.
Other `PERMISSION_DENIED` results get a different message about caller grants.

## Scope reminders

- Bundle resource: app only (`source_code_path: .`)
- Decision path: `POST /api/2.0/ai-functions/ai-decide`
- Max concurrent games: 12
- Speeds: 1x, 2x, 4x, 8x
