"""
매일 GitHub Actions에서 실행되는 카루셀 렌더링 스크립트.
LLM 호출 없이, 이미 저장소에 미리 써둔 script.md 파일을 이미지 6장으로 렌더링만 한다.
"""
import os
import re
import sys
from PIL import Image, ImageDraw, ImageFont

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CREAM = (247, 243, 236)
COVER_GREEN = (58, 82, 68)
DARK_GREEN = (47, 69, 56)
MUTED = (110, 128, 116)
ACCENT = (196, 122, 93)
WHITE_TEXT = (247, 243, 236)

W, H = 1080, 1350
MARGIN = 90
CONTENT_WIDTH = W - MARGIN * 2

FONT_DIR = "/usr/share/fonts/truetype/nanum"
FONT_BOLD = os.path.join(FONT_DIR, "NanumSquareRoundB.ttf")
FONT_REGULAR = os.path.join(FONT_DIR, "NanumSquareRoundR.ttf")

SLIDE_NAMES = ["01_cover", "02_situation", "03_mistake", "04_reframe", "05_saythis", "06_closing"]
LABELS = {2: "상황", 3: "흔한 실수", 4: "리프레임", 5: "이렇게 말해보세요", 6: "마무리"}

# 폴더명 -> 캘린더 원문 정확히 매칭 (완료 표시용)
CALENDAR_MAP = {
    "05_개인정보편": "5. 아이가 AI에게 이름·학교·집 위치 같은 개인정보를 말했을 때",
    "06_추천알고리즘편": "1. 알고리즘이 계속 자극적인 영상을 추천할 때",
    "07_위험챌린지편": "2. 아이가 위험한 챌린지 영상을 따라 하려 할 때",
    "08_그만보라니화냄편": "3. \"그만 봐\"라고 했을 때 아이가 화내며 우는 상황",
    "09_유튜버맹신편": "4. 유튜버가 하는 말을 부모보다 더 믿을 때",
    "10_뒷광고편": "5. 콘텐츠 속 광고/뒷광고를 아이가 구분 못 할 때",
    "11_모르는어른편": "1. 게임 중 모르는 어른과 대화하고 있었을 때",
    "12_몰래결제편": "2. 아이가 게임 아이템에 부모 몰래 결제했을 때",
    "13_욕설편": "3. 게임 채팅에서 욕설을 배워왔을 때",
    "14_사이버불링편": "4. 친구와 게임하다 사이버불링(따돌림) 정황을 봤을 때",
    "15_스킨집착편": "5. 아이가 게임 캐릭터 외모/스킨에 과도하게 집착할 때",
    "16_셀카편": "1. 아이가 셀카를 SNS에 올리고 싶어할 때",
    "17_단톡방소외편": "2. 친구들과의 단톡방에서 소외되는 걸 봤을 때",
    "18_무단게시편": "3. 아이 사진이 허락 없이 다른 계정에 올라갔을 때",
    "19_좋아요집착편": "4. \"좋아요\" 개수에 아이 기분이 좌우될 때",
    "20_스마트폰시간편": "5. 스마트폰 사용 시간으로 매일 싸울 때",
}


def find_next_topic():
    dirs = sorted(
        d for d in os.listdir(REPO_ROOT)
        if re.match(r"^\d{2}_.+", d) and os.path.isdir(os.path.join(REPO_ROOT, d))
    )
    for d in dirs:
        script_path = os.path.join(REPO_ROOT, d, "script.md")
        cover_path = os.path.join(REPO_ROOT, d, "01_cover.png")
        if os.path.exists(script_path) and not os.path.exists(cover_path):
            return d
    return None


def parse_script(path):
    text = open(path, encoding="utf-8").read()
    slides = {}
    caption = ""
    parts = re.split(r"^### (.+)$", text, flags=re.MULTILINE)
    for i in range(1, len(parts), 2):
        header = parts[i].strip()
        body = parts[i + 1].strip() if i + 1 < len(parts) else ""
        if header == "캡션":
            caption = body
        else:
            try:
                slides[int(header)] = body
            except ValueError:
                pass
    title_match = re.search(r"^# (.+)$", text, flags=re.MULTILINE)
    title = title_match.group(1) if title_match else os.path.basename(path)
    return slides, caption, title


def wrap_text(draw, text, font, max_width):
    lines = []
    for raw_line in text.split("\n"):
        if raw_line.strip() == "":
            lines.append("")
            continue
        words = raw_line.split(" ")
        current = ""
        for w in words:
            trial = (current + " " + w).strip()
            bbox = draw.textbbox((0, 0), trial, font=font)
            if bbox[2] - bbox[0] <= max_width:
                current = trial
            else:
                if current:
                    lines.append(current)
                current = w
        lines.append(current)
    return lines


def fit_font_and_wrap(draw, text, font_path, max_width, max_height, start_size, min_size=26, line_spacing=1.6):
    size = start_size
    while size >= min_size:
        font = ImageFont.truetype(font_path, size)
        lines = wrap_text(draw, text, font, max_width)
        line_height = int(size * line_spacing)
        if line_height * len(lines) <= max_height:
            return font, lines, line_height
        size -= 2
    font = ImageFont.truetype(font_path, min_size)
    lines = wrap_text(draw, text, font, max_width)
    return font, lines, int(min_size * line_spacing)


def draw_page_tag(draw, n, is_green):
    font = ImageFont.truetype(FONT_BOLD, 24)
    color = WHITE_TEXT if is_green else MUTED
    text = f"{n:02d} / 06"
    bbox = draw.textbbox((0, 0), text, font=font)
    draw.text((W - 64 - (bbox[2] - bbox[0]), 56), text, font=font, fill=color)


def draw_brand_mark(draw, is_green):
    font = ImageFont.truetype(FONT_BOLD, 26)
    color = WHITE_TEXT if is_green else MUTED
    draw.text((MARGIN, H - 100), "AI 시대 자녀 대화법", font=font, fill=color)


def render_slide(n, body, out_path):
    is_green = n in (1, 6)
    bg = COVER_GREEN if is_green else CREAM
    text_color = WHITE_TEXT if is_green else DARK_GREEN

    img = Image.new("RGB", (W, H), bg)
    draw = ImageDraw.Draw(img)
    draw_page_tag(draw, n, is_green)

    content_top = 200
    label = LABELS.get(n)
    if label:
        label_font = ImageFont.truetype(FONT_BOLD, 28)
        draw.text((MARGIN, 140), label, font=label_font, fill=ACCENT)
        content_top = 210

    content_height = H - content_top - 180
    body_font_size = 58 if is_green else 42
    font, lines, line_height = fit_font_and_wrap(
        draw, body, FONT_BOLD if is_green else FONT_REGULAR,
        CONTENT_WIDTH, content_height, start_size=body_font_size,
    )

    total_height = line_height * len(lines)
    y = (H - total_height) // 2 if is_green else content_top

    for line in lines:
        stripped = line.strip()
        color = ACCENT if (stripped.startswith('"') or stripped.startswith("→")) else text_color
        draw.text((MARGIN, y), line, font=font, fill=color)
        y += line_height

    if is_green:
        draw_brand_mark(draw, is_green)

    img.save(out_path)


def mark_calendar_done(topic_dir):
    calendar_line = CALENDAR_MAP.get(topic_dir)
    if not calendar_line:
        return
    md_path = os.path.join(REPO_ROOT, "ai_parenting_project.md")
    with open(md_path, encoding="utf-8") as f:
        content = f.read()
    if calendar_line in content and (calendar_line + " ✅ 완료") not in content:
        content = content.replace(calendar_line, calendar_line + " ✅ 완료", 1)
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(content)


def main():
    topic_dir = find_next_topic()
    if not topic_dir:
        print("NO_TOPIC")
        return

    folder = os.path.join(REPO_ROOT, topic_dir)
    slides, caption, title = parse_script(os.path.join(folder, "script.md"))

    for i in range(1, 7):
        body = slides.get(i, "")
        render_slide(i, body, os.path.join(folder, f"{SLIDE_NAMES[i - 1]}.png"))

    mark_calendar_done(topic_dir)

    print(f"TOPIC_DIR={topic_dir}")
    print(f"TOPIC_TITLE={title}")


if __name__ == "__main__":
    main()
