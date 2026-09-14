# Inkscape to VersaWorks

<br />

> [!TIP]
> **Try It Now** in your browser: https://analyticjeremy.github.io/inkscape_to_versaworks/

<br />

---

[Inkscape to VersaWorks](https://analyticjeremy.github.io/inkscape_to_versaworks/) is a browser-based preparation tool for Roland print-and-cut workflows. It accepts a PDF exported from Inkscape, finds magenta and red stroked vector paths, and rewrites those strokes as the spot colors that VersaWorks recognizes:

| Inkscape guide stroke | VersaWorks spot color | Purpose |
| --- | --- | --- |
| Magenta (`#FF00FF`, with a small tolerance) | `CutContour` | Standard contour cut |
| Red (`#FF0000`, with a small tolerance) | `PerfCutContour` | Full perforated cut |

The artwork is never uploaded. Parsing and PDF generation happen entirely in a Web Worker in the browser.

> This project is not affiliated with or endorsed by Roland DG or the Inkscape project. Always verify the cut-path preview and job settings in VersaWorks before operating the printer/cutter.

## Why this project exists

VersaWorks identifies cut paths by exact, case-sensitive **spot-color names**, not by the visible RGB color alone. Applications such as Adobe Illustrator can create those spot colors directly, but Inkscape's PDF export does not provide the same spot-color workflow.

This app uses ordinary magenta and red strokes as authoring guides in Inkscape, then changes only those eligible PDF stroking-color commands. It does not rasterize the page, redraw the artwork, or upload the file to a conversion service.

Roland documents `CutContour` for normal cutting and `PerfCutContour` for perforated cutting. See:

- [Roland DG: Creating the Cutting Data](https://downloadcenter.rolanddg.com/contents/manuals/VW7_STA_EN/cit1779237235519.html)
- [Roland DG: Registering the Cutting Line Spot Color](https://downloadcenter.rolanddg.com/contents/manuals/VW6_English/oto1721177308067.html)
- [Roland DG: Performing Perforated Cutting at Image Boundaries](https://downloadcenter.rolanddg.com/contents/manuals/VW6_English_R6/topic/tPerformingPerforatedCutForImageBoundaries.html)

## Use the app

1. In Inkscape, create the cut path as a **vector stroke**. A thin stroke such as 0.25 pt (about 0.088 mm) is a practical guide.
2. Remove the path's fill if it is not needed.
3. Set the stroke color:
   - Magenta (`#FF00FF`) for a contour cut.
   - Red (`#FF0000`) for a full perf cut.
4. Export the document as PDF and keep vector artwork intact.
5. Open the web app and select or drop the PDF.
6. Review the detected path counts and choose a mapping:
   - **Auto-detect:** magenta becomes `CutContour`; red becomes `PerfCutContour`.
   - **Contour cut:** every detected magenta or red path becomes `CutContour`.
   - **Full perf cut:** every detected magenta or red path becomes `PerfCutContour`.
7. Create and download the converted PDF.
8. Add the output PDF to VersaWorks. Confirm that the expected cut lines appear in the preview, then review the machine, media, force, speed, and perforation settings before running the job.

The app defaults to contour mode for a magenta-only file and full perf mode for a red-only file. Mixed files default to Auto-detect so both mappings are preserved.

## Detection behavior

The converter examines PDF page drawing streams and Form XObjects. A candidate must:

- Be a **stroked vector path** painted with a PDF stroking operator.
- Use Device RGB or Device CMYK stroke values that are close to pure magenta or pure red.
- Be represented as vector content rather than pixels in an embedded image.

The RGB tolerance is 0.09 per channel. This accepts minor export rounding while avoiding broadly matching unrelated pink, purple, orange, or dark red artwork.

Only the stroking color is replaced. Fills, clipping paths, transformations, transparency, gradients, images, page size, and unrelated colors remain in the document.

## Privacy and security

- Processing is local. The deployed app has no upload endpoint, analytics, advertising, account system, or remote PDF API.
- Files are limited to 50 MB.
- Decoded drawing data is capped to reduce the risk of browser memory exhaustion.
- Encrypted, password-protected, malformed, and unsupported PDFs are rejected with an error instead of producing a success-shaped result.
- PDF work runs in a Web Worker to keep the interface responsive.
- The page uses a restrictive Content Security Policy and does not inject filenames or error text as HTML.
- Generated download URLs are temporary and are revoked when replaced or when the page closes.
- The deployment workflow builds from a lockfile, runs tests and type checking, and deploys only the generated `dist` directory.

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Known limitations

- Rasterized cut lines cannot be converted.
- Stroke colors in ICC-based, calibrated, pattern, or other custom PDF color spaces are not currently detected. Standard Inkscape Device RGB output is supported.
- Stroked text is not treated as a cut path.
- The converter does not add, simplify, offset, close, or otherwise repair vector geometry.
- A visually red or magenta object that is fill-only is deliberately ignored.
- The app does not configure VersaWorks job settings. Perf force, half-cut force, perforation length, and related machine options remain the operator's responsibility.
- PDF signatures are not preserved because modifying a signed PDF invalidates its signature.
- A complex PDF can use features outside the subset that can be safely rewritten in a browser. In that case, the app stops and leaves the source file untouched.

## Development

### Requirements

- Node.js 22 or newer
- npm 10 or newer

### Commands

```text
npm ci
npm run dev
npm run test
npm run build
npm run check
```

`npm run check` runs the complete automated validation used by the deployment workflow.

### Project structure

```text
src/
  main.ts                    Browser UI and worker client
  styles.css                 Responsive Fluent-inspired visual system
  pdf.worker.ts              Isolated browser PDF worker
  pdf/
    contentStream.ts         PDF operator tokenizer, detector, and rewriter
    processor.ts             PDF loading, resource creation, and serialization
    *.test.ts                Detection and PDF integration tests
```

The app uses Vite and TypeScript. [`pdf-lib`](https://pdf-lib.js.org/) loads and serializes the document, while the project-specific content-stream code:

1. Decodes page and Form XObject drawing streams.
2. Tracks PDF graphics-state save/restore operations.
3. Finds stroked paths whose active stroke is near magenta or red.
4. Adds `/Separation` color spaces named `CutContour` and `PerfCutContour`.
5. Replaces only the candidate stroking-color commands.
6. Saves a non-object-stream PDF for broad RIP compatibility.

## GitHub Pages deployment

The workflow in `.github/workflows/deploy-pages.yml` deploys pushes to `main` and can also be run manually.

For a new fork:

1. Open **Settings → Pages** in the GitHub repository.
2. Set **Source** to **GitHub Actions**.
3. Push to `main` or run **Deploy to GitHub Pages** from the Actions tab.

Vite uses relative asset URLs, so the build works under a GitHub Pages project subpath without hard-coding a repository name.

## License

This project is available under the [MIT License](LICENSE).
