import http from "node:http";
import https from "node:https";

// RFC 7230 §6.1 hop-by-hop headers (+ the non-standard proxy-connection). A proxy
// must strip these before forwarding a message in BOTH directions — they describe
// one transport hop, not the end-to-end message, and the receiving side re-frames.
const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
];

function stripHopByHop(
  headers: http.OutgoingHttpHeaders | http.IncomingHttpHeaders,
): void {
  for (const hop of HOP_BY_HOP) delete headers[hop];
}

/**
 * Reverse-proxy a request under `/og` to the upstream omnigraph-server: strip the
 * `/og` prefix, set `Host` (changeOrigin, for TLS/vhost routing), and inject
 * `Authorization` from the server-side token. The proxy is **authoritative for
 * auth** (BFF): it always drops any client-supplied `Authorization` /
 * `Proxy-Authorization` and sets the bearer only from the server token, so a
 * browser can never reach upstream with a credential of its own. The body is
 * piped unmodified, so the incoming `content-length` stays valid.
 * omnigraph-server 0.7.0 sets no CORS headers, which is why the browser must
 * talk to it same-origin through here.
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
  // Never forward a client-supplied credential. proxy-authorization is also
  // hop-by-hop (stripped below); authorization is end-to-end, so drop it here
  // explicitly, then set only the server-side token.
  delete headers.authorization;
  delete headers["proxy-authorization"];
  if (token) headers.authorization = `Bearer ${token}`;
  // authorization was just set from the server token, so it survives the strip.
  stripHopByHop(headers);

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
      // Strip hop-by-hop on the way back too; Node re-frames res (content-length
      // / chunked) for this hop when we pipe, so forwarding them would corrupt it.
      const resHeaders = { ...upstreamRes.headers };
      stripHopByHop(resHeaders);
      res.writeHead(upstreamRes.statusCode ?? 502, resHeaders);
      upstreamRes.pipe(res);
    },
  );
  upstreamReq.on("error", (err) => {
    // If the response already started, it is committed — close it rather than
    // appending an error body onto a partially-streamed proxied response.
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `proxy upstream failed: ${err.message}` }));
  });
  req.pipe(upstreamReq);
}
