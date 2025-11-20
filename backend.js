// backend.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");
const cors = require("cors");
const PDFDocument = require("pdfkit");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public")); // لمجلد الواجهة

// مجلد البيانات
const dataPath = path.join(__dirname, "data");
if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath);

// ملفات JSON
const files = {
  products: path.join(dataPath, "products.json"),
  suppliers: path.join(dataPath, "suppliers.json"),
  sales: path.join(dataPath, "sales.json"),
  purchases: path.join(dataPath, "purchases.json"),
  users: path.join(dataPath, "users.json"),
};

// إنشاء ملفات JSON إذا لم تكن موجودة
Object.values(files).forEach(file => {
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify([]));
});

// دوال مساعدة
const readJSON = (file) => JSON.parse(fs.readFileSync(file));
const writeJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// تسجيل الدخول
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const users = readJSON(files.users);
  const user = users.find(u => u.username === username && u.password === password);
  if (user) res.json({ success: true, role: user.role });
  else res.json({ success: false, message: "خطأ في اسم المستخدم أو كلمة المرور" });
});

// CRUD المنتجات
app.get("/api/products", (req, res) => res.json(readJSON(files.products)));
app.post("/api/products", (req, res) => {
  const products = readJSON(files.products);
  const newProduct = { id: Date.now(), ...req.body };
  products.push(newProduct);
  writeJSON(files.products, products);
  res.json(newProduct);
});
app.put("/api/products/:id", (req, res) => {
  const products = readJSON(files.products);
  const index = products.findIndex(p => p.id == req.params.id);
  if (index === -1) return res.status(404).json({ message: "غير موجود" });
  products[index] = { ...products[index], ...req.body };
  writeJSON(files.products, products);
  res.json(products[index]);
});
app.delete("/api/products/:id", (req, res) => {
  let products = readJSON(files.products);
  products = products.filter(p => p.id != req.params.id);
  writeJSON(files.products, products);
  res.json({ success: true });
});

// الموردين
app.get("/api/suppliers", (req, res) => res.json(readJSON(files.suppliers)));
app.post("/api/suppliers", (req, res) => {
  const suppliers = readJSON(files.suppliers);
  const newSupplier = { id: Date.now(), ...req.body };
  suppliers.push(newSupplier);
  writeJSON(files.suppliers, suppliers);
  res.json(newSupplier);
});
app.put("/api/suppliers/:id", (req, res) => {
  const suppliers = readJSON(files.suppliers);
  const index = suppliers.findIndex(p => p.id == req.params.id);
  if (index === -1) return res.status(404).json({ message: "غير موجود" });
  suppliers[index] = { ...suppliers[index], ...req.body };
  writeJSON(files.suppliers, suppliers);
  res.json(suppliers[index]);
});
app.delete("/api/suppliers/:id", (req, res) => {
  let suppliers = readJSON(files.suppliers);
  suppliers = suppliers.filter(p => p.id != req.params.id);
  writeJSON(files.suppliers, suppliers);
  res.json({ success: true });
});

// المبيعات
app.get("/api/sales", (req, res) => res.json(readJSON(files.sales)));
app.post("/api/sales", (req, res) => {
  const sales = readJSON(files.sales);
  const newSale = { id: Date.now(), ...req.body };
  sales.push(newSale);
  writeJSON(files.sales, sales);
  res.json(newSale);
});

// الفواتير PDF
app.get("/api/sales/pdf/:id", (req, res) => {
  const sales = readJSON(files.sales);
  const sale = sales.find(s => s.id == req.params.id);
  if (!sale) return res.status(404).send("غير موجود");
  const doc = new PDFDocument();
  res.setHeader("Content-disposition", `attachment; filename=facture_${sale.id}.pdf`);
  res.setHeader("Content-type", "application/pdf");
  doc.text("فاتورة مبيعات");
  doc.text(`ID: ${sale.id}`);
  doc.text(`المنتجات: ${JSON.stringify(sale.items)}`);
  doc.text(`المجموع: ${sale.total}`);
  doc.end();
  doc.pipe(res);
});

// إحصائيات (رسوم بيانية)
app.get("/api/stats", (req, res) => {
  const products = readJSON(files.products);
  const sales = readJSON(files.sales);
  const totalSales = sales.reduce((a,b)=>a+b.total,0);
  const totalProducts = products.length;
  res.json({ totalSales, totalProducts });
});

// تشغيل السيرفر
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
