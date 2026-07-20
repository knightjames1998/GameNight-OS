// Sends magic link emails through Resend's REST API.
// Plain fetch instead of the Resend SDK: one POST doesn't justify a dependency.
//
// The code and link are logged to the console in EVERY environment on
// purpose. This is the deliberate fallback path for when delivery is slow or
// misrouted: someone can always be read their code out of the Render Logs
// tab. It is not tied to any Resend tier restriction, so it stays.

// FROM lives on a sending SUBDOMAIN (mail.gamenightos.app), not the root
// domain, so bounce reputation from login email can never touch the domain
// the app itself is served from. Read from env so the address can be changed
// on Render without a deploy; the default is the verified sending domain.
const FROM = process.env.MAIL_FROM ?? "GameNight OS <login@mail.gamenightos.app>";

export async function sendMagicLink(email: string, url: string, code: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;

  // The fallback path when email is slow or misrouted (see file header).
  console.log(`[magic-link] ${email} code=${code} link=${url}`);
  if (!key) {
    // A missing key used to return silently, producing an empty Resend log
    // and no error anywhere. Say so loudly instead.
    console.error("[magic-link] RESEND_API_KEY missing, email not sent");
    return;
  }

  // A reply-to so a friend hitting reply reaches a real mailbox instead of
  // bouncing off the send-only FROM address. Omitted entirely when unset; no
  // invented fallback.
  const replyTo = process.env.MAIL_REPLY_TO;

  const payload: Record<string, unknown> = {
    from: FROM,
    to: [email],
    subject: "Your GameNight OS login code",
    html: [
      `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">`,
      `<h2>GameNight OS</h2>`,
      `<p>Enter this code in the app to log in. It expires in 10 minutes.</p>`,
      `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;`,
      `font-size:40px;font-weight:700;letter-spacing:10px;`,
      `padding:16px 4px;color:#171717">${code}</div>`,
      `<p style="color:#555;font-size:13px;margin-top:20px">Or log in on this device:</p>`,
      `<p><a href="${url}" style="display:inline-block;background:#171717;color:#fff;`,
      `padding:12px 24px;border-radius:8px;text-decoration:none">Log in</a></p>`,
      `<p style="color:#888;font-size:12px">If you didn't request this, ignore it.</p>`,
      `</div>`,
    ].join(""),
  };
  if (replyTo) payload.reply_to = replyTo;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error(`[magic-link] Resend error ${res.status}: ${await res.text()}`);
    return;
  }
  const body = (await res.json().catch(() => ({}))) as { id?: string };
  console.log(`[magic-link] Resend ok ${res.status} id=${body.id ?? "?"}`);
}
