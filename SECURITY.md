# Security policy

## Reporting a vulnerability

Please report security issues privately through the repository's **Security → Advisories → New draft security advisory** workflow. Do not include private artwork, customer files, credentials, or other sensitive data in a public issue.

Include the affected version or commit, browser, reproduction steps, impact, and a minimal synthetic PDF when possible. Reports will be acknowledged as soon as practical.

## Supported version

Security fixes are applied to the latest version on the `main` branch and the current GitHub Pages deployment.

## Processing model

The application is static and has no server-side PDF processing. Selected files remain in browser memory, are sent only to a same-origin Web Worker, and are released when the page is closed or replaced. Users should still avoid processing untrusted files on devices where browser resource exhaustion would be disruptive.
