You're working in the makeMoney repo (Fool's Gold Club). First read AGENTS.md, PROJECT_SPEC.md and CURRENT_TASK.md. This is a separate frontend task from the owner: a new phone layout for the player app. Only touch frontend/ and docs/; don't touch games/, packages/ or backend/.

GOAL
Rebuild the player screens in frontend/ for phones (reference size 393 x 852) to match the design in docs/design/mobile/. Match its layout, content, sizes, states and interactions. Keep every colour the app uses today. Desktop (900px and wider) must keep working as it does now.

THE HARD RULE: COLOURS DON'T CHANGE
- Don't edit, add or remove any colour value anywhere. That covers the @theme block and :root in frontend/app/styles.css, every --ref-* variable and colour in frontend/app/reference.css, casino.css and admin.css.
- New UI uses only colours that already exist, through their variables: var(--ref-...) and var(--color-...). Never write a new hex, rgb(), hsl() or oklch() value. Two exceptions: copy the dark text that filled controls already use (#111 on yellow, #04281e on green) from the existing rules. A translucent mix of an existing variable is fine for glows and shadows.
- If a role has no existing colour, stop and ask me. Don't invent one.
- The screenshots in docs/design/mobile/screens/ were drawn in a different palette (gold on charcoal-green). Copy their layout, sizes, copy and behaviour, never their colours.
- Use the colour the app already uses for each role:
  - Page background: var(--ref-bg)
  - Cards, panels, the slip sheet: var(--ref-card)
  - Odds cells, chips, inputs, raised rows: var(--ref-cell), with var(--ref-cell-hover) on hover
  - Dividers and borders: var(--ref-line)
  - Secondary text: var(--ref-muted)
  - Prices: var(--ref-odds)
  - Selected price: var(--ref-yellow) fill with #111 text, as .ref-match-odds .odds-button[aria-pressed="true"] does now. The glow is a box-shadow in the same yellow.
  - Active tab and nav, primary buttons, slip bar, counts: var(--ref-green) with #04281e text, as .slip .btn-primary and .slip-bar do now
  - Balance, brand accent, Boosted badge, NEW badge, jackpot figure: var(--ref-yellow)
  - Live dot, LIVE label, HOT badge: var(--color-live), the same #ff6a3d that .ref-chip.live uses
  - Price up and down flashes: var(--color-good) with var(--color-good-soft), and var(--color-bad) with var(--color-bad-soft), as .odds-button.up and .down already do
  - Warnings, void, maintenance: var(--color-warn) with var(--color-warn-soft)
  - Win banner: var(--color-good-soft) fill, var(--color-good) border and accent
  - Backdrop behind the slip sheet: reuse the existing .slip-sheet-backdrop rule
  - Confetti: pieces in var(--ref-yellow), var(--ref-green), var(--color-good), var(--ref-odds) and var(--color-ink)
  - Team crests: a neutral shield in var(--ref-cell) with a var(--ref-line) edge and the team's three-letter initials. Never draw a club's real crest. If the API later provides badges or team colours, show those instead.

OTHER RULES
- Presentation only. Don't change the backend, the wallet or ledger, settlement, RNG or auth. Keep money as whole integers (see the invariants in PROJECT_SPEC.md). Every figure comes from the API; the client only displays it.
- Keep amounts in the app's current format (formatPoints and "PTS"). The euro amounts in the screenshots are only illustrations. There is no Deposit button.
- Keep the existing fonts. Set every figure in tabular numerals.
- New icons follow components/shell/icons.tsx: 24 x 24 viewBox, stroke 1.8, round caps and joins, currentColor. Add Horse Racing and Esports glyphs to components/sports/sport-icon.tsx; their SVG paths are in the sport row of docs/design/mobile/source/Main.dc.html.
- Extend the existing components rather than duplicating them: AppShell, OddsButton, BetSlip/BetSlipSheet, CompetitionBlock, SettledTicket, CasinoGameCard/GameArt, LobbyCard, SportsNav, UserMenu.
- Add no new npm dependencies. Build animations (flashes, shimmer, sheet rise, check draw, confetti) in CSS, and keep the existing prefers-reduced-motion switch working.
- Accessibility: touch targets at least 44px; real <button> and <a> elements; aria-pressed on prices; aria-expanded on collapsible sections; aria-label on icon-only buttons.
- Keep diffs tight, with no unrelated edits.

DATA
- Wire everything to the existing hooks: lib/queries.ts, lib/sports.ts, lib/casino*.ts and lib/bet-slip.tsx.
- Some design elements have no backend data yet: live score and clock, the match tracker, TV streams, boosted prices, Bet Builder, cash-out values, the jackpot, players online, win notifications and responsible-gambling limits. Build each one so it renders only when its data is passed in. Otherwise hide it, or keep the honest fallback the app already shows: started events stay suspended, and the ticket keeps "Cash Out Unavailable". Never show made-up figures in production.
- To preview the full design locally, extend frontend/lib/dev-fixtures.ts and follow its rules exactly: the inline NODE_ENV !== 'production' && NEXT_PUBLIC_DEV_FIXTURES === '1' check plus a dynamic import(), never a static import.

WHAT TO BUILD
The screenshots are in docs/design/mobile/screens/. Exact structure, sizes and behaviour are in docs/design/mobile/source/*.dc.html.

1. Mobile shell (components/shell/app-shell.tsx), below 900px:
   - Header, 56px: the brand on the left. On the right, a 44px search button and the balance chip; the chip opens Account.
   - Top tabs, 44px, scrolling sideways: Sports, Live (pulsing live dot and live count), Casino, Live Casino, My Bets. The active tab gets a 2px underline.
   - Bottom nav, 60px, five items: Home, Live (live dot), My Bets (open-bets count badge), Casino, Account. Signed-out users still see "Log In" in place of Account.
   - Slip bar: floats 8px above the bottom nav, 50px tall, 12px radius. It shows the selection count, "Bet Slip", total odds and a chevron, hides when there are no selections, and opens the slip sheet.
2. Odds button (components/sports/odds-button.tsx): keep every current state. The label sits above the price; the button is 48px tall in rows and 52px in cards and market grids. Selected shows the fill, a soft glow and a check mark. A price change flashes for 1.6s with an up or down arrow, using the movement it already computes.
3. Home:
   - Win banner at the top, dismissible: trophy, "Bet won · +amount", then selection · event · bet type.
   - Sport row: 48px circles in 68px columns, each with a label. Football, Basketball, Tennis, Horse Racing, Esports, Ice Hockey, American Football, Golf, MMA, then "All A–Z". The selected sport gets a ring, and its label turns the active colour.
   - Featured carousel of 300px cards with snap scrolling. Each card has the league, the kick-off time (or a live countdown pill, "Starts in mm:ss", for events within the hour), a favourite star, two crests with team names and three prices (1, X, 2). Add a boosted card: lightning "Boosted" badge, the offer and its legs, the old price struck through and the new price as the button.
   - Top leagues: collapsible sections with chevron, name, region, count and favourite star. Each row shows time · day · +markets, both teams and three prices in a 174px block.
   - Footer line: 18+ badge and a "Play responsibly" link.
4. Live: filter pills with counts (All, Football, Tennis, Basketball, Esports) and groups by competition.
   - Each row's top line: pulsing LIVE dot; minute or period; a "Goal" flash pill when one is reported; a TV icon, active only when a stream exists; and a stats icon that opens the match.
   - Teams with scores (tennis: sets, games and points, with a serve dot), then prices with up and down flashes. Suspended prices are hatched with a lock.
5. Match page (app/sports/event/[eventId]):
   - Top: back button, title and favourite star; a score hero with crests, the score and the live minute.
   - Animated match tracker, only when live data exists: the pitch drawn in lines, a ball moving through attacking positions, an attack-status chip and a possession bar.
   - Tabs: Popular, Bet Builder (with a NEW tag), Goals, Corners, Stats.
   - Markets are collapsible cards holding a 2- or 3-column grid of prices.
   - Bet Builder: legs you tick, each with its price, then the combined price and "Add to slip".
   - Stats: a pair of bars per stat.
6. Bet slip sheet (components/sports/bet-slip.tsx): rises over the dimmed backdrop with 18px top corners and a grabber.
   - Header: count, "Clear all", close.
   - Singles / Multiple control. Multiple names the bet: Double, Treble, n-fold.
   - Pick cards: remove ×, a boosted marker with the old price, and "Price went up from X" with a short green flash.
   - An "Accept any price changes" switch. Keep it UI-only unless the slip already supports it; don't change how moved prices are confirmed.
   - Footer: stake input with label and clear button; quick chips +5, +10, +25, +50 that add to the stake in whole points; total odds; total stake; a potential return that updates live as the stake changes; and a large "Place bet · stake" button with a spinner while placing.
   - Keep the server reconciliation, the error copy and the "Estimates only" note exactly as they work today.
7. Bet placed: on success the sheet switches to a confirmation.
   - An animated check: the circle draws, then the tick.
   - "Bet placed" and a receipt: type and odds, ticket reference, legs, stake and potential return.
   - A confetti burst, which turns off under reduced motion.
   - Buttons: "View in My Bets", "Keep selections", "Done".
8. My Bets:
   - An Open / Settled control with the open count, and a settled summary (staked, returned, net).
   - Bet cards: type and odds, plus a status pill (Live, Won, Lost, Void, Cashed out).
   - Legs carry status marks: check for won, × for lost, – for void, an empty ring for pending, a live ring with a live status line for in play.
   - Each card shows the stake and the potential or returned amount.
   - Cash Out shows the live value, flashing on change, then an inline confirm (Keep bet / Confirm), then "Cashed out amount". Show it only where the API gives a cash-out value; otherwise keep "Cash Out Unavailable".
9. Casino lobby:
   - Jackpot card, only with real data: eyebrow, big ticking figure, progress toward "must drop by", and a players-online pill.
   - Category pills.
   - "Hot right now": a 2-column grid of game tiles with 4:3 art from GameArt, a HOT badge with a flame, a NEW badge, a favourite star and a players count.
   - A Live Casino row of 230px table cards, each with a LIVE pill, table info and Join.
10. Account:
   - Profile: avatar initial, name, member since, and an "18+ Verified" badge.
   - Balance card: balance, available, in open bets, and a transaction-history link.
   - "Stay in control" card:
     - Set limits expands to Daily / Weekly / Monthly, amount chips and Save, and shows a usage bar.
     - Take a break, a Reality check switch, Self-exclusion and a "Play responsibly" link.
   - Settings list and Log out.
   - Footer: 18+ and a responsible-gambling line.
   - Anything the backend can't save yet: build the UI, leave the save unwired, and say so in your report.
11. Loading: skeleton versions of Home (sport row, featured cards, league rows) using the existing .skeleton shimmer.

HOW TO WORK
- Work in phases: (1) shell, odds button and slip bar; (2) Home; (3) Live; (4) Match page; (5) slip sheet and bet placed; (6) My Bets; (7) Casino; (8) Account; (9) loading states.
- After each phase, run npm run typecheck, npm test and npm run build from the repo root. Compare the screen at 393 x 852 and at desktop width against the screenshots, with dev fixtures on.
- Before you finish, search your diff for new colour values (#, rgb(, hsl(, oklch(). There should be none, apart from #111 and #04281e copied from existing rules.
- After each phase, report what changed, what's wired to real data, and what stays hidden until the backend supports it.
