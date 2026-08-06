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
  const blobX = 55 + (seed % 30); // 55~84%
  const blobY = 15 + ((seed >> 4) % 25); // 15~39%
  const blob2X = 10 + ((seed >> 8) % 25);
  const blob2Y = 55 + ((seed >> 12) % 30);
  return `
    radial-gradient(circle at ${blobX}% ${blobY}%, rgba(196,122,93,0.55) 0%, rgba(196,122,93,0) 40%),
    radial-gradient(circle at ${blob2X}% ${blob2Y}%, rgba(160,180,168,0.30) 0%, rgba(160,180,168,0) 45%),
    linear-gradient(160deg, #4a6b52 0%, #3A5244 55%, #1E2B23 100%)`;
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
<svg width="380" height="380" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="28" y="46" width="144" height="94" rx="24" stroke="#F7F3EC" stroke-width="6" fill="rgba(247,243,236,0.10)"/>
  <path d="M68 140 L68 166 L98 140 Z" fill="rgba(247,243,236,0.10)" stroke="#F7F3EC" stroke-width="6" stroke-linejoin="round"/>
  <circle cx="70" cy="92" r="8" fill="#F7F3EC"/>
  <circle cx="100" cy="92" r="8" fill="#F7F3EC"/>
  <circle cx="130" cy="92" r="8" fill="#F7F3EC"/>
  <path d="M158 26 L164 40 L178 46 L164 52 L158 66 L152 52 L138 46 L152 40 Z" fill="#C47A5D"/>
</svg>`,
  youtube: `
<svg width="380" height="380" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="22" y="42" width="156" height="108" rx="18" stroke="#F7F3EC" stroke-width="6" fill="rgba(247,243,236,0.10)"/>
  <path d="M86 70 L86 122 L128 96 Z" fill="#C47A5D"/>
  <rect x="66" y="164" width="68" height="9" rx="4.5" fill="#F7F3EC" opacity="0.7"/>
</svg>`,
  game: `
<svg width="380" height="380" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M52 92 Q52 66 82 66 L118 66 Q148 66 148 92 L154 132 Q157 152 139 152 Q126 152 120 140 L117 132 Q113 123 100 123 Q87 123 83 132 L80 140 Q74 152 61 152 Q43 152 46 132 Z"
    stroke="#F7F3EC" stroke-width="6" fill="rgba(247,243,236,0.10)" stroke-linejoin="round"/>
  <line x1="71" y1="94" x2="71" y2="114" stroke="#F7F3EC" stroke-width="6" stroke-linecap="round"/>
  <line x1="61" y1="104" x2="81" y2="104" stroke="#F7F3EC" stroke-width="6" stroke-linecap="round"/>
  <circle cx="127" cy="96" r="6" fill="#F7F3EC"/>
  <circle cx="143" cy="110" r="6" fill="#F7F3EC"/>
  <circle cx="160" cy="42" r="24" fill="#C47A5D"/>
  <text x="160" y="51" font-size="26" font-weight="700" fill="#F7F3EC" text-anchor="middle" font-family="Brand, sans-serif">?</text>
</svg>`,
  sns: `
<svg width="380" height="380" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="34" y="34" width="132" height="132" rx="20" stroke="#F7F3EC" stroke-width="6" fill="rgba(247,243,236,0.10)"/>
  <circle cx="70" cy="72" r="12" fill="#F7F3EC"/>
  <path d="M44 146 L86 100 L112 126 L136 96 L156 146 Z" fill="#F7F3EC" opacity="0.5"/>
  <path d="M160 54 C160 44 150 39 145 47 C140 39 130 44 130 54 C130 67 145 77 145 77 C145 77 160 67 160 54 Z" fill="#C47A5D"/>
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
  .photo-overlay { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(20,24,20,0.10) 0%, rgba(20,24,20,0.25) 42%, rgba(20,24,20,0.88) 100%); }
  .photo-content { position: absolute; left: 0; right: 0; bottom: 170px; padding: 0 90px; z-index: 2; }
  .photo .hook { font-size: 58px; font-weight: 700; line-height: 1.5; letter-spacing: -1px; color: #FFFFFF; text-shadow: 0 2px 16px rgba(0,0,0,0.35); }
  .photo .hook .highlight { background: #C47A5D; }
  .page-tag.light { color: #FFFFFF; opacity: 0.9; z-index: 3; }
  .brand-mark.light { color: #FFFFFF; opacity: 0.9; z-index: 3; }
  /* 표지(사진 없을 때): 브랜드톤 그라디언트 + 그레인으로 만든 자체 제작 무드 배경 */
  .slide.artcover { color: #FFFFFF; }
  .grain { position: absolute; inset: 0; opacity: 0.05; mix-blend-mode: overlay; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>"); }
  .art-illustration { position: absolute; top: 210px; left: 0; right: 0; display: flex; justify-content: center; z-index: 2; filter: drop-shadow(0 10px 24px rgba(0,0,0,0.28)); }
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
