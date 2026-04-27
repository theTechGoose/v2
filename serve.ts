/**
 * v2 dev launcher — boots backend (Danet, port 3000) + frontend (Vite, port 5173)
 * with prefixed logs and graceful SIGINT shutdown.
 *
 * Run from anywhere:
 *   deno run -A /path/to/v2/serve.ts
 * Or with the bundled task:
 *   deno task serve     (from v2/)
 */

const ROOT = new URL(".", import.meta.url).pathname;
const BACKEND_DIR = `${ROOT}backend`;
const FRONTEND_DIR = `${ROOT}front-end`;

const BACKEND_PORT = Number(Deno.env.get("BACKEND_PORT") ?? 3000);
const FRONTEND_PORT = Number(Deno.env.get("FRONTEND_PORT") ?? 5173);

interface ChildSpec {
  name: string;
  cwd: string;
  cmd: string;
  args: string[];
  env: Record<string, string>;
  color: string;
}

const children: ChildSpec[] = [
  {
    name: "backend",
    cwd: BACKEND_DIR,
    cmd: "deno",
    args: ["task", "dev"],
    env: { PORT: String(BACKEND_PORT), AGENTS_LLM_CLIENT: "openai" },
    color: "\x1b[36m", // cyan
  },
  {
    name: "frontend",
    cwd: FRONTEND_DIR,
    cmd: "deno",
    args: ["task", "dev"],
    env: {
      BACKEND_URL: `http://localhost:${BACKEND_PORT}`,
      // Vite picks up --port from CLI, but its task script already sets it.
      // We pin the port via env so proxies can rely on it.
      PORT: String(FRONTEND_PORT),
    },
    color: "\x1b[35m", // magenta
  },
];

const RESET = "\x1b[0m";

function streamLines(
  reader: ReadableStream<Uint8Array>,
  prefix: string,
): Promise<void> {
  const decoder = new TextDecoder();
  let buf = "";
  return reader
    .pipeTo(
      new WritableStream({
        write(chunk) {
          buf += decoder.decode(chunk, { stream: true });
          const parts = buf.split("\n");
          buf = parts.pop() ?? "";
          for (const line of parts) {
            if (line.length === 0) continue;
            // deno-lint-ignore no-console
            console.log(`${prefix} ${line}`);
          }
        },
        close() {
          if (buf.length > 0) {
            // deno-lint-ignore no-console
            console.log(`${prefix} ${buf}`);
          }
        },
      }),
    )
    .catch(() => {});
}

const procs: Deno.ChildProcess[] = [];

function shutdown(signal: string): void {
  // deno-lint-ignore no-console
  console.log(`\n[serve] received ${signal}, stopping children…`);
  for (const p of procs) {
    try {
      p.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

Deno.addSignalListener("SIGINT", () => shutdown("SIGINT"));
try {
  Deno.addSignalListener("SIGTERM", () => shutdown("SIGTERM"));
} catch {
  /* SIGTERM not always installable */
}

async function spawn(spec: ChildSpec): Promise<number> {
  const prefix = `${spec.color}[${spec.name}]${RESET}`;
  // deno-lint-ignore no-console
  console.log(`${prefix} starting in ${spec.cwd}`);

  const proc = new Deno.Command(spec.cmd, {
    args: spec.args,
    cwd: spec.cwd,
    env: { ...Deno.env.toObject(), ...spec.env },
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  procs.push(proc);

  const reading = Promise.all([
    streamLines(proc.stdout, prefix),
    streamLines(proc.stderr, prefix),
  ]);

  const status = await proc.status;
  await reading;
  return status.code;
}

// deno-lint-ignore no-console
console.log(
  `[serve] backend → http://localhost:${BACKEND_PORT}\n[serve] frontend → http://localhost:${FRONTEND_PORT}`,
);

const codes = await Promise.all(children.map(spawn));
const failed = codes.findIndex((c) => c !== 0 && c !== 143 /* SIGTERM */);
if (failed !== -1) {
  // deno-lint-ignore no-console
  console.error(`[serve] ${children[failed].name} exited with code ${codes[failed]}`);
  Deno.exit(codes[failed]);
}
