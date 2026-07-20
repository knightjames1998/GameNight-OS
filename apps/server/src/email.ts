// Sends magic link emails through Resend's REST API.
// Plain fetch instead of the Resend SDK: one POST doesn't justify a dependency.
//
// Links are logged to the console in ALL environments for now. Pre-launch,
// this is how second users get their login links while Resend's free tier
// only delivers to the account owner's email. On a published deployment,
// find these lines in the Deployment's Logs tab.
// TODO Phase 6: once the domain is verified in Resend, stop logging in production.

const FROM = "GameNight OS <onboarding@resend.dev>";

export async function sendMagicLink(email: string, url: string, code: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;

  // Logged in every environment: this is how additional users get in while
  // Resend's free tier only delivers to the account owner's inbox. Find
  // these lines in the Render Logs tab.
  console.log(`[magic-link] ${email} code=${code} link=${url}`);
  if (!key) {
    // A missing key used to return silently, producing an empty Resend log
    // and no error anywhere. Say so loudly instead.
    console.error("[magic-link] RESEND_API_KEY missing, email not sent");
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
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
    }),
  });

  if (!res.ok) {
    console.error(`[magic-link] Resend error ${res.status}: ${await res.text()}`);
    return;
  }
  const body = (await res.json().catch(() => ({}))) as { id?: string };
  console.log(`[magic-link] Resend ok ${res.status} id=${body.id ?? "?"}`);
}
