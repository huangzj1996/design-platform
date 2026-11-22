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
import * as sandcastle from '@ai-hero/sandcastle';
import { bwrap } from '@ai-hero/sandcastle/sandboxes/bwrap';
import { z } from 'zod';
import { pencilMcpHook, startPencilRelay } from './pencil-relay.mts';

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
const prdTitle = /^\s*(?:\[prd\]|prd\s*[:：]|prd\s*$)/i;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Maximum number of plan→execute→merge cycles before stopping.
// Raise this if your backlog is large; lower it for a quick smoke-test run.
const MAX_ITERATIONS = 10;

const agent = sandcastle.claudeCode('deepseek-flash[1m]');
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
  '.sandcastle/pencil-mcp.mjs',
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
    .filter((issue) => !prdTitle.test(issue.title));

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

  await using pencil = await startPencilRelay();
  const workerHooks = {
    sandbox: {
      onSandboxReady: [
        ...hooks.sandbox.onSandboxReady,
        ...(pencil ? [pencilMcpHook] : []),
      ],
    },
  };
  const settled = await Promise.allSettled(
    issues.map(async (issue) => {
      const sandbox = await sandcastle.createSandbox({
        branch: issue.branch,
        sandbox: bwrap(pencil?.sandboxOptions),
        hooks: workerHooks,
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
