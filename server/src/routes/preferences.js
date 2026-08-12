const express = require('express');
const { User } = require('../models');
const { redis } = require('../config/redis');
const { verifyJWT } = require('../middleware/auth');
const { DEFAULT_PREFERENCES } = require('../../../shared/constants');

const router = express.Router();

// GET /api/users/preferences
router.get('/preferences', verifyJWT, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    let user = await User.findOne({ userId }).lean();
    if (!user) {
      user = await User.create({ userId, preferences: DEFAULT_PREFERENCES });
    }
    res.json(user.preferences);
  } catch (err) {
    next(err);
  }
});

// PUT /api/users/preferences
router.put('/preferences', verifyJWT, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const user = await User.findOneAndUpdate(
      { userId },
      { $set: { preferences: req.body, updatedAt: new Date() } },
      { new: true, upsert: true }
    );
    // Invalidate worker's preference cache
    await redis.del(`prefs:${userId}`);
    res.json(user.preferences);
  } catch (err) {
    next(err);
  }
});

const sanitizeIntegrations = (integrations = {}) => ({
  github: {
    connected: Boolean(integrations.github?.connected),
    username: integrations.github?.username || '',
    hasToken: Boolean(integrations.github?.accessToken),
  },
  gmail: {
    connected: Boolean(integrations.gmail?.connected),
    email: integrations.gmail?.email || '',
    hasToken: Boolean(integrations.gmail?.accessToken),
  },
  linkedin: {
    connected: Boolean(integrations.linkedin?.connected),
    name: integrations.linkedin?.name || '',
    hasToken: Boolean(integrations.linkedin?.accessToken),
  },
  whatsapp: {
    connected: Boolean(integrations.whatsapp?.connected),
    phone: integrations.whatsapp?.phone || '',
    hasToken: Boolean(integrations.whatsapp?.accessToken),
    hasPhoneId: Boolean(integrations.whatsapp?.phoneId),
  },
});

// GET /api/users/integrations — fetch social/productivity integration statuses
router.get('/integrations', verifyJWT, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const user = await User.findOne({ userId }).lean();
    res.json(sanitizeIntegrations(user?.integrations));
  } catch (err) {
    next(err);
  }
});

// POST /api/users/integrations/toggle — connect/disconnect an integration
router.post('/integrations/toggle', verifyJWT, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { provider, connected, accountName, accessToken, phoneId } = req.body;
    if (!['github', 'gmail', 'linkedin', 'whatsapp'].includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider' });
    }

    const fieldMap = { github: 'username', gmail: 'email', linkedin: 'name', whatsapp: 'phone' };
    const fieldName = fieldMap[provider];

    const updateObj = {
      [`integrations.${provider}.connected`]: Boolean(connected),
      [`integrations.${provider}.${fieldName}`]: connected ? (accountName || `${userId}_${provider}`) : '',
      [`integrations.${provider}.updatedAt`]: new Date(),
    };

    if (connected) {
      if (accessToken !== undefined && accessToken.trim() !== '') {
        updateObj[`integrations.${provider}.accessToken`] = accessToken.trim();
      }
      if (phoneId !== undefined && phoneId.trim() !== '') {
        updateObj[`integrations.${provider}.phoneId`] = phoneId.trim();
      }
    } else {
      // Disconnecting clears credentials
      updateObj[`integrations.${provider}.accessToken`] = '';
      updateObj[`integrations.${provider}.phoneId`] = '';
    }

    const user = await User.findOneAndUpdate(
      { userId },
      { $set: updateObj },
      { new: true, upsert: true }
    ).lean();

    res.json(sanitizeIntegrations(user.integrations));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
