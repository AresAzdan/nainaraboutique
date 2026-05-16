const db = require('../config/db');

const ProductModel = {
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
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().slice(0, 8);
    const { rows } = await db.query(
      `SELECT dp.product_id, MAX(d.percentage) AS discount_percent
       FROM discount_products dp
       JOIN discounts d ON d.id = dp.discount_id
       WHERE dp.product_id = ANY($1::int[])
         AND d.start_date <= $2 AND d.end_date >= $2
         AND d.start_time <= $3 AND d.end_time >= $3
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
      `SELECT p.*, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       ${where}
       ORDER BY p.created_at DESC
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
      };
    });
  },

  async findById(id) {
    const { rows } = await db.query(
      `SELECT p.*, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
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
    };
  },

  async create({ name, description, price, stock, image_url, category_id, images = [], color = '', weight = 500, sizes = [], size_stocks = {} }) {
    const primaryImage = images[0] || image_url || null;

    const { rows } = await db.query(
      `INSERT INTO products (name, description, price, stock, image_url, category_id, color, weight, sizes, size_stocks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [name, description, price, stock, primaryImage, category_id, color, weight,
       JSON.stringify(sizes), JSON.stringify(size_stocks)]
    );
    const product = rows[0];

    const allImages = images.length > 0 ? images : (image_url ? [image_url] : []);
    if (allImages.length > 0) await this._saveImages(product.id, allImages);

    return {
      ...product,
      images:      allImages,
      sizes:       product.sizes       || sizes,
      size_stocks: product.size_stocks || size_stocks,
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

    const allowed = ['name', 'description', 'price', 'stock', 'image_url', 'category_id', 'color', 'weight', 'sizes', 'size_stocks'];
    const updates = [];
    const values  = [];

    for (const key of allowed) {
      if (normalized[key] !== undefined && normalized[key] !== null) {
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
