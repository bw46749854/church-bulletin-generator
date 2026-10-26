// 素材（KV の files）のキーの決まり。API（api.mjs）と担当者の窓口（slides-window.mjs）が同じ決まりを見る（docs/pptx-template.md §1.1）。
// テンプレの部品の名前は日本語（URL ではエンコードされて届くので、比べる前に戻す）
const PART = '[\\p{L}\\p{N}_-]+';   // 部品名に使える字（src/lib/slides/check.mjs の validPartName と同じ）
/** テンプレ一式（docs/pptx-template.md） */
export const TEMPLATE_KEY = new RegExp(`^template/(?:背景\\.(?:pptx|json)|部品/${PART}\\.pptx|式順/(?:worship|afternoon|wednesday|other)\\.json)$`, 'u');
/** 消してよいテンプレ（部品だけ。背景・背景.json・式順は差し替えるだけ） */
export const TEMPLATE_DELETABLE = new RegExp(`^template/部品/${PART}\\.pptx$`, 'u');
/** 歌詞・交読文の pptx（置く・消すときは番号だけ） */
export const MATERIAL_KEY = /^(?:hymns|readings)\/\d{1,3}\.pptx$/;
/** 置いてよいキー（素材の差し替え） */
export const writableFile = (key) => MATERIAL_KEY.test(key) || TEMPLATE_KEY.test(key);
/** 読んでよいキー（スライドの素材） */
export const readableFile = (key) => /^(?:hymns|readings)\/[\w.-]+\.pptx$/.test(key) || TEMPLATE_KEY.test(key);
/** files/ が付いた API のパスの形（窓口の許可の一覧に使う） */
export const filesPath = (re) => new RegExp(`^files/${re.source.slice(1)}`, re.flags);
