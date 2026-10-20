/**
 * REQ-318 — DENO_DEPLOY is the one real-vs-fake switch: set, the composition root injects the
 * REAL adapters; unset — the gate, a dev box, a pin — the fakes, and nothing leaves the box.
 * Deno Deploy itself sets DENO_DEPLOYMENT_ID on every deployment, so that is the real deploy
 * too. One predicate for every seam that reads the switch (REQ-082's dev code, REQ-103's signup
 * notice). Pure: the env is a parameter.
 */
export interface EnvReader {
  get(k: string): string | undefined;
}

export function onRealDeploy(env: EnvReader = Deno.env): boolean {
  return Boolean(env.get("DENO_DEPLOY")?.trim()) ||
    Boolean(env.get("DENO_DEPLOYMENT_ID")?.trim());
}
