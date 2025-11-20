/**
 * Inventory System – Single File Server
 * Storage: JSON Files
 * Author: ChatGPT
 */

const express = require("express");
const fs = require("fs-extra");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());

// ----------- PATHS -------------
const DB = "./data";
const FILES = {
  products: `${DB}/products.json`,
  suppliers: `${DB}/suppliers.json`,
  purchases: `${DB}/purchases.json`,
  sales: `${DB}/sales.json`,
  debts: `${DB}/debts.json`,
};

// ----------- INITIALIZE -------------
fs.ensureDirSync(DB);
Object.values(FILES).forEach((file) => {
  if (!fs.existsSync(file)) fs.writeJsonSync(file, []);
});

const read = (file) => fs.readJsonSync(file);
const write = (file, data) => fs.writeJsonSync(file, data, { spaces: 2 });

/* ============================= PRODUCTS ============================= */

app.get("/api/products", (req, res) => {
  res.json(read(FILES.products));
});

app.post("/api/products", (req, res) => {
  let products = read(FILES.products);

  const item = {
    id: Date.now(),
    name: req.body.name,
    stock: req.body.stock || 0,
    cost: req.body.cost || 0,
    price: req.body.price || 0,
  };

  products.push(item);
  write(FILES.products, products);
  res.json({ ok: true, item });
});

/* ============================= SUPPLIERS ============================= */

app.get("/api/suppliers", (req, res) => {
  res.json(read(FILES.suppliers));
});

app.post("/api/suppliers", (req, res) => {
  let suppliers = read(FILES.suppliers);

  const item = {
    id: Date.now(),
    name: req.body.name,
    phone: req.body.phone || "",
    balance: 0,
  };

  suppliers.push(item);
  write(FILES.suppliers, suppliers);

  res.json({ ok: true, item });
});

/* ============================= PURCHASES ============================= */

app.post("/api/purchase", (req, res) => {
  let purchases = read(FILES.purchases);
  let products = read(FILES.products);
  let suppliers = read(FILES.suppliers);

  const { productId, supplierId, qty, cost } = req.body;

  const product = products.find((p) => p.id == productId);
  const supplier = suppliers.find((s) => s.id == supplierId);

  if (!product || !supplier) return res.json({ ok: false });

  product.stock += qty;
  supplier.balance += qty * cost;

  const item = {
    id: Date.now(),
    productId,
    supplierId,
    qty,
    cost,
    total: qty * cost,
    date: new Date(),
  };

  purchases.push(item);

  write(FILES.products, products);
  write(FILES.suppliers, suppliers);
  write(FILES.purchases, purchases);

  res.json({ ok: true, item });
});

/* ============================= SALES ============================= */

app.post("/api/sale", (req, res) => {
  let sales = read(FILES.sales);
  let products = read(FILES.products);

  const { productId, qty, price } = req.body;

  const product = products.find((p) => p.id == productId);
  if (!product) return res.json({ ok: false });

  if (product.stock < qty) return res.json({ ok: false, msg: "No stock" });

  product.stock -= qty;

  const item = {
    id: Date.now(),
    productId,
    qty,
    price,
    total: qty * price,
    date: new Date(),
  };

  sales.push(item);

  write(FILES.products, products);
  write(FILES.sales, sales);

  res.json({ ok: true, item });
});

/* ============================= DASHBOARD ============================= */

app.get("/api/dashboard", (req, res) => {
  let sales = read(FILES.sales);
  let purchases = read(FILES.purchases);
  let products = read(FILES.products);

  const totalSales = sales.reduce((s, v) => s + v.total, 0);
  const totalPurchases = purchases.reduce((s, v) => s + v.total, 0);
  const profit = totalSales - totalPurchases;

  res.json({
    totalProducts: products.length,
    totalSales,
    totalPurchases,
    profit,
  });
});

/* ============================= FRONTEND ============================= */

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

/* ============================= RUN ============================= */

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("SERVER RUNNING PORT", PORT));
