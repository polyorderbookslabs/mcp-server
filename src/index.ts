#!/usr/bin/env node
/**
 * MCP server for PolyOrderbooks — historical Polymarket order books, prices and
 * liquidity at 1-second resolution.
 *
 * Six tools rather than one per endpoint. A model works better with a few
 * task-shaped tools it can reason about than eleven thin HTTP wrappers, and the
 * descriptions carry the things that are not obvious from a schema: that order
 * book depth is forward-only, that binary markets go one-sided as they resolve,
 * and that a wide window at 1-second resolution returns an enormous amount.
 */
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

import { PolyOrderbooksClient, describeError } from './client.js';

const VERSION = '0.2.3';

const apiKey = process.env.POLYORDERBOOKS_API_KEY;
if (!apiKey) {
    console.error(
        'POLYORDERBOOKS_API_KEY is not set.\n' +
            'Get a free key at https://polyorderbooks.com/signup and set it in your MCP client config.'
    );
    process.exit(1);
}

const api = new PolyOrderbooksClient(apiKey);

/** Every tool returns text; wrapping keeps the error path identical across all six. */
async function run(fn: () => Promise<unknown>) {
    try {
        const data = await fn();
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
        return {
            content: [{ type: 'text' as const, text: describeError(err) }],
            isError: true
        };
    }
}

const isoTime = z
    .string()
    .describe('ISO-8601 UTC, e.g. 2026-08-23T14:00:00Z');

const resolution = z
    .enum(['1s', '5s', '15s', '1m', '5m', '15m', '1h', '1d'])
    .describe(
        'Bucket size. 1s is the finest and is available on every plan including the free tier. ' +
            'Prefer 1m or coarser unless the question genuinely needs sub-minute detail — a day at 1s is 86,400 buckets.'
    );

export function createServer(): McpServer {
    const server = new McpServer({ name: 'polyorderbooks', version: VERSION });

    server.registerTool(
        'search_markets',
        {
            title: 'Search Polymarket markets',
            description:
                'Find Polymarket markets by keyword. Start here — the other tools need a market slug, and slugs are not guessable. ' +
                'Coverage spans Polymarket crypto and sports markets: crypto up/down contracts at 5m, 15m and 4h, price thresholds like "bitcoin-above-80k", and related event markets, plus sports markets. ' +
                'Pass category=crypto or category=sports to pin a search to one archive; omit it to search both. ' +
                'Resolved markets are excluded unless include_closed is true, which is usually what you want for historical analysis. ' +
                'For a whole family of markets rather than one, search_series is more reliable than guessing slug patterns here.',
            inputSchema: z.object({
                search: z
                    .string()
                    .optional()
                    .describe('Substring matched against slug and question, e.g. "btc-updown" or "bitcoin-above"'),
                include_closed: z
                    .boolean()
                    .optional()
                    .describe('Include markets that have already resolved. Set true for historical work.'),
                end_date_min: z.string().optional().describe('ISO-8601, markets ending at or after this'),
                end_date_max: z.string().optional().describe('ISO-8601, markets ending at or before this'),
                category: z
                    .enum(['crypto', 'sports'])
                    .optional()
                    .describe('"crypto" or "sports". Omit to search both archives merged by updated_at.'),
                limit: z.number().int().min(1).max(100).optional().describe('Default 20')
            })
        },
        async ({ search, include_closed, end_date_min, end_date_max, category, limit }) =>
            run(() =>
                api.get('/v1/markets', {
                    search,
                    include_closed,
                    end_date_min,
                    end_date_max,
                    category,
                    limit: limit ?? 20
                })
            )
    );

    server.registerTool(
        'search_series',
        {
            title: 'Search recurring market series',
            description:
                'A series is a recurring family of markets — "btc-up-or-down-5m" is every BTC 5-minute up/down contract ever created. ' +
                'Use this when the question is about a kind of market rather than a specific one: it is more reliable than guessing at slug ' +
                'patterns with search_markets. Take the series slug, then use search_events to find its individual rounds.',
            inputSchema: z.object({
                search: z.string().optional().describe('Substring, e.g. "btc-up-or-down" or "solana"'),
                category: z
                    .enum(['crypto', 'sports'])
                    .optional()
                    .describe('"crypto" or "sports". Omit to search both archives merged by updated_at.'),
                limit: z.number().int().min(1).max(100).optional().describe('Default 20')
            })
        },
        async ({ search, category, limit }) =>
            run(() => api.get('/v1/series', { search, category, limit: limit ?? 20 }))
    );

    server.registerTool(
        'search_events',
        {
            title: 'Search events',
            description:
                'An event groups markets that resolve together — "what-price-will-solana-hit-august-17-23-2026" holds every price threshold ' +
                'for that week, and "btc-updown-5m-1787685000" is one 5-minute round. Use this to find the set of related markets to compare, ' +
                'then search_markets to get the markets themselves. Date filters are useful here: events carry an end_date.',
            inputSchema: z.object({
                search: z.string().optional().describe('Substring matched against slug and title'),
                end_date_min: z.string().optional().describe('ISO-8601, events ending at or after this'),
                end_date_max: z.string().optional().describe('ISO-8601, events ending at or before this'),
                category: z
                    .enum(['crypto', 'sports'])
                    .optional()
                    .describe('"crypto" or "sports". Omit to search both archives merged by updated_at.'),
                limit: z.number().int().min(1).max(100).optional().describe('Default 20')
            })
        },
        async ({ search, end_date_min, end_date_max, category, limit }) =>
            run(() =>
                api.get('/v1/events', { search, end_date_min, end_date_max, category, limit: limit ?? 20 })
            )
    );

    server.registerTool(
        'get_market',
        {
            title: 'Get one market',
            description:
                'Full detail for a single market by slug or id, including its outcome tokens, resolution status and winning outcome. ' +
                'Use this to get token ids before calling the token-level tools.',
            inputSchema: z.object({
                id_or_slug: z.string().describe('Market slug, e.g. btc-updown-5m-1787551200')
            })
        },
        async ({ id_or_slug }) => run(() => api.get(`/v1/markets/${encodeURIComponent(id_or_slug)}`))
    );

    server.registerTool(
        'get_order_book_history',
        {
            title: 'Historical order book depth',
            description:
                'Full L2 bid and ask ladders over time for a market — every price level and the size resting at each. ' +
                'This is data Polymarket does not archive: its /book endpoint returns only the current state, so depth exists only where it was captured live.\n\n' +
                'One thing to expect when reading the results: binary markets go one-sided as they resolve. In the final minute of a 5-minute market most ' +
                'snapshots have an empty bid or ask side, because nobody offers the losing outcome. That is real market behaviour rather than missing data, ' +
                'so guard before indexing the first level of a ladder.\n\n' +
                'Responses are large. Keep the window narrow or the resolution coarse: a one-hour window at 1s is 3,600 buckets per token, and a market has two tokens.',
            inputSchema: z.object({
                id_or_slug: z.string().describe('Market slug, e.g. btc-updown-5m-1787551200'),
                start_ts: isoTime,
                end_ts: isoTime,
                resolution: resolution.optional().describe('Defaults to 1m. Use 1s only for short windows.'),
                limit: z
                    .number()
                    .int()
                    .min(1)
                    .max(200)
                    .optional()
                    .describe('Buckets per page, default 50. Use the returned next_cursor to page.'),
                cursor: z.string().optional().describe('next_cursor from a previous response')
            })
        },
        async ({ id_or_slug, start_ts, end_ts, resolution: res, limit, cursor }) =>
            run(() =>
                api.get(`/v1/markets/${encodeURIComponent(id_or_slug)}/books`, {
                    start_ts,
                    end_ts,
                    resolution: res ?? '1m',
                    limit: limit ?? 50,
                    cursor
                })
            )
    );

    server.registerTool(
        'get_price_history',
        {
            title: 'Historical prices',
            description:
                'Price series per outcome token over time. Prices are probabilities in [0, 1].\n\n' +
                'Polymarket serves its own price history down to 1-minute buckets and that is free — use this tool when you need finer than a minute, ' +
                'or when you want prices aligned to the same timeline as order book depth. For 1-minute or coarser history alone, Polymarket\'s public API is equivalent.',
            inputSchema: z.object({
                id_or_slug: z.string().describe('Market slug'),
                start_ts: isoTime,
                end_ts: isoTime,
                resolution: resolution.optional().describe('Defaults to 1m'),
                // The API caps this at 200 and rejects more with a 400.
                limit: z.number().int().min(1).max(200).optional().describe('Default 100, max 200'),
                cursor: z.string().optional()
            })
        },
        async ({ id_or_slug, start_ts, end_ts, resolution: res, limit, cursor }) =>
            run(() =>
                api.get(`/v1/markets/${encodeURIComponent(id_or_slug)}/prices`, {
                    start_ts,
                    end_ts,
                    resolution: res ?? '1m',
                    limit: limit ?? 100,
                    cursor
                })
            )
    );

    server.registerTool(
        'get_market_metrics',
        {
            title: 'Spread and liquidity over time',
            description:
                'Derived market quality metrics — spread, liquidity and volume — as a time series. ' +
                'Cheaper than pulling full order books when the question is about market quality rather than specific price levels. ' +
                'Note that spread is only meaningful while both sides of the book are populated, which stops being true near settlement.',
            inputSchema: z.object({
                id_or_slug: z.string().describe('Market slug'),
                start_ts: isoTime,
                end_ts: isoTime,
                resolution: resolution.optional().describe('Defaults to 1m'),
                // The API caps this at 200 and rejects more with a 400.
                limit: z.number().int().min(1).max(200).optional().describe('Default 100, max 200'),
                cursor: z.string().optional()
            })
        },
        async ({ id_or_slug, start_ts, end_ts, resolution: res, limit, cursor }) =>
            run(() =>
                api.get(`/v1/markets/${encodeURIComponent(id_or_slug)}/metrics`, {
                    start_ts,
                    end_ts,
                    resolution: res ?? '1m',
                    limit: limit ?? 100,
                    cursor
                })
            )
    );

    server.registerTool(
        'get_usage',
        {
            title: 'Plan and quota',
            description:
                'Current plan, rate limits, history window and requests used. Call this when a request fails with a limit error, ' +
                'or before planning a large extraction, to see what the key is allowed to do.',
            inputSchema: z.object({})
        },
        async () => run(() => api.get('/v1/usage'))
    );

    return server;
}

await serveStdio(createServer);
