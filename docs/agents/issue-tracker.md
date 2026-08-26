# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues in `pmgwee/real-ming`. Use the `gh` CLI for all operations.

## Conventions

- Create an issue: `gh issue create --title "..." --body "..."`
- Read an issue: `gh issue view <number> --comments`
- List issues: `gh issue list --state open`
- Comment: `gh issue comment <number> --body "..."`
- Add/remove labels: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`
- Close: `gh issue close <number> --comment "..."`

Infer the repository from `git remote -v`; `gh` does this automatically inside the clone.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

- A map is one issue labelled `wayfinder:map`.
- Child tickets use `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`.
- Represent blocking relationships using GitHub native issue dependencies.
- If native dependencies are unavailable, use a `Blocked by: #<number>` line.
- Claim work by assigning the issue to the active developer.
- Resolve work by commenting with the result and closing the issue.
