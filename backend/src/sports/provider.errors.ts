import { HttpException, HttpStatus } from '@nestjs/common';
export class SportsError extends HttpException {
  constructor(public readonly code: string, status = HttpStatus.SERVICE_UNAVAILABLE, message = 'Sports data is temporarily unavailable.') { super({ code, message }, status); }
}
