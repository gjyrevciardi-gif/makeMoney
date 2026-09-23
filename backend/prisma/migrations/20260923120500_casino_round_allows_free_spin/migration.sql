-- Book of the Sands plays its ten free games as rounds of their own: the board,
-- the expanding symbol and the feature counters advance per spin, but no stake
-- is charged for them. `stake` therefore has to be able to record an honest
-- zero for a free spin.
--
-- The guard is relaxed from "> 0" to ">= 0" rather than removed. Every game
-- service still rejects a non-positive stake before a round is opened, so no
-- other game's rules change; what changes is that a round can record "nothing
-- was charged for this spin" instead of being impossible to store.

ALTER TABLE "CasinoRound" DROP CONSTRAINT "CasinoRound_stake_positive_check";
ALTER TABLE "CasinoRound" ADD CONSTRAINT "CasinoRound_stake_nonnegative_check" CHECK ("stake" >= 0);
