// Isolated local browser test. No production credentials, customer data, or outbound emails.
process.env.NODE_ENV='test';process.env.TRACKER_ENABLED='true';process.env.DATABASE_URL='local-test';process.env.ADMIN_KEY='local-preview-only';process.env.BSB_NUMBER='000000';process.env.ACCOUNT_NUMBER='000000';process.env.CONFIRM_SECRET='local-preview-only';
const fs=require('fs'),http=require('http'),path=require('path');
const {PGlite}=require('@electric-sql/pglite');
const tracker=require('../lib/tracker');
async function main(){
 const db=new PGlite();await db.exec(fs.readFileSync(path.join(__dirname,'../db/tracker.sql'),'utf8'));
 tracker.setClientForTest({query:async(sql,params)=>(await db.query(sql,params)).rows});
 for(const [sku,entry]of Object.entries(require('../inventory.json')))await db.query('INSERT INTO pl_inventory(sku,name,on_hand) VALUES($1,$2,$3)',[sku,sku==='PL-001'?'Retatrutide 10mg':sku==='PL-002'?'BPC-157 10mg':sku,entry.stock]);
 global.fetch=async()=>{throw new Error('Email delivery deliberately disabled in local preview')};
 const order=require('../api/order'),admin=require('../api/tracker'),inventory=require('../api/inventory');
 let testResponse;await order({method:'POST',body:{email:'example@example.invalid',firstName:'Preview',lastName:'Customer',address1:'Local test address',suburb:'Melbourne',state:'VIC',postcode:'3000',country:'AU',items:[{id:'PL-001',qty:2}],checkoutKey:'local-preview-aaaaaaaa-bbbb-cccc'}},{setHeader(){},status(n){this.code=n;return this},json(v){testResponse=v;return this}});
 if(!testResponse?.orderSaved)throw new Error('Local checkout failed');
 http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');req.query=Object.fromEntries(url.searchParams);let body='';for await(const chunk of req)body+=chunk;req.body=body?JSON.parse(body):{};res.status=n=>{res.statusCode=n;return res};res.json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return res};res.send=data=>res.end(data);
  if(url.pathname==='/api/tracker')return await admin(req,res);
  if(url.pathname==='/api/order')return await order(req,res);
  if(url.pathname==='/api/inventory')return await inventory(req,res);
  if(url.pathname==='/'||url.pathname==='/admin'){res.setHeader('Content-Type','text/html');res.end(fs.readFileSync(path.join(__dirname,'../admin.html'),'utf8').replace('<main>','<main><div class="alert">LOCAL TEST PREVIEW · Simulated order · No customer emails sent</div>'));return}
  res.statusCode=404;res.end('Not found');
 }catch(e){console.error(e.message);res.statusCode=500;res.end('Local test error')}}).listen(4318,'127.0.0.1',()=>console.log('Isolated tracker preview http://127.0.0.1:4318/admin (key: local-preview-only)'));
}
main().catch(e=>{console.error(e);process.exitCode=1});
