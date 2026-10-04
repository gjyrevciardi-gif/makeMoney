# lucky-lady math control evidence

Samples: 40000 Monte Carlo rounds, 300 sessions x up to 3000 paid spins.

| Profile | Target | Status | Measured | Exact | Hit | Max observed | Proved max | Median spins | P90 spins | Median turnover | Alive500 | Alive1000 | Alive5000 | Reach150 | Ruin500 | Feature rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rtp0 | 0 | UNSUPPORTED | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| rtp5 | 5 | UNSUPPORTED | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| lucky-lady.rtp10.g7ce56de27a47 | 10 | VALIDATED | 9.8360 | 10.0003 | 0.0097 | 12.40 | 20.80 | 552 | 590 | 552 | 0.997 | 0.000 | - | 0.000 | 0.003 | 0.00000 |
| lucky-lady.rtp20.ge40351cdee76 | 20 | VALIDATED | 19.7172 | 19.9992 | 0.0411 | 8.80 | 12.00 | 621 | 668 | 621 | 1.000 | 0.000 | - | 0.000 | 0.000 | 0.00000 |
| lucky-lady.rtp30.g6e4875beb70b | 30 | VALIDATED | 30.5262 | 29.9998 | 0.0634 | 12.00 | 12.00 | 712 | 783 | 712 | 1.000 | 0.000 | - | 0.000 | 0.000 | 0.00000 |
| lucky-lady.rtp40.g1c8ab822fd16 | 40 | VALIDATED | 39.3032 | 39.9997 | 0.0822 | 12.00 | 12.00 | 826 | 921 | 826 | 1.000 | 0.013 | - | 0.000 | 0.000 | 0.00000 |
| lucky-lady.rtp50.gdfef8c399389 | 50 | VALIDATED | 52.0550 | 50.0008 | 0.1063 | 12.00 | 12.00 | 1000 | 1151 | 1000 | 1.000 | 0.493 | - | 0.000 | 0.000 | 0.00000 |
| lucky-lady.rtp60.g14ddd5b97ca3 | 60 | VALIDATED | 60.4337 | 60.0004 | 0.1233 | 12.00 | 12.00 | 1236 | 1468 | 1236 | 1.000 | 0.947 | - | 0.000 | 0.000 | 0.00000 |
| lucky-lady.rtp70.gf7ac0d49615a | 70 | VALIDATED | 69.7567 | 70.0002 | 0.1412 | 12.00 | 12.00 | 1653 | 1999 | 1653 | 1.000 | 1.000 | - | 0.000 | 0.000 | 0.00000 |
| lucky-lady.rtp80.g4fa0b1386b06 | 80 | VALIDATED | 80.7628 | 80.0006 | 0.1634 | 12.00 | 12.00 | 2470 | 3000 | 2470 | 1.000 | 1.000 | - | 0.000 | 0.000 | 0.00000 |
| lucky-lady.rtp90.gc208a7e7eabe | 90 | VALIDATED | 91.2253 | 89.9994 | 0.1817 | 12.00 | 12.00 | 3000 | 3000 | 3000 | 1.000 | 1.000 | - | 0.000 | 0.000 | 0.00000 |
| lucky-lady.rtp95.g5095154ce856 | 95 | VALIDATED | 93.6782 | 95.0000 | 0.1870 | 12.00 | 12.00 | 3000 | 3000 | 3000 | 1.000 | 1.000 | - | 0.000 | 0.000 | 0.00000 |
| lucky-lady.rtp100.g33a2146e123b | 100 | VALIDATED | 100.2177 | 100.0007 | 0.2008 | 12.00 | 12.00 | 3000 | 3000 | 3000 | 1.000 | 1.000 | - | 0.077 | 0.000 | 0.00000 |
| lucky-lady.rtp33p30.g51c06ba481f1 | 33.3 | VALIDATED | 33.8522 | 33.2993 | 0.0703 | 8.80 | 12.00 | 745 | 819 | 745 | 1.000 | 0.000 | - | 0.000 | 0.000 | 0.00000 |
| lucky-lady.rtp77p70.g8a3b9f80ab74 | 77.7 | VALIDATED | 77.7030 | 77.6996 | 0.1574 | 12.00 | 12.00 | 2212 | 2845 | 2212 | 1.000 | 1.000 | - | 0.000 | 0.000 | 0.00000 |
| lucky-lady.rtp0.g90113193f77b | 0 | VALIDATED | 0.0000 | 0.0000 | 0.0000 | 0.00 | 0.00 | 500 | 500 | 500 | 0.000 | 0.000 | - | 0.000 | 1.000 | 0.00000 |
| scenario-feature-with-hard-ceiling | 50 | UNSUPPORTED | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| scenario-total-ceiling-including-gamble | 50 | UNSUPPORTED | - | - | - | - | - | - | - | - | - | - | - | - | - | - |

Unsupported requests (recorded, never presented as delivered):

- rtp0 (target 0%): UNSUPPORTED - VOLATILITY_TIER_UNSATISFIED (requested MED (1..3 return standard deviation); achievable 0.0000)
- rtp5 (target 5%): UNSUPPORTED - VOLATILITY_TIER_UNSATISFIED (requested MED (1..3 return standard deviation); achievable 0.5250)
- scenario-feature-with-hard-ceiling (target 50%, feature-with-hard-ceiling): UNSUPPORTED - FEATURE_AND_HARD_CEILING_CONFLICT (requested at least 10% of return from features inside a 50x ceiling; achievable a feature-free profile inside a finite ceiling, or a feature profile with no finite ceiling)
- scenario-total-ceiling-including-gamble (target 50%, total-ceiling-including-gamble): UNSUPPORTED - GAMBLE_UNBOUNDED_TOTAL_CEILING (requested 50x including the optional gamble; achievable no finite ceiling)
