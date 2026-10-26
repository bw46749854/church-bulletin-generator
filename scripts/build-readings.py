# readings.txt（交読文 pptx のファイル名一覧）→ 交読文マスタ（番号→題）
# ルール：行頭の1〜3桁の数字（全角も可）＝番号。番号の後の区切り（空白・「.」・「（」）を飛ばし、
#         「_」（日付の区切り）の手前までが題。題は NFKC 正規化し、囲みの括弧を外し、内部の空白を除く。
#         表記の統一：詩編→詩篇、「詩N編/詩篇N/(詩篇N)」→「詩篇N篇」、フィリピ→ピリピ、「I 」→「Ⅰ」、⑴→(1)。
#         同じ番号に複数の題があれば多数決（同数なら短い方）、候補を報告する。
import re, json, sys, unicodedata
from collections import defaultdict, Counter
src, out = sys.argv[1], sys.argv[2]
cand = defaultdict(Counter); skipped = []
head = re.compile(r'^\s*([0-9０-９]{1,3})[\s　.．（(]*(.+?)_.*\.pptx?\s*$', re.I)
def norm(t):
    t = unicodedata.normalize('NFKC', t).strip()
    t = re.sub(r'\s+', '', t)
    if re.match(r'^[（(].*[)）]$', t): t = t[1:-1]          # 題全体を囲む括弧だけ外す
    t = t.replace('⑴', '(1)').replace('⑵', '(2)')
    t = re.sub(r'[（(]([0-9])[)）]', r'(\1)', t)
    t = t.replace('フィリピ', 'ピリピ')
    t = re.sub(r'^I(?=[ァ-ヶ])', 'Ⅰ', t); t = re.sub(r'^II(?=[ァ-ヶ])', 'Ⅱ', t)
    m = re.match(r'^詩[篇編]?(\d+)[篇編]?$', t)          # 詩1編 / 詩篇27 / 詩編28編 → 詩篇N篇
    if m: t = f'詩篇{m.group(1)}篇'
    return t
for raw in open(src, encoding='utf-8'):
    line = raw.rstrip('\n')
    if not line.strip() or line.strip() == 'C:.': continue
    m = head.match(line)
    if not m: skipped.append(line.strip()); continue
    no = int(unicodedata.normalize('NFKC', m.group(1)))
    title = norm(m.group(2))
    if not title: skipped.append(line.strip()); continue
    cand[no][title] += 1
master, review = {}, {}
for no in sorted(cand):
    ranked = sorted(cand[no].items(), key=lambda kv: (-kv[1], len(kv[0])))
    master[str(no)] = ranked[0][0]
    if len(ranked) > 1: review[no] = [f'{t}×{c}' for t, c in ranked]
json.dump(master, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(f'番号 {len(master)} 件（範囲 {min(cand)}〜{max(cand)}）')
if skipped: print('解釈できなかった行（無視）:', *skipped, sep='\n  ')
if review: print('同じ番号に複数の表記（多数決で採用）:', *[f'{k}: {v}' for k, v in review.items()], sep='\n  ')
