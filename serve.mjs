// 미리보기 서버. 설치할 것 없음: node serve.mjs [포트]
// 내 PC 안에서만 열린다(127.0.0.1). 바깥 주소로 나가는 요청은 없다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

const text = (res, code, msg) => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }); res.end(msg); };
// 본문을 상한까지만 받는다. 넘으면 끊는다.
const readBody = (req, limit) => new Promise((ok, no) => {
  const chunks = []; let size = 0;
  req.on('data', (c) => { size += c.length; if (size > limit) { req.destroy(); no(new Error('너무 커')); } else chunks.push(c); });
  req.on('end', () => ok(Buffer.concat(chunks))); req.on('error', no);
});

export function startServer(port = 5173) {
  const server = http.createServer(async (req, res) => {
    try {
      // 이 PC 의 이 페이지에서 온 요청만 받는다(다른 웹페이지가 몰래 부르는 것을 막는다)
      const host = req.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return text(res, 403, 'forbidden');
      if (req.method === 'POST' && req.headers.origin && req.headers.origin !== 'http://' + host) return text(res, 403, 'forbidden');
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/__rooms') {
        const dir = path.join(root, 'rooms');
        const list = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'room.json'))) : [];
        // 가장 최근에 고친 방이 먼저(처음 열리는 방). 압축을 막 풀어 예시끼리 시각이 비슷하면 이름순(example-bedroom 이 먼저)
        const mt = Object.fromEntries(list.map((n) => [n, fs.statSync(path.join(dir, n, 'room.json')).mtimeMs])), ex = (n) => n.startsWith('example-');
        list.sort((a, b) => (ex(a) && ex(b) && Math.abs(mt[a] - mt[b]) < 600000 ? a.localeCompare(b) : mt[b] - mt[a]));
        res.writeHead(200, { 'content-type': TYPES['.json'] }); return res.end(JSON.stringify(list));
      }
      if (url.pathname === '/__new' && req.method === 'POST') {       // 빈 방 하나를 새로 만든다(흔한 값. 화면의 꾸미기 → 방 탭에서 실측으로 고친다)
        const name = url.searchParams.get('room') || '', dir = path.join(root, 'rooms', name);
        const qw = url.searchParams.get('w'), qd = url.searchParams.get('d'), given = qw != null || qd != null;
        const inRange = (v) => v != null && Number(v) >= 1 && Number(v) <= 15;
        const bad = !/^[\w가-힣-]+$/.test(name) ? '방 이름은 글자·숫자·하이픈만 써 줘' : fs.existsSync(dir) ? '같은 이름의 방이 이미 있어'
          : given && !(inRange(qw) && inRange(qd)) ? '가로·세로는 둘 다 100~1500cm 사이로 적어 줘' : '';
        if (bad) return text(res, 400, bad);
        const w = given ? Math.round(Number(qw) * 100) / 100 : 3, d = given ? Math.round(Number(qd) * 100) / 100 : 3.5, ww = Math.min(1.6, w - 0.6);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'room.json'), JSON.stringify({
          version: 1, name, prompt: '화면에서 새로 만든 방',
          assumptions: [given ? '가로·세로는 입력한 값. 나머지(천장, 문·창 크기와 위치, 조명)는 흔한 값으로 채움' : '전부 기본값. 꾸미기 → 방 탭에서 실측 치수로 고칠 것', '방위: 창이 있는 벽을 남쪽(S)으로 가정'],
          style: 'wood-minimal', environment: { time: '13:00', season: 'spring', view: 'city', elevation: 12 },
          room: { w, d, h: 2.3, floor: '@floor', wall: '@wall', ceiling: '@ceiling', blocks: [] },
          openings: [{ type: 'door', wall: 'N', offset: 0.1, width: 0.9, height: 2.1, hinge: 'start', swing: 'in', open: 0 },
            { type: 'window', wall: 'S', offset: +((w - ww) / 2).toFixed(2), width: +ww.toFixed(2), height: 1.2, sill: 0.9, curtain: 'none' }],
          furniture: [], lights: [{ type: 'ceiling', x: +(w / 2).toFixed(2), z: +(d / 2).toFixed(2), lumens: Math.round((w * d * 330) / 100) * 100, temp: 4000, on: 'auto' }],
          start: { x: +(w / 2).toFixed(2), z: 0.6, yaw: 180, pitch: -5 }, views: [],
        }, null, 2) + '\n');
        return text(res, 200, 'ok');
      }
      if (url.pathname === '/__save' && req.method === 'POST') {      // 화면에서 바꾼 것을 room.json 에 적는다
        const name = url.searchParams.get('room') || '';
        const target = path.join(root, 'rooms', name, 'room.json');
        if (!/^[\w가-힣-]+$/.test(name) || !fs.existsSync(target)) return text(res, 400, '없는 방이야');
        let body; try { body = (await readBody(req, 2e6)).toString('utf8'); if (!JSON.parse(body).room) throw 0; } catch { return text(res, 400, '방 사양이 아니야'); }
        fs.writeFileSync(target, body);
        return text(res, 200, 'ok');
      }
      if (url.pathname === '/__shot' && req.method === 'POST') {      // 화면 캡처 저장(tools/shot.mjs 가 쓴다). PNG 만
        let name = path.basename(url.searchParams.get('name') || 'shot.png').replace(/[^\w.\-가-힣]/g, '_').replace(/^\.+/, '');
        if (!/\.png$/i.test(name)) name += '.png';
        let body; try { body = await readBody(req, 60e6); } catch { return text(res, 400, '캡처가 너무 커'); }
        const dir = path.join(root, '.work', 'shots'); fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, name), Buffer.from(body.toString().split(',')[1] || '', 'base64'));
        return text(res, 200, 'ok');
      }
      let rel; try { rel = decodeURIComponent(url.pathname); } catch { return text(res, 400, 'bad request'); }
      if (rel.includes('\0')) return text(res, 400, 'bad request');
      let file = path.normalize(path.join(root, rel));
      if (file !== root && !file.startsWith(root + path.sep)) return text(res, 403, 'forbidden');
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      fs.readFile(file, (err, data) => {
        if (err) return text(res, 404, 'not found');
        res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(data);
      });
    } catch (e) { try { text(res, 500, 'error'); } catch {} console.error(e); }
  });
  return new Promise((ok, no) => { server.once('error', no); server.listen(port, '127.0.0.1', () => ok(server)); });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // node serve.mjs [포트] [--open]   포트가 쓰이고 있으면 다음 번호로 넘어간다. --open 이면 브라우저도 연다.
  const args = process.argv.slice(2), first = Number(args.find((a) => /^\d+$/.test(a))) || 5173;
  let port = first, server = null;
  for (; port < first + 20 && !server; port++) {
    try { server = await startServer(port); } catch (e) { if (e.code !== 'EADDRINUSE') { console.error(e); process.exit(1); } }
  }
  if (!server) { console.error(`포트 ${first}~${first + 19} 가 전부 쓰이고 있어.`); process.exit(1); }
  const url = `http://127.0.0.1:${port - 1}/`;
  console.log(`방 미리보기: ${url}   (끄려면 이 창을 닫거나 Ctrl+C)`);
  if (args.includes('--open')) {
    const { spawn } = await import('node:child_process');
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
  }
}
