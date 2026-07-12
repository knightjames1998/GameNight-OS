// Sends magic link emails through Resend's REST API.
// Plain fetch instead of the Resend SDK: one POST doesn't justify a dependency.
//
// Dev behavior: when RESEND_API_KEY is missing, or when not in production,
// the link is also printed to the server console. That's how you test a
// second user while Resend's free tier only delivers to your own email:
// request a link for any address, copy it from the console, open it in a
// private browser tab.

const FROM = "GameNight OS <onboarding@resend.dev>";

export async function sendMagicLink(email: string, url: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const isProd = process.env.NODE_ENV === "production";

  if (!key || !isProd) {
    console.log(`[magic-link] ${email} -> ${url}`);
  }
  if (!key) return;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [email],
      subject: "Your GameNight OS login link",
      html: [
        `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">`,
        `<h2>GameNight OS</h2>`,
        `<p>Tap the button to log in. This link works once and expires in 15 minutes.</p>`,
        `<p><a href="${url}" style="display:inline-block;background:#171717;color:#fff;`,
        `padding:12px 24px;border-radius:8px;text-decoration:none">Log in</a></p>`,
        `<p style="color:#888;font-size:12px">If you didn't request this, ignore it.</p>`,
        `</div>`,
      ].join(""),
    }),
  });

  if (!res.ok) {
    // Don't crash login over an email hiccup; the console log above still
    // has the link in non-production.
    console.error(`[magic-link] Resend error ${res.status}: ${await res.text()}`);
  }
}
