import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createIncidentAi} from './incident-ai.mjs';
import {createAlertApi} from './alerts.mjs';

const key = process.env.GEMINI_API_KEY?.trim();
const model = process.env.GEMINI_MODEL?.trim() || 'gemini-3.1-flash-lite';
if (!/^gemini-[a-z0-9.\-]+$/.test(model)) throw new Error('Set GEMINI_MODEL to a valid Gemini model ID.');
const port = Number(process.env.PORT || 4173);
const localOrigin = `http://127.0.0.1:${port}`;
const files = {
  '/':['index.html','text/html; charset=utf-8'],
  '/style.css':['style.css','text/css; charset=utf-8'],
  '/aurelis-icon.png':['aurelis-icon.png','image/png'],
  '/aurelis-mark.png':['aurelis-mark.png','image/png'],
  '/app.mjs':['app.mjs','text/javascript; charset=utf-8'],
  '/data.mjs':['data.mjs','text/javascript; charset=utf-8'],
  '/simulations.mjs':['simulations.mjs','text/javascript; charset=utf-8'],
  '/reports.mjs':['reports.mjs','text/javascript; charset=utf-8'],
};

function json(response,status,data) {
  response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  response.end(JSON.stringify(data));
}
const alerts = createAlertApi({port,json});

const incidentAi = createIncidentAi({key,model,localOrigin,json});

createServer(async (request,response)=>{
  try {
    const pathname = new URL(request.url,localOrigin).pathname;
    if (request.method === 'GET' && pathname === '/api/status') return json(response,200,{gemini:Boolean(key)});
    if (request.method === 'POST' && pathname === '/api/report-analysis') return await incidentAi(request,response,'report');
    if (request.method === 'POST' && ['/api/ask','/api/analysis','/api/resolution'].includes(pathname)) {
      return await incidentAi(request,response,pathname==='/api/resolution' ? 'resolution' : pathname==='/api/analysis');
    }
    if (pathname.startsWith('/api/alerts/')) return await alerts(request,response,pathname);
    const asset = files[pathname];
    if (request.method !== 'GET' || !Array.isArray(asset)) return json(response,404,{error:'Not found.'});
    const [name, type] = asset;
    const contents = await readFile(new URL('./public/' + name,import.meta.url));
    response.writeHead(200,{
      'Content-Type':type,
      'Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'same-origin',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    });
    response.end(contents);
  } catch {
    if (!response.headersSent) json(response,500,{error:'The local server could not complete the request.'});
    else response.end();
  }
}).listen(port,'127.0.0.1',()=>{
  console.log(`A U R E L I S · ${localOrigin} · ${key ? 'Gemini configured' : 'demo mode'}`);
});
