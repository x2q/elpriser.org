// POST https://elpriser.org/mcp — the remote MCP server. Everything is in _mcp.js (an underscore keeps that file out of the routes).
import { handleMcp } from './_mcp.js';
export const onRequest = handleMcp;
