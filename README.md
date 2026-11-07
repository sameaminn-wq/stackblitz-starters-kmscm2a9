# AI Inventory Intelligence

AI-assisted inventory scanning prototype for retailers and small stockrooms. The application analyzes a supplied shelf or stock image, returns a structured product list for human review, and can export the reviewed list to Excel.

> **Project status:** engineering prototype / supervised pilot candidate. It is not yet a production multi-tenant inventory management system.

## Current capabilities

- Upload a raster image or capture an image using the browser camera.
- Analyze visible products with the Gemini API.
- Review and edit detected product names, brands, categories, quantities, prices, and barcodes.
- Export the reviewed inventory as an Excel workbook.
- Generate an invoice/report in a browser print view.

## Important limitations

- AI recognition and quantity counts can be wrong. A human must review the output before using it for purchasing, accounting, or stock decisions.
- Barcode text returned by the model is not equivalent to a verified barcode scan.
- Automatic AI-generated price estimates are disabled by default. No live market-price or exchange-rate provider is currently integrated.
- The server-side PDF export endpoint is disabled until Arabic font embedding and text shaping are implemented. The browser print view can still be printed or saved as PDF, but should be visually checked.
- The current repository does not provide authentication, organization/tenant isolation, durable inventory persistence, production rate limiting, billing, or an audit history.
- Do not upload confidential customer or business data until access control, retention, and privacy controls are implemented.

## Requirements

- Node.js 20.9 or newer
- npm
- A Google Gemini API key

## Setup

1. Install dependencies:

   ```bash
   npm ci
   ```

2. Create `.env.local` in the project root:

   ```env
   GEMINI_API_KEY=your_gemini_api_key
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   ```

3. Start the development server:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000).

## Quality checks

Run these before submitting changes:

```bash
npm run lint
npx tsc --noEmit
npm run build
npm audit
```

CI also runs small runtime smoke tests for ExcelJS workbook generation and Sharp image conversion.

## Environment and deployment notes

- Keep `GEMINI_API_KEY` in server-side environment variables. Never expose it through a `NEXT_PUBLIC_*` variable.
- Configure `NEXT_PUBLIC_SITE_URL` to the deployed origin for correct metadata URLs.
- Review provider quotas and set operational spending limits before exposing the API publicly.

## Engineering report

See [docs/ENGINEERING_REPAIR_REPORT.md](docs/ENGINEERING_REPAIR_REPORT.md) for the first repair pass, verification results, and remaining release blockers.
