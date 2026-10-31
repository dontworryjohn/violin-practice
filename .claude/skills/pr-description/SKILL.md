---
name: pr-description
description: Write or refresh a pull request description that tells a reviewer what changed and exactly how to test it before merging into main. Use whenever a pull request is opened, updated with new commits, or about to be merged, and whenever the user asks to "write the PR description", "describe the changes", "add testing steps", "get this ready for review" or "ready to merge", even if they don't say "description".
---

# Pull request description for reviewers

Goal: anyone opening the pull request, including a new developer, can tell **what changed**,
**why**, and **how to test it** without reading the code first.

## Steps

1. **Find what the pull request contains.**
   - Base branch: usually `main`. Run `git fetch origin main`.
   - Commits: `git log --oneline origin/main..HEAD`
   - Files: `git diff --stat origin/main...HEAD`
   - Read the actual diff (`git diff origin/main...HEAD -- <file>`). Commit messages alone are not enough.
   - If the pull request already has a description, read it and keep anything a person wrote by hand.

2. **Run the checks you can run** and note the real results:
   - Any test or lint command in the README, `package.json` or CI config.
   - For this repo there is no build. Serve it with `python3 -m http.server 8000`, open it in
     Playwright/Chromium, click through the changed features and check the console has no errors.
   - Check that every `songs.json` entry still parses (load `js/notation.js` and call `parseTune`).
   - Never say a check passed unless you ran it in this session. Anything you couldn't check
     (for example "how the audio sounds") goes under **Not tested automatically**.

3. **Write the description** using the template below. Write in plain language for a new developer:
   short sentences, explain any jargon, every command in its own code block.

4. **Publish it.** If no pull request exists, create one. Otherwise update the existing one; don't open a duplicate.
   Use the GitHub MCP tools (`create_pull_request` / `update_pull_request`) or `gh pr edit --body-file`.
   Then give the user the pull request link and a short summary of what the reviewer must test.

## Template

Keep these headings in this order. Leave out a section only if it truly doesn't apply. "No UI changes" is fine.

````markdown
## Summary
One or two sentences: what this pull request does and why.

## What changed
| Area | Change | Why |
| --- | --- | --- |
| (feature or screen) | (what a user will notice) | (reason) |

### Files
- `path/to/file`: one line about what changed in it

## How to test

### 1. Get the branch
```bash
git fetch origin
```
```bash
git checkout <branch-name>
```

### 2. Run it
```bash
python3 -m http.server 8000
```
Open http://localhost:8000. Press `Ctrl+C` to stop the server.

### 3. Checklist
- [ ] **<Feature>:** do <action>. Expected: <what you should see or hear>.
- [ ] Browser console (`F12` → Console) shows no red errors.
- [ ] Still works on a tablet-sized screen (`F12` → 📱 device toolbar → iPad).

## Automated checks run
- ✅ <check>: <result>
- ⚠️ Not tested automatically: <anything a person must check, e.g. how audio sounds>

## Things for the reviewer to look at
- Risky parts, trade-offs, new dependencies or files, data/storage format changes, licences of added assets.

## After merging
Anything to do after merge (e.g. GitHub Pages settings). Otherwise write "Nothing extra".
````

## Rules for the checklist

- Write one checklist item for **each user-visible change** in the diff. Every item says
  *what to do* and *what you should see*: "Tap a note. Expected: you hear a violin note."
  Not "check notes work".
- Put the riskiest change first.
- If a change could break existing features (shared code, storage format, `songs.json`),
  add a check that the old behaviour still works.
- If saved data in `localStorage` changes shape, say how to reset it:
  `F12` → Application → Local storage → Clear.
- If assets with a licence were added (sounds, images, fonts), name the licence and the credits file.
