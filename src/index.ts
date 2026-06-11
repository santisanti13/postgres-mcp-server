import express, { Request, Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { Pool } from 'pg';
import { ADS_AUDIT_TOOLS, handleAdsAuditTool } from './ads-audit.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/mcp_demo';
const PORT = 3000;

const pool = new Pool({ connectionString: DATABASE_URL });

// Validate and double-quote a SQL identifier to prevent injection
function quoteIdent(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid identifier: "${name}"`);
  }
  return `"${name}"`;
}

const TOOLS: Tool[] = [
  {
    name: 'list_tables',
    description: 'List all user tables in the public schema',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'describe_table',
    description: 'Show column names, data types, nullability and defaults for a table',
    inputSchema: {
      type: 'object',
      properties: { table: { type: 'string', description: 'Table name' } },
      required: ['table'],
    },
  },
  {
    name: 'select_rows',
    description: 'SELECT rows from a table with an optional WHERE clause and row limit',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table name' },
        where: { type: 'string', description: 'SQL WHERE clause without the WHERE keyword, e.g. "id = 1"' },
        limit: { type: 'number', description: 'Maximum rows to return (default 100, max 1000)' },
      },
      required: ['table'],
    },
  },
  {
    name: 'insert_row',
    description: 'INSERT a single row into a table and return the inserted record',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table name' },
        data: { type: 'object', description: 'Column-value pairs to insert' },
      },
      required: ['table', 'data'],
    },
  },
  {
    name: 'update_rows',
    description: 'UPDATE rows matching a WHERE clause and return affected records',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table name' },
        data: { type: 'object', description: 'Column-value pairs to set' },
        where: { type: 'string', description: 'SQL WHERE clause without the WHERE keyword, e.g. "id = 5"' },
      },
      required: ['table', 'data', 'where'],
    },
  },
  {
    name: 'delete_rows',
    description: 'DELETE rows matching a WHERE clause and return the deleted records',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table name' },
        where: { type: 'string', description: 'SQL WHERE clause without the WHERE keyword, e.g. "id = 5"' },
      },
      required: ['table', 'where'],
    },
  },
  ...ADS_AUDIT_TOOLS,
];

type Args = Record<string, unknown>;

const ADS_AUDIT_TOOL_NAMES = new Set(ADS_AUDIT_TOOLS.map((t) => t.name));

async function handleTool(name: string, args: Args): Promise<string> {
  if (ADS_AUDIT_TOOL_NAMES.has(name)) {
    return handleAdsAuditTool(pool, name, args);
  }

  switch (name) {
    case 'list_tables': {
      const { rows } = await pool.query(
        `SELECT table_name, table_type
         FROM information_schema.tables
         WHERE table_schema = 'public'
         ORDER BY table_name`
      );
      return JSON.stringify(rows, null, 2);
    }

    case 'describe_table': {
      const table = args.table as string;
      const { rows } = await pool.query(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position`,
        [table]
      );
      return JSON.stringify(rows, null, 2);
    }

    case 'select_rows': {
      const table = args.table as string;
      const where = args.where as string | undefined;
      const limit = Math.min(Number(args.limit ?? 100), 1000);
      const ident = quoteIdent(table);
      let sql = `SELECT * FROM ${ident}`;
      if (where) sql += ` WHERE ${where}`;
      sql += ` LIMIT $1`;
      const { rows } = await pool.query(sql, [limit]);
      return JSON.stringify(rows, null, 2);
    }

    case 'insert_row': {
      const table = args.table as string;
      const data = args.data as Record<string, unknown>;
      const ident = quoteIdent(table);
      const keys = Object.keys(data);
      if (keys.length === 0) throw new Error('data must contain at least one field');
      const cols = keys.map(quoteIdent).join(', ');
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
      const values = keys.map(k => data[k]);
      const { rows } = await pool.query(
        `INSERT INTO ${ident} (${cols}) VALUES (${placeholders}) RETURNING *`,
        values
      );
      return JSON.stringify(rows[0], null, 2);
    }

    case 'update_rows': {
      const table = args.table as string;
      const data = args.data as Record<string, unknown>;
      const where = args.where as string;
      const ident = quoteIdent(table);
      const keys = Object.keys(data);
      if (keys.length === 0) throw new Error('data must contain at least one field');
      const setClause = keys.map((k, i) => `${quoteIdent(k)} = $${i + 1}`).join(', ');
      const values = keys.map(k => data[k]);
      const result = await pool.query(
        `UPDATE ${ident} SET ${setClause} WHERE ${where} RETURNING *`,
        values
      );
      return `Updated ${result.rowCount ?? 0} row(s).\n${JSON.stringify(result.rows, null, 2)}`;
    }

    case 'delete_rows': {
      const table = args.table as string;
      const where = args.where as string;
      const ident = quoteIdent(table);
      const result = await pool.query(
        `DELETE FROM ${ident} WHERE ${where} RETURNING *`
      );
      return `Deleted ${result.rowCount ?? 0} row(s).\n${JSON.stringify(result.rows, null, 2)}`;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function createServer(): Server {
  const server = new Server(
    { name: 'postgres-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      const text = await handleTool(name, args as Args);
      return { content: [{ type: 'text', text }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  });

  return server;
}

const app = express();
app.use(express.json());

app.post('/mcp', async (req: Request, res: Response) => {
  // Stateless mode: one transport + server instance per request
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createServer();
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP request error:', err);
    if (!res.headersSent) res.status(500).json({ error: String(err) });
  }
});

const httpServer = app.listen(PORT, () => {
  console.log(`Postgres MCP server → http://localhost:${PORT}/mcp`);
  console.log(`DATABASE_URL: ${DATABASE_URL}`);
});

process.on('SIGINT', async () => {
  await pool.end();
  httpServer.close();
  process.exit(0);
});
