"""Bind high-level machining choices to every row of a verified layered bank."""
from .cad_cylindrical_layers import verify_cylindrical_layers
from .domain import canonical,identity


def cylindrical_route_choices(bank,source,**generation_arguments):
    verify_cylindrical_layers(bank,source,**generation_arguments)
    bank_id=identity(bank);groups={};references=0
    for layer_index,layer in enumerate(bank['layers']):
        face=layer['requirement']['source_face_id']
        for row_index,row in enumerate(layer['rows']):
            key=(face,row['orientation_id'],row['tool_id'],row['method_id'])
            if key not in groups:
                groups[key]=dict(bank_id=bank_id,source_face_id=face,
                    orientation_id=row['orientation_id'],tool_id=row['tool_id'],method_id=row['method_id'],
                    row_references=[],constructed_strokes=0,unavailable_rows=0)
            group=groups[key];group['row_references'].append([layer_index,row_index])
            group['constructed_strokes' if row['motion'] is not None else 'unavailable_rows']+=1
            references+=1
            if len(groups)>64 or references>4096:raise ValueError('Complete machining choice budget exceeded')
    choices=[dict(choice_id=identity(group),**group) for group in groups.values()]
    return dict(schema='adaptive-cad-cylindrical-route-choices-1',bank_id=bank_id,
        source_geometry_id=source.geometry_id,requirement_id=bank['requirement_id'],
        choices=choices,total_references=references,access_assessed=False,
        accepted_machining=False,common_completion_proven=False)


def verify_cylindrical_route_choices(record,bank,source,**generation_arguments):
    if canonical(record)!=canonical(cylindrical_route_choices(bank,source,**generation_arguments)):
        raise ValueError('Machining choices differ from complete bank regeneration')
    return True
