import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { Prisma } from '@prisma/client';
const serialize = (value: unknown): unknown => {
  if (typeof value === 'bigint') return value.toString();
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object' && !(value instanceof Date)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]));
  return value;
};
@Injectable()
export class BigIntInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> { return next.handle().pipe(map(serialize)); }
}
