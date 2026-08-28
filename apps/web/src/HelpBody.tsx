// The guide's copy, in its own chunk. See HelpModal for why it is lazy.
//
// THE CONTENT RULE, AND IT IS THE ONE THING TO READ BEFORE EDITING THIS FILE:
// NO PACK NAMES AND NO COUNTS. Not "fourteen packs", not "Smash, Mario Kart and
// Blackjack". Every one of those is a thing that has to be edited on the next
// pack ship, and it will not be, and then the guide is quietly lying to the
// person who opened it BECAUSE they were confused. Describe the picker and what
// a pack does; let the picker be the list of packs.

export default function HelpBody() {
  return (
    <div className="gn-help">
      <section>
        <h3 className="gn-help__h">Crews</h3>
        <p>A crew is the group you play with, and everything belongs to one.</p>
      </section>
      <section>
        <h3 className="gn-help__h">Game nights</h3>
        <p>A night is one get-together. Make one, and people say if they are in.</p>
      </section>
      <section>
        <h3 className="gn-help__h">Playing a game</h3>
        <p>Open the game picker on a night and choose what you are playing.</p>
      </section>
      <section>
        <h3 className="gn-help__h">The TV view</h3>
        <p>Every mode has a big-screen view for whatever is in the room.</p>
      </section>
      <section>
        <h3 className="gn-help__h">Stats</h3>
        <p>Finished games feed a lifetime record for everybody who played.</p>
      </section>
    </div>
  );
}
