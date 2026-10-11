"use client";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  LayoutGrid,
  ChartNoAxesCombined,
  Link2,
  ArrowUpRight,
  ArrowDownUp,
  RefreshCw,
  Search,
  Plus,
  ChevronRight,
  Store as StoreIcon,
  Check,
  Clock3,
  Info,
  ShieldCheck,
  BookOpen,
  LogOut,
  CalendarDays,
  Wallet,
  ShoppingBag,
  Target,
  ArrowRight,
  Globe,
  CheckCircle2,
  AlertCircle,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  SidebarInset,
} from "@/components/ui/sidebar";
import ExportReports from "@/components/export-reports";
import StoreDetails from "@/components/store-details";
import InlineStoreCampaigns from "@/components/inline-store-campaigns";
import DateRangeFilter from "@/components/date-range-filter";
import { demoStores } from "@/lib/demo";
import { dateInZone, formatMoney, validDate } from "@/lib/reporting";
import type { DashboardData, Store, Period } from "@/lib/types";
const initial: DashboardData = {
  stores: [],
  google: [],
  configured: false,
  database: false,
};
function Dot({ good = false }: { good?: boolean }) {
  return <span className={`status-dot ${good ? "good" : ""}`} />;
}
function stale(s: Store) {
  return [s.ads, s.shop].some(
    (r) => r && Date.now() - Date.parse(r.fetchedAt) > 60 * 60 * 1000,
  );
}
function count(v: number | null | undefined) {
  return v == null
    ? "—"
    : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(v);
}
function SourceIcon({ source }: { source: "google" | "shopify" }) {
  return (
    <span className={`source-icon ${source}`}>
      {source === "google" ? "G" : <ShoppingBag size={17} />}
    </span>
  );
}
function Time({ value }: { value?: string }) {
  return (
    <>
      {value
        ? new Date(value).toLocaleString("en-IN", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "Not synced"}
    </>
  );
}
export default function Dashboard() {
  const [expandedStores, setExpandedStores] = useState<string[]>([]);
  const openStore = (s: Store) =>
    setExpandedStores((ids) =>
      ids.includes(s.id) ? ids.filter((id) => id !== s.id) : [...ids, s.id],
    );
  const [view, setView] = useState("overview"),
    [period, setPeriod] = useState<Period>("yesterday"),
    [from, setFrom] = useState(() => dateInZone("Asia/Kolkata", -1)),
    [to, setTo] = useState(() => dateInZone("Asia/Kolkata", -1)),
    [search, setSearch] = useState(""),
    [group, setGroup] = useState("all"),
    [sort, setSort] = useState("name"),
    [descending, setDescending] = useState(false),
    [demo, setDemo] = useState(false),
    [data, setData] = useState(initial),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [syncing, setSyncing] = useState(false),
    [exporting, setExporting] = useState(false),
    [selected, setSelected] = useState<Store | null>(null),
    [edit, setEdit] = useState<Store | null>(null),
    [addOpen, setAddOpen] = useState(false),
    [apiOpen, setApiOpen] = useState(false);
  const [exportRefreshKey, setExportRefreshKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportDays, setExportDays] = useState("7");
  const [exportEnd, setExportEnd] = useState(() =>
    dateInZone("Asia/Kolkata", -1),
  );
  const [exportError, setExportError] = useState("");
  const requestSequence = useRef(0);
  const load = useCallback(
    async (requestedFrom = from, requestedTo = to) => {
      const sequence = ++requestSequence.current;
      try {
        const res = await fetch(
          `/api/dashboard?from=${requestedFrom}&to=${requestedTo}`,
          { signal: AbortSignal.timeout(20000) },
        );
        if (res.status === 401) {
          window.location.assign("/login");
          return;
        }
        const body = await res.json();
        if (sequence !== requestSequence.current) return;
        if (!res.ok) throw new Error(body.error);
        setData(body);
        setError("");
      } catch (e) {
        if (sequence === requestSequence.current)
          setError((e as Error).message);
      } finally {
        if (sequence === requestSequence.current) setLoading(false);
      }
    },
    [from, to],
  );
  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") === "connections") setView("connections");
    const n = params.get("notice");
    if (n) setNotice(n.replaceAll("-", " "));
  }, []);
  const stores = useMemo(
    () =>
      demo
        ? demoStores(
            to === dateInZone("Asia/Kolkata"),
            from === to ? from : undefined,
          )
        : data.stores,
    [demo, from, to, data.stores],
  );
  useEffect(() => {
    setSelected((old) =>
      old ? stores.find((s) => s.id === old.id) || null : null,
    );
  }, [stores]);
  const connections = demo
    ? [1, 2, 3].map((group) => ({
        group,
        email: `team${group}@example.com`,
        connected: true,
      }))
    : data.google;
  const accountLabel = (id: number) =>
    connections.find((c) => c.group === id)?.email || `Account ${id}`;
  const rows = useMemo(
    () =>
      stores
        .filter(
          (s) =>
            (group === "all" || s.group === Number(group)) &&
            `${s.name} ${s.domain} ${s.cid}`
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .sort((a, b) => {
          let av: any, bv: any;
          if (sort === "name") {
            av = a.name;
            bv = b.name;
          } else if (sort === "spend") {
            av = a.ads?.spend;
            bv = b.ads?.spend;
          } else if (sort === "orders") {
            av = a.shop?.orders;
            bv = b.shop?.orders;
          } else if (sort === "purchases") {
            av = a.ads?.purchases;
            bv = b.ads?.purchases;
          } else {
            av = a.ads?.costPerPurchase;
            bv = b.ads?.costPerPurchase;
          }
          if (av == null) return bv == null ? 0 : 1;
          if (bv == null) return -1;
          const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
          return descending ? -cmp : cmp;
        }),
    [stores, group, search, sort, descending],
  );
  const sortBy = (field: string) => {
    setDescending(sort === field ? !descending : field !== "name");
    setSort(field);
  };
  const activeCount = data.stores.filter(
    (s) => s.ads && s.shop && !s.adsError && !s.shopError && !stale(s),
  ).length;
  async function refresh(nextFrom = from, nextTo = to) {
    if (demo) {
      setNotice(
        "Example data is a preview. Switch to live data to sync your accounts.",
      );
      return;
    }
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: nextFrom, to: nextTo }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setNotice(body.message);
      await load(nextFrom, nextTo);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }
  async function exportReport() {
    const days = Number(exportDays);
    if (
      !Number.isInteger(days) ||
      days < 1 ||
      days > 366 ||
      !validDate(exportEnd) ||
      exportEnd > dateInZone("Asia/Kolkata")
    ) {
      setExportError("Choose 1–366 days and an end date up to today.");
      return;
    }
    const start = new Date(`${exportEnd}T12:00:00Z`);
    start.setUTCDate(start.getUTCDate() - days + 1);
    const from = start.toISOString().slice(0, 10);
    const to = exportEnd;
    setExportError("");
    setExporting(true);
    try {
      const response = await fetch("/api/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
        signal: AbortSignal.timeout(20000),
      });
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setExportOpen(false);
      setExportRefreshKey((key) => key + 1);
      setNotice(
        "Report queued. You can keep using the dashboard; a Download CSV button will appear when it is ready.",
      );
    } catch (error) {
      setExportError((error as Error).message);
    } finally {
      setExporting(false);
    }
  }
  function add() {
    setEdit(null);
    setAddOpen(true);
  }
  return (
    <SidebarProvider
      defaultOpen={false}
      style={{ "--sidebar-width": "248px" } as React.CSSProperties}
    >
      <Sidebar className="app-sidebar" collapsible="icon">
        <SidebarHeader className="side-header">
          <SidebarTrigger label="Sidebar" className="sidebar-toggle" />
          <div className="brand">
            <span className="brand-mark">
              <LayoutGrid size={18} />
            </span>
            SpendDesk<span className="brand-dot">.</span>
          </div>
          <div className="workspace-chip">
            <span className="workspace-avatar">P</span>
            <div>
              <strong>Personal workspace</strong>
              <small>
                {stores.length} stores · {connections.length} Google accounts
              </small>
            </div>
            <ShieldCheck size={14} />
          </div>
        </SidebarHeader>
        <SidebarContent className="side-content">
          <p className="nav-label">WORKSPACE</p>
          <SidebarMenu>
            {[
              { id: "overview", label: "Overview", icon: ChartNoAxesCombined },
              { id: "connections", label: "Connections", icon: Link2 },
              { id: "guide", label: "Setup guide", icon: BookOpen },
            ].map((item) => (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                  isActive={view === item.id}
                  onClick={() => setView(item.id)}
                  className="nav-button"
                  tooltip={item.label}
                  aria-label={item.label}
                >
                  <item.icon size={18} />
                  <span>{item.label}</span>
                  {item.id === "connections" && (
                    <span className="nav-badge">{data.google.length}</span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          <div className="side-logins">
            <p className="nav-label">GOOGLE LOGINS</p>
            {connections.map((connection) => (
              <button
                key={connection.group}
                title={connection.email}
                className={
                  group === String(connection.group) ? "account-selected" : ""
                }
                onClick={() => {
                  setView("overview");
                  setGroup(String(connection.group));
                }}
              >
                <span
                  className="login-dot"
                  style={{
                    background: ["#8b7ef8", "#59b9a3", "#eba869"][
                      connection.group % 3
                    ],
                  }}
                />
                <span className="account-email">{connection.email}</span>
                <small>
                  {stores.filter((s) => s.group === connection.group).length}
                </small>
              </button>
            ))}
            {!connections.length && (
              <p className="sidebar-empty">
                Connect your first Google account.
              </p>
            )}
            <button
              className="sidebar-add-account"
              onClick={() => setView("connections")}
            >
              <Plus size={14} />
              Add Google account
            </button>
          </div>
        </SidebarContent>
        <SidebarFooter className="side-footer">
          <div className="private-note">
            <ShieldCheck size={15} />
            <span>Private workspace</span>
          </div>
          <button
            className="profile"
            aria-label="Sign out"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.assign("/login");
            }}
          >
            <span className="profile-avatar">P</span>
            <span>
              <strong>My dashboard</strong>
              <small>Sign out</small>
            </span>
            <LogOut size={15} />
          </button>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="app-main">
        <header className="topbar">
          <SidebarTrigger
            label="Sidebar"
            className="sidebar-toggle md:hidden"
          />
          <div className="breadcrumbs">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {view === "overview"
                ? "Overview"
                : view === "connections"
                  ? "Connections"
                  : "Setup guide"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="private-pill">
              <ShieldCheck size={13} />
              Only you
            </span>
            <span className="avatar-small">P</span>
          </div>
        </header>
        <main className="workspace-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">YOUR DAILY CHECK-IN</p>
              <h1>
                {view === "overview"
                  ? "Store overview"
                  : view === "connections"
                    ? "Your connections"
                    : "Let’s connect your stores"}
              </h1>
              <p className="muted">
                {view === "overview"
                  ? "Every store. Every ad account. One clear view."
                  : view === "connections"
                    ? "Manage your Google accounts and store connections."
                    : "Start with one store, verify its numbers, then connect the rest."}
              </p>
            </div>
            <Button
              variant="outline"
              className="refresh-button"
              onClick={() => refresh()}
              disabled={
                syncing || data.sync?.running || !data.stores.length || demo
              }
            >
              <RefreshCw size={15} className={syncing ? "spin" : ""} />
              {syncing
                ? "Requesting…"
                : data.sync?.running
                  ? "Syncing…"
                  : "Refresh data"}
            </Button>
          </div>
          {!demo && <ExportReports refreshKey={exportRefreshKey} />}
          {notice && (
            <div className="notice" role="status">
              <Info size={16} />
              <span>{notice}</span>
              <button
                onClick={() => setNotice("")}
                aria-label="Dismiss notification"
              >
                ×
              </button>
            </div>
          )}
          {data.sync && (
            <div className="sync-status-line" role="status">
              <Clock3 size={13} />
              {data.sync.running
                ? "Sync in progress"
                : data.sync.failed
                  ? "Last sync failed"
                  : "Last sync finished"}{" "}
              · {data.sync.synced} source reports fetched · {data.sync.errors}{" "}
              source errors
              {data.sync.finishedAt && (
                <>
                  {" "}
                  · <Time value={data.sync.finishedAt} />
                </>
              )}
            </div>
          )}
          {error && (
            <div className="notice error" role="alert">
              <AlertCircle size={16} />
              {error}
              <Button variant="ghost" onClick={() => load()}>
                Retry
              </Button>
            </div>
          )}
          {view === "overview" && (
            <>
              <div className={`connection-banner ${demo ? "demo-banner" : ""}`}>
                <div className="banner-icon">
                  {demo ? <Info size={20} /> : <Link2 size={20} />}
                </div>
                <div>
                  <strong>
                    {demo
                      ? "You’re viewing example data"
                      : activeCount > 0
                        ? "Your connected stores, in sync"
                        : "Bring your stores into one workspace"}
                  </strong>
                  <p>
                    {demo
                      ? "These 25 stores and figures are illustrative. They are not your accounts."
                      : `${data.stores.length} stores mapped · ${data.google.length} Google accounts connected`}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() =>
                    demo ? setDemo(false) : setView("connections")
                  }
                >
                  {demo ? "Back to live data" : "Connect accounts"}
                  <ArrowRight size={14} />
                </Button>
              </div>
              <div className="overview-strip">
                <div>
                  <span className="stat-icon">
                    <StoreIcon size={19} />
                  </span>
                  <div>
                    <p>Store accounts</p>
                    <strong>
                      {demo ? "25" : data.stores.length}
                      <small> / 25</small>
                    </strong>
                  </div>
                </div>
                <div>
                  <span className="stat-icon">
                    <Link2 size={19} />
                  </span>
                  <div>
                    <p>Google logins</p>
                    <strong>
                      {connections.length}
                      <small> connected</small>
                    </strong>
                  </div>
                </div>
                <div>
                  <span className="stat-icon">
                    <CheckCircle2 size={19} />
                  </span>
                  <div>
                    <p>Reports available</p>
                    <strong>
                      {demo ? "25" : activeCount}
                      <small> stores</small>
                    </strong>
                  </div>
                </div>
                <div>
                  <span className="stat-icon">
                    <Clock3 size={19} />
                  </span>
                  <div>
                    <p>Scheduled sync</p>
                    <strong className="text-stat">Automatic</strong>
                    <small>
                      {demo
                        ? "Example preview"
                        : "Frequency fits your API allowance"}
                    </small>
                  </div>
                </div>
              </div>
              <section className="report-panel">
                <div className="panel-heading">
                  <div>
                    <h2>
                      Store performance{" "}
                      <span className="count-pill">
                        {demo ? 25 : data.stores.length}
                      </span>
                    </h2>
                    <p>Source-reported orders and ad spend, side by side.</p>
                  </div>
                  <DateRangeFilter
                    period={period}
                    from={from}
                    to={to}
                    onApply={(nextPeriod, nextFrom, nextTo) => {
                      setPeriod(nextPeriod);
                      setFrom(nextFrom);
                      setTo(nextTo);
                    }}
                  />
                </div>
                <div className="report-toolbar">
                  <div className="search-box">
                    <Search size={16} />
                    <input
                      aria-label="Search stores or CIDs"
                      placeholder="Search stores or CIDs…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {search && (
                      <button
                        aria-label="Clear search"
                        onClick={() => setSearch("")}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <Select
                    value={group}
                    onValueChange={(v) => setGroup(v || "all")}
                  >
                    <SelectTrigger
                      className="login-filter"
                      aria-label="Filter by Google login"
                    >
                      <SelectValue>
                        {group === "all"
                          ? "All Google accounts"
                          : accountLabel(Number(group))}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Google accounts</SelectItem>
                      {connections.map((c) => (
                        <SelectItem key={c.group} value={String(c.group)}>
                          {c.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Button
                    variant="outline"
                    disabled={demo || exporting || !data.database}
                    onClick={() => {
                      setExportError("");
                      setExportOpen(true);
                    }}
                  >
                    <Download size={14} />
                    {exporting ? "Preparing…" : "Export report"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={add}
                    disabled={demo || !data.database}
                  >
                    <Plus size={14} />
                    Add store
                  </Button>
                </div>
                <Table className="performance-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <button onClick={() => sortBy("name")}>
                          Store / Ads CID <ArrowDownUp size={12} />
                        </button>
                      </TableHead>
                      <TableHead>
                        Total budget<small>Google Ads · current</small>
                      </TableHead>
                      {[
                        {
                          id: "spend",
                          label: "Ad spend",
                          source: "Google Ads",
                        },
                        { id: "orders", label: "Orders", source: "Shopify" },
                        {
                          id: "purchases",
                          label: "Purchases",
                          source: "Google Ads",
                        },
                        {
                          id: "cost",
                          label: "Cost / purchase",
                          source: "Google Ads",
                        },
                      ].map((c) => (
                        <TableHead
                          key={c.id}
                          aria-sort={
                            sort === c.id
                              ? descending
                                ? "descending"
                                : "ascending"
                              : "none"
                          }
                        >
                          <button onClick={() => sortBy(c.id)}>
                            {c.label}
                            <ArrowDownUp size={11} />
                          </button>
                          <small>{c.source}</small>
                        </TableHead>
                      ))}
                      <TableHead>Status</TableHead>
                      <TableHead>
                        <span className="sr-only">Details</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((s, i) => (
                      <Fragment key={s.id}>
                        <TableRow
                          key={s.id}
                          className="store-navigation-row"
                          onClick={(event) => {
                            event.stopPropagation();
                            openStore(s);
                          }}
                        >
                          <TableCell>
                            <button
                              className="store-cell"
                              aria-expanded={expandedStores.includes(s.id)}
                              aria-controls={`campaigns-${s.id}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                openStore(s);
                              }}
                            >
                              <span className={`store-avatar tone-${i % 5}`}>
                                {s.name.slice(0, 1)}
                              </span>
                              <span>
                                <strong>{s.name}</strong>
                                <small>
                                  <span
                                    className="login-dot"
                                    style={{
                                      background: [
                                        "#8b7ef8",
                                        "#59b9a3",
                                        "#eba869",
                                      ][s.group % 3],
                                    }}
                                  />
                                  {s.cid.replace(
                                    /(\d{3})(\d{3})(\d{4})/,
                                    "$1-$2-$3",
                                  )}
                                </small>
                              </span>
                            </button>
                          </TableCell>
                          <TableCell>
                            {s.ads?.budgets.length ? (
                              <>
                                <span className="numeric">
                                  {formatMoney(
                                    s.ads.budgets.every((b) => b.amount != null)
                                      ? s.ads.budgets.reduce(
                                          (total, budget) =>
                                            total + (budget.amount || 0),
                                          0,
                                        )
                                      : null,
                                    s.ads.currency,
                                  )}
                                </span>
                                <small className="cell-sub">
                                  {s.ads.budgets.length} budget
                                  {s.ads.budgets.length === 1 ? "" : "s"}
                                  {s.ads.budgets.some((budget) => budget.shared)
                                    ? " · shared budgets counted once · per day"
                                    : s.ads.budgets.some(
                                          (budget) => budget.amount == null,
                                        )
                                      ? " · includes non-daily budgets"
                                      : " · per day"}
                                </small>
                              </>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="numeric">
                            {formatMoney(s.ads?.spend, s.ads?.currency)}
                          </TableCell>
                          <TableCell className="numeric">
                            {count(s.shop?.orders)}
                          </TableCell>
                          <TableCell className="numeric">
                            {count(s.ads?.purchases)}
                          </TableCell>
                          <TableCell
                            className="numeric"
                            title={s.ads?.costNote}
                          >
                            {formatMoney(
                              s.ads?.costPerPurchase,
                              s.ads?.currency,
                            )}
                          </TableCell>
                          <TableCell>
                            <span
                              className={`row-status ${s.ads?.alerts?.length || s.adsError || s.shopError ? "needs-attention" : ""}`}
                            >
                              <Dot
                                good={
                                  !!s.ads &&
                                  !!s.shop &&
                                  !s.ads.alerts?.length &&
                                  !s.adsError &&
                                  !s.shopError &&
                                  !stale(s)
                                }
                              />
                              {s.ads?.alerts?.length
                                ? "Policy alert"
                                : s.adsError || s.shopError
                                  ? "Check connection"
                                  : stale(s)
                                    ? "Out of date"
                                    : s.ads && s.shop
                                      ? "Synced"
                                      : "Pending"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Edit ${s.name}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelected(s);
                              }}
                            >
                              Edit
                            </Button>
                          </TableCell>
                        </TableRow>
                        {expandedStores.includes(s.id) && (
                          <TableRow>
                            <TableCell
                              colSpan={8}
                              className="inline-store-cell"
                            >
                              <div id={`campaigns-${s.id}`}>
                                <InlineStoreCampaigns store={s} demo={demo} />
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
                {!rows.length && (
                  <div className="empty-state">
                    <div className="empty-symbol">
                      <StoreIcon size={26} />
                      <span>
                        <Plus size={13} />
                      </span>
                    </div>
                    <h3>
                      {loading
                        ? "Loading your workspace…"
                        : search || group !== "all"
                          ? "No matching stores"
                          : "Your stores belong here"}
                    </h3>
                    <p>
                      {search || group !== "all"
                        ? "Try another store name, CID, or Google login."
                        : "Connect your first store to see its orders, daily budget, and ad spend in one row."}
                    </p>
                    {!(search || group !== "all") && (
                      <div>
                        <Button onClick={() => setView("connections")}>
                          <Plus size={15} />
                          Connect your first store
                        </Button>
                        <Button variant="ghost" onClick={() => setDemo(true)}>
                          Preview with example data
                          <ArrowUpRight size={14} />
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                <div className="table-footer">
                  <span>
                    {rows.length
                      ? `Showing ${rows.length} ${demo ? "example " : ""}stores`
                      : "No live reports yet"}
                  </span>
                  <span>
                    <Clock3 size={12} />
                    Figures may update as platforms finish reporting
                  </span>
                </div>
              </section>
              <div className="report-notes">
                <Info size={15} />
                <p>
                  Budgets show the current configuration. Orders come from
                  Shopify; purchases come from Google Ads.{" "}
                  <button onClick={() => setView("guide")}>
                    About your data <ArrowUpRight size={12} />
                  </button>
                </p>
              </div>
              <div className="bottom-grid">
                <div className="mini-card">
                  <div className="mini-card-heading">
                    <SourceIcon source="google" />
                    <strong>Google Ads</strong>
                    <span className="subtle-tag">
                      {data.google.length} logins
                    </span>
                  </div>
                  <p>Daily budgets, spend, and purchase reporting.</p>
                  <button
                    className="text-link"
                    onClick={() => setView("connections")}
                  >
                    Manage connections
                    <ArrowRight size={13} />
                  </button>
                </div>
                <div className="mini-card">
                  <div className="mini-card-heading">
                    <SourceIcon source="shopify" />
                    <strong>Shopify</strong>
                    <span className="subtle-tag">
                      {data.stores.filter((s) => s.shopConnected).length}/25
                      stores
                    </span>
                  </div>
                  <p>Store orders, straight from your reports.</p>
                  <button
                    className="text-link"
                    onClick={() => setView("connections")}
                  >
                    Connect your stores
                    <ArrowRight size={13} />
                  </button>
                </div>
                <div className="mini-card quiet-card">
                  <div className="mini-card-heading">
                    <ShieldCheck size={20} />
                    <strong>Your numbers, as reported.</strong>
                  </div>
                  <p>
                    No calculated profit, blended ROAS, or combined budgets.
                    Just the figures you asked for.
                  </p>
                </div>
              </div>
            </>
          )}
          {view === "connections" && (
            <>
              <div className="connections-heading">
                <h2>Google Ads accounts</h2>
                <Button
                  variant="outline"
                  onClick={() => setApiOpen(true)}
                  disabled={!data.database}
                >
                  {data.configured
                    ? "Update API settings"
                    : "Set up Google API"}
                  <ChevronRight size={14} />
                </Button>
              </div>
              <div className="connection-grid">
                {data.google.map((connection) => (
                  <section className="connection-card" key={connection.group}>
                    <div className="connection-card-top">
                      <SourceIcon source="google" />
                      <span className="connected-tag">
                        <Check size={12} />
                        Connected
                      </span>
                    </div>
                    <h3 title={connection.email}>{connection.email}</h3>
                    <p>Google Ads account access</p>
                    <div className="connection-card-footer">
                      <span>
                        {
                          data.stores.filter(
                            (s) => s.group === connection.group,
                          ).length
                        }{" "}
                        stores mapped
                      </span>
                      <a
                        className="button-link"
                        href={`/api/google/start?group=${connection.group}`}
                      >
                        Reconnect
                        <RefreshCw size={13} />
                      </a>
                    </div>
                  </section>
                ))}
                <section className="connection-card add-connection-card">
                  <div className="add-account-icon">
                    <Plus size={22} />
                  </div>
                  <h3>Add a Google account</h3>
                  <p>Connect another login and assign its stores.</p>
                  {data.configured ? (
                    <a
                      className="button-link add-account-link"
                      href="/api/google/start"
                    >
                      Connect Google
                      <ArrowUpRight size={14} />
                    </a>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => setApiOpen(true)}
                      disabled={!data.database}
                    >
                      Configure Google API
                      <ArrowRight size={14} />
                    </Button>
                  )}
                </section>
              </div>
              <div className="connections-heading">
                <div>
                  <h2>
                    Store mappings{" "}
                    <span className="count-pill">{data.stores.length}/25</span>
                  </h2>
                  <p className="muted">
                    One Shopify store linked to one Google Ads CID.
                  </p>
                </div>
                <Button onClick={add} disabled={!data.database}>
                  <Plus size={15} />
                  Add store
                </Button>
              </div>
              <div className="mapping-list">
                {data.stores.length ? (
                  data.stores.map((s) => (
                    <button
                      className="mapping-row"
                      key={s.id}
                      onClick={() => {
                        setEdit(s);
                        setAddOpen(true);
                      }}
                    >
                      <span className="store-avatar tone-0">{s.name[0]}</span>
                      <span>
                        <strong>{s.name}</strong>
                        <small>{s.domain}</small>
                      </span>
                      <span className="mapping-cid">
                        {s.cid} · {accountLabel(s.group)}
                      </span>
                      <span className="subtle-tag">
                        {s.shopConnected
                          ? "Credentials saved"
                          : "Shopify setup needed"}
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))
                ) : (
                  <div className="empty-state compact">
                    <Link2 size={26} />
                    <h3>No stores connected yet</h3>
                    <p>
                      Add a store name, Shopify domain, and its matching CID.
                    </p>
                    <Button onClick={add} disabled={!data.database}>
                      Add your first store
                      <Plus size={14} />
                    </Button>
                  </div>
                )}
              </div>
              {!data.database && (
                <div className="notice">
                  <Info size={16} />
                  Database setup is required before saving connections. The
                  local preview is available on Overview.
                </div>
              )}
            </>
          )}
          {view === "guide" && (
            <div className="guide-layout">
              <section className="guide-steps">
                <article>
                  <span className="step-number">01</span>
                  <div>
                    <h2>Enable Google Ads API access</h2>
                    <p>
                      Create a Google Cloud project, enable Google Ads API, and
                      request Explorer access on its API Overview page to read a
                      live account. Developer tokens were retired on September
                      9, 2026. Your existing Ads logins stay the same.
                    </p>
                    <a
                      href="https://developers.google.com/google-ads/api/docs/api-policy/access-levels"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Google’s API access guide <ArrowUpRight size={14} />
                    </a>
                  </div>
                </article>
                <article>
                  <span className="step-number">02</span>
                  <div>
                    <h2>Create your Google authorization app</h2>
                    <p>
                      In Google Cloud, enable Google Ads API, configure the
                      OAuth consent screen, and create a Web application OAuth
                      client. Add both Google emails as test users while
                      testing. Testing-mode refresh tokens can expire; use the
                      appropriate production consent configuration for ongoing
                      reporting.
                    </p>
                    <p>Add this exact authorized redirect URI:</p>
                    <code>
                      {typeof window !== "undefined"
                        ? window.location.origin
                        : ""}
                      /api/google/callback
                    </code>
                    <p>
                      Save the OAuth client ID and client secret in API
                      settings. Then connect each Google login separately.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => setApiOpen(true)}
                      disabled={!data.database}
                    >
                      Open API settings
                      <ArrowRight size={14} />
                    </Button>
                  </div>
                </article>
                <article>
                  <span className="step-number">03</span>
                  <div>
                    <h2>Connect a Shopify store</h2>
                    <p>
                      In Shopify’s Dev Dashboard, create and install an app for
                      the store with reporting access. The integration uses{" "}
                      <strong>read_reports</strong> and ShopifyQL, which
                      requires Level 2 protected customer data access.
                      Availability and approval must be confirmed for each
                      store.
                    </p>
                    <p>
                      For apps and stores in the same organization, enter the
                      app’s client ID and secret in the store form. If they are
                      in different organizations, a separately authorized Admin
                      API access token is required.
                    </p>
                    <a
                      href="https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Shopify connection guide
                      <ArrowUpRight size={14} />
                    </a>
                    <Button
                      className="mt-4"
                      onClick={add}
                      disabled={!data.database}
                    >
                      Add your first store
                      <Plus size={14} />
                    </Button>
                  </div>
                </article>
                <article>
                  <span className="step-number">04</span>
                  <div>
                    <h2>Verify one pair, then connect the rest</h2>
                    <p>
                      Refresh the reports and compare yesterday’s figures with
                      Google Ads and Shopify. The detail view shows each
                      source’s currency, time zone, date, and last successful
                      sync. Once verified, add the remaining store mappings.
                    </p>
                  </div>
                </article>
              </section>
              <aside className="guide-aside">
                <h3>How your data is shown</h3>
                <div>
                  <Wallet size={18} />
                  <p>
                    <strong>Daily budget</strong>Current Google Ads budgets,
                    listed individually. Shared budgets appear once.
                  </p>
                </div>
                <div>
                  <ShoppingBag size={18} />
                  <p>
                    <strong>Orders</strong>Shopify’s reported order count. No
                    order totals are added by this dashboard.
                  </p>
                </div>
                <div>
                  <Target size={18} />
                  <p>
                    <strong>Cost per purchase</strong>Google’s cost / conversion
                    is shown only when all reported conversions for that period
                    are purchases. Otherwise the field stays blank.
                  </p>
                </div>
                <div>
                  <Globe size={18} />
                  <p>
                    <strong>Dates and currencies</strong>Each source keeps its
                    own time zone and currency. Mismatches are shown in store
                    details.
                  </p>
                </div>
                <div>
                  <Clock3 size={18} />
                  <p>
                    <strong>Data freshness</strong>Local refresh frequency
                    scales with your store count and API allowance. Today and
                    the prior three days are fetched again to pick up reporting
                    updates.
                  </p>
                </div>
              </aside>
            </div>
          )}
          <footer className="workspace-footer">
            <span>
              SpendDesk <span>·</span> Your personal workspace
            </span>
            <span>
              <ShieldCheck size={12} />
              Private by design
            </span>
          </footer>
        </main>
      </SidebarInset>
      <StoreDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        store={edit}
        connections={data.google}
        onSaved={() => {
          load();
          setNotice(
            "Store mapping saved. Refresh data after connecting both sources.",
          );
        }}
      />
      <ApiDialog
        open={apiOpen}
        onOpenChange={setApiOpen}
        onSaved={() => {
          load();
          setNotice("API settings saved. You can now add Google accounts.");
        }}
      />
      <Sheet
        open={!!selected}
        onOpenChange={(v) => {
          if (!v) setSelected(null);
        }}
      >
        <SheetContent className="store-sheet">
          {selected && (
            <>
              <SheetHeader>
                <p className="eyebrow">
                  STORE DETAILS {demo ? "· EXAMPLE DATA" : ""}
                </p>
                <SheetTitle>{selected.name}</SheetTitle>
                <SheetDescription>
                  {selected.domain} · {accountLabel(selected.group)}
                </SheetDescription>
              </SheetHeader>
              <StoreDetails
                selected={selected}
                demo={demo}
                from={from}
                to={to}
                onEdit={() => {
                  setEdit(selected);
                  setSelected(null);
                  setAddOpen(true);
                }}
              />
            </>
          )}
        </SheetContent>
      </Sheet>
      <Dialog
        open={exportOpen}
        onOpenChange={(open) => {
          if (!exporting) setExportOpen(open);
        }}
      >
        <DialogContent className="setup-dialog" showCloseButton={!exporting}>
          <DialogTitle>Export report</DialogTitle>
          <DialogDescription>
            Choose how many days to include. The CSV includes all stores and
            Google accounts.
          </DialogDescription>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void exportReport();
            }}
            className="grid gap-4"
          >
            <label className="grid gap-2">
              How many days?
              <input
                className="rounded-md border px-3 py-2"
                type="number"
                min="1"
                max="366"
                step="1"
                required
                value={exportDays}
                onChange={(event) => setExportDays(event.target.value)}
                disabled={exporting}
              />
            </label>
            <label className="grid gap-2">
              End date
              <input
                className="rounded-md border px-3 py-2"
                type="date"
                required
                max={dateInZone("Asia/Kolkata")}
                value={exportEnd}
                onChange={(event) => setExportEnd(event.target.value)}
                disabled={exporting}
              />
            </label>
            <p className="text-sm text-muted-foreground">
              Includes the end date. Dates use India time. Reports are prepared
              automatically if needed.
            </p>
            {exportError && <p role="alert">{exportError}</p>}
            {exporting && <p role="status">Queueing your report…</p>}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={exporting}
                onClick={() => setExportOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={exporting}>
                {exporting ? "Queueing…" : "Generate report"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
function StoreDialog({
  open,
  onOpenChange,
  store,
  connections,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  store: Store | null;
  connections: DashboardData["google"];
  onSaved: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [group, setGroup] = useState("");
  useEffect(() => {
    setError("");
    setGroup(String(store?.group || connections[0]?.group || ""));
  }, [open, store, connections]);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...Object.fromEntries(f),
          group: Number(group),
          ...(store ? { id: store.id } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="setup-dialog">
        <DialogTitle>
          {store ? "Edit store connection" : "Add a store"}
        </DialogTitle>
        <DialogDescription>
          Link one Shopify store to its Google Ads customer ID.
        </DialogDescription>
        <form onSubmit={save} className="setup-form" key={store?.id || "new"}>
          <div className="form-grid">
            <label>
              Store name
              <input
                name="name"
                defaultValue={store?.name}
                placeholder="Your store name"
                required
                maxLength={80}
              />
            </label>
            <label>
              Google Ads CID
              <input
                name="cid"
                defaultValue={store?.cid}
                placeholder="123-456-7890"
                required
                pattern="[0-9\s-]{10,14}"
              />
            </label>
          </div>
          <label>
            Shopify domain
            <input
              name="domain"
              defaultValue={store?.domain}
              placeholder="your-store.myshopify.com"
              required
            />
          </label>
          <div className="form-grid">
            <label>
              Google account
              <Select value={group} onValueChange={(v) => setGroup(v || "")}>
                <SelectTrigger aria-label="Assign Google account">
                  <SelectValue>
                    {connections.find((c) => String(c.group) === group)
                      ?.email || "Connect a Google account first"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {connections.map((c) => (
                    <SelectItem key={c.group} value={String(c.group)}>
                      {c.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label>
              Manager CID <small>(if required)</small>
              <input
                name="managerCid"
                defaultValue={store?.managerCid}
                placeholder="Optional"
              />
            </label>
          </div>
          <div className="form-divider" />
          <h3>Shopify app credentials</h3>
          <p className="muted">
            For an app installed in the same organization as this store.{" "}
            {store?.shopConnected
              ? "Leave blank to keep saved credentials."
              : "You can save the mapping now and add credentials later."}
          </p>
          <label>
            Client ID
            <input
              name="clientId"
              autoComplete="off"
              placeholder="App client ID"
            />
          </label>
          <label>
            Client secret
            <input
              name="clientSecret"
              type="password"
              autoComplete="new-password"
              placeholder="Stored encrypted"
            />
          </label>
          <details>
            <summary>Use an existing Admin API access token</summary>
            <label>
              Access token
              <input
                name="accessToken"
                type="password"
                autoComplete="new-password"
                placeholder="Authorized token for this store"
              />
            </label>
            <small>
              Use only an already authorized token. Expiring tokens need to be
              replaced.
            </small>
          </details>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <Button
              variant="outline"
              type="button"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !group}>
              {busy ? "Saving…" : "Save store"}
              <Check size={15} />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function ApiDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="setup-dialog">
        <DialogTitle>Google Ads API settings</DialogTitle>
        <DialogDescription>
          These credentials identify your reporting app. Connect your Google
          logins after saving.
        </DialogDescription>
        <form onSubmit={save} className="setup-form">
          <label>
            OAuth client ID
            <input
              name="clientId"
              required
              placeholder="…apps.googleusercontent.com"
              autoComplete="off"
            />
          </label>
          <label>
            OAuth client secret
            <input
              type="password"
              name="clientSecret"
              required
              autoComplete="new-password"
            />
          </label>
          <p className="muted">
            Both OAuth values are required to save or replace settings. Secrets
            are encrypted and are never returned to the browser.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <Button
              variant="outline"
              type="button"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save API settings"}
              <Check size={15} />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
