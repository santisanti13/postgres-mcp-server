import { Pool } from 'pg';
import { Tool } from '@modelcontextprotocol/sdk/types.js';

// ─── Tool definitions ──────────────────────────────────────────────────────

export const ADS_AUDIT_TOOLS: Tool[] = [
  {
    name: 'audit_account_waste',
    description: `Audit the entire ad account for wasted spend.

Scans all entities (keywords, audiences, creatives, ad groups) across all campaigns
over the last N days. Flags any entity whose spend exceeds a threshold while
generating zero (or near-zero) conversions, or whose CPA is far above the account average.

Returns a prioritized list ordered by wasted spend (highest first), plus the
total amount wasted and what % of total account spend that represents.

Args:
  - days (number, optional): Lookback window in days. Default 30.
  - min_spend_cents (number, optional): Minimum total spend (in cents) for an entity
    to be considered. Default 5000 (€50).
  - max_conversions (number, optional): Entities with conversions <= this are flagged. Default 0.
  - cpa_multiplier (number, optional): Also flag entities whose CPA is greater than
    this multiple of the account average CPA. Default 3.

Examples:
  - "Audit my ad account for wasted spend in the last 30 days" → no args
  - "Find anything that's burned more than 100€ with zero conversions in the last 2 weeks"
    → days=14, min_spend_cents=10000, max_conversions=0`,
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Lookback window in days (default 30)' },
        min_spend_cents: { type: 'number', description: 'Minimum spend in cents to consider (default 5000)' },
        max_conversions: { type: 'number', description: 'Conversions <= this are flagged (default 0)' },
        cpa_multiplier: { type: 'number', description: 'Flag if CPA > multiplier × account avg CPA (default 3)' },
      },
      required: [],
    },
  },
  {
    name: 'get_waste_detail',
    description: `Get a detailed daily breakdown for a single ad entity (keyword, audience, creative, ad group).

Use after audit_account_waste to drill into why a specific entity was flagged —
shows day-by-day spend, clicks, impressions and conversions, plus the parent campaign info.

Args:
  - entity_id (number): The entity ID, from audit_account_waste results
  - days (number, optional): How many days of history to show. Default 30.

Examples:
  - "Show me the daily history for entity 6" → entity_id=6`,
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'number', description: 'Entity ID to inspect' },
        days: { type: 'number', description: 'Days of history (default 30)' },
      },
      required: ['entity_id'],
    },
  },
  {
    name: 'simulate_reallocation',
    description: `Simulate the budget impact of pausing one or more entities, WITHOUT making any changes.

Calculates how much daily/monthly spend would be freed up if the given entities
were paused, based on their average daily spend over the last N days. Use this
BEFORE calling pause_entity to show the projected impact.

Args:
  - entity_ids (array of numbers): Entities to simulate pausing
  - days (number, optional): Lookback window for averaging spend. Default 30.

Examples:
  - "If I pause entities 3, 6 and 7, how much budget do I free up?" → entity_ids=[3,6,7]`,
    inputSchema: {
      type: 'object',
      properties: {
        entity_ids: { type: 'array', items: { type: 'number' }, description: 'Entity IDs to simulate pausing' },
        days: { type: 'number', description: 'Lookback window for averaging (default 30)' },
      },
      required: ['entity_ids'],
    },
  },
  {
    name: 'pause_entity',
    description: `Pause a specific ad entity (keyword, audience, creative, or ad group).

⚠️ ACTION TOOL: this changes the status of the entity to 'paused'. Always run
simulate_reallocation first and confirm with the user before calling this,
unless the user has explicitly asked you to proceed.

A reason is required for audit-trail purposes.

Args:
  - entity_id (number): The entity to pause
  - reason (string): Why this entity is being paused (e.g. "0 conversions in 30 days, €420 spent")

Examples:
  - "Pause entity 6, it's wasted €380 with zero conversions in 30 days"
    → entity_id=6, reason="€380 spent, 0 conversions in last 30 days"

Errors:
  - Returns error if entity_id doesn't exist
  - Returns error if entity is already paused`,
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'number', description: 'Entity ID to pause' },
        reason: { type: 'string', description: 'Reason for pausing (required for audit trail)' },
      },
      required: ['entity_id', 'reason'],
    },
  },
];

// ─── Handlers (return plain text, same pattern as handleTool in index.ts) ──

export async function handleAdsAuditTool(pool: Pool, name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'audit_account_waste':
      return auditAccountWaste(pool, args);
    case 'get_waste_detail':
      return getWasteDetail(pool, args);
    case 'simulate_reallocation':
      return simulateReallocation(pool, args);
    case 'pause_entity':
      return pauseEntity(pool, args);
    default:
      throw new Error(`Unknown ads-audit tool: ${name}`);
  }
}

async function auditAccountWaste(pool: Pool, args: Record<string, unknown>): Promise<string> {
  const days = Number(args.days ?? 30);
  const minSpend = Number(args.min_spend_cents ?? 5000);
  const maxConversions = Number(args.max_conversions ?? 0);
  const cpaMultiplier = Number(args.cpa_multiplier ?? 3);

  const { rows } = await pool.query(
    `SELECT
       e.id AS entity_id,
       e.name,
       e.entity_type,
       e.status,
       c.name AS campaign_name,
       c.platform,
       COALESCE(SUM(m.spend_cents), 0)::bigint AS spend_cents,
       COALESCE(SUM(m.conversions), 0)::bigint AS conversions
     FROM ad_entities e
     JOIN ad_campaigns c ON c.id = e.campaign_id
     LEFT JOIN ad_metrics_daily m
       ON m.entity_id = e.id AND m.date >= current_date - $1::int
     GROUP BY e.id, e.name, e.entity_type, e.status, c.name, c.platform
     ORDER BY spend_cents DESC`,
    [days]
  );

  let totalAccountSpend = 0;
  let totalAccountConversions = 0;
  for (const r of rows) {
    totalAccountSpend += Number(r.spend_cents);
    totalAccountConversions += Number(r.conversions);
  }
  const accountAvgCpa = totalAccountConversions > 0 ? totalAccountSpend / totalAccountConversions : null;

  const flagged: any[] = [];
  let totalWasted = 0;

  for (const r of rows) {
    const spend = Number(r.spend_cents);
    const conv = Number(r.conversions);
    if (spend < minSpend) continue;
    if (r.status === 'paused') continue;

    const cpa = conv > 0 ? spend / conv : null;
    let reason: string | null = null;

    if (conv <= maxConversions) {
      reason = `€${(spend / 100).toFixed(2)} spent over ${days} days with ${conv} conversion(s)`;
    } else if (accountAvgCpa !== null && cpa !== null && cpa > accountAvgCpa * cpaMultiplier) {
      reason = `CPA of €${(cpa / 100).toFixed(2)} is ${(cpa / accountAvgCpa).toFixed(1)}x the account average (€${(accountAvgCpa / 100).toFixed(2)})`;
    }

    if (reason) {
      flagged.push({
        entity_id: r.entity_id,
        name: r.name,
        entity_type: r.entity_type,
        platform: r.platform,
        campaign_name: r.campaign_name,
        spend_cents: spend,
        conversions: conv,
        cpa_cents: cpa,
        reason,
      });
      totalWasted += spend;
    }
  }

  const wastePct = totalAccountSpend > 0 ? (totalWasted / totalAccountSpend) * 100 : 0;

  const summary = {
    period_days: days,
    total_account_spend_cents: totalAccountSpend,
    total_account_spend_eur: +(totalAccountSpend / 100).toFixed(2),
    total_wasted_cents: totalWasted,
    total_wasted_eur: +(totalWasted / 100).toFixed(2),
    waste_pct: +wastePct.toFixed(1),
    flagged_count: flagged.length,
    flagged,
  };

  return JSON.stringify(summary, null, 2);
}

async function getWasteDetail(pool: Pool, args: Record<string, unknown>): Promise<string> {
  const entityId = Number(args.entity_id);
  const days = Number(args.days ?? 30);

  const entityRes = await pool.query(
    `SELECT e.id, e.name, e.entity_type, e.status, c.name AS campaign_name, c.platform
     FROM ad_entities e
     JOIN ad_campaigns c ON c.id = e.campaign_id
     WHERE e.id = $1`,
    [entityId]
  );

  if (entityRes.rows.length === 0) {
    throw new Error(`Entity ${entityId} not found.`);
  }

  const entity = entityRes.rows[0];

  const dailyRes = await pool.query(
    `SELECT date, impressions, clicks, spend_cents, conversions
     FROM ad_metrics_daily
     WHERE entity_id = $1 AND date >= current_date - $2::int
     ORDER BY date ASC`,
    [entityId, days]
  );

  let totalSpend = 0,
    totalConv = 0,
    totalClicks = 0,
    totalImpr = 0;
  for (const d of dailyRes.rows) {
    totalSpend += Number(d.spend_cents);
    totalConv += Number(d.conversions);
    totalClicks += Number(d.clicks);
    totalImpr += Number(d.impressions);
  }
  const cpa = totalConv > 0 ? totalSpend / totalConv : null;

  const result = {
    entity,
    totals: {
      spend_cents: totalSpend,
      spend_eur: +(totalSpend / 100).toFixed(2),
      conversions: totalConv,
      clicks: totalClicks,
      impressions: totalImpr,
      cpa_cents: cpa,
      cpa_eur: cpa !== null ? +(cpa / 100).toFixed(2) : null,
    },
    daily: dailyRes.rows,
  };

  return JSON.stringify(result, null, 2);
}

async function simulateReallocation(pool: Pool, args: Record<string, unknown>): Promise<string> {
  const entityIds = (args.entity_ids as number[]) ?? [];
  const days = Number(args.days ?? 30);

  if (entityIds.length === 0) {
    throw new Error('Provide at least one entity_id in entity_ids.');
  }

  const { rows } = await pool.query(
    `SELECT e.id AS entity_id, e.name,
            COALESCE(SUM(m.spend_cents), 0)::bigint AS total_spend,
            COALESCE(SUM(m.conversions), 0)::bigint AS total_conversions,
            COUNT(DISTINCT m.date) AS days_with_data
     FROM ad_entities e
     LEFT JOIN ad_metrics_daily m
       ON m.entity_id = e.id AND m.date >= current_date - $2::int
     WHERE e.id = ANY($1::int[])
     GROUP BY e.id, e.name`,
    [entityIds, days]
  );

  const entities = rows.map((r) => {
    const daysWithData = Number(r.days_with_data) || 1;
    const avgDailySpend = Number(r.total_spend) / daysWithData;
    const avgDailyConv = Number(r.total_conversions) / daysWithData;
    return {
      entity_id: r.entity_id,
      name: r.name,
      avg_daily_spend_cents: Math.round(avgDailySpend),
      avg_daily_spend_eur: +(avgDailySpend / 100).toFixed(2),
      avg_daily_conversions: +avgDailyConv.toFixed(2),
    };
  });

  const totalFreedDaily = entities.reduce((sum, e) => sum + e.avg_daily_spend_cents, 0);
  const totalFreedMonthly = totalFreedDaily * 30;
  const totalConvLostMonthly = entities.reduce((sum, e) => sum + e.avg_daily_conversions * 30, 0);

  const result = {
    entities,
    total_freed_daily_cents: totalFreedDaily,
    total_freed_daily_eur: +(totalFreedDaily / 100).toFixed(2),
    total_freed_monthly_cents: totalFreedMonthly,
    total_freed_monthly_eur: +(totalFreedMonthly / 100).toFixed(2),
    total_conversions_lost_per_month: +totalConvLostMonthly.toFixed(1),
    recommendation:
      totalConvLostMonthly < 1
        ? 'Negligible conversion loss — strong candidate for reallocation.'
        : 'Some conversions would be lost — weigh against where this budget could be redirected.',
  };

  return JSON.stringify(result, null, 2);
}

async function pauseEntity(pool: Pool, args: Record<string, unknown>): Promise<string> {
  const entityId = Number(args.entity_id);
  const reason = String(args.reason ?? '');

  const current = await pool.query(`SELECT id, name, status FROM ad_entities WHERE id = $1`, [entityId]);

  if (current.rows.length === 0) {
    throw new Error(`Entity ${entityId} not found.`);
  }

  const entity = current.rows[0];

  if (entity.status === 'paused') {
    throw new Error(`Entity "${entity.name}" (id ${entityId}) is already paused.`);
  }

  await pool.query(`UPDATE ad_entities SET status = 'paused' WHERE id = $1`, [entityId]);

  const result = {
    entity_id: entityId,
    name: entity.name,
    previous_status: entity.status,
    new_status: 'paused',
    reason,
    paused_at: new Date().toISOString(),
  };

  return JSON.stringify(result, null, 2);
}
