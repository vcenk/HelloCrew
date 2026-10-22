# Implementation verification

Verified locally on 2026-10-13. This is a synthetic practice prototype, not live AI or a production security certification.

## Passed

- Clean `npm ci` from the committed npm lockfile (Node.js 24.19.0, npm 11.9.0).
- `npm run lint`: ESLint, no errors or warnings.
- `npm run typecheck`: TypeScript, no errors.
- `npm test`: 108 tests across thirteen files, all passed.
- `npm audit --omit=dev`: zero reported production dependency vulnerabilities at verification time. This is not a comprehensive security audit.
- Production-server smoke: `/app` returned 200, `/api/demo` returned a grounded FAQ answer with 200, and `/api/live` returned 503.
- `npm run build`: optimized Next.js 16.4.0 build passed; `/` and `/app` prerendered, `/api/demo` and `/api/live` dynamic.

New coverage includes grounded free-text answers, explicit matched/missing source metadata, profile request isolation, assistant-identity schema validation, complete purpose-starter defaults, legacy identity migration, invalid browser-storage fallback, exact FAQ matching, safe booking schemes, injection-like configuration treated as literal data, unknown-answer fallback, whole-token catalog names, explicit description requests, input bounds, disabled OpenAI transport, same-origin handling behind a local/proxied host, widget installation/request validation, defensive iframe-loader behavior, fixed practice routing, actual widget byte limits, model-provider slot declarations, typed workflow safety validation, complete purpose-to-workflow recommendation coverage, booking-to-approval-workflow matching, legacy workflow draft migration, immutable published versions, archive lifecycle, missing/draft/published workflow-readiness summaries, archived-workflow exclusion, complete allowlisted job policies, zero-write practice-plan compilation, approved-only knowledge retrieval, multilingual matching, draft/outdated exclusion, Supabase project-ref pinning, and OAuth return-path normalization.

Test coverage includes typed tool validation, fictional quote calculation, FAQ/handoff results, actual graph activity, preparation without booking, approval record isolation, repeat-decision idempotence within returned state, rejection preservation, caller-state immutability, final-turn approval resolution, scenario cap, malformed inputs, each ambient tracing/verbose flag rejected, actual request byte limit, JSON and origin checks, and fail-closed live endpoint.

## Browser QA: passed

The complete headless Chrome smoke flow passed against the optimized production server on desktop and mobile. The flow covers the landing page, unauthenticated `/workspace` redirect, login page, OAuth trust copy, login mobile overflow, the four-stage Home map, grouped navigation, deep-linked section URLs, section responsibility guides, the explicit Identity → Business profile → Knowledge setup flow, purpose-starter selection and default application, shared identity in Conversations and the Website Chat preview, configured missing-answer fallback, identity persistence after refresh, identity and business previews, unsafe booking-link rejection, calculated channel readiness, missing-to-published workflow readiness, readiness-count changes before publishing and after conversation reset, the real widget loader, embeddable-frame security headers, iframe open/resize messaging, grounded widget replies, desktop/mobile installation-test layouts, model-routing ownership and disconnected OpenAI/Anthropic states, direct channel-to-workflow navigation, purpose-specific workflow recommendation and explicit-selection copy, all deterministic conversation scenarios, approve/decline, confirmed reset/refresh, adding and approving knowledge, approved-only retrieval, template selection, guided node-job editing, saving to My workflows, zero-write test-plan preview, publishing a local immutable version, the advanced workflow canvas, responsive overflow checks, and browser page errors. The Google Review Assistant was also opened in the real in-app browser and its eight connected steps, disconnected Google state, review-risk fields, approval gate, and follow-up path were verified.

That flow lived in `scripts/browser-check.mjs` as one sequential script. It is now a Playwright suite under `tests/e2e` (`npm run test:e2e`), split into independent specs that each build up their own practice data; set `SHOTS_DIR` to still collect the desktop/mobile review screenshots for the landing page, Home map, assistant identity, knowledge, conversation, approval, workflow builder and website channel.

## Important remaining boundaries

- Supabase migration `20261013051836_initial_tenant_foundation` was applied to project `yfmoggubjsffgameexfi`. Eleven empty tenant tables were listed afterward; all reported RLS enabled, a direct catalog query confirmed forced RLS on all 11, membership-editable tables had the expected policies, and checkpoints/approvals/usage reservations had zero browser policies. The auth-user and updated-at triggers were present. The scoped connector did not expose the Supabase advisor tool, so advisor output is not part of this verification.
- Google OAuth code and protected routing are implemented, but a real Google account/provider callback was not exercised in automated QA. Durable editor repositories, distributed quota, visitor auth, and live provider transport remain absent.
- Browser-owned demo state is untrusted and can be replayed/reset. It only controls fictional local results and is never sufficient for live approval or spending limits.
- Per-request size/schema/graph bounds and 12 practice turns constrain normal demo work. They are not a global abuse or hosting-cost cap.
- Pending approvals remain resolvable at the 12-turn cap and do not consume additional scenario turns.
- Live AI always returns 503. No flag or API key enables it.
- Demo refuses execution if external tracing or LangChain verbose logging is enabled by ambient environment variables.
- No real booking, customer message, payment, or human handoff is performed. WhatsApp and phone are disconnected.
- This release is pushed to the project repository after verification; deployment status is not independently verified here. Existing hosting and branch auto-deploy settings must be checked before publication.
- The project’s own license is pending the owner’s choice; dependencies retain their own licenses.
