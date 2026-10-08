import { HttpException, HttpStatus } from '@nestjs/common';
export class SportsError extends HttpException {
  /**
   * `upstreamStatus` is the provider's own HTTP status, kept for operator
   * diagnostics. It is never part of the response body: players always receive
   * the neutral `message`.
   */
  constructor(
    public readonly code: string,
    status = HttpStatus.SERVICE_UNAVAILABLE,
    message = 'Sports data is temporarily unavailable.',
    public readonly upstreamStatus?: number,
  ) { super({ code, message }, status); }
}
