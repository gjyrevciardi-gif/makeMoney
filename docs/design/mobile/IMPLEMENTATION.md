# Phone layout: what was built

Frontend only (`frontend/`, `docs/`). Desktop (900px and wider) is unchanged: the phone and desktop trees render side by side and CSS (`m-only` / `desk-only` in `frontend/app/mobile.css`) shows one of them. No existing colour was changed (`styles.css`, `reference.css`, `casino.css`, `admin.css` have no diff); the new CSS adds no colour value except `#111` and `#04281e`, copied from the existing filled controls.

## Screens

| Phase | Screen | Files |
|---|---|---|
| 1 | Shell: 56px header, section tabs, 60px bottom nav, slip bar | `components/shell/app-shell.tsx`, `components/sports/bet-slip.tsx` |
| 2 | Home | `components/home/mobile-home.tsx` |
| 3 | Live | `components/live/mobile-live.tsx` |
| 4 | Match page | `components/match/mobile-match.tsx` |
| 5 | Slip sheet and Bet placed | `components/sports/mobile-slip.tsx` |
| 6 | My Bets | `components/bets/mobile-my-bets.tsx` |
| 7 | Casino lobby | `components/casino/mobile-casino.tsx` |
| 8 | Account | `components/account/mobile-account.tsx` |
| 9 | Loading skeletons | `MobileHomeSkeleton` and one per screen |

Shared pieces: `PriceTriplet`, `TeamCrest` (neutral shield with initials, never a real crest), `lib/mobile.ts` (phone-only data hooks), Horse Racing and Esports glyphs in `sport-icon.tsx`.

## Wired to real data

Sports, boards, event odds, favourites in the casino, recent games, the session, the wallet and ledger, and the bets lists all use the existing queries. The win banner reads the player's own recent `WON` bets. The Live count and "Live" dot come from boards already loaded. Prices, stakes, returns and statuses are displayed exactly as the API sends them.

## Renders only when its data exists (hidden today)

Live clock, score, serving player, goal flash, stream marker, match tracker, possession and stats; boosted prices; Bet Builder; corners markets; the jackpot; live-dealer tables (and the "Live Casino" tab); HOT / NEW badges and "playing now" counts; the boosted marker on a pick; cash-out. Each is gated on a field that the platform does not send yet (`LiveInfo`, `BoostedOffer`, `Jackpot`, `LiveTable`, `CasinoGame.hot/isNew/playersNow`, `TicketBet.cashOutValue`). Open bets show "Cash Out Unavailable" because there is no sports cash-out in the backend.

## UI built but not saved (needs backend)

- **Accept any price changes** (slip): a local switch. It does not change how a moved price is confirmed.
- **Stay in control** (Account): the limit period and amount pickers work on screen, but **Save is disabled** and the card says nothing is stored or enforced. Take a break, Reality check and Self-exclusion are shown as "Not available yet".
- The age-verified badge is not shown (no field).

## Differences from the design

- Amounts are whole PTS (`formatPoints`), not euros; quick stakes add 5 / 10 / 25 / 50 points.
- Singles / Multiple reflects what the API accepts: one selection is a single, several are one multiple, so the other option is disabled.
- A started event keeps suspended (locked) prices, as before; the "Live" label means "started".
- "Bet Builder", "Corners" and "Stats" tabs appear only when data exists.

## Previewing everything locally

Run the frontend with `NEXT_PUBLIC_DEV_FIXTURES=1` (sports, casino, live details, boosted offer, jackpot, live tables) and `NEXT_PUBLIC_DEV_FIXTURE_SESSION=1` (a signed-in player with sample bets and ledger). Both are ignored in production builds; the build was grepped to confirm no fixture data ships. Bets still cannot be placed against fixture events.
