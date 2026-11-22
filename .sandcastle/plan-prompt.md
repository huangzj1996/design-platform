# ISSUES

Here are the open implementation issues ready for work:

<issues-json>

{{CANDIDATES}}

</issues-json>

PRD issues are excluded from the candidate list. Use them as context when needed, and include only issues from the list above in the plan.

# TASK

Analyze the open issues and build a dependency graph. Follow `docs/agents/issue-tracker.md` to check each candidate's GitHub blocking dependencies, including blockers outside the candidate list. If the native dependency data is unavailable, check for a `Blocked by:` list in the issue body.

An issue B is **blocked by** issue A if:

- B requires code or infrastructure that A introduces
- B and A modify overlapping files or modules, making concurrent work likely to produce merge conflicts
- B's requirements depend on a decision or API shape that A will establish

An issue is **unblocked** if it has zero blocking dependencies on other open issues.

For each unblocked issue, assign a branch name using the exact format `sandcastle/issue-{id}` (no slug or other suffix). This must be deterministic so that re-planning the same issue always produces the same branch name and accumulated progress is preserved.

# OUTPUT

Output your plan as a JSON object wrapped in `<plan>` tags:

<plan>
{"issues": [{"id": "42", "title": "Fix auth bug", "branch": "sandcastle/issue-42"}]}
</plan>

Include only unblocked issues that can be worked on together.

Always emit the `<plan>` tags, even when there is nothing to do. If there are no issues to work on at all, output `<plan>{"issues": []}</plan>` so the run can exit cleanly.
