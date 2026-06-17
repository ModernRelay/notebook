import http from "node:http";
import https from "node:https";

/**
 * Reverse-proxy a request under `/og` to the upstream omnigraph-server: strip the
 * `/og` prefix, set `Host` (changeOrigin, for TLS/vhost routing), and OVERWRITE
 * `Authorization` with the server-side token (BFF — the token never reaches the
 * browser). The body is piped unmodified, so the incoming `content-length` stays
 * valid. omnigraph-server 0.7.0 sets no CORS headers, which is why the browser
 * must talk to it same-origin through here.
 */
export function proxyOg(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  upstream: URL,
  token: string | undefined,
): void {
  const suffix = (req.url ?? "/").replace(/^\/og/, "") || "/";
  const isHttps = upstream.protocol === "https:";
  const lib = isHttps ? https : http;

  const headers: http.OutgoingHttpHeaders = { ...req.headers };
  headers.host = upstream.host;
  if (token) headers.authorization = `Bearer ${token}`;
  // Strip hop-by-hop headers a browser may send that some upstreams reject.
  delete headers.connection;
  delete headers["proxy-connection"];

  const upstreamReq = lib.request(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || (isHttps ? 443 : 80),
      method: req.method,
      path: upstream.pathname.replace(/\/$/, "") + suffix,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstreamReq.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
    }
    res.end(JSON.stringify({ error: `proxy upstream failed: ${err.message}` }));
  });
  req.pipe(upstreamReq);
}
