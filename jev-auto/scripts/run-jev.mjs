import { experimental_evaluate as evaluate } from 'ai';

// This command explicitly makes a paid Gateway request; check/build never does.
if (!Bun.env.AI_GATEWAY_API_KEY) {
  console.error('AI_GATEWAY_API_KEY を環境変数に設定してください。');
  process.exit(1);
}

const state = {
  ticketId: 'JP-1842',
  subject: '二重請求の返金依頼',
  message:
    '昨日、月額プランが2回請求されました。サービスは利用できますが、重複した1件を返金してください。まだ返金通知は届いていません。',
};

const startedAt = performance.now();

try {
  const result = await evaluate({
  model: 'typesafe-ai/jev',
  state,
  questions: {
    refundAlreadyIssued: {
      type: 'boolean',
      instructions: '重複請求に対する返金は、すでに実行済みですか？',
    },
    destination: {
      type: 'choice',
      instructions: 'この問い合わせを担当すべきチームを1つ選んでください。',
      criteria: {
        billing: '請求、支払い、重複決済、返金',
        technicalSupport: '障害、接続、機能上の不具合',
        account: 'ログイン、契約、アカウント設定',
      },
    },
    urgency: {
      type: 'score',
      instructions: '対応の緊急度を評価してください。',
      criteria: [
        '低: 金銭・利用への影響がなく、待つことができる',
        '中: 不便はあるが、金銭損失や利用不能はない',
        '高: 誤った請求など金銭上の問題が発生している',
        '最優先: 不正利用、アカウント侵害、または全面的な利用不能',
      ],
    },
  },
  providerOptions: {
    gateway: {
      only: ['typesafe-ai'],
    },
  },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
        answers: result.answers,
        usage: result.usage,
        providerMetadata: result.providerMetadata,
        warnings: result.warnings,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
        name: error.name,
        statusCode: error.statusCode ?? error.cause?.statusCode,
        message: error.message,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
