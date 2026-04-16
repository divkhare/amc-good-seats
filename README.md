# AMC IMAX 70mm Seat Watcher

Watches AMC Lincoln Square 13 (NYC) for good seats at IMAX 70mm showings and emails a notification the moment seats open up.

Runs on **GitHub Actions** (free) every ~10 minutes. When a showtime has 2 or more seats in the target zone, each recipient gets an email with the count, seat numbers, and a booking link.

---

## What it's currently watching

- **Theater:** AMC Lincoln Square 13
- **Format:** IMAX 70mm
- **Movies:** The Odyssey, Dune: Part Three, Spider-Man: Brand New Day, Avengers: Doomsday
- **Seats:** rows F/G/H/J, columns 9–39 (the center "sweet spot")
- **Showtimes:** 1:00pm or later
- **Window:** next 14 days
- **Threshold:** email sent when a showtime has **2+ seats** in the zone
- **Recipients:** set in the repo's `NOTIFY_EMAIL` secret (comma-separated)

---

## How to change what's being watched

All tweakable settings live at the top of [`amc-node.js`](./amc-node.js). Edit the file, commit, push — the next run uses the new values.

| Want to change… | Edit this |
| --- | --- |
| Which movies to watch | `MOVIES` array (lowercase, one entry per title — add variants like `"dune: part three"` AND `"dune part three"` to handle punctuation) |
| Which rows count as good | `TARGET_ROWS` |
| Which columns count as good | `TARGET_COL_MIN`, `TARGET_COL_MAX` |
| Earliest showtime | `MIN_SHOWTIME_MINUTES` (e.g., `13 * 60` = 1:00pm) |
| Minimum seats to trigger email | `MIN_SEATS_FOR_EMAIL` |
| How many days ahead to scan | `MAX_DATES` |
| Which theater | `THEATER_URL` (Lincoln Square for now; any AMC showtimes URL will work) |

### Quick edit workflow

1. Open `amc-node.js` in GitHub's web editor (press `.` on the repo page, or click the file → pencil icon).
2. Change the value.
3. Commit directly to `main`. That push triggers a run within ~30 seconds — you can watch it in the **Actions** tab.

---

## Managing email recipients

Recipients are stored as a GitHub repo secret called `NOTIFY_EMAIL` (comma-separated, no spaces needed).

**To add/change recipients**, from any terminal with `gh` installed and logged in:

```bash
gh secret set NOTIFY_EMAIL --repo divkhare/amc-good-seats --body 'you@example.com,friend@example.com'
```

Or do it in the UI: **Settings → Secrets and variables → Actions → `NOTIFY_EMAIL` → Update**.

---

## How to trigger a run manually (test)

**Quick test with a widened seat zone** (this will definitely find and email seats, useful for confirming the pipeline works):

```bash
gh workflow run check-seats.yml --repo divkhare/amc-good-seats -f test_mode=true
```

**Normal run** (narrow seat zone — may find nothing):

```bash
gh workflow run check-seats.yml --repo divkhare/amc-good-seats
```

Or use the GitHub UI: **Actions → Check AMC Seats → Run workflow**.

---

## Where to see it running

- Live run list: **https://github.com/divkhare/amc-good-seats/actions**
- Click any run to see full logs — every showtime scanned, seat counts, and email-send confirmations.

---

## Troubleshooting

**"I'm not getting emails"**
- Check spam (Gmail often filters messages sent from yourself to yourself).
- Check the latest run's logs. If you see `Email sent to …` lines, the delivery succeeded from our end — it's a Gmail inbox issue.
- If you see `Email send failed: Invalid login`, the `GMAIL_APP_PASSWORD` secret is wrong. Regenerate at https://myaccount.google.com/apppasswords and update:
  ```bash
  gh secret set GMAIL_APP_PASSWORD --repo divkhare/amc-good-seats --body 'new-app-password'
  ```

**"Actions aren't running"**
- Scheduled runs can pause after **60 days of repo inactivity**. A single commit resets the clock:
  ```bash
  git commit --allow-empty -m "Keep scheduler alive" && git push
  ```

**"The scan is hitting the 15-min timeout"**
- Lower `MAX_DATES` in `amc-node.js` (e.g., to 7).

---

## How it works (one paragraph)

GitHub Actions spins up a fresh Ubuntu VM every 10 minutes (and on every push to `main`). It runs `amc-node.js`, which uses headless Chrome via Puppeteer to open the AMC showtimes page, click through each date, identify IMAX 70mm showings of the movies in the watch list, then loads each showtime's seat map and counts available seats in the target zone. If a showtime has 2+ seats, it sends an email immediately via Gmail SMTP (using an app password) to every recipient in `NOTIFY_EMAIL`. The VM is then torn down — nothing persists between runs.

---

## Required GitHub secrets

| Secret | What it is |
| --- | --- |
| `GMAIL_USER` | Gmail address to send from (e.g., `divyanshukhare@gmail.com`) |
| `GMAIL_APP_PASSWORD` | 16-char Gmail app password (generate at https://myaccount.google.com/apppasswords — requires 2FA) |
| `NOTIFY_EMAIL` | Comma-separated list of recipient addresses |

---

## Legacy: DevTools console script

The original [`amc-script.js`](./amc-script.js) runs in the browser DevTools console on the AMC site — useful for ad-hoc, one-off seat checks without touching this repo. See the [original project](https://github.com/NameFILIP/amc-good-seats) for that workflow.
