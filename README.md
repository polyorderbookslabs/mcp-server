# PolyOrderbooks MCP Server

Historical Polymarket **order book depth** for Claude, Cursor and any other MCP
client — full L2 bid and ask ladders at 250ms resolution, with resolved
outcomes attached.

[![npm](https://img.shields.io/npm/v/@polyorderbooks/mcp-server)](https://www.npmjs.com/package/@polyorderbooks/mcp-server)

Polymarket's own API serves price history well. It does **not** archive order
book depth at any granularity — `/book` returns the current state and nothing
stores it. This server exposes depth that was captured live, which is the part
that cannot be recovered after the fact.

---

## Install

Nothing to install. Add it to your MCP client config and it runs via `npx`.

**Claude Desktop** — `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "polyorderbooks": {
      "command": "npx",
      "args": ["-y", "@polyorderbooks/mcp-server"],
      "env": { "POLYORDERBOOKS_API_KEY": "pob_..." }
    }
  }
}
```

**Cursor** — `.cursor/mcp.json`, same shape.

Restart the client after editing the config; MCP servers are started at launch.

---

## Getting an API key

1. Sign up at [polyorderbooks.com/signup](https://polyorderbooks.com/signup). No
   card is required.
2. Open the dashboard and create a key. It looks like `pob_` followed by a long
   random string.
3. Put it in the `env` block of your MCP client config, as above.

The free **Starter** plan queries at **250ms resolution** — the same as the
paid plans. What the paid plans add is a longer history window and a higher
request allowance, not finer data. Starter is enough to answer a real question
before you decide whether to pay for anything.

Call the `get_usage` tool at any time to see the plan, limits and remaining
allowance on the key you configured.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `POLYORDERBOOKS_API_KEY` | yes | Your API key. The server exits at startup if this is missing, rather than failing later on the first tool call. |
| `POLYORDERBOOKS_BASE_URL` | no | Overrides the API base URL. Defaults to `https://api.polyorderbooks.com`. Only needed for a self-hosted or staging deployment. |

Set these in the MCP client config, **not** in your shell. A client launches the
server as a subprocess and does not pass your interactive shell environment to
it, so a key exported in `.zshrc` will not be visible to the server.

---

## Tools

| Tool | What it does |
| --- | --- |
| `search_series` | Recurring families — `btc-up-or-down-5m` is every BTC 5-minute round. |
| `search_events` | Groups of markets that resolve together. |
| `search_markets` | Individual markets by keyword or date range. |
| `get_market` | One market in full, including outcome tokens and the winner. |
| `get_order_book_history` | L2 ladders over time. The thing Polymarket does not archive. |
| `get_price_history` | Price series per outcome token. |
| `get_market_metrics` | Spread, liquidity and volume as a time series. |
| `get_usage` | Plan, rate limits and quota. |

The catalogue is **series → events → markets**. Ask for a kind of market with
`search_series`, a set that resolves together with `search_events`, and a
specific one with `search_markets`.

---

## Things worth knowing before you interpret the data

**Books go one-sided as markets resolve.** In the final minute of a 5-minute
market, **76% of snapshots have an empty bid or ask side** — nobody offers the
losing outcome. This is real market behaviour, not missing data, and it breaks
analysis that assumes two-sided books.

**Contract length changes everything.** A 4-hour contract is one-sided 0.5% of
the time; a 5-minute contract, 17%. Conclusions from one do not transfer to the
other.

**Responses get large quickly.** An hour at 250ms resolution is 14,400 buckets
per token, and a market has two. Keep windows narrow or resolution coarse, and
page with the returned `next_cursor`.

---

## Example prompts

> Find BTC 5-minute markets that resolved yesterday and show me how the order
> book depth changed in the final two minutes before settlement.

> For this market, what would a 100-share buy have cost against the actual ladder
> five seconds before close, versus the midpoint at that moment?

> Compare spread and liquidity across 5-minute, 15-minute and 4-hour BTC
> contracts over the last day.

The second one is the point of L2 data. A price series tells you where the market
was; only the ladder tells you what you could have traded at.

---

## How this differs from other Polymarket MCP servers

Several good ones exist — [kukapay/polymarket-predictions-mcp](https://github.com/kukapay/polymarket-predictions-mcp),
[demwick/polymarket-agent-mcp](https://github.com/demwick/polymarket-agent-mcp),
[PaulieB14/graph-polymarket-mcp](https://github.com/PaulieB14/graph-polymarket-mcp).
They wrap Polymarket's own Gamma and CLOB APIs and do it well.

| | Those | This one |
| --- | --- | --- |
| Live odds and current book | yes | no |
| Placing trades | some | no |
| Market metadata and resolution | yes | yes |
| Price history | 1-minute, from Polymarket | 250ms |
| **Historical order book depth** | **not available** | **yes** |

The difference is structural rather than a matter of effort. Polymarket's `/book`
endpoint returns the present state and nothing archives it, so no server built on
that API can serve yesterday's ladders. This one reads an archive that was
captured live.

If you want to trade, or want live odds, use one of theirs — they cover that
better. Use this when the question is about what the book looked like at a
specific past moment.

---

## Troubleshooting

**"POLYORDERBOOKS_API_KEY is not set"** — the key is missing. It goes in the `env`
block of the client config, not your shell. See
[Environment variables](#environment-variables).

**Authentication failed** — the key reached the server but the API rejected it.
Keys start with `pob_`; check for a trailing newline or a stray quote if you
pasted from a terminal. If it looks right, call `get_usage` to confirm the key is
active.

**Responses truncated or slow** — an hour at 250ms resolution is 14,400 buckets
per token, and a market has two. Narrow the window, or use `resolution: "1m"` and
page with `next_cursor`.

**Empty ladders** — expected near settlement. See the note above on one-sided
books.

---

## Open data

897,192 snapshots across 805 resolved markets and three contract lengths are
published under CC BY 4.0 with a DOI, no signup:

[doi.org/10.5281/zenodo.22084114](https://doi.org/10.5281/zenodo.22084114)

Useful for checking the properties above yourself before relying on the API.

---

## Development

```bash
npm install
npm run build
POLYORDERBOOKS_API_KEY=pob_... npm run dev
```

The server speaks stdio. To exercise it without an MCP client, send JSON-RPC on
stdin — `initialize`, then `tools/list`, then `tools/call`.

---

## Links

- [polyorderbooks.com](https://polyorderbooks.com) — the API
- [docs.polyorderbooks.com](https://docs.polyorderbooks.com) — reference
- [Python client](https://pypi.org/project/polyorderbooks/) — `pip install polyorderbooks`
- [Free BTC sample](https://polyorderbooks.com/datasets/polymarket-btc-5min-orderbook-sample) — one market, no signup

## Licence

MIT. Not affiliated with, endorsed by, or connected to Polymarket.
