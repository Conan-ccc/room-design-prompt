// 화면 캡처: 방을 그려서 PNG 로 저장한다. 사진과 비교하거나 어색한 곳을 찾을 때 쓴다.
//   node tools/shot.mjs <방이름> [--views overview,start] [--times noon,sunset,night,1730] [--season winter] [--q mid] [--size 1600x900] [--cam x,z,yaw,pitch]
// 결과: .work/shots/<방이름>_<시점>_<시각>.png
// PC 에 깔린 Edge 나 Chrome 을 화면 없이 띄워서 찍는다(따로 설치할 것 없음).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from '../serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const room = args[0] && !args[0].startsWith('--') ? args[0] : null;
if (!room) { console.error('쓰는 법: node tools/shot.mjs <방이름> [--views overview,start] [--times noon,sunset,night]'); process.exit(1); }

const browsers = [
  process.env.ROOM_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
].filter(Boolean);
const exe = browsers.find((p) => fs.existsSync(p));
if (!exe) { console.error('Edge 나 Chrome 을 못 찾았어. 환경 변수 ROOM_BROWSER 에 브라우저 실행 파일 경로를 넣어 줘.'); process.exit(1); }

const views = opt('views', 'overview,start').split(','), times = opt('times', 'noon').split(',');
const [w, h] = opt('size', '1600x900').split('x').map(Number), q = opt('q', 'mid'), cam = opt('cam', '');
// 이름은 파일 이름에 들어가므로 글자·숫자·한글·점·밑줄·하이픈만 받는다(.. 로 캡처 폴더 밖을 가리키지 못하게)
const safe = /^[\w가-힣.-]+$/;
for (const v of [room, q, ...views, ...times]) if (!safe.test(v) || v.includes('..')) { console.error(`이름에 쓸 수 없는 글자가 있어: ${v}`); process.exit(1); }
if (cam && !/^[-\d.,]+$/.test(cam)) { console.error('--cam 은 x,z,yaw,pitch 숫자여야 해'); process.exit(1); }
const season = opt('season', '');
if (season && !safe.test(season)) { console.error('--season 은 spring | summer | winter'); process.exit(1); }
const port = 5200 + Math.floor(Math.random() * 700);
const server = await startServer(port);
const outDir = path.join(root, '.work', 'shots');
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
for (const view of views) for (const time of times) {
  const name = `${room}_${cam ? 'cam' : view}_${time}.png`, file = path.join(outDir, name);
  if (!path.resolve(file).startsWith(outDir + path.sep)) { console.error('캡처 폴더 밖 경로라 건너뜀:', name); failed++; continue; }
  fs.rmSync(file, { force: true });      // 같은 이름의 지난 캡처만 지운다
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'room-shot-'));
  const url = `http://127.0.0.1:${port}/?room=${encodeURIComponent(room)}&view=${encodeURIComponent(view)}&time=${time}&season=${season}&q=${q}&shot=${encodeURIComponent(name)}${cam ? '&cam=' + cam : ''}`;
  const child = spawn(exe, ['--headless=new', `--user-data-dir=${profile}`, `--window-size=${w},${h}`, '--hide-scrollbars', '--no-first-run',
    '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--disable-extensions', url], { stdio: 'ignore' });
  let ok = false;
  for (let i = 0; i < 240 && !ok; i++) { await sleep(250); ok = fs.existsSync(file) && fs.statSync(file).size > 1000; }
  await sleep(200);
  child.kill();
  await sleep(400);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  if (ok) console.log('저장:', path.relative(root, file)); else { failed++; console.error('실패(60초 안에 그려지지 않음):', name); }
}
server.close();
process.exit(failed ? 1 : 0);
