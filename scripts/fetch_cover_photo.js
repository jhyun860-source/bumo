// GitHub Actions에서 다음 주제의 cover.jpg가 없으면 topview text-to-image API로
// 사진을 생성해 저장한다. TOPVIEW_API_KEY/TOPVIEW_UID가 없거나 API 호출이 실패하면
// 조용히 건너뛴다 — render_carousel.js가 사진 없을 때 자동 일러스트로 폴백하므로
// 이 스크립트가 실패해도 파이프라인 전체는 항상 완결된다.
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const API_BASE = 'https://api.topview.ai';

// 주제 카테고리별 무드: 밤 조명 + 은은한 글로우 + 시네마틱 컬러그레이딩,
// 사람/텍스트 없이 상징적인 사물 사진으로 (표지 문구가 하단에 얹히므로).
const CATEGORY_PROMPTS = {
  chatbot: 'Moody cinematic photograph of a smartphone glowing on a dark desk at night, soft blue chat-app light illuminating the screen, blurred cozy home background, shallow depth of field, muted teal and warm amber tones, no visible text, no people, high quality photography',
  youtube: 'Moody cinematic photograph of a tablet propped up playing a video in a dark room, soft screen glow, blurred warm bokeh lights in the background, shallow depth of field, cinematic color grading, no visible text, no people, high quality photography',
  game: 'Moody cinematic photograph of a game controller glowing with soft blue LED light, resting alone on a dark desk at night, a blurred laptop screen glowing faintly in the background, shallow depth of field, cool blue and teal tones, quiet and slightly tense atmosphere, minimalist composition, no people, no text, no logos, high quality photography',
  sns: 'Moody cinematic photograph of a smartphone screen showing a blurred photo gallery grid, soft warm light on a wooden table at night, shallow depth of field, warm amber and teal tones, no visible text, no people, high quality photography',
};

function getCategory(topicDir) {
  const num = parseInt(topicDir.slice(0, 2), 10);
  if (num <= 5) return 'chatbot';
  if (num <= 10) return 'youtube';
  if (num <= 15) return 'game';
  return 'sns';
}

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

function hasCoverPhoto(folder) {
  return ['cover.jpg', 'cover.jpeg', 'cover.png'].some((n) => fs.existsSync(path.join(folder, n)));
}

async function topviewFetch(pathAndQuery, options = {}) {
  const res = await fetch(API_BASE + pathAndQuery, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.TOPVIEW_API_KEY}`,
      'Topview-Uid': process.env.TOPVIEW_UID,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const json = await res.json();
  if (json.code !== '200') throw new Error(`topview API error: ${json.message}`);
  return json.result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateCoverPhoto(prompt) {
  const submit = await topviewFetch('/v1/common_task/text2image/task/submit', {
    method: 'POST',
    body: JSON.stringify({
      model: 'GPT Image 2',
      prompt,
      aspectRatio: '4:5',
      resolution: '1K',
      quality: 'medium',
      generateCount: 1,
    }),
  });

  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(4000);
    const result = await topviewFetch(`/v1/common_task/text2image/task/query?taskId=${submit.taskId}`);
    const status = (result.status || '').toLowerCase();
    if (status === 'success') {
      const image = (result.images || []).find((img) => img.filePath);
      if (!image) throw new Error(`task succeeded but no image returned: ${JSON.stringify(result.images)}`);
      return image.filePath;
    }
    if (status === 'fail') throw new Error(result.errorMsg || `task failed: ${JSON.stringify(result)}`);
  }
  throw new Error('timed out waiting for image generation');
}

async function run() {
  if (!process.env.TOPVIEW_API_KEY || !process.env.TOPVIEW_UID) {
    console.log('TOPVIEW_API_KEY/TOPVIEW_UID not set — skipping auto cover photo (illustration fallback will be used).');
    return;
  }

  const topicDir = findNextTopic();
  if (!topicDir) {
    console.log('No next topic — skipping cover photo fetch.');
    return;
  }

  const folder = path.join(REPO_ROOT, topicDir);
  if (hasCoverPhoto(folder)) {
    console.log(`${topicDir} already has a cover photo — skipping.`);
    return;
  }

  const prompt = CATEGORY_PROMPTS[getCategory(topicDir)];
  console.log(`Generating cover photo for ${topicDir}...`);
  const filePath = await generateCoverPhoto(prompt);
  const res = await fetch(filePath);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(folder, 'cover.jpg'), buf);
  console.log(`Saved cover photo for ${topicDir}.`);
}

run().catch((err) => {
  console.log(`Cover photo generation failed, falling back to illustration: ${err.message}`);
});
