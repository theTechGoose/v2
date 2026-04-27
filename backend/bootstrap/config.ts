export interface AppConfig {
  port: number;
}

export function loadConfig(): AppConfig {
  const port = Number(Deno.env.get("PORT") ?? 3000);
  return { port };
}
