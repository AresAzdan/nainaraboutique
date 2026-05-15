const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../../public/uploads/products');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer disk storage config
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename:    (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const fileFilter = (_req, file, cb) => {
  const allowed = /jpeg|jpg|png|webp|gif/;
  const ext  = allowed.test(path.extname(file.originalname).toLowerCase());
  const mime = allowed.test(file.mimetype);
  if (ext && mime) cb(null, true);
  else cb(new Error('Only image files are allowed (jpeg, jpg, png, webp, gif).'));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB per file
});

function getPublicBaseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');

  const forwardedProto = req.get('x-forwarded-proto');
  const host = req.get('x-forwarded-host') || req.get('host');
  const isLocalHost = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(host || '');
  const proto = forwardedProto
    ? forwardedProto.split(',')[0].trim()
    : (isLocalHost ? req.protocol : 'https');

  return `${proto}://${host}`.replace(/\/$/, '');
}

// POST /api/admin/upload
// Accepts: multipart/form-data with field name "images" (multiple files)
// Returns: { urls: ['http://...', ...] }
const uploadImages = [
  upload.array('images', 20), // up to 20 files at once
  (req, res) => {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded.' });
    }

    const baseUrl = getPublicBaseUrl(req);
    const urls = req.files.map(f => `${baseUrl}/uploads/products/${f.filename}`);
    
    res.json({ urls });
  },
];

module.exports = { uploadImages };
