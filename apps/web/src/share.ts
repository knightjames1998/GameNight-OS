// Shared Web Share helpers, used by the event Share control and the night
// recap card. navigator.share when available (iOS PWA, Android), otherwise
// fall back: clipboard for a link, download for an image.

export type ShareLinkResult = "shared" | "copied" | "failed";

export async function shareLink(data: { title: string; text: string; url: string }): Promise<ShareLinkResult> {
  if (navigator.share) {
    try {
      await navigator.share(data);
      return "shared";
    } catch {
      // User cancelled, or the share sheet failed. Don't silently copy on
      // top of a deliberate cancel; the caller shows nothing on "failed".
      return "failed";
    }
  }
  try {
    await navigator.clipboard.writeText(data.url);
    return "copied";
  } catch {
    return "failed";
  }
}

export type ShareImageResult = "shared" | "unavailable";

export async function shareImage(blob: Blob, filename: string, title: string): Promise<ShareImageResult> {
  const file = new File([blob], filename, { type: blob.type || "image/jpeg" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch {
      // Cancelled or failed; the caller offers Download as the fallback.
      return "unavailable";
    }
  }
  return "unavailable";
}
