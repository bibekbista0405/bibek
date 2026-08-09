// api/contact.js
// Vercel serverless function — POST /api/contact
//
// Handles the portfolio's "Hire Me" form: validates + sanitizes the
// submission, applies basic rate limiting and a honeypot spam check,
// then sends a real email via Resend to both configured recipients
// with Reply-To set to the visitor so you can just hit "Reply".
//
// THE ONLY THING YOU NEED TO CONFIGURE IS IN .env — see
// README.md → "EMAIL SETUP — START HERE" at the top of this project.

const { Resend } = require("resend");

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MAX = 3; // max submissions per IP per window
const MESSAGE_MAX_LEN = 5000;
const NAME_MAX_LEN = 200;
const COMPANY_MAX_LEN = 200;
const ROLE_MAX_LEN = 200;

// Best-effort in-memory rate limit. Serverless instances are ephemeral,
// so this resets on cold start — it is NOT a hard guarantee, but it
// does catch rapid repeated submissions hitting a warm instance, which
// is the common abuse case. For stronger guarantees, swap this for a
// persistent store (e.g. Upstash Redis / Vercel KV).
const submissionLog = new Map(); // ip -> array of timestamps

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (submissionLog.get(ip) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  timestamps.push(now);
  submissionLog.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT_MAX;
}

const EMAIL_RE = /^[^\s@"<>]+@[^\s@"<>]+\.[^\s@"<>]+$/;

// Strip characters that could be used for header injection in any field
// that might end up near email headers (name, email, company, role).
function stripHeaderChars(str) {
  return String(str || "").replace(/[\r\n]+/g, " ").trim();
}

// Escape for safe insertion into the HTML email body.
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const OPPORTUNITY_LABELS = {
  "A role": "Job Opportunity",
  "An internship": "Internship",
  "A project": "Freelance Project",
  "A collaboration": "Collaboration",
  "Just talking": "Other",
};

function subjectFor(lookingFor, name) {
  const label = OPPORTUNITY_LABELS[lookingFor] || "Other";
  return `[Portfolio] ${label} — ${name}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ success: false, error: "Method not allowed." });
    return;
  }

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  if (isRateLimited(ip)) {
    res.status(429).json({
      success: false,
      error: "Too many messages sent recently. Please try again in a bit.",
    });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body || {};

  const { name, email, company, role, lookingFor, message, website } = body;

  // Honeypot: real visitors never fill this hidden field.
  if (website) {
    // Reject quietly — no "you're a bot" message, just a generic failure
    // so scripted submitters don't learn the field is being checked.
    res.status(400).json({ success: false, error: "Submission rejected." });
    return;
  }

  // --- Validation ---
  const cleanName = stripHeaderChars(name).slice(0, NAME_MAX_LEN);
  const cleanEmail = stripHeaderChars(email);
  const cleanCompany = stripHeaderChars(company).slice(0, COMPANY_MAX_LEN);
  const cleanRole = stripHeaderChars(role).slice(0, ROLE_MAX_LEN);
  const cleanMessage = String(message || "").trim();

  if (!cleanName) {
    res.status(400).json({ success: false, error: "Name is required." });
    return;
  }
  if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) {
    res
      .status(400)
      .json({ success: false, error: "A valid email address is required." });
    return;
  }
  if (!cleanMessage) {
    res.status(400).json({ success: false, error: "Message is required." });
    return;
  }
  if (cleanMessage.length > MESSAGE_MAX_LEN) {
    res.status(400).json({
      success: false,
      error: `Message is too long (max ${MESSAGE_MAX_LEN} characters).`,
    });
    return;
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const CONTACT_EMAIL_TO = process.env.CONTACT_EMAIL_TO;
  const EMAIL_FROM = process.env.EMAIL_FROM;

  const recipients = String(CONTACT_EMAIL_TO || "")
    .split(",")
    .map((addr) => addr.trim())
    .filter((addr) => addr && EMAIL_RE.test(addr));

  if (
    !RESEND_API_KEY ||
    RESEND_API_KEY === "PASTE_YOUR_RESEND_API_KEY_HERE" ||
    recipients.length === 0 ||
    !EMAIL_FROM
  ) {
    console.error(
      "Contact form is not configured: RESEND_API_KEY, CONTACT_EMAIL_TO (comma-separated), and EMAIL_FROM must all be set in .env — see README.md."
    );
    res.status(500).json({
      success: false,
      error: "Server isn't configured to send email yet.",
    });
    return;
  }

  const subject = subjectFor(lookingFor, cleanName);
  const opportunityLabel = OPPORTUNITY_LABELS[lookingFor] || "Other";
  const timestamp = new Date().toISOString();

  const htmlBody = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#2A2521;">
      <h2 style="margin:0 0 4px;">New portfolio inquiry</h2>
      <hr style="border:none;border-top:1px solid #ddd;margin:16px 0;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:4px 0;color:#5B5349;width:120px;">Name</td><td style="padding:4px 0;"><strong>${escapeHtml(cleanName)}</strong></td></tr>
        <tr><td style="padding:4px 0;color:#5B5349;">Email</td><td style="padding:4px 0;">${escapeHtml(cleanEmail)}</td></tr>
        ${cleanCompany ? `<tr><td style="padding:4px 0;color:#5B5349;">Company</td><td style="padding:4px 0;">${escapeHtml(cleanCompany)}</td></tr>` : ""}
        ${cleanRole ? `<tr><td style="padding:4px 0;color:#5B5349;">Position</td><td style="padding:4px 0;">${escapeHtml(cleanRole)}</td></tr>` : ""}
        <tr><td style="padding:4px 0;color:#5B5349;">Opportunity</td><td style="padding:4px 0;">${escapeHtml(opportunityLabel)}</td></tr>
        <tr><td style="padding:4px 0;color:#5B5349;">Submitted</td><td style="padding:4px 0;">${escapeHtml(timestamp)}</td></tr>
      </table>
      <hr style="border:none;border-top:1px solid #ddd;margin:16px 0;">
      <p style="color:#5B5349;margin:0 0 6px;">Message</p>
      <p style="white-space:pre-wrap;line-height:1.5;">${escapeHtml(cleanMessage)}</p>
      <hr style="border:none;border-top:1px solid #ddd;margin:16px 0;">
      <p style="color:#9a9082;font-size:12px;margin:0;">Source: Bibek Bista Portfolio</p>
    </div>
  `;

  const resend = new Resend(RESEND_API_KEY);

  try {
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: recipients,
      reply_to: cleanEmail,
      subject: subject,
      html: htmlBody,
    });

    if (error) {
      console.error("Resend API error:", error);
      res.status(502).json({
        success: false,
        error: "Email provider failed to deliver the message.",
      });
      return;
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Contact endpoint error:", err);
    res
      .status(500)
      .json({ success: false, error: "Unexpected server error." });
  }
};
