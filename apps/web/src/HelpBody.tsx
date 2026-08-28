// The guide's copy, in its own chunk. See HelpModal for why it is lazy.
//
// THE CONTENT RULE, AND IT IS THE ONE THING TO READ BEFORE EDITING THIS FILE:
// NO PACK NAMES AND NO COUNTS. Not "fourteen packs", not "Smash, Mario Kart and
// Blackjack". Every one of those is a thing that has to be edited on the next
// pack ship, and it will not be, and then the guide is quietly lying to the
// person who opened it BECAUSE they were confused. Describe the picker and what
// a pack does; LET THE PICKER BE THE LIST OF PACKS. It is always right and this
// file cannot be.
//
// SHORT, for the same reason. Somebody opens this because they are confused
// right now, standing in a room with people waiting, not to read a manual. Five
// sections, a few lines each, in the order somebody meets them.
//
// No em dash in any of its four encodings; copy-rules.test.ts scans this file
// like every other, and this is the largest block of prose the app has shipped.

export default function HelpBody() {
  return (
    <div className="gn-help">
      <section>
        <h3 className="gn-help__h">Crews</h3>
        <p>
          A crew is the group you play with, and it is the thing everything else
          belongs to: your nights, your games and your records all sit inside one.
          Make a crew, then send the invite link. Anyone who opens it joins.
        </p>
        <p>
          You do not need one to start. Playing on your own works straight away,
          and it quietly keeps its own history, so nothing you record is lost if
          you make a crew later.
        </p>
      </section>

      <section>
        <h3 className="gn-help__h">Game nights</h3>
        <p>
          A night is one get-together. Make one inside a crew, and everybody says
          whether they are in, out or a maybe. The date is optional: a night with
          no date yet is fine, and you can set it later.
        </p>
        <p>
          When the night happens, the host can mark who actually turned up. If it
          is a regular thing, set the night to repeat and the next one appears on
          its own once this one has passed.
        </p>
      </section>

      <section>
        <h3 className="gn-help__h">Playing a game</h3>
        <p>
          Open a night and pick from the game list. Each one asks for what it
          needs, which is usually who is playing and what format you are running.
        </p>
        <p>
          The host runs the game from their phone and everybody else is watching
          the same session, live, rather than their own separate copy. Scores and
          results update on every screen at once.
        </p>
      </section>

      <section>
        <h3 className="gn-help__h">The TV view</h3>
        <p>
          Every game has a big-screen version built for the room: standings,
          scores and whatever is happening right now, in type you can read from
          the sofa. Open it on a TV, a laptop or a tablet.
        </p>
        <p>
          It is read-only and it needs no login, so the link is safe to hand to
          anybody. Scan the code on screen and your phone lands on the scoring
          view for that game.
        </p>
      </section>

      <section>
        <h3 className="gn-help__h">Stats</h3>
        <p>
          Finished games feed a lifetime record for everybody who played: wins,
          placings, streaks and who you win with. It builds up on its own; there
          is nothing to fill in.
        </p>
        <p>
          Guests typed in by name do not carry stats, because the app does not
          know who they are. If a guest turns out to be a member, link them and
          their past results are credited back.
        </p>
      </section>
    </div>
  );
}
