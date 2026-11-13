import json,sys,re
from pathlib import Path
d=json.load(sys.stdin)
lines=[]
def walk(x):
 if x.get('name') or x.get('value'):
  t=' '.join(str(x.get(k,'')) for k in ['ref_id','role','name','value'])
  t=re.sub(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', '[email redacted]',t)
  t=re.sub(r'/Users/[^\s"<>]+','[personal path redacted]',t)
  if not any(z in t for z in ['spaces.pen','twibbonize-design-system','CONCEPT /','RESEARCH /','EXISTING /','REVISI /','FLOWCHART /','SYSTEM /','Spaces /','Mada']): lines.append(t)
 for c in x.get('children',[]):walk(c)
walk(d.get('data',{}).get('tree',{}))
out='\n'.join(lines)
if len(sys.argv)>1:Path(sys.argv[1]).write_text(out)
print(out)
