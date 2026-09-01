/**
 * The one HTML shell every outbound email is rendered through — shared
 * between apps/api's MailerService (invitation email) and apps/worker's
 * EmailProcessor (NotificationService-driven emails), same "shared, pure,
 * framework-free" precedent as ./notifications.ts's `interpolate`. Table-based
 * layout + inline styles throughout because Gmail/Outlook strip or mangle
 * <style> blocks and flexbox/grid — this is the email-safe subset of the
 * app's navy (#001B3A) / cream (#f5eed4) brand, not the Tailwind tokens
 * `apps/web` uses (globals.css's CSS custom properties don't survive into an
 * email client).
 */
export interface EmailTemplateParams {
  schoolName: string;
  logoUrl?: string | null;
  /** Hidden preview text shown next to the subject line in an inbox list. Defaults to `heading`. */
  preheader?: string;
  heading: string;
  /** Pre-escaped/trusted HTML for the message body (a `<p>`, or a few). Plain interpolated text should be escaped and `\n`-to-`<br>`'d by the caller before reaching here. */
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  /** e.g. the school's contact email/address, shown small in the footer. */
  footerNote?: string;
}

const NAVY = "#001B3A";
const CREAM = "#f5eed4";

/** `<p>`-wraps plain text and HTML-escapes it, converting blank lines into paragraph breaks — the shape `NotificationService`'s interpolated `bodyTemplate` strings are in. */
export function textToBodyHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 16px;">${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * Plain-text counterpart to `renderEmailHtml`, same params — sent as the
 * `text` part alongside `html` so the message is multipart/alternative
 * instead of HTML-only, which several mailbox providers weigh as a spam
 * signal (on top of it being the more accessible default for text-only
 * clients). `bodyHtml` is our own output (from `textToBodyHtml` or a literal
 * `<p>` at the call site) rather than arbitrary HTML, so a straightforward
 * tag-strip is enough here — no need for a full HTML parser.
 */
export function renderEmailText(params: EmailTemplateParams): string {
  const { heading, bodyHtml, ctaLabel, ctaUrl, footerNote } = params;

  const body = bodyHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

  const parts = [heading, "", body];
  if (ctaLabel && ctaUrl) parts.push("", `${ctaLabel}: ${ctaUrl}`);
  if (footerNote) parts.push("", footerNote);
  return parts.join("\n");
}

/**
 * `"School Name <email>"` for the Resend `from` field — a bare address with
 * no display name reads as less trustworthy to both spam filters and
 * recipients. Strips CR/LF defensively since `schoolName` is Admin-editable
 * (SchoolProfile.name) and ends up in a raw email header.
 */
export function formatFromAddress(schoolName: string, email: string): string {
  return `${schoolName.replace(/[\r\n]/g, "")} <${email}>`;
}

export function renderEmailHtml(params: EmailTemplateParams): string {
  const { schoolName, logoUrl, heading, bodyHtml, ctaLabel, ctaUrl, footerNote } = params;
  const preheader = params.preheader ?? heading;

  const logo = logoUrl
    ? `<img src="${logoUrl}" alt="${schoolName}" height="32" style="display:block;height:32px;width:auto;border:0;">`
    : `<span style="font-family:Georgia,'Times New Roman',serif;font-size:20px;line-height:32px;color:${CREAM};">${schoolName}</span>`;

  const cta =
    ctaLabel && ctaUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
          <tr>
            <td style="border-radius:6px;background-color:${NAVY};">
              <a href="${ctaUrl}" target="_blank" style="display:inline-block;padding:12px 28px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${ctaLabel}</a>
            </td>
          </tr>
        </table>`
      : "";

  // No "This is an automated message" boilerplate — only render a footer row
  // at all when there's a real footerNote (e.g. a contact email) to show.
  const footer = footerNote
    ? `<tr>
        <td style="padding:20px 32px;background-color:${CREAM};border-top:1px solid #e5ddc0;">
          <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#5a5642;">${footerNote}</p>
        </td>
      </tr>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${heading}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#eef0f2;font-family:Helvetica,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef0f2;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background-color:${NAVY};padding:20px 32px;">
                ${logo}
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.3;color:${NAVY};">${heading}</h1>
                <div style="font-size:15px;line-height:1.6;color:#333333;">${bodyHtml}</div>
                ${cta}
              </td>
            </tr>
            ${footer}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
