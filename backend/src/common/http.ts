import type { Request } from 'express';
export const requestIp = (request: Request) => request.ip || request.socket.remoteAddress || 'unknown';
