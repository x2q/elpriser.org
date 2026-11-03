// GET https://elpriser.org/.well-known/mcp/server-card.json — the same card at the well-known path early drafts used.
import { serveDocument, SERVER_CARD } from '../../_mcp.js';
export const onRequest = ({ request }) => serveDocument(request, SERVER_CARD, 'application/json; charset=utf-8');
