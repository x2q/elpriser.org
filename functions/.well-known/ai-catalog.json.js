// GET https://elpriser.org/.well-known/ai-catalog.json — the AI Catalog that points clients at the MCP Server Card (domain-level discovery).
import { serveDocument, AI_CATALOG } from '../_mcp.js';
export const onRequest = ({ request }) => serveDocument(request, AI_CATALOG, 'application/ai-catalog+json; charset=utf-8');
