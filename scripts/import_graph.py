"""Normalize a Python graph without modifying its source or inventing exits/floors."""
import argparse
import json
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('source',type=Path)
parser.add_argument('--building',required=True,choices=['admin','ynares'])
parser.add_argument('--floor',type=int,help='Required for legacy [x,z] graphs; verified survey floor index')
parser.add_argument('--out',required=True,type=Path)
args=parser.parse_args()
data=json.loads(args.source.read_text())
for key,node in data['nodes'].items():
    if len(node)==2:
        if args.floor is None: parser.error('Legacy graph has no floor; provide --floor after checking the survey.')
        node.append(args.floor)
    if len(node)!=3: parser.error('Expected [x,z,floor] nodes')
data.setdefault('zones',{})
data.setdefault('meta',{}).update(buildingId=args.building,version=2,units='unverified')
args.out.parent.mkdir(parents=True,exist_ok=True)
args.out.write_text(json.dumps(data,separators=(',',':')))
print(f'Imported {len(data["nodes"])} nodes. Exits, units, floors and alignment still require survey verification.')
