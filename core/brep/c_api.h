#pragma once
#include <stdint.h>
#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define SG_BREP_API EMSCRIPTEN_KEEPALIVE
#elif defined(_WIN32)
#define SG_BREP_API __declspec(dllexport)
#else
#define SG_BREP_API __attribute__((visibility("default")))
#endif
#ifdef __cplusplus
extern "C" {
#endif
typedef struct sg_brep_metrics {
  double removed_mm3, remaining_mm3, initial_excess_mm3;
  uint32_t token, revision;
} sg_brep_metrics;
SG_BREP_API const char* sg_brep_error(void);
SG_BREP_API uint32_t sg_brep_prepare(const char* bytes,uint32_t size,int axis_index,
    double ox,double oy,double oz,double dx,double dy,double dz,
    double allowance,double holding_length,int held_side);
// Additive explicit stock recipe: kind 1 = box origin XYZ / size XYZ;
// kind 2 = cylinder radius / station min / station max / zero / zero / zero.
SG_BREP_API uint32_t sg_brep_prepare_stock(const char* bytes,uint32_t size,int axis_index,
    double ox,double oy,double oz,double dx,double dy,double dz,
    double allowance,double holding_length,int held_side,int kind,
    double a,double b,double c,double d,double e,double f);
SG_BREP_API uint32_t sg_brep_restore(const char* bytes,uint32_t size);
SG_BREP_API int sg_brep_close(uint32_t handle);
SG_BREP_API int sg_brep_observe(uint32_t handle,sg_brep_metrics* out);
SG_BREP_API int sg_brep_preview(uint32_t handle,int process,int operation,
    double dx,double dy,double dz,double reach,sg_brep_metrics* out);
SG_BREP_API int sg_brep_apply(uint32_t handle,uint32_t token,uint32_t revision);
SG_BREP_API int sg_brep_cancel(uint32_t handle);
SG_BREP_API int sg_brep_reset(uint32_t handle);
// Geometry layers: remaining=0, target=1, holding=2, stock=3, preview removal=4.
// Getter pointers stay valid until the corresponding mesh/section/snapshot call
// or session close. Consumers must copy buffers before their next request.
SG_BREP_API int sg_brep_info(uint32_t handle,double* out16);
SG_BREP_API int sg_brep_mesh(uint32_t handle,int layer,uint32_t token,double deflection);
SG_BREP_API uint32_t sg_brep_mesh_size(uint32_t handle);
SG_BREP_API const float* sg_brep_positions(uint32_t handle);
SG_BREP_API const float* sg_brep_normals(uint32_t handle);
SG_BREP_API int sg_brep_section(uint32_t handle,int layer,uint32_t token,int axis,
    double station,double deflection);
SG_BREP_API uint32_t sg_brep_section_size(uint32_t handle);
SG_BREP_API const double* sg_brep_section_points(uint32_t handle);
SG_BREP_API uint32_t sg_brep_section_offset_count(uint32_t handle);
SG_BREP_API const uint32_t* sg_brep_section_offsets(uint32_t handle);
SG_BREP_API const char* sg_brep_snapshot(uint32_t handle);
SG_BREP_API uint32_t sg_brep_snapshot_size(uint32_t handle);
#ifdef __cplusplus
}
#endif
