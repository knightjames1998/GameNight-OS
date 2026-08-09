import type { TitleNightCopy } from "../titlenight/TitleNight";

/**
 * The handful of strings Board Game does not share with Card Table.
 *
 * In its own file because the page and the TV both need it and neither should
 * import the other. Every sentence that reads correctly for both packs lives in
 * the layer instead; this is the short list of ones that do not.
 */
export const BOARD_GAME_COPY: TitleNightCopy = {
  leadPill: "♟ lead",
  setNowPlaying: "Set what is out",
  scoreNote:
    "Board games disagree about whether high or low wins, so the order you tapped is the result.",
  tvIdleHint: "Pick a box and tap it in",
};
