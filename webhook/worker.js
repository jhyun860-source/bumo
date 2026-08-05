export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('OK', { status: 200 });
    }

    // Telegram이 setWebhook 때 등록한 secret_token과 일치하는지 확인 (아무나 못 트리거하게)
    const incomingSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (incomingSecret !== env.WEBHOOK_SECRET) {
      return new Response('forbidden', { status: 403 });
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response('OK', { status: 200 });
    }

    const message = update.message;
    const text = (message && message.text || '').trim().toLowerCase();
    const chatId = message && message.chat && String(message.chat.id);

    // 본인 채팅방에서 온 /generate 명령어만 처리
    if (chatId === env.TELEGRAM_CHAT_ID && (text === '/generate' || text === '/카루셀')) {
      await fetch(
        `https://api.github.com/repos/jhyun860-source/bumo/actions/workflows/daily-carousel.yml/dispatches`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'bumo-telegram-trigger',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ref: 'main' }),
        }
      );

      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text: '카루셀 만드는 중이에요, 1~2분 뒤에 도착해요 🎨',
        }),
      });
    }

    return new Response('OK', { status: 200 });
  },
};
