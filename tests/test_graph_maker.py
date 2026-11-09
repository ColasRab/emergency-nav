"""Synthetic geometry checks; no real survey or original graph is changed."""
import importlib.util,json,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('graph_maker',ROOT/'scripts'/'build_graph.py')
maker=importlib.util.module_from_spec(spec);spec.loader.exec_module(maker)

class GraphMakerTests(unittest.TestCase):
    def test_multifloor_contract_and_symmetric_stairs(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);obj=root/'synthetic.obj'
            obj.write_text(''.join(f'v {x/10} {floor*3} {z/10}\n' for floor in [0,1] for x in range(7) for z in range(7)))
            survey={'buildingId':'admin','pythonSourceDir':r'C:\Users\colas\Documents\emergency-navigation','obj':str(obj),'upAxis':'Y','metersPerUnit':1,'resolution':.1,'maxSnapM':.15,'floors':[{'index':f,'baseY':f*3,'height':3,'exits':[[.1,.1]] if f==0 else [],'zones':[{'label':f'Stairs floor {f}','type':'stairs','position':[.1,.2]}]} for f in [0,1]],'stairs':[{'from':{'floor':0,'position':[.1,.2]},'to':{'floor':1,'position':[.1,.2]},'walkingDistanceM':3.5}]}
            config=root/'survey.json';config.write_text(json.dumps(survey));out=root/'graph.json';maker.build(config,out);data=json.loads(out.read_text())
            self.assertEqual(set(n[2] for n in data['nodes'].values()),{0,1});self.assertTrue(all(len(n)==3 for n in data['nodes'].values()));self.assertEqual(data['meta']['units'],'meters');self.assertEqual(len(data['exits']),1)
            connectors=[(int(a),b,w) for a,edges in data['edges'].items() for b,w in edges if data['nodes'][a][2]!=data['nodes'][str(b)][2]]
            self.assertEqual(len(connectors),2);a,b,w=connectors[0];self.assertIn((b,a,w),connectors)
            diagnostics=json.loads(out.with_suffix('.inspection.json').read_text());self.assertEqual(diagnostics['unreachableNodes'],0);self.assertTrue(all(f['components']==1 for f in diagnostics['floors']))
    def test_missing_measurements_fail_before_creating_a_graph(self):
        with tempfile.TemporaryDirectory() as folder:
            out=Path(folder)/'graph.json'
            with self.assertRaisesRegex(ValueError,'measured metersPerUnit'):maker.build(ROOT/'scripts'/'survey-admin.example.json',out)
            self.assertFalse(out.exists())
if __name__=='__main__':unittest.main()
