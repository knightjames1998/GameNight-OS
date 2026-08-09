import type { TitleNightCopy } from "../titlenight/TitleNight";

/**
 * The handful of strings Card Table does not share with Board Game.
 *
 * In its own file because the page and the TV both need it and neither should
 * import the other. Every sentence that reads correctly for both packs lives in
 * the layer instead; this is the short list of ones that do not.
 */
export const CARD_TABLE_COPY: TitleNightCopy = {
  leadPill: "♠ lead",
  setNowPlaying: "Set what you are dealing",
  scoreNote:
    "Card games disagree about whether high or low wins, so the order you tapped is the result.",
  tvIdleHint: "Deal something and tap it in",
};
