#!/usr/bin/env node
/*
 * AMC IMAX 70mm Seat Watcher — Lincoln Square, NYC
 *
 * One-shot scan. Designed to be invoked on a schedule (GitHub Actions cron).
 * Emails a summary via Gmail SMTP when target seats are available.
 *
 * Env vars (required for email):
 *   GMAIL_USER          — Gmail address to send from
 *   GMAIL_APP_PASSWORD  — Gmail app password (2FA required)
 *   NOTIFY_EMAIL        — recipient address(es), comma-separated
 */

const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const nodemailer = require("nodemailer");
puppeteer.use(StealthPlugin());

// ─── Config ─────────────────────────────────────────────────────────────────

const MOVIES = [
  "project hail mary",
  "the odyssey",
  "dune: part three",
  "dune part three",
  "spider-man: brand new day",
  "spider-man brand new day",
  "avengers: doomsday",
  "avengers doomsday",
];

const THEATER_URL =
  "https://www.amctheatres.com/movie-theatres/new-york-city/amc-lincoln-square-13/showtimes";

const TARGET_ROWS = ["F", "G", "H", "J"];
const TARGET_COL_MIN = 9;
const TARGET_COL_MAX = 39;

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const NOTIFY_EMAILS = (process.env.NOTIFY_EMAIL || "")
  .split(",")
  .map((e) => e.trim())
  .filter(Boolean);

// ─── Helpers ────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ts() {
  return new Date().toLocaleString();
}

function log(msg) {
  console.log(`[${ts()}] ${msg}`);
}

async function sendEmail(subject, html) {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || NOTIFY_EMAILS.length === 0) {
    log("GMAIL_USER / GMAIL_APP_PASSWORD / NOTIFY_EMAIL not set — skipping email.");
    return;
  }
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
  try {
    await transporter.sendMail({
      from: `"AMC Watcher" <${GMAIL_USER}>`,
      to: NOTIFY_EMAILS,
      subject,
      html,
    });
    log(`Email sent to ${NOTIFY_EMAILS.join(", ")}.`);
  } catch (err) {
    log(`Email send failed: ${err.message}`);
  }
}

// ─── Scraping ───────────────────────────────────────────────────────────────

async function getShowtimes(page, date) {
  const url = date ? `${THEATER_URL}?date=${date}` : THEATER_URL;
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(2000);

  return page.evaluate((movieTerms) => {
    const links = document.querySelectorAll("a[href*='/showtimes/']");
    const results = [];

    for (const link of links) {
      const href = link.href;
      const idMatch = href.match(/\/showtimes\/(\d+)/);
      if (!idMatch) continue;

      const showtimeId = idMatch[1];
      const timeText = link.innerText.trim().split("\n")[0];
      const isSoldOut = link.innerText.includes("Sold Out");

      const formatLi = link.closest("ul")?.closest("li");
      const isImax70mm = formatLi
        ? (formatLi.innerText || "").includes("IMAX 70MM")
        : false;
      if (!isImax70mm) continue;

      const section = link.closest("section");
      const movieHeading = section?.querySelector("h1");
      const movieName = movieHeading ? movieHeading.innerText.trim() : "";

      const lower = movieName.toLowerCase();
      const matches = movieTerms.some((term) => lower.includes(term));
      if (!matches) continue;

      results.push({
        id: showtimeId,
        movie: movieName,
        time: timeText,
        soldOut: isSoldOut,
      });
    }
    return results;
  }, MOVIES);
}

async function getAvailableDates(page) {
  await page.goto(THEATER_URL, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(2000);

  return page.evaluate(() => {
    const options = document.querySelectorAll('select[name="date"] option');
    return Array.from(options)
      .map((o) => o.value)
      .filter((v) => v && /^\d{4}-\d{2}-\d{2}$/.test(v));
  });
}

async function getAvailableSeats(page, showtimeId) {
  const url = `https://www.amctheatres.com/showtimes/${showtimeId}`;
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(3000);

  return page.evaluate(
    (rows, colMin, colMax) => {
      const inputs = document.querySelectorAll("input[aria-label]");
      const available = [];
      for (const input of inputs) {
        const label = input.getAttribute("aria-label");
        if (label.startsWith("Occupied")) continue;
        const match = label.match(/([A-Z])(\d+)$/);
        if (!match) continue;
        const row = match[1];
        const col = parseInt(match[2], 10);
        if (rows.includes(row) && col >= colMin && col <= colMax) {
          available.push(row + col);
        }
      }
      available.sort((a, b) => {
        if (a[0] !== b[0]) return a[0].localeCompare(b[0]);
        return parseInt(a.slice(1)) - parseInt(b.slice(1));
      });
      return available;
    },
    TARGET_ROWS,
    TARGET_COL_MIN,
    TARGET_COL_MAX
  );
}

// ─── Scan ───────────────────────────────────────────────────────────────────

async function runFullScan(page) {
  log("Scanning AMC Lincoln Square 13 — IMAX 70mm");
  log(`Target: ${MOVIES.join(", ")}`);
  log(`Seats: rows ${TARGET_ROWS.join("/")} cols ${TARGET_COL_MIN}-${TARGET_COL_MAX}`);

  const dates = await getAvailableDates(page);
  log(`${dates.length} dates with showtimes${dates.length ? ` (${dates[0]} -> ${dates[dates.length - 1]})` : ""}`);

  const findings = [];

  for (const date of dates) {
    const showtimes = await getShowtimes(page, date);
    if (showtimes.length === 0) continue;

    log(`  ${date}: ${showtimes.length} IMAX 70mm showtime(s)`);

    for (const st of showtimes) {
      if (st.soldOut) {
        log(`    ${st.time} ${st.movie} — SOLD OUT`);
        continue;
      }

      const seats = await getAvailableSeats(page, st.id);
      if (seats.length > 0) {
        log(`    ${st.time} ${st.movie} — ${seats.length} seats: ${seats.join(", ")}`);
        findings.push({ date, time: st.time, movie: st.movie, id: st.id, seats });
      } else {
        log(`    ${st.time} ${st.movie} — no target seats`);
      }

      await sleep(1000 + Math.random() * 1000);
    }
  }

  if (findings.length === 0) {
    log("No target seats found this scan.");
    return;
  }

  log(`Found ${findings.length} showtime(s) with target seats. Sending email.`);

  const subject = `AMC IMAX 70mm: ${findings.length} showtime(s) with target seats`;
  const html =
    `<p>Target seats available (rows ${TARGET_ROWS.join("/")}, cols ${TARGET_COL_MIN}-${TARGET_COL_MAX}):</p>` +
    findings
      .map(
        (f) => `
<div style="margin-bottom:16px;padding:12px;border-left:3px solid #d32f2f;">
  <div><strong>${f.movie}</strong></div>
  <div>${f.date} &middot; ${f.time}</div>
  <div>Seats (${f.seats.length}): ${f.seats.join(", ")}</div>
  <div><a href="https://www.amctheatres.com/showtimes/${f.id}">Book now →</a></div>
</div>`
      )
      .join("");

  await sendEmail(subject, html);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

async function main() {
  log("AMC IMAX 70mm Seat Watcher — single scan");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  let exitCode = 0;
  try {
    await runFullScan(page);
  } catch (err) {
    log(`Scan error: ${err.stack || err.message}`);
    exitCode = 1;
  } finally {
    await browser.close();
  }
  process.exit(exitCode);
}

main();
