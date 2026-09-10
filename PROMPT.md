# Browser-Based Roland CutContour EPS Postprocessor

## Problem statement

The Roland BN2-20 VersaStudio printer/cutter accepts artwork in EPS format and uses a specially named spot color to distinguish cut paths from printed artwork. Paths whose stroke uses the Roland spot color named exactly `CutContour` are interpreted by VersaWorks as contour-cut instructions rather than ordinary printed lines.

Adobe Illustrator and CorelDRAW can create and preserve named spot colors in EPS output, but their cost can be difficult to justify for a small print-and-cut workflow. Inkscape is a capable free vector editor and can create the artwork and cut geometry, but its EPS export does not reliably preserve a named spot color in the form required by VersaWorks. A path that appears magenta in Inkscape may be exported only as an ordinary process RGB or CMYK color. Although it looks correct, VersaWorks does not recognize it as a cut contour because the required spot-color identity has been lost.

The proposed solution is a static, single-page web application that postprocesses EPS files exported by Inkscape. The user marks cut paths with a distinctive temporary stroke color, exports the design as EPS, opens that EPS in the web app, selects the marker color, and downloads a modified EPS in which matching strokes use the named `CutContour` spot color.

The application can run entirely in the browser and be hosted on GitHub Pages. Artwork never needs to be uploaded to a server.

## Roland's relevant requirement

Roland documents a workflow in which the paths to be cut are assigned a spot-color swatch named exactly:

```text
CutContour
```

The name is case-sensitive. A process color that merely looks magenta is not equivalent to a named spot color.

The conventional alternate appearance for `CutContour` is full magenta:

```text
CMYK: 0, 100, 0, 0
RGB:  255, 0, 255
Hex:  #ff00ff
```

A thin stroke is normally used for the contour. A practical default is `0.25 pt`, although the application should make changing the stroke width optional rather than silently overriding it in every file.

Roland's documentation describes selecting the `CutContour` spot-color swatch and applying it to the stroke of the paths that should be cut before saving the artwork as EPS.

Reference: [Roland VersaWorks — Creating Cut Data](https://files.rolanddga.com/Files/Roland%20VersaWorks%20Manual/Roland%20VersaWorks%20Manual/!SSL!/Responsive_HTML5/036.html)

## Proposed user workflow

### In Inkscape

1. Create the printable artwork normally.
2. Create closed or open vector paths representing the desired cut contour.
3. Give all cut paths a distinctive marker stroke color that is not otherwise used in the artwork. Full magenta, `#ff00ff`, is a natural default.
4. Give cut paths no fill unless a fill is deliberately part of the printed design.
5. Optionally place the paths on an Inkscape layer named `cut` for authoring convenience.
6. Export or save the document as EPS, preferably with text converted to paths and using a consistent PostScript level.

### In the web application

1. Choose or drag an EPS file into the page.
2. Allow the application to inspect the file locally.
3. Review the stroke colors detected in the page program.
4. Select the marker color used for the cut paths.
5. Review how many stroke operations will be converted.
6. Choose whether to preserve the existing line width or replace it with a specified cut-line width such as `0.25 pt`.
7. Generate and download the modified EPS.
8. Import the result into VersaWorks and verify that the cut contour is recognized.

## Why selection should initially be color-based

Selecting an Inkscape layer sounds ideal, but EPS is a rendered page-description format rather than an editable document model. During EPS export, Inkscape may flatten groups and layers into a sequence of PostScript drawing commands. The original layer names, object IDs, and semantic hierarchy are normally absent from the resulting EPS.

Consequently, an EPS-only application usually cannot determine that a particular path came from a layer named `cut`. It can, however, observe which colors are active when paths are stroked.

The most reliable initial convention is therefore:

> Every cut path must use a unique marker stroke color before EPS export.

The application can inventory the colors used by actual stroke operations and present choices such as:

| Candidate color | Representation | Stroke count |
|---|---:|---:|
| Magenta | CMYK `0 1 0 0` | 3 |
| Black | Gray `0` | 18 |
| Blue | RGB `0 0 1` | 2 |

The user then selects the candidate that represents the cut paths.

A later version could accept the original SVG alongside the EPS and use SVG layers for a preview or selection interface. Reliably mapping arbitrary SVG objects back to flattened PostScript operations would still be difficult, so this should not be required for the first version.

## Solution overview

The application should be a deterministic EPS scanner and rewriter with a deliberately narrow compatibility boundary.

It should:

- read the EPS as local bytes;
- verify that the file is a supported text-based EPS;
- identify the document comments, prolog, page program, and trailer;
- tokenize the relevant PostScript rather than applying unrestricted text substitutions;
- track the active graphics state while scanning page drawing commands;
- collect colors that are active when a path is stroked;
- let the user choose a source stroke color;
- add the `CutContour` custom-color declaration and PostScript procedures;
- apply that custom color immediately before matching strokes;
- preserve all unrelated artwork and document structure;
- generate a new downloadable file without executing the PostScript.

It should not attempt to be a complete PostScript interpreter or general-purpose EPS editor.

## High-level architecture

```text
Inkscape document
      |
      | EPS export with unique marker stroke
      v
Browser file loader
      |
      | ArrayBuffer + byte-preserving decoding
      v
EPS and DSC validator
      |
      | supported text-based EPS
      v
Restricted PostScript tokenizer and scanner
      |                         |
      | candidate stroke colors| token/state information
      v                         v
Color-selection UI ------> EPS rewriter
                                |
                                | modified byte stream
                                v
                         Downloadable EPS Blob
                                |
                                v
                         Roland VersaWorks
```

### Suggested implementation modules

| Module | Responsibility |
|---|---|
| `file-loader` | Read an uploaded file into an `ArrayBuffer` and preserve its original bytes and line endings. |
| `eps-validator` | Verify the EPS signature, DSC structure, encoding, page count, and unsupported binary sections. |
| `postscript-tokenizer` | Produce strings, names, numbers, comments, delimiters, and operators without confusing values inside strings or comments with executable tokens. |
| `graphics-state-scanner` | Track colors, line width, graphics-state saves/restores, and path-painting operations. |
| `candidate-color-index` | Aggregate only colors associated with stroke operations and count their uses. |
| `cutcontour-rewriter` | Insert DSC metadata and prolog procedures and patch matching stroke sites. |
| `diagnostics` | Report unsupported or ambiguous constructs with actionable messages. |
| `download` | Encode the modified document and create a local downloadable `Blob`. |
| `ui` | Provide file selection, detected-color choices, options, warnings, and a conversion summary. |

## Reading EPS safely

EPS is commonly textual PostScript, but it should not be assumed to be UTF-8. Files can contain arbitrary byte values in comments, metadata, previews, or embedded resources.

The browser should first read the file using `File.arrayBuffer()`. For the initial text-only compatibility mode, the application can decode bytes using Windows-1252 or ISO-8859-1 semantics so that each byte maps predictably to one character. The output should preserve the original encoding and line-ending style wherever possible.

The application should not use APIs that normalize the file before it has been validated. It should also avoid parsing the EPS as Unicode text and then re-encoding it as UTF-8, because doing so can change byte offsets or embedded data.

## Supported EPS profile for the first release

The first release should intentionally support a constrained profile:

- EPS beginning with `%!PS-Adobe` and identifying itself as EPS;
- text-based, DSC-structured files;
- one page;
- files generated by known versions of Inkscape and its Cairo/PostScript exporter;
- ordinary numeric color-setting operations;
- ordinary path construction and stroke operations;
- recognizable short aliases defined in the EPS prolog;
- balanced `gsave` and `grestore` operations;
- no opaque compressed page program.

The application should reject or warn about:

- Windows binary EPS headers;
- binary preview data whose offsets would need to be recalculated;
- `%%BeginBinary` or `%%BeginData` sections that cannot be preserved safely;
- multiple pages;
- encrypted or compressed page programs;
- custom painting procedures whose effects cannot be established;
- PostScript that dynamically constructs or executes painting operators;
- ambiguous combined fill-and-stroke procedures;
- malformed DSC sections;
- existing incompatible `CutContour` definitions.

Failing closed is important. A conversion tool used for production artwork should refuse an unsupported file rather than generate a plausible-looking but damaged EPS.

## DSC structure and insertion points

A typical DSC-compliant EPS contains these broad regions:

```postscript
%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: ...
%%LanguageLevel: ...
%%EndComments

%%BeginProlog
...procedure definitions...
%%EndProlog

%%BeginSetup
...setup...
%%EndSetup

%%Page: 1 1
...page drawing program...
showpage

%%Trailer
%%EOF
```

The rewriter should find regions using DSC markers rather than assuming fixed line numbers.

### Header declarations

The following custom-color declarations should be inserted before `%%EndComments`, while preserving existing continuation conventions if the document already declares custom colors:

```postscript
%%DocumentCustomColors: (CutContour)
%%CMYKCustomColor: 0 1 0 0 (CutContour)
```

If `%%DocumentCustomColors` or `%%CMYKCustomColor` already exists, the application should update or extend it without creating contradictory duplicate declarations.

### Prolog procedures

A procedure for obtaining and applying the named custom color should be inserted before `%%EndProlog`:

```postscript
/CutContourColor {
  0 1 0 0 (CutContour) findcmykcustomcolor
} bind def

/SetCutContour {
  CutContourColor 1 setcustomcolor
} bind def
```

The exact implementation may need a compatibility fallback for interpreters that do not expose `findcmykcustomcolor` or `setcustomcolor`. Any fallback must preserve the named spot-color behavior on the target Roland workflow; falling back only to ordinary process magenta would reproduce the original problem.

An alternative implementation can use a PostScript `/Separation` color space if that proves more reliable with a representative set of VersaWorks inputs. The project should maintain known-good output fixtures for whichever representation is chosen rather than assuming every theoretically valid PostScript spot-color encoding is handled identically by VersaWorks.

## Why a tokenizer is necessary

Simple regular expressions are tempting, but arbitrary line-based replacements are unsafe for PostScript.

For example, all of the following are possible:

```postscript
0 1 0 0 setcmykcolor
0 1 0 0 k
100 100 moveto 200 200 lineto stroke
100 100 m 200 200 l S
```

An exporter can define `k`, `m`, `l`, or `S` as aliases in the prolog. Multiple operations can appear on one line, and comments or strings can contain text that resembles an operator. Numeric formatting may use integers, decimals, signs, or exponent notation.

The application therefore needs a restricted lexical tokenizer that understands at least:

- whitespace;
- `%` comments;
- literal strings in balanced parentheses, including escapes;
- hexadecimal strings;
- names beginning with `/`;
- executable names and operators;
- integers and real numbers;
- arrays and dictionaries sufficiently to skip or inspect procedure definitions;
- DSC comments as a distinct structural layer.

This is not a complete interpreter. Its purpose is to avoid mistaking text for executable operators and to recognize a controlled subset of common EPS output.

## Resolving exporter aliases

Inkscape-generated EPS often defines short procedure names in its prolog. The scanner must determine which aliases represent operations relevant to the conversion.

For example, a prolog might contain definitions conceptually equivalent to:

```postscript
/S { stroke } bind def
/k { setcmykcolor } bind def
/w { setlinewidth } bind def
/q { gsave } bind def
/Q { grestore } bind def
```

The application should inspect simple procedure definitions and build an alias table for a small allowlist of operations:

- `setrgbcolor`;
- `setcmykcolor`;
- `setgray`;
- `setcolorspace` and `setcolor`, when present;
- `setlinewidth`;
- `stroke`;
- `gsave`;
- `grestore`;
- common fill or combined paint operations needed to avoid false matches.

Only simple, statically recognizable aliases should be accepted. If an alias performs several operations or invokes unknown procedures, the scanner should mark it as ambiguous.

## Graphics-state tracking

PostScript graphics state is stack-based. A color can be set once and used by several later paths, and nested `gsave`/`grestore` pairs can temporarily change it.

The scanner should maintain a state object such as:

```ts
interface GraphicsState {
  color:
    | { space: "gray"; gray: number }
    | { space: "rgb"; r: number; g: number; b: number }
    | { space: "cmyk"; c: number; m: number; y: number; k: number }
    | { space: "custom"; name: string; tint: number }
    | { space: "unknown" };
  lineWidth: number | null;
}
```

On `gsave`, the current state is copied onto a stack. On `grestore`, the previous state is restored. Underflow, unmatched saves, or state changes through unknown procedures should produce diagnostics.

The scanner does not need to calculate path geometry for the first release. It only needs to identify painting operations and record the active state when a stroke occurs.

## Candidate-color detection

Only colors active at actual stroke operations should be offered as cut-path candidates. Colors used exclusively for fills, images, gradients, or other operations should not clutter the selection interface.

For each recognized stroke operation, record:

- source token range or insertion offset;
- active color space and values;
- active line width;
- stroke operator or resolved alias;
- whether the operation also fills the path;
- graphics-state confidence;
- optional source line number for diagnostics.

Candidate colors can then be normalized and grouped. Initial grouping should use exact parsed numeric values after normalizing equivalent number formats. A later version may allow a small tolerance, but approximate matching should be explicit because two intentionally different colors can be numerically close.

The UI should show:

- a visual swatch;
- the source color space;
- numeric values;
- how many stroke operations use the color;
- the line-width range;
- warnings for any ambiguous use.

## Rewriting matching strokes

For every stroke whose tracked color exactly matches the selected candidate, the rewriter should apply `CutContour` immediately before the painting operation.

Conceptually, this:

```postscript
0 1 0 0 setcmykcolor
0.5 setlinewidth
100 100 moveto
200 100 lineto
stroke
```

becomes:

```postscript
0 1 0 0 setcmykcolor
0.5 setlinewidth
100 100 moveto
200 100 lineto
SetCutContour
0.25 setlinewidth
stroke
```

Inserting the spot-color assignment adjacent to the stroke is safer than replacing an earlier color-setting command. The earlier color might also be used for a fill or another object, whereas the desired transformation concerns a specific stroke operation.

The generated code should preserve graphics state. If changing the line width, a robust pattern is:

```postscript
gsave
SetCutContour
0.25 setlinewidth
stroke
grestore
```

However, this is correct only if the path survives `gsave` and `grestore` as expected and if the exporter does not rely on the stroke operation to consume the path in a later combined operation. The implementation must test the chosen sequence against actual Inkscape EPS output.

An alternative is to set the custom color and width directly before `stroke` without wrapping it, allowing the existing surrounding graphics-state structure to restore values naturally. This creates a smaller change but can affect later drawing commands if no restore follows. The scanner should use known surrounding state and exporter patterns to choose a safe transformation.

### Fills must remain unchanged

If a cut path also has a fill, that fill is generally printable artwork and should not become `CutContour`. The transformation must apply the custom color only to the stroke.

Combined fill-and-stroke procedures require special handling. If an operator performs both actions internally and the scanner cannot safely separate them, the first release should reject that stroke site rather than recolor the fill.

## Existing `CutContour` data

When the source EPS already contains `CutContour`, the application should inspect it before making changes.

Possible cases include:

- the file is already valid and needs no conversion;
- some strokes already use `CutContour`, while others use the marker color;
- a process color or unrelated resource happens to contain the text `CutContour`;
- an existing custom-color declaration uses conflicting alternate CMYK values;
- an existing procedure name collides with the procedure the application wants to insert.

The application should not blindly duplicate definitions. It should either reuse a compatible existing definition, add missing declarations, choose collision-resistant internal procedure names, or stop with a clear conflict diagnostic.

A generated internal name could include an application prefix, for example:

```postscript
/RolandCutContourApp_SetColor { ... } bind def
```

The public custom-color name must still remain exactly `CutContour`.

## User interface design

The page can be compact and task-focused.

### File selection area

- drag-and-drop target;
- file picker accepting `.eps` and `.ps` only when appropriate;
- file name and size;
- local-processing statement;
- replace-file action.

### Inspection summary

- EPS version and language level;
- bounding box;
- creator and creation date when available;
- page count;
- detected exporter signature;
- whether the file matches a tested Inkscape profile;
- warnings and unsupported-feature diagnostics.

### Candidate stroke colors

Each candidate should be a selectable row containing:

- swatch;
- RGB, CMYK, or gray values;
- stroke count;
- existing line widths;
- confidence indicator.

The convert button should remain disabled until the file is supported and exactly one candidate is selected.

### Options

- preserve existing line width;
- set all selected cut strokes to `0.25 pt`;
- enter a custom width;
- use strict exact-color matching;
- optionally include already-named `CutContour` strokes in the summary.

### Conversion summary

Before downloading, show a concise change plan:

```text
3 stroke operations will be converted.
Source color: CMYK 0, 1, 0, 0
Target spot color: CutContour
Line width: set to 0.25 pt
Fills and 21 other strokes will remain unchanged.
```

After conversion, provide:

- output file name;
- download button;
- checksum if useful for support;
- warnings that remain relevant;
- recommendation to verify the cut contour in VersaWorks before production.

## Preview strategy

Rendering an EPS preview directly in a static browser application is difficult because browsers do not natively render PostScript. Bundling a PostScript interpreter such as Ghostscript through WebAssembly would add significant download size, complexity, security considerations, and potential licensing obligations.

The first release should not require a visual EPS preview. It can provide useful confidence through:

- candidate-color swatches;
- stroke counts;
- source line widths;
- bounding-box information;
- a detailed conversion summary;
- downloadable diagnostics for unsupported files.

If visual selection later becomes important, the application could accept the original SVG as a companion file and display it using the browser's native SVG support. The SVG would be a visual aid, not the authoritative data being rewritten.

## Security model

EPS contains executable PostScript. The application must treat uploaded content as untrusted data.

It should never:

- execute the EPS;
- evaluate PostScript procedures;
- pass file contents to `eval`, dynamic JavaScript, or a command interpreter;
- upload artwork without explicit user consent;
- render untrusted EPS through a server-side interpreter;
- inject EPS strings or metadata into the DOM using unsafe HTML APIs.

It should:

- use a bounded tokenizer with file-size and nesting limits;
- escape all metadata displayed in the UI;
- cap string length, token count, recursion depth, and graphics-state depth;
- abort cleanly when limits are exceeded;
- process the file in a Web Worker so malformed input cannot freeze the interface;
- create output only after structural checks pass;
- use a restrictive Content Security Policy suitable for a static site;
- avoid third-party analytics or remote dependencies that could observe file-derived information.

Because all processing is local, the page can make a strong privacy statement: the selected EPS remains on the user's computer.

## Error handling and diagnostics

The application should explain why a file cannot be converted. Examples include:

```text
This file contains a Windows binary EPS preview. That format is not supported yet because modifying the PostScript section would invalidate stored byte offsets.
```

```text
The stroke operator `XS` is defined by a custom procedure whose behavior cannot be determined safely.
```

```text
The selected color is used by both a simple stroke and a combined fill-and-stroke procedure. No output was generated.
```

```text
The file already defines a custom color named CutContour with conflicting alternate CMYK values.
```

No error path should produce a success-shaped download. The original file must remain untouched.

## Testing strategy

### Unit tests

Test the tokenizer with:

- whitespace and comments;
- escaped and nested PostScript strings;
- hexadecimal strings;
- integers, decimals, signed values, and exponent notation;
- executable and literal names;
- multiple operators on one line;
- operator-like text inside comments and strings;
- malformed input and nesting limits.

Test graphics-state tracking with:

- repeated colors;
- nested `gsave` and `grestore`;
- line-width changes;
- RGB, CMYK, and gray colors;
- aliases for relevant operators;
- unknown state-changing procedures;
- stack underflow and unmatched saves.

Test rewriting with:

- one matching stroke;
- several matching strokes;
- no matching strokes;
- the same color used by fills and strokes;
- preservation of nonmatching colors;
- existing custom-color comments;
- an already valid `CutContour` stroke;
- procedure-name collisions;
- CRLF and LF input;
- byte-for-byte preservation of unchanged regions.

### Golden-file tests

Maintain representative EPS fixtures exported by each explicitly supported Inkscape version. For every fixture, store:

- the input EPS;
- the selected marker color;
- expected diagnostics;
- the expected transformed EPS or normalized structural assertions;
- expected count of converted strokes.

Also maintain at least one known-good EPS created by software using Roland's official `CutContour` swatch. Compare its DSC declarations and custom-color usage with the generated output.

### PostScript validation

Use Ghostscript in automated tests or CI to parse generated EPS files and report syntax or stack errors. Run it in a safe, noninteractive mode appropriate for untrusted fixtures.

Ghostscript validation proves only that the PostScript is syntactically and operationally acceptable to Ghostscript. It does not prove that VersaWorks recognizes the named cut contour.

### Device-workflow acceptance tests

The definitive acceptance test is:

1. Open the generated EPS in VersaWorks.
2. Confirm that VersaWorks identifies the intended paths as cut contours.
3. Confirm that ordinary artwork remains printable.
4. Confirm that nonselected strokes are not cut.
5. Perform a small test print-and-cut job.
6. Verify cut alignment, line behavior, and absence of printed marker lines.

Repeat this test for representative files and after any change to the generated spot-color representation.

## Deployment on GitHub Pages

The application can be implemented with plain TypeScript and browser APIs or with a lightweight framework. It requires no backend.

A typical deployment consists of:

- static HTML, CSS, and JavaScript assets;
- a Web Worker containing the scanner and rewriter;
- bundled tests run in continuous integration;
- a GitHub Actions workflow that builds the site and deploys the static output to GitHub Pages;
- no persistent storage or server-side file handling.

The application should avoid loading parser code from a CDN. Bundling dependencies into the deployed assets makes the build reproducible and avoids leaking usage or file-derived metadata to third parties.

Because GitHub Pages serves static content over HTTPS, browser file APIs, workers, and client-side downloads are available without additional infrastructure.

## Suggested delivery phases

### Phase 1: Format research and fixtures

- collect several real Inkscape EPS exports;
- create a minimal known-good Roland-compatible EPS;
- identify the actual aliases and page-program structures emitted by target Inkscape versions;
- verify one custom-color encoding in VersaWorks;
- define the supported EPS profile from evidence.

### Phase 2: Command-line proof of concept

Before building the browser UI, implement the tokenizer, scanner, and rewriter as a testable TypeScript library with a small Node.js command-line wrapper. This makes fixture testing and iteration easier.

The proof of concept should:

- list candidate stroke colors;
- convert an explicitly selected candidate;
- emit diagnostics;
- produce EPS accepted by Ghostscript and VersaWorks.

### Phase 3: Browser application

- move the conversion library behind a Web Worker;
- add drag-and-drop file selection;
- add candidate-color selection;
- add conversion options and summary;
- generate a local download;
- ensure no network requests are needed during conversion.

### Phase 4: Compatibility hardening

- add fixtures from more Inkscape versions;
- improve alias recognition;
- support existing custom-color declarations;
- add robust limits and malformed-file tests;
- improve diagnostics rather than broadening support speculatively.

### Phase 5: Optional enhancements

- companion SVG preview;
- highlight candidate colors in the SVG preview;
- configurable Roland spot-color names such as other device-specific cut or crease colors;
- saved local preferences;
- installable Progressive Web App support;
- support for selected binary EPS variants if offsets can be recalculated safely;
- a downloadable conversion report for troubleshooting.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Inkscape changes its EPS prolog or aliases | Previously supported files become ambiguous | Detect exporter versions, use fixtures, and reject unknown patterns until tested. |
| A simple regex changes the wrong operation | Printed artwork or file syntax is damaged | Use tokenization and graphics-state tracking. |
| A marker color is also used in printable strokes | Unintended paths become cut lines | Show counts and line widths; require a unique authoring color. |
| Layer names are unavailable in EPS | The user cannot select an Inkscape layer directly | Use color-based selection; optionally accept SVG later. |
| A valid PostScript spot-color encoding is not recognized by VersaWorks | Generated output does not cut | Base output on a VersaWorks-verified fixture and run device acceptance tests. |
| Binary EPS offsets become invalid after insertion | File cannot be opened | Reject binary-header EPS in the initial version. |
| EPS is malicious or pathologically complex | Browser hangs or unsafe execution occurs | Never execute it; use a bounded parser in a Web Worker. |
| Changing line width affects later artwork | Noncut paths render incorrectly | Scope changes to the stroke site and track surrounding graphics state. |
| Output parses in Ghostscript but fails in VersaWorks | False confidence | Treat VersaWorks recognition as the final acceptance criterion. |

## Existing proof of concept

The open-source project [SVG/EPS to Roland VersaWorks Converter](https://github.com/rgon/svgToVersaworks) demonstrates that adding `CutContour` declarations and PostScript custom-color operations can make Inkscape-oriented workflows compatible with VersaWorks.

It is useful as evidence and as a source of sample declarations. However, a production browser tool should use a more conservative transformation model. Broadly replacing color commands or every stroke may be acceptable for a file containing only cut paths, but it is unsafe for a combined print-and-cut file where only selected strokes should become cut instructions.

The proposed application should therefore use that project as a reference, not simply translate its global regular-expression behavior into JavaScript.

## Recommended minimum viable product

The first useful release should do exactly the following:

1. Accept one text-based, single-page EPS produced by a tested Inkscape exporter.
2. Validate that the file fits the supported profile.
3. List exact colors used by recognizable stroke operations.
4. Let the user select one source stroke color.
5. Add a VersaWorks-verified `CutContour` custom-color definition.
6. Apply `CutContour` only to strokes using the selected source color.
7. Optionally set those strokes to `0.25 pt`.
8. Preserve fills, other strokes, geometry, bounding boxes, and unrelated prolog data.
9. Refuse ambiguous files with clear diagnostics.
10. Download the result locally without uploading or executing the EPS.

This narrow design solves the actual workflow problem while keeping the implementation testable and the output trustworthy. Broader EPS compatibility, layer-aware previews, and additional spot colors can be added later after the core transformation has been proven against real Inkscape exports and the Roland BN2-20 VersaWorks workflow.
