// The guide itself: the dialog, and everything that only matters once it is
// open. Kept OUT of the entry chunk, and the bundle budget is what said so.
//
// THE SHELL ALONE COST 836 GZIPPED BYTES on the entry path, which the headroom
// gate rejected the moment it was measured against a real build. That is the
// test doing its job: a focus trap, an iOS scroll lock and a close-by-history
// rule are all code that literally cannot run until somebody has tapped the
// trigger, so none of it belongs in the bytes every visitor downloads before
// seeing anything. HelpModal.tsx keeps only the param read and the opener.
//
// HelpBody is imported STATICALLY here rather than lazily again: they are opened
// together, always, so two chunks would be two round trips to show one screen.

import { useCallback, useEffect, useId, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { HELP_PARAM } from "./HelpModal";
import HelpBody from "./HelpBody";

// WHAT IS THIS APP? One modal, over whatever screen you are on.
//
// MOUNTED ONCE, GLOBALLY, the way ConnectionPill is: a single fixed-position
// mount in the App shell that reads its own state rather than anything on the
// tree below it. That is what makes the trigger just a button: it can go in the
// signed-in header, beside the signed-out brand, and anywhere a later session
// wants one, without any of them owning the modal or passing it anything.
//
// THE OPEN STATE LIVES IN A SEARCH PARAM, NOT IN useState, AND THAT IS THE WHOLE
// DESIGN. A modal held in component state has no answer for the Android back
// gesture: back leaves the screen, or closes the app, while the modal is sitting
// open on top of it. The obvious fix is to push a history entry by hand and
// listen for popstate, and hand-rolling that inside a react-router app is how
// this project got its ghost-history double-back bug.
//
// `?help=1` on the CURRENT route sidesteps both. It is a real history entry, so
// Android back closes the modal natively and nothing here listens for anything;
// and because it rides the current route rather than being one, it is still a
// modal over whatever you were looking at.
//
// THE PARAM IS READ REACTIVELY, never captured. Same-route navigations do not
// remount, so a value read once at mount would be frozen at whatever the URL
// said when the app started; and `location.search` cached at module scope is a
// trap this app has already fallen into once.

export default function HelpDialog() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const open = params.get(HELP_PARAM) === "1";

  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  // Who to give focus back to. Captured on open rather than passed in, so a
  // trigger added later gets this for free.
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const close = useCallback(() => {
    // WE PUSHED IT, SO WE POP IT. Going back consumes the entry we added, which
    // leaves the history exactly as it was before the modal opened. Landing
    // here directly (a pasted link, a reload with the param on) has no entry of
    // ours to consume, so that case strips the param in place instead of
    // walking back out of the app.
    if ((location.state as { help?: boolean } | null)?.help) {
      navigate(-1);
      return;
    }
    const next = new URLSearchParams(params);
    next.delete(HELP_PARAM);
    setParams(next, { replace: true });
  }, [location.state, navigate, params, setParams]);

  // ---- escape, focus, and the scroll lock --------------------------------

  useEffect(() => {
    if (!open) return;
    // On the document rather than the panel: Escape has to work wherever focus
    // has wandered to, including the backdrop.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    // The close control rather than the panel, so the first Tab lands inside
    // and a screen reader announces something actionable.
    closeRef.current?.focus();
    const opener = openerRef.current;
    return () => {
      // Back to where they were. A reader returned to the top of the document
      // has to find their place again on every close.
      opener?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // THE iOS SCROLL LOCK, WHICH IS NOT `overflow: hidden`. On iOS Safari that
    // alone does not stop the page behind a fixed overlay from scrolling, and
    // the position:fixed trick that does stop it THROWS THE PAGE TO THE TOP,
    // because a fixed body has no scroll offset. So the offset is captured,
    // applied as a negative top while locked, and scrolled back on release.
    // Getting only half of this right is the jump-to-top bug.
    const y = window.scrollY;
    const body = document.body;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${y}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, y);
    };
  }, [open]);

  /** Keep Tab inside the dialog while it is the only thing on screen. */
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="gn-modal"
      // MOUSEDOWN, NOT CLICK, and the target check with it. A drag that starts
      // on the text and releases past the panel edge fires a CLICK on the
      // backdrop, so a click handler closes the guide on somebody who was
      // selecting a sentence.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="gn-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
        onKeyDown={trap}
      >
        {/* FIXED WHILE THE BODY SCROLLS. Five sections do not fit a phone, and a
            close control that scrolls away leaves the back gesture as the only
            way out on a screen somebody opened because they were already lost. */}
        <div className="gn-modal__bar">
          <h2 className="gn-h2" id={titleId} style={{ margin: 0 }}>
            How GameNight works
          </h2>
          <button className="gn-textbtn" onClick={close} ref={closeRef}>
            close
          </button>
        </div>
        <div className="gn-modal__body">
          <HelpBody />
        </div>
      </div>
    </div>
  );
}
