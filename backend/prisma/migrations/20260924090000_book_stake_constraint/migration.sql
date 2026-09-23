-- Tighten the earlier free-spin exception without rewriting an applied migration.
-- Other games retain positive stakes. Book uses ten whole-point lines, and only
-- persisted free-game rounds may have a zero wager. NULL/malformed state fails closed.
ALTER TABLE "CasinoRound" DROP CONSTRAINT "CasinoRound_stake_nonnegative_check";
ALTER TABLE "CasinoRound" ADD CONSTRAINT "CasinoRound_stake_positive_or_book_free_check" CHECK (
  "stake" > 0 OR (
    "stake" = 0 AND "gameType" = 'SLOTS' AND "gameVersion" = 'book-of-ra.v1.rtp5000'
    AND COALESCE("publicState" @> '{"gameId":"book-of-ra","activeLines":10}'::jsonb, false)
    AND COALESCE("publicState"->>'roundState' IN ('FREE_GAME_ACTIVE', 'FREE_GAME_COMPLETE'), false)
    AND CASE WHEN "publicState"->>'freeSpinsPlayed' ~ '^[1-9][0-9]*$'
      THEN ("publicState"->>'freeSpinsPlayed')::numeric > 0 ELSE false END
  )
);
ALTER TABLE "CasinoRound" ADD CONSTRAINT "CasinoRound_book_bet_check" CHECK (
  "gameVersion" <> 'book-of-ra.v1.rtp5000' OR (
    "gameType" = 'SLOTS'
    AND COALESCE("publicState" @> '{"gameId":"book-of-ra","activeLines":10}'::jsonb, false)
    AND CASE WHEN "publicState"->>'betPerLine' ~ '^[1-9][0-9]*$'
                  AND "publicState"->>'totalBet' ~ '^[1-9][0-9]*$'
      THEN ("publicState"->>'totalBet')::numeric = 10 * ("publicState"->>'betPerLine')::numeric
        AND ("stake" = 0 OR "stake" = ("publicState"->>'totalBet')::numeric)
      ELSE false END
  )
);
