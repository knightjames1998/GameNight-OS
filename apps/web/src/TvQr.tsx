import { QRCodeSVG } from "qrcode.react";

// ONE QR SLOT FOR TWELVE TELEVISIONS, and what is shared here is deliberately
// NOT a header.
//
// STANDING RULE 3 HAS NO EXCEPTIONS: a TV mode is styled in that mode's own
// design language, never a generic one. So a `<TvHeader>` that rendered each
// pack's name in one shared style would be the wrong answer even though it
// would be less code. What is shared instead is A LAYOUT CONTRACT AND A CODE:
// every pack already has a brand row, every pack keeps its own markup, type,
// colours and class names, and every pack gains ONE MORE CHILD at the end of
// that row. Nothing in this file knows what a pack looks like.
//
// LAID OUT, NOT OVERLAID, and that is the whole reason this shape was chosen.
// The corner overlay it replaces was measured on 2026-08-29 against every case
// in both themes and no corner was clear at any size (see BACKLOG). A fixed
// overlay cannot move what is under it, which is its appeal and exactly why it
// cannot promise not to cover anything. A row child moves content instead.

/**
 * THE WHITE PLATE IS FUNCTIONAL, NOT A STYLE CHOICE, which is why it is the one
 * part of this that does not bend to a pack's design language.
 *
 * A camera needs contrast and a quiet zone, and this lands on a pack's own
 * painted board: felt, a casino baize, a Smash red. Every QR already shipped in
 * this app does the same thing (TvPage and EventTvPage render dark on the
 * default white, Beerio sets bgColor explicitly), and it is the same reasoning
 * that made .gn-connpill opaque rather than translucent.
 *
 * The colours live in index.css as tokens that are DELIBERATELY IDENTICAL in
 * both themes, so the theme sweep measures them and confirms that rather than
 * the sweep having a blind spot where a functional exemption is.
 */

/**
 * The smallest code worth putting on a television.
 *
 * The app's own two shipped answers agree on roughly this floor: ETV_QR bottoms
 * out at 88 and BEERIO_QR_PX at 96. Below it a phone camera has to be walked
 * toward the screen, which defeats the point of it being on the screen. A pack
 * whose ladder cannot afford 88px does not get a smaller code, it gets a
 * conversation: a code nobody can scan is the feature not shipping while
 * looking like it did.
 */
export const TV_QR_MIN = 88;

/** The master URL every TV points at. One page, every pack. */
export function liveUrl(eventId: string): string {
  return `${window.location.origin}/e/${eventId}/live`;
}

export default function TvQr({ eventId, size }: { eventId: string; size: number }) {
  // NO EVENT, NO CODE. Every pack TV resolves its id as
  // `prop ?? params.eventId ?? ""`, so an empty string is a state that already
  // reaches these screens, and a code for `/e//live` is a code that sends a
  // guest to a 404 while looking exactly like a working one.
  if (!eventId) return null;
  // A pack passes its own band-derived number, because QRCodeSVG takes a number
  // and cannot ride the CSS variables the rest of a ladder spends. Same reason
  // ETV_QR is a table of numbers rather than a custom property.
  const px = Math.max(TV_QR_MIN, Math.round(size));
  return (
    <div className="gn-tvqr" data-qr>
      {/* THE TOKENS, NOT THE HEX. Both shipped QRs in this app pass a literal
          #17111f, which is the same ink twice in two files, and the plate under
          this one is painted from a token in index.css. Two spellings of one
          colour is how a code and its own plate drift apart. qrcode.react's SVG
          renderer puts these straight onto SVG fill, which takes var(). */}
      <QRCodeSVG
        value={liveUrl(eventId)}
        size={px}
        fgColor="var(--gn-qr-ink)"
        bgColor="var(--gn-qr-plate)"
      />
      <span className="gn-tvqr__cap">Standings on your phone</span>
    </div>
  );
}
