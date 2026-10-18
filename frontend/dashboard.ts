const PAGE_SIZE: number = 25;
type JsonRecord = Record<string, unknown>;
type ChatRole = "user" | "assistant";
interface ChatMessage {
  role: ChatRole;
  content: string;
}
interface StockRow extends JsonRecord {
  symbol?: string;
  name?: string;
  sector?: string;
}
interface DashboardState {
  page: number;
  total: number;
  query: string;
  sector: string;
  stocks: StockRow[];
  history: ChatMessage[];
  assistantAvailable: boolean;
  searchTimer: number | null;
}

const state: DashboardState = {
  page: 1,
  total: 0,
  query: "",
  sector: "",
  stocks: [],
  history: [],
  assistantAvailable: false,
  searchTimer: null,
};

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Dashboard element not found: #${id}`);
  return element as T;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safe(value: unknown): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return String(value ?? "").replace(/[&<>"']/g, (char) => entities[char] ?? char);
}

function number(value: unknown, decimals = 2): string {
  if (value === null || value === undefined || value === "") return "—";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString("en-PK", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }) : "—";
}

function pick(object: unknown, keys: readonly string[]): unknown {
  if (!isRecord(object)) return null;
  for (const key of keys) if (object[key] !== undefined && object[key] !== null) return object[key];
  return null;
}

function rowsFrom(value: unknown, keys: readonly string[] = []): JsonRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of keys) {
    const rows = value[key];
    if (Array.isArray(rows)) return rows.filter(isRecord);
  }
  return [];
}

function stockRowsFrom(value: unknown): StockRow[] {
  return rowsFrom(value).map((row) => ({
    ...row,
    symbol: typeof row.symbol === "string" ? row.symbol : undefined,
    name: typeof row.name === "string" ? row.name : undefined,
    sector: typeof row.sector === "string" ? row.sector : undefined,
  }));
}

function marketCap(value: unknown): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  if (Math.abs(parsed) >= 1e12) return `${(parsed / 1e12).toFixed(2)}T`;
  if (Math.abs(parsed) >= 1e9) return `${(parsed / 1e9).toFixed(2)}B`;
  if (Math.abs(parsed) >= 1e6) return `${(parsed / 1e6).toFixed(2)}M`;
  return number(parsed, 0);
}

async function getJson(url: string, options?: RequestInit): Promise<JsonRecord> {
  const response = await fetch(url, options);
  const payload: unknown = await response.json();
  const record = asRecord(payload);
  if (!response.ok) {
    const message = record && typeof record.error === "string"
      ? record.error
      : `Request failed (${response.status})`;
    throw new Error(message);
  }
  if (!record) throw new Error("The server returned an invalid response.");
  return record;
}

function showMessage(text: string, isError = true): void {
  const message = byId("global-message");
  message.textContent = text;
  message.className = `mt-5 rounded-xl border px-4 py-3 text-sm ${isError
    ? "border-amber-200 bg-amber-50 text-amber-800"
    : "border-emerald-200 bg-emerald-50 text-emerald-800"}`;
}

function logoMarkup(company: StockRow, extraClass = ""): string {
  const symbol = String(company.symbol || "?");
  const imageUrl = validImageUrl(company.logo_url || company.logo);
  const websiteIcon = !imageUrl ? faviconUrl(company.website) : "";
  const source = imageUrl || websiteIcon;
  return `<span class="company-logo ${extraClass}" data-logo-box>${safe(symbol.slice(0, 3))}${source
    ? `<img src="${safe(source)}" alt="" loading="lazy" data-company-logo>`
    : ""}</span>`;
}

function validImageUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function faviconUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    if (!["https:", "http:"].includes(url.protocol)) return "";
    return `${url.origin}/favicon.ico`;
  } catch {
    return "";
  }
}

function attachLogoFallbacks(container: ParentNode): void {
  container.querySelectorAll("[data-company-logo]").forEach((image) => {
    image.addEventListener("error", () => image.remove(), { once: true });
  });
}

function setMarketStatus(status: unknown): void {
  const label = String(status || "Unavailable").replace(/[_-]/g, " ");
  const normalized = label.toLowerCase();
  const pill = byId("market-pill");
  pill.className = `status-pill ${normalized.includes("open") ? "open" : normalized.includes("closed") || normalized.includes("suspend") ? "closed" : ""}`;
  pill.innerHTML = `<span class="status-dot"></span>${safe(label.replace(/\b\w/g, (char) => char.toUpperCase()))}`;
}

function renderIndices(value: unknown): void {
  const indices = rowsFrom(value, ["indices", "data"]);
  const grid = byId("index-grid");
  if (!indices.length) {
    grid.innerHTML = `<div class="panel col-span-full py-9 text-center text-sm text-slate-400">Index data is not available right now.</div>`;
    return;
  }
  grid.innerHTML = indices.slice(0, 4).map((index) => {
    const label = pick(index, ["name", "symbol", "index", "code"]) || "PSX Index";
    const value = pick(index, ["value", "index_value", "current", "close"]);
    const change = pick(index, ["change", "change_value", "points_change"]);
    const percent = pick(index, ["change_percent", "change_pct", "percent_change"]);
    const numericChange = Number(percent ?? change);
    const positive = Number.isFinite(numericChange) && numericChange >= 0;
    const delta = percent !== null ? `${number(percent)}%` : change !== null ? number(change) : "—";
    const range = pick(index, ["year_low", "low_52_week", "week_52_low"]);
    return `<article class="panel relative overflow-hidden">
      <div class="flex items-center justify-between"><span class="text-[10px] font-semibold uppercase tracking-[.12em] text-slate-400">${safe(label)}</span>
      <span class="grid h-7 w-7 place-items-center rounded-lg ${positive ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-500"}">${positive ? "↗" : "↘"}</span></div>
      <p class="mt-5 text-[24px] font-bold tracking-tight text-ink">${number(value)}</p>
      <div class="mt-2 flex items-center justify-between"><span class="text-[11px] font-semibold ${positive ? "text-emerald-600" : "text-rose-500"}">${safe(delta)}</span>
      <span class="text-[10px] text-slate-400">${range !== null ? `52w low ${number(range)}` : "Latest available"}</span></div>
    </article>`;
  }).join("");
}

function renderSectors(value: unknown, companies: JsonRecord = {}): void {
  const sectors = rowsFrom(value, ["sectors", "data"]);
  const chartRows = sectors.map((row) => ({
    name: pick(row, ["sector_name", "name", "sector", "code"]),
    cap: Number(pick(row, ["market_cap", "market_capitalization", "marketCap"])),
  })).filter((row) => row.name && Number.isFinite(row.cap) && row.cap > 0)
    .sort((left, right) => right.cap - left.cap);

  if (chartRows.length) {
    byId("sector-chart-scroll").classList.remove("hidden");
    byId("chart-empty").classList.add("hidden");
    byId("sector-chart-hint").classList.remove("hidden");
    byId("sector-chart-count").textContent = `${chartRows.length} SECTORS`;
    const maxCap = chartRows[0].cap;
    byId("sector-chart").innerHTML = chartRows.map((row, index) => {
      const share = Math.max(1, (row.cap / maxCap) * 100);
      const value = marketCap(row.cap);
      return `<div class="sector-bar-row" role="listitem">
        <div class="sector-bar-heading"><span class="sector-bar-name">${safe(row.name)}</span><strong class="sector-bar-value">PKR ${safe(value)}</strong></div>
        <div class="sector-bar-track" role="progressbar" aria-label="${safe(row.name)} market capitalization" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${share.toFixed(1)}" aria-valuetext="PKR ${safe(value)}">
          <span class="sector-bar-fill ${index === 0 ? "leading" : ""}" style="width:${share.toFixed(1)}%"></span>
        </div>
      </div>`;
    }).join("");
  } else {
    byId("sector-chart-scroll").classList.add("hidden");
    byId("chart-empty").classList.remove("hidden");
    byId("sector-chart-hint").classList.add("hidden");
    byId("sector-chart-count").textContent = "NO DATA";
  }

  byId("sector-count").textContent = sectors.length ? number(sectors.length, 0) : "—";
  const names = sectors.map((row) => pick(row, ["sector_name", "name", "sector", "code"])).filter(Boolean);
  if (companies.total_matches !== undefined) {
    const totalCompanies = Number(companies.total_matches);
    byId("listed-count").textContent = Number.isFinite(totalCompanies) ? number(totalCompanies, 0) : "—";
  }
  byId("sector-chips").innerHTML = names.length
    ? names.slice(0, 5).map((name) => `<button class="sector-chip" data-sector="${safe(name)}">${safe(name)}</button>`).join("")
    : `<span class="text-xs text-slate-400">Sector data unavailable.</span>`;
  byId("sector-chips").querySelectorAll<HTMLButtonElement>("[data-sector]").forEach((button) => {
    button.addEventListener("click", () => {
      byId<HTMLSelectElement>("sector-filter").value = button.dataset.sector ?? "";
      state.sector = button.dataset.sector ?? "";
      state.page = 1;
      void loadStocks();
      byId("companies").scrollIntoView({ behavior: "smooth" });
    });
  });
}

function renderSectorOptions(value: unknown): void {
  const sectors = rowsFrom(value, ["sectors", "data"]);
  const select = byId<HTMLSelectElement>("sector-filter");
  const names = sectors.map((row) => ({
    name: pick(row, ["name", "sector_name"]),
    code: pick(row, ["code", "sector"]),
  })).filter((row) => row.name || row.code);
  select.innerHTML = `<option value="">All sectors</option>${names.map((row) => {
    const optionValue = row.name || row.code;
    return `<option value="${safe(optionValue)}">${safe(row.name || row.code)}</option>`;
  }).join("")}`;
}

async function loadMarket(): Promise<void> {
  byId<HTMLButtonElement>("refresh-button").disabled = true;
  try {
    const result = await getJson("/api/market");
    const stateData = asRecord(result.state)?.data;
    const marketName = pick(stateData, ["status", "state", "market_status"]);
    setMarketStatus(marketName);
    const updated = pick(stateData, ["last_updated", "updated_at", "last_update"]);
    byId("market-updated").textContent = updated ? `Last updated ${updated}` : "Latest available market data";
    renderIndices(asRecord(result.indices)?.data);
    renderSectors(asRecord(result.sectors)?.data);
    renderSectorOptions(asRecord(result.sector_list)?.data);
    if (
      asRecord(result.state)?.error
      || asRecord(result.indices)?.error
      || asRecord(result.sectors)?.error
    ) {
      showMessage("Some market data could not be loaded. Check your CapitalStake token and try again.");
    } else {
      byId("global-message").classList.add("hidden");
    }
  } catch (error) {
    showMessage(`Market overview could not be loaded: ${errorMessage(error)}`);
  } finally {
    byId<HTMLButtonElement>("refresh-button").disabled = false;
  }
}

function renderCompanies(payload: JsonRecord): void {
  const companies = stockRowsFrom(payload.stocks);
  state.stocks = companies;
  const body = byId<HTMLTableSectionElement>("company-rows");
  if (!companies.length) {
    body.innerHTML = `<tr><td colspan="5" class="px-6 py-12 text-center text-sm text-slate-400">No matching companies. Adjust your filters.</td></tr>`;
  } else {
    body.innerHTML = companies.map((company) => {
      const symbol = company.symbol || "";
      const status = String(company.status || "").toLowerCase();
      const stateLabel = status.includes("suspend") ? "Suspended" : status.includes("active") || status.includes("listed") ? "Active" : company.status || "—";
      const isActive = stateLabel === "Active";
      return `<tr class="company-row" tabindex="0" data-symbol="${safe(symbol)}" aria-label="View ${safe(company.name)} details">
        <td><div class="company-identity">${logoMarkup(company)}<span><span class="company-name">${safe(company.name || symbol)}</span><span class="company-symbol">${safe(symbol)}</span></span></div></td>
        <td><span class="sector-label">${safe(company.sector || "—")}</span></td>
        <td class="table-number text-right">${number(company.last_close)}</td>
        <td class="table-number text-right">${safe(marketCap(company.market_cap))}</td>
        <td class="text-right"><span class="rounded-full px-2 py-1 text-[9px] font-semibold ${isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}">${safe(stateLabel)}</span></td>
      </tr>`;
    }).join("");
  }
  attachLogoFallbacks(body);
  body.querySelectorAll<HTMLTableRowElement>("[data-symbol]").forEach((row) => {
    const open = () => loadCompany(row.dataset.symbol ?? "");
    row.addEventListener("click", open);
    row.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  });

  state.total = Number(payload.total_matches) || 0;
  byId("company-count").textContent = `${number(state.total, 0)} ${state.total === 1 ? "company" : "companies"} · sorted by market capitalization`;
  const start = state.total ? (state.page - 1) * PAGE_SIZE + 1 : 0;
  const end = Math.min(state.page * PAGE_SIZE, state.total);
  byId("pagination-summary").textContent = state.total ? `Showing ${number(start, 0)}–${number(end, 0)} of ${number(state.total, 0)}` : "No results";
  byId("page-label").textContent = `Page ${state.page} of ${Math.max(1, Math.ceil(state.total / PAGE_SIZE))}`;
  byId<HTMLButtonElement>("page-prev").disabled = state.page <= 1;
  byId<HTMLButtonElement>("page-next").disabled = end >= state.total;
}

async function loadStocks(): Promise<void> {
  const body = byId<HTMLTableSectionElement>("company-rows");
  body.innerHTML = `<tr><td colspan="5" class="px-6 py-12 text-center text-sm text-slate-400">Loading companies...</td></tr>`;
  const params = new URLSearchParams({
    page: String(state.page),
    limit: String(PAGE_SIZE),
  });
  if (state.query) params.set("q", state.query);
  if (state.sector) params.set("sector", state.sector);
  try {
    const payload = await getJson(`/api/stocks?${params}`);
    renderCompanies(payload);
    if (state.page === 1 && !state.query && !state.sector) {
      byId("listed-count").textContent = number(Number(payload.total_matches) || 0, 0);
      renderSectorsFromVisible(stockRowsFrom(payload.stocks));
    }
  } catch (error) {
    body.innerHTML = `<tr><td colspan="5" class="px-6 py-12 text-center text-sm text-amber-700">${safe(errorMessage(error))}</td></tr>`;
    byId("company-count").textContent = "Company listings unavailable";
  }
}

function renderSectorsFromVisible(companies: StockRow[]): void {
  const chips = byId("sector-chips");
  if (chips.children.length) return;
  const names = [...new Set(companies.map((company) => company.sector).filter(Boolean))].slice(0, 5);
  chips.innerHTML = names.map((name) => `<button class="sector-chip" data-sector="${safe(name)}">${safe(name)}</button>`).join("");
  chips.querySelectorAll<HTMLButtonElement>("[data-sector]").forEach((button) => {
    button.addEventListener("click", () => {
      byId<HTMLSelectElement>("sector-filter").value = button.dataset.sector ?? "";
      state.sector = button.dataset.sector ?? "";
      state.page = 1;
      void loadStocks();
      byId("companies").scrollIntoView({ behavior: "smooth" });
    });
  });
}

async function loadCompany(symbol: string): Promise<void> {
  byId("detail-content").innerHTML = `<div class="text-sm text-slate-400">Loading ${safe(symbol)}…</div>`;
  try {
    const data = await getJson(`/api/stock/${encodeURIComponent(symbol)}`);
    const stock = asRecord(data.stock) ?? {};
    const quote = asRecord(data.quote) ?? {};
    const profile = asRecord(data.profile) ?? {};
    const row: StockRow = state.stocks.find((item) => item.symbol === symbol) || {
      symbol,
      name: String(pick(stock, ["name", "company_name"]) || symbol),
      logo_url: pick(stock, ["logo_url", "logo"]),
      website: pick(profile, ["website", "company_website", "url"]),
    };
    row.website = row.website || pick(profile, ["website", "company_website", "url"]);
    row.logo_url = row.logo_url || pick(stock, ["logo_url", "logo"]);
    const last = pick(quote, ["last", "price", "close", "last_price"]) ?? pick(stock, ["ldcp", "last_close"]);
    const delta = pick(quote, ["change", "price_change"]);
    const volume = pick(quote, ["volume", "traded_volume"]);
    byId("detail-content").innerHTML = `<div class="w-full">
      <div class="mb-5 flex items-center gap-3">${logoMarkup(row, "detail-logo")}<div class="min-w-0"><h3 class="truncate text-sm font-bold text-ink">${safe(row.name || symbol)}</h3><p class="mt-1 text-[10px] font-semibold tracking-wider text-slate-400">${safe(symbol)} <span class="mx-1">·</span> ${safe(pick(stock, ["sector_name", "sector"]) || "")}</p></div>
      <a class="ml-auto text-[10px] font-semibold text-forest hover:underline" href="https://dps.psx.com.pk/company/${encodeURIComponent(symbol)}" target="_blank" rel="noreferrer">PSX profile ↗</a></div>
      <div class="quote-grid">
        <div class="quote-cell"><span>Last close / price</span><strong>PKR ${number(last)}</strong></div>
        <div class="quote-cell"><span>Change</span><strong>${delta === null ? "—" : number(delta)}</strong></div>
        <div class="quote-cell"><span>Volume</span><strong>${volume === null ? "—" : number(volume, 0)}</strong></div>
        <div class="quote-cell"><span>Day high</span><strong>${number(pick(quote, ["high", "high_price"]))}</strong></div>
        <div class="quote-cell"><span>Day low</span><strong>${number(pick(quote, ["low", "low_price"]))}</strong></div>
        <div class="quote-cell"><span>Market cap</span><strong>${safe(marketCap(pick(stock, ["market_cap", "marketCap"])))}</strong></div>
      </div>${data.profile_error ? `<p class="mt-3 text-[10px] text-amber-700">Company profile or logo details unavailable: ${safe(data.profile_error)}</p>` : ""}</div>`;
    attachLogoFallbacks(byId("detail-content"));
  } catch (error) {
    byId("detail-content").textContent = `${symbol}: ${errorMessage(error)}`;
  }
}

function addChatMessage(content: string, role: ChatRole): HTMLDivElement {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role === "user" ? "user-bubble" : "assistant-bubble"}`;
  bubble.textContent = content;
  byId("chat-messages").appendChild(bubble);
  byId("chat-messages").scrollTop = byId("chat-messages").scrollHeight;
  return bubble;
}

async function submitChat(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const input = byId<HTMLInputElement>("chat-input");
  const question = input.value.trim();
  if (!question || !state.assistantAvailable) return;
  input.value = "";
  addChatMessage(question, "user");
  const pending = addChatMessage("Checking the latest market data…", "assistant");
  byId<HTMLButtonElement>("chat-send").disabled = true;
  try {
    const response = await getJson("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: question, history: state.history }),
    });
    if (typeof response.answer !== "string") {
      throw new Error("The assistant returned an invalid response.");
    }
    pending.textContent = response.answer;
    state.history.push({ role: "user", content: question }, { role: "assistant", content: response.answer });
    state.history = state.history.slice(-20);
  } catch (error) {
    pending.textContent = `Assistant unavailable: ${errorMessage(error)}`;
  } finally {
    byId<HTMLButtonElement>("chat-send").disabled = false;
    input.focus();
  }
}

async function initialize(): Promise<void> {
  try {
    const config = await getJson("/api/config");
    state.assistantAvailable = config.assistant_available === true;
    if (!state.assistantAvailable) {
      byId<HTMLInputElement>("chat-input").disabled = true;
      byId<HTMLInputElement>("chat-input").placeholder = "Set ANTHROPIC_API_KEY to enable chat";
      byId<HTMLButtonElement>("chat-send").disabled = true;
      byId("assistant-state").textContent = "API KEY REQUIRED";
    }
    if (config.market_available !== true) {
      showMessage("Set CAPITALSTAKE_TOKEN in your environment to load PSX market data.");
    }
  } catch (error) {
    showMessage(`Dashboard configuration unavailable: ${errorMessage(error)}`);
  }
  await Promise.all([loadMarket(), loadStocks()]);
}

byId<HTMLButtonElement>("refresh-button").addEventListener("click", () => void Promise.all([loadMarket(), loadStocks()]));
byId<HTMLInputElement>("company-search").addEventListener("input", (event: Event) => {
  if (state.searchTimer !== null) window.clearTimeout(state.searchTimer);
  if (!(event.currentTarget instanceof HTMLInputElement)) return;
  const input = event.currentTarget;
  state.searchTimer = window.setTimeout(() => {
    state.query = input.value.trim();
    state.page = 1;
    void loadStocks();
  }, 250);
});
byId<HTMLInputElement>("header-search").addEventListener("input", (event: Event) => {
  if (!(event.currentTarget instanceof HTMLInputElement)) return;
  byId<HTMLInputElement>("company-search").value = event.currentTarget.value;
  byId<HTMLInputElement>("company-search").dispatchEvent(new Event("input"));
  byId("companies").scrollIntoView({ behavior: "smooth" });
});
byId<HTMLSelectElement>("sector-filter").addEventListener("change", (event: Event) => {
  if (!(event.currentTarget instanceof HTMLSelectElement)) return;
  state.sector = event.currentTarget.value;
  state.page = 1;
  void loadStocks();
});
byId<HTMLButtonElement>("page-prev").addEventListener("click", () => {
  if (state.page > 1) {
    state.page -= 1;
    void loadStocks();
  }
});
byId<HTMLButtonElement>("page-next").addEventListener("click", () => {
  if (state.page * PAGE_SIZE < state.total) {
    state.page += 1;
    void loadStocks();
  }
});
byId<HTMLFormElement>("chat-form").addEventListener("submit", (event: SubmitEvent) => void submitChat(event));
document.addEventListener("keydown", (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    byId("header-search").focus();
    byId("header-search").scrollIntoView({ block: "nearest" });
  }
});
const navSections = ["overview", "technical-chart", "companies", "assistant"]
  .map((id) => byId<HTMLElement>(id));
if ("IntersectionObserver" in window) {
  const navObserver = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    document.querySelectorAll(".dashboard-nav a, .mobile-nav a").forEach((link) => {
      const active = link.getAttribute("href") === `#${visible.target.id}`;
      link.classList.toggle("active", active);
    });
  }, { rootMargin: "-20% 0px -65% 0px", threshold: [0, 0.2, 0.5] });
  navSections.forEach((section) => navObserver.observe(section));
}
byId("date-label").textContent = new Intl.DateTimeFormat("en", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
}).format(new Date());
initialize();
