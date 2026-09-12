#include "c_api.h"
#include "session.hpp"
#include "setup.hpp"
#include "io.hpp"
#include "presentation.hpp"
#include <BRepBndLib.hxx>
#include <Bnd_Box.hxx>
#include <Standard_Failure.hxx>
#include <limits>
#include <map>
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <vector>

using namespace autocam::brep;
namespace {
struct Resource {
  std::unique_ptr<Session> session;
  Mesh mesh;
  std::vector<double> points;
  std::vector<uint32_t> offsets;
  std::string snapshot;
};
thread_local std::string error;
std::map<uint32_t,Resource> sessions;
uint32_t serial=0;
Resource& resource(uint32_t handle) {
  auto it=sessions.find(handle);
  if (it==sessions.end()) throw std::invalid_argument("Unknown B-Rep session");
  return it->second;
}
template<class F,class T> T guarded(F operation,T failure) {
  error.clear();
  try { return operation(); }
  catch (const Standard_Failure& e) { error=e.GetMessageString()?e.GetMessageString():"OpenCascade operation failed"; }
  catch (const std::exception& e) { error=e.what(); }
  catch (...) { error="Unknown B-Rep operation failure"; }
  return failure;
}
uint32_t add(std::unique_ptr<Session> session) {
  if (serial==std::numeric_limits<uint32_t>::max()) throw std::runtime_error("Session identifier limit reached");
  const auto id=++serial;sessions[id].session=std::move(session);return id;
}
std::string input(const char* bytes,uint32_t size) {
  if (!bytes || !size || size>256*1024*1024) throw std::invalid_argument("Input byte length is invalid");
  return std::string(bytes,size);
}
const TopoDS_Shape& layer(Resource& r,int kind,uint32_t token) {
  switch (kind) {
    case 0:return r.session->remaining();case 1:return r.session->target();
    case 2:return r.session->holding();case 3:return r.session->stock();
    case 4:return r.session->preview_removed(token);
    default:throw std::invalid_argument("Unknown geometry layer");
  }
}
uint32_t prepare(const char* bytes,uint32_t size,int axis_index,
    double ox,double oy,double oz,double dx,double dy,double dz,
    double allowance,double holding_length,int held_side,const StockRecipe* recipe) {
  if(axis_index==-1&&(!std::isfinite(ox)||!std::isfinite(oy)||!std::isfinite(oz)||
                    !std::isfinite(dx)||!std::isfinite(dy)||!std::isfinite(dz)))
    throw std::invalid_argument("Spindle coordinates must be finite");
  const auto target=read_step(input(bytes,size));
  const auto axis=axis_index==-1?gp_Ax1(gp_Pnt(ox,oy,oz),gp_Dir(dx,dy,dz)):principal_axis(target,axis_index);
  const auto prepared=prepare_stock(target,axis,allowance,holding_length,held_side,recipe);
  return add(std::make_unique<Session>(target,prepared.stock,prepared.holding,prepared.setup));
}
}
extern "C" {
const char* sg_brep_error() { return error.c_str(); }
uint32_t sg_brep_prepare(const char* bytes,uint32_t size,int axis_index,
    double ox,double oy,double oz,double dx,double dy,double dz,
    double allowance,double holding_length,int held_side) {
  return guarded([&] {
    return prepare(bytes,size,axis_index,ox,oy,oz,dx,dy,dz,allowance,holding_length,held_side,nullptr);
  },uint32_t(0));
}
uint32_t sg_brep_prepare_stock(const char* bytes,uint32_t size,int axis_index,
    double ox,double oy,double oz,double dx,double dy,double dz,
    double allowance,double holding_length,int held_side,int kind,
    double a,double b,double c,double d,double e,double f) {
  return guarded([&] {
    StockRecipe recipe;
    if(kind==1) {recipe.kind=StockRecipe::Kind::box;recipe.origin_mm={a,b,c};recipe.size_mm={d,e,f};}
    else if(kind==2&&d==0&&e==0&&f==0) {
      recipe.kind=StockRecipe::Kind::cylinder;recipe.radius_mm=a;recipe.station_min_mm=b;recipe.station_max_mm=c;
    } else throw std::invalid_argument("Unknown stock recipe kind or nonzero reserved fields");
    return prepare(bytes,size,axis_index,ox,oy,oz,dx,dy,dz,allowance,holding_length,held_side,&recipe);
  },uint32_t(0));
}
uint32_t sg_brep_restore(const char* bytes,uint32_t size) {
  return guarded([&]{return add(Session::restore(decode_snapshot(input(bytes,size))));},uint32_t(0));
}
int sg_brep_close(uint32_t id) { return guarded([&]{resource(id);sessions.erase(id);return 0;},1); }
int sg_brep_observe(uint32_t id,sg_brep_metrics* out) {
  return guarded([&]{if (!out) throw std::invalid_argument("Missing metrics output");auto& s=*resource(id).session;
    *out={0,volume(s.remaining()),s.initial_excess_mm3(),0,uint32_t(s.revision())};return 0;},1);
}
int sg_brep_preview(uint32_t id,int process,int operation,double dx,double dy,double dz,double reach,sg_brep_metrics* out) {
  return guarded([&]{if (!out) throw std::invalid_argument("Missing metrics output");
    if (process<0 || process>1 || operation<0 || operation>2) throw std::invalid_argument("Unknown process or operation");
    auto& s=*resource(id).session;Action a;a.process=Process(process);a.turning_operation=TurningOperation(operation);
    if (process==0) a.direction=gp_Dir(dx,dy,dz);a.reach_mm=reach;
    const auto p=s.preview(a);*out={p.removed_mm3,p.remaining_mm3,s.initial_excess_mm3(),uint32_t(p.token),uint32_t(p.revision)};
    return 0;},1);
}
int sg_brep_apply(uint32_t id,uint32_t token,uint32_t revision) {
  return guarded([&]{resource(id).session->apply(token,revision);return 0;},1);
}
int sg_brep_cancel(uint32_t id) {return guarded([&]{resource(id).session->cancel_preview();return 0;},1);}
int sg_brep_reset(uint32_t id) {return guarded([&]{resource(id).session->reset();return 0;},1);}
int sg_brep_info(uint32_t id,double* out) {
  return guarded([&]{if (!out) throw std::invalid_argument("Missing info output");auto& s=*resource(id).session;
    Bnd_Box bounds;BRepBndLib::AddOptimal(s.stock(),bounds,false,false);auto low=bounds.CornerMin(),high=bounds.CornerMax();
    auto setup=s.setup();auto p=setup.axis.Location();auto d=setup.axis.Direction();
    const double values[]={low.X(),low.Y(),low.Z(),high.X(),high.Y(),high.Z(),p.X(),p.Y(),p.Z(),d.X(),d.Y(),d.Z(),
      setup.stock_radius_mm,volume(s.target()),volume(s.holding()),volume(s.stock())};
    std::copy(values,values+16,out);return 0;},1);
}
int sg_brep_mesh(uint32_t id,int kind,uint32_t token,double deflection) {
  return guarded([&]{auto& r=resource(id);r.mesh=tessellate(layer(r,kind,token),deflection);return 0;},1);
}
uint32_t sg_brep_mesh_size(uint32_t id) {return guarded([&]{return uint32_t(resource(id).mesh.positions.size());},uint32_t(0));}
const float* sg_brep_positions(uint32_t id) {return guarded([&]{return static_cast<const float*>(resource(id).mesh.positions.data());},static_cast<const float*>(nullptr));}
const float* sg_brep_normals(uint32_t id) {return guarded([&]{return static_cast<const float*>(resource(id).mesh.normals.data());},static_cast<const float*>(nullptr));}
int sg_brep_section(uint32_t id,int kind,uint32_t token,int axis,double station,double deflection) {
  return guarded([&]{if (axis<0 || axis>2 || !std::isfinite(station)) throw std::invalid_argument("Invalid section axis or station");
    double xyz[]={0,0,0};xyz[axis]=station;auto& r=resource(id);
    auto paths=section(layer(r,kind,token),gp_Pln(gp_Pnt(xyz[0],xyz[1],xyz[2]),gp_Dir(axis==0,axis==1,axis==2)),deflection);
    std::vector<double> points;std::vector<uint32_t> offsets{0};
    for (const auto& path:paths) {points.insert(points.end(),path.begin(),path.end());offsets.push_back(uint32_t(points.size()));}
    r.points=std::move(points);r.offsets=std::move(offsets);return 0;},1);
}
uint32_t sg_brep_section_size(uint32_t id) {return guarded([&]{return uint32_t(resource(id).points.size());},uint32_t(0));}
const double* sg_brep_section_points(uint32_t id) {return guarded([&]{return static_cast<const double*>(resource(id).points.data());},static_cast<const double*>(nullptr));}
uint32_t sg_brep_section_offset_count(uint32_t id) {return guarded([&]{return uint32_t(resource(id).offsets.size());},uint32_t(0));}
const uint32_t* sg_brep_section_offsets(uint32_t id) {return guarded([&]{return static_cast<const uint32_t*>(resource(id).offsets.data());},static_cast<const uint32_t*>(nullptr));}
const char* sg_brep_snapshot(uint32_t id) {
  return guarded([&]{auto& r=resource(id);r.snapshot=encode_snapshot(r.session->snapshot());return r.snapshot.c_str();},static_cast<const char*>(nullptr));
}
uint32_t sg_brep_snapshot_size(uint32_t id) {return guarded([&]{return uint32_t(resource(id).snapshot.size());},uint32_t(0));}
}
