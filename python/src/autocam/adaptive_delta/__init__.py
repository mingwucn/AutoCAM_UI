"""Task-local adaptive material bounds; no manufacturing qualification."""

from .domain import Bounds, CellAddress, EvidenceGrade, Relation, Root, rational
from .geometry import Box, Cutout, Cylinder, Empty, Union

__all__ = ["Bounds", "CellAddress", "EvidenceGrade", "Relation", "Root", "rational",
           "Box", "Cutout", "Cylinder", "Empty", "Union"]
