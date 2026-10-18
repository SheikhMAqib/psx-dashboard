"""Thin client for the CapitalStake PSX REST API plus the tool schemas the agent exposes to Claude.

Endpoints used (all GET, Bearer auth, base https://csapis.com):
  /3.0/market/sectors            sector codes and names
  /3.0/sectors/overview          market cap, constituents, P/E, dividend yield per sector
  /3.0/market/stocks             all listed symbols (optionally ?symbol=A,B)
  /3.0/market/stock              one symbol
  /3.0/market/quote              last price, bid/ask for one symbol
  /3.0/market/indices            all indices
  /3.0/market/state              market open/closed state
  /3.0/company/profile/overview  company profile
"""
import os
import time

import httpx

BASE_URL = os.environ.get("CAPITALSTAKE_BASE_URL", "https://csapis.com")
CACHE_SECONDS = 300

_cache: dict[str, tuple[float, object]] = {}


class ApiError(Exception):
    pass


def _get(path: str, params: dict | None = None):
    token = os.environ.get("CAPITALSTAKE_TOKEN")
    if not token:
        raise ApiError("CAPITALSTAKE_TOKEN is not set")
    key = path + repr(sorted((params or {}).items()))
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]
    resp = httpx.get(
        BASE_URL + path,
        params=params,
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    if resp.status_code == 403:
        raise ApiError("CapitalStake rejected the token (403). Check CAPITALSTAKE_TOKEN.")
    if resp.status_code == 404:
        raise ApiError("Not found (404).")
    resp.raise_for_status()
    body = resp.json()
    if body.get("status") != "ok":
        raise ApiError(body.get("message") or "CapitalStake returned an error")
    data = body.get("data")
    _cache[key] = (time.time(), data)
    return data


def _sector_names() -> dict[str, str]:
    return {s["code"]: s["name"] for s in _get("/3.0/market/sectors")}


def _resolve_sector(text: str) -> str | None:
    """Accept a sector code ('0804') or part of a name ('cement')."""
    names = _sector_names()
    if text in names:
        return text
    t = text.strip().lower()
    for code, name in names.items():
        if t == name.lower():
            return code
    for code, name in names.items():
        if t in name.lower():
            return code
    return None


# ---- tool implementations -------------------------------------------------

def list_sectors() -> list:
    return _get("/3.0/market/sectors")


def sector_overview() -> list:
    return _get("/3.0/sectors/overview")


def find_stocks(
    sector: str | None = None,
    query: str | None = None,
    limit: int = 40,
    offset: int = 0,
) -> dict:
    stocks = _get("/3.0/market/stocks")
    names = _sector_names()
    rows = stocks
    if sector:
        code = _resolve_sector(sector)
        if code is None:
            return {"error": f"No sector matches '{sector}'. Call list_sectors to see valid names."}
        rows = [s for s in rows if s.get("sector") == code]
    if query:
        q = query.lower()
        rows = [s for s in rows if q in s["symbol"].lower() or q in s["name"].lower()]
    rows = sorted(rows, key=lambda s: s.get("market_cap") or 0, reverse=True)
    limit = max(1, min(int(limit), 100))
    offset = max(0, int(offset))
    out = [
        {
            "symbol": s["symbol"],
            "name": s["name"],
            "sector": names.get(s["sector"], s["sector"]),
            "last_close": s.get("ldcp"),
            "market_cap": s.get("market_cap"),
            "status": s.get("status"),
            "logo_url": s.get("logo_url") or s.get("logo") or s.get("image_url") or s.get("company_logo"),
            "website": s.get("website") or s.get("company_website") or s.get("url"),
        }
        for s in rows[offset : offset + limit]
    ]
    return {
        "total_matches": len(rows),
        "returned": len(out),
        "offset": offset,
        "stocks": out,
    }


def get_stock(symbol: str) -> dict:
    data = _get("/3.0/market/stock", {"symbol": symbol.upper()})
    data["sector_name"] = _sector_names().get(data.get("sector"), data.get("sector"))
    return data


def get_quote(symbol: str) -> dict:
    return _get("/3.0/market/quote", {"symbol": symbol.upper()})


def list_indices() -> list:
    return _get("/3.0/market/indices")


def market_state() -> dict:
    return _get("/3.0/market/state")


def company_profile(symbol: str) -> dict:
    return _get("/3.0/company/profile/overview", {"symbol": symbol.upper()})


IMPLEMENTATIONS = {
    "list_sectors": list_sectors,
    "sector_overview": sector_overview,
    "find_stocks": find_stocks,
    "get_stock": get_stock,
    "get_quote": get_quote,
    "list_indices": list_indices,
    "market_state": market_state,
    "company_profile": company_profile,
}

_SYMBOL = {"type": "object", "properties": {"symbol": {"type": "string", "description": "PSX ticker, e.g. LUCK"}}, "required": ["symbol"]}
_EMPTY = {"type": "object", "properties": {}}

TOOLS = [
    {"name": "list_sectors", "description": "List all PSX sector codes and names.", "input_schema": _EMPTY},
    {"name": "sector_overview", "description": "Per-sector market cap (PKR), number of companies, average P/E and dividend yield.", "input_schema": _EMPTY},
    {
        "name": "find_stocks",
        "description": "List listed companies, largest market cap first. Filter by sector (name or code) and/or a text match on symbol or company name.",
        "input_schema": {
            "type": "object",
            "properties": {
                "sector": {"type": "string", "description": "Sector name or code, e.g. 'cement' or '0804'"},
                "query": {"type": "string", "description": "Text to match in symbol or company name"},
                "limit": {"type": "integer", "description": "Max rows, default 40, max 100"},
            },
        },
    },
    {"name": "get_stock", "description": "Reference data for one symbol: last day close, 52-week range, circuit limits, shares, free float, market cap, indices it belongs to.", "input_schema": _SYMBOL},
    {"name": "get_quote", "description": "Latest price data for one symbol: open, high, low, close, volume, change, bid and ask.", "input_schema": _SYMBOL},
    {"name": "list_indices", "description": "All PSX indices with values, change, 52-week range, P/E and dividend yield.", "input_schema": _EMPTY},
    {"name": "market_state", "description": "Whether the PSX market is open, closed or suspended, with last update times.", "input_schema": _EMPTY},
    {"name": "company_profile", "description": "Company description, auditor, registrar, address, website and key people for one symbol.", "input_schema": _SYMBOL},
]
