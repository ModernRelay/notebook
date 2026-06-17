import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { parseNotebook } from "@modernrelay/notebook-spec";

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
}

export async function serve(opts: ServeOptions): Promise<void> {
  const webDist = resolveWebDist();
  const notebook = parseNotebook(readFileSync(opts.notebookPath, "utf8"));

  // Fixture mode: the SPA resolves `notebook.fixture` against `/notebook.yaml`
  // and fetches that URL path — bind exactly that path to the on-disk fixture.
  let fixtureUrlPath: string | undefined;
  let fixtureFile: string | undefined;
  if (opts.connection.mode === "fixture") {
    if (!notebook.fixture) {
      throw new Error("fixture mode requires `fixture:` in the notebook");
    }
    // Decode so it compares against the request's decoded path (a fixture name
    // with e.g. a space arrives URL-encoded from the browser's fetch).
    fixtureUrlPath = decodeURIComponent(
      new URL(notebook.fixture, "http://x/notebook.yaml").pathname,
    );
    fixtureFile = resolve(dirname(opts.notebookPath), notebook.fixture);
  }

  const upstream =
    opts.connection.mode === "server" && opts.connection.server
      ? new URL(opts.connection.server)
      : undefined;

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
      if (!upstream) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "no upstream server configured" }));
        return;
      }
      proxyOg(req, res, upstream, opts.connection.token);
      return;
    }
    // 2. the user's notebook
    if (path === "/notebook.yaml") {
      sendFile(res, opts.notebookPath, ".yaml");
      return;
    }
    // 3. the fixture file (fixture mode only)
    if (fixtureUrlPath && fixtureFile && path === fixtureUrlPath) {
      sendFile(res, fixtureFile, ".json");
      return;
    }
    // 4. real static files under web-dist
    const staticPath = safeJoin(webDist, path);
    if (staticPath && !path.endsWith("/") && existsSync(staticPath)) {
      sendFile(res, staticPath, extname(staticPath));
      return;
    }
    // 5. SPA fallback
    sendFile(res, join(webDist, "index.html"), ".html");
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
  const url = buildOpenUrl(port, opts.connection);

  process.stdout.write(`\n@modernrelay/notebook → http://127.0.0.1:${port}\n`);
  process.stdout.write(`  ${opts.connection.label}\n`);
  process.stdout.write(`  open: ${url}\n  stop: Ctrl-C\n\n`);
  if (opts.open) openBrowser(url);
}

function buildOpenUrl(port: number, conn: Connection): string {
  const params = new URLSearchParams();
  params.set("mode", conn.mode);
  params.set("notebook", "/notebook.yaml");
  if (conn.mode === "server") {
    params.set("server", "/og"); // same-origin via the proxy above
    if (conn.graphId) params.set("graph", conn.graphId);
    if (conn.branch) params.set("branch", conn.branch);
  }
  return `http://127.0.0.1:${port}/?${params.toString()}`;
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
