"""Exact immutable values for the CODE-SGYM-009 reference contract."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from fractions import Fraction
from hashlib import sha256
import json


def integer(value, name="integer", minimum=None, maximum=None):
    if type(value) is not int or (minimum is not None and value < minimum) or (maximum is not None and value > maximum):
        raise ValueError(f"Invalid {name}")
    return value


def rational(value):
    if isinstance(value, Fraction):
        return value
    if type(value) not in (int, str):
        raise ValueError("Use exact integer, decimal/rational text, or Fraction")
    try:
        return Fraction(value)
    except (ValueError, ZeroDivisionError, OverflowError) as error:
        raise ValueError("Invalid finite rational") from error


def triple(values):
    result = tuple(rational(v) for v in values)
    if len(result) != 3:
        raise ValueError("Expected three exact coordinates")
    return result


def qdata(value):
    return [value.numerator, value.denominator]


def qread(value):
    if not isinstance(value, list) or len(value) != 2:
        raise ValueError("Invalid rational encoding")
    n, d = value
    integer(n); integer(d, "positive denominator", 1)
    result = Fraction(n, d)
    if qdata(result) != value:
        raise ValueError("Noncanonical rational")
    return result


def fields(value, expected):
    if not isinstance(value, dict) or set(value) != set(expected):
        raise ValueError("Unknown or missing fields")


def canonical(value):
    def check(x):
        if x is None or type(x) in (str, bool, int):
            return
        if isinstance(x, (list, tuple)):
            for y in x:
                check(y)
        elif isinstance(x, dict) and all(type(k) is str for k in x):
            for y in x.values():
                check(y)
        else:
            raise ValueError("Noncanonical logical value; floats are not permitted")
    check(value)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def identity(value):
    return sha256(canonical(value)).hexdigest()


def digest(value):
    if type(value) is not str or len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
        raise ValueError("Expected a SHA-256 identity")
    return value


class Relation(str, Enum):
    INSIDE = "inside"
    OUTSIDE = "outside"
    MIXED = "mixed_or_unresolved"


class EvidenceGrade(str, Enum):
    BOUNDED = "bounded"
    EVALUATED = "evaluated"
    UNRESOLVED = "unresolved"
    INVALID = "invalid"


@dataclass(frozen=True, slots=True)
class Bounds:
    low: tuple
    high: tuple

    def __post_init__(self):
        object.__setattr__(self, "low", triple(self.low))
        object.__setattr__(self, "high", triple(self.high))
        if any(a >= b for a, b in zip(self.low, self.high)):
            raise ValueError("Bounds must have positive extent")

    @property
    def volume(self):
        a, b, c = (y-x for x, y in zip(self.low, self.high))
        return a*b*c

    def to_data(self):
        return {"low": [qdata(v) for v in self.low], "high": [qdata(v) for v in self.high]}

    @classmethod
    def from_data(cls, data):
        fields(data, ("low", "high"))
        return cls(tuple(qread(v) for v in data["low"]), tuple(qread(v) for v in data["high"]))

    def children(self):
        mid = tuple((a+b)/2 for a, b in zip(self.low, self.high))
        return tuple(Bounds(tuple(mid[k] if n & (1 << k) else self.low[k] for k in range(3)),
                            tuple(self.high[k] if n & (1 << k) else mid[k] for k in range(3)))
                     for n in range(8))


@dataclass(frozen=True, slots=True)
class CellAddress:
    domain_geometry_id: str
    root_frame_id: str
    depth: int
    morton_prefix: int

    def __post_init__(self):
        digest(self.domain_geometry_id); digest(self.root_frame_id)
        integer(self.depth, "depth", 0, 20)
        integer(self.morton_prefix, "Morton prefix", 0, (1 << (3*self.depth))-1)

    def child(self, number):
        integer(number, "child number", 0, 7)
        return CellAddress(self.domain_geometry_id, self.root_frame_id, self.depth+1,
                           self.morton_prefix*8+number)

    def to_data(self):
        return {"domain_geometry_id": self.domain_geometry_id, "root_frame_id": self.root_frame_id,
                "depth": self.depth, "morton_prefix": self.morton_prefix}


def require_cell_address(address):
    """Validate classification input before decoding or fixed-width conversion."""
    if type(address) is not CellAddress:
        raise ValueError("Typed CellAddress required")
    integer(address.depth, "depth", 0, 20)
    integer(address.morton_prefix, "Morton prefix", 0, (1 << (3*address.depth))-1)


@dataclass(frozen=True, slots=True)
class Root:
    origin: tuple
    side: Fraction
    frame: str = "stock_local"
    _identity: str = field(init=False, repr=False, compare=False)

    def __post_init__(self):
        object.__setattr__(self, "origin", triple(self.origin))
        object.__setattr__(self, "side", rational(self.side))
        if self.side <= 0 or type(self.frame) is not str or not self.frame:
            raise ValueError("Invalid root")
        object.__setattr__(self, "_identity", identity(self.to_data()))

    def to_data(self):
        return {"schema": "adaptive-root-1", "units": "mm", "origin": [qdata(v) for v in self.origin],
                "side": qdata(self.side), "frame": self.frame}

    @property
    def id(self):
        return self._identity

    @property
    def bounds(self):
        return Bounds(self.origin, tuple(v+self.side for v in self.origin))

    def cell(self, address):
        if address.root_frame_id != self.id:
            raise ValueError("Cell belongs to another root")
        indices = [0, 0, 0]
        for level in range(address.depth-1, -1, -1):
            digit = (address.morton_prefix >> (level*3)) & 7
            indices = [indices[k]*2+((digit >> k) & 1) for k in range(3)]
        size = self.side / (1 << address.depth)
        lo = tuple(self.origin[k]+indices[k]*size for k in range(3))
        return Bounds(lo, tuple(v+size for v in lo))
