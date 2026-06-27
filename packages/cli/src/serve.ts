import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { proxyOg } from "./proxy.js";
import type { Connection } from "./source.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".map": "application/json",
  ".ico": "image/x-icon",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
};

/** Locate the built web SPA: bundled `web-dist/` (published) or the dev sibling. */
function resolveWebDist(): string {
  const here = dirname(fileURLToPath(import.meta.url)); // <cli>/dist
  const candidates = [
    resolve(here, "../web-dist"), // published layout (copied at build)
    resolve(here, "../../web/dist"), // in-workspace dev layout
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "index.html"))) return candidate;
  }
  throw new Error(
    "web build not found — run `pnpm --filter @modernrelay/notebook-web build` first",
  );
}

export interface ServeOptions {
  notebookPath: string; // absolute
  connection: Connection;
  port: number;
  open: boolean;
  /** `--allow-raw-gq` — forwarded to the browser as `?allowRawGq=1`. */
  allowRawGq?: boolean;
}

export async function serve(opts: ServeOptions): Promise<void> {
  const webDist = resolveWebDist();
  const upstream = new URL(opts.connection.server);

  // Config injected into index.html as `window.__DASHBOOK__`, so the bare URL
  // (http://host:port/) loads the served notebook over the same-origin `/og`
  // proxy — no `?notebook=…&server=…&graph=…` query string needed. URL params
  // still override it (dev / sharing a specific branch).
  const viewConfig: Record<string, unknown> = {
    notebook: "/notebook.yaml",
    server: "/og",
    graph: opts.connection.graphId,
  };
  if (opts.connection.branch) viewConfig.branch = opts.connection.branch;
  if (opts.allowRawGq === true) viewConfig.allowRawGq = true;

  const server = http.createServer((req, res) => {
    const rawPath = (req.url ?? "/").split("?")[0] ?? "/";
    // Decode once, here. A malformed %-sequence (e.g. `/%ZZ`) must answer 400,
    // not throw URIError out of the request handler and crash the server.
    let path: string;
    try {
      path = decodeURIComponent(rawPath);
    } catch {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("400 Bad Request");
      return;
    }

    // 1. /og/* → BFF reverse proxy (token injected server-side).
    if (path === "/og" || path.startsWith("/og/")) {
      proxyOg(req, res, upstream, opts.connection.token);
      return;
    }
    // 2. the user's notebook
    if (path === "/notebook.yaml") {
      sendFile(res, opts.notebookPath, ".yaml");
      return;
    }
    // 3. real static files under web-dist (never index.html — that's injected)
    const staticPath = safeJoin(webDist, path);
    if (
      staticPath &&
      !path.endsWith("/") &&
      path !== "/index.html" &&
      existsSync(staticPath)
    ) {
      sendFile(res, staticPath, extname(staticPath));
      return;
    }
    // 4. SPA fallback — index.html with the view config injected.
    sendIndex(res, join(webDist, "index.html"), viewConfig);
  });

  await new Promise<void>((resolvePromise, reject) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      reject(
        err.code === "EADDRINUSE"
          ? new Error(
              `port ${opts.port} is in use — pass --port <N> to pick another`,
            )
          : err,
      );
    };
    server.once("error", onError);
    server.listen(opts.port, "127.0.0.1", () => {
      server.off("error", onError);
      resolvePromise();
    });
  });
  const port = (server.address() as AddressInfo).port;
  const url = buildOpenUrl(port);

  process.stdout.write(`\n@modernrelay/notebook → http://127.0.0.1:${port}\n`);
  process.stdout.write(`  ${opts.connection.label}\n`);
  process.stdout.write(`  open: ${url}\n  stop: Ctrl-C\n\n`);
  if (opts.open) openBrowser(url);
}

/**
 * Serve index.html with `window.__DASHBOOK__` injected, so the SPA loads the
 * served notebook over the same-origin `/og` proxy without any query string.
 */
function sendIndex(
  res: http.ServerResponse,
  indexPath: string,
  config: Record<string, unknown>,
): void {
  let html: string;
  try {
    html = readFileSync(indexPath, "utf8");
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404 Not Found");
    return;
  }
  // Escape `<` so a value can't break out of the <script>; inject before </head>.
  const json = JSON.stringify(config).replace(/</g, "\\u003c");
  const tag = `<script>window.__DASHBOOK__=${json}</script>`;
  const out = html.includes("</head>")
    ? html.replace("</head>", `${tag}</head>`)
    : `${tag}${html}`;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(out);
}

function buildOpenUrl(port: number): string {
  return `http://127.0.0.1:${port}/`;
}

function sendFile(res: http.ServerResponse, file: string, ext: string): void {
  const stream = createReadStream(file);
  // Commit the 200 only once the file is confirmed readable (`open`). On a read
  // error before that — missing file, permissions, or a TOCTOU after the
  // existsSync check — headers aren't sent yet, so we can still return a real
  // 404 instead of a 200 with a blank body.
  stream.once("open", () => {
    res.writeHead(200, {
      "content-type": MIME[ext.toLowerCase()] ?? "application/octet-stream",
    });
    stream.pipe(res);
  });
  stream.once("error", () => {
    if (res.headersSent) {
      res.end();
    } else {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
    }
  });
}

/** Join an already-decoded URL path under root, rejecting traversal outside root. */
function safeJoin(root: string, urlPath: string): string | null {
  const joined = normalize(join(root, urlPath));
  if (joined !== root && !joined.startsWith(root + sep)) return null;
  return joined;
}

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args as string[], {
      stdio: "ignore",
      detached: true,
    });
    // A missing launcher (e.g. headless host without xdg-open) surfaces as an
    // async 'error' event, not a throw — swallow it so `view` keeps serving.
    child.on("error", () => {});
    child.unref();
  } catch {
    /* best effort — the URL is printed regardless */
  }
}
