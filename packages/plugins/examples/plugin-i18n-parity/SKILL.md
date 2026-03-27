# i18n Parity Scanner — SKILL.md

Plugin key: `ocho.i18n-parity`
Package: `@ocho/plugin-i18n-parity`
Location: `packages/plugins/examples/plugin-i18n-parity`

---

## What it does

Scans every localized HTML page in the sudokuaday.com repo and scores it for translation completeness against the English source. Surfaces still-English content by locale, page, and section (surface).

---

## Installation (one-time, board action required)

```bash
# From the Paperclip sandbox root:
pnpm paperclipai plugin install \
  ./packages/plugins/examples/plugin-i18n-parity
```

Or via Paperclip UI: **Settings → Plugins → Examples → i18n Parity Scanner (Ocho) → Install**.

After installing, configure the instance config under **Settings → Plugins → ocho.i18n-parity**:

```json
{
  "repoPath": "/Users/achtung/Documents/projects/sudokuaday-clean",
  "minScore": 0.7
}
```

---

## Agent Tools

All tools are invoked via the Paperclip plugin tool dispatch mechanism. Use `ToolSearch` with the tool name to discover schemas.

| Tool | Description |
|------|-------------|
| `ocho.i18n-parity:run-scan` | Trigger a full or locale-filtered scan of all HTML pages |
| `ocho.i18n-parity:get-report` | Return the full JSON report from the most recent scan |
| `ocho.i18n-parity:get-summary` | Return per-locale roll-up (page count, avg score, worst pages) |
| `ocho.i18n-parity:get-page-detail` | Per-surface breakdown for a specific locale+path |
| `ocho.i18n-parity:create-tickets` | Create Paperclip issues for pages below the score threshold |

### run-scan

```json
{
  "locale": "sv",          // optional — omit to scan all non-EN locales
  "pageLimit": 20          // optional — cap pages per locale
}
```

Returns: full `V1Report` JSON with `localization.pages[]` and `localization.summary{}`.

### get-report

No parameters. Returns the cached `V1Report` from the last `run-scan` call.

### get-summary

No parameters. Returns `{ locale: string, total_pages, above_threshold, avg_score, worst_pages[] }[]` sorted by `avg_score` ascending.

### get-page-detail

```json
{
  "locale": "ja",          // required
  "path": "index.html"     // required — relative to locale root
}
```

Returns `V1PageResult` with per-surface breakdown:
`meta`, `nav`, `hero`, `main`, `cta`, `footer`, `embeds` — each with `english_likelihood`, `status`, and `evidence[]`.

### create-tickets

```json
{
  "minScore": 0.5,         // optional — override config threshold
  "dryRun": true           // optional — preview without creating
}
```

Creates one Paperclip issue per page below threshold. Issues are created with:
- `parentId` = parent locale audit issue (e.g. `SUD-1375` for Swedish)
- `goalId` = Locale Parity goal
- Title: `Engineer: translate <path> for /<locale>/`

---

## Surface Weights (defaults)

| Surface | Weight | Notes |
|---------|--------|-------|
| `hero` | 0.30 | H1 + hero paragraph |
| `main` | 0.30 | Article/main content body |
| `cta` | 0.10 | Button and link labels |
| `meta` | 0.15 | `<title>`, `<meta description>`, OG tags |
| `nav` | 0.05 | Navigation link labels |
| `footer` | 0.05 | Footer text |
| `embeds` | 0.05 | Embedded scripts, iframes |

A page is flagged when its weighted score < `minScore` (default 0.7).

---

## Scoring Logic

1. For each surface, `english_likelihood` (0–1) is estimated using EN stopwords, script detection (Latin vs. CJK/Devanagari/Cyrillic), and token overlap against common EN patterns.
2. `surface_score = 1 - english_likelihood`
3. `page_localization_score = Σ(surface_weight × surface_score) / Σ(surface_weight)`
4. Pages with `page_localization_score < minScore` are flagged (`still_english_flag: true`).

---

## Heartbeat Integration

To run the scanner on a schedule, invoke `ocho.i18n-parity:run-scan` in an agent heartbeat. Recommended pattern:

1. SEO PM agent triggers `run-scan` weekly (e.g. every Monday).
2. Agent calls `get-summary` to identify locales with `avg_score < 0.7`.
3. Agent calls `create-tickets` (with `dryRun: true` first) to preview, then without `dryRun` to file issues.
4. Issues are routed to the Engineer agent via the standard Paperclip assignment flow.

Example Paperclip cron trigger config (add to PM agent):
```
run-scan every week on Monday → create-tickets if avg_score drops
```

---

## Adding a New Locale

1. Add locale code to `config.locales.json` in the sudokuaday.com repo under `supportedLocales`.
2. The next `run-scan` automatically includes the new locale.
3. No plugin code changes required.

---

## Known Limitations

- **Static HTML only**: Does not scan server-rendered or JavaScript-injected content. Works correctly for sudokuaday.com's static file architecture.
- **EN stopword heuristic**: False positives possible for short pages (e.g. daily-sudoku pages with minimal text). Use `excludePatterns` to suppress noisy paths.
- **No incremental cache**: Each `run-scan` is a full re-scan. Large repos (1000+ pages) may take 30–60s.
- **`create-tickets` parent resolution**: Currently uses a hardcoded locale-to-parentId map inside the worker. Adding a new locale audit parent requires a worker update until a config-driven map is implemented.
- **Language detection accuracy**: Scores for CJK locales (ja, ko, zh-CN) are more reliable than for structurally Latin-alphabet locales (de, sv, nl) where EN/target overlap is higher. Manual spot-checks recommended for borderline scores (0.6–0.75) in Latin-script locales.
- **No diff from last scan**: The report contains absolute scores only; the worker does not yet track score changes over time.
