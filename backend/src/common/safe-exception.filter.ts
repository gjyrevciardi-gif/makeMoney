import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
const descriptions: Record<number, [string, string]> = {
  400: ['BAD_REQUEST', 'The request is invalid.'],
  401: ['UNAUTHORIZED', 'Authentication required.'],
  403: ['FORBIDDEN', 'You do not have permission to perform this action.'],
  404: ['NOT_FOUND', 'Resource not found.'],
  409: ['CONFLICT', 'The request conflicts with current state.'],
  429: ['RATE_LIMITED', 'Too many requests.'],
};
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = exception instanceof HttpException ? exception.getResponse() : undefined;
    const safeBody = typeof body === 'object' && body !== null && 'code' in body && 'message' in body ? body as { code: string; message: string } : undefined;
    const [fallbackCode, fallbackMessage] = descriptions[status] ?? ['INTERNAL_ERROR', 'An unexpected error occurred.'];
    const code = safeBody?.code ?? fallbackCode; const message = safeBody?.message ?? fallbackMessage;
    if (status >= 500) {
      process.stderr.write(`${JSON.stringify({
        event: 'HTTP_UNHANDLED_EXCEPTION',
        requestId: request.requestId,
        method: request.method,
        route: request.path,
        errorType: exception instanceof Error ? exception.name : 'UnknownError',
      })}\n`);
    }
    response.status(status).json(safeBody ? { ...safeBody, code, message } : { code, message });
  }
}
