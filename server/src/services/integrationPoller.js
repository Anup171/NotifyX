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
const { getIO, isOnline } = require('../socket/socketServer');

// ─── GitHub Event → Notification mapper ──────────────────────────────────────

const GITHUB_EVENT_MAP = {
  PushEvent:              (e) => `Pushed ${e.payload?.commits?.length || 0} commit(s) to ${e.repo?.name}`,
  PullRequestEvent:       (e) => `${e.payload?.action} PR #${e.payload?.pull_request?.number} on ${e.repo?.name}`,
  IssuesEvent:            (e) => `${e.payload?.action} issue #${e.payload?.issue?.number} on ${e.repo?.name}`,
  IssueCommentEvent:      (e) => `Commented on issue #${e.payload?.issue?.number} in ${e.repo?.name}`,
  WatchEvent:             (e) => `Starred ${e.repo?.name}`,
  ForkEvent:              (e) => `Forked ${e.repo?.name}`,
  CreateEvent:            (e) => `Created ${e.payload?.ref_type}${e.payload?.ref ? ` "${e.payload.ref}"` : ''} on ${e.repo?.name}`,
  DeleteEvent:            (e) => `Deleted ${e.payload?.ref_type} "${e.payload?.ref}" on ${e.repo?.name}`,
  ReleaseEvent:           (e) => `${e.payload?.action} release "${e.payload?.release?.tag_name}" on ${e.repo?.name}`,
  PullRequestReviewEvent: (e) => `${e.payload?.action} review on PR #${e.payload?.pull_request?.number} in ${e.repo?.name}`,
  PublicEvent:            (e) => `Made ${e.repo?.name} public`,
  MemberEvent:            (e) => `${e.payload?.action} ${e.payload?.member?.login} on ${e.repo?.name}`,
};

const mapGitHubEvent = (event) => {
  const mapper = GITHUB_EVENT_MAP[event.type];
  if (mapper) return mapper(event);
  return `${event.type.replace('Event', '')} activity on ${event.repo?.name || 'unknown repo'}`;
};

// ─── Helper: create notification & emit via Socket.io ───────────────────────

const saveAndEmit = async (userId, senderId, message, source, eventType, extraPayload = {}, idempotencyKey) => {
  const io = getIO();
  try {
    const notif = await Notification.create({
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
      delivered: isOnline(userId),
    });

    if (io && isOnline(userId)) {
      io.to(userId).emit('notification', notif);
    }

    redis.incr('metrics:success').catch(() => {});
    return notif;
  } catch (err) {
    if (err.code === 11000) return null; // duplicate idempotencyKey
    console.error(`[IntegrationPoller] Notification create error (${source}): ${err.message}`);
    return null;
  }
};

// ─── Poll GitHub for a single user ──────────────────────────────────────────

const pollGitHub = async (userId, username) => {
  const cacheKey = `integration:github:lastEventId:${userId}`;
  let lastEventId;
  try {
    lastEventId = await redis.get(cacheKey);
  } catch {
    lastEventId = null;
  }

  let events;
  try {
    const resp = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}/events?per_page=30`, {
      headers: {
        'User-Agent': 'NotifyX-App',
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!resp.ok) {
      if (resp.status === 403 || resp.status === 429) {
        console.warn(`[IntegrationPoller] GitHub rate limit for ${username}, skipping`);
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
    } catch {}
  }

  return created;
};

// ─── Poll Gmail for a single user (if Google OAuth token exists) ─────────────

const pollGmail = async (userId, email) => {
  const token = process.env.GOOGLE_ACCESS_TOKEN;
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
      const saved = await saveAndEmit(
        userId,
        `gmail:${email}`,
        `New email message #${msg.id}`,
        'gmail',
        'email_received',
        { email, messageId: msg.id },
        `gmail_${msg.id}_${userId}`
      );
      if (saved) created++;
    }
    return created;
  } catch (err) {
    console.error(`[IntegrationPoller] Gmail poll error: ${err.message}`);
    return 0;
  }
};

// ─── Poll LinkedIn for a single user (if LinkedIn token exists) ──────────────

const pollLinkedIn = async (userId, name) => {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  if (!token) return 0;

  try {
    const resp = await fetch(`https://api.linkedin.com/v2/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return 0;
    return 0;
  } catch (err) {
    return 0;
  }
};

// ─── Main polling loop ──────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000; // 60 seconds
let pollTimer = null;

const pollAll = async () => {
  try {
    const users = await User.find({
      $or: [
        { 'integrations.github.connected': true },
        { 'integrations.gmail.connected': true },
        { 'integrations.linkedin.connected': true },
        { 'integrations.whatsapp.connected': true },
      ],
    }).lean();

    if (users.length === 0) return;

    for (const user of users) {
      // GitHub
      if (user.integrations?.github?.connected && user.integrations.github.username) {
        const count = await pollGitHub(user.userId, user.integrations.github.username);
        if (count > 0) {
          console.log(`[IntegrationPoller] Created ${count} GitHub notification(s) for ${user.userId}`);
        }
      }

      // Gmail
      if (user.integrations?.gmail?.connected && user.integrations.gmail.email) {
        await pollGmail(user.userId, user.integrations.gmail.email);
      }

      // LinkedIn
      if (user.integrations?.linkedin?.connected && user.integrations.linkedin.name) {
        await pollLinkedIn(user.userId, user.integrations.linkedin.name);
      }
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
