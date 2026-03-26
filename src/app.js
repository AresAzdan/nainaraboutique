require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const authRoutes     = require('./routes/authRoutes');
const productRoutes  = require('./routes/productRoutes');
const cartRoutes     = require('./routes/cartRoutes');
const orderRoutes    = require('./routes/orderRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const adminRoutes    = require('./routes/adminRoutes');
const paymentRoutes  = require('./routes/paymentRoutes');
const returnRoutes   = require('./routes/returnRoutes');
const reviewRoutes   = require('./routes/reviewRoutes');

const { handleNotification } = require('./controllers/paymentController');
const { validatePromoCode } = require('./controllers/promoController');
const { getHomepage } = require('./controllers/settingsController');
const shippingRoutes = require('./routes/shippingRoutes');
const { authenticate } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

// ─── Global Middleware ────────────────────────────────────────────────────────

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    const allowed = [
      'http://localhost:3000',
      'https://nainaraboutique.vercel.app',
      process.env.FRONTEND_URL,
    ].filter(Boolean);
    const isVercelPreview = /^https:\/\/nainaraboutique(-[a-z0-9-]+)?\.vercel\.app$/.test(origin);
    if (allowed.includes(origin) || isVercelPreview) return callback(null, true);
    return callback(new Error('CORS blocked: ' + origin));
  },
  credentials: true
}));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// ─── Serve Uploaded Files ─────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// ─── Request Logger (dev-friendly) ───────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Public Webhook ───────────────────────────────────────────────────────────
app.post('/api/payments/notification', handleNotification);

// ─── Public Promo Validation ─────────────────────────────────────────────────
app.post('/api/promo-codes/validate', authenticate, validatePromoCode);

// ─── Public Homepage Settings ────────────────────────────────────────────────
app.get('/api/homepage', getHomepage);

const cors = require('cors');

app.use(cors({
  origin: ['https://nainaraboutique.vercel.app'],
  credentials: true
}));

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth',       authRoutes);
app.use('/api/products',   productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/cart',       cartRoutes);
app.use('/api/orders',     orderRoutes);
app.use('/api/admin',      adminRoutes);
app.use('/api/payments',   paymentRoutes);
app.use('/api/shipping',   shippingRoutes);
app.use('/api/returns',    returnRoutes);
app.use('/api',            reviewRoutes);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ message: 'Route not found.' });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀  Server running on http://localhost:${PORT}`);
  console.log(`📋  Environment: ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = app;
