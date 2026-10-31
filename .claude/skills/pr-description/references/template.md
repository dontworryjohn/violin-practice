# Pull request description template

Fill in each section from the real diff and the checks you ran. Delete the hints in `<...>`.
For small changes, keep the sections short. For docs-only changes you can drop "Run it".

````markdown
## Summary
<One or two sentences: what this pull request does and why. Link the issue if there is one: "Fixes #12".>

## What changed
| Area | Change | Why |
| --- | --- | --- |
| <feature, screen, module or API> | <what a user or caller will notice> | <reason> |

### Files
- `<path>`: <one line on what changed>
- `<generated/vendored files>`: <one line for the whole group>

## How to test

### 1. Get the branch
```bash
git fetch origin
```
```bash
git checkout <head-branch>
```

### 2. Set up and run it
<Only the steps this project needs, each in its own block. Examples:>
```bash
npm ci
```
```bash
npm run dev
```
<Say where to open it, e.g. http://localhost:3000, and how to stop it (Ctrl+C).>

### 3. Checklist
<One item per change, riskiest first. Action → expected result.>
- [ ] **<Change>:** <do this>. Expected: <what you see, hear or get back>.
- [ ] **Still works:** <an existing feature near the change>. Expected: <same as before>.
- [ ] <For UI: browser console (F12 → Console) shows no red errors; check a phone-sized screen.>
- [ ] <For tests: `<test command>` passes.>

<How to reset state changed by testing, if any: database, local storage, config files.>

## Automated checks run
<Run in this session on commit `<short sha>`:>
- ✅ <command or check>: <result, e.g. "61/61 passed">
- ❌ <failing check>: <error and why it matters>
- ⚠️ Not tested automatically: <what a person must check and why>

## Things for the reviewer to look at
- <Risky or tricky parts, design trade-offs>
- <New dependencies, assets and their licences, data/storage/API format changes, security-relevant code>

## After merging
<Deploy steps, migrations, settings to change, people to tell. Otherwise: "Nothing extra.">
````
