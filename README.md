# postgres-mcp-server

An MCP (Model Context Protocol) server that lets Claude query, manipulate, and **audit** a PostgreSQL database using natural language — including a full ad-spend waste auditing toolkit for marketing/growth use cases.

Built with TypeScript, the official MCP SDK, and `pg`. Exposes a Streamable HTTP endpoint so it can be used remotely or locally with Claude Desktop / Claude Code.

---

## ✨ What it does

### Generic database access

- *"What tables do I have?"*
- *"Show me the last 10 rows from orders"*
- *"Insert a new user with email test@example.com"*
- *"Update order 42 to status shipped"*
- *"Delete all sessions where status = expired"*

### Ad spend waste auditing (Google Ads / Meta Ads / any Windsor.ai source)

- *"Audit my ad account for wasted spend in the last 30 days"*
- *"Show me the daily history for that keyword that got flagged"*
- *"If I pause these 7 entities, how much budget do I free up per month?"*
- *"Pause that audience, it's burned €1,400 with zero conversions"*

This module models the kind of data Windsor.ai (or a direct Google Ads / Meta Ads API
integration) would expose: campaigns, ad entities (keywords, audiences, creatives,
ad groups), and daily performance metrics. It then layers an **audit + simulate + act**
workflow on top — moving beyond dashboards and CSV exports toward a system that
reasons about where budget is being wasted and what to do about it.

---

## 🛠️ Tools

### Database (generic)

| Tool | Description |
|------|-------------|
| `list_tables` | List all tables in the `public` schema |
| `describe_table` | Show columns, types, nullability and defaults for a table |
| `select_rows` | SELECT rows with optional `WHERE` clause and limit |
| `insert_row` | INSERT a row, returns the inserted record |
| `update_rows` | UPDATE rows matching a `WHERE` clause |
| `delete_rows` | DELETE rows matching a `WHERE` clause |

### Ad waste auditing

| Tool | Description |
|------|-------------|
| `audit_account_waste` | Scans all campaigns/entities over N days, flags wasted spend (zero conversions or CPA far above account average), returns a prioritized report with total € wasted and % of account spend |
| `get_waste_detail` | Day-by-day breakdown for a single entity (keyword, audience, creative, ad group) — why it was flagged |
| `simulate_reallocation` | **Read-only**: projects how much budget would be freed (daily/monthly) and how many conversions would be lost if given entities were paused — run before acting |
| `pause_entity` | **Action**: pauses a specific entity, requires a `reason` for audit-trail purposes |

---

## 📊 Example: audit output

```
Audit of the last 30 days:
Total spend: €18,255.84 | Waste detected: €10,705.63 (58.6%)

7 entities flagged, mostly in "Search - Generic EdTech" (Google Ads):

| Entity                              | Type     | Platform   | Spend     | Conversions | CPA       | Reason            |
|--------------------------------------|----------|------------|-----------|-------------|-----------|-------------------|
| edtech tools 2026                    | keyword  | google_ads | €1,570.48 | 0           | —         | 0 conversions     |
| online learning platform             | keyword  | google_ads | €1,566.00 | 4           | €391.50   | 17x avg CPA       |
| best lms software                    | keyword  | google_ads | €1,514.33 | 1           | €1,514.33 | 65.7x avg CPA     |
...

Account average CPA: €23.05
```

The campaign "Search - Generic EdTech" concentrates 5 of 7 issues — broad-match
keywords pulling in unqualified traffic. This is exactly the kind of diagnosis a
media buyer would normally surface manually after hours of dashboard digging.

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

## 🗄️ Ad audit data model

The ad-audit tools expect three tables (see `src/ads-audit.ts` for the queries):

```sql
CREATE TYPE ad_platform AS ENUM ('google_ads', 'meta_ads');
CREATE TYPE entity_type AS ENUM ('campaign', 'ad_group', 'keyword', 'audience', 'creative');
CREATE TYPE entity_status AS ENUM ('active', 'paused');

CREATE TABLE ad_campaigns (
  id serial PRIMARY KEY,
  platform ad_platform NOT NULL,
  name text NOT NULL,
  daily_budget_cents integer NOT NULL,
  status entity_status NOT NULL DEFAULT 'active',
  objective text
);

CREATE TABLE ad_entities (
  id serial PRIMARY KEY,
  campaign_id integer REFERENCES ad_campaigns(id),
  entity_type entity_type NOT NULL,
  name text NOT NULL,
  status entity_status NOT NULL DEFAULT 'active'
);

CREATE TABLE ad_metrics_daily (
  id serial PRIMARY KEY,
  entity_id integer REFERENCES ad_entities(id),
  date date NOT NULL,
  impressions integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  spend_cents integer NOT NULL DEFAULT 0,
  conversions integer NOT NULL DEFAULT 0
);
```

In production this would be populated by a Windsor.ai sync (or direct platform APIs)
rather than seeded manually — the tools are platform-agnostic as long as this shape
is maintained.

---

## 🔌 Connect to Claude

### Claude Desktop / Claude Code

Add to your MCP config:

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

Restart Claude and start asking questions in plain language.

---

## 🧪 Test it manually

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Should return all 10 available tools.

---

## ⚠️ Notes

- This server gives Claude **read and write access** to your database. Use a dedicated database/user with restricted permissions for production use.
- `update_rows` and `delete_rows` accept raw SQL `WHERE` clauses — be careful when granting access to untrusted clients.
- `pause_entity` is an **action tool** that mutates state. The recommended flow is:
  `audit_account_waste` → `get_waste_detail` (optional) → `simulate_reallocation` → `pause_entity`.

---

## 🏗️ Built with

- [Model Context Protocol SDK](https://modelcontextprotocol.io)
- [node-postgres (pg)](https://node-postgres.com/)
- TypeScript + Express

---

## Author

Built by **Santi** — SaaS builder, EdTech & GovTech.
