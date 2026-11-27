# Frontend security headers and Content-Security-Policy

## Strategy: static headers, no dynamic rendering

Every route in this app prerenders as a static page (`docs/architecture.md`
"Rendering"). A nonce-based CSP requires a per-request nonce, which forces
dynamic rendering for all routes and raises TTFB. The chosen strategy is a
static policy emitted by `next.config.ts` `headers()`:

- `Content-Security-Policy-Report-Only` by default; set
  `NEXT_PUBLIC_CSP_ENFORCE=1` to send the enforcing header.
- `script-src` has no `'unsafe-inline'` and no `'unsafe-eval'` in production
  builds (`'unsafe-eval'` is added only in `next dev` for Turbopack HMR).
- `style-src` allows inline styles because React `style={{…}}` props and the
  wallet kit's runtime styles (twind) need them. This is limited to styles;
  `script-src` stays strict.
- `connect-src` is built from the configured `NEXT_PUBLIC_API_URL`,
  `NEXT_PUBLIC_STELLAR_RPC_URL`, the first IPFS gateway, `NEXT_PUBLIC_X402_URL`
  (skipped when empty) and the socket.io origin derived from the API origin
  (`ws:`/`wss:`). Changing `.env.local` changes the policy.
- Optional reporting: `NEXT_PUBLIC_CSP_REPORT_URL` adds `report-uri` and
  `report-to`.

`lib/security/csp.ts` is pure and unit-tested; `next.config.ts` and
`scripts/check-headers.mjs` both use the same builder. Next 16 renamed
`middleware.ts` to `proxy.ts`; no proxy is used here, so the repositories'
`node_modules/next/dist/docs/01-app/03-api-reference/02-file-conventions/proxy.md`
and `content-security-policy` guide were consulted before choosing the static
approach.

To move to nonces later: add `proxy.ts` that generates a nonce, set
`x-nonce` on the request, read it in `app/layout.tsx` via `headers()`, and pass
it to `buildCsp`. Measure the TTFB and cache behaviour change first.

## Other headers

All paths get `X-Frame-Options: DENY`, `frame-ancestors 'none'`,
`Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy`
that denies camera/microphone/geolocation/payment while allowing `usb`/`hid`
for hardware wallets, `X-Content-Type-Options: nosniff`, and HSTS in
production.

## Wallet kit origins

The kit's modal injects styles at runtime and some modules open popups or
iframes. `WALLET_CONNECT_ORIGINS` in `lib/security/csp.ts` lists
WalletConnect's relay, Albedo and Trezor Connect, each with a comment. When a
new module is added, connect it under report-only first and record the
violations before adding an origin.

## Trusted Types and remaining work

Trusted Types (`require-trusted-types-for 'script'`) runs in report-only mode
alongside the CSP, under the `nextjs#bundler` policy name. It is not enforced:
the wallet kit and the Next.js bootstrap write script URLs and inline data, so
a narrowly scoped `default` policy must be registered and violations reviewed
before the directive moves into the enforcing header.

Rollout: ship report-only, collect reports for a release, fix violations, then
set `NEXT_PUBLIC_CSP_ENFORCE=1`. The header check (`npm run check:headers`)
asserts every header on `/`, `/markets`, `/markets/quick-view`,
`/reasoning/verify`, `/premium` and `/copy-trade`.

## Collateral asset issuer verification (SEP-1)

`lib/stellar/issuer-verification.ts` verifies the collateral asset's issuer
through SEP-1 (`home_domain` on the issuer account →
`https://<domain>/.well-known/stellar.toml` → matching `[[CURRENCIES]]` entry
with both `code` and `issuer`, plus `[DOCUMENTATION] ORG_NAME`).

- **Trust limit**: This proves only that the issuer account and the domain's
  `stellar.toml` agree; it does **not** prove the organization is trustworthy or
  that an asset is official Circle USDC. For mainnet, always pin the expected
  issuer in `NEXT_PUBLIC_USDC_ASSET` as the primary control, treating SEP-1
  verification as a second line of defense.
- **Browser CORS limitation**: SEP-1 requires `Access-Control-Allow-Origin: *`
  on `stellar.toml`. Many issuers do not configure CORS headers, causing browser
  fetches to fail. Network and CORS failures are reported as `"unverifiable"`
  (distinct from `"unverified"`), without any proxy or backend workaround.
- **Mainnet vs. testnet**: Mainnet fails closed (trustline creation and trading
  are blocked without an override when `status !== "verified"`). Testnet warns
  but allows, since the default test asset is self-issued and may lack a
  `home_domain`.
