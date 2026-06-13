# Upgrade guide (v1.x → v2.0)

This guide explains how to migrate from any **v1.x** release to **v2.0**.

## Summary of what changed

v2.0 introduces a new deployment workflow and stricter configuration validation.

- The deploy command changed from `deploy` to `deploy run`.
- Legacy config keys are no longer accepted.
- Runtime now requires Node.js 18+.

## Pre-upgrade checklist

Before upgrading:

1. Confirm your environment is running **Node.js 18 or newer**.
2. Commit or back up your current `config.yml`.
3. Capture current deployment settings for comparison.

## Breaking changes

### 1) Deploy command format changed

- **v1.x**
  ```bash
  mytool deploy --env prod
  ```
- **v2.0**
  ```bash
  mytool deploy run --environment production
  ```

Notes:
- `--env` was replaced by `--environment`.
- Use explicit environment names (for example, `production`, `staging`).

### 2) Configuration schema updated

The old top-level `deploy` key is replaced by `release`.

- **v1.x (`config.yml`)**
  ```yaml
  deploy:
    env: prod
    timeout: 30
  ```

- **v2.0 (`config.yml`)**
  ```yaml
  release:
    environment: production
    timeoutSeconds: 30
  ```

Key migrations:
- `deploy.env` → `release.environment`
- `deploy.timeout` → `release.timeoutSeconds`

### 3) Deprecated behavior removed

- Implicit default environment selection is removed.
- Unknown config keys now fail validation instead of being ignored.

## Step-by-step migration

1. Upgrade the CLI/application to v2.0.
2. Update `config.yml` keys to the new `release.*` schema.
3. Replace all deployment scripts from `deploy` to `deploy run`.
4. Rename `--env` arguments to `--environment`.
5. Run a dry run in staging:
   ```bash
   mytool deploy run --environment staging --dry-run
   ```
6. Deploy to production:
   ```bash
   mytool deploy run --environment production
   ```

## Validation after upgrade

- Run configuration validation and confirm there are no unknown keys.
- Verify the target environment is correct in deployment logs.
- Confirm service health checks pass after deployment.

## Troubleshooting

- **Error: unknown key `deploy`**  
  Update config to use `release`.
- **Error: missing environment**  
  Pass `--environment <name>` explicitly.
- **Command not found for old flags**  
  Replace deprecated v1 flags with v2 equivalents.

## Rollback guidance

If deployment fails, restore the previous version and the backed-up v1 config, then re-run the v1 deployment command. Keep the v2 migration changes in a separate branch until validation completes.
