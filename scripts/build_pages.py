"""Compile the supplied lesson into native HTML text and inline vector diagrams.

No PDF, canvas, page image, iframe, or remote font is used by the website.
The source typesetter outlined Japanese runs; these become a local webfont,
so their shapes, colour, and original coordinates are retained as HTML text.
"""
from pathlib import Path
from io import BytesIO
import fitz, html, json, re
from fontTools.ttLib import TTFont
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.cu2quPen import Cu2QuPen

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / 'upload/1001.pdf'
doc = fitz.open(SOURCE)
(ROOT / 'pages').mkdir(exist_ok=True)
(ROOT / 'fonts').mkdir(exist_ok=True)

def n(v): return f'{v:.3f}'.rstrip('0').rstrip('.') or '0'
def colour(rgb): return '#' + ''.join(f'{round(c*255):02x}' for c in rgb)
def decoded(t): return ''.join(chr(ord(c)-0xf000) if 0xf000 <= ord(c) < 0xf100 else c for c in t)

font_css = []
metrics = {}
for xref in sorted({f[0] for p in doc for f in p.get_fonts()}):
    name, ext, kind, data = doc.extract_font(xref)
    font = TTFont(BytesIO(data))
    upm = font['head'].unitsPerEm
    a, d = font['hhea'].ascent / upm, -font['hhea'].descent / upm
    metrics[name] = ((a-d)/2, xref)
    font.flavor = 'woff'
    font.save(ROOT / f'fonts/f{xref}.woff')
    font_css.append(f"@font-face{{font-family:f{xref};src:url('../fonts/f{xref}.woff') format('woff');font-display:block;ascent-override:{n(a*100)}%;descent-override:{n(d*100)}%;line-gap-override:0%}}")

glyphs = {}
glyph_order = ['.notdef']
glyph_map = {}
glyph_metrics = {'.notdef': (1000, 0)}
glyphs['.notdef'] = TTGlyphPen(None).glyph()

def outlined_text(d):
    """Turn an original outlined text run into an actual HTML font glyph."""
    rect = d['rect']; x0, y1 = rect.x0, rect.y1
    name = f'run{len(glyph_order)}'; cp = 0xe000 + len(glyph_order) - 1
    pen0 = TTGlyphPen(None); pen = Cu2QuPen(pen0, max_err=0.7, reverse_direction=False)
    current = None; start = None
    def point(p): return ((p.x-x0)*40, (y1-p.y)*40)
    def begin(p):
        nonlocal current, start
        if current is not None: pen.closePath()
        pen.moveTo(point(p)); current=p; start=p
    for item in d['items']:
        typ = item[0]
        if typ == 're':
            r=item[1]
            if current is not None: pen.closePath();current=None
            pen.moveTo(point(r.tl));pen.lineTo(point(r.tr));pen.lineTo(point(r.br));pen.lineTo(point(r.bl));pen.closePath()
            continue
        if typ == 'qu':
            if current is not None: pen.closePath();current=None
            q=item[1];pen.moveTo(point(q.ul));pen.lineTo(point(q.ur));pen.lineTo(point(q.lr));pen.lineTo(point(q.ll));pen.closePath()
            continue
        p0=item[1]
        if current is None or abs(p0.x-current.x)+abs(p0.y-current.y)>0.001: begin(p0)
        if typ=='l': pen.lineTo(point(item[2]));current=item[2]
        elif typ=='c': pen.curveTo(point(item[2]),point(item[3]),point(item[4]));current=item[4]
    if current is not None: pen.closePath()
    glyphs[name]=pen0.glyph();glyph_order.append(name);glyph_map[cp]=name
    glyph_metrics[name]=(max(1000,round(rect.width*40+40)),0)
    return f'<span class="ink outline" style="left:{n(x0)}px;top:{n(y1-12.5)}px;color:{colour(d["fill"])}">&#{cp};</span>'

def vector(d):
    commands=[];current=None
    for item in d['items']:
        typ=item[0]
        if typ=='re':
            r=item[1];commands.append(f'M{n(r.x0)} {n(r.y0)}H{n(r.x1)}V{n(r.y1)}H{n(r.x0)}Z');current=None
        elif typ=='qu':
            q=item[1];commands.append(f'M{n(q.ul.x)} {n(q.ul.y)}L{n(q.ur.x)} {n(q.ur.y)}L{n(q.lr.x)} {n(q.lr.y)}L{n(q.ll.x)} {n(q.ll.y)}Z');current=None
        else:
            p=item[1]
            if current is None or abs(p.x-current.x)+abs(p.y-current.y)>0.001: commands.append(f'M{n(p.x)} {n(p.y)}')
            if typ=='l': commands.append(f'L{n(item[2].x)} {n(item[2].y)}');current=item[2]
            elif typ=='c':commands.append('C'+' '.join(n(v) for p in item[2:] for v in (p.x,p.y)));current=item[4]
    if d['closePath']:commands.append('Z')
    attrs={'d':''.join(commands),'fill':colour(d['fill']) if d['fill'] else 'none','stroke':colour(d['color']) if d['color'] else 'none','stroke-width':n(d['width'] or 0),'fill-rule':'evenodd' if d['even_odd'] else 'nonzero'}
    if d.get('lineJoin') is not None: attrs['stroke-linejoin']=['miter','round','bevel'][int(d['lineJoin'])]
    if d.get('lineCap'):attrs['stroke-linecap']=['butt','round','square'][int(max(d['lineCap']))]
    dash=d.get('dashes') or '[] 0'
    m=re.match(r'\[([^\]]+)\]\s+([\d.-]+)',dash)
    if m:attrs['stroke-dasharray']=m[1];attrs['stroke-dashoffset']=m[2]
    return '<path '+' '.join(f'{k}="{v}"' for k,v in attrs.items())+'/>'

# Last solution stops before the next visible theory block, or after its last ink.
special_bottom={7:153,49:449,50:485}
sections=[(1,'不定積分'),(3,'置換積分'),(6,'微分した形がかけられている式'),(8,'分子が分母の微分になっている式'),(9,'部分積分法'),(11,'分数関数の積分'),(14,'三角関数の積分'),(19,'定積分'),(20,'絶対値を含む関数の定積分'),(21,'定積分の置換積分'),(24,'偶関数・奇関数の定積分'),(25,'定積分の部分積分')]
problems=[];page_info=[]
for idx,p in enumerate(doc,1):
    chars=[];nums=[]
    for b in p.get_text('rawdict')['blocks']:
        for line in b.get('lines',[]):
            for s in line['spans']:
                text=''.join(c['c'] for c in s['chars']);plain=decoded(text)
                if re.match(r'^\d+\.',plain) and s['bbox'][0]<35:
                    nums.append({'number':int(plain.split('.')[0]),'y':s['origin'][1],'top':s['bbox'][1]})
                offset,xref=metrics[s['font']]
                for c in s['chars']:
                    if decoded(c['c']).isspace():continue
                    x,y=c['origin'];size=s['size'];color=f'#{s["color"]:06x}'
                    chars.append(f'<span class="ink" style="left:{n(x)}px;top:{n(y-offset*size)}px;font:{n(size)}px/0 f{xref};color:{color}">{html.escape(c["c"])}</span>')
    drawings=[];outlines=[]
    for d in p.get_drawings():
        if d['type']=='f' and len(d['items'])>6:outlines.append(outlined_text(d))
        else:drawings.append(vector(d))
    parts=[f'<div class="paper-content" aria-hidden="true"><svg class="vectors" viewBox="0 0 {n(p.rect.width)} {n(p.rect.height)}" aria-hidden="true">'+''.join(drawings)+'</svg>',''.join(chars),''.join(outlines),'</div>']
    masks=[]
    for j,q in enumerate(nums):
        no=q['number'];base=q['y']
        # All lower limits, denominators, roots and superscripts remain exposed.
        question_bottom=max([c['bbox'][3] for b in p.get_text('rawdict')['blocks'] for line in b.get('lines',[]) for s in line['spans'] for c in s['chars'] if c['bbox'][0]<220 and base-24<c['origin'][1]<base+14]+[base+8])
        top=question_bottom+2
        ink_bottoms=[s['bbox'][3] for b in p.get_text('dict')['blocks'] for line in b.get('lines',[]) for s in line['spans'] if top<s['bbox'][3]<690]
        ink_bottoms.extend(d['rect'].y1 for d in p.get_drawings() if top<d['rect'].y1<690)
        end=nums[j+1]['top']-13 if j+1<len(nums) else special_bottom.get(no,min(690,max(ink_bottoms,default=top+25)+4))
        if no==7:end=153
        # Whole-solution masks include substitutions, annotations and diagrams.
        x=39 if no>=57 else 47
        masks.append((no,x,top,498,end))
        hints=[d['rect'] for d in p.get_drawings() if (d.get('fill') or d.get('color')) not in (None,(0.0,0.0,0.0)) and d['rect'].x0>155 and d['rect'].y0<top and d['rect'].y1>base-16]
        if hints and no!=4:
            hx=min(r.x0 for r in hints)-2;hy=min(r.y0 for r in hints)-2
            hr=min(500,max(r.x1 for r in hints)+3);hb=max(r.y1 for r in hints)+3
            masks.append((no,hx,hy,hr,hb))
        problems.append({'number':no,'page':idx,'y':round(base,2),'sheetY':round(top,2)})
    # A hint alongside problem 4 and alternative solutions have their own sheets.
    if idx==1:masks.append((4,129,526,284,563))
    if idx==5:masks.append((15,22,39,498,317))
    if idx==17:masks.append((49,22,450,498,690))
    if idx==18:masks.append((50,22,486,498,690))
    for no,x,top,right,bottom in masks:
        if bottom<=top:raise ValueError((idx,no,top,bottom))
        parts.append(f'<button type="button" class="sheet" data-question="{no}" aria-label="問題{no}の解答を表示" aria-expanded="false" style="--x:{n(x)}px;--y:{n(top)}px;--w:{n(right-x)}px;--h:{n(bottom-top)}px"><span class="sheet-label">タップで解答</span></button>')
    for q in nums:
        no=q['number']
        parts.append(f'<span class="question-anchor" id="q{no}" style="top:{n(q["top"]-10)}px" role="heading" aria-level="3">問題{no}</span>')
    (ROOT/f'pages/{idx:02}.html').write_text(''.join(parts),encoding='utf-8')
    page_info.append({'page':idx,'questions':[q['number'] for q in nums]})

fb=FontBuilder(1000,isTTF=True)
fb.setupGlyphOrder(glyph_order);fb.setupCharacterMap(glyph_map);fb.setupGlyf(glyphs)
fb.setupHorizontalMetrics(glyph_metrics);fb.setupHorizontalHeader(ascent=1000,descent=0)
fb.setupNameTable({'familyName':'Lesson outlines','styleName':'Regular','uniqueFontIdentifier':'Lesson1001outlines','fullName':'Lesson outlines','psName':'LessonOutlines'})
fb.setupOS2(sTypoAscender=1000,sTypoDescender=0,usWinAscent=1000,usWinDescent=0)
fb.setupPost();fb.font.flavor='woff';fb.save(ROOT/'fonts/outlines.woff')
font_css.append("@font-face{font-family:outlines;src:url('../fonts/outlines.woff') format('woff');font-display:block;ascent-override:100%;descent-override:0%;line-gap-override:0%}")
(ROOT/'pages/fonts.css').write_text('\n'.join(font_css),encoding='utf-8')
(ROOT/'lesson.json').write_text(json.dumps({'width':515.88,'height':728.52,'pages':page_info,'problems':problems,'sections':[{'page':p,'title':t} for p,t in sections]},ensure_ascii=False),encoding='utf-8')
assert [q['number'] for q in problems]==list(range(1,72))
print(f'Compiled {len(doc)} pages, {len(problems)} problems, {len(glyph_order)-1} native outline glyphs.')
