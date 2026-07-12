// Sends magic link emails through Resend's REST API.
// Plain fetch instead of the Resend SDK: one POST doesn't justify a dependency.
//
// Links are logged to the console in ALL environments for now. Pre-launch,
// this is how second users get their login links while Resend's free tier
// only delivers to the account owner's email. On a published deployment,
// find these lines in the Deployment's Logs tab.
// TODO Phase 6: once the domain is verified in Resend, stop logging in production.

const FROM = "GameNight OS <onboarding@resend.dev>";

export async function sendMagicLink(email: string, url: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;

  console.log(`[magic-link] ${email} -> ${url}`);
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
    console.error(`[magic-link] Resend error ${res.status}: ${await res.text()}`);
  }
}
