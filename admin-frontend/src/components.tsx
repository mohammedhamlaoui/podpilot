import { ReactNode, useEffect, useMemo, useState } from "react";
import { IconAlertTriangle, IconChevronLeft, IconChevronRight, IconDatabaseOff, IconInfoCircle, IconRefresh } from "@tabler/icons-react";
import { ApiError, Metric, Page } from "./api";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="page-header">
    <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
    {actions && <div className="page-actions">{actions}</div>}
  </header>;
}

export function Panel({ title, description, action, children, className = "" }: { title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}><header className="panel-head"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</header>{children}</section>;
}

export function StatusBadge({ value }: { value?: string | null }) {
  const normalized = String(value || "unknown").toLowerCase();
  const tone = ["active", "completed", "succeeded", "configured", "paid", "approved"].includes(normalized) ? "success" : ["failed", "canceled", "cancelled", "suspended", "critical", "unavailable"].includes(normalized) ? "danger" : ["warning", "past_due", "pending", "requested", "running"].includes(normalized) ? "warning" : "neutral";
  return <span className={`status ${tone}`}><i />{String(value || "Unknown").replaceAll("_", " ")}</span>;
}

function formatValue(value: Metric["value"], format?: "money" | "number" | "percent") {
  if (value === null || value === undefined) return "Unavailable";
  if (format === "money") return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value));
  if (format === "percent") return `${Number(value).toFixed(1)}%`;
  if (typeof value === "number") return new Intl.NumberFormat("en-US", { notation: value > 99999 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
  return String(value);
}

export function MetricCard({ label, metric, format = "number" }: { label: string; metric?: Metric; format?: "money" | "number" | "percent" }) {
  const unavailable = !metric || metric.status !== "available";
  return <article className={`metric-card ${unavailable ? "is-unavailable" : ""}`}>
    <div className="metric-label"><span>{label}</span><span className="info-tip" title={metric?.definition || "Metric definition unavailable"}><IconInfoCircle size={15} /></span></div>
    <strong>{unavailable ? "Unavailable" : formatValue(metric.value, format)}</strong>
    <div className="metric-meta"><span>{metric?.source || "No source"}</span>{metric?.is_estimate && <em>Estimate</em>}</div>
    {unavailable && metric?.reason && <p>{metric.reason}</p>}
  </article>;
}

export function EmptyState({ title = "No records found", description = "There is no data matching the current filters." }: { title?: string; description?: string }) {
  return <div className="empty"><span><IconDatabaseOff size={22} /></span><h3>{title}</h3><p>{description}</p></div>;
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const apiError = error instanceof ApiError ? error : null;
  return <div className="error-state"><IconAlertTriangle size={23} /><div><h3>Could not load this data</h3><p>{error instanceof Error ? error.message : "An unexpected error occurred."}{apiError?.requestId ? ` Request ${apiError.requestId}.` : ""}</p></div>{retry && <button className="button secondary" onClick={retry}><IconRefresh size={16} />Retry</button>}</div>;
}

export function Skeleton({ rows = 6 }: { rows?: number }) {
  return <div className="skeleton-list" aria-label="Loading">{Array.from({ length: rows }, (_, index) => <span key={index} />)}</div>;
}

export function DataTable<T extends Record<string, unknown>>({ page, columns, loading, error, onRetry, renderCell, onRowClick }: {
  page?: Page<T>; columns: { key: string; label: string; width?: string }[]; loading?: boolean; error?: unknown; onRetry?: () => void;
  renderCell?: (row: T, key: string) => ReactNode; onRowClick?: (row: T) => void;
}) {
  if (loading) return <Skeleton />;
  if (error) return <ErrorState error={error} retry={onRetry} />;
  if (page?.status === "unavailable") return <EmptyState title="Data source unavailable" description={page.reason || "This source is not currently available."} />;
  if (!page?.items?.length) return <EmptyState />;
  return <div className="table-wrap"><table><thead><tr>{columns.map(column => <th key={column.key} style={{ width: column.width }}>{column.label}</th>)}</tr></thead><tbody>{page.items.map((row, index) => <tr key={String(row.id || row.user_id || row.paddle_transaction_id || index)} onClick={() => onRowClick?.(row)} className={onRowClick ? "clickable" : ""}>{columns.map(column => <td key={column.key}>{renderCell ? renderCell(row, column.key) : String(row[column.key] ?? "—")}</td>)}</tr>)}</tbody></table></div>;
}

export function Pagination({ page, onChange }: { page?: Page; onChange: (page: number) => void }) {
  if (!page || page.pages <= 1) return null;
  return <footer className="pagination"><span>{page.total.toLocaleString()} records</span><div><button aria-label="Previous page" disabled={page.page <= 1} onClick={() => onChange(page.page - 1)}><IconChevronLeft size={17} /></button><span>Page {page.page} of {page.pages}</span><button aria-label="Next page" disabled={page.page >= page.pages} onClick={() => onChange(page.page + 1)}><IconChevronRight size={17} /></button></div></footer>;
}

export function useRemote<T>(loader: () => Promise<T>, dependencies: unknown[] = []) {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [version, setVersion] = useState(0);
  const dependencyKey = useMemo(() => JSON.stringify(dependencies), dependencies);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(undefined);
    loader().then(value => { if (active) setData(value); }).catch(reason => { if (active) setError(reason); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [dependencyKey, version]);
  return { data, loading, error, retry: () => setVersion(value => value + 1) };
}

export function UnavailableChart({ reason }: { reason: string }) {
  return <div className="chart-unavailable"><div className="chart-grid" /><span><IconDatabaseOff size={20} /></span><h3>Historical series unavailable</h3><p>{reason}</p></div>;
}

export type ActivityPoint = { from: string; to: string; registrations: number; designs: number; uploads: number; ai_requests: number };

export function ActivityChart({ points, availableKeys }: { points: ActivityPoint[]; availableKeys: string[] }) {
  const colors: Record<string, string> = { registrations: "#a78bfa", designs: "#38bdf8", uploads: "#34d399", ai_requests: "#fbbf24" };
  const labels: Record<string, string> = { registrations: "Registrations", designs: "Designs", uploads: "Uploads", ai_requests: "AI requests" };
  const keys = availableKeys.filter(key => key in colors);
  const maximum = Math.max(1, ...points.flatMap(point => keys.map(key => Number(point[key as keyof ActivityPoint]) || 0)));
  const x = (index: number) => points.length <= 1 ? 50 : (index / (points.length - 1)) * 100;
  const y = (value: number) => 92 - (value / maximum) * 78;
  return <div className="activity-chart">
    <div className="chart-legend">{keys.map(key => <span key={key}><i style={{ background: colors[key] }} />{labels[key]}</span>)}</div>
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="PodPilot activity trend chart">
      {[14, 40, 66, 92].map(line => <line key={line} x1="0" x2="100" y1={line} y2={line} className="chart-axis" />)}
      {keys.map(key => <polyline key={key} points={points.map((point, index) => `${x(index)},${y(Number(point[key as keyof ActivityPoint]) || 0)}`).join(" ")} fill="none" stroke={colors[key]} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />)}
    </svg>
    <div className="chart-labels"><span>{points[0] ? new Date(points[0].from).toLocaleDateString() : "—"}</span><span>Peak {maximum.toLocaleString()}</span><span>{points.at(-1) ? new Date(points.at(-1)!.to).toLocaleDateString() : "—"}</span></div>
  </div>;
}
