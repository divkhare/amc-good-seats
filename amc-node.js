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
  "the odyssey",
  "dune: part three",
  "dune part three",
  "spider-man: brand new day",
  "spider-man brand new day",
  "avengers: doomsday",
  "avengers doomsday",
];

const MIN_SHOWTIME_MINUTES = 13 * 60;

const THEATER_URL =
  "https://www.amctheatres.com/movie-theatres/new-york-city/amc-lincoln-square-13/showtimes";

const TEST_MODE = process.env.TEST_MODE === "true" || process.env.TEST_MODE === "1";

const MAX_DATES = 14;
const MIN_SEATS_FOR_EMAIL = 2;

const TARGET_ROWS = TEST_MODE
  ? ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P"]
  : ["F", "G", "H", "J"];
const TARGET_COL_MIN = TEST_MODE ? 1 : 9;
const TARGET_COL_MAX = TEST_MODE ? 100 : 39;

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

function parseShowtimeMinutes(timeText) {
  const m = timeText.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ampm = m[3].toLowerCase();
  if (ampm === "pm" && h !== 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  return h * 60 + min;
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

  const allDates = await getAvailableDates(page);
  const dates = allDates.slice(0, MAX_DATES);
  log(`Scanning ${dates.length} of ${allDates.length} dates${dates.length ? ` (${dates[0]} -> ${dates[dates.length - 1]})` : ""}`);

  let emailsSent = 0;
  let totalHits = 0;

  for (const date of dates) {
    const showtimes = await getShowtimes(page, date);
    if (showtimes.length === 0) continue;

    log(`  ${date}: ${showtimes.length} IMAX 70mm showtime(s)`);

    for (const st of showtimes) {
      if (st.soldOut) {
        log(`    ${st.time} ${st.movie} — SOLD OUT`);
        continue;
      }

      const stMinutes = parseShowtimeMinutes(st.time);
      if (stMinutes !== null && stMinutes < MIN_SHOWTIME_MINUTES) {
        log(`    ${st.time} ${st.movie} — before 1:00pm, skipping`);
        continue;
      }

      const seats = await getAvailableSeats(page, st.id);
      if (seats.length === 0) {
        log(`    ${st.time} ${st.movie} — no target seats`);
      } else if (seats.length < MIN_SEATS_FOR_EMAIL) {
        log(`    ${st.time} ${st.movie} — ${seats.length} seat (below ${MIN_SEATS_FOR_EMAIL}-seat threshold): ${seats.join(", ")}`);
      } else {
        totalHits++;
        log(`    ${st.time} ${st.movie} — ${seats.length} seats: ${seats.join(", ")} → emailing`);
        const subject = `AMC IMAX 70mm: ${seats.length} seats — ${st.movie} · ${date} ${st.time}`;
        const html = `
<div style="font-family:system-ui,sans-serif;">
  <h2 style="margin:0 0 8px 0;">${st.movie}</h2>
  <p style="margin:0 0 8px 0;color:#555;">${date} &middot; ${st.time}</p>
  <p style="margin:0 0 8px 0;"><strong>${seats.length} seat${seats.length === 1 ? "" : "s"} available</strong> in target zone (rows ${TARGET_ROWS.join("/")}, cols ${TARGET_COL_MIN}-${TARGET_COL_MAX}):</p>
  <p style="margin:0 0 12px 0;font-family:ui-monospace,monospace;">${seats.join(", ")}</p>
  <p style="margin:0;"><a href="https://www.amctheatres.com/showtimes/${st.id}">Book now →</a></p>
</div>`;
        await sendEmail(subject, html);
        emailsSent++;
      }

      await sleep(1000 + Math.random() * 1000);
    }
  }

  if (totalHits === 0) {
    log(`No showtimes with ${MIN_SEATS_FOR_EMAIL}+ target seats found this scan.`);
  } else {
    log(`Scan complete. ${emailsSent} email(s) sent for ${totalHits} showtime hit(s).`);
  }
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
