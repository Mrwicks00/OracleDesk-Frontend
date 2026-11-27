# Adding a contract entrypoint

Use this checklist when a contract PR adds or exposes an entrypoint.

1. Merge or bump the contract submodule to the deployed commit.
2. Run `npm run sync:bindings`, then `npm run spec:diff` if available.
3. Add a return-type pin for the method in `lib/stellar/__tests__/typed-call.test-d.ts`.
4. Add it to `scripts/entrypoints.config.json`.
5. Add pure preflight logic in `lib/stellar/preflight.ts`.
6. Add the prepare function and hook in `lib/hooks/useStellar.ts`.
7. Route writes through `useWriteGuard`, `runQueuedWrite`, `reviewPreparedWrite`, and `useTxRunner`.
8. Add tracker, decode-label, optimistic/invalidation, and friendly-error coverage.
9. Run `npm run check:entrypoints` and the focused tests.

## Reference: claim_pool_remainder

The treasury/market-core `claim_pool_remainder` entrypoint is the worked reference:

```bash
node scripts/scaffold-entrypoint.mjs marketCore claim_pool_remainder --kind write --dry-run
node scripts/scaffold-entrypoint.mjs marketCore claim_pool_remainder --kind write
```

The generated output provides TODOs for the argument type, preflight, review, and
tests. Do not sign manually: review the intended market and claim amount first,
and keep the write in the normal submit queue.

The scaffolder cannot generate UI copy, friendly error text, or contract-specific
preflight rules. These remain manual and must be covered by tests.

## Rules

- Use `ledgerClock`/the read ledger for ledger-dependent checks, never `Date.now()`.
- Keep query keys under `"stellar"` and use `useScopedMutation` for backend writes.
- Never use a memo or muxed display address for a Soroban chain write; use the base G account.
- Redeploy or capability-gate entrypoints that are not live on the deployed contracts.
