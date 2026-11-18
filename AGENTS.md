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
If `POST /api/2.0/ai-functions/ai-decide` returns `PERMISSION_DENIED`, stop and tell the user the preview is not enabled.
Do not invent a local gameplay policy to work around a missing preview.

## Cost warning

Each decision calls `ai_decide` and costs money.
Keep sessions short, pause when idle, and destroy the app when finished.

## Exact deploy steps

Replace `YOUR_PROFILE` with the deployer's Databricks CLI profile name.

```bash
./scripts/preflight.sh YOUR_PROFILE
databricks bundle validate -t dev --profile YOUR_PROFILE
databricks bundle deploy -t dev --profile YOUR_PROFILE
databricks bundle run doom -t dev --profile YOUR_PROFILE
```

Optional variables:

```bash
databricks bundle deploy -t dev --profile YOUR_PROFILE \
  --var="app_name=doom-databricks" \
  --var="app_users=SOME_GROUP"
```

`app_users` is optional.
Leave it empty for deployer-only access.
When set, the group receives CAN_USE (bundle permission level `CAN_VIEW`).

`app.yaml` runs `npm run start`.
Do not change that command unless the Node start script changes.

## Exact destroy steps

```bash
databricks bundle destroy -t dev --auto-approve --profile YOUR_PROFILE
databricks apps list --profile YOUR_PROFILE
```

Destroy must leave no app and no warehouse from this project.

## Preflight behavior

`./scripts/preflight.sh [profile]` checks:

1. Databricks CLI version `>= 0.250.0`
2. Auth for the given profile
3. That `ai_decide` REST works

A `PERMISSION_DENIED` from the REST call means the AI Decide preview is not enabled.
Print that clearly and exit non-zero.

## Scope reminders

- Bundle resource: app only (`source_code_path: .`)
- Decision path: `POST /api/2.0/ai-functions/ai-decide`
- Max concurrent games: 12
- Speeds: 1x, 2x, 4x, 8x
