// SPDX-License-Identifier: MIT
// End-to-end smoke test for the couple ledger. Run against a disposable,
// freshly seeded development server: node scripts/smoke-ledger.mjs

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3010';
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

class Client {
  constructor() {
    this.cookies = new Map();
  }

  captureCookies(response) {
    const values = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
    for (const value of values) {
      const pair = value.split(';', 1)[0];
      const index = pair.indexOf('=');
      if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
  }

  async raw(path, { method = 'GET', body, csrf = true } = {}) {
    const upper = method.toUpperCase();
    const headers = { Accept: 'application/json' };
    if (this.cookies.size) headers.Cookie = this.cookieHeader();
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (csrf && MUTATIONS.has(upper)) {
      const csrfResponse = await this.raw('/api/auth/csrf', { csrf: false });
      if (!csrfResponse.response.ok) throw new Error('Could not obtain CSRF token');
      headers['x-csrf-token'] = csrfResponse.data.token;
      if (this.cookies.size) headers.Cookie = this.cookieHeader();
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method: upper,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    this.captureCookies(response);
    const data = await response.json().catch(() => null);
    return { response, data };
  }

  async call(path, options = {}) {
    const { expected = 200, ...requestOptions } = options;
    const result = await this.raw(path, requestOptions);
    const allowed = Array.isArray(expected) ? expected : [expected];
    if (!allowed.includes(result.response.status)) {
      throw new Error(`${requestOptions.method || 'GET'} ${path}: expected ${formatExpected(allowed)}, got ${result.response.status} ${JSON.stringify(result.data)}`);
    }
    return result.data;
  }
}

function formatExpected(values) {
  return values.join('/');
}

async function loginAndChange(username, initialPassword, newPassword) {
  const client = new Client();
  await client.call('/api/auth/login', {
    method: 'POST',
    csrf: false,
    body: { username, password: initialPassword },
  });
  await client.call('/api/auth/change-password', {
    method: 'POST',
    body: { currentPassword: initialPassword, newPassword },
  });
  return client;
}

const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
if (health.status !== 'ok' || !health.dbOk) throw new Error('Server is not healthy');

const admin = await loginAndChange(
  'couplecards',
  'changeme',
  'Violet!Quasar7-Lantern$Meadow2026',
);
const aliceSeed = await admin.call('/api/admin/users', {
  method: 'POST',
  body: { username: 'alice' },
});
const bobSeed = await admin.call('/api/admin/users', {
  method: 'POST',
  body: { username: 'bob' },
});
const charlieSeed = await admin.call('/api/admin/users', {
  method: 'POST',
  body: { username: 'charlie' },
});

const alice = await loginAndChange(
  'alice',
  aliceSeed.initialPassword,
  'Aurora!Bridge8-Coffee$River2026',
);
const bob = await loginAndChange(
  'bob',
  bobSeed.initialPassword,
  'Galaxy!Garden9-Compass$Stone2026',
);

const created = await alice.call('/api/couple', { method: 'POST', expected: 201 });
const inviteCode = created.couple.inviteCode;
if (!/^[A-Z2-9]{8}$/.test(inviteCode)) throw new Error('Invalid invite code');
if (created.couple.items[0]?.name !== '爱爱卡') throw new Error('Default love card missing');

await bob.call('/api/couple/join', {
  method: 'POST',
  body: { inviteCode: inviteCode.toLowerCase() },
});

const charlie = await loginAndChange(
  'charlie',
  charlieSeed.initialPassword,
  'Solar!Harbour6-Mango$Notebook2026',
);
const full = await charlie.call('/api/couple/join', {
  method: 'POST',
  expected: 409,
  body: { inviteCode },
});
if (full.error !== 'COUPLE_FULL') throw new Error('Third member was not rejected');

await charlie.call('/api/couple', { method: 'POST', expected: 201 });
const isolated = await charlie.call('/api/ledger/transactions', {
  method: 'POST',
  expected: 404,
  body: {
    itemId: created.couple.items[0].id,
    memberUserId: created.couple.members[0].id,
    action: 'acquire',
    quantity: 1,
  },
});
if (isolated.error !== 'ITEM_NOT_FOUND') throw new Error('Cross-couple item access was not rejected');
await charlie.call('/api/couple', { method: 'DELETE' });

let ledger = await bob.call('/api/ledger/items', {
  method: 'POST',
  expected: 201,
  body: { name: '拥抱券', unit: '张', emoji: '🤗', description: '随时兑换一个拥抱' },
});
const loveCard = ledger.couple.items.find((item) => item.name === '爱爱卡');
const hugCard = ledger.couple.items.find((item) => item.name === '拥抱券');
const aliceMember = ledger.couple.members.find((member) => member.username === 'alice');
const bobMember = ledger.couple.members.find((member) => member.username === 'bob');

await alice.call('/api/ledger/transactions', {
  method: 'POST',
  expected: 201,
  body: { itemId: loveCard.id, memberUserId: aliceMember.id, action: 'acquire', quantity: 5, note: '测试奖励' },
});
await bob.call('/api/ledger/transactions', {
  method: 'POST',
  expected: 201,
  body: { itemId: loveCard.id, memberUserId: bobMember.id, action: 'acquire', quantity: 3 },
});
await alice.call('/api/ledger/transactions', {
  method: 'POST',
  expected: 201,
  body: { itemId: loveCard.id, memberUserId: bobMember.id, action: 'use', quantity: 1, note: '跨账号记账测试' },
});
const insufficient = await bob.call('/api/ledger/transactions', {
  method: 'POST',
  expected: 409,
  body: { itemId: loveCard.id, memberUserId: bobMember.id, action: 'use', quantity: 99 },
});
if (insufficient.error !== 'INSUFFICIENT_BALANCE') throw new Error('Negative balance was not rejected');

ledger = await bob.call('/api/ledger');
const finalLoveCard = ledger.couple.items.find((item) => item.id === loveCard.id);
const balances = Object.fromEntries(finalLoveCard.balances.map((balance) => [balance.username, balance.quantity]));
if (balances.alice !== 5 || balances.bob !== 2) {
  throw new Error(`Unexpected balances: ${JSON.stringify(balances)}`);
}
if (ledger.couple.transactions.length !== 3) throw new Error('Unexpected transaction count');

const oldCode = ledger.couple.inviteCode;
ledger = await alice.call('/api/couple/invite/rotate', { method: 'POST' });
if (ledger.couple.inviteCode === oldCode) throw new Error('Invite code did not rotate');

ledger = await bob.call(`/api/ledger/items/${hugCard.id}`, { method: 'DELETE' });
if (ledger.couple.items.some((item) => item.id === hugCard.id)) throw new Error('Archived item is still active');

await bob.call('/api/couple', { method: 'DELETE' });
const afterBobLeft = await alice.call('/api/ledger');
if (afterBobLeft.couple !== null) throw new Error('Dissolving did not unbind both partners');

console.log(JSON.stringify({
  ok: true,
  members: ledger.couple.members.map((member) => member.username),
  balances,
  transactions: ledger.couple.transactions.length,
  archivedItemHidden: true,
  thirdMemberRejected: true,
  crossCoupleAccessRejected: true,
  dissolveCleanup: true,
}, null, 2));
