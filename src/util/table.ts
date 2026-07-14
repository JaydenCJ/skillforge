/** Plain-text table renderer for matrix / test output (no dependencies). */

export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => {
    let w = visibleLength(h);
    for (const row of rows) w = Math.max(w, visibleLength(row[i] ?? ""));
    return w;
  });
  const line = (cells: string[]): string =>
    cells
      .map((c, i) => c + " ".repeat((widths[i] ?? 0) - visibleLength(c)))
      .join("  ")
      .trimEnd();
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  return [line(headers), sep, ...rows.map(line)].join("\n");
}

/** Length ignoring ANSI escape sequences, so colored cells align. */
export function visibleLength(s: string): number {
  return s.replace(/\u001b\[[0-9;]*m/g, "").length;
}
