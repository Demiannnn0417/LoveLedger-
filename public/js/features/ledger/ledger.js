// SPDX-License-Identifier: MIT
// Couple binding, shared inventory balances, and acquisition/use history.

import { request, errorMessage } from '../../core/api.js';
import { navigate } from '../../core/router.js';
import { t, fmtDateLong, getLocale } from '../../core/i18n.js';
import { on } from '../../core/events.js';
import { escapeHtml, copyToClipboard } from '../../core/dom.js';
import { toast, showConfirm, withModal } from '../../ui/shell.js';

let state = null;
let unsubscribers = [];

function setLoading(loading) {
  document.getElementById('ledger-loading')?.toggleAttribute('hidden', !loading);
}

function setView(bound) {
  document.getElementById('ledger-unbound')?.toggleAttribute('hidden', bound);
  document.getElementById('ledger-bound')?.toggleAttribute('hidden', !bound);
}

async function loadLedger({ quiet = false } = {}) {
  if (!quiet) setLoading(true);
  try {
    state = await request('/api/ledger');
    render();
    if (quiet) toast(t('ledger.refreshed'));
  } catch (err) {
    toast(errorMessage(err));
    if (!state) setView(false);
  } finally {
    setLoading(false);
  }
}

function render() {
  const couple = state?.couple ?? null;
  setView(!!couple);
  if (!couple) return;
  renderCouple(couple);
  renderItems(couple);
  renderTransactions(couple);
}

function renderCouple(couple) {
  const members = couple.members || [];
  const names = members.map((member) => member.username);
  const title = document.getElementById('ledger-couple-name');
  if (title) {
    title.textContent = names.length > 1
      ? t('ledger.couple.name', { first: names[0], second: names[1] })
      : t('ledger.couple.waiting', { name: names[0] || '' });
  }

  const host = document.getElementById('ledger-members');
  if (host) {
    host.innerHTML = members.map((member) => `
      <span class="ledger-member-chip${member.isMe ? ' is-me' : ''}">
        <span aria-hidden="true">${member.isMe ? '♥' : '♡'}</span>
        ${escapeHtml(member.username)}
        ${member.isMe ? `<small>${escapeHtml(t('ledger.me'))}</small>` : ''}
      </span>
    `).join('');
  }

  const code = document.getElementById('ledger-invite-code');
  if (code) code.textContent = couple.inviteCode;
  document.getElementById('ledger-invite-block')?.toggleAttribute('hidden', !couple.canInvite);
}

function number(value) {
  return new Intl.NumberFormat(getLocale()).format(value);
}

function renderItems(couple) {
  const host = document.getElementById('ledger-items');
  if (!host) return;
  if (!couple.items?.length) {
    host.innerHTML = `<div class="ledger-empty-inline">${escapeHtml(t('ledger.items.empty'))}</div>`;
    return;
  }

  host.innerHTML = couple.items.map((item) => `
    <article class="ledger-item" data-item-id="${item.id}">
      <div class="ledger-item-head">
        <div class="ledger-item-identity">
          <span class="ledger-item-emoji" aria-hidden="true">${escapeHtml(item.emoji || '💝')}</span>
          <div>
            <div class="ledger-item-name">${escapeHtml(item.name)}</div>
            ${item.description ? `<div class="ledger-item-description">${escapeHtml(item.description)}</div>` : ''}
          </div>
        </div>
        <div class="ledger-item-tools">
          <button type="button" class="ledger-tool-button" data-ledger-action="edit" data-item-id="${item.id}">${escapeHtml(t('common.edit'))}</button>
          <button type="button" class="ledger-tool-button" data-ledger-action="archive" data-item-id="${item.id}">${escapeHtml(t('ledger.items.archive'))}</button>
        </div>
      </div>
      <div class="ledger-balances">
        ${item.balances.map((balance) => `
          <div class="ledger-balance-row">
            <div class="ledger-balance-person">
              ${escapeHtml(balance.username)}${balance.isMe ? `<small>${escapeHtml(t('ledger.me'))}</small>` : ''}
            </div>
            <div class="ledger-balance-value"><strong>${number(balance.quantity)}</strong><span>${escapeHtml(item.unit)}</span></div>
            <div class="ledger-balance-actions">
              <button type="button" class="btn btn-sm ledger-acquire" data-ledger-action="acquire" data-item-id="${item.id}" data-member-id="${balance.userId}">＋ ${escapeHtml(t('ledger.action.acquire'))}</button>
              <button type="button" class="btn btn-sm ledger-use" data-ledger-action="use" data-item-id="${item.id}" data-member-id="${balance.userId}" ${balance.quantity <= 0 ? 'disabled' : ''}>－ ${escapeHtml(t('ledger.action.use'))}</button>
            </div>
          </div>
        `).join('')}
      </div>
    </article>
  `).join('');
}

function parseUtc(value) {
  if (!value) return new Date();
  return new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}

function renderTransactions(couple) {
  const host = document.getElementById('ledger-transactions');
  if (!host) return;
  if (!couple.transactions?.length) {
    host.innerHTML = `<div class="ledger-empty-inline">${escapeHtml(t('ledger.transactions.empty'))}</div>`;
    return;
  }

  host.innerHTML = couple.transactions.map((entry) => {
    const positive = entry.delta > 0;
    const ownAction = entry.actorUserId === entry.memberUserId;
    const description = ownAction
      ? t(positive ? 'ledger.transaction.selfAcquire' : 'ledger.transaction.selfUse', {
        member: entry.memberName,
        item: entry.itemName,
      })
      : t(positive ? 'ledger.transaction.otherAcquire' : 'ledger.transaction.otherUse', {
        actor: entry.actorName,
        member: entry.memberName,
        item: entry.itemName,
      });
    return `
      <article class="ledger-transaction">
        <div class="ledger-transaction-delta ${positive ? 'is-positive' : 'is-negative'}">
          ${positive ? '+' : '−'}${number(entry.quantity)} ${escapeHtml(entry.unit)}
        </div>
        <div>
          <div class="ledger-transaction-title">${escapeHtml(description)}</div>
          ${entry.note ? `<div class="ledger-transaction-note">${escapeHtml(entry.note)}</div>` : ''}
        </div>
        <time class="ledger-transaction-time" datetime="${escapeHtml(entry.createdAt)}">${escapeHtml(fmtDateLong(parseUtc(entry.createdAt)))}</time>
      </article>
    `;
  }).join('');
}

function currentCouple() {
  return state?.couple ?? null;
}

function findItem(itemId) {
  return currentCouple()?.items?.find((item) => item.id === Number(itemId)) ?? null;
}

function findBalance(item, memberId) {
  return item?.balances?.find((balance) => balance.userId === Number(memberId)) ?? null;
}

async function mutate(path, options, button) {
  if (button) button.disabled = true;
  try {
    state = await request(path, options);
    render();
    return true;
  } catch (err) {
    toast(errorMessage(err));
    return false;
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}

function openItemDialog(item = null) {
  withModal({
    title: t(item ? 'ledger.items.editTitle' : 'ledger.items.addTitle'),
    bodyHtml: `
      <form id="ledger-item-form" class="ledger-form">
        <div class="ledger-form-row">
          <label class="field">
            <span>${escapeHtml(t('ledger.items.emoji'))}</span>
            <input id="ledger-item-emoji" maxlength="16" value="${escapeHtml(item?.emoji || '💗')}">
          </label>
          <label class="field">
            <span>${escapeHtml(t('ledger.items.name'))}</span>
            <input id="ledger-item-name" maxlength="50" required value="${escapeHtml(item?.name || '')}">
          </label>
        </div>
        <label class="field">
          <span>${escapeHtml(t('ledger.items.unit'))}</span>
          <input id="ledger-item-unit" maxlength="12" required value="${escapeHtml(item?.unit || t('ledger.items.defaultUnit'))}">
        </label>
        <label class="field">
          <span>${escapeHtml(t('ledger.items.description'))}</span>
          <textarea id="ledger-item-description" maxlength="200">${escapeHtml(item?.description || '')}</textarea>
        </label>
        <div class="ledger-form-error" id="ledger-item-error" role="alert"></div>
      </form>
    `,
    confirmLabel: t('common.save'),
    cancelLabel: t('common.cancel'),
    initialFocus: () => document.getElementById('ledger-item-name'),
    onConfirm: async ({ close, confirmBtn }) => {
      const form = document.getElementById('ledger-item-form');
      if (!form?.reportValidity()) return;
      confirmBtn.disabled = true;
      const body = {
        emoji: document.getElementById('ledger-item-emoji').value,
        name: document.getElementById('ledger-item-name').value,
        unit: document.getElementById('ledger-item-unit').value,
        description: document.getElementById('ledger-item-description').value,
      };
      try {
        state = await request(item ? `/api/ledger/items/${item.id}` : '/api/ledger/items', {
          method: item ? 'PATCH' : 'POST',
          body,
        });
        close();
        render();
        toast(t(item ? 'ledger.items.updated' : 'ledger.items.created'));
      } catch (err) {
        document.getElementById('ledger-item-error').textContent = errorMessage(err);
      } finally {
        confirmBtn.disabled = false;
      }
    },
  });
}

function openTransactionDialog(item, balance, action) {
  const isUse = action === 'use';
  withModal({
    title: t(isUse ? 'ledger.transaction.useTitle' : 'ledger.transaction.acquireTitle', {
      item: item.name,
      member: balance.username,
    }),
    bodyHtml: `
      <form id="ledger-transaction-form" class="ledger-form">
        <label class="field">
          <span>${escapeHtml(t('ledger.transaction.quantity', { unit: item.unit }))}</span>
          <input id="ledger-transaction-quantity" type="number" inputmode="numeric" min="1" max="${isUse ? balance.quantity : 100000}" step="1" value="1" required>
        </label>
        <label class="field">
          <span>${escapeHtml(t('ledger.transaction.note'))}</span>
          <textarea id="ledger-transaction-note" maxlength="200" placeholder="${escapeHtml(t('ledger.transaction.notePlaceholder'))}"></textarea>
        </label>
        <div class="ledger-form-error" id="ledger-transaction-error" role="alert"></div>
      </form>
    `,
    confirmLabel: t(isUse ? 'ledger.action.use' : 'ledger.action.acquire'),
    cancelLabel: t('common.cancel'),
    initialFocus: () => document.getElementById('ledger-transaction-quantity'),
    onConfirm: async ({ close, confirmBtn }) => {
      const form = document.getElementById('ledger-transaction-form');
      if (!form?.reportValidity()) return;
      confirmBtn.disabled = true;
      try {
        state = await request('/api/ledger/transactions', {
          method: 'POST',
          body: {
            itemId: item.id,
            memberUserId: balance.userId,
            action,
            quantity: Number(document.getElementById('ledger-transaction-quantity').value),
            note: document.getElementById('ledger-transaction-note').value,
          },
        });
        close();
        render();
        toast(t('ledger.transaction.saved'));
      } catch (err) {
        document.getElementById('ledger-transaction-error').textContent = errorMessage(err);
      } finally {
        confirmBtn.disabled = false;
      }
    },
  });
}

async function onItemsClick(event) {
  const button = event.target.closest('[data-ledger-action]');
  if (!button) return;
  const item = findItem(button.dataset.itemId);
  if (!item) return;
  const action = button.dataset.ledgerAction;
  if (action === 'edit') {
    openItemDialog(item);
    return;
  }
  if (action === 'archive') {
    const ok = await showConfirm({
      title: t('ledger.items.archiveTitle'),
      body: t('ledger.items.archiveConfirm', { item: item.name }),
      confirmLabel: t('ledger.items.archive'),
      cancelLabel: t('common.cancel'),
      danger: true,
    });
    if (!ok) return;
    const saved = await mutate(`/api/ledger/items/${item.id}`, { method: 'DELETE' }, button);
    if (saved) toast(t('ledger.items.archived'));
    return;
  }
  const balance = findBalance(item, button.dataset.memberId);
  if (balance) openTransactionDialog(item, balance, action);
}

export async function mount() {
  document.getElementById('btn-back-home')?.addEventListener('click', () => navigate('home'));
  document.getElementById('ledger-refresh')?.addEventListener('click', () => loadLedger({ quiet: true }));
  document.getElementById('ledger-items')?.addEventListener('click', onItemsClick);
  document.getElementById('ledger-add-item')?.addEventListener('click', () => openItemDialog());

  document.getElementById('ledger-create-couple')?.addEventListener('click', async (event) => {
    const ok = await mutate('/api/couple', { method: 'POST' }, event.currentTarget);
    if (ok) toast(t('ledger.couple.created'));
  });

  document.getElementById('ledger-join-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.getElementById('ledger-invite-input');
    if (!event.currentTarget.reportValidity()) return;
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const ok = await mutate('/api/couple/join', {
      method: 'POST',
      body: { inviteCode: input.value.trim().toUpperCase() },
    }, button);
    if (ok) toast(t('ledger.couple.joined'));
  });

  document.getElementById('ledger-copy-code')?.addEventListener('click', async () => {
    const code = currentCouple()?.inviteCode;
    if (!code) return;
    const copied = await copyToClipboard(code);
    toast(t(copied ? 'ledger.invite.copied' : 'common.copyManual'));
  });

  document.getElementById('ledger-rotate-code')?.addEventListener('click', async (event) => {
    const ok = await showConfirm({
      title: t('ledger.invite.rotateTitle'),
      body: t('ledger.invite.rotateConfirm'),
      confirmLabel: t('ledger.invite.rotate'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    const saved = await mutate('/api/couple/invite/rotate', { method: 'POST' }, event.currentTarget);
    if (saved) toast(t('ledger.invite.rotated'));
  });

  document.getElementById('ledger-leave-couple')?.addEventListener('click', async (event) => {
    const ok = await showConfirm({
      title: t('ledger.couple.leaveTitle'),
      body: t('ledger.couple.leaveConfirm'),
      confirmLabel: t('ledger.couple.leave'),
      cancelLabel: t('common.cancel'),
      danger: true,
    });
    if (!ok) return;
    const saved = await mutate('/api/couple', { method: 'DELETE' }, event.currentTarget);
    if (saved) toast(t('ledger.couple.left'));
  });

  unsubscribers = [on('i18n:change', render)];
  await loadLedger();
}

export function unmount() {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
}
