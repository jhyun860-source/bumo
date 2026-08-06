// 매일 GitHub Actions에서 실행되는 카루셀 렌더링 스크립트 (HTML + 헤드리스 크롬 방식).
// LLM 호출 없이, 이미 저장소에 미리 써둔 script.md 파일을 이미지 6장으로 렌더링만 한다.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const REPO_ROOT = path.resolve(__dirname, '..');

const LABELS = { 2: '상황', 3: '흔한 실수', 4: '리프레임', 5: '이렇게 말해보세요', 6: '마무리' };
const SLIDE_NAMES = ['01_cover', '02_situation', '03_mistake', '04_reframe', '05_saythis', '06_closing'];

const CALENDAR_MAP = {
  '05_개인정보편': '5. 아이가 AI에게 이름·학교·집 위치 같은 개인정보를 말했을 때',
  '06_추천알고리즘편': '1. 알고리즘이 계속 자극적인 영상을 추천할 때',
  '07_위험챌린지편': '2. 아이가 위험한 챌린지 영상을 따라 하려 할 때',
  '08_그만보라니화냄편': '3. "그만 봐"라고 했을 때 아이가 화내며 우는 상황',
  '09_유튜버맹신편': '4. 유튜버가 하는 말을 부모보다 더 믿을 때',
  '10_뒷광고편': '5. 콘텐츠 속 광고/뒷광고를 아이가 구분 못 할 때',
  '11_모르는어른편': '1. 게임 중 모르는 어른과 대화하고 있었을 때',
  '12_몰래결제편': '2. 아이가 게임 아이템에 부모 몰래 결제했을 때',
  '13_욕설편': '3. 게임 채팅에서 욕설을 배워왔을 때',
  '14_사이버불링편': '4. 친구와 게임하다 사이버불링(따돌림) 정황을 봤을 때',
  '15_스킨집착편': '5. 아이가 게임 캐릭터 외모/스킨에 과도하게 집착할 때',
  '16_셀카편': '1. 아이가 셀카를 SNS에 올리고 싶어할 때',
  '17_단톡방소외편': '2. 친구들과의 단톡방에서 소외되는 걸 봤을 때',
  '18_무단게시편': '3. 아이 사진이 허락 없이 다른 계정에 올라갔을 때',
  '19_좋아요집착편': '4. "좋아요" 개수에 아이 기분이 좌우될 때',
  '20_스마트폰시간편': '5. 스마트폰 사용 시간으로 매일 싸울 때',
};

function findNextTopic() {
  const dirs = fs.readdirSync(REPO_ROOT)
    .filter((d) => /^\d{2}_.+/.test(d) && fs.statSync(path.join(REPO_ROOT, d)).isDirectory())
    .sort();
  for (const d of dirs) {
    const scriptPath = path.join(REPO_ROOT, d, 'script.md');
    const coverPath = path.join(REPO_ROOT, d, '01_cover.png');
    if (fs.existsSync(scriptPath) && !fs.existsSync(coverPath)) return d;
  }
  return null;
}

function parseScript(scriptPath) {
  const text = fs.readFileSync(scriptPath, 'utf-8');
  const titleMatch = text.match(/^# (.+)$/m);
  const title = titleMatch ? titleMatch[1] : path.basename(scriptPath);

  const slides = {};
  let caption = '';
  const re = /^### (.+)$/gm;
  const matches = [...text.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const header = matches[i][1].trim();
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const body = text.slice(start, end).trim();
    if (header === '캡션') caption = body;
    else if (/^\d+$/.test(header)) slides[parseInt(header, 10)] = body;
  }
  return { slides, caption, title };
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// script.md에서 ==강조할 문장==으로 감싼 부분을 진한 박스 하이라이트 <span>으로 변환
function renderInline(line) {
  return line
    .split(/(==[^=]+==)/g)
    .map((part) => {
      if (part.startsWith('==') && part.endsWith('=='))  {
        return `<span class="highlight">${escapeHtml(part.slice(2, -2))}</span>`;
      }
      return escapeHtml(part);
    })
    .join('');
}

// 슬라이드 본문을 줄 단위로 훑어서 인용문("...")/화살표(→...)/일반 문단으로 나눠 HTML 생성
function renderBodyHtml(body) {
  const lines = body.split('\n');
  let html = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('"') || line.startsWith('“')) {
      html += `<div class="quote-box"><div class="quote">${renderInline(line)}</div></div>`;
    } else if (line.startsWith('→')) {
      html += `<div class="note">${renderInline(line)}</div>`;
    } else {
      html += `<div class="body-text">${renderInline(line)}</div>`;
    }
  }
  return html;
}

function findCoverPhoto(folder) {
  for (const name of ['cover.jpg', 'cover.jpeg', 'cover.png']) {
    const p = path.join(folder, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// 실제 사진 파일이 없을 때 쓰는 표지 배경: 브랜드 톤 그라디언트 + 흐릿한 빛망울 + 그레인.
// 외부 스톡 이미지 없이 "사진 느낌" 무드를 내기 위한 자체 제작(CSS/SVG) 대체.
function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function buildArtCoverStyle(topicDir) {
  const seed = hashSeed(topicDir);
  const glowX = 58 + (seed % 26); // 58~83%
  const glowY = 16 + ((seed >> 4) % 22); // 16~37%
  const rimX = 10 + ((seed >> 8) % 22);
  const rimY = 58 + ((seed >> 12) % 26);
  // 시네마틱 컬러그레이딩 느낌: 따뜻한 앰버 스팟라이트 + 차가운 세이지 림라이트 +
  // 가장자리가 어두워지는 비네트 베이스. 단순 톤 블렌딩보다 대비/채도를 올려 고급스럽게.
  return `
    radial-gradient(circle at ${glowX}% ${glowY}%, rgba(224,138,94,0.68) 0%, rgba(224,138,94,0.22) 20%, rgba(224,138,94,0) 44%),
    radial-gradient(circle at ${rimX}% ${rimY}%, rgba(122,150,131,0.30) 0%, rgba(122,150,131,0) 42%),
    radial-gradient(ellipse at 50% 36%, #33493C 0%, #1A2B21 55%, #0C1712 100%)`;
}

// 주제 폴더 번호로 4개 주차 카테고리(챗봇/유튜브/게임/SNS)를 판별해
// 해당 카테고리를 상징하는 자체 제작 플랫 SVG 일러스트를 표지에 얹는다.
function getCategory(topicDir) {
  const num = parseInt(topicDir.slice(0, 2), 10);
  if (num <= 5) return 'chatbot';
  if (num <= 10) return 'youtube';
  if (num <= 15) return 'game';
  return 'sns';
}

const ICON_SVGS = {
  chatbot: `
<svg width="620" height="620" viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow-chatbot" cx="50%" cy="42%" r="55%">
      <stop offset="0%" stop-color="#C47A5D" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#C47A5D" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="body-chatbot" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#7A9683"/>
      <stop offset="100%" stop-color="#334A3D"/>
    </linearGradient>
  </defs>
  <ellipse cx="150" cy="145" rx="145" ry="145" fill="url(#glow-chatbot)"/>
  <ellipse cx="150" cy="246" rx="78" ry="13" fill="#16211A" opacity="0.35"/>
  <g transform="rotate(-5 150 90)">
    <rect x="196" y="40" width="66" height="48" rx="16" fill="#F7F3EC" opacity="0.92"/>
    <path d="M210 88 L206 102 L226 88 Z" fill="#F7F3EC" opacity="0.92"/>
    <circle cx="214" cy="63" r="4" fill="#3A5244"/>
    <circle cx="229" cy="63" r="4" fill="#3A5244"/>
    <circle cx="244" cy="63" r="4" fill="#3A5244"/>
  </g>
  <g transform="rotate(-4 150 140)">
    <rect x="52" y="68" width="196" height="132" rx="30" fill="url(#body-chatbot)" stroke="#F7F3EC" stroke-width="4"/>
    <path d="M92 200 L92 228 L124 200 Z" fill="url(#body-chatbot)" stroke="#F7F3EC" stroke-width="4" stroke-linejoin="round"/>
    <circle cx="100" cy="134" r="9" fill="#F7F3EC"/>
    <circle cx="132" cy="134" r="9" fill="#F7F3EC"/>
    <circle cx="164" cy="134" r="9" fill="#F7F3EC"/>
  </g>
  <path d="M242 24 L249 42 L267 49 L249 56 L242 74 L235 56 L217 49 L235 42 Z" fill="#C47A5D"/>
  <circle cx="52" cy="46" r="7" fill="#C47A5D" opacity="0.85"/>
  <circle cx="34" cy="76" r="4.5" fill="#F7F3EC" opacity="0.55"/>
</svg>`,
  youtube: `
<svg width="620" height="620" viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow-youtube" cx="50%" cy="42%" r="55%">
      <stop offset="0%" stop-color="#C47A5D" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#C47A5D" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="body-youtube" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#7A9683"/>
      <stop offset="100%" stop-color="#334A3D"/>
    </linearGradient>
    <radialGradient id="btn-youtube" cx="35%" cy="35%" r="70%">
      <stop offset="0%" stop-color="#D89676"/>
      <stop offset="100%" stop-color="#B5674A"/>
    </radialGradient>
  </defs>
  <ellipse cx="150" cy="145" rx="145" ry="145" fill="url(#glow-youtube)"/>
  <ellipse cx="150" cy="246" rx="86" ry="13" fill="#16211A" opacity="0.35"/>
  <rect x="46" y="58" width="208" height="148" rx="24" fill="url(#body-youtube)" stroke="#F7F3EC" stroke-width="4"/>
  <rect x="46" y="58" width="208" height="148" rx="24" fill="none" stroke="#F7F3EC" stroke-opacity="0.2" stroke-width="1"/>
  <rect x="128" y="220" width="44" height="10" rx="5" fill="#6E8074"/>
  <rect x="102" y="238" width="96" height="8" rx="4" fill="#F7F3EC" opacity="0.7"/>
  <circle cx="150" cy="132" r="52" fill="url(#btn-youtube)"/>
  <path d="M136 108 L136 156 L178 132 Z" fill="#F7F3EC"/>
  <circle cx="232" cy="40" r="6" fill="#F7F3EC" opacity="0.7"/>
  <circle cx="252" cy="60" r="4" fill="#F7F3EC" opacity="0.5"/>
</svg>`,
  game: `
<svg width="620" height="620" viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow-game" cx="50%" cy="42%" r="55%">
      <stop offset="0%" stop-color="#C47A5D" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#C47A5D" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="body-game" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#7A9683"/>
      <stop offset="100%" stop-color="#334A3D"/>
    </linearGradient>
  </defs>
  <ellipse cx="150" cy="145" rx="145" ry="145" fill="url(#glow-game)"/>
  <ellipse cx="150" cy="246" rx="90" ry="13" fill="#16211A" opacity="0.35"/>
  <path d="M78 138 Q78 100 118 100 L182 100 Q222 100 222 138 L231 196 Q235 224 209 224 Q190 224 181 206 L176 194 Q170 181 150 181 Q130 181 124 194 L119 206 Q110 224 91 224 Q65 224 69 196 Z"
    fill="url(#body-game)" stroke="#F7F3EC" stroke-width="4" stroke-linejoin="round"/>
  <line x1="107" y1="140" x2="107" y2="172" stroke="#F7F3EC" stroke-width="8" stroke-linecap="round"/>
  <line x1="91" y1="156" x2="123" y2="156" stroke="#F7F3EC" stroke-width="8" stroke-linecap="round"/>
  <circle cx="190" cy="144" r="9" fill="#F7F3EC"/>
  <circle cx="216" cy="164" r="9" fill="#F7F3EC"/>
  <circle cx="236" cy="52" r="34" fill="#C47A5D"/>
  <text x="236" y="64" font-size="36" font-weight="700" fill="#F7F3EC" text-anchor="middle" font-family="Brand, sans-serif">?</text>
  <circle cx="52" cy="70" r="6" fill="#F7F3EC" opacity="0.5"/>
  <circle cx="42" cy="100" r="4" fill="#F7F3EC" opacity="0.4"/>
</svg>`,
  sns: `
<svg width="620" height="620" viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow-sns" cx="50%" cy="42%" r="55%">
      <stop offset="0%" stop-color="#C47A5D" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#C47A5D" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="body-sns" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#7A9683"/>
      <stop offset="100%" stop-color="#334A3D"/>
    </linearGradient>
  </defs>
  <ellipse cx="150" cy="145" rx="145" ry="145" fill="url(#glow-sns)"/>
  <ellipse cx="150" cy="246" rx="80" ry="13" fill="#16211A" opacity="0.35"/>
  <g transform="rotate(7 150 140) translate(14 10)">
    <rect x="66" y="62" width="150" height="150" rx="22" fill="url(#body-sns)" stroke="#F7F3EC" stroke-width="4" opacity="0.55"/>
  </g>
  <g transform="rotate(-4 150 140)">
    <rect x="62" y="58" width="150" height="150" rx="22" fill="url(#body-sns)" stroke="#F7F3EC" stroke-width="4"/>
    <circle cx="98" cy="98" r="14" fill="#F7F3EC"/>
    <path d="M76 178 L124 128 L154 158 L184 122 L212 178 Z" fill="#F7F3EC" opacity="0.55"/>
  </g>
  <circle cx="226" cy="70" r="36" fill="#C47A5D"/>
  <path transform="translate(205.6 49.3) scale(1.7)" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="#F7F3EC"/>
  <circle cx="46" cy="90" r="6" fill="#F7F3EC" opacity="0.5"/>
</svg>`,
};

function buildHtml(slides, coverPhotoPath, topicDir) {
  const slideDivs = [];
  for (let n = 1; n <= 6; n++) {
    const isCoverPhoto = n === 1 && !!coverPhotoPath;
    const isArtCover = n === 1 && !coverPhotoPath;
    const isGreen = n === 6;
    const label = LABELS[n];
    const body = slides[n] || '';
    let inner = '';
    if (isCoverPhoto || isArtCover || isGreen) {
      const hookText = body.split('\n').filter((l) => l.trim()).map((l) => renderInline(l)).join('<br>');
      inner = `<div class="hook">${hookText}</div>`;
    } else {
      inner = renderBodyHtml(body);
    }

    if (isCoverPhoto) {
      slideDivs.push(`
<div class="slide photo" id="slide${n}" style="background-image:url('file://${coverPhotoPath}')">
  <div class="page-tag light">${String(n).padStart(2, '0')} / 06</div>
  <div class="photo-overlay"></div>
  <div class="photo-content">${inner}</div>
  <div class="brand-mark light">AI 시대 자녀 대화법</div>
</div>`);
    } else if (isArtCover) {
      const icon = ICON_SVGS[getCategory(topicDir)] || '';
      slideDivs.push(`
<div class="slide artcover" id="slide${n}" style="background: ${buildArtCoverStyle(topicDir)};">
  <div class="page-tag light">${String(n).padStart(2, '0')} / 06</div>
  <div class="grain"></div>
  <div class="photo-overlay"></div>
  <div class="art-illustration">${icon}</div>
  <div class="photo-content">${inner}</div>
  <div class="brand-mark light">AI 시대 자녀 대화법</div>
</div>`);
    } else {
      slideDivs.push(`
<div class="slide ${isGreen ? 'green' : 'cream'}" id="slide${n}">
  <div class="page-tag">${String(n).padStart(2, '0')} / 06</div>
  <div class="content">
    ${label ? `<div class="label">${escapeHtml(label)}</div>` : ''}
    ${inner}
  </div>
  ${isGreen ? '<div class="brand-mark">AI 시대 자녀 대화법</div>' : ''}
</div>`);
    }
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  @font-face { font-family: 'Brand'; src: local('NanumSquareRound'), url('file:///usr/share/fonts/truetype/nanum/NanumSquareRoundR.ttf'); font-weight: 400; }
  @font-face { font-family: 'Brand'; src: local('NanumSquareRound Bold'), url('file:///usr/share/fonts/truetype/nanum/NanumSquareRoundB.ttf'); font-weight: 700; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  .slide { width: 1080px; height: 1350px; position: relative; font-family: 'Brand', sans-serif; overflow: hidden; }
  .cream { background: #F7F3EC; color: #2F4538; }
  .green { background: #3A5244; color: #F7F3EC; }
  .page-tag { position: absolute; top: 56px; right: 64px; font-size: 24px; font-weight: 700; opacity: 0.7; }
  .cream .page-tag { color: #6E8074; }
  .green .page-tag { color: #F7F3EC; }
  .content { position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; padding: 140px 90px; }
  .label { font-size: 28px; font-weight: 700; color: #C47A5D; margin-bottom: 28px; letter-spacing: 1px; }
  .hook { font-size: 64px; font-weight: 700; line-height: 1.5; letter-spacing: -1px; }
  .body-text { font-size: 44px; font-weight: 400; line-height: 1.75; letter-spacing: -0.5px; margin-bottom: 6px; }
  .quote-box { border-left: 6px solid #C47A5D; padding: 8px 0 8px 36px; margin: 18px 0; }
  .quote { font-size: 40px; font-weight: 700; color: #C47A5D; line-height: 1.5; }
  .note { font-size: 30px; font-weight: 400; color: #6E8074; line-height: 1.6; margin-top: 20px; }
  .brand-mark { position: absolute; bottom: 56px; left: 90px; font-size: 26px; font-weight: 700; opacity: 0.8; }
  .cream .brand-mark { color: #6E8074; }
  .green .brand-mark { color: #F7F3EC; }
  .highlight { background: #C47A5D; color: #F7F3EC; padding: 3px 10px; border-radius: 6px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
  /* 표지: 사진 배경 + 하단 그라데이션 오버레이 + 헤드라인 */
  .slide.photo { background-color: #222; background-size: cover; background-position: center; color: #FFFFFF; }
  .photo-overlay { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(9,17,13,0.08) 0%, rgba(9,17,13,0.28) 44%, rgba(9,17,13,0.92) 100%); }
  .photo-content { position: absolute; left: 0; right: 0; bottom: 170px; padding: 0 90px; z-index: 2; }
  .photo .hook { font-size: 58px; font-weight: 700; line-height: 1.5; letter-spacing: -1px; color: #FFFFFF; text-shadow: 0 2px 16px rgba(0,0,0,0.35); }
  .photo .hook .highlight { background: #C47A5D; }
  .page-tag.light { color: #FFFFFF; opacity: 0.9; z-index: 3; }
  .brand-mark.light { color: #FFFFFF; opacity: 0.9; z-index: 3; }
  /* 표지(사진 없을 때): 브랜드톤 그라디언트 + 그레인으로 만든 자체 제작 무드 배경 */
  .slide.artcover { color: #FFFFFF; }
  .grain { position: absolute; inset: 0; opacity: 0.05; mix-blend-mode: overlay; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>"); }
  .art-illustration { position: absolute; top: 90px; left: 0; right: 0; display: flex; justify-content: center; z-index: 2; filter: drop-shadow(0 14px 28px rgba(0,0,0,0.3)); }
</style>
</head>
<body>
${slideDivs.join('\n')}
</body>
</html>`;
}

function markCalendarDone(topicDir) {
  const calendarLine = CALENDAR_MAP[topicDir];
  if (!calendarLine) return;
  const mdPath = path.join(REPO_ROOT, 'ai_parenting_project.md');
  let content = fs.readFileSync(mdPath, 'utf-8');
  if (content.includes(calendarLine) && !content.includes(calendarLine + ' ✅ 완료')) {
    content = content.replace(calendarLine, calendarLine + ' ✅ 완료');
    fs.writeFileSync(mdPath, content, 'utf-8');
  }
}

async function main() {
  const topicDir = findNextTopic();
  if (!topicDir) {
    console.log('NO_TOPIC');
    return;
  }

  const folder = path.join(REPO_ROOT, topicDir);
  const { slides, title } = parseScript(path.join(folder, 'script.md'));
  const coverPhotoPath = findCoverPhoto(folder);
  const html = buildHtml(slides, coverPhotoPath, topicDir);
  const htmlPath = path.join(folder, '_render.html');
  fs.writeFileSync(htmlPath, html, 'utf-8');

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
  await page.goto('file://' + htmlPath, { waitUntil: 'networkidle0' });

  for (let n = 1; n <= 6; n++) {
    const el = await page.$(`#slide${n}`);
    await el.screenshot({ path: path.join(folder, `${SLIDE_NAMES[n - 1]}.png`) });
  }

  await browser.close();
  fs.unlinkSync(htmlPath);

  markCalendarDone(topicDir);

  console.log(`TOPIC_DIR=${topicDir}`);
  console.log(`TOPIC_TITLE=${title}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
