"""Read-only inspection of Kiri OBJ/ASCII PLY and the application's graph."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import struct
import numpy as np


def jpeg_size(path):
    with open(path, 'rb') as f:
        if f.read(2) != b'\xff\xd8':
            return None
        while True:
            marker = f.read(1)
            if not marker:
                return None
            if marker != b'\xff':
                continue
            code = f.read(1)
            while code == b'\xff':
                code = f.read(1)
            if code in (b'\xd8', b'\xd9'):
                continue
            length = struct.unpack('>H', f.read(2))[0]
            if code[0] in (0xc0, 0xc1, 0xc2):
                _, h, w = struct.unpack('>BHH', f.read(5))
                return [w, h]
            f.seek(length - 2, 1)


def inspect(path):
    vertices, faces = [], []
    uv_count, textured_faces, materials = 0, 0, []
    with open(path, encoding='utf-8') as f:
        if path.suffix.lower() == '.obj':
            for line in f:
                if line.startswith('v '):
                    vertices.append(tuple(map(float, line.split()[1:4])))
                elif line.startswith('vt '):
                    uv_count += 1
                elif line.startswith('mtllib '):
                    materials.append(line.strip()[7:])
                elif line.startswith('f '):
                    parts = line.split()[1:]
                    ids = [int(p.split('/')[0]) for p in parts]
                    ids = [i - 1 if i > 0 else len(vertices) + i for i in ids]
                    faces.append(ids)
                    textured_faces += int(all('/' in p and p.split('/')[1] for p in parts))
        else:
            vertex_count, face_count = 0, 0
            header = []
            for line in f:
                header.append(line.strip())
                if line.startswith('element vertex '):
                    vertex_count = int(line.split()[2])
                if line.startswith('element face '):
                    face_count = int(line.split()[2])
                if line.strip() == 'end_header':
                    break
            if 'format ascii 1.0' not in header:
                raise ValueError('Only ASCII PLY is supported by this inspection script')
            uv_count = vertex_count if 'property float s' in header and 'property float t' in header else 0
            for _ in range(vertex_count):
                vertices.append(tuple(map(float, next(f).split()[:3])))
            for _ in range(face_count):
                parts = list(map(int, next(f).split()))
                faces.append(parts[1:1+parts[0]])
            textured_faces = len(faces) if uv_count else 0
    v = np.asarray(vertices, dtype=float)
    tri = np.asarray([[face[0], face[i], face[i+1]] for face in faces for i in range(1, len(face)-1)], dtype=int)
    invalid = int(np.sum((tri < 0) | (tri >= len(v))))
    if invalid:
        raise ValueError(f'{path}: {invalid} invalid triangle indices')
    a, b, c = v[tri[:, 0]], v[tri[:, 1]], v[tri[:, 2]]
    normals = np.cross(b - a, c - a)
    length = np.linalg.norm(normals, axis=1)
    unit = normals / np.maximum(length[:, None], 1e-12)
    horizontal = np.abs(unit[:, 1]) > .9
    heights = (a[:, 1] + b[:, 1] + c[:, 1]) / 3
    edges = np.arange(np.floor(v[:, 1].min()*10)/10, np.ceil(v[:, 1].max()*10)/10 + .11, .1)
    hist, edges = np.histogram(heights[horizontal], bins=edges, weights=length[horizontal]/2)
    peaks = sorted([{'baseY': round(float(edges[i]), 3), 'horizontalArea': round(float(hist[i]), 3)} for i in range(len(hist))], key=lambda p: p['horizontalArea'], reverse=True)[:12]
    texture = path.with_suffix('.jpg')
    material_status = {name: (path.parent/name).exists() for name in materials}
    return {'path': str(path), 'bytes': path.stat().st_size, 'vertices': len(v), 'faces': len(faces),
            'triangles': len(tri), 'bbox': [v.min(axis=0).tolist(), v.max(axis=0).tolist()],
            'extent': np.ptp(v, axis=0).tolist(), 'uvVertices': uv_count, 'texturedFaces': textured_faces,
            'materialFiles': material_status, 'texture': str(texture), 'textureExists': texture.exists(),
            'textureResolution': jpeg_size(texture) if texture.exists() else None,
            'normalAreaByAxis': (np.sum(np.abs(unit) * length[:, None]/2, axis=0)).tolist(),
            'yHorizontalSurfaceHistogram': [{'baseY': round(float(edges[i]), 3), 'area': round(float(hist[i]), 3)} for i in range(len(hist))],
            'ySurfacePeaks': peaks, 'units': 'unverified', 'upAxis': 'Y candidate; needs physical confirmation',
            'buildingId': None}


def graph_report(path):
    data = json.loads(path.read_text())
    nodes = data['nodes']
    missing = [(key, dest) for key, links in data['edges'].items() for dest, _ in links if key not in nodes or str(dest) not in nodes]
    return {'path': str(path), 'bytes': path.stat().st_size, 'nodes': len(nodes),
            'directedEdges': sum(map(len, data['edges'].values())), 'floors': sorted(set(n[2] if len(n) > 2 else 0 for n in nodes.values())),
            'nodeCoordinateLengths': sorted(set(len(n) for n in nodes.values())),
            'exits': data.get('exits', []), 'zones': data.get('zones', {}), 'meta': data.get('meta'),
            'bboxXZ': [[min(n[i] for n in nodes.values()), max(n[i] for n in nodes.values())] for i in range(2)],
            'missingEdgeReferences': len(missing),
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('models', nargs='+', type=Path)
    parser.add_argument('--graph', action='append', type=Path, default=[])
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    report = {'models': [], 'graphs': []}
    for model in args.models:
        result = inspect(model)
        report['models'].append(result)
        print(json.dumps({k: result[k] for k in ('path', 'vertices', 'triangles', 'extent', 'textureResolution')}), flush=True)
    report['graphs'] = [graph_report(p) for p in args.graph]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2), encoding='utf-8')
