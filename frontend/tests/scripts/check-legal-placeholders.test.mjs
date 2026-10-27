import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { legalPlaceholderIssues } from '../../scripts/check-legal-placeholders.mjs';

test('the checked-in mock operator remains visibly blocked for launch preparation', async () => {
  const current = JSON.parse(await readFile(new URL('../../config/legal-operator.json', import.meta.url), 'utf8'));
  assert.equal(current.releaseStatus, 'draft');
  assert.ok(legalPlaceholderIssues(current).length >= 7);
  assert.ok(current.supportEmail.endsWith('.invalid'));
  assert.ok(current.privacyEmail.endsWith('.invalid'));
});

test('review flags alone cannot approve placeholder contacts or malformed effective dates', () => {
  const base = { releaseStatus: 'reviewed', operatorName: 'Operator supplied for review', businessAddress: 'Address supplied for review',
    supportEmail: 'support@needs.invalid', privacyEmail: 'privacy@example.com', termsReviewed: true, privacyReviewed: true, effectiveDate: '2026-02-30' };
  assert.equal(legalPlaceholderIssues(base).length, 3);
  for (const domain of ['service.invalid', 'example.org', 'local.test', 'needs.example']) {
    assert.ok(legalPlaceholderIssues({ ...base, supportEmail: `support@${domain}` }).some(issue => issue.startsWith('supportEmail')));
  }
  assert.ok(legalPlaceholderIssues(null).length > 0);
});
