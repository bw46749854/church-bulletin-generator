// 担当者用の窓口（docs/slides-role.md §4）。担当者用 Worker（samplechurch-slides）から内線（Service Binding）で届いた依頼のうち、
// 許可の一覧にある仕事だけを、牧師の画面と同じ API（src/lib/api.mjs）に渡す。
// 許可の一覧（禁止の一覧ではない）なので、API に仕事が増えても、ここに書かない限り担当者には開かない。
// 週データを書く仕事（保存・新しい週・日付の変更・週の差し替え）、プレビュー、サイトへの反映、同期は置かない
import { TEMPLATE_KEY, TEMPLATE_DELETABLE, MATERIAL_KEY, filesPath } from './file-keys.mjs';
const DATE = '\\d{4}-\\d{2}-\\d{2}';
export const SLIDES_ALLOWED = [
  // 読む
  ['GET', /^bootstrap$/],                      // マスタ・名簿・保存済みの週の一覧など
  ['GET', new RegExp(`^week/${DATE}$`)],       // 保存済みの週
  ['GET', new RegExp(`^pdf/${DATE}$`)],        // 保存済みの週の PDF
  ['GET', /^files\/(?:hymns|readings)\/[\w.-]+\.pptx$/],   // スライドの素材
  ['GET', filesPath(TEMPLATE_KEY)], ['GET', /^templates$/],   // テンプレ一式（docs/pptx-template.md）と、その一覧
  ['GET', /^bible$/], ['GET', /^bible\/books$/],   // 聖書本文・書名の一覧
  ['GET', /^export$/],                         // マスタ一式
  // 書く（マスタと素材だけ）
  ['POST', /^masters\/(?:hymns|readings)$/],
  ['DELETE', /^masters\/(?:hymns|readings)\/\d{1,3}$/],
  ['PUT', filesPath(MATERIAL_KEY)], ['PUT', filesPath(TEMPLATE_KEY)],
  ['DELETE', filesPath(MATERIAL_KEY)], ['DELETE', filesPath(TEMPLATE_DELETABLE)],
  ['PUT', /^sync\/object\/(?:masters\/(?:people|hymns|readings)\.json|church\.json|prayer-list\.json|texts\.json)$/],   // JSON の差し替え（週データは除く）
];
export const slidesAllows = (method, path) => SLIDES_ALLOWED.some(([m, re]) => m === method && re.test(path));
/** 誰からの依頼か（受付で分かった人のメール）。担当者用 Worker（slides/relay.mjs）が付ける */
export const ACTOR_HEADER = 'x-shuho-actor';

/**
 * 窓口の 1 件。依頼の URL は <何か>/api/<仕事>（担当者用 Worker が自分の /input-shuho/slides/ を外して渡す）。
 * 誰からの依頼か（ACTOR_HEADER）が無いものは受け付けない（受付を通っていない依頼が紛れ込んでも通さない）。
 * @param {Request} request
 * @param {(request: Request, path: string) => Promise<Response>} api  createApi の結果（牧師の画面と同じ）
 * @param {string} origin  週報 Worker の公開アドレス。API の中では、牧師の画面から来たのと同じ URL に見せる
 *   （PDF エンジンは、この URL の /shuho-assets/ に紙面の CSS・フォントを取りに来る）
 */
export async function handleSlidesWindow(request, api, origin) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return json({ error: '窓口の依頼の形ではありません' }, 400);
  let path; try { path = decodeURIComponent(url.pathname.slice('/api/'.length)); } catch { return json({ error: 'パスが読めません' }, 400); }   // テンプレの部品の名前は日本語
  const who = request.headers.get(ACTOR_HEADER);
  if (!who) return json({ error: '誰からの依頼か分かりません（受付を通った依頼だけを受け付けます）' }, 401);
  if (!slidesAllows(request.method, path)) return json({ error: 'この操作は担当者ページではできません' }, 403);
  if (!origin) return json({ error: '週報 Worker の公開アドレス（SHUHO_PUBLIC_ORIGIN）が設定されていません' }, 500);
  const res = await api(new Request(`${origin.replace(/\/$/, '')}/input-shuho/api/${path}${url.search}`, request), path);
  // 書き込みは誰が何をしたかを Workers Logs に残す（記録と退避の仕組みは docs/slides-role.md §7 で別に作る）
  if (request.method !== 'GET') console.log('[担当者の書き込み]', JSON.stringify({ who, method: request.method, path, status: res.status }));
  return res;
}
const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
