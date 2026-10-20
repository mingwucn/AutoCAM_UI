"""Read-only resource observations, excluded from deterministic episode records."""
import ctypes as C
import sys


def process_memory():
    if sys.platform != 'win32': return dict(working_set_bytes=None, process_peak_since_start_bytes=None)
    class Counters(C.Structure):
        _fields_ = [('cb', C.c_ulong), ('faults', C.c_ulong)]+[(name, C.c_size_t) for name in
                    ('peak', 'working', 'peak_paged', 'paged', 'peak_nonpaged', 'nonpaged', 'pagefile', 'peak_pagefile')]
    counters = Counters(); counters.cb = C.sizeof(counters)
    current = C.windll.kernel32.GetCurrentProcess; current.restype = C.c_void_p
    observe = C.windll.psapi.GetProcessMemoryInfo; observe.argtypes = [C.c_void_p, C.POINTER(Counters), C.c_ulong]
    if not observe(current(), C.byref(counters), counters.cb): raise OSError('Cannot observe process memory')
    return dict(working_set_bytes=counters.working, process_peak_since_start_bytes=counters.peak)
