const store = require('../lib/tracker');
module.exports = async function(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Robots-Tag','noindex, nofollow');
  if (!store.authorized(req)) return res.status(401).json({error:'Please enter your admin key.'});
  if (!store.enabled()) return res.status(503).json({error:'Tracker is not active yet.'});
  try {
    if (req.method==='GET') {
      const inventory = await store.inventory();
      const limit = req.query?.export==='1' ? 10000 : 500;
      const orders = await store.query('SELECT id,created_at,expires_at,status,details,emails,tracking,carrier FROM pl_orders ORDER BY created_at DESC LIMIT $1',[limit]);
      const [counts] = await store.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status='pending')::int AS pending, count(*) FILTER (WHERE status='paid')::int AS paid, count(*) FILTER (WHERE emails->>'customer' IN ('failed','pending') OR emails->>'owner' IN ('failed','pending'))::int AS email_issues FROM pl_orders`);
      const events = await store.query('SELECT * FROM pl_events ORDER BY id DESC LIMIT 50');
      return res.status(200).json({orders,inventory,counts,events,checkedAt:new Date().toISOString(),limit});
    }
    if (req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
    const b=req.body || {};
    if (b.action==='status') {
      if (typeof b.id!=='string' || !['paid','shipped','cancelled'].includes(b.status) || (b.tracking && (typeof b.tracking!=='string' || b.tracking.length>150))) return res.status(400).json({error:'Invalid order update'});
      const order=await store.change(b.id,b.status,b.tracking || null,b.carrier || null);
      if (b.status==='paid' || b.status==='cancelled') await store.cancelReminder(order);
      return res.status(200).json({ok:true,order});
    }
    if (b.action==='stock') {
      if (typeof b.sku!=='string' || !Number.isInteger(b.on_hand) || !Number.isInteger(b.low_stock) || !Number.isInteger(b.version) || typeof b.restocking!=='boolean' || typeof b.reason!=='string' || b.reason.length>500) return res.status(400).json({error:'Invalid stock update'});
      const [row]=await store.query('SELECT pl_adjust_stock($1,$2,$3,$4,$5,$6) AS value',[b.sku,b.on_hand,b.low_stock,b.restocking,b.version,b.reason]);
      return res.status(200).json({ok:true,inventory:row.value});
    }
    return res.status(400).json({error:'Unknown action'});
  } catch (error) {
    const messages={STOCK_CHANGED:'Stock changed since you loaded the page. Refresh and try again.',INVALID_STOCK:'Count cannot be below reserved stock. Enter a reason and non-negative quantities.',INVALID_STATUS_CHANGE:'This order status cannot be changed that way. Refresh the page.',TRACKING_REQUIRED:'Enter a carrier and tracking number.',ORDER_NOT_FOUND:'Order not found.'};
    const code=Object.keys(messages).find(key=>error.message.includes(key));
    console.error('Tracker operation failed',code || 'database_unavailable');
    return res.status(code?409:503).json({error:messages[code] || 'Tracker is unavailable. Please retry; no success has been assumed.'});
  }
};
