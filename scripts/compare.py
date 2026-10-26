# 生成PDFと原本PDFを同じDPIで画像化し、並べて／重ねて保存する
import sys, pymupdf
from PIL import Image, ImageChops
gen, orig, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
dpi = int(sys.argv[4]) if len(sys.argv) > 4 else 110
def pages(path):
    d = pymupdf.open(path)
    out = []
    for p in d:
        pix = p.get_pixmap(dpi=dpi, alpha=False)
        out.append(Image.frombytes('RGB', (pix.width, pix.height), pix.samples))
    return out
G, O = pages(gen), pages(orig)
print('pages gen/orig:', len(G), len(O), 'size', G[0].size, O[0].size)
for i, (g, o) in enumerate(zip(G, O), 1):
    g.save(f'{outdir}/gen_p{i}.png')
    # 重ね合わせ：原本=赤、生成=青（一致部分は黒）
    gL, oL = g.convert('L'), o.convert('L')
    ov = Image.merge('RGB', (oL, ImageChops.darker(gL, oL), gL))
    ov.save(f'{outdir}/overlay_p{i}.png')
    # 差分量
    diff = ImageChops.difference(gL, oL)
    bbox = diff.getbbox()
    hist = diff.histogram()
    changed = sum(hist[40:]) / (g.size[0] * g.size[1])
    print(f'page {i}: changed pixels {changed*100:.2f}%')
