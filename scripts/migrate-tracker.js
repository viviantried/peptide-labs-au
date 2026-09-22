// Run with the target environment loaded. Existing stock counts are never overwritten.
const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const sql = neon(process.env.DATABASE_URL);
  const schema = fs.readFileSync(path.join(__dirname,'../db/tracker.sql'),'utf8');
  const statements = schema.split(/(?=^CREATE (?:TABLE|INDEX|OR REPLACE FUNCTION))/m).filter(s=>s.trim());
  await sql.transaction(statements.map(s=>sql.query(s)));
  const inventory = JSON.parse(fs.readFileSync(path.join(__dirname,'../inventory.json'),'utf8'));
  const names = {'PL-001':'Retatrutide 10mg','PL-002':'BPC-157 10mg','PL-003':'TB-500 5mg','PL-004':'Tesamorelin 5mg','PL-005':'Semax 10mg','PL-006':'Selank 10mg','PL-007':'DSIP 5mg','PL-008':'Melanotan-2 10mg','PL-009':'Melanotan-1 10mg','PL-011':'NAD+ 500mg','PL-012':'GHK-Cu 50mg','PL-013':'Glutathione 1500mg','PL-014':'BAC Water 10ml','PL-015':'Research Starter Kit'};
  await sql.transaction(Object.entries(inventory).map(([sku,entry])=>sql.query('INSERT INTO pl_inventory(sku,name,on_hand,low_stock,restocking) VALUES($1,$2,$3,$4,$5) ON CONFLICT(sku) DO NOTHING',[sku,names[sku]||sku,typeof entry==='number'?entry:entry.stock,Math.max(5,(entry.weekly_sold||0)*2),entry.restocking===true])));
  const [counts]=await sql.query('SELECT (SELECT count(*)::int FROM pl_inventory) AS products,(SELECT count(*)::int FROM pl_orders) AS orders');
  console.log('Tracker schema and initial stock ready:',counts);
}
main().catch(e=>{console.error('Migration failed:',e.message);process.exitCode=1});
