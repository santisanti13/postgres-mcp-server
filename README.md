# postgres-mcp-server

An MCP (Model Context Protocol) server that lets Claude query and manipulate a PostgreSQL database using natural language.

## Architecture

```
User (natural language) → Claude → Your MCP Server → PostgreSQL
                                          │
                                    pool.query()
                                          │
                                  information_schema
                                  + your tables
```

Claude never talks to Postgres directly. It calls a tool (e.g. `select_rows`),
the MCP server validates and parameterizes the request, runs it against
`pg`, and returns the result as text Claude can reason about and present back
to the user.

## Tools

| Tool | Description |
|------|-------------|
| `list_tables` | List all tables in the `public` schema |
| `describe_table` | Show columns, types, nullability and defaults for a table |
| `select_rows` | SELECT rows with optional `WHERE` clause and limit |
| `insert_row` | INSERT a row, returns the inserted record |
| `update_rows` | UPDATE rows matching a `WHERE` clause |
| `delete_rows` | DELETE rows matching a `WHERE` clause |

## Setup

### 1. Install dependencies

```bash
git clone https://github.com/santisanti13/postgres-mcp-server.git
cd postgres-mcp-server
npm install
```

### 2. Environment variables

```env
DATABASE_URL=postgresql://user:pass@host:5432/db
PORT=3000
```

### 3. Build and run

```bash
npm run build
npm start
```

The server starts at `http://localhost:3000/mcp`.

## Connect to Claude

Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3000/mcp"]
    }
  }
}
```

## Usage example

```
User: What tables do I have, and show me the last 5 rows of "orders"

Claude calls: list_tables({})
→ Returns: ["customers", "orders", "products", ...]

Claude calls: select_rows({ table: "orders", limit: 5, order_by: "created_at desc" })
→ Returns: [{ id: 102, customer_id: 7, total_cents: 4900, ... }, ...]

Claude presents the results as a formatted table.
```

```
User: Mark order 42 as shipped

Claude calls: update_rows({
  table: "orders",
  data: { status: "shipped" },
  where: "id = 42"
})
→ Returns: "Updated 1 row(s)."
```

## Tech stack

- Node.js + TypeScript
- `@modelcontextprotocol/sdk` — MCP server
- `pg` — PostgreSQL client
- `express` — HTTP transport (Streamable HTTP)

## Notes

- This server gives Claude **read and write access** to your database. Use a dedicated database/user with restricted permissions for production use.
- `update_rows` and `delete_rows` accept raw SQL `WHERE` clauses — be careful when granting access to untrusted clients.

## Related projects

- [`ads-waste-auditor-mcp`](https://github.com/santisanti13/ads-waste-auditor-mcp) — a companion MCP that audits ad spend (Google Ads / Meta Ads via Windsor.ai) for wasted budget, simulates reallocation, and pauses underperforming entities.

## About

mcp conversational inputs & outputs over PostgreSQL.

## Author

Built by **Santi** — SaaS builder, EdTech & GovTech.
