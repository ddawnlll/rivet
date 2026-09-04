// Two-tone RIVET wordmark. "RI" renders dim (left), "VET" renders bright
// (right). Cell grammar: █ full block, ▀ top half, ▄ bottom half,
// _ background space, ^ foreground over background, ~ shadowed top half.
export const logo = {
  left: ["         ", "█▀▀█ ▀▀▀▀", "█▄▄█  ██ ", "█ ▄▄ ▀▀▀▀"],
  right: ["              ", "█  █ █▀▀█ ▀▀▀▀", "█  █ █^^^  ██ ", "▀▄▄▀ ▀~~▀  ██ "],
}

export const go = {
  left: ["    ", "    ", "    ", "    "],
  right: ["    ", "█▀▀█", "█▄▄█", "█ ▄▄"],
}

export const marks = "_^~,"
