import React from "react";
import { usePluginData } from "@paperclipai/plugin-sdk/ui";

// ---------------------------------------------------------------------------
// Types — mirrors UIReport from worker normalizeReportForUI()
// ---------------------------------------------------------------------------

type SurfaceName = "meta" | "nav" | "hero" | "main" | "cta" | "footer" | "embeds";

type UISurfaceEntry = {
  surface: SurfaceName;
  english_likelihood: number;
  status: string;
  evidence: string[];
};

type UIPageResult = {
  locale: string;
  path: string;
  page_localization_score: number;
  still_english_flag: boolean;
  langAttr: string | null;
  missing: boolean;
  scannedAt: string;
  surfaces: UISurfaceEntry[];
  worstSurfaces: SurfaceName[];
};

type UILocaleSummary = {
  locale: string;
  total_pages: number;
  above_threshold: number;
  flagged_count: number;
  avg_score: number;
  pct_above_threshold: number;
  worst_pages: Array<{ path: string; page_localization_score: number }>;
};

type UIReport = {
  scannedAt: string | null;
  minScore: number;
  pages: UIPageResult[];
  summary: UILocaleSummary[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreColor(score: number): string {
  if (score >= 0.8) return "#34c759";
  if (score >= 0.5) return "#ff9500";
  return "#ff3b30";
}

function ScoreBar({ score }: { score: number }): React.ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          height: 6,
          width: 64,
          background: "#e5e5ea",
          borderRadius: 3,
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.round(score * 100)}%`,
            background: scoreColor(score),
            borderRadius: 3,
          }}
        />
      </div>
      <span style={{ fontSize: 12, color: "#3c3c43", minWidth: 32 }}>{Math.round(score * 100)}%</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }): React.ReactElement {
  const colors: Record<string, { bg: string; text: string }> = {
    translated: { bg: "#d1f2dc", text: "#1a7a3c" },
    partial: { bg: "#ffeec2", text: "#8a5a00" },
    still_english: { bg: "#ffe0de", text: "#c0392b" },
    empty: { bg: "#f2f2f7", text: "#8e8e93" },
  };
  const color = colors[status] ?? colors.empty;
  return (
    <span
      style={{
        background: color.bg,
        color: color.text,
        borderRadius: 4,
        padding: "1px 6px",
        fontSize: 11,
        fontWeight: 500,
      }}
    >
      {status.replace("_", " ")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sidebar — navigation link to the parity page
// ---------------------------------------------------------------------------

export function I18nParitySidebar(): React.ReactElement {
  const { data, loading } = usePluginData<UIReport>("i18n-parity-report");

  const totalFlagged = data?.pages?.filter((p) => p.still_english_flag).length ?? 0;
  const localeCount = data?.summary?.length ?? 0;
  const hasData = !!(data?.scannedAt);

  return (
    <div style={styles.sidebar}>
      <div style={styles.sidebarTitle}>
        i18n Parity
        {totalFlagged > 0 && (
          <span style={styles.sidebarBadge}>{totalFlagged}</span>
        )}
      </div>
      {loading && <div style={styles.sidebarMeta}>Loading…</div>}
      {!loading && hasData && (
        <>
          <div style={styles.sidebarMeta}>
            {localeCount} locale{localeCount !== 1 ? "s" : ""} ·{" "}
            {new Date(data!.scannedAt!).toLocaleDateString()}
          </div>
          {data!.summary.map((s) => (
            <div key={s.locale} style={styles.sidebarRow}>
              <span style={styles.sidebarLocale}>{s.locale}</span>
              <ScoreBar score={s.avg_score} />
              {s.flagged_count > 0 && (
                <span style={styles.badge}>{s.flagged_count}</span>
              )}
            </div>
          ))}
        </>
      )}
      {!loading && !hasData && (
        <div style={styles.sidebarMeta}>No scan — run <code>run-scan</code></div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row expand — per-surface scores + evidence snippets
// ---------------------------------------------------------------------------

function SurfaceDetailRow({ page }: { page: UIPageResult }): React.ReactElement {
  return (
    <div style={styles.surfaceDetail}>
      {page.missing && (
        <div style={styles.surfaceMissingNote}>
          ⚠ File missing — locale page not found on disk.
        </div>
      )}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={styles.surfaceTh}>Surface</th>
            <th style={styles.surfaceTh}>Score</th>
            <th style={styles.surfaceTh}>Status</th>
            <th style={styles.surfaceTh}>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {page.surfaces.map((s) => (
            <tr key={s.surface} style={{ borderBottom: "1px solid #f2f2f7" }}>
              <td style={styles.surfaceTd}>
                <code style={{ fontSize: 11 }}>{s.surface}</code>
              </td>
              <td style={styles.surfaceTd}>
                <ScoreBar score={1 - s.english_likelihood} />
              </td>
              <td style={styles.surfaceTd}>
                <StatusBadge status={s.status} />
              </td>
              <td style={{ ...styles.surfaceTd, maxWidth: 320 }}>
                {s.evidence.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: 16, listStyle: "disc" }}>
                    {s.evidence.slice(0, 2).map((e, i) => (
                      <li key={i} style={{ color: "#3c3c43", fontStyle: "italic", marginBottom: 2 }}>
                        "{e}"
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span style={{ color: "#c7c7cc" }}>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page table row
// ---------------------------------------------------------------------------

function PageRow({ page, minScore }: { page: UIPageResult; minScore: number }): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false);
  const isFlagged = page.still_english_flag || page.page_localization_score < minScore;

  return (
    <>
      <tr
        onClick={() => setExpanded((v) => !v)}
        style={{
          ...styles.tr,
          cursor: "pointer",
          background: expanded ? "#f9f9fb" : undefined,
        }}
      >
        <td style={styles.td}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#8e8e93", marginRight: 6 }}>
            {page.locale}
          </span>
        </td>
        <td style={styles.td}>
          <code style={{ fontSize: 12 }}>{page.path}</code>
          {page.missing && (
            <span style={{ marginLeft: 6, color: "#ff9500", fontSize: 11 }}>missing</span>
          )}
        </td>
        <td style={styles.td}>
          <ScoreBar score={page.page_localization_score} />
        </td>
        <td style={styles.td}>
          {page.still_english_flag ? (
            <span style={{ color: "#ff3b30", fontSize: 12, fontWeight: 500 }}>⚠ yes</span>
          ) : (
            <span style={{ color: "#34c759", fontSize: 12 }}>✓</span>
          )}
        </td>
        <td style={styles.td}>
          <span style={{ fontSize: 11, color: "#8e8e93" }}>
            {new Date(page.scannedAt).toLocaleDateString()}
          </span>
        </td>
        <td style={styles.td}>
          {page.worstSurfaces.length > 0 ? (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {page.worstSurfaces.map((s) => (
                <span key={s} style={styles.worstBadge}>{s}</span>
              ))}
            </div>
          ) : (
            <span style={{ color: "#c7c7cc", fontSize: 12 }}>—</span>
          )}
        </td>
        <td style={{ ...styles.td, color: "#8e8e93", fontSize: 12 }}>
          {page.langAttr ?? "—"}
        </td>
        <td style={{ ...styles.td, textAlign: "center", color: "#8e8e93", fontSize: 16 }}>
          {expanded ? "▲" : "▼"}
        </td>
      </tr>
      {expanded && (
        <tr style={{ background: "#f9f9fb" }}>
          <td colSpan={8} style={{ padding: 0 }}>
            <SurfaceDetailRow page={page} />
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Roll-up strip
// ---------------------------------------------------------------------------

function RollupStrip({ summary, minScore }: { summary: UILocaleSummary[]; minScore: number }): React.ReactElement {
  if (summary.length === 0) return <></>;
  return (
    <div style={styles.rollup}>
      {summary.map((s) => (
        <div key={s.locale} style={styles.rollupCard}>
          <div style={styles.rollupLocale}>{s.locale}</div>
          <div style={{ ...styles.rollupPct, color: scoreColor(s.avg_score) }}>
            {s.pct_above_threshold}%
          </div>
          <div style={styles.rollupLabel}>above {Math.round(minScore * 100)}%</div>
          <div style={styles.rollupCounts}>
            <span>{s.total_pages} pages</span>
            {s.flagged_count > 0 && (
              <span style={{ color: "#ff3b30", marginLeft: 6 }}>
                {s.flagged_count} flagged
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full page report
// ---------------------------------------------------------------------------

export function I18nParityPage(): React.ReactElement {
  const { data, loading, error } = usePluginData<UIReport>("i18n-parity-report");

  const [localeFilter, setLocaleFilter] = React.useState<string>("all");
  const [scoreBand, setScoreBand] = React.useState<"all" | "good" | "needs_work">("all");
  const [flaggedOnly, setFlaggedOnly] = React.useState(false);
  const [pathSearch, setPathSearch] = React.useState("");

  if (loading) return <div style={styles.page}>Loading…</div>;
  if (error) return <div style={styles.page}>Error: {String(error)}</div>;
  if (!data || !data.scannedAt) {
    return (
      <div style={styles.page}>
        <h2 style={styles.pageTitle}>i18n Parity Report</h2>
        <p style={{ color: "#8e8e93" }}>
          No scan data available. Run the <code>run-scan</code> tool to populate.
        </p>
      </div>
    );
  }

  const minScore = data.minScore ?? 0.7;
  const allLocales = data.summary.map((s) => s.locale);

  // Apply filters
  const filtered = data.pages.filter((p) => {
    if (localeFilter !== "all" && p.locale !== localeFilter) return false;
    if (flaggedOnly && !p.still_english_flag) return false;
    if (scoreBand === "good" && p.page_localization_score < minScore) return false;
    if (scoreBand === "needs_work" && p.page_localization_score >= minScore) return false;
    if (pathSearch && !p.path.toLowerCase().includes(pathSearch.toLowerCase())) return false;
    return true;
  });

  // Summary filtered to active locale selection
  const activeSummary =
    localeFilter === "all"
      ? data.summary
      : data.summary.filter((s) => s.locale === localeFilter);

  return (
    <div style={styles.page}>
      <h2 style={styles.pageTitle}>i18n Parity Report</h2>
      <p style={styles.pageMeta}>
        {data.pages.length} pages · {data.summary.length} locale(s) ·{" "}
        {new Date(data.scannedAt).toLocaleString()}
      </p>

      {/* Roll-up strip */}
      <RollupStrip summary={activeSummary} minScore={minScore} />

      {/* Filter bar */}
      <div style={styles.filterBar}>
        {/* Locale selector */}
        <select
          value={localeFilter}
          onChange={(e) => setLocaleFilter(e.target.value)}
          style={styles.select}
        >
          <option value="all">All locales</option>
          {allLocales.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>

        {/* Score band */}
        <select
          value={scoreBand}
          onChange={(e) => setScoreBand(e.target.value as typeof scoreBand)}
          style={styles.select}
        >
          <option value="all">All scores</option>
          <option value="good">Good (≥{Math.round(minScore * 100)}%)</option>
          <option value="needs_work">Needs work (&lt;{Math.round(minScore * 100)}%)</option>
        </select>

        {/* Still-English toggle */}
        <label style={styles.filterToggle}>
          <input
            type="checkbox"
            checked={flaggedOnly}
            onChange={(e) => setFlaggedOnly(e.target.checked)}
            style={{ marginRight: 6 }}
          />
          Flagged only
        </label>

        {/* Path search */}
        <input
          type="text"
          placeholder="Search path…"
          value={pathSearch}
          onChange={(e) => setPathSearch(e.target.value)}
          style={styles.searchInput}
        />

        <span style={styles.filterCount}>{filtered.length} rows</span>
      </div>

      {/* Page table */}
      {filtered.length === 0 ? (
        <p style={{ color: "#8e8e93", marginTop: 16 }}>No pages match the current filters.</p>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Locale</th>
              <th style={styles.th}>Path</th>
              <th style={styles.th}>Score</th>
              <th style={styles.th}>Still EN</th>
              <th style={styles.th}>Last scan</th>
              <th style={styles.th}>Worst surfaces</th>
              <th style={styles.th}>Lang attr</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((page) => (
              <PageRow
                key={`${page.locale}/${page.path}`}
                page={page}
                minScore={minScore}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard widget — compact locale health snapshot
// ---------------------------------------------------------------------------

export function I18nParityWidget(): React.ReactElement {
  const { data, loading, error } = usePluginData<UIReport>("i18n-parity-report");

  if (loading) return <div style={styles.widget}>Loading…</div>;
  if (error) return <div style={styles.widget}>Error loading parity data</div>;
  if (!data || !data.scannedAt) {
    return (
      <div style={styles.widget}>
        <div style={styles.widgetTitle}>i18n Parity</div>
        <p style={styles.widgetHint}>No data — run <code>run-scan</code></p>
      </div>
    );
  }

  const totalFlagged = data.pages.filter((p) => p.still_english_flag).length;
  const overallAvg =
    data.summary.length > 0
      ? data.summary.reduce((a, b) => a + b.avg_score, 0) / data.summary.length
      : 0;

  return (
    <div style={styles.widget}>
      <div style={styles.widgetTitle}>i18n Parity</div>

      {/* Top-level stats */}
      <div style={styles.widgetStats}>
        <div style={styles.widgetStat}>
          <div style={{ ...styles.widgetStatValue, color: scoreColor(overallAvg) }}>
            {Math.round(overallAvg * 100)}%
          </div>
          <div style={styles.widgetStatLabel}>Avg parity</div>
        </div>
        <div style={styles.widgetStat}>
          <div style={{ ...styles.widgetStatValue, color: totalFlagged > 0 ? "#ff3b30" : "#34c759" }}>
            {totalFlagged}
          </div>
          <div style={styles.widgetStatLabel}>Flagged</div>
        </div>
        <div style={styles.widgetStat}>
          <div style={styles.widgetStatValue}>{data.summary.length}</div>
          <div style={styles.widgetStatLabel}>Locales</div>
        </div>
      </div>

      {/* Per-locale mini-rows */}
      <div style={styles.widgetLocales}>
        {data.summary.map((s) => (
          <div key={s.locale} style={styles.widgetLocaleRow}>
            <span style={styles.widgetLocaleCode}>{s.locale}</span>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  height: 4,
                  background: "#e5e5ea",
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${s.pct_above_threshold}%`,
                    background: scoreColor(s.avg_score),
                    borderRadius: 2,
                  }}
                />
              </div>
            </div>
            <span style={{ ...styles.widgetLocalePct, color: scoreColor(s.avg_score) }}>
              {s.pct_above_threshold}%
            </span>
            {s.flagged_count > 0 && (
              <span style={styles.widgetLocaleBadge}>{s.flagged_count}</span>
            )}
          </div>
        ))}
      </div>

      <div style={styles.widgetMeta}>
        {data.pages.length} pages · {new Date(data.scannedAt).toLocaleDateString()}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  // Sidebar
  sidebar: {
    padding: "12px 16px",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: 13,
  },
  sidebarTitle: {
    fontWeight: 600,
    fontSize: 14,
    marginBottom: 4,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  sidebarBadge: {
    background: "#ff3b30",
    color: "#fff",
    borderRadius: 8,
    padding: "1px 6px",
    fontSize: 11,
    fontWeight: 700,
  },
  sidebarMeta: {
    color: "#8e8e93",
    fontSize: 11,
    marginBottom: 8,
  },
  sidebarRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 0",
    borderBottom: "1px solid #f2f2f7",
  },
  sidebarLocale: {
    width: 36,
    fontWeight: 500,
    flexShrink: 0,
    fontSize: 12,
  },
  badge: {
    background: "#ff3b30",
    color: "#fff",
    borderRadius: 8,
    padding: "1px 6px",
    fontSize: 11,
    fontWeight: 600,
    marginLeft: "auto",
    flexShrink: 0,
  },

  // Page
  page: {
    padding: "24px 32px",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    maxWidth: 1100,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 4,
    margin: 0,
  },
  pageMeta: {
    color: "#8e8e93",
    fontSize: 13,
    marginBottom: 20,
    marginTop: 4,
  },

  // Roll-up strip
  rollup: {
    display: "flex",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 20,
  },
  rollupCard: {
    border: "1px solid #e5e5ea",
    borderRadius: 10,
    padding: "10px 14px",
    minWidth: 120,
    background: "#fafafa",
  },
  rollupLocale: {
    fontWeight: 700,
    fontSize: 13,
    marginBottom: 4,
  },
  rollupPct: {
    fontSize: 24,
    fontWeight: 700,
    lineHeight: 1.1,
  },
  rollupLabel: {
    fontSize: 10,
    color: "#8e8e93",
    marginTop: 2,
  },
  rollupCounts: {
    fontSize: 11,
    color: "#8e8e93",
    marginTop: 4,
  },

  // Filter bar
  filterBar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
    flexWrap: "wrap",
  },
  select: {
    padding: "5px 10px",
    border: "1px solid #d1d1d6",
    borderRadius: 7,
    fontSize: 13,
    background: "#fff",
    cursor: "pointer",
  },
  filterToggle: {
    display: "flex",
    alignItems: "center",
    fontSize: 13,
    cursor: "pointer",
    userSelect: "none",
  },
  searchInput: {
    padding: "5px 10px",
    border: "1px solid #d1d1d6",
    borderRadius: 7,
    fontSize: 13,
    minWidth: 160,
  },
  filterCount: {
    marginLeft: "auto",
    fontSize: 12,
    color: "#8e8e93",
  },

  // Table
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  th: {
    textAlign: "left",
    padding: "6px 10px",
    borderBottom: "2px solid #e5e5ea",
    color: "#3c3c43",
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  tr: {
    borderBottom: "1px solid #f2f2f7",
  },
  td: {
    padding: "7px 10px",
    verticalAlign: "middle",
  },

  // Worst surface badges
  worstBadge: {
    background: "#ffe0de",
    color: "#c0392b",
    borderRadius: 4,
    padding: "1px 6px",
    fontSize: 11,
    fontWeight: 500,
  },

  // Surface detail (expanded row)
  surfaceDetail: {
    padding: "12px 16px 16px",
    background: "#f9f9fb",
    borderTop: "1px solid #e5e5ea",
  },
  surfaceMissingNote: {
    color: "#ff9500",
    fontSize: 12,
    marginBottom: 8,
    fontWeight: 500,
  },
  surfaceTh: {
    textAlign: "left",
    padding: "4px 8px",
    borderBottom: "1px solid #e5e5ea",
    fontWeight: 600,
    fontSize: 11,
    color: "#8e8e93",
  },
  surfaceTd: {
    padding: "5px 8px",
    verticalAlign: "top",
  },

  // Widget
  widget: {
    padding: "16px",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  widgetTitle: {
    fontWeight: 700,
    fontSize: 15,
    marginBottom: 10,
  },
  widgetStats: {
    display: "flex",
    gap: 12,
    marginBottom: 12,
  },
  widgetStat: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    flex: 1,
  },
  widgetStatValue: {
    fontSize: 22,
    fontWeight: 700,
    lineHeight: 1.1,
  },
  widgetStatLabel: {
    fontSize: 10,
    color: "#8e8e93",
    marginTop: 2,
  },
  widgetLocales: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    marginBottom: 8,
  },
  widgetLocaleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  widgetLocaleCode: {
    width: 28,
    fontSize: 11,
    fontWeight: 600,
    color: "#3c3c43",
    flexShrink: 0,
  },
  widgetLocalePct: {
    fontSize: 11,
    fontWeight: 600,
    minWidth: 32,
    textAlign: "right",
  },
  widgetLocaleBadge: {
    background: "#ff3b30",
    color: "#fff",
    borderRadius: 6,
    padding: "0 5px",
    fontSize: 10,
    fontWeight: 700,
    flexShrink: 0,
  },
  widgetHint: {
    color: "#8e8e93",
    fontSize: 12,
  },
  widgetMeta: {
    color: "#8e8e93",
    fontSize: 11,
    marginTop: 4,
  },
};
