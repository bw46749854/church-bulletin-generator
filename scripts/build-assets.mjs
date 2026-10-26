// Worker の静的アセットを集める。
//   dist/（週報 Worker）: 入力画面 → /input-shuho/、
//     テンプレ → /shuho-assets/template/、フォント → /shuho-assets/fonts/（PDF エンジンがここから読む）
//   dist-slides/（担当者用 Worker。docs/slides-role.md）: 担当者ページ → /input-shuho/slides/
// 2 つのページは ui/・lib/・vendor/ を同じ並びで持つ（部品は URL をページからの相対で書くため）
// **データ（data/ の中身、D1・KV）はここに入れない。** アセットは Worker のコードを通らずに返るので、門番（受付の証明）が効かない。
// データは api/ からだけ渡す（docs/ARCHITECTURE.md §10 の 7）。集める場所を増やしたら tests/assets-no-data.test.mjs の許可の一覧も直す
// 実行: node scripts/build-assets.mjs [出力先]（既定はリポジトリの直下。試験は一時フォルダに組み立てる）
import { rmSync, mkdirSync, cpSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const out = process.argv[2] ? resolve(process.argv[2]) : root;
const dist = resolve(out, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(resolve(dist, 'input-shuho'), { recursive: true });
cpSync(resolve(root, 'src/admin'), resolve(dist, 'input-shuho'), { recursive: true });
/** 2 つのページで共通: 部品（ui/）、pptx を組む（lib/slides.mjs と lib/slides/・JSZip）、PDF の描画（PDF.js、自前配置・CDN なし） */
function copyCommon(page) {
  cpSync(resolve(root, 'src/ui'), resolve(page, 'ui'), { recursive: true });   // 担当者ページと共通の部品（docs/slides-role.md §5）
  mkdirSync(resolve(page, 'vendor/pdfjs'), { recursive: true }); mkdirSync(resolve(page, 'lib'), { recursive: true });
  cpSync(resolve(root, 'node_modules/jszip/dist/jszip.min.js'), resolve(page, 'vendor/jszip.min.js'));   // ブラウザ内で pptx を組む
  cpSync(resolve(root, 'src/lib/slides.mjs'), resolve(page, 'lib/slides.mjs'));
  cpSync(resolve(root, 'src/lib/slides'), resolve(page, 'lib/slides'), { recursive: true });   // 生成の 5 段（docs/pptx-template.md §1.3）
  for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) cpSync(resolve(root, 'node_modules/pdfjs-dist/build', f), resolve(page, 'vendor/pdfjs', f));
}
copyCommon(resolve(dist, 'input-shuho'));
cpSync(resolve(root, 'src/lib/bible.mjs'), resolve(dist, 'input-shuho/lib/bible.mjs'));   // 入力画面の聖書箇所の解釈（parseRef）
cpSync(resolve(root, 'src/lib/html.mjs'), resolve(dist, 'input-shuho/lib/html.mjs'));     // 画面プレビュー（ブラウザで紙面 HTML を組む）
mkdirSync(resolve(dist, 'shuho-assets'), { recursive: true });
cpSync(resolve(root, 'src/template'), resolve(dist, 'shuho-assets/template'), { recursive: true, filter: (s) => !/\.rendered-.*\.html$/.test(s) });
cpSync(resolve(root, 'src/fonts'), resolve(dist, 'shuho-assets/fonts'), { recursive: true });
{   // テンプレの版（template/ の中身と fonts/ のファイル名・サイズ）。PDF の写しの指紋に入る。dev-server の templateVersionOf と同じ計算
  const h = createHash('sha256'); const tpl = resolve(root, 'src/template'), fonts = resolve(root, 'src/fonts');
  for (const f of readdirSync(tpl).filter(f => !f.startsWith('.')).sort()) { h.update(f); h.update(readFileSync(resolve(tpl, f))); }
  for (const f of readdirSync(fonts).sort()) { h.update(f); h.update(readFileSync(resolve(fonts, f))); }   // 中身まで見る（同じ名前・同じ大きさで差し替えても版が変わるように）
  writeFileSync(resolve(dist, 'shuho-assets/template/version.txt'), h.digest('hex').slice(0, 16) + '\n');
}
writeFileSync(resolve(dist, '_headers'), [
  '/input-shuho/*', '  X-Robots-Tag: noindex',   // 検索に載せない（Access で守られてはいるが念のため）
  '/shuho-assets/*', '  X-Robots-Tag: noindex',
  '/shuho-assets/fonts/*', '  Access-Control-Allow-Origin: *',   // Browser Rendering が setContent した文書（origin なし）からフォントを読めるように
].join('\n') + '\n');
console.log('built', dist);

// 担当者用 Worker（slides/wrangler.jsonc の assets）。見た目は入力画面と同じ admin.css を使う
const slidesDist = resolve(out, 'dist-slides'); const slidesPage = resolve(slidesDist, 'input-shuho/slides');
rmSync(slidesDist, { recursive: true, force: true });
mkdirSync(slidesPage, { recursive: true });
cpSync(resolve(root, 'src/slides-page'), slidesPage, { recursive: true });
cpSync(resolve(root, 'src/admin/admin.css'), resolve(slidesPage, 'admin.css'));
copyCommon(slidesPage);
writeFileSync(resolve(slidesDist, '_headers'), ['/input-shuho/slides/*', '  X-Robots-Tag: noindex'].join('\n') + '\n');
console.log('built', slidesDist);
