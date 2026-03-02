# Claude Code Configuration

This directory contains configuration and rules for [Claude Code](https://claude.ai/code).

## Directory Structure

```
.claude/
├── README.md                    # This file
├── settings.local.json          # Personal settings (gitignored)
└── rules/                       # Project rules (tracked in git)
    ├── 01-project-structure.md
    ├── 02-typescript-best-practices.md
    ├── 03-entity-definitions.md
    ├── 04-backend-architecture.md
    ├── 05-dynamodb-design.md
    ├── 06-frontend-architecture.md
    ├── 07-infrastructure.md
    ├── 08-cicd.md
    ├── 09-testing.md
    ├── RULES.md
    ├── README.md
    ├── cost-optimization.md
    ├── next-js.md
    ├── web-development.md
    └── workflows/
        ├── architecture.md
        └── implementation.md
```

## Rules Directory

The `rules/` directory contains markdown files that Claude Code automatically reads when working on this project. These rules define:

- **Project conventions** and coding standards
- **Architecture patterns** for backend and frontend
- **Database design** patterns
- **Testing requirements**
- **CI/CD workflows**

These files are synced from `.clinerules/` to ensure consistency across different AI coding assistants.

## Settings

- `settings.local.json` - Personal Claude Code settings (gitignored)
- Team-wide settings can be added in a `settings.json` file (would be tracked)

## Syncing Rules

To update Claude Code rules from clinerules:

```bash
cp -r .clinerules/* .claude/rules/
```

## Learn More

- [Claude Code Documentation](https://docs.claude.ai/code)
- [Project Rules in .clinerules/](../.clinerules/README.md)