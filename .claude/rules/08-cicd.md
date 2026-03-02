# CI/CD (GitHub Actions)

> Continuous integration and deployment workflows.

---

## 🚀 Branching Strategy

- `develop` — Development branch (deploys to **dev** environment)
- `main` — Test branch (deploys to **test** environment)
- Feature branches → PR to `develop`
- `develop` → PR to `main` for promotion to test

---

## 🔄 Workflows

Located in `.github/workflows/`:

- **`ci.yml`** — Runs on every push/PR to `develop` and `main`
  - Steps: install → build → test → upload artifacts

- **`deploy-dev.yml`** — Triggered on push to `develop`
  - Builds and deploys all CDK stacks with `-c stage=dev`

- **`deploy-test.yml`** — Triggered on push to `main`
  - Builds and deploys all CDK stacks with `-c stage=test`

---

## 🔐 AWS Authentication

- Uses OIDC (`id-token: write`) with `aws-actions/configure-aws-credentials@v4`.
- Requires `AWS_ROLE_ARN` secret and optional `AWS_REGION` variable per GitHub environment.
- **GitHub Environments**: `dev` and `test` environments should be configured in repo settings with appropriate secrets.

---

## ⚙️ Configuration

- **Concurrency**: CI jobs cancel in-progress runs; deploy jobs do NOT cancel (to avoid partial deployments).
- **Caching**: pnpm store is cached between runs for faster installs.
