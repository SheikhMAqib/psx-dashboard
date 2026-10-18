# PSX agent

A Claude agent that answers questions about the Pakistan Stock Exchange using the
CapitalStake REST API (`https://csapis.com`) as its tools.

## Setup

```bash
cd psx-agent
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
npm ci
npm run build
export ANTHROPIC_API_KEY=...        # from the Claude Console
export CAPITALSTAKE_TOKEN=...       # bearer token from CapitalStake (see below)
```

CapitalStake's docs do not say how to get a token. Ask their support:
https://capitalstake.com/support

## Run

```bash
python agent.py                                   # chat
python dashboard.py                              # Tailwind web dashboard
python agent.py "Which 5 cement companies have the largest market cap?"
python agent.py "Compare HBL and UBL"
python agent.py "How is the KSE100 doing and is the market open?"
```

Tool calls print to stderr so you can see what the agent fetched.

## What it can do

| Tool | CapitalStake endpoint |
|---|---|
| `list_sectors` | `/3.0/market/sectors` |
| `sector_overview` | `/3.0/sectors/overview` |
| `find_stocks` | `/3.0/market/stocks` (filtered by sector or text here) |
| `get_stock` | `/3.0/market/stock` |
| `get_quote` | `/3.0/market/quote` |
| `list_indices` | `/3.0/market/indices` |
| `market_state` | `/3.0/market/state` |
| `company_profile` | `/3.0/company/profile/overview` |

The Tailwind web dashboard follows the PSX Data Portal's market-first layout,
with market indices, sector market-cap charts, searchable/paginated company
listings, quote details, and chat using the same assistant and CapitalStake
tools. Company logo images are displayed when supplied by the market data;
otherwise, the dashboard uses a company-symbol badge and the company's website
favicon when available.
The sector chart shows every sector as a labeled, ranked bar and scrolls within
the panel on smaller screens. Mobile users can navigate between dashboard
sections using the fixed bottom navigation.
The Technical Chart section embeds the SCSTrade real-time chart page and also
provides a link to open it separately if the provider's browser settings block
embedded viewing.

The dashboard frontend is written in TypeScript in `frontend/dashboard.ts`.
Build its browser JavaScript and copy the dashboard assets for Vercel with
`npm run build`; run `npm run typecheck` to check types without emitting files.
Flask serves the generated `static/dashboard.js` locally. On Vercel, assets are
served from `public/static/` and the Flask application is exposed through
`app.py`. Set `CAPITALSTAKE_TOKEN` and `ANTHROPIC_API_KEY` in the Vercel project
environment variables to enable live market data and assistant chat.

## Notes

- Responses are cached for 5 minutes in memory to save API calls. Change `CACHE_SECONDS` in `psx_tools.py`.
- The model defaults to `claude-sonnet-5-5`. Override with `PSX_AGENT_MODEL`.
- Rate limits and licensing are not published. Check your CapitalStake agreement before
  showing their data to other people.
- Set `CAPITALSTAKE_BASE_URL=https://uat.csapis.com` to point at their UAT environment.
- Endpoint paths and fields come from CapitalStake's public docs and have not been run
  against a live token, so a field name may need adjusting on first run.
- Company logos are not consistently provided by the CapitalStake stock-list
  API. The dashboard uses available logo/website fields and falls back to a
  symbol badge where no image URL is available.
