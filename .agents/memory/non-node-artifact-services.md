---
name: Non-Node artifact services
description: How to run a Python (or other non-Node) backend as an artifact service via artifact.toml, and the working-directory gotcha that breaks a naive port.
---

An artifact's `[services.development].run` and `[services.production.run]` commands already execute with **the artifact's own directory as cwd** (e.g. `artifacts/api-server/`), not the workspace root. Porting a reference repo's run command that does `cd artifacts/api-server && python3 server.py` fails with `can't cd to artifacts/api-server` — strip the leading `cd` and just run `python3 server.py`.

To swap a scaffolded Node/Express artifact service for a Python backend:
1. Install the language + packages via `installProgrammingLanguage`/`installLanguagePackages` (packages land in the workspace-root `.pythonlibs`, shared by all artifacts — no per-artifact venv needed).
2. Edit `artifact.toml` via `verifyAndReplaceArtifactToml` (never hand-edit): set `run = "python3 server.py"` for dev, and `[services.production.run] args = ["python3", "server.py"]` for prod.
3. Strip the artifact's `package.json` down to `{name, version, private}` (no scripts/deps) — it only needs to exist for pnpm workspace discovery; delete the old TS `src/`, build scripts, and `node_modules`.
4. No OpenAPI/codegen applies to a Python backend — the frontend must call REST endpoints directly with `fetch`/TanStack Query using `import.meta.env.BASE_URL` as the path prefix, not the generated `@workspace/api-client-react` hooks.
