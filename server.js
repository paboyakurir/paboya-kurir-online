import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const {Pool}=pg, app=express(), server=http.createServer(app);
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const io=new Server(server,{cors:{origin:process.env.CORS_ORIGIN||'*'}});
const PORT=Number(process.env.PORT||3000);
const SECRET=process.env.JWT_SECRET||'CHANGE_ME';
const RATE=Number(process.env.RATE_PER_KM||3500);
const JASTIP=Number(process.env.JASTIP_PER_POINT||2000);
const ADMIN=process.env.ADMIN_WHATSAPP||'6282190885988';
const ADMIN_KEY=process.env.ADMIN_KEY||'CHANGE_ADMIN_KEY';
const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);

app.use(cors({origin:process.env.CORS_ORIGIN||'*'})); app.use(express.json());

function auth(req,res,next){try{const t=(req.headers.authorization||'').replace('Bearer ','');req.user=jwt.verify(t,SECRET);next()}catch{res.status(401).json({error:'Token tidak valid'})}}
function sign(u){return jwt.sign(u,SECRET,{expiresIn:'30d'})}
const money=n=>Math.round(Number(n||0)*100)/100;
function total(km,p){return money(Number(km||0)*RATE+Number(p||0)*JASTIP)}

app.get('/api/health',(_,res)=>res.json({ok:true,service:'PABOYA KURIR',time:new Date().toISOString()}));
app.get('/api/config',(_,res)=>res.json({ratePerKm:RATE,jastipPerPoint:JASTIP,adminWhatsapp:ADMIN,googleMapsApiKey:process.env.GOOGLE_MAPS_API_KEY||''}));
app.post('/api/routes/compute',auth,async(req,res)=>{
 const {origin,destination}=req.body;
 if(!origin||!destination) return res.status(400).json({error:'Origin dan destination wajib diisi'});
 const key=process.env.GOOGLE_MAPS_API_KEY;
 if(!key) return res.status(503).json({error:'GOOGLE_MAPS_API_KEY belum diatur di server'});
 try{
   const rr=await fetch('https://routes.googleapis.com/directions/v2:computeRoutes',{
     method:'POST',
     headers:{
       'Content-Type':'application/json',
       'X-Goog-Api-Key':key,
       'X-Goog-FieldMask':'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline'
     },
     body:JSON.stringify({
       origin:{location:{latLng:{latitude:Number(origin.lat),longitude:Number(origin.lng)}}},
       destination:{location:{latLng:{latitude:Number(destination.lat),longitude:Number(destination.lng)}}},
       travelMode:'TWO_WHEELER',
       routingPreference:'TRAFFIC_AWARE',
       computeAlternativeRoutes:true,
       languageCode:'id',
       units:'METRIC'
     })
   });
   const data=await rr.json();
   if(!rr.ok) return res.status(502).json({error:'Google Routes API gagal',details:data});
   const routes=(data.routes||[]).map((r,i)=>({
     index:i,
     distanceKm:Math.round((Number(r.distanceMeters||0)/1000)*100)/100,
     duration:r.duration||null,
     polyline:r.polyline?.encodedPolyline||''
   }));
   res.json({routes});
 }catch(e){res.status(500).json({error:'Gagal menghubungi Google Routes API',details:e.message})}
});

app.post('/api/auth/admin',async(req,res)=>{
 const {key}=req.body;
 if(!key || key!==ADMIN_KEY) return res.status(401).json({error:'Kunci admin salah'});
 res.json({user:{id:0,name:'Admin PABOYA',role:'admin'},token:sign({id:0,role:'admin',phone:'admin'})});
});

app.post('/api/auth/guest',async(req,res)=>{
 const {name,phone,role='customer'}=req.body;
 if(!name||!phone)return res.status(400).json({error:'Nama dan nomor wajib diisi'});
 if(!['customer','courier'].includes(role))return res.status(400).json({error:'Role tidak valid'});
 const q=await pool.query(`INSERT INTO users(name,phone,role) VALUES($1,$2,$3)
 ON CONFLICT(phone) DO UPDATE SET name=EXCLUDED.name RETURNING id,name,phone,role`,[name,phone,role]);
 const u=q.rows[0];res.json({user:u,token:sign({id:u.id,role:u.role,phone:u.phone})});
});

app.post('/api/orders',auth,async(req,res)=>{
 const {pickup,destination,distanceKm,jastipPoints=0,pickupLat,pickupLng,destinationLat,destinationLng,notes=''}=req.body;
 if(!pickup||!destination||distanceKm==null)return res.status(400).json({error:'Data rute belum lengkap'});
 const q=await pool.query(`INSERT INTO orders(customer_id,pickup,destination,distance_km,jastip_points,
 pickup_lat,pickup_lng,destination_lat,destination_lng,notes,total,status)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'MENUNGGU_KURIR') RETURNING *`,
 [req.user.id,pickup,destination,distanceKm,jastipPoints,pickupLat??null,pickupLng??null,destinationLat??null,destinationLng??null,notes,total(distanceKm,jastipPoints)]);
 const o=q.rows[0]; io.emit('order:new',o);
 res.status(201).json({...o,whatsappAdmin:`https://wa.me/${ADMIN}?text=${encodeURIComponent(`PABOYA KURIR - ORDER #${o.id}\nJemput: ${o.pickup}\nTujuan: ${o.destination}\nJarak: ${o.distance_km} km\nTotal: Rp${Number(o.total).toLocaleString('id-ID')}`)}`});
});

app.get('/api/orders',auth,async(req,res)=>{
 let sql=`SELECT o.*,u.name customer_name,u.phone customer_phone FROM orders o JOIN users u ON u.id=o.customer_id`;
 let args=[];
 if(req.user.role==='customer'){sql+=` WHERE o.customer_id=$1`;args=[req.user.id]}
 if(req.user.role==='courier'){sql+=` WHERE o.courier_id=$1 OR o.status='MENUNGGU_KURIR'`;args=[req.user.id]}
 if(req.user.role==='admin'){sql+=` WHERE 1=1`;}
 sql+=` ORDER BY o.created_at DESC LIMIT 300`;
 res.json((await pool.query(sql,args)).rows);
});

app.post('/api/orders/:id/accept',auth,async(req,res)=>{
 if(req.user.role!=='courier')return res.status(403).json({error:'Khusus kurir'});
 const q=await pool.query(`UPDATE orders SET courier_id=$1,status='DITERIMA',accepted_at=NOW(),updated_at=NOW()
 WHERE id=$2 AND status='MENUNGGU_KURIR' RETURNING *`,[req.user.id,req.params.id]);
 if(!q.rowCount)return res.status(409).json({error:'Order sudah diambil'});
 io.emit('order:update',q.rows[0]);res.json(q.rows[0]);
});

app.patch('/api/orders/:id/status',auth,async(req,res)=>{
 const allowed=['MENUJU_JEMPUT','BARANG_DIAMBIL','MENUJU_TUJUAN','SELESAI','DIBATALKAN'];
 if(!allowed.includes(req.body.status))return res.status(400).json({error:'Status tidak valid'});
 const q=await pool.query(`UPDATE orders SET status=$1,updated_at=NOW()
 WHERE id=$2 AND (customer_id=$3 OR courier_id=$3) RETURNING *`,
 [req.body.status,req.params.id,req.user.id]);
 if(!q.rowCount)return res.status(404).json({error:'Order tidak ditemukan'});
 io.emit('order:update',q.rows[0]);res.json(q.rows[0]);
});

app.post('/api/couriers/location',auth,async(req,res)=>{
 if(req.user.role!=='courier')return res.status(403).json({error:'Khusus kurir'});
 const {lat,lng,online=true}=req.body;if(lat==null||lng==null)return res.status(400).json({error:'GPS wajib'});
 await pool.query(`INSERT INTO courier_locations(courier_id,lat,lng,online,updated_at) VALUES($1,$2,$3,$4,NOW())
 ON CONFLICT(courier_id) DO UPDATE SET lat=$2,lng=$3,online=$4,updated_at=NOW()`,[req.user.id,lat,lng,online]);
 io.emit('courier:location',{courierId:req.user.id,lat,lng,online});
 res.json({ok:true});
});

app.get('/api/couriers/nearby',auth,async(req,res)=>{
 const lat=Number(req.query.lat),lng=Number(req.query.lng),radius=Number(req.query.radius||10);
 if(!Number.isFinite(lat)||!Number.isFinite(lng))return res.status(400).json({error:'Koordinat tidak valid'});
 const q=await pool.query(`SELECT u.id,u.name,u.phone,c.lat,c.lng,c.online,
 (6371*acos(least(1,cos(radians($1))*cos(radians(c.lat))*cos(radians(c.lng)-radians($2))+sin(radians($1))*sin(radians(c.lat))))) AS distance_km
 FROM courier_locations c JOIN users u ON u.id=c.courier_id
 WHERE c.online=true ORDER BY distance_km LIMIT 20`,[lat,lng]);
 res.json(q.rows.filter(x=>Number(x.distance_km)<=radius));
});

app.get('/api/admin/stats',auth,async(req,res)=>{
 if(req.user.role!=='admin') return res.status(403).json({error:'Khusus admin'});
 const [a,b,c]=await Promise.all([pool.query(`SELECT COUNT(*)::int count FROM orders`),pool.query(`SELECT COALESCE(SUM(total),0) total FROM orders WHERE status='SELESAI'`),pool.query(`SELECT COUNT(*)::int count FROM courier_locations WHERE online=true`)]);
 res.json({orders:a.rows[0].count,revenue:Number(b.rows[0].total),onlineCouriers:c.rows[0].count});
});

app.get('/api/orders/:id/receipt',auth,async(req,res)=>{
 const q=await pool.query(`SELECT o.*,u.name customer_name,u.phone customer_phone FROM orders o JOIN users u ON u.id=o.customer_id WHERE o.id=$1`,[req.params.id]);
 if(!q.rowCount)return res.status(404).json({error:'Tidak ditemukan'});
 const o=q.rows[0];res.json({brand:'PABOYA KURIR',order:o,tariff:{perKm:RATE,jastipPerPoint:JASTIP}});
});

io.use((s,n)=>{try{s.user=jwt.verify(s.handshake.auth?.token,SECRET);n()}catch{n(new Error('Unauthorized'))}});
io.on('connection',s=>{s.join(`user:${s.user.id}`);s.join(`role:${s.user.role}`);s.emit('server:ready',{ok:true})});


const publicRoot=path.resolve(__dirname,'../../apps');
app.use('/pelanggan',express.static(path.join(publicRoot,'pelanggan')));
app.use('/kurir',express.static(path.join(publicRoot,'kurir')));
app.use('/admin',express.static(path.join(publicRoot,'admin')));
app.get('/',(_,res)=>res.send(`<!doctype html><html lang="id"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PABOYA KURIR</title><style>body{font-family:Arial;background:#f4f6f8;text-align:center;padding:40px}a{display:block;max-width:360px;margin:12px auto;padding:16px;background:#111827;color:white;text-decoration:none;border-radius:12px;font-weight:bold}</style><h1>🚚 PABOYA KURIR</h1><p>Sistem kurir online</p><a href="/pelanggan/">📦 Pesan sebagai Pelanggan</a><a href="/kurir/">🛵 Aplikasi Kurir</a><a href="/admin/">🖥️ Dashboard Admin</a></html>`));

async function db(){
 await pool.query(`CREATE TABLE IF NOT EXISTS users(id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,phone TEXT UNIQUE NOT NULL,role TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS orders(id BIGSERIAL PRIMARY KEY,customer_id BIGINT REFERENCES users(id),courier_id BIGINT REFERENCES users(id),pickup TEXT NOT NULL,destination TEXT NOT NULL,distance_km NUMERIC(10,2) NOT NULL,jastip_points INT DEFAULT 0,pickup_lat DOUBLE PRECISION,pickup_lng DOUBLE PRECISION,destination_lat DOUBLE PRECISION,destination_lng DOUBLE PRECISION,notes TEXT DEFAULT '',total NUMERIC(14,2) NOT NULL,status TEXT NOT NULL DEFAULT 'MENUNGGU_KURIR',created_at TIMESTAMPTZ DEFAULT NOW(),accepted_at TIMESTAMPTZ,updated_at TIMESTAMPTZ DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS courier_locations(courier_id BIGINT PRIMARY KEY REFERENCES users(id),lat DOUBLE PRECISION NOT NULL,lng DOUBLE PRECISION NOT NULL,online BOOLEAN DEFAULT TRUE,updated_at TIMESTAMPTZ DEFAULT NOW());`);
}
db().then(()=>server.listen(PORT,()=>console.log(`PABOYA realtime server :${PORT}`))).catch(e=>{console.error(e);process.exit(1)});
