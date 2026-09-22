const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const {PGlite}=require('@electric-sql/pglite');
let db;
before(async()=>{db=new PGlite();await db.exec(fs.readFileSync('db/tracker.sql','utf8'));});
after(async()=>db.close());
async function seed(){await db.exec('TRUNCATE pl_events,pl_order_items,pl_orders,pl_inventory RESTART IDENTITY CASCADE');await db.query("INSERT INTO pl_inventory(sku,name,on_hand) VALUES('A','Product A',5),('B','Product B',10)");}
async function create(id='one',key='key-one',items={A:2},fingerprint='same'){return (await db.query('SELECT pl_create_order($1,$2,$3,$4,$5) AS value',[id,key,fingerprint,JSON.stringify({total:100}),JSON.stringify(items)])).rows[0].value;}
async function stock(sku='A'){return(await db.query('SELECT * FROM pl_inventory WHERE sku=$1',[sku])).rows[0];}
async function change(id,status,tracking=null,carrier=null){return(await db.query('SELECT pl_change_order($1,$2,$3,$4) AS value',[id,status,tracking,carrier])).rows[0].value;}
test('order and reservations persist together',async()=>{await seed();const o=await create();assert.equal(o.status,'pending');assert.equal((await stock()).reserved,2);assert.equal((await db.query('SELECT * FROM pl_events')).rows.length,1)});
test('same checkout retries return original order and do not reserve twice',async()=>{await seed();await create();const o=await create('different');assert.equal(o.id,'one');assert.equal(o.replayed,true);assert.equal((await stock()).reserved,2)});
test('same request key with changed payload is rejected',async()=>{await seed();await create();await assert.rejects(create('different','key-one',{A:3},'changed'),/IDEMPOTENCY_CONFLICT/);assert.equal((await stock()).reserved,2)});
test('out of stock rolls back entire order and all reservations',async()=>{await seed();await assert.rejects(create('one','key-one',{A:2,B:11}),/OUT_OF_STOCK/);assert.equal((await stock()).reserved,0);assert.equal((await db.query('SELECT * FROM pl_orders')).rows.length,0)});
test('competing checkouts cannot oversell',async()=>{await seed();const results=await Promise.allSettled([create('one','one',{A:4}),create('two','two',{A:4})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await stock()).reserved,4)});
test('payment retains reservation; dispatch removes physical and reserved stock once',async()=>{await seed();await create();await change('one','paid');assert.equal((await stock()).reserved,2);await change('one','shipped','TEST-123','Australia Post');await change('one','shipped','TEST-123','Australia Post');const s=await stock();assert.equal(s.on_hand,3);assert.equal(s.reserved,0)});
test('unpaid order cannot dispatch and dispatch requires tracking',async()=>{await seed();await create();await assert.rejects(change('one','shipped','TEST','Australia Post'),/INVALID_STATUS_CHANGE/);await change('one','paid');await assert.rejects(change('one','shipped'),/TRACKING_REQUIRED/)});
test('cancel releases reservation once',async()=>{await seed();await create();await change('one','cancelled');await change('one','cancelled');assert.equal((await stock()).on_hand,5);assert.equal((await stock()).reserved,0);await assert.rejects(change('one','paid'),/INVALID_STATUS_CHANGE/)});
test('expiry releases only unpaid expired orders',async()=>{await seed();await create();await create('paid','paid',{A:1});await change('paid','paid');await db.query("UPDATE pl_orders SET expires_at=now()-interval '1 hour'");await db.query('SELECT pl_expire_orders()');assert.equal((await stock()).reserved,1);assert.equal((await db.query("SELECT status FROM pl_orders WHERE id='one'")).rows[0].status,'expired')});
test('stock adjustment detects stale counts and protects reservations',async()=>{await seed();await create();await assert.rejects(db.query("SELECT pl_adjust_stock('A',8,5,false,1,'new delivery')"),/STOCK_CHANGED/);await assert.rejects(db.query("SELECT pl_adjust_stock('A',1,5,false,2,'physical count')"),/INVALID_STOCK/);await db.query("SELECT pl_adjust_stock('A',8,5,false,2,'new delivery')");assert.equal((await stock()).on_hand,8)});
test('restocking and unknown products cannot be purchased',async()=>{await seed();await db.query("UPDATE pl_inventory SET restocking=true WHERE sku='A'");await assert.rejects(create(),/OUT_OF_STOCK/);await assert.rejects(create('two','two',{UNKNOWN:1}),/OUT_OF_STOCK/)});
test('empty cart cannot be persisted',async()=>{await seed();await assert.rejects(create('one','one',{}),/INVALID_ITEMS/)});
