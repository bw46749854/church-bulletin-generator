// 礼拝スライド（pptx）の生成の入口。牧師の画面・担当者ページが pageUrl('lib/slides.mjs') で読む。
// 中身は src/lib/slides/（①値・②部品の展開・③組み立て・④式順・⑤確かめ）。設計は docs/pptx-template.md
export { buildSlides, TEMPLATE_KEYS } from './slides/build.mjs';
export { TemplateError } from './slides/check.mjs';
