/**
 * Network mode, from the command line:
 *
 *   pnpm --filter @fleet/sim-server start
 *
 * Environment: PORT (8787), VEHICLES (5000), SEED, FORCE_DISCONNECT_MS (off).
 */
import { startSimServer } from "./server";

const env = (name: string) => process.env[name];

const server = await startSimServer({
  port: Number(env("PORT") ?? 8787),
  host: env("HOST") ?? "127.0.0.1",
  vehicleCount: Number(env("VEHICLES") ?? 5000),
  ...(env("SEED") && { seed: env("SEED")! }),
  ...(env("FORCE_DISCONNECT_MS") && { forceDisconnectEveryMs: Number(env("FORCE_DISCONNECT_MS")) }),
});

console.log(`fleet-live sim server: ${server.url} (vehicles at http://127.0.0.1:${server.port}/vehicles)`);

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
