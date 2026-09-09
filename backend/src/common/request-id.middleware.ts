import { BadRequestException, Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const inbound = request.header('x-request-id');
    if (inbound !== undefined && !requestIdPattern.test(inbound)) {
      throw new BadRequestException({ code: 'INVALID_REQUEST_ID', message: 'The request ID is invalid.' });
    }

    const requestId = inbound ?? randomUUID();
    request.requestId = requestId;
    response.setHeader('x-request-id', requestId);
    next();
  }
}
