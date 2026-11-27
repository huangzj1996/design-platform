// Parallel Planner with Review — four-phase orchestration loop
//
// This template drives a multi-phase workflow:
//   Phase 1 (Plan):             An agent analyzes open issues, builds a
//                               dependency graph, and outputs a <plan> JSON
//                               listing unblocked issues with branch names.
//   Phase 2 (Execute + Review): For each issue, a sandbox is created via
//                               createSandbox(). The implementer runs first
//                               (100 iterations). If it produces commits, a
//                               reviewer runs in the same sandbox on the same
//                               branch (1 iteration). All issue pipelines run
//                               concurrently via Promise.allSettled().
//   Phase 3 (Merge):            A single agent merges all completed branches
//                               into the current branch.
//
// The outer loop repeats up to MAX_ITERATIONS times so that newly unblocked
// issues are picked up after each round of merges.
//
// Usage:
//   pnpm run sandcastle

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, delimiter, dirname, isAbsolute } from 'node:path';
import { loadEnvFile } from 'node:process';
import * as sandcastle from '@ai-hero/sandcastle';
import { bwrap } from '@ai-hero/sandcastle/sandboxes/bwrap';
import { z } from 'zod';

// The planner emits its plan as JSON inside <plan> tags; Output.object extracts
// and validates it against this schema. We use Zod here, but any Standard
// Schema validator works just as well — Valibot, ArkType, etc. See
// https://standardschema.dev.
const planSchema = z.object({
  issues: z.array(
    z.object({ id: z.string(), title: z.string(), branch: z.string() }),
  ),
});

const candidateSchema = z.array(
  z.object({
    number: z.number(),
    title: z.string(),
    body: z.string(),
    labels: z.array(z.string()),
    comments: z.array(z.string()),
  }),
);
// PRD and spec issues describe what to build; they are not implementation
// tasks. Match titles that start with the marker (`PRD · …`, `规格：…`,
// `[spec] …`) or end with it (`… PRD`, `… 规格`).
const prdOrSpecTitle =
  /^\s*(?:\[(?:prd|spec|规格)\]|(?:prd|spec|规格)(?:\s*[:：·・—–-]|\s+|$))|\s(?:prd|spec|规格)\s*$/i;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Maximum number of plan→execute→merge cycles before stopping.
// Raise this if your backlog is large; lower it for a quick smoke-test run.
const MAX_ITERATIONS = 10;

// bwrap mounts directories from the host PATH read-only. Put the active pnpm
// executable first so fresh sandboxes can use the workspace's pinned version.
const pnpmExecutable = process.env.npm_execpath;
if (
  pnpmExecutable &&
  isAbsolute(pnpmExecutable) &&
  basename(pnpmExecutable) === 'pnpm'
) {
  process.env.PATH = [dirname(pnpmExecutable), process.env.PATH]
    .filter(Boolean)
    .join(delimiter);
}

// Load .sandcastle/.env into the host process so the model id and provider
// credentials live in one place. Variables already set in the environment
// take precedence (same as Node's --env-file).
try {
  loadEnvFile(new URL('./.env', import.meta.url));
} catch (error) {
  // A missing .env is fine when the variables are exported instead.
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

// The model id comes from ANTHROPIC_MODEL so it matches the provider
// configured by ANTHROPIC_BASE_URL in .sandcastle/.env (see .env.example).
// claudeCode() passes it to the Claude CLI as --model.
const model = process.env.ANTHROPIC_MODEL;
if (!model) {
  throw new Error(
    'ANTHROPIC_MODEL is not set. Define it in .sandcastle/.env (see .env.example).',
  );
}
const agent = sandcastle.claudeCode(model);
const codingStandards = readFileSync(
  new URL('./CODING_STANDARDS.md', import.meta.url),
  'utf8',
);

// Hooks run inside the sandbox before the agent starts each iteration.
const hooks = {
  sandbox: {
    onSandboxReady: [
      {
        command:
          'CI=true HUSKY=0 pnpm install --frozen-lockfile --prefer-offline',
        timeoutMs: 180_000,
      },
    ],
  },
};

// Copy local dependencies and Claude configuration into each issue worktree.
const copyToWorktree = [
  'node_modules',
  'apps/desktop/node_modules',
  'packages/design-schema/node_modules',
  'packages/editor-core/node_modules',
  '.agents/skills/leaferjs',
  '.claude/skills',
  '.mcp.json',
];

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);

  // -------------------------------------------------------------------------
  // Phase 1: Plan
  //
  // The planning agent reads the open issue list,
  // builds a dependency graph, and selects the issues that can be worked in
  // parallel right now (i.e., no blocking dependencies on other open issues).
  //
  // It outputs a <plan> JSON block — Output.object parses and validates it.
  // -------------------------------------------------------------------------
  const issueJson = execFileSync(
    'gh',
    [
      'issue',
      'list',
      '--state',
      'open',
      '--label',
      'ready-for-agent',
      '--limit',
      '100',
      '--json',
      'number,title,body,labels,comments',
      '--jq',
      '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]',
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  const candidates = candidateSchema
    .parse(JSON.parse(issueJson))
    .filter((issue) => !prdOrSpecTitle.test(issue.title));

  if (candidates.length === 0) {
    console.log('No implementation issues ready for planning. Exiting.');
    break;
  }

  const plan = await sandcastle.run({
    hooks,
    sandbox: bwrap(),
    name: 'planner',
    // One iteration is enough: the planner just needs to read and reason,
    // not write code. (Structured output requires maxIterations: 1.)
    maxIterations: 1,
    agent,
    promptFile: './.sandcastle/plan-prompt.md',
    promptArgs: { CANDIDATES: JSON.stringify(candidates) },
    // Extract and validate the <plan> JSON into a typed object. Throws
    // StructuredOutputError if the tag is missing, the JSON is malformed, or
    // validation fails — which aborts the loop.
    output: sandcastle.Output.object({ tag: 'plan', schema: planSchema }),
  });

  const candidateIds = new Set(candidates.map((issue) => String(issue.number)));
  const plannedIssues: z.infer<typeof planSchema>['issues'] =
    plan.output.issues;
  const issues = plannedIssues.filter((issue) => candidateIds.has(issue.id));

  if (issues.length === 0) {
    // No unblocked work — either everything is done or everything is blocked.
    console.log('No unblocked issues to work on. Exiting.');
    break;
  }

  console.log(
    `Planning complete. ${issues.length} issue(s) to work in parallel:`,
  );
  for (const issue of issues) {
    console.log(`  ${issue.id}: ${issue.title} → ${issue.branch}`);
  }

  // -------------------------------------------------------------------------
  // Phase 2: Execute + Review
  //
  // For each issue, create a sandbox via createSandbox() so the implementer
  // and reviewer share the same sandbox instance per branch. The implementer
  // runs first; if it produces commits, the reviewer runs in the same sandbox.
  //
  // Promise.allSettled means one failing pipeline doesn't cancel the others.
  // -------------------------------------------------------------------------

  const settled = await Promise.allSettled(
    issues.map(async (issue) => {
      const sandbox = await sandcastle.createSandbox({
        branch: issue.branch,
        sandbox: bwrap(),
        hooks,
        copyToWorktree,
      });

      try {
        // Run the implementer
        const implement = await sandbox.run({
          name: 'implementer',
          maxIterations: 100,
          agent,
          promptFile: './.sandcastle/implement-prompt.md',
          promptArgs: {
            TASK_ID: issue.id,
            ISSUE_TITLE: issue.title,
            BRANCH: issue.branch,
          },
        });

        // Only review if the implementer produced commits
        if (implement.commits.length > 0) {
          const review = await sandbox.run({
            name: 'reviewer',
            maxIterations: 1,
            agent,
            promptFile: './.sandcastle/review-prompt.md',
            promptArgs: {
              BRANCH: issue.branch,
              CODING_STANDARDS: codingStandards,
            },
          });

          // Merge commits from both runs so the merge phase sees all of them.
          // Each sandbox.run() only returns commits from its own run.
          return {
            ...review,
            commits: [...implement.commits, ...review.commits],
          };
        }

        return implement;
      } finally {
        await sandbox.close();
      }
    }),
  );

  // Log any agents that threw (network error, sandbox crash, etc.), and
  // only pass branches that actually produced commits to the merge phase.
  // An agent that ran successfully but made no commits has nothing to merge.
  const completedIssues: typeof issues = [];
  for (const [i, issue] of issues.entries()) {
    const outcome = settled[i];
    if (outcome?.status === 'rejected') {
      console.error(
        `  ✗ ${issue.id} (${issue.branch}) failed: ${outcome.reason}`,
      );
    } else if (
      outcome?.status === 'fulfilled' &&
      outcome.value.commits.length > 0
    ) {
      completedIssues.push(issue);
    }
  }

  const completedBranches = completedIssues.map((i) => i.branch);

  console.log(
    `\nExecution complete. ${completedBranches.length} branch(es) with commits:`,
  );
  for (const branch of completedBranches) {
    console.log(`  ${branch}`);
  }

  if (completedBranches.length === 0) {
    // All agents ran but none made commits — nothing to merge this cycle.
    console.log('No commits produced. Nothing to merge.');
    continue;
  }

  // -------------------------------------------------------------------------
  // Phase 3: Merge
  //
  // One agent merges all completed branches into the current branch,
  // resolving any conflicts and running tests to confirm everything works.
  //
  // The {{BRANCHES}} and {{ISSUES}} prompt arguments are lists that the agent
  // uses to know which branches to merge and which issues to close.
  // -------------------------------------------------------------------------
  await sandcastle.run({
    hooks,
    sandbox: bwrap(),
    name: 'merger',
    maxIterations: 1,
    agent,
    promptFile: './.sandcastle/merge-prompt.md',
    promptArgs: {
      // A markdown list of branch names, one per line.
      BRANCHES: completedBranches.map((b) => `- ${b}`).join('\n'),
      // A markdown list of issue IDs and titles, one per line.
      ISSUES: completedIssues.map((i) => `- ${i.id}: ${i.title}`).join('\n'),
    },
  });

  console.log('\nBranches merged.');
}

console.log('\nAll done.');
