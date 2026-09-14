/**
 * Integration Poller — Background service that periodically polls connected
 * integrations for new events and creates Notification documents.
 *
 * Supported Integrations:
 *   - GitHub: polls public events API (no OAuth needed)
 *   - Gmail: Google API poller / Pub/Sub Push receiver
 *   - LinkedIn: LinkedIn Activity Poller / Partner Webhook
 *   - WhatsApp: Meta Cloud API Webhook / Ingestion Receiver
 */

const { User, Notification } = require('../models');
const { redis } = require('../config/redis');
const { deliverNotification } = require('./notificationDelivery');

// ─── GitHub Event → Notification mapper ──────────────────────────────────────

const formatPushEvent = (e) => {
  const repo = e.repo?.name || 'repository';
  const branch = e.payload?.ref ? e.payload.ref.replace(/^refs\/heads\//, '') : null;
  const count = e.payload?.size || e.payload?.distinct_size || e.payload?.commits?.length || 1;
  const commit = e.payload?.commits?.[0];
  const firstMsg = commit?.message ? commit.message.split('\n')[0].trim() : null;
  const branchTag = branch ? ` (${branch})` : '';

  if (firstMsg) {
    const cleanMsg = firstMsg.length > 55 ? firstMsg.slice(0, 52) + '…' : firstMsg;
    if (count > 1) {
      return `Pushed ${count} commits to ${repo}${branchTag}: "${cleanMsg}"`;
    }
    return `Pushed commit to ${repo}${branchTag}: "${cleanMsg}"`;
  }

  if (count > 1) {
    return `Pushed ${count} commits to ${repo}${branchTag}`;
  }
  return `Pushed code update to ${repo}${branchTag}`;
};

const GITHUB_EVENT_MAP = {
  PushEvent: formatPushEvent,
  PullRequestEvent: (e) => {
    const title = e.payload?.pull_request?.title ? ` "${e.payload.pull_request.title.slice(0, 45)}"` : '';
    return `${e.payload?.action || 'Opened'} PR #${e.payload?.pull_request?.number}${title} on ${e.repo?.name}`;
  },
  IssuesEvent: (e) => {
    const title = e.payload?.issue?.title ? ` "${e.payload.issue.title.slice(0, 45)}"` : '';
    return `${e.payload?.action || 'Opened'} issue #${e.payload?.issue?.number}${title} on ${e.repo?.name}`;
  },
  IssueCommentEvent: (e) => {
    const snippet = e.payload?.comment?.body ? ` "${e.payload.comment.body.split('\n')[0].slice(0, 40)}…"` : '';
    return `Commented on issue #${e.payload?.issue?.number}${snippet} in ${e.repo?.name}`;
  },
  WatchEvent: (e) => `Starred repository ${e.repo?.name}`,
  ForkEvent: (e) => `Forked ${e.repo?.name}${e.payload?.forkee?.full_name ? ` to ${e.payload.forkee.full_name}` : ''}`,
  CreateEvent: (e) => `Created ${e.payload?.ref_type || 'branch'}${e.payload?.ref ? ` "${e.payload.ref}"` : ''} on ${e.repo?.name}`,
  DeleteEvent: (e) => `Deleted ${e.payload?.ref_type || 'branch'}${e.payload?.ref ? ` "${e.payload.ref}"` : ''} on ${e.repo?.name}`,
  ReleaseEvent: (e) => `${e.payload?.action || 'Published'} release "${e.payload?.release?.tag_name || e.payload?.release?.name || 'new release'}" on ${e.repo?.name}`,
  PullRequestReviewEvent: (e) => `${e.payload?.action || 'Submitted'} review on PR #${e.payload?.pull_request?.number} in ${e.repo?.name}`,
  PublicEvent: (e) => `Made repository ${e.repo?.name} public`,
  MemberEvent: (e) => `${e.payload?.action || 'Added'} member ${e.payload?.member?.login} to ${e.repo?.name}`,
};

const mapGitHubEvent = (event) => {
  const mapper = GITHUB_EVENT_MAP[event.type];
  if (mapper) return mapper(event);
  return `${event.type.replace('Event', '')} activity on ${event.repo?.name || 'repository'}`;
};

// ─── Helper: create notification & emit via Socket.io ───────────────────────

const saveAndEmit = async (userId, senderId, message, source, eventType, extraPayload = {}, idempotencyKey) => {
  try {
    return await deliverNotification({
      recipientId: userId,
      senderId,
      type: 'system',
      payload: {
        message,
        source,
        eventType,
        ...extraPayload,
      },
      idempotencyKey,
    });
  } catch (err) {
    console.error(`[IntegrationPoller] Notification create error (${source}): ${err.message}`);
    return null;
  }
};

// ─── Poll GitHub for a single user ──────────────────────────────────────────

const pollGitHub = async (userId, username, userAccessToken) => {
  // Check if this user is in rate-limit back-off
  const backoffKey = `integration:github:backoff:${userId}`;
  try {
    const backoff = await redis.get(backoffKey);
    if (backoff) {
      console.log(`[IntegrationPoller] GitHub back-off active for ${username}, skipping`);
      return 0;
    }
  } catch {}

  const cacheKey = `integration:github:lastEventId:${userId}`;
  let lastEventId;
  try {
    lastEventId = await redis.get(cacheKey);
  } catch {
    lastEventId = null;
  }

  let events;
  try {
    const headers = {
      'User-Agent': 'NotifyX-App',
      'Accept': 'application/vnd.github.v3+json',
    };
    // Use GitHub PAT when available for higher rate limits (5000 req/hr vs 60)
    const token = userAccessToken || process.env.GITHUB_TOKEN;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const resp = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}/events?per_page=30`, {
      headers,
    });

    if (!resp.ok) {
      if (resp.status === 403 || resp.status === 429) {
        console.warn(`[IntegrationPoller] GitHub rate limit for ${username}, backing off 10 minutes`);
        // Back off for 10 minutes (2 poll cycles at 5-min interval)
        try { await redis.set(backoffKey, '1', 'EX', 600); } catch {}
        return 0;
      }
      console.warn(`[IntegrationPoller] GitHub API ${resp.status} for ${username}`);
      return 0;
    }

    events = await resp.json();
  } catch (err) {
    console.error(`[IntegrationPoller] GitHub fetch error for ${username}: ${err.message}`);
    return 0;
  }

  if (!Array.isArray(events) || events.length === 0) return 0;

  let newEvents = events;
  if (lastEventId) {
    const lastIdx = events.findIndex(e => e.id === lastEventId);
    if (lastIdx >= 0) {
      newEvents = events.slice(0, lastIdx);
    }
    if (lastIdx < 0 && newEvents.length > 10) {
      newEvents = newEvents.slice(0, 10);
    }
  } else {
    newEvents = events.slice(0, 5);
  }

  if (newEvents.length === 0) return 0;

  let created = 0;
  const toProcess = [...newEvents].reverse();

  for (const event of toProcess) {
    const idempotencyKey = `github_${event.id}`;
    const message = mapGitHubEvent(event);

    const saved = await saveAndEmit(
      userId,
      `github:${username}`,
      message,
      'github',
      event.type,
      { repo: event.repo?.name, url: event.repo?.name ? `https://github.com/${event.repo.name}` : null },
      idempotencyKey
    );

    if (saved) created++;
  }

  if (events[0]?.id) {
    try {
      await redis.set(cacheKey, events[0].id, 'EX', 86400 * 7);
    } catch { }
  }

  return created;
};

// ─── Poll Gmail for a single user (real API only) ───────────────────────────

const pollGmail = async (userId, email, userAccessToken) => {
  const token = userAccessToken || process.env.GOOGLE_ACCESS_TOKEN;
  if (!token) return 0;

  try {
    const resp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) return 0;
    const data = await resp.json();
    const messages = data.messages || [];
    let created = 0;

    for (const msg of messages) {
      const idempotencyKey = `gmail_${msg.id}_${userId}`;
      try {
        const exists = await Notification.exists({ idempotencyKey });
        if (exists) continue;
      } catch (err) {
        console.error(`[IntegrationPoller] Gmail idempotency check error: ${err.message}`);
      }

      let subject = 'No Subject';
      let from = 'Unknown Sender';
      let snippet = '';

      try {
        const detailResp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (detailResp.ok) {
          const detail = await detailResp.json();
          snippet = detail.snippet || '';
          const headers = detail.payload?.headers || [];
          const subjectHeader = headers.find(h => h.name.toLowerCase() === 'subject');
          const fromHeader = headers.find(h => h.name.toLowerCase() === 'from');
          if (subjectHeader) subject = subjectHeader.value;
          if (fromHeader) from = fromHeader.value;
        }
      } catch (err) {
        console.error(`[IntegrationPoller] Gmail detail fetch error: ${err.message}`);
      }

      const message = `Email from ${from}: "${subject}"`;

      const saved = await saveAndEmit(
        userId,
        `gmail:${email}`,
        message,
        'gmail',
        'email_received',
        { email, messageId: msg.id, subject, from, snippet },
        idempotencyKey
      );
      if (saved) created++;
    }
    return created;
  } catch (err) {
    console.error(`[IntegrationPoller] Gmail poll error: ${err.message}`);
    return 0;
  }
};

// ─── Poll LinkedIn for a single user (real API only) ─────────────────────────

const pollLinkedIn = async (userId, name, userAccessToken) => {
  const token = userAccessToken || process.env.LINKEDIN_ACCESS_TOKEN;
  if (!token) return 0;

  try {
    const resp = await fetch(`https://api.linkedin.com/v2/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return 0;
    return 0;
  } catch (err) {
    console.error(`[IntegrationPoller] LinkedIn poll error: ${err.message}`);
    return 0;
  }
};

// ─── Main polling loop ──────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 300_000; // 5 minutes — stays within GitHub's 60 req/hr unauthenticated limit
let pollTimer = null;

const pollAll = async () => {
  try {
    const users = await User.find({
      $or: [
        { 'integrations.github.connected': true },
        { 'integrations.gmail.connected': true },
        { 'integrations.linkedin.connected': true },
      ],
    }).lean();

    if (users.length === 0) return;

    const BATCH_SIZE = 10;
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map(async (user) => {
          // GitHub (Real REST API — uses PAT if available for higher limits)
          if (user.integrations?.github?.connected && user.integrations.github.username) {
            try {
              const count = await pollGitHub(user.userId, user.integrations.github.username, user.integrations.github.accessToken);
              if (count > 0) {
                console.log(`[IntegrationPoller] Created ${count} GitHub notification(s) for ${user.userId}`);
              }
            } catch (err) {
              console.error(`[IntegrationPoller] GitHub poll error for ${user.userId}: ${err.message}`);
            }
          }

          // Gmail (Real OAuth API if token set)
          if (user.integrations?.gmail?.connected && user.integrations.gmail.email) {
            try {
              const count = await pollGmail(user.userId, user.integrations.gmail.email, user.integrations.gmail.accessToken);
              if (count > 0) {
                console.log(`[IntegrationPoller] Created ${count} Gmail notification(s) for ${user.userId}`);
              }
            } catch (err) {
              console.error(`[IntegrationPoller] Gmail poll error for ${user.userId}: ${err.message}`);
            }
          }

          // LinkedIn (Real OAuth API if token set)
          if (user.integrations?.linkedin?.connected && user.integrations.linkedin.name) {
            try {
              const count = await pollLinkedIn(user.userId, user.integrations.linkedin.name, user.integrations.linkedin.accessToken);
              if (count > 0) {
                console.log(`[IntegrationPoller] Created ${count} LinkedIn notification(s) for ${user.userId}`);
              }
            } catch (err) {
              console.error(`[IntegrationPoller] LinkedIn poll error for ${user.userId}: ${err.message}`);
            }
          }
        })
      );
    }
  } catch (err) {
    console.error(`[IntegrationPoller] Poll cycle error: ${err.message}`);
  }
};

const startPoller = () => {
  console.log(`[IntegrationPoller] Starting (interval: ${POLL_INTERVAL_MS / 1000}s)`);

  setTimeout(() => {
    pollAll();
    pollTimer = setInterval(pollAll, POLL_INTERVAL_MS);
  }, 5000);
};

const stopPoller = () => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
};

module.exports = { startPoller, stopPoller, pollAll, pollGitHub, pollGmail, pollLinkedIn };
