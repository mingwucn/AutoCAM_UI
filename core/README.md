# Shared Shadow Core

This C++17 library is the single target implementation for voxel shadow
classification and material transitions. Its C ABI supports a native Python
adapter and an Emscripten Web Worker build. Inputs are unpacked byte masks in
NumPy/C order (`z` fastest). Output labels match the existing gym: target 1,
holding 2, remove 3, shadow 4 and beyond reach 5.

Build natively with `cmake -S core -B core/build -G Ninja` followed by
`cmake --build core/build`. Configure WebAssembly with `emcmake cmake -S core
-B core/build-wasm -G Ninja`. Both targets compile the same source.

The browser Worker uses OpenCascade.js for STEP import and solid membership,
then passes the resulting occupancy masks to this core. The parent Python path
uses native OpenCascade/OCP for the equivalent CAD boundary and this native
library for shadow classification. The CAD bindings remain platform-specific;
the shadow, reach and material-transition implementation is shared source.
