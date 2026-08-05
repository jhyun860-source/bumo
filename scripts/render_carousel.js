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

// 슬라이드 본문을 줄 단위로 훑어서 인용문("...")/화살표(→...)/일반 문단으로 나눠 HTML 생성
function renderBodyHtml(body) {
  const lines = body.split('\n');
  let html = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('"') || line.startsWith('“')) {
      html += `<div class="quote-box"><div class="quote">${escapeHtml(line)}</div></div>`;
    } else if (line.startsWith('→')) {
      html += `<div class="note">${escapeHtml(line)}</div>`;
    } else {
      html += `<div class="body-text">${escapeHtml(line)}</div>`;
    }
  }
  return html;
}

function buildHtml(slides) {
  const slideDivs = [];
  for (let n = 1; n <= 6; n++) {
    const isGreen = n === 1 || n === 6;
    const label = LABELS[n];
    const body = slides[n] || '';
    let inner = '';
    if (isGreen) {
      const hookText = body.split('\n').filter((l) => l.trim()).map(escapeHtml).join('<br>');
      inner = `<div class="hook">${hookText}</div>`;
    } else {
      inner = renderBodyHtml(body);
    }
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
  const html = buildHtml(slides);
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
