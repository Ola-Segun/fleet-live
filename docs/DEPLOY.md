# Deploying

The live demo is the web app in **demo mode**: the simulator runs in the
browser's Worker, so it's a static page plus JavaScript, with no server to
run. Network mode needs `apps/sim-server` hosted separately; it isn't part
of the demo.

## Cloudflare Workers

The web app is configured for Cloudflare Workers through the OpenNext adapter.
The deployment uses the browser-based demo and does not require R2, secrets, or
environment variables.

From the repository root (the adapter is tested in Linux CI; local Windows
builds may hit OpenNext's documented symlink limitations):

```sh
pnpm install --frozen-lockfile
pnpm --filter @fleet/web cf:preview
```

This builds the Next.js app and previews the adapted Worker locally. After
logging in with Wrangler (`pnpm --filter @fleet/web exec wrangler login`), deploy
with:

```sh
pnpm --filter @fleet/web cf:deploy
```

The Worker name and compatibility date are set in
[`apps/web/wrangler.jsonc`](../apps/web/wrangler.jsonc). Attach a custom domain
in the Worker settings after the first deployment. CI runs an OpenNext build
and Wrangler dry-run on Linux; it does not deploy automatically.

The site and `/app` run without a backend: the simulated fleet runs in each
visitor's browser. Network mode is not included in this deployment; it requires
a separately hosted `apps/sim-server` with a public `wss://` endpoint.

## Vercel

1. Push the repository to GitHub.
2. In Vercel, choose **Add New → Project** and import the repository.
3. Set **Root Directory** to `apps/web`. Vercel detects Next.js and pnpm (from
   `packageManager` in the root `package.json`) and installs the whole
   workspace, so the `@fleet/*` packages resolve.
4. Leave the build command (`next build`) and output settings as detected.
5. Deploy. Every push to `main` redeploys, and every pull request gets a
   preview URL.

No environment variables are needed. The base map (OpenFreeMap) needs no
API key, and the route data is committed.

## Before calling a deploy good

With the deployed URL:

```sh
BASE_URL=https://<your-deployment>/ pnpm smoke:ui
BASE_URL=https://<your-deployment>/ pnpm smoke:replay
```

The browser checks read `BASE_URL`, so the same checks that gate CI run
against production.

## Other Node.js hosts

Any host that runs `next build` and `next start` works:

```sh
pnpm install --frozen-lockfile
pnpm --filter @fleet/web build
pnpm --filter @fleet/web start -p 3000
```
