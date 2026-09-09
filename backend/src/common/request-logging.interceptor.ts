import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { finalize, Observable } from 'rxjs';
import type { Request, Response } from 'express';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const startedAt = Date.now();

    return next.handle().pipe(finalize(() => {
      process.stdout.write(`${JSON.stringify({
        event: 'HTTP_REQUEST',
        requestId: request.requestId,
        method: request.method,
        route: request.route?.path ?? request.path,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
      })}\n`);
    }));
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }
}
