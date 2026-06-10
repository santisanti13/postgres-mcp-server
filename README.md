# postgres-mcp-server

An MCP (Model Context Protocol) server that lets Claude query and manipulate a PostgreSQL database using natural language.

Built with TypeScript, the official MCP SDK, and `pg`. Exposes a Streamable HTTP endpoint so it can be used remotely or locally with Claude Desktop / Claude Code.

---

## ✨ What it does

Once connected, you can ask Claude things like:

- *"What tables do I have?"*
- *"Show me the last 10 rows from orders"*
- *"Insert a new user with email test@example.com"*
- *"Update order 42 to status shipped"*
- *"Delete all sessions where status = expired"*

---

## 🛠️ Tools

| Tool | Description |
|------|-------------|
| `list_tables` | List all tables in the `public` schema |
| `describe_table` | Show columns, types, nullability and defaults for a table |
| `select_rows` | SELECT rows with optional `WHERE` clause and limit |
| `insert_row` | INSERT a row, returns the inserted record |
| `update_rows` | UPDATE rows matching a `WHERE` clause |
| `delete_rows` | DELETE rows matching a `WHERE` clause |

---

## 🚀 Setup

### 1. Clone and install

```bash
git clone https://github.com/santisanti13/postgres-mcp-server.git
cd postgres-mcp-server
npm install
```

### 2. Configure your database

Set the `DATABASE_URL` environment variable to point to your Postgres instance:

```bash
export DATABASE_URL=postgresql://localhost/your_database
```

### 3. Build and run

```bash
npm run build
DATABASE_URL=postgresql://localhost/your_database npm start
```

The server starts at `http://localhost:3000/mcp`.

---

## 🔌 Connect to Claude

### Claude Desktop / Claude Code

Add to your MCP config:

```json
{
  "mcpServers": {
    "postgres": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Restart Claude and start asking questions about your database in plain language.

---

## 🧪 Test it manually

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Should return the list of available tools.

---

## ⚠️ Notes

- This server gives Claude **read and write access** to your database. Use a dedicated database/user with restricted permissions for production use.
- `update_rows` and `delete_rows` accept raw SQL `WHERE` clauses — be careful when granting access to untrusted clients.

---

## 🏗️ Built with

- [Model Context Protocol SDK](https://modelcontextprotocol.io)
- [node-postgres (pg)](https://node-postgres.com/)
- TypeScript + Express

---

## Author

Built by **Santi** — SaaS builder, EdTech & GovTech.
