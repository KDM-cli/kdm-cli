# Coding Style & CodeScene Compliance Guide

This guide establishes the mandatory coding style rules for this repository to ensure that all future code modifications automatically pass CodeScene quality gates. Any AI agent or developer modifying the codebase MUST strictly follow these rules.

---

## 🚀 Core Health Metrics Thresholds

We enforce the **Bare Minimum** quality gate profile on PR delta analysis:

| Code biomarker | Rule threshold | Target score |
| :--- | :--- | :--- |
| **Cyclomatic Complexity** | Strictly `< 9` per function | `10.00 / 10.00` |
| **Nesting Depth** | Strictly `< 4` levels of indentation | `10.00 / 10.00` |
| **Bumpy Road Ahead** | Max `1` nested conditional block per function | `10.00 / 10.00` |
| **Docstring Coverage** | Strictly `> 80%` of functions & modules documented | Green check |
| **Mean Module Complexity** | Strictly `< 4.0` average cyclomatic complexity per module | Green check |
| **String-Heavy Arguments** | Strictly `< 39%` of all arguments across a module's functions may be strings | Green check |

---

## 🛠️ Rules & Refactoring Patterns

### 1. Cyclomatic Complexity Control
If a function has multiple branches (`if`, `else if`, `for`, `flatMap`, `switch`, or ternaries), its complexity climbs rapidly.
* **Rule**: Keep functions under **7 lines of active logic** whenever possible.
* **Pattern**: Extract complex branches into single-purpose helper functions.
  ```typescript
  // ❌ BAD: High complexity aggregation
  const getFailures = (resource: any) => {
    const failures = [];
    if (resource.spec?.replicas > resource.status?.available) {
      failures.push({ text: 'Replica mismatch' });
    }
    for (const condition of resource.status?.conditions ?? []) {
      if (condition.type === 'Ready' && condition.status === 'False') {
        failures.push({ text: 'Not Ready' });
      }
    }
    return failures;
  };

  // class=line-numbers
  // 🟢 GOOD: Split into simple testable helpers
  const checkReplicas = (resource: any) => ...;
  const checkConditions = (resource: any) => ...;
  const getFailures = (resource: any) => [...checkReplicas(resource), ...checkConditions(resource)];
  ```

### 2. Nested Indentation & Bumpy Road Ahead
Nesting conditionals or loops inside other blocks creates deep paths that are hard to read and trigger "Deep, Nested Complexity" warnings.
* **Rule**: Indentation depth must never exceed **3 levels**.
* **Pattern**: Return early (guard clauses) and delegate loops or child elements.
  ```typescript
  // ❌ BAD: Indentation level = 4
  const validatePorts = (ports: Port[], pods: Pod[]) => {
    for (const port of ports) {
      if (typeof port.target === 'string') {
        const resolved = pods.some(pod => pod.spec.containers.some(c => c.portName === port.target));
        if (!resolved) { ... }
      }
    }
  };

  // 🟢 GOOD: Indentation level <= 2
  const isPortResolved = (target: string, pods: Pod[]) => ...;
  const validateSinglePort = (port: Port, pods: Pod[]) => {
    if (typeof port.target !== 'string') return [];
    if (!isPortResolved(port.target, pods)) {
      return [{ text: 'Unresolved port' }];
    }
    return [];
  };
  ```

### 3. Complex Conditionals
Avoid checking multiple states in a single line.
* **Rule**: Split long compound boolean expressions.
* **Pattern**: Assign checks to descriptive variables or helper methods.
  ```typescript
  // ❌ BAD: Compound conditional with multiple branches
  if (selector && Object.keys(selector).length > 0 && matchingPods.length > 0) { ... }

  // 🟢 GOOD: Extracted variables
  const hasSelector = selector && Object.keys(selector).length > 0;
  if (hasSelector && matchingPods.length > 0) { ... }
  ```

### 4. Docstring Coverage (>80%)
CodeScene checks for standard JSDoc/TSDoc blocks on functions and modules.
* **Rule**: Every exported class, interface, command handler, helper method, and analyzer function must have a JSDoc block describing:
  1. A clear sentence of what it does.
  2. Description of every `@param`.
  3. Description of the `@returns` type.

### 5. Mean Module Complexity & String-Heavy Arguments
CodeScene flags modules that have a high average cyclomatic complexity or contain too many string arguments across their functions.
* **Rule (Mean Complexity)**: Keep the mean cyclomatic complexity across all functions in a module **strictly < 4.0**. Avoid piling too many branch structures into a single file.
* **Rule (String-Heavy arguments)**: Keep the ratio of primitive string arguments (like `string`, `string[]`, or similar) **strictly < 39%** of all function arguments across a module.
* **Pattern**: 
  - Instead of passing multiple primitive parameters (especially strings) to a function, group them into a typed parameter options object.
  - Inline simple single-use helper functions to keep function count low and reduce unnecessary function parameter overhead.

```typescript
// ❌ BAD: High primitive string argument density
const resolveProvider = (name: string, model: string, baseUrl: string, password?: string) => ...

// 🟢 GOOD: Grouped parameter options object (0 primitive string arguments)
interface ProviderParams {
  name: string;
  model: string;
  baseUrl: string;
  password?: string;
}
const resolveProvider = (params: ProviderParams) => ...
```

### 6. Code Duplication & Parameterized Testing
Duplicate logic or structurally identical functions trigger CodeScene warnings, including inside unit tests.
* **Rule**: Never copy-paste structural logic across test cases.
* **Pattern**: Use parameterized testing templates (`it.each`) in Vitest to run similar assertions through a single test function body.

```typescript
// ❌ BAD: Structural code duplication in tests
it('tests provider A', () => {
  const result = runTest('A', 'paramA');
  expect(result).toBe('respA');
});
it('tests provider B', () => {
  const result = runTest('B', 'paramB');
  expect(result).toBe('respB');
});

// 🟢 GOOD: Parameterized it.each
it.each([
  { name: 'A', param: 'paramA', expected: 'respA' },
  { name: 'B', param: 'paramB', expected: 'respB' }
])('tests provider $name', ({ name, param, expected }) => {
  const result = runTest(name, param);
  expect(result).toBe(expected);
});
```

---

## 📈 Verification Checklist Before Pushing
Automated quality checks are enforced via **Husky** and **lint-staged**:
- **Pre-commit**: Validates staged files (`tsc --noEmit` type checks on staged TypeScript, targeted Vitest runs on staged tests, and `python3 -m py_compile` on staged agent files).
- **Pre-push**: Enforces `npm run build`, `npm test`, and `pytest agents/` before code leaves your local branch.

You can also run verification commands manually at any time:

1. **Build Checklist**: Ensure type compiling and declaration generation are clean:
   ```bash
   npm run build
   ```
2. **Type Check**:
   ```bash
   npm run check:types
   ```
3. **Test Checklist**: Ensure zero test regressions:
   ```bash
   npm run test
   ```
4. **Full Quality Check**:
   ```bash
   npm run check:code
   ```
5. **Complexity Checklist**: Do a mental dry-run of modified functions to check that cyclomatic complexity is `< 9`.
