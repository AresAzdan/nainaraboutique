# 🛒 E-Commerce REST API

A production-ready e-commerce backend built with **Node.js**, **Express**, **PostgreSQL**, and **JWT Authentication**. Clean MVC architecture, beginner-friendly code, with full admin and user feature sets.

---

## 📁 Project Structure

```
ecommerce-api/
├── src/
│   ├── app.js                   # Entry point — Express app setup
│   ├── config/
│   │   └── db.js                # PostgreSQL connection pool
│   ├── controllers/             # Business logic layer
│   │   ├── authController.js
│   │   ├── productController.js
│   │   ├── categoryController.js
│   │   ├── cartController.js
│   │   └── orderController.js
│   ├── middleware/
│   │   ├── auth.js              # JWT verify + role check
│   │   ├── errorHandler.js      # Global error handler + createError()
│   │   └── validate.js          # Required fields validator
│   ├── models/                  # Database query layer
│   │   ├── userModel.js
│   │   ├── productModel.js
│   │   ├── categoryModel.js
│   │   ├── cartModel.js
│   │   └── orderModel.js
│   └── routes/
│       ├── authRoutes.js
│       ├── productRoutes.js
│       ├── categoryRoutes.js
│       ├── cartRoutes.js
│       ├── orderRoutes.js
│       └── adminRoutes.js
├── schema.sql                   # Full DB schema + seed data
├── .env.example                 # Environment variable template
├── package.json
└── README.md
```

---

## ⚙️ Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [PostgreSQL](https://www.postgresql.org/) v14+

---

## 🚀 Getting Started

### 1. Clone and install dependencies

```bash
git clone <your-repo-url>
cd ecommerce-api
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` with your actual values:

```env
PORT=3000
NODE_ENV=development

DB_HOST=localhost
DB_PORT=5432
DB_NAME=ecommerce_db
DB_USER=postgres
DB_PASSWORD=your_password_here

JWT_SECRET=your_super_secret_jwt_key_change_this_in_production
JWT_EXPIRES_IN=7d
```

> ⚠️ **Never commit your `.env` file.** It's already in `.gitignore`.

### 3. Create the database

```bash
psql -U postgres -c "CREATE DATABASE ecommerce_db;"
```

### 4. Run the SQL schema

```bash
psql -U postgres -d ecommerce_db -f schema.sql
```

This creates all tables and seeds:
- A default **admin** account: `admin@example.com` / `password`
- Sample categories: Electronics, Clothing, Books, Home & Garden

> ⚠️ Change the admin password immediately after setup!

### 5. Start the server

```bash
# Development (auto-restarts on file changes)
npm run dev

# Production
npm start
```

The API will be available at: `http://localhost:3000`

---

## 🔑 Authentication

The API uses **JWT Bearer tokens**. After login or register, include the token in every protected request:

```
Authorization: Bearer <your_token_here>
```

### Roles

| Role    | Capabilities                                    |
|---------|-------------------------------------------------|
| `user`  | Browse products, manage cart, place/view orders |
| `admin` | All user capabilities + full product/order CRUD |

---

## 📋 API Reference

### 🔐 Auth

| Method | Endpoint          | Auth | Description          |
|--------|-------------------|------|----------------------|
| POST   | `/api/auth/register` | ❌  | Register new user    |
| POST   | `/api/auth/login`    | ❌  | Login (user/admin)   |
| GET    | `/api/auth/me`       | ✅  | Get current user     |

#### Register
```json
POST /api/auth/register
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "password": "secret123"
}
```

#### Login
```json
POST /api/auth/login
{
  "email": "admin@example.com",
  "password": "password"
}
```

---

### 📦 Products (Public)

| Method | Endpoint              | Auth | Description           |
|--------|-----------------------|------|-----------------------|
| GET    | `/api/products`       | ❌   | List products         |
| GET    | `/api/products/:id`   | ❌   | Get single product    |

**Query parameters for GET /api/products:**
- `category_id` — filter by category
- `search` — search by name or description
- `page` — page number (default: 1)
- `limit` — items per page (default: 20)

```
GET /api/products?search=laptop&category_id=1&page=1&limit=10
```

---

### 🗂️ Categories (Public)

| Method | Endpoint           | Auth | Description        |
|--------|--------------------|------|--------------------|
| GET    | `/api/categories`  | ❌   | List all categories|

---

### 🛒 Cart (User)

| Method | Endpoint                  | Auth | Description           |
|--------|---------------------------|------|-----------------------|
| GET    | `/api/cart`               | ✅   | View cart             |
| POST   | `/api/cart`               | ✅   | Add item to cart      |
| PUT    | `/api/cart/:product_id`   | ✅   | Update item quantity  |
| DELETE | `/api/cart/:product_id`   | ✅   | Remove item           |

#### Add to Cart
```json
POST /api/cart
{
  "product_id": 1,
  "quantity": 2
}
```

---

### 📝 Orders (User)

| Method | Endpoint           | Auth | Description              |
|--------|--------------------|------|--------------------------|
| POST   | `/api/orders`      | ✅   | Place order (from cart)  |
| GET    | `/api/orders`      | ✅   | View all my orders       |
| GET    | `/api/orders/:id`  | ✅   | View single order        |

> **Placing an order** creates the order from all items in your cart and clears the cart. Stock is reserved but not deducted until an admin marks the order as **"paid"**.

---

### 🔧 Admin Routes

All admin routes require `Authorization: Bearer <admin_token>`.

#### Products

| Method | Endpoint                   | Description      |
|--------|----------------------------|------------------|
| POST   | `/api/admin/products`      | Create product   |
| PUT    | `/api/admin/products/:id`  | Update product   |
| DELETE | `/api/admin/products/:id`  | Delete product   |

```json
POST /api/admin/products
{
  "name": "Mechanical Keyboard",
  "description": "RGB, TKL layout",
  "price": 89.99,
  "stock": 50,
  "image_url": "https://example.com/keyboard.jpg",
  "category_id": 1
}
```

#### Categories

| Method | Endpoint                      | Description       |
|--------|-------------------------------|-------------------|
| POST   | `/api/admin/categories`       | Create category   |
| PUT    | `/api/admin/categories/:id`   | Update category   |
| DELETE | `/api/admin/categories/:id`   | Delete category   |

#### Orders

| Method | Endpoint                         | Description         |
|--------|----------------------------------|---------------------|
| GET    | `/api/admin/orders`              | List all orders     |
| GET    | `/api/admin/orders/:id`          | Get order detail    |
| PUT    | `/api/admin/orders/:id/status`   | Update order status |

**Valid statuses:** `pending` → `paid` → `shipped` → `completed` (or `cancelled`)

```json
PUT /api/admin/orders/5/status
{
  "status": "paid"
}
```

> 🔔 **Inventory auto-deduction:** When an order status changes to `"paid"`, stock is automatically deducted for all items in that order. If any product has insufficient stock, the update is rejected and the transaction is rolled back.

---

## 🏗️ Key Design Decisions

### Transactions for Orders
Order creation and status updates (especially to `paid`) use PostgreSQL transactions to ensure:
- Cart clearing + order creation are atomic
- Stock deduction + status update are atomic
- No partial state if something fails

### Price Snapshot
When an order is created, the current price of each product is stored in `order_items.price`. This means future price changes don't retroactively alter historical orders.

### Cart Upsert
Adding an existing item to the cart increments quantity using `ON CONFLICT DO UPDATE` — no duplicate cart rows.

### Dynamic Updates
`ProductModel.update()` builds a dynamic SQL `SET` clause — only provided fields are updated, so you can PATCH a single field without touching others.

---

## 🔒 Security Features

- Passwords hashed with **bcrypt** (10 salt rounds)
- JWT tokens expire after 7 days (configurable)
- Role-based access control on all sensitive routes
- Environment variables via **dotenv** (no secrets in code)
- SQL injection prevention via **parameterized queries** throughout

---

## 🧪 Testing with curl

```bash
# Register
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@test.com","password":"pass123"}'

# Login as admin
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password"}'

# Get products
curl http://localhost:3000/api/products

# Add to cart (replace TOKEN)
curl -X POST http://localhost:3000/api/cart \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"product_id":1,"quantity":2}'

# Place order
curl -X POST http://localhost:3000/api/orders \
  -H "Authorization: Bearer TOKEN"
```

Or use [Postman](https://postman.com) / [Insomnia](https://insomnia.rest) for a GUI experience.

---

## 📦 Dependencies

| Package       | Purpose                           |
|---------------|-----------------------------------|
| `express`     | Web framework                     |
| `pg`          | PostgreSQL client                 |
| `bcrypt`      | Password hashing                  |
| `jsonwebtoken`| JWT creation and verification     |
| `dotenv`      | Environment variable loading      |
| `cors`        | Cross-Origin Resource Sharing     |
| `nodemon`     | Dev auto-restart (devDependency)  |
