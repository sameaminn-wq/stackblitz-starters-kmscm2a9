# Engineering Repair Report — AI Inventory Intelligence

**Date:** 2026-11-07  
**Scope:** First repair pass on `fix/production-readiness-2026-11`  
**Pull request:** #7 — Draft; not merged into `main`

## Executive summary

The repository was a prototype with mismatched API/UI contracts, incomplete export integration, weak image-input limits, and invoice HTML assembled from user-controlled values. This pass repairs the highest-impact issues that could be addressed safely without redesigning the product.

This report does **not** certify production readiness. The automated install, audit, lint, type-check, build, and selected runtime smoke checks pass; device testing and several product and operational capabilities remain unimplemented.

## Changes made

### 1. Analysis prompt and product contract
- Added explicit per-request values for batch ID, image ID, timestamp, previous-scan context, and planogram context before building the Gemini prompt.
- Normalized each detected product to the shared `ProductItem` shape, including ID, fallback level, detection method, confidence score, image region, estimated-quantity flag, and compliance flags.
- Added `total_products_detected` to the API response because the UI reads that field.
- Expanded the UI's accepted analysis-quality values to include `fair` and `poor`.

### 2. Image request safety
- Enforced the request-body byte limit after reading the body, rather than relying only on the optional Content-Length header.
- Rejected SVG and other non-raster MIME types at the API boundary.
- Added Sharp decoded-pixel limits and an explicit decoded-format allowlist.
- Limited automatic pricing to opt-in requests. Automatic AI-generated estimates are not presented as verified live market prices.

### 3. Export contract
- Corrected the export route's import to use the shared root type definitions.
- Replaced the UI's unsupported Google Sheets integration with an actual Excel download matching the implemented API.
- Removed the misleading Spreadsheet ID settings and Google Sheets success messaging.
- Validated required product fields and bounded the export payload to 5 MB and 300 products.
- Added malformed-JSON handling and constrained worksheet names.
- Fixed PDF pagination code, but disabled the server-side PDF export endpoint until an Arabic font/shaping pipeline exists. The browser-based invoice print flow remains separate.

### 4. Camera and invoice handling
- Attached the camera stream after the video element is mounted.
- Changed the automatic capture mode to capture once and stop, avoiding a repeating three-second timer that could trigger overlapping AI requests.
- Escaped user-controlled invoice values before inserting them into invoice HTML.
- Restricted company-logo uploads to PNG/JPEG/WebP and 2 MB.

### 5. Project metadata and CI
- Replaced default Next.js metadata and set the document language/direction to Arabic.
- Added GitHub Actions checks for `npm ci`, runtime smoke tests, `npm audit`, ESLint, TypeScript, and production build.
- Upgraded the framework to Next.js 16.4.5 with React 19.2, ESLint 9, Sharp 0.35.5, and patched PostCSS. Added compatible transitive dependency overrides and refreshed `package-lock.json`.

## Verification status

| Check | Status |
|---|---|
| Source review of modified files | Completed |
| Clean dependency install (`npm ci`) | Passed |
| Dependency audit (`npm audit`) | Passed — 0 vulnerabilities reported |
| ExcelJS + Sharp runtime smoke tests | Passed |
| ESLint | Passed |
| TypeScript (`npx tsc --noEmit`) | Passed |
| Next.js 16.4.5 production build | Passed |
| Runtime camera test on browser/device | Not yet performed |
| Real image accuracy benchmark | Not yet performed |
| Excel export opened in Excel/LibreOffice | Not yet performed |
| Invoice print/PDF visual test | Not yet performed |
| Security penetration test | Not performed |

The passing CI run includes dependency installation, a zero-finding npm audit, runtime smoke tests for ExcelJS and Sharp, ESLint, TypeScript, and a Next.js production build. These checks do not replace camera/device, image-accuracy, or full security testing.

## Remaining blockers before a real pilot

1. **Identity and access:** no verified authentication, role model, or tenant isolation was added in this pass.
2. **Persistence:** no durable inventory/session database or audit history was added.
3. **Abuse and cost controls:** production-grade shared rate limiting, per-account quotas, and spend limits remain outstanding.
4. **AI quality:** recognition, quantity counting, and barcode extraction need a labeled test set from actual store/shelf images. Model confidence must be calibrated against measured outcomes.
5. **Barcode reading:** use a dedicated barcode decoder and validate its output; do not treat model-generated barcode text as authoritative.
6. **Pricing and FX:** connect trusted, region-appropriate data sources and show source plus retrieval timestamp. Do not market model-generated guesses as current prices.
7. **Arabic PDF:** embed a suitable Arabic font and implement shaping/bidi handling before enabling server-side PDF export.
8. **Operational readiness:** privacy policy, terms, retention/deletion policy, monitoring, error reporting, backups, and deployment secrets review remain necessary.
9. **Commercial validation:** run customer interviews and a small supervised pilot before building subscriptions or expanding to every inventory sector.

## Release recommendation

**Do not merge or launch commercially yet.** First wait for CI, fix every reported type/build error, manually test the main scan-to-edit-to-Excel flow, and validate accuracy with real images. Then review the remaining blockers and decide whether the product is ready for a limited supervised pilot.
