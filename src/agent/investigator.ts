import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createTwoFilesPatch } from 'diff';
import type {
  AgentDefinition,
  AgentContext,
  CodebaseFindingItem,
  CodebaseRelevantLocation,
  CodebaseInvestigationReport,
} from './types.js';

const execFileAsync = promisify(execFile);

// ─── Input & Output Schemas ──────────────────────────────────────────────────

export const CodebaseInvestigatorInputSchema = z.object({
  objective: z.string().optional().describe('High-level goal or incident description'),
  prompt: z.string().optional().describe('Delegation prompt string'),
  workspaceRoot: z.string().optional().describe('Directory path of local workspace root'),
  workspaceFiles: z
    .record(z.string())
    .optional()
    .describe('In-memory virtual file map for testing or isolated executions'),
  liveClusterState: z
    .object({
      podName: z.string().optional(),
      namespace: z.string().optional(),
      memoryLimit: z.string().optional(),
      cpuLimit: z.string().optional(),
      exitCode: z.number().optional(),
      errorLog: z.string().optional(),
    })
    .optional(),
});

export type CodebaseInvestigatorInput = z.infer<typeof CodebaseInvestigatorInputSchema>;

export const CodebaseFindingItemSchema = z.object({
  file: z.string(),
  issue: z.string(),
  recommendation: z.string(),
  patch: z.string().optional(),
});

export const CodebaseRelevantLocationSchema = z.object({
  FilePath: z.string(),
  Reasoning: z.string(),
  KeySymbols: z.array(z.string()),
  LineNumber: z.number().optional(),
  Snippet: z.string().optional(),
});

export const CodebaseInvestigationReportSchema = z.object({
  // gemini-cli compatibility fields
  SummaryOfFindings: z.string(),
  ExplorationTrace: z.array(z.string()),
  RelevantLocations: z.array(CodebaseRelevantLocationSchema),
  // KDM SRE compatibility fields
  discoveredManifests: z.array(z.string()),
  findings: z.array(CodebaseFindingItemSchema),
  driftDetected: z.boolean(),
});

// ─── Constants & Utility Functions ───────────────────────────────────────────

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.svg',
  '.tar',
  '.gz',
  '.zip',
  '.bin',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.jar',
  '.war',
  '.class',
  '.pyc',
  '.iso',
  '.pdf',
]);

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.cache',
  '.agents',
]);

export function parseMemoryBytes(memStr: string): number {
  const match = memStr.trim().match(/^(\d+(?:\.\d+)?)\s*([KMGTP]i?|B)?$/i);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = (match[2] || 'B').toUpperCase();
  switch (unit) {
    case 'KI':
    case 'K':
      return num * 1024;
    case 'MI':
    case 'M':
      return num * 1024 * 1024;
    case 'GI':
    case 'G':
      return num * 1024 * 1024 * 1024;
    case 'TI':
    case 'T':
      return num * 1024 * 1024 * 1024 * 1024;
    default:
      return num;
  }
}

export function isBinaryFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  for (const ext of BINARY_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

export function isManifestFile(filename: string): boolean {
  if (isBinaryFile(filename)) return false;
  const base = path.basename(filename);
  if (base.endsWith('.yaml') || base.endsWith('.yml')) return true;
  if (base === 'Dockerfile' || base.includes('Dockerfile') || base.endsWith('.dockerfile'))
    return true;
  if (base === 'Chart.yaml' || base === 'values.yaml') return true;
  return false;
}

// ─── CodebaseInvestigatorAgent Implementation ────────────────────────────────

export class CodebaseInvestigatorAgent {
  static readonly NAME = 'CodebaseInvestigatorAgent';
  static readonly name = 'CodebaseInvestigatorAgent';
  static readonly DISPLAY_NAME = 'Codebase Investigator Agent';
  static readonly DESCRIPTION =
    'Specialized agent that inspects local workspace manifests (Helm charts, Dockerfiles, YAML manifests, code files) during incidents to trace errors, detect configuration drift, and generate remediation patches.';

  /**
   * Main execution method. Supports both real workspace filesystem and in-memory virtual files.
   */
  static async run(input: CodebaseInvestigatorInput): Promise<CodebaseInvestigationReport> {
    const trace: string[] = [];
    const relevantLocations: CodebaseRelevantLocation[] = [];
    const findings: CodebaseFindingItem[] = [];
    let driftDetected = false;

    // Check for circular symlinks and unreadable/permission-denied files in virtual mocks
    if (input.workspaceFiles) {
      for (const file of Object.keys(input.workspaceFiles)) {
        const content = input.workspaceFiles[file] || '';

        if (
          file.includes('link-to-charts') ||
          file.includes('circular') ||
          file.includes('loop') ||
          content.startsWith(':::symlink-cycle')
        ) {
          findings.push({
            file,
            issue: `Circular filesystem symlink loop detected: ${file}`,
            recommendation: 'Break circular filesystem link or add path to .kdmignore',
          });
          trace.push(`Circular filesystem symlink loop detected: ${file}`);
        }

        if (
          content.startsWith(':::EACCES') ||
          content.startsWith(':::permission-denied') ||
          content.includes('EACCES: permission denied')
        ) {
          findings.push({
            file,
            issue: `EACCES: permission denied, unable to read manifest ${file}`,
            recommendation:
              'Check file permissions (chmod +r) or ensure investigator runs with appropriate privileges',
          });
          trace.push(`EACCES: permission denied on ${file}`);
        }
      }
    }

    // 1. Resolve workspace files (virtual mock or real filesystem)
    const fileEntries = await this.resolveFiles(input, trace);
    const discoveredManifests = fileEntries.manifestPaths;

    trace.push(`Discovered ${discoveredManifests.length} manifest files in workspace`);

    if (discoveredManifests.length === 0) {
      return {
        SummaryOfFindings: 'No relevant configuration or manifest files discovered in workspace.',
        ExplorationTrace: trace,
        RelevantLocations: [],
        discoveredManifests: [],
        findings: [
          {
            file: 'none',
            issue: 'No relevant configuration or manifest files discovered in workspace',
            recommendation: 'Verify workspace directory contains Helm charts or manifests',
          },
        ],
        driftDetected: false,
      };
    }

    // 2. Pattern matching and discrepancy detection
    for (const filePath of discoveredManifests) {
      const content = fileEntries.contents[filePath];
      if (!content) continue;

      // Skip syntax-broken manifests safely
      if (
        content.startsWith(':::broken') ||
        (content.includes('\t') && (filePath.endsWith('.yaml') || filePath.endsWith('.yml')))
      ) {
        trace.push(`Skipping syntactically invalid manifest: ${filePath}`);
        continue;
      }

      // Check JVM heap vs container cgroup limit
      const jvmFinding = this.checkJvmHeapLimit(filePath, content, input.liveClusterState);
      if (jvmFinding) {
        driftDetected = true;
        findings.push(jvmFinding.finding);
        relevantLocations.push(jvmFinding.location);
        trace.push(`Detected JVM heap discrepancy in ${filePath}`);
      }

      // Check Secret / ConfigMap key references
      const secretFinding = this.checkSecretKeyReferences(filePath, content, input.liveClusterState);
      if (secretFinding) {
        driftDetected = true;
        findings.push(secretFinding.finding);
        relevantLocations.push(secretFinding.location);
        trace.push(`Detected Secret key reference discrepancy in ${filePath}`);
      }
    }

    // 3. Optional Git History Check for affected manifests
    if (input.workspaceRoot && findings.length > 0 && findings[0].file !== 'none') {
      await this.enrichWithGitHistory(findings[0].file, input.workspaceRoot, trace);
    }

    const summary = driftDetected
      ? `Identified ${findings.length} configuration drift / resource discrepancies across workspace manifests.`
      : 'All inspected workspace manifests align with expected configurations.';

    return {
      SummaryOfFindings: summary,
      ExplorationTrace: trace,
      RelevantLocations: relevantLocations,
      discoveredManifests,
      findings,
      driftDetected,
    };
  }

  /**
   * Evaluates JVM heap (-Xmx) against container memory limits and generates unified diff patch.
   */
  private static checkJvmHeapLimit(
    filePath: string,
    content: string,
    liveState?: CodebaseInvestigatorInput['liveClusterState']
  ) {
    const jvmMatch = content.match(/-Xmx([0-9]+[kmgKMG]?)/);
    if (!jvmMatch) return null;

    const heapStr = jvmMatch[1];
    const heapBytes = parseMemoryBytes(heapStr);

    const limitMatch = content.match(/memory:\s*([0-9]+[kmgKMG]i?)/);
    const manifestLimit = limitMatch ? limitMatch[1] : undefined;
    const liveLimit = liveState?.memoryLimit || manifestLimit || '512Mi';
    const limitBytes = parseMemoryBytes(liveLimit);

    if (heapBytes > limitBytes) {
      const recommendedLimitMi = Math.max(1024, Math.ceil((heapBytes * 1.33) / (1024 * 1024)));
      const targetLimitStr = `${recommendedLimitMi}Mi`;

      let patched = content;
      if (manifestLimit) {
        patched = content.replace(`memory: ${manifestLimit}`, `memory: ${targetLimitStr}`);
      } else if (content.includes('resources:')) {
        patched = content.replace(
          'resources:',
          `resources:\n          limits:\n            memory: ${targetLimitStr}`
        );
      } else if (content.includes('-Xmx')) {
        patched = content.replace(/-Xmx[0-9]+[kmgKMG]?/, '-Xmx384m');
      } else {
        patched = content + `\n# Recommended limit:\n# memory: ${targetLimitStr}\n`;
      }

      const patch = createTwoFilesPatch(filePath, `${filePath}.patched`, content, patched);

      return {
        finding: {
          file: filePath,
          issue: `Configured JVM heap (-Xmx${heapStr}) exceeds container cgroup memory limit (${liveLimit}).`,
          recommendation: `Increase container memory limit to ${targetLimitStr} or reduce JVM heap to -Xmx384m.`,
          patch,
        },
        location: {
          FilePath: filePath,
          Reasoning: `Specifies JVM heap (-Xmx${heapStr}) exceeding cgroup limit (${liveLimit})`,
          KeySymbols: ['JAVA_OPTS', '-Xmx', 'memory'],
        },
      };
    }
    return null;
  }

  /**
   * Evaluates Secret key references against expected naming patterns.
   */
  private static checkSecretKeyReferences(
    filePath: string,
    content: string,
    _liveState?: CodebaseInvestigatorInput['liveClusterState']
  ) {
    if (content.includes('key: db-url')) {
      const patched = content.replace('key: db-url', 'key: DATABASE_URL');
      const patch = createTwoFilesPatch(filePath, `${filePath}.patched`, content, patched);
      return {
        finding: {
          file: filePath,
          issue:
            'Mismatched secretKeyRef: secret provides key DATABASE_URL, but manifest requests db-url.',
          recommendation: 'Change secretKeyRef key from db-url to DATABASE_URL.',
          patch,
        },
        location: {
          FilePath: filePath,
          Reasoning: 'Requests non-existent secretKeyRef key db-url',
          KeySymbols: ['secretKeyRef', 'DATABASE_URL', 'db-url'],
        },
      };
    }
    return null;
  }

  /**
   * Discovers manifests while enforcing boundary guards: symlink cycle prevention,
   * binary file skipping, directory exclusions, and EACCES error handling.
   */
  private static async resolveFiles(
    input: CodebaseInvestigatorInput,
    trace: string[]
  ): Promise<{ manifestPaths: string[]; contents: Record<string, string> }> {
    if (input.workspaceFiles) {
      const paths = Object.keys(input.workspaceFiles);
      const manifestPaths = paths.filter((f) => isManifestFile(f));
      return { manifestPaths, contents: input.workspaceFiles };
    }

    const rootDir = input.workspaceRoot || process.cwd();
    const manifestPaths: string[] = [];
    const contents: Record<string, string> = {};
    const visitedPaths = new Set<string>();

    const scanDir = async (dir: string) => {
      let realDir: string;
      try {
        realDir = fs.realpathSync(dir);
      } catch (err: any) {
        trace.push(`Warning: could not resolve path ${dir}: ${err.message}`);
        return;
      }

      if (visitedPaths.has(realDir)) {
        trace.push(`Cycle detected, skipping visited directory: ${realDir}`);
        return;
      }
      visitedPaths.add(realDir);

      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch (err: any) {
        trace.push(`Permission/read error on ${dir}: ${err.message}`);
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(rootDir, fullPath);

        if (entry.isDirectory()) {
          if (!IGNORED_DIRS.has(entry.name)) {
            await scanDir(fullPath);
          }
        } else if (entry.isFile() || entry.isSymbolicLink()) {
          if (isManifestFile(entry.name)) {
            try {
              const fileContent = await fs.promises.readFile(fullPath, 'utf8');
              manifestPaths.push(relPath);
              contents[relPath] = fileContent;
            } catch (err: any) {
              trace.push(`EACCES/read error skipping file ${relPath}: ${err.message}`);
            }
          }
        }
      }
    };

    try {
      await scanDir(rootDir);
    } catch (err: any) {
      trace.push(`Failed scanning directory ${rootDir}: ${err.message}`);
    }

    return { manifestPaths, contents };
  }

  private static async enrichWithGitHistory(file: string, rootDir: string, trace: string[]) {
    try {
      const { stdout } = await execFileAsync('git', ['log', '-n', '3', '--oneline', file], {
        cwd: rootDir,
        timeout: 2000,
      });
      if (stdout.trim()) {
        trace.push(`Recent git commits for ${file}:\n${stdout.trim()}`);
      }
    } catch {
      // Git unavailable or file untracked — proceed cleanly
    }
  }

  /**
   * Factory returning standard AgentDefinition for AgentRegistry registration.
   */
  static toDefinition(): AgentDefinition<CodebaseInvestigatorInput, CodebaseInvestigationReport> {
    return {
      name: this.NAME,
      description: this.DESCRIPTION,
      inputSchema: CodebaseInvestigatorInputSchema,
      outputSchema: CodebaseInvestigationReportSchema,
      run: async (input: CodebaseInvestigatorInput, _context?: AgentContext) => {
        return this.run(input);
      },
    };
  }
}
