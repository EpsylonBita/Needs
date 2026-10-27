import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** Offline release checklist aid. It neither changes configuration nor verifies legal compliance. */
export function legalPlaceholderIssues(value) {
  const issues = [];
  const placeholder = /mock|placeholder|pending|replace|\btodo\b|προς συμπλήρωση|δοκιμαστικ/i;
  if (value?.releaseStatus !== 'reviewed') issues.push('Legal release status is not reviewed.');
  for (const key of ['operatorName', 'businessAddress']) {
    if (typeof value?.[key] !== 'string' || value[key].trim().length < 3 || placeholder.test(value[key])) issues.push(`${key} is missing or still a placeholder.`);
  }
  for (const key of ['supportEmail', 'privacyEmail']) {
    const email = value?.[key];
    const domain = typeof email === 'string' ? email.split('@')[1]?.toLowerCase() : '';
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || placeholder.test(email)
      || /(?:^|\.)(?:invalid|test|example|localhost)$/.test(domain || '')
      || /(?:^|\.)example\.(?:com|net|org)$/.test(domain || '')) issues.push(`${key} is missing or uses a reserved/mock destination.`);
  }
  if (value?.termsReviewed !== true) issues.push('Final terms review is pending.');
  if (value?.privacyReviewed !== true) issues.push('Final privacy review is pending.');
  const effective = value?.effectiveDate;
  if (typeof effective !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(effective) || !Number.isFinite(Date.parse(effective))
    || new Date(effective).toISOString().slice(0, 10) !== effective) issues.push('A valid effective date is not recorded.');
  return issues;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const value = JSON.parse(await readFile(new URL('../config/legal-operator.json', import.meta.url), 'utf8'));
    const issues = legalPlaceholderIssues(value);
    if (issues.length) {
      console.error('NOT READY: mock or unreviewed legal details remain.');
      for (const issue of issues) console.error(`- ${issue}`);
      process.exitCode = 1;
    } else console.log('No operator placeholders detected. This does not verify legal approval, email delivery, payments or hosted launch readiness.');
  } catch {
    console.error('NOT READY: the legal operator configuration could not be checked.');
    process.exitCode = 1;
  }
}
