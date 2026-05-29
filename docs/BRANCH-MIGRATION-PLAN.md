# Branch Strategy Migration Plan

## Current State

```
Feature Branches ──► develop ──► Amplify (CUSTOMERS)
                          │
                          └──► production (unused/behind)
```

**Problem**: Every PR merge to `develop` immediately deploys to customers. No QA buffer.

## Target State

```
Feature Branches ──► develop ──► Amplify Staging (QA)
                          │
                          └──► production ──► Amplify Production (CUSTOMERS)
                                    ▲
                                    │
                              Release Workflow
                              (manual trigger)
```

**Benefits**:
- Changes tested on staging before customers see them
- Production is stable and intentional
- Rollback is simple (revert production branch)

---

## Migration Tasks

### Phase 1: Sync Production Branch (30 min)

**Task 1.1**: Ensure production branch has all current code
```bash
git checkout production
git merge develop --no-edit
git push origin production
```

**Task 1.2**: Verify production branch builds successfully
- Run unit tests
- Run e2e tests
- Verify CDK synth works

---

### Phase 2: Update Amplify Configuration (1 hour)

**Task 2.1**: Create Production Amplify Environment
- In AWS Amplify Console:
  - Go to Auto-RFP app
  - Add branch: `production`
  - Environment variables: copy from develop
  - Enable auto-deploy on push

**Task 2.2**: Rename Current Amplify Environment
- Current `develop` deployment becomes "Staging"
- Update environment name in Amplify Console
- Keep auto-deploy enabled for QA testing

**Task 2.3**: Update DNS/Routing (if applicable)
- Point customer-facing domain to `production` Amplify URL
- Point staging subdomain to `develop` Amplify URL

---

### Phase 3: Update GitHub Workflows (30 min)

**Task 3.1**: Update deploy-infrastructure.yml
```yaml
# Change from:
branches: [develop]

# To:
branches: [production]
```

**Task 3.2**: Verify release.yml workflow
- Already configured: develop → production merge
- Add notification on successful release

**Task 3.3**: Update branch protection rules
- `production`: Require PR, no direct push, require CI pass
- `develop`: Require PR, allow squash merge

---

### Phase 4: Team Communication (Ongoing)

**Task 4.1**: Document new workflow
- Feature branches → PR to `develop`
- Test on staging environment
- When ready: Run "Release to Production" workflow
- Verify on production

**Task 4.2**: Update CLAUDE.md
- Document new branching strategy
- Update deployment instructions

---

## Rollout Checklist

### Pre-Migration
- [ ] All PRs to develop are merged or closed
- [ ] Production branch is synced with develop
- [ ] Team notified of migration window

### Migration
- [ ] Production Amplify environment created
- [ ] Production environment tested and accessible
- [ ] DNS pointed to production environment
- [ ] Develop environment renamed to "Staging"
- [ ] GitHub workflows updated
- [ ] Branch protection rules updated

### Post-Migration
- [ ] Test release workflow (develop → production)
- [ ] Verify staging auto-deploys on develop push
- [ ] Verify production auto-deploys on production push
- [ ] Team trained on new workflow
- [ ] CLAUDE.md updated

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Customers experience downtime | Migrate during low-traffic window; keep old deployment until new is verified |
| Production branch missing code | Sync production with develop FIRST |
| Team confusion | Clear communication; update documentation |
| Broken release workflow | Test with dry-run first |

---

## Timeline

| Phase | Duration | Owner |
|-------|----------|-------|
| Phase 1: Sync Production | 30 min | DevOps |
| Phase 2: Amplify Config | 1 hour | DevOps |
| Phase 3: GitHub Workflows | 30 min | DevOps |
| Phase 4: Communication | Ongoing | Team Lead |

**Total Migration Time**: ~2-3 hours (excluding communication)
