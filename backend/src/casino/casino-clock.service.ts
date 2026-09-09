import { Injectable } from '@nestjs/common';

/**
 * The single source of server time for time-based casino games.
 *
 * Crash progression is decided entirely by this clock; nothing a browser sends
 * can influence it. Injecting it also lets tests advance time deterministically
 * instead of sleeping, which keeps the timing tests exact and fast.
 */
@Injectable()
export class CasinoClock {
  now(): Date {
    return new Date();
  }

  nowMs(): number {
    return this.now().getTime();
  }
}
