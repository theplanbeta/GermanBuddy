# usage: pyrun.py <extractor> <corpus> ; same output format as run.mjs. Reads untrusted HTML as data only.
import sys, os, json, gzip, time, re
name, corpus = sys.argv[1:3]
root = os.path.abspath('..') if os.path.basename(os.getcwd())=='proto' else os.getcwd()
items=[]
if corpus=='wceb':
    for m in json.load(open(root+'/out/manifests/wceb.json')): items.append((m['id'],m['url'],open(root+'/'+m['path'],encoding='utf8',errors='replace').read()))
elif corpus=='aeb':
    b=root+'/corpora/article-extraction-benchmark'
    gt=json.load(open(b+'/ground-truth.json'))
    for i,v in gt.items():
        items.append((i,v['url'],gzip.open(f'{b}/html/{i}.html.gz').read().decode('utf8','replace')))
else:
    d=root+'/corpora/readability/test/test-pages'
    for i in sorted(os.listdir(d)):
        items.append((i,'http://fakehost/test/page.html',open(f'{d}/{i}/source.html',encoding='utf8',errors='replace').read()))
def html2text(h):
    from lxml import html as LH
    if not h: return ''
    t=LH.fromstring('<div>'+h+'</div>')
    for e in t.iter('p','div','li','h1','h2','h3','h4','h5','h6','tr','blockquote','pre','br','figcaption'):
        e.tail='\n'+(e.tail or '')
    return re.sub(r'\n+','\n',re.sub(r'[ \t\xa0]+',' ',t.text_content())).strip()
def traf(h,u):
    import trafilatura
    return {'text': trafilatura.extract(h,url=u,favor_recall=False,include_comments=False,include_tables=False) or ''}
def traf_recall(h,u):
    import trafilatura
    return {'text': trafilatura.extract(h,url=u,favor_recall=True,include_comments=False,include_tables=True) or ''}
def rlxml(h,u):
    from readability import Document
    d=Document(h); return {'text': html2text(d.summary()), 'title': d.short_title()}
def goose(h,u):
    from goose3 import Goose
    g=Goose({'enable_image_fetching':False}); a=g.extract(raw_html=h); return {'text':a.cleaned_text,'title':a.title}
def np4k(h,u):
    from newspaper import Article
    a=Article(u); a.download(input_html=h); a.parse(); return {'text':a.text,'title':a.title,'byline':', '.join(a.authors)}
def jt(h,u):
    import justext
    ps=justext.justext(h.encode('utf8'),justext.get_stoplist('English'))
    return {'text':'\n'.join(p.text for p in ps if not p.is_boilerplate)}
F={'trafilatura':traf,'trafilatura_recall':traf_recall,'readability_lxml':rlxml,'goose3':goose,'newspaper4k':np4k,'justext':jt}
fn=F[name]; out={}
for i,u,h in items:
    t=time.perf_counter()
    try: r=fn(h,u)
    except Exception as e: r={'text':'','error':str(e)[:200]}
    r['ms']=(time.perf_counter()-t)*1000; r['htmlBytes']=len(h); out[i]=r
os.makedirs(root+f'/out/{corpus}',exist_ok=True)
json.dump(out,open(root+f'/out/{corpus}/{name}.json','w'))
ms=sorted(o['ms'] for o in out.values()); print(name,corpus,'done',len(out),'errors',sum(1 for o in out.values() if 'error' in o),'median ms',round(ms[len(ms)//2],1))
