# lovable-agent-mcp-server

Multi-agent MCP server that orchestrates a team of AI specialists (Frontend, Backend, Designer, DevOps, QA) to build SaaS apps on Lovable — from a single PRD in any format.

## Architecture

```
User (PRD) → Claude → Your MCP Server → mcp.lovable.dev → Lovable Project
                            ↓
                    Manager Agent (Claude)
                    ├── Frontend Agent
                    ├── Backend Agent
                    ├── Designer Agent
                    ├── DevOps Agent
                    └── QA Agent
                            ↓
                    Postgres (Context Manager)
```

## Tools

| Tool | Description |
|------|-------------|
| `manager_parse_prd` | Parses a PRD (text/markdown/JSON) and creates a multi-agent task plan |
| `manager_get_plan` | Returns the current task plan and status |
| `agent_execute_task` | Activates a specialist agent to generate a Lovable prompt |
| `project_get_context` | Returns full project context and event history |
| `project_update_task_status` | Updates task status after Lovable execution |

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

```env
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgresql://user:pass@host:5432/db
TRANSPORT=http        # or stdio for local dev
PORT=3000
```

### 3. Build and run

```bash
npm run build
npm start
```

### 4. Local development (stdio)

```bash
TRANSPORT=stdio npm start
```

## Deploy to Railway

1. Push to GitHub
2. Connect repo to Railway
3. Add environment variables
4. Railway auto-deploys on push

Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "lovable-agent": {
      "url": "https://your-app.railway.app/mcp"
    }
  }
}
```

## Usage example

```
User: Build a SaaS invoicing app with auth, dashboard and PDF export

Claude calls: manager_parse_prd({ prd: "..." })
→ Returns TaskPlan with 7 tasks assigned to designer, backend, frontend, devops, qa

Claude calls: agent_execute_task({ project_id: "proj_abc", task_id: "t1" })
→ Returns Lovable prompt from Designer Agent

Claude sends prompt to mcp.lovable.dev → Lovable builds design system

Claude calls: project_update_task_status({ ..., status: "done" })
→ Moves to next task
```

## Tech stack

- Node.js + TypeScript
- `@modelcontextprotocol/sdk` — MCP server
- `@anthropic-ai/sdk` — Claude API (Manager + Specialist Agents)
- `pg` — Postgres (Context Manager)
- `express` — HTTP transport
- `zod` — Input validation
