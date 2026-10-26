# 原本PDFの文字列が生成PDFに含まれているか照合（空白・全角スペース・記号ゆれを正規化）
import sys, re, pymupdf, unicodedata
def norm(s):
    s = unicodedata.normalize('NFKC', s)
    s = re.sub(r'[\s　]+', '', s)
    s = s.replace('（','(').replace('）',')').replace('：',':').replace('～','~').replace('ｐ','p')
    return s
def lines(path):
    d = pymupdf.open(path); out = []
    for p in d:
        for b in p.get_text('dict')['blocks']:
            if b['type'] != 0: continue
            for l in b['lines']:
                t = norm(''.join(s['text'] for s in l['spans']))
                if t: out.append(t)
    return out
orig, gen = lines(sys.argv[1]), lines(sys.argv[2])
G = ''.join(gen)
missing = []
for t in orig:
    # 行単位で照合。折り返し位置が違うので、原本の行が生成側の連結文字列に含まれるかを見る
    if t not in G: missing.append(t)
print(f'原本 {len(orig)} 行中、生成側に見つからない行: {len(missing)}')
for m in missing: print('  MISSING:', m)
