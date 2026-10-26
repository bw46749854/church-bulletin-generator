# hymns.txt（歌詞 pptx のファイル名一覧）→ 賛美マスタ（番号→曲名）
# ルール：行頭の1〜3桁の数字＝番号。番号の直後から、次に数字（16.9 等の比率・_1 等の連番）や拡張子が現れる手前までが曲名。
#         曲名にアラビア数字は含まれない前提。同じ番号に複数の曲名があれば、他の曲名の先頭部分になっている最短のものを採り、残りは要確認として報告。
import re, json, sys, unicodedata
from collections import defaultdict
src = sys.argv[1]; out = sys.argv[2]
cand = defaultdict(list); skipped = []
pat = re.compile(r'^\s*(\d{1,3})(.*?)\.pptx?\s*$', re.I)
for raw in open(src, encoding='utf-8'):
    line = raw.rstrip('\n')
    if not line.strip() or line.strip() in ('C:.',): continue
    m = pat.match(line)
    if not m: skipped.append(line.strip()); continue
    no, rest = m.group(1), unicodedata.normalize('NFKC', m.group(2))
    title = re.split(r'[0-9０-９_]', rest, maxsplit=1)[0].strip()       # 最初の数字・アンダースコアの手前まで
    title = title.strip(' 　.．-')
    if not title: continue                                      # 「126 16.9.pptx」のような曲名なしは捨てる
    cand[int(no)].append(title)
master, review = {}, {}
for no in sorted(cand):
    titles = sorted(set(cand[no]), key=len)
    best = titles[0]
    others = [t for t in titles[1:] if not t.startswith(best)]
    if others: review[no] = titles
    master[str(no)] = best
json.dump(master, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(f'番号 {len(master)} 件を書き出し（範囲 {min(cand)}〜{max(cand)}）')
if skipped: print('解釈できなかった行:', *skipped, sep='\n  ')
if review: print('同じ番号に別の曲名（要確認、最短を採用）:', *[f'{k}: {v}' for k, v in review.items()], sep='\n  ')
