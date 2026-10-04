# Flip 7 Score Keeper

A fast, offline score keeper for the [Flip 7](https://boardgamegeek.com/boardgame/420087/flip-7) card game. It's an installable web app (PWA) with no build step. It's plain HTML, CSS and JS, deployed to GitHub Pages.

## Features

- **Tap-to-score:** tap the number cards and modifiers in front of a player and the app does the math (×2 doubles number cards only, then +2…+10, then +15 for a Flip 7). You can also type a total.
- **Bank or bust:** no freeze picker or action-card tracking. A frozen player just banks their points.
- **Fast round flow:** after you score one player, the sheet moves to the next player who hasn't scored. When the round is complete you get a summary and a "Start round N" button.
- **Dealer rotation:** you pick who deals first, and the dealer moves one seat each round.
- **Correct endgame:** the game ends after the round in which someone reaches the target. A tie at the top means everyone plays another round.
- **Fix anything:** tap any cell in History to re-score that round, and undo works for every action.
- **Stats:** a race chart, per-player averages, best round, bust rate, Flip 7 count, and an all-time win record.
- **Installable and offline:** includes a manifest, service worker and icons. It also keeps the screen awake during a game.
- **Stays on your device:** players, scores and records are saved only in this browser, never on a server. Anyone opening the link on their own phone starts with an empty app. *Clear everything* in the menu wipes it.
- Light and dark themes (follows the system by default), sized for phones, with safe-area support.

## Development

Serve the folder with any static server, for example:

```sh
npx http-server -c-1 .
```

The service worker fetches app files network-first, so a normal deploy needs no cache-busting. Bump `VERSION` in `sw.js` only when the worker itself or its precache list changes.
