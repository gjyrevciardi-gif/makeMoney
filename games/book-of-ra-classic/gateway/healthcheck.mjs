import http from 'node:http';

const port = Number(process.env.BOOK_CLASSIC_GATEWAY_PORT ?? 8791);
const origin = process.env.BOOK_CLASSIC_ORIGIN ?? `http://127.0.0.1:${port}`;
const host = new URL(origin).host;

const request = http.request(
  { host: '127.0.0.1', port, path: '/healthz', headers: { host } },
  (response) => {
    let body = '';
    response.on('data', (chunk) => {
      body += chunk;
    });
    response.on('end', () => {
      process.exit(response.statusCode === 200 && body.includes('"ok":true') ? 0 : 1);
    });
  },
);
request.on('error', () => process.exit(1));
request.end();
