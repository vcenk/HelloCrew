# Implementation verification

Verified locally on 2026-10-10. This is a synthetic practice prototype, not live AI or a production security certification.

## Passed

- Clean `npm ci` from the committed npm lockfile (Node.js 24.19.0, npm 11.9.0).
- `npm run lint`: ESLint, no errors or warnings.
- `npm run typecheck`: TypeScript, no errors.
- `npm test`: 24 tests across two files, all passed.
- `npm audit --omit=dev`: zero reported production dependency vulnerabilities at verification time. This is not a comprehensive security audit.
- `npm run build`: optimized Next.js 16.4.0 build passed; `/` and `/app` prerendered, `/api/demo` and `/api/live` dynamic.

Test coverage includes typed tool validation, fictional quote calculation, FAQ/handoff results, actual graph activity, preparation without booking, approval record isolation, repeat-decision idempotence within returned state, rejection preservation, caller-state immutability, final-turn approval resolution, scenario cap, malformed inputs, each ambient tracing/verbose flag rejected, actual request byte limit, JSON and origin checks, and fail-closed live endpoint.

## Browser QA: blocked, not passed

The installed local Chromium could not launch because the execution environment denied its process socket (`socket() failed: Operation not permitted`). The separate cloud browser could not reach the local Next.js server (`ERR_CONNECTION_REFUSED`). No visual screenshot or completed browser interaction result is available.

`scripts/browser-check.mjs` contains a reproducible desktop/mobile smoke flow for a suitable environment. Start the app at localhost:3000, install Playwright Chromium (or set `CHROMIUM_PATH` to an existing executable), and run `npm run test:browser`. Review the generated screenshots before declaring the responsive UI visually verified.

## Important remaining boundaries

- No authentication, tenant authorization, durable database, distributed quota, or real provider integration.
- Browser-owned demo state is untrusted and can be replayed/reset. It only controls fictional local results and is never sufficient for live approval or spending limits.
- Per-request size/schema/graph bounds and 12 scenario turns constrain normal demo work. They are not a global abuse or hosting-cost cap.
- Pending approvals remain resolvable at the 12-scenario cap and do not consume additional scenario turns.
- Live AI always returns 503. No flag or API key enables it.
- Demo refuses execution if external tracing or LangChain verbose logging is enabled by ambient environment variables.
- No real booking, customer message, payment, or human handoff is performed. WhatsApp and phone are disconnected.
- No deployment performed. The owner will host later.
- The project’s own license is pending the owner’s choice; dependencies retain their own licenses.
