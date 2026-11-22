const commas = require('../lib/commas');
module.exports = async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
  const chunks=[];let size=0;
  for await (const chunk of req) { const bytes=Buffer.from(chunk);size+=bytes.length;if(size>262144)return res.status(413).end();chunks.push(bytes); }
  const raw=Buffer.concat(chunks);
  if(!commas.verify(raw,req.headers['x-webhook-signature'],process.env.COMMAS_WEBHOOK_SECRET))return res.status(401).json({error:'Invalid signature'});
  try {await commas.settle(JSON.parse(raw.toString('utf8')));return res.status(200).json({ok:true});}
  catch {return res.status(503).json({error:'Payment could not be reconciled'});}
};
module.exports.config={api:{bodyParser:false}};
