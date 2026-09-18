/** 1画面ぶんの HTML。テンプレートエンジンは入れず、出力経路をこの1ファイルに閉じる。
 *
 * 画面の主役は255個のセルである。確率0の色は沈み、Jev が見た色だけが光る。
 * 利用者の入力はサーバーへ送るだけで、描画は必ず textContent 経由にする。
 */

import { COLORS, FAMILIES } from './palette';
import { MAX_TEXT_LENGTH } from './evaluate';

const PALETTE_JSON = JSON.stringify(COLORS.map(c => [c.name, c.hex, c.family]));
const FAMILY_JSON = JSON.stringify(FAMILIES);

const EXAMPLES = [
  '雨上がりの朝、誰もいない校庭',
  '締め切り3分前のCIが落ちた',
  '祖母の家の縁側で飲む麦茶',
  '深夜2時、コンビニの駐車場',
  '初めて書いたコードが動いた瞬間',
];

export function page(): string {
  return `<!doctype html>
<html lang="ja">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>jev-color — 255色でJevに文章を塗らせる</title>
<style>
:root { color-scheme: dark; --bg:#0d0f14; --panel:#161a23; --line:#262c3a; --ink:#e7eaf2; --dim:#99a1b5; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font-family:system-ui,"Hiragino Sans","Noto Sans JP",sans-serif; line-height:1.7; }
main { max-width: 960px; margin: 0 auto; padding: 32px 16px 80px; }
h1 { font-size: 1.5rem; margin: 0 0 4px; }
.lede { color: var(--dim); margin: 0 0 24px; font-size: .9rem; }
textarea { width:100%; min-height:96px; padding:12px; border-radius:10px; border:1px solid var(--line); background:var(--panel); color:var(--ink); font:inherit; resize:vertical; }
.row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:12px; }
button { font:inherit; padding:9px 18px; border-radius:999px; border:1px solid var(--line); background:var(--panel); color:var(--ink); cursor:pointer; }
button.primary { background:var(--ink); color:var(--bg); border-color:var(--ink); font-weight:600; }
button:disabled { opacity:.5; cursor:progress; }
.chip { font-size:.8rem; padding:5px 12px; color:var(--dim); }
.count { color:var(--dim); font-size:.8rem; margin-left:auto; }
section { margin-top:32px; }
.swatches { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.swatch { border-radius:12px; padding:18px; min-height:132px; display:flex; flex-direction:column; justify-content:space-between; border:1px solid var(--line); }
.swatch .k { font-size:.72rem; opacity:.75; letter-spacing:.04em; }
.swatch .v { font-size:1.35rem; font-weight:700; }
.swatch .m { font-size:.78rem; opacity:.8; font-variant-numeric:tabular-nums; }
.grid { display:grid; grid-template-columns:repeat(17, 1fr); gap:3px; margin-top:12px; }
.cell { aspect-ratio:1; border-radius:3px; transition:opacity .35s ease, transform .2s ease; }
.cell:hover { transform:scale(1.5); position:relative; z-index:2; }
.bars { display:grid; gap:6px; margin-top:12px; }
.bar { display:grid; grid-template-columns:8.5rem 1fr 4rem; gap:10px; align-items:center; font-size:.85rem; }
.bar .track { height:12px; background:var(--panel); border-radius:999px; overflow:hidden; }
.bar .fill { height:100%; border-radius:999px; }
.bar .p { text-align:right; color:var(--dim); font-variant-numeric:tabular-nums; }
.stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-top:12px; }
.stat { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px; }
.stat .k { font-size:.72rem; color:var(--dim); }
.stat .v { font-size:1.05rem; font-weight:600; font-variant-numeric:tabular-nums; }
.note { color:var(--dim); font-size:.8rem; }
.warn { border-left:3px solid #d9a62e; padding-left:12px; }
.err { border-left:3px solid #d9333f; padding-left:12px; }
h2 { font-size:.95rem; margin:0; letter-spacing:.04em; }
[hidden] { display:none !important; }
@media (max-width:600px) { .swatches { grid-template-columns:1fr; } .grid { grid-template-columns:repeat(15,1fr); } }
</style>
<main>
  <h1>255色でJevに文章を塗らせる</h1>
  <p class="lede">Jev の choice は候補を255個まで取れる。255色ぶんの確率を1リクエストで受け取り、argmax だけでなく分布そのものを色として見る。</p>

  <form id="form">
    <textarea id="text" maxlength="${MAX_TEXT_LENGTH}" placeholder="情景でも、気分でも、コミットメッセージでもよい" required></textarea>
    <div class="row">
      <button class="primary" id="go" type="submit">塗る</button>
      ${EXAMPLES.map(e => `<button class="chip" type="button" data-example>${e}</button>`).join('')}
      <span class="count" id="count">0 / ${MAX_TEXT_LENGTH}</span>
    </div>
  </form>

  <section id="error" hidden><p class="err" id="errorText"></p></section>

  <section id="result" hidden>
    <div class="swatches">
      <div class="swatch" id="topSwatch">
        <div><div class="k">最有力の1色</div><div class="v" id="topName"></div></div>
        <div class="m" id="topMeta"></div>
      </div>
      <div class="swatch" id="mixSwatch">
        <div><div class="k">255色を確率で混ぜた色</div><div class="v" id="mixHex"></div></div>
        <div class="m" id="mixMeta"></div>
      </div>
    </div>
    <p class="note warn" id="caution" hidden></p>

    <section>
      <h2>255個の確率</h2>
      <p class="note">1セルが1色。確率が高い色ほど明るく浮かぶ。<label style="margin-left:8px"><input type="checkbox" id="revealAll"> パレット全体を表示</label></p>
      <div class="grid" id="grid"></div>
    </section>

    <section>
      <h2>上位12色</h2>
      <div class="bars" id="bars"></div>
    </section>

    <section>
      <h2>読み取り</h2>
      <div class="stats" id="stats"></div>
      <p class="note" id="usage"></p>
    </section>
  </section>

  <p class="note" style="margin-top:40px">choice=255・choice=12・score=5・score=5・boolean の5問を1リクエストで投げている。</p>
</main>
<script>
const PALETTE = ${PALETTE_JSON};
const FAMILY_LABELS = ${FAMILY_JSON};
const $ = id => document.getElementById(id);
const pct = v => (v * 100).toFixed(v >= 0.1 ? 1 : 2) + '%';

const cells = PALETTE.map(([name, hex]) => {
  const cell = document.createElement('div');
  cell.className = 'cell';
  cell.style.background = hex;
  cell.style.opacity = '0.14';
  cell.title = name;
  $('grid').append(cell);
  return cell;
});

let latest = null;
$('revealAll').addEventListener('change', () => paintGrid());

function paintGrid() {
  const revealed = $('revealAll').checked;
  if (!latest) return;
  const max = Math.max(...latest.distribution);
  latest.distribution.forEach((p, i) => {
    const lit = max > 0 ? p / max : 0;
    cells[i].style.opacity = revealed ? '1' : String(0.06 + 0.94 * lit);
    cells[i].style.boxShadow = max > 0 && p === max ? '0 0 0 2px var(--ink)' : 'none';
    cells[i].title = PALETTE[i][0] + ' ' + pct(p);
  });
}

function render(r) {
  latest = r;
  $('error').hidden = true;
  $('result').hidden = false;

  $('topSwatch').style.background = r.top.hex;
  $('topSwatch').style.color = r.top.ink;
  $('topName').textContent = r.top.name;
  $('topMeta').textContent = r.top.hex + ' ・ ' + pct(r.top.probability) + ' ・ ' + r.top.hint;

  $('mixSwatch').style.background = r.expected;
  $('mixSwatch').style.color = r.expectedInk;
  $('mixHex').textContent = r.expected;
  $('mixMeta').textContent = '累積90%に ' + r.spread + ' 色 ・ 分布が割れるほど灰へ寄る';

  paintGrid();

  $('bars').replaceChildren(...r.ranked.map(c => {
    const row = document.createElement('div');
    row.className = 'bar';
    const name = document.createElement('span');
    name.textContent = c.name;
    const track = document.createElement('div');
    track.className = 'track';
    const fill = document.createElement('div');
    fill.className = 'fill';
    fill.style.width = Math.max(1, c.probability * 100) + '%';
    fill.style.background = c.hex;
    track.append(fill);
    const p = document.createElement('span');
    p.className = 'p';
    p.textContent = pct(c.probability);
    row.append(name, track, p);
    return row;
  }));

  const stats = [
    ['絞り込み量', r.narrowed.toFixed(2) + ' / 7.99 bit'],
    ['系統', FAMILY_LABELS[r.family.key].split('（')[0] + ' ' + pct(r.family.probability)],
    ['明るさ', r.tone.label.slice(2)],
    ['鮮やかさ', r.vividness.label.slice(2)],
    ['色の手がかり無し', pct(r.colorless)],
    ['自己整合（明るさ/鮮やかさのずれ）', r.drift.tone.toFixed(2) + ' / ' + r.drift.vividness.toFixed(2)],
  ];
  $('stats').replaceChildren(...stats.map(([k, v]) => {
    const box = document.createElement('div');
    box.className = 'stat';
    const kk = document.createElement('div');
    kk.className = 'k';
    kk.textContent = k;
    const vv = document.createElement('div');
    vv.className = 'v';
    vv.textContent = v;
    box.append(kk, vv);
    return box;
  }));

  const cost = r.cost === null ? '不明' : '$' + r.cost.toFixed(6);
  $('usage').textContent = '入力 ' + (r.usage.inputTokens ?? '?') + ' / 出力 ' + (r.usage.outputTokens ?? '?')
    + ' tokens ・ ' + cost + ' ・ ' + r.durationMs + ' ms';

  $('caution').hidden = !(r.colorless >= 0.5 || r.narrowed < 1);
  $('caution').textContent = r.colorless >= 0.5
    ? '色の手がかりが薄い入力と判定されている。最有力の1色は参考値として読む。'
    : '分布がほとんど絞れていない。255択では情報が薄くても最大値は必ず1つ出る。';
}

function fail(message) {
  $('result').hidden = true;
  $('error').hidden = false;
  $('errorText').textContent = message;
}

$('text').addEventListener('input', e => {
  $('count').textContent = e.target.value.length + ' / ${MAX_TEXT_LENGTH}';
});
for (const button of document.querySelectorAll('[data-example]')) {
  button.addEventListener('click', () => {
    $('text').value = button.textContent;
    $('count').textContent = button.textContent.length + ' / ${MAX_TEXT_LENGTH}';
    $('form').requestSubmit();
  });
}

$('form').addEventListener('submit', async event => {
  event.preventDefault();
  const text = $('text').value.trim();
  if (!text) return;
  $('go').disabled = true;
  $('go').textContent = '塗っている…';
  try {
    const response = await fetch('/api/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const body = await response.json();
    if (!response.ok) fail('失敗: ' + (body.error ?? 'unknown'));
    else render(body);
  } catch {
    fail('失敗: network-error');
  } finally {
    $('go').disabled = false;
    $('go').textContent = '塗る';
  }
});
</script>
</html>`;
}
