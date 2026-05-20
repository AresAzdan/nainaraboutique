const db = require('../config/db');
const SizeGuideModel = require('./sizeGuideModel');

const ProductModel = {

  _buildSizeGuide(row) {
    if (row.size_guide_id && row.size_guide_name) {
      return {
        id: row.size_guide_id,
        name: row.size_guide_name,
        columns: Array.isArray(row.saved_size_guide_columns) ? row.saved_size_guide_columns : [],
        rows: Array.isArray(row.saved_size_guide_rows) ? row.saved_size_guide_rows : [],
      };
    }
    if (row.size_guide_data && typeof row.size_guide_data === 'object') {
      return {
        id: null,
        name: row.size_guide_data.name || 'Size Guide',
        columns: Array.isArray(row.size_guide_data.columns) ? row.size_guide_data.columns : [],
        rows: Array.isArray(row.size_guide_data.rows) ? row.size_guide_data.rows : [],
      };
    }
    return null;
  },

  async _resolveSizeGuideInput({ size_guide_id, size_guide_data, save_size_guide, size_guide_name } = {}) {
    if (size_guide_id) {
      return { sizeGuideId: Number(size_guide_id), sizeGuideData: null };
    }

    const hasCustomGuide = size_guide_data
      && Array.isArray(size_guide_data.columns)
      && size_guide_data.columns.length > 0
      && Array.isArray(size_guide_data.rows)
      && size_guide_data.rows.length > 0;

    if (!hasCustomGuide) {
      return { sizeGuideId: null, sizeGuideData: null };
    }

    const guidePayload = {
      name: String(size_guide_name || size_guide_data.name || 'Custom Size Guide').trim(),
      columns: size_guide_data.columns,
      rows: size_guide_data.rows,
    };

    if (save_size_guide) {
      const guide = await SizeGuideModel.create(guidePayload);
      return { sizeGuideId: guide.id, sizeGuideData: null };
    }

    return { sizeGuideId: null, sizeGuideData: guidePayload };
  },
  // ── Helper: fetch images for one or many product IDs ──────────────────────
  async _getImages(productIds) {
    if (!productIds.length) return {};
    const { rows } = await db.query(
      `SELECT product_id, url FROM product_images
       WHERE product_id = ANY($1::int[])
       ORDER BY product_id, sort_order`,
      [productIds]
    );
    const map = {};
    for (const row of rows) {
      if (!map[row.product_id]) map[row.product_id] = [];
      map[row.product_id].push(row.url);
    }
    return map;
  },

  // Helper: get active discount percent for a set of product IDs
  async _getActiveDiscounts(productIds) {
    if (!productIds.length) return {};
    // Keep discount evaluation in WIB to match admin discount scheduling.
    const now = new Date();
    const wibNow = new Date(now.getTime() + (now.getTimezoneOffset() + 420) * 60000);
    const dateStr = wibNow.toISOString().split('T')[0];
    const timeStr = wibNow.toTimeString().slice(0, 8);
    const { rows } = await db.query(
      `SELECT dp.product_id, MAX(d.percentage) AS discount_percent
       FROM discount_products dp
       JOIN discounts d ON d.id = dp.discount_id
       WHERE dp.product_id = ANY($1::int[])
         AND (
           d.start_date < $2
           OR (d.start_date = $2 AND d.start_time <= $3)
         )
         AND (
           d.end_date > $2
           OR (d.end_date = $2 AND d.end_time >= $3)
         )
       GROUP BY dp.product_id`,
      [productIds, dateStr, timeStr]
    );
    const map = {};
    for (const row of rows) {
      map[row.product_id] = parseFloat(row.discount_percent);
    }
    return map;
  },

  // Helper: get product IDs that sold > 5 units in last 14 days (best sellers)
  async _getHotProductIds(productIds) {
    if (!productIds.length) return new Set();
    const { rows } = await db.query(
      `SELECT oi.product_id
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.product_id = ANY($1::int[])
         AND o.status IN ('paid', 'processing', 'shipped', 'completed')
         AND o.created_at >= NOW() - INTERVAL '14 days'
       GROUP BY oi.product_id
       HAVING SUM(oi.quantity) > 5`,
      [productIds]
    );
    return new Set(rows.map(r => r.product_id));
  },

  async findAll({ category_id, search, page = 1, limit } = {}) {
    const conditions = [];
    const values = [];

    if (category_id) {
      values.push(category_id);
      conditions.push(`p.category_id = $${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      conditions.push(`(p.name ILIKE $${values.length} OR p.description ILIKE $${values.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    let pagination = '';

    if (limit) {
      const offset = (page - 1) * limit;
      values.push(limit, offset);
      pagination = `LIMIT $${values.length - 1} OFFSET $${values.length}`;
    }

    const { rows } = await db.query(
      `SELECT p.*, c.name AS category_name,
              sg.name AS size_guide_name,
              sg.columns AS saved_size_guide_columns,
              sg.rows AS saved_size_guide_rows
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN size_guides sg ON sg.id = p.size_guide_id
       ${where}
       ORDER BY
         CASE WHEN p.stock <= 0 THEN 1 ELSE 0 END ASC,
         p.created_at DESC,
         p.id DESC
       ${pagination}`,
      values
    );

    const ids = rows.map(r => r.id);
    const imagesMap    = await this._getImages(ids);
    const discountMap  = await this._getActiveDiscounts(ids);
    const hotIds       = await this._getHotProductIds(ids);
    const now          = new Date();

    return rows.map(row => {
      const discountPercent = discountMap[row.id] || null;
      const originalPrice   = discountPercent ? parseFloat(row.price) : null;
      const finalPrice      = discountPercent
        ? Math.round(parseFloat(row.price) * (1 - discountPercent / 100))
        : parseFloat(row.price);
      // is_new: uploaded within last 30 days
      const createdAt = new Date(row.created_at);
      const isNew = (now - createdAt) < 30 * 24 * 60 * 60 * 1000;
      // is_hot: sold > 5 units in last 14 days
      const isHot = hotIds.has(row.id);
      return {
        ...row,
        images:           imagesMap[row.id] || (row.image_url ? [row.image_url] : []),
        sizes:            row.sizes       || [],
        size_stocks:      row.size_stocks || {},
        color:            row.color       || '',
        weight:           row.weight      || 500,
        discount:         discountPercent ? `${discountPercent}%` : null,
        discount_percent: discountPercent,
        original_price:   originalPrice,
        price:            finalPrice,
        is_new:           isNew,
        is_hot:           isHot,
        size_guide_id:    row.size_guide_id || null,
        size_guide_data:  row.size_guide_data || null,
        size_guide:       this._buildSizeGuide(row),
      };
    });
  },

  async findById(id) {
    const { rows } = await db.query(
      `SELECT p.*, c.name AS category_name,
              sg.name AS size_guide_name,
              sg.columns AS saved_size_guide_columns,
              sg.rows AS saved_size_guide_rows
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN size_guides sg ON sg.id = p.size_guide_id
       WHERE p.id = $1`,
      [id]
    );
    if (!rows[0]) return null;

    const imagesMap = await this._getImages([rows[0].id]);
    const discountMap = await this._getActiveDiscounts([rows[0].id]);
    const discountPercent = discountMap[rows[0].id] || null;
    const originalPrice   = discountPercent ? parseFloat(rows[0].price) : null;
    const finalPrice      = discountPercent
      ? Math.round(parseFloat(rows[0].price) * (1 - discountPercent / 100))
      : parseFloat(rows[0].price);

    return {
      ...rows[0],
      images:           imagesMap[rows[0].id] || (rows[0].image_url ? [rows[0].image_url] : []),
      sizes:            rows[0].sizes       || [],
      size_stocks:      rows[0].size_stocks || {},
      color:            rows[0].color       || '',
      weight:           rows[0].weight      || 500,
      discount:         discountPercent ? `${discountPercent}%` : null,
      discount_percent: discountPercent,
      original_price:   originalPrice,
      price:            finalPrice,
      size_guide_id:    rows[0].size_guide_id || null,
      size_guide_data:  rows[0].size_guide_data || null,
      size_guide:       this._buildSizeGuide(rows[0]),
    };
  },

  async create({ name, description, price, stock, image_url, category_id, images = [], color = '', weight = 500, sizes = [], size_stocks = {}, size_guide_id = null, size_guide_data = null, save_size_guide = false, size_guide_name = '' }) {
    const primaryImage = images[0] || image_url || null;
    const { sizeGuideId, sizeGuideData } = await this._resolveSizeGuideInput({ size_guide_id, size_guide_data, save_size_guide, size_guide_name });

    const { rows } = await db.query(
      `INSERT INTO products (name, description, price, stock, image_url, category_id, color, weight, sizes, size_stocks, size_guide_id, size_guide_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [name, description, price, stock, primaryImage, category_id, color, weight,
       JSON.stringify(sizes), JSON.stringify(size_stocks), sizeGuideId, sizeGuideData ? JSON.stringify(sizeGuideData) : null]
    );
    const product = rows[0];

    const allImages = images.length > 0 ? images : (image_url ? [image_url] : []);
    if (allImages.length > 0) await this._saveImages(product.id, allImages);

    return {
      ...product,
      images:      allImages,
      sizes:       product.sizes       || sizes,
      size_stocks: product.size_stocks || size_stocks,
      size_guide_id: product.size_guide_id || null,
      size_guide_data: product.size_guide_data || null,
      size_guide: this._buildSizeGuide(product),
    };
  },

  async update(id, fields) {
    const { images, ...rest } = fields;

    // Map all accepted fields (camelCase + snake_case both accepted)
    const normalized = {
      name:        rest.name,
      description: rest.description,
      price:       rest.price,
      stock:       rest.stock,
      image_url:   rest.image_url  || rest.image       || undefined,
      category_id: rest.category_id || rest.categoryId || undefined,
      color:       rest.color      !== undefined ? rest.color  : undefined,
      weight:      rest.weight     !== undefined ? rest.weight : undefined,
      sizes:       rest.sizes      !== undefined ? JSON.stringify(rest.sizes)       : undefined,
      size_stocks: rest.size_stocks !== undefined ? JSON.stringify(rest.size_stocks) : undefined,
    };

    if (rest.size_guide_id !== undefined || rest.size_guide_data !== undefined || rest.save_size_guide !== undefined) {
      const { sizeGuideId, sizeGuideData } = await this._resolveSizeGuideInput(rest);
      normalized.size_guide_id = sizeGuideId;
      normalized.size_guide_data = sizeGuideData ? JSON.stringify(sizeGuideData) : null;
    }

    const allowed = ['name', 'description', 'price', 'stock', 'image_url', 'category_id', 'color', 'weight', 'sizes', 'size_stocks', 'size_guide_id', 'size_guide_data'];
    const updates = [];
    const values  = [];

    for (const key of allowed) {
      if (normalized[key] !== undefined && (normalized[key] !== null || key === 'size_guide_id' || key === 'size_guide_data')) {
        values.push(normalized[key]);
        updates.push(`${key} = $${values.length}`);
      }
    }

    let product;
    if (updates.length > 0) {
      values.push(id);
      const { rows } = await db.query(
        `UPDATE products SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
        values
      );
      product = rows[0] || null;
      if (!product) return null;
    } else {
      const { rows } = await db.query('SELECT * FROM products WHERE id = $1', [id]);
      product = rows[0] || null;
      if (!product) return null;
    }

    // Update images if provided
    if (Array.isArray(images) && images.length > 0) {
      await db.query('DELETE FROM product_images WHERE product_id = $1', [id]);
      await this._saveImages(id, images);
      await db.query('UPDATE products SET image_url = $1 WHERE id = $2', [images[0], id]);
      product.image_url = images[0];
    }

    const imagesMap = await this._getImages([product.id]);
    return {
      ...product,
      images:      imagesMap[product.id] || (product.image_url ? [product.image_url] : []),
      sizes:       product.sizes       || [],
      size_stocks: product.size_stocks || {},
      color:       product.color       || '',
      weight:      product.weight      || 500,
      size_guide_id: product.size_guide_id || null,
      size_guide_data: product.size_guide_data || null,
      size_guide: this._buildSizeGuide(product),
    };
  },

  async _saveImages(productId, urls) {
    for (let i = 0; i < urls.length; i++) {
      await db.query(
        'INSERT INTO product_images (product_id, url, sort_order) VALUES ($1, $2, $3)',
        [productId, urls[i], i]
      );
    }
  },

  async delete(id) {
    const { rowCount } = await db.query('DELETE FROM products WHERE id = $1', [id]);
    return rowCount > 0;
  },

  async deductStock(productId, quantity, client) {
    const { rows } = await client.query(
      `UPDATE products
       SET stock = stock - $1
       WHERE id = $2 AND stock >= $1
       RETURNING stock`,
      [quantity, productId]
    );
    return rows[0] || null;
  },
};

module.exports = ProductModel;
