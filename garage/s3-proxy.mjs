// Garage rejects an expired presigned URL with 400 "Date is too old".
// S3 uses 403 AccessDenied for that same case, and the upload demo checks 403.
// Everything else is forwarded unchanged, including a bad signature (already 403).
import http from "node:http";

const upstream = new URL(process.env.UPSTREAM ?? "http://garage:9000");
const port = Number(process.env.LISTEN_PORT ?? 21160);

const expiredBody = Buffer.from(
  `<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>`,
);

const server = http.createServer((req, res) => {
  const headers = { ...req.headers };
  const proxyReq = http.request(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      method: req.method,
      path: req.url,
      headers,
    },
    (proxyRes) => {
      if (proxyRes.statusCode !== 400) {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
        return;
      }
      const chunks = [];
      proxyRes.on("data", (chunk) => chunks.push(chunk));
      proxyRes.on("end", () => {
        const body = Buffer.concat(chunks);
        if (!body.includes("Date is too old")) {
          res.writeHead(400, proxyRes.headers);
          res.end(body);
          return;
        }
        res.writeHead(403, {
          "content-type": "application/xml",
          "content-length": String(expiredBody.length),
        });
        res.end(expiredBody);
      });
    },
  );
  proxyReq.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(proxyReq);
});

server.listen(port);
