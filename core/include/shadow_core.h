#ifndef AUTOCAM_SHADOW_CORE_H
#define AUTOCAM_SHADOW_CORE_H
#include <stddef.h>
#include <stdint.h>
#if defined(_WIN32) && defined(SHADOW_CORE_BUILD)
#define SG_API __declspec(dllexport)
#elif defined(_WIN32)
#define SG_API __declspec(dllimport)
#else
#define SG_API __attribute__((visibility("default")))
#endif
#ifdef __cplusplus
extern "C" {
#endif
enum sg_status { SG_OK=0, SG_INVALID_ARGUMENT=1, SG_LIMIT_EXCEEDED=2, SG_INTERNAL_ERROR=3 };
enum sg_turn_action { SG_TURN_OUTSIDE=0, SG_TURN_FACE_POSITIVE=1, SG_TURN_FACE_NEGATIVE=2 };
enum sg_label { SG_AIR=0, SG_TARGET=1, SG_HOLDING=2, SG_REMOVE=3, SG_SHADOW=4, SG_BEYOND_REACH=5 };
typedef struct sg_grid { uint32_t nx,ny,nz; double pitch_mm; double origin_mm[3]; double stock_bounds_mm[6]; } sg_grid;
typedef struct sg_axis { double origin_mm[3]; double direction[3]; double original_stock_radius_mm; int held_side; } sg_axis;
typedef struct sg_counts { uint64_t remove_voxels,shadow_voxels,beyond_reach_voxels,target_voxels,holding_voxels; } sg_counts;
SG_API uint32_t sg_api_version(void);
SG_API const char* sg_status_message(int status);
SG_API int sg_milling_classify(const sg_grid*,const uint8_t*,const uint8_t*,const uint8_t*,const uint8_t*,const double[3],double,uint8_t*,sg_counts*);
SG_API int sg_turning_classify(const sg_grid*,const sg_axis*,const uint8_t*,const uint8_t*,const uint8_t*,const uint8_t*,int,double,uint8_t*,sg_counts*);
SG_API int sg_apply(uint8_t*,const uint8_t*,size_t);
#ifdef __cplusplus
}
#endif
#endif
