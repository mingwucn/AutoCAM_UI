"""Runtime evidence that the Python analytic path cannot import CAD kernels."""
from contextlib import contextmanager
import sys


class CadImportGuard:
    roots = frozenset(("OCP", "OCC", "cadquery", "FreeCAD", "Part"))

    def __init__(self):
        self.attempts = []

    def find_spec(self, fullname, path=None, target=None):
        if fullname.split(".", 1)[0] in self.roots:
            self.attempts.append(fullname)
            raise RuntimeError("CAD kernel import forbidden in analytic inner loop: "+fullname)
        return None

    def to_data(self):
        return {"schema": "adaptive-no-cad-guard-1", "mechanism": "clean_modules_and_import_interception",
                "blocked_roots": sorted(self.roots), "attempts": list(self.attempts),
                "status": "passed" if not self.attempts else "failed",
                "scope": "Python analytic harness; no claim about uninstrumented native code"}


@contextmanager
def no_cad_kernel():
    guard = CadImportGuard()
    if any(name.split(".", 1)[0] in guard.roots for name in sys.modules):
        raise RuntimeError("No-CAD measurement requires a process without preloaded CAD modules")
    sys.meta_path.insert(0, guard)
    try:
        yield guard
    finally:
        sys.meta_path.remove(guard)
