"""Original occurrence incidence; deliberately separate from solid geometry."""
from collections import defaultdict

from .domain import canonical,identity


def _connected(graph):
    if not graph:return False
    seen=set();pending=[next(iter(graph))]
    while pending:
        item=pending.pop()
        if item in seen:continue
        seen.add(item);pending.extend(graph[item]-seen)
    return len(seen)==len(graph)


def shell_incidence(observation,*,source_observation_sha256):
    if type(source_observation_sha256) is not str or len(source_observation_sha256)!=64 or any(c not in '0123456789abcdef' for c in source_observation_sha256):
        raise ValueError('Expected original observation SHA256')
    result=dict(schema='adaptive-original-shell-incidence-1',
        binding_id=identity(dict(original_faces=observation.get('faces'),
            preservation={k:observation.get(k) for k in ('schema','source_unchanged','tolerance_bits_equal','flags_equal')},
            source_observation_sha256=source_observation_sha256)),
        source_observation_sha256=source_observation_sha256,source_admitted=False,
        embedded_surface_proved=False,outward_orientation_proved=False,solid_container_proved=False)
    try:
        if observation['schema']!='adaptive-rational-patch-source-2':raise ValueError('Original v2 observation required')
        if any(observation[k] is not True for k in ('source_unchanged','tolerance_bits_equal','flags_equal')):
            raise ValueError('Original source preservation not established')
        faces=observation['faces']
        if not 4<=len(faces)<=256:raise ValueError('Selected closed-shell face count outside 4..256')
        face_ids=[f['index'] for f in faces]
        if any(type(i) is not int or i<=0 for i in face_ids) or len(set(face_ids))!=len(face_ids):raise ValueError('Invalid or repeated face ID')
        occurrences=defaultdict(list);vertices={};links=defaultdict(lambda:defaultdict(set))
        face_graph={i:set() for i in face_ids}
        for face in faces:
            if face['orientation'] not in (0,1) or len(face['wires'])!=1:raise ValueError('Selected simple oriented face required')
            wire=face['wires'][0];edges=wire['edges']
            if wire['orientation'] not in (0,1) or not 3<=len(edges)<=64 or len(edges)!=wire['occurrences'] or len(edges)!=wire['ordered_occurrences']:
                raise ValueError('Incomplete simple wire')
            eids=[e['index'] for e in edges]
            if any(type(i) is not int or i<=0 for i in eids) or len(set(eids))!=len(eids):raise ValueError('Repeated or invalid face edge')
            corner_ids=[]
            for i,edge in enumerate(edges):
                if edge['orientation'] not in (0,1) or len(edge['vertices'])!=2 or any(v is None for v in edge['vertices']):
                    raise ValueError('Missing oriented edge vertices')
                start,end=edge['vertices'];vids=[]
                for vertex in (start,end):
                    vid=vertex['index'];record=dict(point=vertex['point'],tolerance=vertex['tolerance'])
                    if type(vid) is not int or vid<=0:raise ValueError('Invalid vertex ID')
                    if vid in vertices and vertices[vid]!=record:raise ValueError('Shared original vertex differs')
                    vertices[vid]=record;vids.append(vid)
                if vids[0]==vids[1]:raise ValueError('Degenerate topological edge')
                following=edges[(i+1)%len(edges)]
                if following['vertices'][0]['index']!=vids[1]:raise ValueError('Ordered vertex chain is open')
                corner_ids.append(vids[0])
                occurrences[edge['index']].append(dict(face=face['index'],orientation=edge['orientation'],vertices=vids,
                    original_curve={k:edge[k] for k in ('curve_3d','curve_location','curve_range','edge_tolerance')}))
                previous=edges[(i-1)%len(edges)]['index'];current=edge['index']
                link=links[vids[0]]
                if current in link[previous]:raise ValueError('Repeated vertex-link sector')
                link[previous].add(current);link[current].add(previous)
            if len(set(corner_ids))!=len(corner_ids):raise ValueError('Repeated face vertex')
        for edge_id,uses in occurrences.items():
            if len(uses)!=2:raise ValueError('Edge does not have exactly two incident faces: '+str(edge_id))
            a,b=uses
            if a['face']==b['face'] or a['orientation']==b['orientation'] or a['vertices']!=list(reversed(b['vertices'])):
                raise ValueError('Incident edge orientations or endpoints disagree: '+str(edge_id))
            if a['original_curve']!=b['original_curve']:raise ValueError('Shared original 3D edge differs')
            face_graph[a['face']].add(b['face']);face_graph[b['face']].add(a['face'])
        if not _connected(face_graph):raise ValueError('Disconnected face complex')
        for vertex,link in links.items():
            if len(link)<3 or any(len(neighbors)!=2 for neighbors in link.values()) or not _connected(link):
                raise ValueError('Vertex link is not one cycle: '+str(vertex))
        euler=len(vertices)-len(occurrences)+len(faces)
        if euler!=2:raise ValueError('Selected sphere Euler characteristic differs')
        result.update(status='PROVED_COMBINATORIAL_ORIENTED_SPHERE',
            counts=dict(vertices=len(vertices),edges=len(occurrences),faces=len(faces),euler=euler),
            edge_incidence=[dict(edge=i,faces=[u['face'] for u in uses],orientations=[u['orientation'] for u in uses]) for i,uses in sorted(occurrences.items())],
            vertex_links=[dict(vertex=i,incident_edges=sorted(link),single_cycle=True) for i,link in sorted(links.items())])
    except (ValueError,KeyError,IndexError,TypeError) as exc:result.update(status='UNRESOLVED',reason=str(exc))
    return result


def verify_shell_incidence(record,observation,*,source_observation_sha256):
    if canonical(record)!=canonical(shell_incidence(observation,source_observation_sha256=source_observation_sha256)):
        raise ValueError('Incidence record or caller source differs')
    return True
