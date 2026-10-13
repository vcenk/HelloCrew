# Implementation verification

Verified locally on 2026-10-12. This is a synthetic practice prototype, not live AI or a production security certification.

## Passed

- Clean `npm ci` from the committed npm lockfile (Node.js 24.19.0, npm 11.9.0).
- `npm run lint`: ESLint, no errors or warnings.
- `npm run typecheck`: TypeScript, no errors.
- `npm test`: 65 tests across five files, all passed.
- `npm audit --omit=dev`: zero reported production dependency vulnerabilities at verification time. This is not a comprehensive security audit.
- Production-server smoke: `/app` returned 200, `/api/demo` returned a grounded FAQ answer with 200, and `/api/live` returned 503.
- `npm run build`: optimized Next.js 16.4.0 build passed; `/` and `/app` prerendered, `/api/demo` and `/api/live` dynamic.

New coverage includes grounded free-text answers, profile request isolation, exact FAQ matching, safe booking schemes, injection-like configuration treated as literal data, unknown-answer fallback, whole-token catalog names, explicit description requests, input bounds, disabled OpenAI transport, same-origin handling behind a local/proxied host, and typed workflow safety validation. Independent code review reproduced and verified fixes for catalog-intent priority and unsafe substring matching.

Test coverage includes typed tool validation, fictional quote calculation, FAQ/handoff results, actual graph activity, preparation without booking, approval record isolation, repeat-decision idempotence within returned state, rejection preservation, caller-state immutability, final-turn approval resolution, scenario cap, malformed inputs, each ambient tracing/verbose flag rejected, actual request byte limit, JSON and origin checks, and fail-closed live endpoint.

## Browser QA: passed

The production build passed the complete headless Chrome smoke flow on desktop and mobile. It covers the landing page, navigation, all deterministic conversation scenarios, approve/decline, reset/refresh, the workflow canvas, local workflow save, responsive overflow checks, and browser page errors. The real browser flow also confirms that `/api/demo` accepts localhost requests when Next.js listens on `0.0.0.0`.

`scripts/browser-check.mjs` contains the reproducible flow. It generated and visually reviewed desktop/mobile screenshots for the landing page, studio, conversation, approval, and workflow builder.

## Important remaining boundaries

- No authentication, tenant authorization, durable database, distributed quota, or live provider transport. Provider request/adapter scaffolding, durable interfaces and a deny-first SQL design draft are present; the SQL has not been applied or validated against a database.
- Browser-owned demo state is untrusted and can be replayed/reset. It only controls fictional local results and is never sufficient for live approval or spending limits.
- Per-request size/schema/graph bounds and 12 practice turns constrain normal demo work. They are not a global abuse or hosting-cost cap.
- Pending approvals remain resolvable at the 12-turn cap and do not consume additional scenario turns.
- Live AI always returns 503. No flag or API key enables it.
- Demo refuses execution if external tracing or LangChain verbose logging is enabled by ambient environment variables.
- No real booking, customer message, payment, or human handoff is performed. WhatsApp and phone are disconnected.
- This implementation task has not pushed or deployed this release. Existing project hosting and branch auto-deploy settings must be verified separately before publication.
- The project’s own license is pending the owner’s choice; dependencies retain their own licenses.
