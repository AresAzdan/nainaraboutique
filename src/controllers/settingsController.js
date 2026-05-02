const SettingsModel = require('../models/settingsModel');
const { createError } = require('../middleware/errorHandler');

// GET /api/homepage — public, returns homepage config for customer site
const getHomepage = async (req, res, next) => {
  try {
    const data = await SettingsModel.get('homepage');
    const baseUrl = process.env.APP_URL || 'https://nainaraboutique.com';
    if (!data) {
      return res.json({
        logo_url: '',
        hero_image: '',
        hero_title: 'Welcome',
        hero_subtitle: '',
        hero_badge: '',
        hero_button_text: 'Shop Now',
        hero_button_link: 'shop',
        highlights: []
      });
    }
    // Fix localhost URLs → production URL
    const fixUrl = (url) => {
      if (!url) return url;
      return url.replace(/https?:\/\/localhost:\d+/g, baseUrl);
    };
    const fixed = {
      ...data,
      logo_url:   fixUrl(data.logo_url),
      hero_image: fixUrl(data.hero_image),
      highlights: (data.highlights || []).map(h => ({ ...h, image: fixUrl(h.image) })),
    };
    res.json(fixed);
  } catch (err) {
    next(err);
  }
};

// PUT /api/admin/homepage — admin only, update homepage config
const updateHomepage = async (req, res, next) => {
  try {
    const baseUrl = process.env.APP_URL || 'https://nainaraboutique.com';
    const fixUrl = (url) => {
      if (!url) return url;
      return url.replace(/https?:\/\/localhost:\d+/g, baseUrl);
    };
    const {
      logo_url,
      hero_image,
      hero_title,
      hero_subtitle,
      hero_badge,
      hero_button_text,
      hero_button_link,
      highlights
    } = req.body;

    // Validate highlights array
    if (highlights && !Array.isArray(highlights)) {
      throw createError(400, 'highlights must be an array.');
    }

    if (highlights) {
      for (const h of highlights) {
        if (!h.image || !h.name) {
          throw createError(400, 'Each highlight must have an image and name.');
        }
      }
    }

    const current = await SettingsModel.get('homepage') || {};

    const updated = {
      logo_url:         fixUrl(logo_url         ?? current.logo_url         ?? ''),
      hero_image:       fixUrl(hero_image       ?? current.hero_image       ?? ''),
      hero_title:       hero_title       ?? current.hero_title       ?? '',
      hero_subtitle:    hero_subtitle    ?? current.hero_subtitle    ?? '',
      hero_badge:       hero_badge       ?? current.hero_badge       ?? '',
      hero_button_text: hero_button_text ?? current.hero_button_text ?? '',
      hero_button_link: hero_button_link ?? current.hero_button_link ?? '',
      highlights:       (highlights ?? current.highlights ?? []).map(h => ({ ...h, image: fixUrl(h.image) })),
    };

    await SettingsModel.set('homepage', updated);

    res.json({ message: 'Homepage updated successfully.', data: updated });
  } catch (err) {
    next(err);
  }
};

module.exports = { getHomepage, updateHomepage };
