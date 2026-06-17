// Mapping engine / network errors to user-facing messages.
//
// Server responses come back as text like
//   `omnigraph-server /mutate returned 500: {"error":"storage: ...", "code": "internal"}`
// or as `Error: Failed to fetch` when the server is unreachable. The
// raw forms are accurate but unfriendly. classifyMutationError tags
// the kind so the inline error panel can render a real headline +
// remediation, with the raw payload tucked underneath as `dim`
// details for engineers debugging from the same screen.

export type ErrorKind =
  | "conflict"
  | "permission"
  | "validation"
  | "network"
  | "engine"
  | "unknown";

export interface ClassifiedError {
  kind: ErrorKind;
  title: string;
  body: string;
  /** Concise action the user can take. May be empty. */
  suggestion: string;
  /** Raw error message — shown dim for engineers. */
  raw: string;
}

const SIGNATURES: ReadonlyArray<{
  re: RegExp;
  kind: ErrorKind;
  title: string;
  body: string;
  suggestion: string;
}> = [
  {
    re: /Failed to fetch|NetworkError|TypeError: NetworkError|net::ERR/i,
    kind: "network",
    title: "Server unreachable",
    body: "The omnigraph-server didn't respond — it may be restarting, blocked by CORS, or offline.",
    suggestion: "Check that the server is running and try again.",
  },
  {
    re: /returned 401|"code"\s*:\s*"unauthorized"/i,
    kind: "permission",
    title: "Not authorized",
    body: "Your session token was rejected by the server.",
    suggestion: "Refresh with a valid `?token=…` URL or re-authenticate.",
  },
  {
    re: /returned 403|"code"\s*:\s*"forbidden"|policy.*denie|Cedar/i,
    kind: "permission",
    title: "Permission denied",
    body: "Cedar policy forbids this change for your actor.",
    suggestion: "Ask an admin to update the policy or use a different branch.",
  },
  {
    re: /stale view of.*expected manifest table version|ExpectedVersionMismatch/i,
    kind: "conflict",
    title: "Conflict — someone else changed this row",
    body: "Another writer committed to the same table between your view and your click.",
    suggestion: "Refresh to load the latest, then re-apply your change.",
  },
  {
    re: /Ambiguous merge inserts/i,
    kind: "engine",
    title: "Engine merge ambiguity",
    body: "Lance's MergeInsertBuilder rejected the source-side dedupe (tracked as MR-920).",
    suggestion: "Restart the server with the latest build — the FirstSeen patch should suppress this.",
  },
  {
    re: /missing @key|missing required (property|edge endpoint)|invalid Date|type error/i,
    kind: "validation",
    title: "Invalid input",
    body: "The mutation failed validation before reaching storage.",
    suggestion: "Check the cell's `mutation` block in the notebook YAML for a type or key mismatch.",
  },
  {
    re: /"code"\s*:\s*"internal"|panicked|unwrap|InternalError/i,
    kind: "engine",
    title: "Engine error",
    body: "omnigraph-server returned an internal error. Server logs will have a backtrace.",
    suggestion: "Check `.server-demo/omnigraph-server.log` for the stack trace.",
  },
];

export function classifyMutationError(raw: string): ClassifiedError {
  for (const sig of SIGNATURES) {
    if (sig.re.test(raw)) {
      return { ...sig, raw };
    }
  }
  return {
    kind: "unknown",
    title: "Mutation failed",
    body: "The server returned an error that we don't have a specific handler for.",
    suggestion: "Inspect the raw message below; please report it if it reproduces.",
    raw,
  };
}
