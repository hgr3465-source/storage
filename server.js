/**
 * Full Inventory system - single server.js
 * File-based JSON storage (data/)
 * Provides REST API + serves React build from client/build
 */

const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const lockfile = require('proper-lockfile');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(bodyParser.json());
app.use(require('cors')());

// --- Paths ---
const DATA_DIR = path.join(__dirname, 'data');
const TRANSACTIONS_DIR = path.join(DATA_DIR, 'transactions');
const CLIENT_BUILD = path.join(__dirname, 'client', 'build');

fs.ensureDirSync(DATA_DIR);
fs.ensureDirSync(TRANSACTIONS_DIR);

// Files
const FILES = {
  products: path.join(DATA_DIR, 'products.json'),
  suppliers: path.join(DATA_DIR, 'suppliers.json'),
  balances: path.join(DATA_DIR, 'balances.json'),
  payables: path.join(DATA_DIR, 'payables.json')
};

// Init files if missing
Object.values(FILES).forEach(f => {
  if (!fs.existsSync(f)) fs.writeJsonSync(f, {}, { spaces: 2 });
});

// --- Helpers: atomic write + with lock ---
async function atomicWriteJson(filePath, obj) {
  const tmp = filePath + '.tmp.' + process.pid;
  const text = JSON.stringify(obj, null, 2);
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, filePath);
}

async function withLock(filePath, fn) {
  // ensure dir exists
  await fs.ensureDir(path.dirname(filePath));
  const release = await lockfile.lock(filePath, { retries: { retries: 5, minTimeout: 20 } });
  try {
    return await fn();
  } finally {
    await release();
  }
}

async function readJsonSafe(filePath) {
  try {
    return await fs.readJson(filePath);
  } catch (e) {
    return {};
  }
}

async function writeJsonSafe(filePath, obj) {
  await withLock(filePath, async () => {
    await atomicWriteJson(filePath, obj);
  });
}

// Transaction files (append-only)
async function writeTransaction(tx) {
  const fname = `${Date.now()}_${uuidv4()}.json`;
  const full = path.join(TRANSACTIONS_DIR, fname);
  await atomicWriteJson(full, tx);
}

// --- Basic stores ---
async function getProducts() { return await readJsonSafe(FILES.products); }
async function saveProducts(obj) { await writeJsonSafe(FILES.products, obj); }
async function getSuppliers() { return await readJsonSafe(FILES.suppliers); }
async function saveSuppliers(obj) { await writeJsonSafe(FILES.suppliers, obj); }
async function getBalances() { return await readJsonSafe(FILES.balances); }
async function saveBalances(obj) { await writeJsonSafe(FILES.balances, obj); }
async function getPayables() { return await readJsonSafe(FILES.payables); }
async function savePayables(obj) { await writeJsonSafe(FILES.payables, obj); }

// --- Costing helpers (simple FIFO/Average using purchase transactions) ---
async function loadPurchaseBatches(productId, warehouseId) {
  const files = await fs.readdir(TRANSACTIONS_DIR);
  const batches = [];
  for (const f of files) {
    try {
      const obj = await fs.readJson(path.join(TRANSACTIONS_DIR, f));
      if (obj.type === 'PURCHASE' && obj.productId === productId && obj.warehouseId === warehouseId) batches.push(obj);
    } catch (e) { /* ignore */ }
  }
  batches.sort((a,b) => a.timestamp - b.timestamp);
  return batches;
}

async function computeCOGS_FIFO(productId, warehouseId, qty) {
  const batches = await loadPurchaseBatches(productId, warehouseId);
  let remaining = qty;
  let cogs = 0;
  for (const b of batches) {
    const available = (b.remaining !== undefined) ? b.remaining : b.quantity;
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    cogs += take * b.unitCost;
    remaining -= take;
    if (remaining <= 0) break;
  }
  if (remaining > 0) throw new Error('Insufficient stock for FIFO');
  return cogs;
}

async function computeCOGS_Avg(productId, warehouseId, qty) {
  const batches = await loadPurchaseBatches(productId, warehouseId);
  let totalQty = 0, totalCost = 0;
  for (const b of batches) {
    const available = (b.remaining !== undefined) ? b.remaining : b.quantity;
    totalQty += available;
    totalCost += available * b.unitCost;
  }
  if (totalQty < qty) throw new Error('Insufficient stock for AVG');
  const avg = totalCost / totalQty;
  return avg * qty;
}

// ---------- ROUTES (API) ----------

// Health
app.get('/api/health', (req,res) => res.json({ ok: true }));

// PRODUCTS
app.get('/api/products', async (req,res) => {
  const p = await getProducts();
  res.json(Object.values(p));
});

app.post('/api/products', async (req,res) => {
  const body = req.body;
  if (!body.name) return res.status(400).json({ error: 'name required' });
  const products = await getProducts();
  const id = uuidv4();
  products[id] = {
    id, name: body.name, sku: body.sku||'', unit: body.unit||'pcs',
    defaultCost: body.defaultCost||0, price: body.price||0, createdAt: Date.now()
  };
  await saveProducts(products);
  res.json(products[id]);
});

app.put('/api/products/:id', async (req,res) => {
  const id = req.params.id;
  const products = await getProducts();
  if (!products[id]) return res.status(404).json({ error: 'not found' });
  products[id] = { ...products[id], ...req.body };
  await saveProducts(products);
  res.json(products[id]);
});

app.delete('/api/products/:id', async (req,res) => {
  const id = req.params.id;
  const products = await getProducts();
  if (!products[id]) return res.status(404).json({ error: 'not found' });
  delete products[id];
  await saveProducts(products);
  res.json({ ok: true });
});

// SUPPLIERS
app.get('/api/suppliers', async (req,res) => res.json(Object.values(await getSuppliers())));
app.post('/api/suppliers', async (req,res) => {
  const body = req.body;
  if (!body.name) return res.status(400).json({ error: 'name required' });
  const suppliers = await getSuppliers();
  const id = uuidv4();
  suppliers[id] = { id, name: body.name, contact: body.contact||null, creditLimit: body.creditLimit||0, createdAt: Date.now() };
  await saveSuppliers(suppliers);
  res.json(suppliers[id]);
});

// PURCHASE (increase balances + payables)
app.post('/api/purchase', async (req,res) => {
  try {
    const { productId, warehouseId='default', supplierId, quantity, unitCost, reference } = req.body;
    if (!productId || !supplierId || !quantity || !unitCost) return res.status(400).json({ error: 'missing fields' });

    const products = await getProducts();
    if (!products[productId]) return res.status(400).json({ error: 'invalid product' });

    const balances = await getBalances();
    balances[productId] = balances[productId] || {};
    balances[productId][warehouseId] = (balances[productId][warehouseId] || 0) + quantity;
    await saveBalances(balances);

    const tx = { id: uuidv4(), type: 'PURCHASE', productId, warehouseId, supplierId, quantity, unitCost, totalCost: quantity*unitCost, reference: reference||null, timestamp: Date.now(), remaining: quantity };
    await writeTransaction(tx);

    const payables = await getPayables();
    payables[supplierId] = payables[supplierId] || { amount:0, invoices:[] };
    payables[supplierId].amount += quantity*unitCost;
    payables[supplierId].invoices.push({ id: tx.id, amount: tx.totalCost, reference: tx.reference, timestamp: tx.timestamp });
    await savePayables(payables);

    res.json({ ok:true, tx });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PAY supplier
app.post('/api/payables/pay', async (req,res) => {
  try {
    const { supplierId, amount, reference } = req.body;
    if (!supplierId || !amount) return res.status(400).json({ error: 'missing fields' });
    const payables = await getPayables();
    if (!payables[supplierId]) return res.status(400).json({ error: 'no payable' });
    payables[supplierId].amount -= amount;
    if (payables[supplierId].amount < 0) payables[supplierId].amount = 0;
    payables[supplierId].payments = payables[supplierId].payments || [];
    payables[supplierId].payments.push({ id: uuidv4(), amount, reference: reference||null, timestamp: Date.now() });
    await savePayables(payables);
    res.json({ ok:true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// SALE (decrease balances, compute COGS)
app.post('/api/sale', async (req,res) => {
  try {
    const { productId, warehouseId='default', quantity, unitPrice, costingMethod='FIFO' } = req.body;
    if (!productId || !quantity || !unitPrice) return res.status(400).json({ error: 'missing fields' });

    const balances = await getBalances();
    const avail = ((balances[productId]||{})[warehouseId]) || 0;
    if (avail < quantity) return res.status(400).json({ error: 'insufficient stock', available: avail });

    let cogs = 0;
    if ((costingMethod||'FIFO').toUpperCase() === 'FIFO') cogs = await computeCOGS_FIFO(productId, warehouseId, quantity);
    else cogs = await computeCOGS_Avg(productId, warehouseId, quantity);

    const tx = { id: uuidv4(), type: 'SALE', productId, warehouseId, quantity, unitPrice, totalRevenue: quantity*unitPrice, cogs, timestamp: Date.now() };
    await writeTransaction(tx);

    balances[productId][warehouseId] = avail - quantity;
    await saveBalances(balances);

    // for FIFO reduce remaining in purchase files
    if ((costingMethod||'FIFO').toUpperCase() === 'FIFO') {
      const files = await fs.readdir(TRANSACTIONS_DIR);
      files.sort();
      let remainingToConsume = quantity;
      for (const f of files) {
        const full = path.join(TRANSACTIONS_DIR, f);
        const obj = await fs.readJson(full);
        if (obj.type === 'PURCHASE' && obj.productId === productId && obj.warehouseId === warehouseId) {
          obj.remaining = (obj.remaining !== undefined) ? obj.remaining : obj.quantity;
          if (obj.remaining <= 0) continue;
          const take = Math.min(obj.remaining, remainingToConsume);
          obj.remaining -= take;
          remainingToConsume -= take;
          await atomicWriteJson(full, obj);
          if (remainingToConsume === 0) break;
        }
      }
    }

    res.json({ ok:true, tx });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// BALANCES / PAYABLES
app.get('/api/balances', async (req,res) => res.json(await getBalances()));
app.get('/api/payables', async (req,res) => res.json(await getPayables()));

// TRANSACTIONS (last N)
app.get('/api/transactions', async (req,res) => {
  const files = await fs.readdir(TRANSACTIONS_DIR);
  files.sort();
  const last = files.slice(-200);
  const out = [];
  for (const f of last) {
    try { out.push(await fs.readJson(path.join(TRANSACTIONS_DIR, f))); } catch(e){}
  }
  res.json(out.reverse());
});

// REPORTS: P&L (from,to timestamps)
app.get('/api/report/pnl', async (req,res) => {
  const from = parseInt(req.query.from) || 0;
  const to = parseInt(req.query.to) || Date.now();
  const files = await fs.readdir(TRANSACTIONS_DIR);
  let revenue=0, cogs=0, purchases=0;
  for (const f of files) {
    try {
      const obj = await fs.readJson(path.join(TRANSACTIONS_DIR,f));
      if (obj.timestamp < from || obj.timestamp > to) continue;
      if (obj.type === 'SALE') { revenue += (obj.totalRevenue||0); cogs += (obj.cogs||0); }
      if (obj.type === 'PURCHASE') purchases += (obj.totalCost||0);
    } catch(e){}
  }
  res.json({ revenue, cogs, purchases, grossProfit: revenue - cogs });
});

// REPORT: product movements
app.get('/api/report/product/:productId', async (req,res) => {
  const pid = req.params.productId;
  const files = await fs.readdir(TRANSACTIONS_DIR);
  const out = [];
  for (const f of files) {
    try {
      const obj = await fs.readJson(path.join(TRANSACTIONS_DIR,f));
      if (obj.productId === pid) out.push(obj);
    } catch(e){}
  }
  res.json(out);
});

// Serve client build (if exists)
if (fs.existsSync(CLIENT_BUILD)) {
  app.use(express.static(CLIENT_BUILD));
  app.get('*', (req,res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API endpoint not found' });
    res.sendFile(path.join(CLIENT_BUILD, 'index.html'));
  });
} else {
  // serve a tiny UI landing if build absent
  app.get('/', (req,res) => res.send('<h3>Inventory API running. Client build not found. Build client and place in /client/build</h3>'));
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server listening on', PORT));
