import { useEffect, useId, useRef, useState } from "react";
import { api } from "./api";
// The narrow subpath, not the barrel: this component is imported by EventPage,
// which is on the entry path, and `@gamenight/shared` drags every pack catalogue
// into the entry chunk. Same rule the safeurl and recurrence imports follow.
import type { Place } from "@gamenight/shared/places";

// THE LOCATION FIELD, WITH SEARCH BEHIND IT.
//
// FREE TEXT IS THE COMMON PATH, NOT THE FALLBACK, and every decision in this
// file follows from that. Most game nights are at somebody's house, and a house
// is not in OpenStreetMap. So "use what I typed" is a NORMAL ROW IN THE LIST on
// every search, including the ones that found something, styled exactly like the
// results above it. A host typing "Dave's place" has not done anything wrong and
// nothing here may imply otherwise: no warning colour, no "not found", no empty
// state that reads like a failure.
//
// THE TYPED TEXT IS ALWAYS THE VALUE. This is not a picker that owns the field;
// it is the field, with suggestions under it. Every keystroke updates the
// location the same way the plain input always did, so a host who ignores the
// list entirely gets exactly the behaviour they had before this shipped. Picking
// a place adds a pin to that; picking "as typed" just puts the list away.
//
// WHEN SEARCH IS UNAVAILABLE IT SAYS SO ONCE AND QUIETLY. Photon is free,
// unguaranteed and explicitly allowed to throttle us (see apps/server/places.ts).
// A geocoder that is not answering must degrade this to the plain text box it
// has always been: no error styling, no retry button, nothing to do about it.

/** How long the field waits before asking. A courtesy; the server has the limit. */
const DEBOUNCE_MS = 300;

/** Matches the server. Below this it does not ask and shows no list. */
const MIN_QUERY = 3;

interface Props {
  /** The location label. Always the typed text; this component never hides it. */
  value: string;
  onChange: (text: string) => void;
  /** The place a host picked, or null for free text. Owned by the parent. */
  picked: Place | null;
  onPick: (place: Place) => void;
  onUnpick: () => void;
}

export default function PlaceSearch({ value, onChange, picked, onPick, onUnpick }: Props) {
  const [results, setResults] = useState<Place[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  // Whether the host has put the list away for this query, by picking "as
  // typed" or pressing Escape. Typing anything opens it again.
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();

  // NEWEST WINS, TWO WAYS, and both earn their place. The abort stops a stale
  // request arriving at all, which is what keeps the list from flickering
  // through old answers while somebody types; the sequence number is what
  // guarantees the ORDER of what does arrive, because an abort is a request to
  // stop rather than a promise that nothing lands. Same shape as reqSeq in
  // usePackSession, for the same reason: rapid input races itself.
  const seq = useRef(0);
  const inflight = useRef<AbortController | null>(null);

  const query = value.trim();
  const searchable = !picked && query.length >= MIN_QUERY;

  useEffect(() => {
    if (!searchable) {
      inflight.current?.abort();
      setResults([]);
      setUnavailable(false);
      return;
    }
    const timer = setTimeout(() => {
      inflight.current?.abort();
      const controller = new AbortController();
      inflight.current = controller;
      const mine = ++seq.current;
      api<{ results: Place[]; unavailable: boolean }>(
        `/api/places/search?q=${encodeURIComponent(query)}`,
        { signal: controller.signal },
      )
        .then((r) => {
          if (mine !== seq.current) return;
          setResults(r.results);
          setUnavailable(r.unavailable);
        })
        .catch(() => {
          // An abort lands here too, and an abort is not a failure: it means a
          // newer query is already on its way, so saying "search is
          // unavailable" would flash that line on every fast typist.
          if (mine !== seq.current) return;
          setResults([]);
          setUnavailable(true);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, searchable]);

  useEffect(() => () => inflight.current?.abort(), []);

  // ---- the confirmed row -------------------------------------------------

  if (picked) {
    return (
      <div className="gn-place-picked">
        <span aria-hidden="true">📍</span>
        <span className="gn-place-picked__text">
          <span className="gn-places__name">{picked.name}</span>
          {picked.address && <span className="gn-places__sub">{picked.address}</span>}
        </span>
        {/* THE WAY BACK. A picked place with no way out is a trap: the host who
            picked the wrong Anchor has no route to the right one except
            cancelling the whole edit. */}
        <button
          type="button"
          className="gn-textbtn"
          onClick={() => {
            onUnpick();
            setDismissed(false);
          }}
        >
          change
        </button>
      </div>
    );
  }

  // ---- the field ----------------------------------------------------------

  // The row that is always there. It is LAST rather than first so a successful
  // search leads with what it found, and it is present even when the search
  // found nothing at all, which is the case a host at somebody's house hits
  // every single time.
  const rows: { key: string; name: string; sub: string; take: () => void }[] = [
    ...results.map((p) => ({
      key: p.ref,
      name: p.name,
      sub: p.address,
      take: () => {
        onPick(p);
        setDismissed(false);
        setActive(-1);
      },
    })),
    {
      key: "as-typed",
      name: `Use "${query}"`,
      sub: "Just the name, no map pin",
      take: () => {
        setDismissed(true);
        setActive(-1);
      },
    },
  ];

  const open = searchable && !dismissed && !unavailable;

  return (
    <div className="gn-places-wrap">
      <input
        className="gn-input"
        placeholder="Where (Dave's place, The Anchor)"
        value={value}
        maxLength={120}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          setDismissed(false);
          setActive(-1);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % rows.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i <= 0 ? rows.length - 1 : i - 1));
          } else if (e.key === "Enter" && active >= 0) {
            // Only when something is highlighted, so Enter on a plain typed
            // name does what it has always done rather than being swallowed.
            e.preventDefault();
            rows[active]!.take();
          } else if (e.key === "Escape") {
            setDismissed(true);
            setActive(-1);
          }
        }}
      />

      {open && (
        <ul className="gn-places" id={listId} role="listbox">
          {rows.map((row, i) => (
            <li key={row.key}>
              <button
                type="button"
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`gn-places__row${i === active ? " gn-places__row--on" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={row.take}
              >
                <span className="gn-places__name">{row.name}</span>
                {row.sub && <span className="gn-places__sub">{row.sub}</span>}
              </button>
            </li>
          ))}
          {/* ODbL REQUIRES THIS AND IT IS NOT DECORATION. The data is
              OpenStreetMap's, contributed by people, and using it without
              saying so is a licence breach rather than an oversight. In the
              list, where the data actually is. */}
          <li className="gn-places__attr">Places from OpenStreetMap contributors</li>
        </ul>
      )}

      {searchable && unavailable && (
        // ONE QUIET LINE. Not an error, not a retry button: there is nothing
        // for the host to do and the field still works perfectly as text.
        <p className="gn-hint">Place search is not answering right now. Typing a name still works.</p>
      )}
    </div>
  );
}
