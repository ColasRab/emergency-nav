"""Summarize surveyed checkpoints; never treats empty template rows as observations."""
import argparse,csv,json,math
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('csv',type=Path)
parser.add_argument('--out',type=Path,default=Path('reports/field-validation.json'))
args=parser.parse_args()
groups={}
with args.csv.open(newline='',encoding='utf-8-sig') as f:
    for row in csv.DictReader(f):
        if not all(row.get(k,'').strip() for k in ['estimatedX','estimatedZ','trueX','trueZ','estimatedHeading','trueHeading']): continue
        error=math.hypot(float(row['estimatedX'])-float(row['trueX']),float(row['estimatedZ'])-float(row['trueZ']))
        heading=abs((float(row['estimatedHeading'])-float(row['trueHeading'])+180)%360-180)
        groups.setdefault(row['buildingId'],[]).append((error,heading))
def percentile(values,p):
    a=sorted(values);i=(len(a)-1)*p;lo=int(i);hi=min(lo+1,len(a)-1)
    return a[lo]+(a[hi]-a[lo])*(i-lo)
report={}
for building in ['admin','ynares']:
    rows=groups.get(building,[])
    if not rows: report[building]={'count':0,'passed':False,'status':'field measurements required'};continue
    errors=[r[0] for r in rows];headings=[r[1] for r in rows]
    report[building]={'count':len(rows),'medianErrorM':percentile(errors,.5),'p95ErrorM':percentile(errors,.95),'p95HeadingErrorDeg':percentile(headings,.95),'passed':len(rows)>=10 and percentile(errors,.5)<.5 and percentile(errors,.95)<1.5 and percentile(headings,.95)<8}
args.out.parent.mkdir(parents=True,exist_ok=True)
args.out.write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
