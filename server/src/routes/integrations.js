const express = require('express');
const crypto = require('crypto');
const { User, Notification } = require('../models');
const { verifyJWT } = require('../middleware/auth');
const { getIO, isOnline } = require('../socket/socketServer');
const { redis } = require('../config/redis');
const { getUserPreferences, inQuietHours } = require('./notify');

const router = express.Router();

// ─── Helper: create a notification and deliver via Socket.io ────────────────

const createAndDeliver = async (recipientId, senderId, type, payload, idempotencyKey) => {
  // Enforce user preferences before creating notification
  try {
    const prefs = await getUserPreferences(recipientId);
    if (!prefs.inApp) return null;
    if (prefs.mutedTypes?.includes(type)) return null;
    if (inQuietHours(prefs.quietHours)) return null;
  } catch (err) {
    console.error(`[Integrations] Preference check error for ${recipientId}: ${err.message}`);
    // Proceed with notification delivery if preference check fails
  }

  try {
    const notif = await Notification.create({
      recipientId,
      senderId,
      type,
      payload,
      idempotencyKey,
      delivered: isOnline(recipientId),
    });

    redis.incr('metrics:success').catch(() => { });

    const io = getIO();
    if (io && isOnline(recipientId)) {
      io.to(recipientId).emit('notification', notif);
    }

    return notif;
  } catch (err) {
    if (err.code === 11000) return null; // Duplicate idempotencyKey
    throw err;
  }
};

// ─── GET /api/integrations/status ───────────────────────────────────────────

router.get('/status', verifyJWT, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const user = await User.findOne({ userId }).lean();
    const integrations = user?.integrations || {};

    res.json({
      github: {
        connected: Boolean(integrations.github?.connected),
        username: integrations.github?.username || '',
        configuredInEnv: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
      },
      gmail: {
        connected: Boolean(integrations.gmail?.connected),
        email: integrations.gmail?.email || '',
        configuredInEnv: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      },
      linkedin: {
        connected: Boolean(integrations.linkedin?.connected),
        name: integrations.linkedin?.name || '',
        configuredInEnv: Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET),
      },
      whatsapp: {
        connected: Boolean(integrations.whatsapp?.connected),
        phone: integrations.whatsapp?.phone || '',
        configuredInEnv: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/integrations/github/data ──────────────────────────────────────
// Fetches real public GitHub events live from official GitHub REST API

router.get('/github/data', verifyJWT, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const user = await User.findOne({ userId }).lean();
    const username = user?.integrations?.github?.username;
    const connected = Boolean(user?.integrations?.github?.connected);

    if (!connected || !username) {
      return res.json({
        connected: false,
        reason: 'GitHub account not connected.',
        events: [],
      });
    }

    const resp = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}/events?per_page=15`, {
      headers: {
        'User-Agent': 'NotifyX-App',
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!resp.ok) {
      return res.json({
        connected: true,
        username,
        error: `GitHub API returned HTTP ${resp.status}`,
        events: [],
      });
    }

    const events = await resp.json();
    const formatted = Array.isArray(events) ? events.slice(0, 10).map(e => ({
      id: e.id,
      type: e.type,
      repo: e.repo?.name,
      createdAt: e.created_at,
      payload: e.payload,
    })) : [];

    res.json({
      connected: true,
      username,
      events: formatted,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/integrations/webhooks/github ─────────────────────────────────
// Official GitHub Webhook receiver with HMAC SHA-256 signature verification

router.post('/webhooks/github', express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }), async (req, res) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers['x-hub-signature-256'];
    if (!sig) return res.status(401).json({ error: 'Missing signature' });
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const event = req.headers['x-github-event'];
  const body = req.body;
  const deliveryId = req.headers['x-github-delivery'] || Date.now().toString();

  if (!event || !body) {
    return res.status(400).json({ error: 'Invalid webhook payload' });
  }

  const senderLogin = body.sender?.login;
  if (!senderLogin) {
    return res.status(200).json({ status: 'ignored', reason: 'No sender login' });
  }

  const users = await User.find({
    'integrations.github.connected': true,
    'integrations.github.username': senderLogin,
  }).lean();

  if (users.length === 0) {
    return res.status(200).json({ status: 'ignored', reason: 'No connected user for handle' });
  }

  let message;
  const repo = body.repository?.full_name || '';
  switch (event) {
    case 'push':
      message = `Pushed ${body.commits?.length || 0} commit(s) to ${repo}`;
      break;
    case 'pull_request':
      message = `${body.action} PR #${body.pull_request?.number} on ${repo}`;
      break;
    case 'issues':
      message = `${body.action} issue #${body.issue?.number} on ${repo}`;
      break;
    case 'issue_comment':
      message = `Commented on issue #${body.issue?.number} in ${repo}`;
      break;
    case 'star':
    case 'watch':
      message = `Starred ${repo}`;
      break;
    case 'fork':
      message = `Forked ${repo}`;
      break;
    default:
      message = `GitHub ${event} event on ${repo}`;
  }

  for (const user of users) {
    await createAndDeliver(
      user.userId,
      `github:${senderLogin}`,
      'system',
      { message, source: 'github', eventType: event, repo, url: body.repository?.html_url },
      `github_webhook_${deliveryId}`
    );
  }

  res.status(200).json({ status: 'ok', processed: users.length });
});

// ─── GET /api/integrations/gmail/data ───────────────────────────────────────
// Fetches real Gmail data when GOOGLE_ACCESS_TOKEN is configured in .env

router.get('/gmail/data', verifyJWT, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const user = await User.findOne({ userId }).lean();
    const email = user?.integrations?.gmail?.email;
    const connected = Boolean(user?.integrations?.gmail?.connected);
    const accessToken = process.env.GOOGLE_ACCESS_TOKEN;

    if (!connected || !email) {
      return res.json({
        connected: false,
        reason: 'Gmail account not connected.',
        messages: [],
      });
    }

    if (!accessToken) {
      return res.json({
        connected: true,
        email,
        status: 'awaiting_oauth',
        note: 'Official Gmail API requires Google OAuth Client ID & Access Token in server .env',
        messages: [],
      });
    }

    // Official Gmail REST API call
    const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
      return res.json({
        connected: true,
        email,
        error: `Gmail API returned HTTP ${resp.status}`,
        messages: [],
      });
    }

    const data = await resp.json();
    res.json({
      connected: true,
      email,
      messages: data.messages || [],
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/integrations/webhooks/gmail ──────────────────────────────────
// Official Google Cloud Pub/Sub Push Webhook Receiver for real-time email updates

router.post('/webhooks/gmail', async (req, res) => {
  try {
    const message = req.body?.message;
    if (!message?.data) return res.status(200).json({ status: 'ignored' });

    const decoded = JSON.parse(Buffer.from(message.data, 'base64').toString('utf-8'));
    const emailAddress = decoded.emailAddress;
    const historyId = decoded.historyId;

    if (!emailAddress) return res.status(200).json({ status: 'ignored' });

    const users = await User.find({
      'integrations.gmail.connected': true,
      'integrations.gmail.email': emailAddress,
    }).lean();

    for (const user of users) {
      await createAndDeliver(
        user.userId,
        `gmail:${emailAddress}`,
        'system',
        {
          message: `New email update (History #${historyId}) for ${emailAddress}`,
          source: 'gmail',
          email: emailAddress,
          historyId,
        },
        `gmail_pubsub_${historyId}_${user.userId}`
      );
    }

    res.status(200).json({ status: 'ok', processed: users.length });
  } catch (err) {
    res.status(200).json({ status: 'error', message: err.message });
  }
});

// ─── GET /api/integrations/linkedin/data ────────────────────────────────────
// Explains official LinkedIn API scope requirements

router.get('/linkedin/data', verifyJWT, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const user = await User.findOne({ userId }).lean();
    const name = user?.integrations?.linkedin?.name;
    const connected = Boolean(user?.integrations?.linkedin?.connected);

    if (!connected || !name) {
      return res.json({
        connected: false,
        reason: 'LinkedIn account not connected.',
      });
    }

    res.json({
      connected: true,
      name,
      apiCapabilities: {
        webhooks: true,
        webhookUrl: '/api/integrations/webhooks/linkedin',
      },
      note: 'Official LinkedIn v2 API restricts member notification feeds to approved Community Management Partners and Page Admin organizations.',
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/integrations/webhooks/linkedin ───────────────────────────────
// Official LinkedIn Developer Webhook Receiver

router.post('/webhooks/linkedin', async (req, res) => {
  try {
    const event = req.body;
    const handle = event.accountHandle || event.user;
    if (!handle) return res.status(200).json({ status: 'ignored' });

    const users = await User.find({
      'integrations.linkedin.connected': true,
      'integrations.linkedin.name': handle,
    }).lean();

    const eventId = event.id || `li_${Date.now()}`;
    const action = event.action || 'activity';
    const message = event.message || `New LinkedIn ${action} from ${event.actor || 'connection'}`;

    for (const user of users) {
      await createAndDeliver(
        user.userId,
        `linkedin:${handle}`,
        'system',
        {
          message,
          source: 'linkedin',
          handle,
          action,
        },
        `linkedin_${eventId}_${user.userId}`
      );
    }

    res.status(200).json({ status: 'ok', processed: users.length });
  } catch (err) {
    res.status(200).json({ status: 'error', message: err.message });
  }
});

// ─── GET /api/integrations/whatsapp/data ────────────────────────────────────

router.get('/whatsapp/data', verifyJWT, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const user = await User.findOne({ userId }).lean();
    const phone = user?.integrations?.whatsapp?.phone;
    const connected = Boolean(user?.integrations?.whatsapp?.connected);

    if (!connected || !phone) {
      return res.json({
        connected: false,
        reason: 'WhatsApp account not connected.',
      });
    }

    res.json({
      connected: true,
      phone,
      apiCapabilities: {
        metaWebhooks: true,
        webhookUrl: '/api/integrations/webhooks/whatsapp',
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/integrations/webhooks/whatsapp ───────────────────────────────
// Meta WhatsApp Business Webhook Handshake Verification

router.get('/webhooks/whatsapp', (req, res) => {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'notifyx-verify';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[Webhook] WhatsApp Meta verification succeeded');
    return res.status(200).send(challenge);
  }
  res.status(403).send('Forbidden');
});

// ─── POST /api/integrations/webhooks/whatsapp ──────────────────────────────
// Official Meta WhatsApp Business Cloud API Inbound Messages Receiver

router.post('/webhooks/whatsapp', async (req, res) => {
  try {
    const body = req.body;

    if (body?.object === 'whatsapp_business_account') {
      const entries = body.entry || [];
      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          if (change.field !== 'messages') continue;
          const messages = change.value?.messages || [];
          const contacts = change.value?.contacts || [];

          for (const msg of messages) {
            const senderPhone = msg.from;
            const senderName = contacts.find(c => c.wa_id === senderPhone)?.profile?.name || senderPhone;
            const text = msg.text?.body || msg.type || 'New WhatsApp message';

            const users = await User.find({
              'integrations.whatsapp.connected': true,
            }).lean();

            for (const user of users) {
              await createAndDeliver(
                user.userId,
                `whatsapp:${user.integrations.whatsapp.phone}`,
                'system',
                {
                  message: `[WhatsApp] ${senderName}: ${text}`,
                  source: 'whatsapp',
                  senderPhone,
                  text,
                },
                `whatsapp_${msg.id}_${user.userId}`
              );
            }
          }
        }
      }
    }

    res.status(200).json({ status: 'ok' });
  } catch (err) {
    res.status(200).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
