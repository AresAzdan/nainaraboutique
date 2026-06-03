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
const { validatePromoCode }  = require('./controllers/promoController');
const { adminDeleteOrder }    = require('./controllers/orderController');
const { getHomepage }        = require('./controllers/settingsController');
const shippingRoutes         = require('./routes/shippingRoutes');
const { router: devEmailPreviewRoutes } = require('./routes/devEmailPreviewRoutes');
const { authenticate, authorizeAdmin } = require('./middleware/auth');
const { errorHandler }       = require('./middleware/errorHandler');

const app = express();

// ─── CORS — registered FIRST, before every route and middleware ───────────────
// WHY: cors() must run before any route handler so that:
//   1. Pre-flight OPTIONS requests are answered immediately with the correct
//      Access-Control-Allow-Origin header.
//   2. If a downstream route crashes (503), the CORS header is already set,
//      so the browser sees a 503 — not a confusing "CORS error".
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://nainaraboutique.com',
  'https://www.nainaraboutique.com',
  'https://admin.nainaraboutique.com',
  process.env.FRONTEND_URL,
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // server-to-server / Midtrans webhook
    const isVercelPreview =
      /^https:\/\/nainaraboutique(-[a-z0-9-]+)?\.vercel\.app$/.test(origin);
    if (ALLOWED_ORIGINS.includes(origin) || isVercelPreview)
      return callback(null, true);
    return callback(new Error('CORS blocked: ' + origin));
  },
  credentials: true,
};

app.use(cors(corsOptions));

// Explicitly handle pre-flight OPTIONS for every route.
// Without this, a browser OPTIONS probe that hits a crashed route gets no
// CORS header and the browser misreports the real error as a CORS failure.
app.options('*', cors(corsOptions));

// ─── Body Parsers ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// ─── Static Files ─────────────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// ─── Request Logger ───────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}


// ─── Public Root Assets (favicon/manifest/robots) ───────────────────────────
app.get('/favicon.ico', (_req, res) => {
  res.sendFile(path.join(__dirname, '../favicon.ico'));
});
app.get('/favicon-48x48.png', (_req, res) => {
  res.sendFile(path.join(__dirname, '../favicon-192x192.png'));
});
app.get('/apple-touch-icon.png', (_req, res) => {
  res.sendFile(path.join(__dirname, '../favicon-192x192.png'));
});
app.get('/site.webmanifest', (_req, res) => {
  res.sendFile(path.join(__dirname, '../site.webmanifest'));
});
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').sendFile(path.join(__dirname, '../robots.txt'));
});

// ─── Dev-only Email Preview ──────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.use('/dev/email-preview', devEmailPreviewRoutes);
}

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Public Webhook (Midtrans) ────────────────────────────────────────────────
app.post('/api/payments/notification', handleNotification);

// ─── Public Promo Validation ─────────────────────────────────────────────────
app.post('/api/promo-codes/validate', authenticate, validatePromoCode);

// ─── Public Homepage Settings ────────────────────────────────────────────────
app.get('/api/homepage', getHomepage);

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth',       authRoutes);
app.use('/api/products',   productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/cart',       cartRoutes);
app.use('/api/orders',     orderRoutes);
// Keep the admin order delete endpoint registered directly as well as through
// adminRoutes so live deployments do not fall through to the generic 404.
app.delete('/api/admin/orders/:id', authenticate, authorizeAdmin, adminDeleteOrder);
app.use('/api/admin',      adminRoutes);
app.use('/api/payments',   paymentRoutes);
app.use('/api/shipping',   shippingRoutes);
app.use('/api/returns',    returnRoutes);
app.use('/api',            reviewRoutes);

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ message: 'Route not found.' });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Process-level safety nets ────────────────────────────────────────────────
// WHY: Without these, a single unhandled rejection (e.g. querying a missing
// table like `product_reviews`) kills the Node process on Railway → SIGTERM →
// the *next* request gets a 503 with no CORS headers → browser reports "CORS
// error" even though the real cause is a dead server.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] Server kept alive:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] Server kept alive:', err);
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀  Server running on http://localhost:${PORT}`);
  console.log(`📋  Environment: ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = app;
