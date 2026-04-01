function extractInviteCodeFromUrl(value = '') {
  const match = String(value || '').match(/whatsapp\.com\/channel\/([A-Za-z0-9]+)/i);
  return match?.[1] || null;
}

export function normalizeNewsletterTarget(input = '') {
  const raw = String(input || '').trim();
  if (!raw) return null;

  if (raw.endsWith('@newsletter')) {
    return { type: 'jid', value: raw };
  }

  const inviteCode = extractInviteCodeFromUrl(raw);
  if (inviteCode) {
    return { type: 'invite', value: inviteCode };
  }

  if (/^[A-Za-z0-9]+$/.test(raw)) {
    return { type: 'invite', value: raw };
  }

  return null;
}

export async function resolveNewsletterJid(client, input) {
  const target = normalizeNewsletterTarget(input);
  if (!target) return null;

  if (target.type === 'jid') {
    return { jid: target.value, metadata: null, target };
  }

  const metadata = await client.newsletterMetadata('invite', target.value);
  if (!metadata?.id) return null;

  return {
    jid: metadata.id,
    metadata,
    target
  };
}

function getNestedText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.text === 'string') return value.text;
  if (typeof value.content === 'string') return value.content;
  return '';
}

function collectNewsletterMessages(node, results = []) {
  if (!node || typeof node !== 'object') return results;

  if (node.tag === 'message' && node.attrs) {
    results.push({
      id: node.attrs.id || node.attrs.server_id || '',
      views: node.attrs.views || '',
      timestamp: node.attrs.t || node.attrs.timestamp || '',
      text: getNestedText(node.content?.find?.((entry) => entry?.tag === 'plaintext')?.content) ||
        getNestedText(node.content?.find?.((entry) => entry?.tag === 'text')?.content) ||
        ''
    });
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      collectNewsletterMessages(child, results);
    }
  }

  return results;
}

export function parseNewsletterMessages(result) {
  return collectNewsletterMessages(result, []);
}
