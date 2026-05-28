const db = require('../config/db');

const ACTIVITY_RETENTION_DAYS = 14;

const normalizeActivityRow = (row) => ({
  id: row.id,
  action: row.action,
  description: row.description,
  type: row.type,
  entityType: row.entity_type,
  entityId: row.entity_id,
  metadata: row.metadata || {},
  actorId: row.actor_id,
  actorName: row.actor_name || row.actor_email || 'System',
  actorEmail: row.actor_email || null,
  timestamp: row.created_at,
});

const recordActivityLog = async ({
  req,
  action,
  description,
  type,
  entityType = null,
  entityId = null,
  metadata = {},
}) => {
  try {
    await db.query(
      `INSERT INTO activity_logs
         (actor_id, action, description, type, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        req?.user?.id || null,
        action,
        description,
        type,
        entityType,
        entityId ? String(entityId) : null,
        JSON.stringify(metadata || {}),
      ]
    );
  } catch (err) {
    // Activity logging must never block the main admin action. If the migration
    // has not run yet, keep the product operation successful and surface the
    // missing table through server logs instead.
    console.warn('[activity_logs] failed to record activity', {
      message: err.message,
      code: err.code,
      action,
      type,
      entityType,
      entityId,
    });
  }
};

const getActivityLogs = async (req, res, next) => {
  try {
    const days = Number.isInteger(Number(req.query.days)) && Number(req.query.days) > 0
      ? Math.min(Number(req.query.days), ACTIVITY_RETENTION_DAYS)
      : ACTIVITY_RETENTION_DAYS;
    const type = req.query.type && req.query.type !== 'all' ? String(req.query.type) : null;

    const params = [days];
    const filters = [`al.created_at >= NOW() - ($1::int * INTERVAL '1 day')`];

    if (type) {
      params.push(type);
      filters.push(`al.type = $${params.length}`);
    }

    const { rows } = await db.query(
      `SELECT
         al.id,
         al.actor_id,
         al.action,
         al.description,
         al.type,
         al.entity_type,
         al.entity_id,
         al.metadata,
         al.created_at,
         u.name AS actor_name,
         u.email AS actor_email
       FROM activity_logs al
       LEFT JOIN users u ON u.id = al.actor_id
       WHERE ${filters.join(' AND ')}
       ORDER BY al.created_at DESC
       LIMIT 500`,
      params
    );

    res.json({ data: rows.map(normalizeActivityRow), days });
  } catch (err) {
    if (err.code === '42P01') {
      console.warn('[activity_logs] table missing — returning empty activity log');
      return res.json({ data: [], days: ACTIVITY_RETENTION_DAYS });
    }
    next(err);
  }
};

module.exports = { getActivityLogs, recordActivityLog, ACTIVITY_RETENTION_DAYS };
