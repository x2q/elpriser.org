// GET https://elpriser.org/mcp/server-card — the MCP Server Card (SEP-2127), at the location it recommends: <endpoint>/server-card.
import { serveDocument, SERVER_CARD } from '../_mcp.js';
export const onRequest = ({ request }) => serveDocument(request, SERVER_CARD, 'application/mcp-server-card+json; charset=utf-8');
