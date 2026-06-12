---
name: "🚀 Good First Issue"
about: A starter task for new TypeScript / Commander contributors.
title: "[Good First Issue]: "
labels: ["good first issue", "help wanted", "typescript", "vitest"]
assignees: ""
---

## 📝 What needs to be done?
<!-- State the subcommand or flag to be added/fixed via Commander v14.0.3 -->

### 🎯 Expected Behavior
<!-- Define the precise terminal command and the expected stdout/stderr output -->

### 🛠️ Technical Implementation Guide
This project is modular and built on modern tooling:
1. **CLI Layer:** We handle flags using `commander` (v14.0.3) — entry point is in `src/index.ts`.
2. **Business Logic:** Implement your new handler or validation rules inside the respective subcommand file under `src/commands/`.
3. **Tests:** We use `vitest` (v4.1.6) with the native fork pool to separate testing environments cleanly. Tests live in `src/__tests__/`.

### 🧪 Verifying Your Work Locally
1. Clean install your dependencies:
   ```bash
   npm install
   ```
2. Run our strict test runner to ensure code coverage and logic pass perfectly:
   ```bash
   npm test
   ```
   *(Note: This fires up `vitest run --pool=forks` with coverage via `@vitest/coverage-v8`, after automatically rebuilding the TypeScript source.)*

### ⚖️ Open Source & Licensing Safeguard
This project is proudly protected under the **AGPL-3.0 License**. Because it is a standalone CLI execution tool, running, extending, or contributing to this codebase **does not** impact or "infect" your external proprietary or commercial enterprise apps. Your code remains yours, and we promise transparent attribution!
