/** 1画面ぶんの HTML。テンプレートエンジンは入れず、出力経路をこの1ファイルに閉じる。
 *
 * 画面の主役は3本のヒストグラムである。Jev が返すのは「1色」ではなく
 * 成分ごとの16段階の確率で、そこから 0〜255 の3つの数が出てくる過程を見せる。
 * 利用者の入力はサーバーへ送るだけで、描画は必ず textContent 経由にする。
 */

import { LEVELS, LEVEL_HINTS, STEP } from './channels';
import { MAX_TEXT_LENGTH } from './evaluate';

const LEVEL_VALUES = JSON.stringify(Array.from({ length: LEVELS }, (_, i) => i * STEP));
const LEVEL_LABELS = JSON.stringify(LEVEL_HINTS.map(h => h.split(':')[0]!.trim()));

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
<title>jev-rgb — JevにRGBを0〜255で決めさせる</title>
<style>
:root { color-scheme: dark; --bg:#0d0f14; --panel:#161a23; --line:#262c3a; --ink:#e7eaf2; --dim:#99a1b5; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font-family:system-ui,"Hiragino Sans","Noto Sans JP",sans-serif; line-height:1.7; }
main { max-width: 960px; margin: 0 auto; padding: 32px 16px 80px; }
h1 { font-size: 1.5rem; margin: 0 0 4px; }
h2 { font-size:.95rem; margin:0; letter-spacing:.04em; }
.lede { color: var(--dim); margin: 0 0 24px; font-size: .9rem; }
textarea { width:100%; min-height:96px; padding:12px; border-radius:10px; border:1px solid var(--line); background:var(--panel); color:var(--ink); font:inherit; resize:vertical; }
.row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:12px; }
button { font:inherit; padding:9px 18px; border-radius:999px; border:1px solid var(--line); background:var(--panel); color:var(--ink); cursor:pointer; }
button.primary { background:var(--ink); color:var(--bg); border-color:var(--ink); font-weight:600; }
button:disabled { opacity:.5; cursor:progress; }
.chip { font-size:.8rem; padding:5px 12px; color:var(--dim); }
.count { color:var(--dim); font-size:.8rem; margin-left:auto; }
section { margin-top:32px; }
.swatches { display:grid; grid-template-columns:2fr 1fr 1fr; gap:12px; }
.swatch { border-radius:12px; padding:16px; min-height:140px; display:flex; flex-direction:column; justify-content:space-between; border:1px solid var(--line); }
.swatch .k { font-size:.72rem; opacity:.75; letter-spacing:.04em; }
.swatch .v { font-size:1.3rem; font-weight:700; font-variant-numeric:tabular-nums; }
.swatch .m { font-size:.76rem; opacity:.85; font-variant-numeric:tabular-nums; }
.channels { display:grid; gap:14px; margin-top:12px; }
.channel { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:12px 14px; }
.channel header { display:flex; align-items:baseline; gap:10px; font-size:.82rem; color:var(--dim); }
.channel header .name { color:var(--ink); font-weight:600; font-size:.9rem; }
.channel header .val { margin-left:auto; color:var(--ink); font-size:1.15rem; font-weight:700; font-variant-numeric:tabular-nums; }
.hist { display:grid; grid-template-columns:repeat(16,1fr); gap:3px; align-items:end; height:92px; margin-top:8px; position:relative; }
.hist .col { display:flex; flex-direction:column; justify-content:flex-end; height:100%; background:rgba(231,234,242,.05); border-radius:3px; }
.hist .fill { border-radius:3px 3px 0 0; min-height:2px; }
.axis { display:grid; grid-template-columns:repeat(16,1fr); gap:3px; font-size:.6rem; color:var(--dim); margin-top:4px; font-variant-numeric:tabular-nums; }
.axis span { text-align:center; overflow:hidden; }
.mean { position:absolute; top:-4px; bottom:0; width:2px; background:var(--ink); opacity:.85; }
.mean::after { content:''; position:absolute; top:-4px; left:-3px; border:4px solid transparent; border-top-color:var(--ink); }
.cube { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-top:12px; }
.tile { display:grid; grid-template-columns:repeat(16,1fr); gap:1px; }
.tileWrap { display:grid; gap:4px; }
.tileWrap .cap { font-size:.62rem; color:var(--dim); font-variant-numeric:tabular-nums; }
.cell { aspect-ratio:1; border-radius:1px; }
.bars { display:grid; gap:6px; margin-top:12px; }
.bar { display:grid; grid-template-columns:8.5rem 1fr 4.5rem; gap:10px; align-items:center; font-size:.85rem; font-variant-numeric:tabular-nums; }
.bar .track { height:12px; background:var(--panel); border-radius:999px; overflow:hidden; }
.bar .fill { height:100%; border-radius:999px; }
.bar .p { text-align:right; color:var(--dim); }
.stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-top:12px; }
.stat { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px; }
.stat .k { font-size:.72rem; color:var(--dim); }
.stat .v { font-size:1.05rem; font-weight:600; font-variant-numeric:tabular-nums; }
.note { color:var(--dim); font-size:.8rem; }
.warn { border-left:3px solid #d9a62e; padding-left:12px; }
.err { border-left:3px solid #d9333f; padding-left:12px; }
[hidden] { display:none !important; }
@media (max-width:600px) { .swatches { grid-template-columns:1fr; } .cube { grid-template-columns:repeat(2,1fr); } }
</style>
<main>
  <h1>JevにRGBを0〜255で決めさせる</h1>
  <p class="lede">文章から連想される色を、R・G・Bの3成分に分けて Jev に聞く。返ってくるのは1色ではなく、成分ごとの16段階の確率である。そこから 0〜255 の3つの数が出てくるまでを見る。</p>

  <form id="form">
    <textarea id="text" maxlength="${MAX_TEXT_LENGTH}" placeholder="情景でも、気分でも、コミットメッセージでもよい" required></textarea>
    <div class="row">
      <button class="primary" id="go" type="submit">色にする</button>
      ${EXAMPLES.map(e => `<button class="chip" type="button" data-example>${e}</button>`).join('')}
      <span class="count" id="count">0 / ${MAX_TEXT_LENGTH}</span>
    </div>
  </form>

  <section id="error" hidden><p class="err" id="errorText"></p></section>

  <section id="result" hidden>
    <div class="swatches">
      <div class="swatch" id="expectedSwatch">
        <div><div class="k">期待値の色（成分ごとの加重平均）</div><div class="v" id="expectedCss"></div></div>
        <div class="m" id="expectedMeta"></div>
      </div>
      <div class="swatch" id="linearSwatch">
        <div><div class="k">光の強さで平均した色</div><div class="v" id="linearHex"></div></div>
        <div class="m" id="linearMeta"></div>
      </div>
      <div class="swatch" id="peakSwatch">
        <div><div class="k">最頻レベルの組み合わせ</div><div class="v" id="peakHex"></div></div>
        <div class="m" id="peakMeta"></div>
      </div>
    </div>
    <p class="note warn" id="caution" hidden></p>

    <section>
      <h2>成分ごとの確率（16段階 × 3）</h2>
      <p class="note">1本の棒が「この成分がこの値である確率」。▼ が加重平均＝画面に出ている 0〜255 の値。</p>
      <div class="channels" id="channels"></div>
    </section>

    <section>
      <h2>3本を掛け合わせた4096色</h2>
      <p class="note">1タイル＝B固定、タイル内は横がG・縦がR。<strong>これは Jev が返した同時分布ではない</strong>。成分ごとの確率を独立と見なして掛けただけで、成分間の相関は応答に含まれていない。</p>
      <div class="cube" id="cube"></div>
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

  <p class="note" style="margin-top:40px">score=16段階 × 3（R・G・B）・score=5段階・boolean の5問を1リクエストで投げている。0〜255 は256段階だが、Jev の choice は候補255個までなので choice では並べきれない。順序のある成分には score の方が合う。</p>
</main>
<script>
const LEVEL_VALUES = ${LEVEL_VALUES};
const LEVEL_LABELS = ${LEVEL_LABELS};
const LEVELS = LEVEL_VALUES.length;
const $ = id => document.getElementById(id);
const pct = v => (v * 100).toFixed(v >= 0.1 ? 1 : 2) + '%';
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function channelCard(c) {
  const box = el('div', 'channel');
  const head = el('header');
  head.append(
    el('span', 'name', c.label),
    el('span', null, '絞り込み ' + c.narrowed.toFixed(2) + ' / 4 bit ・ 累積90%に ' + c.spread + ' 段階'),
    el('span', 'val', Math.round(c.value) + ' / 255'),
  );
  const max = Math.max(...c.distribution);
  const hist = el('div', 'hist');
  c.distribution.forEach((p, i) => {
    const col = el('div', 'col');
    const fill = el('div', 'fill');
    fill.style.height = (max > 0 ? (p / max) * 100 : 0) + '%';
    // 棒そのものを「その成分がその値のときの色」で塗る。0 は黒なので、枠線で存在を残す。
    const v = LEVEL_VALUES[i];
    fill.style.background = c.key === 'r' ? 'rgb(' + v + ',0,0)'
      : c.key === 'g' ? 'rgb(0,' + v + ',0)'
      : 'rgb(0,0,' + v + ')';
    fill.style.outline = '1px solid rgba(231,234,242,.25)';
    col.title = LEVEL_LABELS[i] + ' — ' + pct(p);
    col.append(fill);
    hist.append(col);
  });
  const mean = el('div', 'mean');
  // 棒は列の中央に立つので、平均の線も列の中央基準で置く。
  mean.style.left = ((c.score + 0.5) / LEVELS) * 100 + '%';
  hist.append(mean);
  const axis = el('div', 'axis');
  LEVEL_VALUES.forEach((v, i) => axis.append(el('span', null, i % 3 === 0 ? String(v) : '')));
  box.append(head, hist, axis);
  return box;
}

function cube(channels) {
  const [pr, pg, pb] = channels.map(c => c.distribution);
  let max = 0;
  for (let r = 0; r < LEVELS; r++) for (let g = 0; g < LEVELS; g++) for (let b = 0; b < LEVELS; b++) {
    max = Math.max(max, pr[r] * pg[g] * pb[b]);
  }
  return Array.from({ length: LEVELS }, (_, b) => b).map(b => {
    const tile = el('div', 'tile');
    tile.title = 'B = ' + LEVEL_VALUES[b];
    for (let r = 0; r < LEVELS; r++) for (let g = 0; g < LEVELS; g++) {
      const p = pr[r] * pg[g] * pb[b];
      const cell = el('div', 'cell');
      cell.style.background = 'rgb(' + LEVEL_VALUES[r] + ',' + LEVEL_VALUES[g] + ',' + LEVEL_VALUES[b] + ')';
      cell.style.opacity = String(0.04 + 0.96 * (max > 0 ? p / max : 0));
      cell.title = 'rgb(' + LEVEL_VALUES[r] + ', ' + LEVEL_VALUES[g] + ', ' + LEVEL_VALUES[b] + ') ' + pct(p);
      tile.append(cell);
    }
    const wrap = el('div', 'tileWrap');
    wrap.append(tile, el('div', 'cap', 'B = ' + LEVEL_VALUES[b]));
    return wrap;
  });
}

function render(r) {
  $('error').hidden = true;
  $('result').hidden = false;

  const rgb = r.expected.rgb;
  $('expectedSwatch').style.background = r.expected.hex;
  $('expectedSwatch').style.color = r.expected.ink;
  $('expectedCss').textContent = 'rgb(' + Math.round(rgb.r) + ', ' + Math.round(rgb.g) + ', ' + Math.round(rgb.b) + ')';
  $('expectedMeta').textContent = r.expected.hex + ' ・ R ' + rgb.r.toFixed(1) + ' / G ' + rgb.g.toFixed(1) + ' / B ' + rgb.b.toFixed(1);

  $('linearSwatch').style.background = r.expectedLinear.hex;
  $('linearSwatch').style.color = r.expectedLinear.ink;
  $('linearHex').textContent = r.expectedLinear.hex;
  $('linearMeta').textContent = '同じ分布を8bitの目盛りではなく光の強さで平均すると、分布が割れているほど明るい側へずれる';

  $('peakSwatch').style.background = r.peak.hex;
  $('peakSwatch').style.color = r.peak.ink;
  $('peakHex').textContent = r.peak.hex;
  $('peakMeta').textContent = '3成分とも最頻 ・ 独立と見なした確率 ' + pct(r.peak.probability);

  $('channels').replaceChildren(...r.channels.map(channelCard));
  $('cube').replaceChildren(...cube(r.channels));

  $('bars').replaceChildren(...r.ranked.map(c => {
    const row = el('div', 'bar');
    const track = el('div', 'track');
    const fill = el('div', 'fill');
    fill.style.width = Math.max(1, (c.probability / r.ranked[0].probability) * 100) + '%';
    fill.style.background = c.hex;
    track.append(fill);
    row.append(el('span', null, c.hex), track, el('span', 'p', pct(c.probability)));
    return row;
  }));

  const stats = [
    ['絞り込み量（3成分の合計）', r.narrowed.toFixed(2) + ' / 12 bit'],
    ['明るさ（Jevの自己申告）', r.brightness.label.slice(2)],
    ['無彩色', pct(r.achromatic)],
    ['自己整合（明るさのずれ）', r.drift.brightness.toFixed(2) + ' / 4'],
    ['自己整合（無彩色のずれ）', r.drift.achromatic.toFixed(2) + ' / 1'],
  ];
  $('stats').replaceChildren(...stats.map(([k, v]) => {
    const box = el('div', 'stat');
    box.append(el('div', 'k', k), el('div', 'v', v));
    return box;
  }));

  const cost = r.cost === null ? '不明' : '$' + r.cost.toFixed(6);
  $('usage').textContent = '入力 ' + (r.usage.inputTokens ?? '?') + ' / 出力 ' + (r.usage.outputTokens ?? '?')
    + ' tokens ・ ' + cost + ' ・ ' + r.durationMs + ' ms';

  const thin = r.narrowed < 3;
  $('caution').hidden = !(r.achromatic >= 0.5 || thin);
  $('caution').textContent = thin
    ? '3成分ともほとんど絞れていない。成分ごとの期待値は必ず出るが、この色は「迷いの平均」に近い。'
    : '無彩色と判定されている。色みの薄い入力では、3成分の値が揃うだけで情報はほとんど無い。';
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
  $('go').textContent = '聞いている…';
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
    $('go').textContent = '色にする';
  }
});
</script>
</html>`;
}
