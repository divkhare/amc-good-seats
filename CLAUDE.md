# Claude guide for this repo

This repo is a GitHub-Actions-hosted seat watcher for AMC Lincoln Square IMAX 70mm. It runs a Puppeteer scan every ~10 min and emails via Gmail SMTP when qualifying seats open up.

## Layout

- `amc-node.js` — the watcher. All configuration lives as top-level constants. One-shot: runs once and exits. Does not loop.
- `.github/workflows/check-seats.yml` — triggers: cron `*/10 * * * *`, `push` to `main`, manual `workflow_dispatch` (with a `test_mode` boolean input).
- `amc-script.js`, `amc-constants.js` — legacy DevTools-console tool, unrelated to the hosted watcher. Leave alone unless asked.
- `package.json` — deps: `puppeteer`, `puppeteer-extra`, `puppeteer-extra-plugin-stealth`, `nodemailer`.

## Where to change common things

| Change | Location |
| --- | --- |
| Movies watched | `MOVIES` in `amc-node.js` (lowercase, include punctuation variants) |
| Target seat zone | `TARGET_ROWS`, `TARGET_COL_MIN`, `TARGET_COL_MAX` |
| Earliest showtime | `MIN_SHOWTIME_MINUTES` (minutes since midnight, theater-local time) |
| Min seats to email | `MIN_SEATS_FOR_EMAIL` |
| Days scanned ahead | `MAX_DATES` |
| Theater | `THEATER_URL` |
| Cron cadence | `cron` in workflow file (min 5 min) |

`TEST_MODE=true` (via workflow_dispatch input) widens the seat zone for pipeline verification — it will send many emails per run.

## Secrets (stored on the GitHub repo)

- `GMAIL_USER` — Gmail address to send from
- `GMAIL_APP_PASSWORD` — 16-char app password (requires 2FA on that Gmail account)
- `NOTIFY_EMAIL` — comma-separated list of recipients

Set via: `gh secret set <NAME> --repo divkhare/amc-good-seats --body '<value>'`.

## Behavior notes

- Email fires **immediately** per qualifying showtime, not batched at end of scan — a run timeout doesn't wipe notifications.
- No dedup state between runs. If seats remain available, recipients get the same email every scan (every ~10 min). Adding dedup would need Actions cache, a committed state file, or an external KV.
- `MAX_DATES` exists because AMC returns ~130 dates (a year+ of showtimes) and scanning all of them exceeds the 15-min Actions job timeout.
- Showtimes are theater-local times (ET for Lincoln Square). `parseShowtimeMinutes` parses strings like `"1:15pm"` directly — no timezone conversion needed because AMC serves local time strings.
- The workflow runs on every push to `main`, which is handy for testing changes but means unrelated doc edits also trigger a scan. Remove the `push:` trigger if that becomes annoying.

## Known GitHub Actions quirks

- Scheduled workflows on new repos can take 30–90 min to fire the first time.
- Scheduled workflows auto-disable after **60 days of zero repo activity**. Any push resets the clock.
- Schedules run in UTC; `*/10 * * * *` means every 10 min regardless of timezone.

## Debugging a run

- `gh run list --repo divkhare/amc-good-seats --limit 5`
- `gh run view <run-id> --repo divkhare/amc-good-seats --log`
- Look for: `Email sent to …` (success), `Email send failed: …` (delivery issue), `below N-seat threshold` (real scan but no qualifying hits).

## Do NOT do without asking

- Do not push to `upstream` remote (points to `NameFILIP/amc-good-seats`, the original fork).
- Do not `git push --force`.
- Do not commit `node_modules/`, `.env`, or anything under `.claude/` (gitignored).
- Do not add the user's email addresses or app passwords to any file in the repo — they belong in GitHub Secrets only.
