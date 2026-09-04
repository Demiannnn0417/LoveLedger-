// SPDX-License-Identifier: MIT
// Couple binding and shared inventory ledger. Every balance is derived from
// append-only transaction rows; mutations are restricted to the caller's
// own couple and record both the affected member and the actor.

import { randomBytes } from 'node:crypto';
import { getDb, transaction, isUniqueViolation } from '../db/index.js';
import { requireUser } from '../lib/auth.js';

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const itemIdSchema = { type: 'integer', minimum: 1 };
const memberIdSchema = { type: 'integer', minimum: 1 };

function inviteCode() {
  const bytes = randomBytes(8);
  let code = '';
  for (const byte of bytes) code += INVITE_ALPHABET[byte % INVITE_ALPHABET.length];
  return code;
}

function newUniqueInviteCode(db) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = inviteCode();
    if (!db.prepare('SELECT 1 FROM couples WHERE invite_code = ?').get(code)) return code;
  }
  throw new Error('INVITE_CODE_GENERATION_FAILED');
}

function membershipFor(userId) {
  return getDb().prepare(`
    SELECT c.id AS couple_id, c.invite_code, c.created_at
    FROM couple_members cm
    JOIN couples c ON c.id = cm.couple_id
    WHERE cm.user_id = ?
  `).get(userId);
}

function requireMembership(request, reply) {
  const membership = membershipFor(request.currentUser.id);
  if (!membership) {
    reply.code(409).send({ error: 'COUPLE_NOT_BOUND' });
    return null;
  }
  return membership;
}

function rejectDemo(request, reply) {
  if (!request.currentUser.isDemo) return false;
  reply.code(403).send({ error: 'DEMO_READONLY' });
  return true;
}

function cleanRequired(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanOptional(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim();
  return cleaned || null;
}

function ledgerFor(userId) {
  const db = getDb();
  const membership = membershipFor(userId);
  if (!membership) return { couple: null };

  const members = db.prepare(`
    SELECT u.id, u.username, cm.joined_at
    FROM couple_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.couple_id = ?
    ORDER BY cm.joined_at ASC, u.id ASC
  `).all(membership.couple_id).map((row) => ({
    id: row.id,
    username: row.username,
    joinedAt: row.joined_at,
    isMe: row.id === userId,
  }));

  const items = db.prepare(`
    SELECT id, name, unit, emoji, description, created_at, updated_at
    FROM inventory_items
    WHERE couple_id = ? AND archived = 0
    ORDER BY created_at ASC, id ASC
  `).all(membership.couple_id);

  const totals = db.prepare(`
    SELECT item_id, member_user_id, COALESCE(SUM(delta), 0) AS quantity
    FROM inventory_transactions
    WHERE couple_id = ? AND member_user_id IS NOT NULL
    GROUP BY item_id, member_user_id
  `).all(membership.couple_id);
  const quantities = new Map(totals.map((row) => [
    `${row.item_id}:${row.member_user_id}`,
    Number(row.quantity),
  ]));

  const mappedItems = items.map((item) => {
    const balances = members.map((member) => ({
      userId: member.id,
      username: member.username,
      isMe: member.isMe,
      quantity: quantities.get(`${item.id}:${member.id}`) ?? 0,
    }));
    return {
      id: item.id,
      name: item.name,
      unit: item.unit,
      emoji: item.emoji,
      description: item.description,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      balances,
      total: balances.reduce((sum, balance) => sum + balance.quantity, 0),
    };
  });

  const transactions = db.prepare(`
    SELECT tx.id, tx.item_id, item.name AS item_name, item.unit,
           tx.member_user_id, tx.member_name, tx.actor_user_id, tx.actor_name,
           tx.delta, tx.note, tx.created_at
    FROM inventory_transactions tx
    JOIN inventory_items item ON item.id = tx.item_id
    WHERE tx.couple_id = ?
    ORDER BY tx.created_at DESC, tx.id DESC
    LIMIT 200
  `).all(membership.couple_id).map((row) => ({
    id: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    unit: row.unit,
    memberUserId: row.member_user_id,
    memberName: row.member_name,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    delta: row.delta,
    action: row.delta > 0 ? 'acquire' : 'use',
    quantity: Math.abs(row.delta),
    note: row.note,
    createdAt: row.created_at,
  }));

  return {
    couple: {
      id: membership.couple_id,
      inviteCode: membership.invite_code,
      createdAt: membership.created_at,
      canInvite: members.length < 2,
      members,
      items: mappedItems,
      transactions,
    },
  };
}

const itemBodyProperties = {
  name: { type: 'string', minLength: 1, maxLength: 50 },
  unit: { type: 'string', minLength: 1, maxLength: 12 },
  emoji: { type: ['string', 'null'], maxLength: 16 },
  description: { type: ['string', 'null'], maxLength: 200 },
};

export default async function ledgerRoutes(app) {
  app.addHook('preHandler', requireUser);

  app.get('/ledger', async (request) => ledgerFor(request.currentUser.id));

  app.post('/couple', async (request, reply) => {
    if (rejectDemo(request, reply)) return;
    const db = getDb();
    if (membershipFor(request.currentUser.id)) {
      return reply.code(409).send({ error: 'COUPLE_ALREADY_BOUND' });
    }
    transaction(() => {
      const code = newUniqueInviteCode(db);
      const created = db.prepare(`
        INSERT INTO couples (invite_code, created_by) VALUES (?, ?)
      `).run(code, request.currentUser.id);
      const coupleId = Number(created.lastInsertRowid);
      db.prepare(`
        INSERT INTO couple_members (couple_id, user_id) VALUES (?, ?)
      `).run(coupleId, request.currentUser.id);
      db.prepare(`
        INSERT INTO inventory_items (couple_id, name, unit, emoji, description, created_by)
        VALUES (?, '爱爱卡', '张', '💗', '记录彼此获得和使用的爱爱卡', ?)
      `).run(coupleId, request.currentUser.id);
    })();
    return reply.code(201).send(ledgerFor(request.currentUser.id));
  });

  app.post('/couple/join', {
    config: {
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
    schema: {
      body: {
        type: 'object',
        required: ['inviteCode'],
        additionalProperties: false,
        properties: {
          inviteCode: { type: 'string', pattern: '^[A-Za-z0-9]{8}$' },
        },
      },
    },
  }, async (request, reply) => {
    if (rejectDemo(request, reply)) return;
    const db = getDb();
    if (membershipFor(request.currentUser.id)) {
      return reply.code(409).send({ error: 'COUPLE_ALREADY_BOUND' });
    }
    const code = request.body.inviteCode.trim().toUpperCase();
    const couple = db.prepare('SELECT id FROM couples WHERE invite_code = ?').get(code);
    if (!couple) return reply.code(404).send({ error: 'COUPLE_NOT_FOUND' });

    let full = false;
    try {
      transaction(() => {
        const count = db.prepare(`
          SELECT COUNT(*) AS n FROM couple_members WHERE couple_id = ?
        `).get(couple.id).n;
        if (count >= 2) { full = true; return; }
        db.prepare(`
          INSERT INTO couple_members (couple_id, user_id) VALUES (?, ?)
        `).run(couple.id, request.currentUser.id);
      })();
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: 'COUPLE_ALREADY_BOUND' });
      }
      throw err;
    }
    if (full) return reply.code(409).send({ error: 'COUPLE_FULL' });
    return ledgerFor(request.currentUser.id);
  });

  app.post('/couple/invite/rotate', async (request, reply) => {
    if (rejectDemo(request, reply)) return;
    const membership = requireMembership(request, reply);
    if (!membership) return;
    const db = getDb();
    const code = newUniqueInviteCode(db);
    db.prepare('UPDATE couples SET invite_code = ? WHERE id = ?')
      .run(code, membership.couple_id);
    return ledgerFor(request.currentUser.id);
  });

  app.delete('/couple', async (request, reply) => {
    if (rejectDemo(request, reply)) return;
    const membership = requireMembership(request, reply);
    if (!membership) return;
    // A binding represents one relationship, not a reusable room. Dissolve
    // the entire couple so a future partner can never inherit the previous
    // partner's balances, notes, or transaction history.
    getDb().prepare('DELETE FROM couples WHERE id = ?').run(membership.couple_id);
    return { couple: null };
  });

  app.post('/ledger/items', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'unit'],
        additionalProperties: false,
        properties: itemBodyProperties,
      },
    },
  }, async (request, reply) => {
    if (rejectDemo(request, reply)) return;
    const membership = requireMembership(request, reply);
    if (!membership) return;
    const name = cleanRequired(request.body.name);
    const unit = cleanRequired(request.body.unit);
    if (!name || !unit) return reply.code(400).send({ error: 'VALIDATION_ERROR' });
    try {
      getDb().prepare(`
        INSERT INTO inventory_items
          (couple_id, name, unit, emoji, description, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        membership.couple_id,
        name,
        unit,
        cleanOptional(request.body.emoji),
        cleanOptional(request.body.description),
        request.currentUser.id,
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: 'ITEM_NAME_EXISTS' });
      }
      throw err;
    }
    return reply.code(201).send(ledgerFor(request.currentUser.id));
  });

  app.patch('/ledger/items/:itemId', {
    schema: {
      params: {
        type: 'object',
        required: ['itemId'],
        additionalProperties: false,
        properties: { itemId: itemIdSchema },
      },
      body: {
        type: 'object',
        minProperties: 1,
        additionalProperties: false,
        properties: itemBodyProperties,
      },
    },
  }, async (request, reply) => {
    if (rejectDemo(request, reply)) return;
    const membership = requireMembership(request, reply);
    if (!membership) return;
    const db = getDb();
    const item = db.prepare(`
      SELECT id FROM inventory_items WHERE id = ? AND couple_id = ? AND archived = 0
    `).get(request.params.itemId, membership.couple_id);
    if (!item) return reply.code(404).send({ error: 'ITEM_NOT_FOUND' });

    const updates = [];
    const args = [];
    if (request.body.name !== undefined) {
      const name = cleanRequired(request.body.name);
      if (!name) return reply.code(400).send({ error: 'VALIDATION_ERROR' });
      updates.push('name = ?'); args.push(name);
    }
    if (request.body.unit !== undefined) {
      const unit = cleanRequired(request.body.unit);
      if (!unit) return reply.code(400).send({ error: 'VALIDATION_ERROR' });
      updates.push('unit = ?'); args.push(unit);
    }
    if (request.body.emoji !== undefined) {
      updates.push('emoji = ?'); args.push(cleanOptional(request.body.emoji));
    }
    if (request.body.description !== undefined) {
      updates.push('description = ?'); args.push(cleanOptional(request.body.description));
    }
    updates.push("updated_at = datetime('now')");
    args.push(request.params.itemId, membership.couple_id);
    try {
      db.prepare(`
        UPDATE inventory_items SET ${updates.join(', ')}
        WHERE id = ? AND couple_id = ? AND archived = 0
      `).run(...args);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: 'ITEM_NAME_EXISTS' });
      }
      throw err;
    }
    return ledgerFor(request.currentUser.id);
  });

  app.delete('/ledger/items/:itemId', {
    schema: {
      params: {
        type: 'object',
        required: ['itemId'],
        additionalProperties: false,
        properties: { itemId: itemIdSchema },
      },
    },
  }, async (request, reply) => {
    if (rejectDemo(request, reply)) return;
    const membership = requireMembership(request, reply);
    if (!membership) return;
    const info = getDb().prepare(`
      UPDATE inventory_items
      SET archived = 1, updated_at = datetime('now')
      WHERE id = ? AND couple_id = ? AND archived = 0
    `).run(request.params.itemId, membership.couple_id);
    if (info.changes === 0) return reply.code(404).send({ error: 'ITEM_NOT_FOUND' });
    return ledgerFor(request.currentUser.id);
  });

  app.post('/ledger/transactions', {
    schema: {
      body: {
        type: 'object',
        required: ['itemId', 'memberUserId', 'action', 'quantity'],
        additionalProperties: false,
        properties: {
          itemId: itemIdSchema,
          memberUserId: memberIdSchema,
          action: { type: 'string', enum: ['acquire', 'use'] },
          quantity: { type: 'integer', minimum: 1, maximum: 100000 },
          note: { type: ['string', 'null'], maxLength: 200 },
        },
      },
    },
  }, async (request, reply) => {
    if (rejectDemo(request, reply)) return;
    const membership = requireMembership(request, reply);
    if (!membership) return;
    const db = getDb();
    const item = db.prepare(`
      SELECT id, name FROM inventory_items
      WHERE id = ? AND couple_id = ? AND archived = 0
    `).get(request.body.itemId, membership.couple_id);
    if (!item) return reply.code(404).send({ error: 'ITEM_NOT_FOUND' });
    const member = db.prepare(`
      SELECT u.id, u.username
      FROM couple_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.couple_id = ? AND cm.user_id = ?
    `).get(membership.couple_id, request.body.memberUserId);
    if (!member) return reply.code(404).send({ error: 'COUPLE_MEMBER_NOT_FOUND' });

    const delta = request.body.action === 'acquire'
      ? request.body.quantity
      : -request.body.quantity;
    let insufficient = false;
    transaction(() => {
      const balance = Number(db.prepare(`
        SELECT COALESCE(SUM(delta), 0) AS quantity
        FROM inventory_transactions
        WHERE couple_id = ? AND item_id = ? AND member_user_id = ?
      `).get(membership.couple_id, item.id, member.id).quantity);
      if (balance + delta < 0) { insufficient = true; return; }
      db.prepare(`
        INSERT INTO inventory_transactions
          (couple_id, item_id, member_user_id, member_name,
           actor_user_id, actor_name, delta, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        membership.couple_id,
        item.id,
        member.id,
        member.username,
        request.currentUser.id,
        request.currentUser.username,
        delta,
        cleanOptional(request.body.note),
      );
    })();
    if (insufficient) {
      return reply.code(409).send({ error: 'INSUFFICIENT_BALANCE' });
    }
    return reply.code(201).send(ledgerFor(request.currentUser.id));
  });
}
