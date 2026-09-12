#include "setup.hpp"
#include "checked_boolean.hpp"
#include <BRepBndLib.hxx>
#include <Bnd_Box.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <BRep_Builder.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS.hxx>
#include <TopExp_Explorer.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Cone.hxx>
#include <gp_Torus.hxx>
#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <vector>

namespace autocam::brep {
gp_Ax1 principal_axis(const TopoDS_Shape& target,int index) {
  if (index<0 || index>2) throw std::invalid_argument("Principal axis must be X, Y or Z");
  volume(target);
  Bnd_Box bounds;BRepBndLib::AddOptimal(target,bounds,false,false);
  auto low=bounds.CornerMin(),high=bounds.CornerMax();
  const gp_Pnt center((low.X()+high.X())/2,(low.Y()+high.Y())/2,(low.Z()+high.Z())/2);
  const gp_Dir direction(index==0?1:0,index==1?1:0,index==2?1:0);
  // A computed bounding box can differ from a CAD axis within bounding precision.
  // Prefer that existing axis only inside the core's numerical precision;
  // larger offsets describe distinct geometry and must not be snapped away.
  constexpr double linear_precision=1e-7,angular_precision=1e-12;
  struct Candidate {gp_Pnt origin;double area;};
  std::vector<Candidate> candidates;
  for(TopExp_Explorer faces(target,TopAbs_FACE);faces.More();faces.Next()) {
    const auto face=TopoDS::Face(faces.Current());BRepAdaptor_Surface surface(face,true);
    gp_Ax1 source_axis;
    switch(surface.GetType()) {
      case GeomAbs_Cylinder:source_axis=surface.Cylinder().Axis();break;
      case GeomAbs_Cone:source_axis=surface.Cone().Axis();break;
      case GeomAbs_Torus:source_axis=surface.Torus().Axis();break;
      default:continue;
    }
    if(!source_axis.Direction().IsParallel(direction,angular_precision))continue;
    auto origin=source_axis.Location();
    origin.Translate(gp_Vec(source_axis.Direction())*(-origin.Coord(index+1)/source_axis.Direction().Coord(index+1)));
    origin.SetCoord(index+1,0.);
    if(gp_Vec(center,origin).Crossed(gp_Vec(direction)).Magnitude()>linear_precision)continue;
    GProp_GProps properties;BRepGProp::SurfaceProperties(face,properties);
    if(std::isfinite(properties.Mass())&&properties.Mass()>0)candidates.push_back({origin,properties.Mass()});
  }
  // Require one mutually coaxial group; transitive clustering can otherwise
  // merge two distinct axes through an intermediate candidate.
  for(std::size_t i=0;i<candidates.size();++i)for(std::size_t j=i+1;j<candidates.size();++j)
    if(candidates[i].origin.Distance(candidates[j].origin)>linear_precision)return gp_Ax1(center,direction);
  if(candidates.empty())return gp_Ax1(center,direction);
  const auto coordinates=[](const gp_Pnt& p){return std::array<double,3>{p.X(),p.Y(),p.Z()};};
  const auto chosen=std::min_element(candidates.begin(),candidates.end(),[&](const Candidate& a,const Candidate& b){
    return a.area>b.area||(a.area==b.area&&coordinates(a.origin)<coordinates(b.origin));
  });
  return gp_Ax1(chosen->origin,direction);
}
PreparedStock prepare_stock(const TopoDS_Shape& target,const gp_Ax1& axis,
                             double allowance,double holding_length,int held_side,
                             const StockRecipe* recipe) {
  if (!std::isfinite(allowance) || allowance<0 || !std::isfinite(holding_length) ||
      holding_length<0 || (held_side!=-1 && held_side!=1))
    throw std::invalid_argument("Invalid stock allowance or holding setup");
  // Even a non-destructive Boolean can update operand bookkeeping. Explicit
  // recipe validation owns its geometry so the caller's source stays untouched.
  const auto operand=recipe?BRepBuilderAPI_Copy(target,true,false).Shape():target;
  volume(operand);
  const auto axis_origin=axis.Location();
  if(!std::isfinite(axis_origin.X())||!std::isfinite(axis_origin.Y())||!std::isfinite(axis_origin.Z()))
    throw std::invalid_argument("Spindle origin must be finite");
  TopoDS_Shape stock;
  if(recipe) {
    if(recipe->kind==StockRecipe::Kind::box) {
      for(int i=0;i<3;++i)
        if(!std::isfinite(recipe->origin_mm[i])||!std::isfinite(recipe->size_mm[i])||recipe->size_mm[i]<=0||
           !std::isfinite(recipe->origin_mm[i]+recipe->size_mm[i]))
          throw std::invalid_argument("Box stock requires finite origin and positive finite sizes");
      stock=BRepPrimAPI_MakeBox(gp_Pnt(recipe->origin_mm[0],recipe->origin_mm[1],recipe->origin_mm[2]),
                              recipe->size_mm[0],recipe->size_mm[1],recipe->size_mm[2]).Shape();
    } else if(recipe->kind==StockRecipe::Kind::cylinder) {
      if(!std::isfinite(recipe->radius_mm)||recipe->radius_mm<=0||
         !std::isfinite(recipe->station_min_mm)||!std::isfinite(recipe->station_max_mm)||
         !std::isfinite(recipe->station_max_mm-recipe->station_min_mm)||
         recipe->station_max_mm<=recipe->station_min_mm)
        throw std::invalid_argument("Cylinder stock requires a positive radius and increasing finite stations");
    } else throw std::invalid_argument("Unknown stock recipe kind");
  }
  Bnd_Box bounds;BRepBndLib::AddOptimal(stock.IsNull()?operand:stock,bounds,false,false);
  auto low=bounds.CornerMin(),high=bounds.CornerMax();
  const gp_Vec d(axis.Direction());
  double minimum=std::numeric_limits<double>::infinity(),maximum=-minimum,radius=0;
  for (double x : {low.X(),high.X()}) for (double y : {low.Y(),high.Y()})
    for (double z : {low.Z(),high.Z()}) {
      const gp_Vec offset(axis.Location(),gp_Pnt(x,y,z));
      const double station=offset.Dot(d);
      minimum=std::min(minimum,station);maximum=std::max(maximum,station);
      radius=std::max(radius,(offset-d*station).Magnitude());
    }
  if(!recipe){minimum-=allowance;maximum+=allowance;radius+=allowance;}
  else if(recipe->kind==StockRecipe::Kind::cylinder) {
    minimum=recipe->station_min_mm;maximum=recipe->station_max_mm;radius=recipe->radius_mm;
  }
  const double height=maximum-minimum;
  if (!std::isfinite(height) || !std::isfinite(radius) || height<=0 || radius<=0 || holding_length>height)
    throw std::invalid_argument("Holding length exceeds stock length or stock bounds are invalid");
  const auto base=axis.Location().Translated(d*minimum);
  const auto top=axis.Location().Translated(d*maximum);
  for(const auto& point:{base,top})
    if(!std::isfinite(point.X())||!std::isfinite(point.Y())||!std::isfinite(point.Z()))
      throw std::invalid_argument("Stock endpoints must be finite");
  if(stock.IsNull())stock=BRepPrimAPI_MakeCylinder(gp_Ax2(base,axis.Direction()),radius,height).Shape();
  TopoDS_Shape holding;
  if (holding_length==0) {
    BRep_Builder builder;TopoDS_Compound empty;builder.MakeCompound(empty);holding=empty;
  } else if(recipe&&holding_length==height) {
    holding=stock;
  } else {
    const double station=held_side<0?minimum:maximum-holding_length;
    const auto held_base=axis.Location().Translated(d*station);
    if(recipe&&recipe->kind==StockRecipe::Kind::box) {
      // A finite slab contains the stock's entire transverse extent. Its side
      // margin is construction extent, not a geometric acceptance tolerance.
      const double half_width=radius+1.;
      if(!std::isfinite(2*half_width))throw std::invalid_argument("Holding slab extent is not finite");
      gp_Ax2 frame(held_base,axis.Direction());
      frame.SetLocation(held_base.Translated(gp_Vec(frame.XDirection())*(-half_width)+
                                            gp_Vec(frame.YDirection())*(-half_width)));
      const auto slab=BRepPrimAPI_MakeBox(frame,2*half_width,2*half_width,holding_length).Shape();
      holding=checked_boolean<BRepAlgoAPI_Common>(stock,slab);
    } else holding=BRepPrimAPI_MakeCylinder(gp_Ax2(held_base,axis.Direction()),radius,holding_length).Shape();
  }
  const double tolerance=std::max(1e-6,volume(stock)*1e-9);
  if(recipe) {
    if(!valid_boolean_material(stock)||volume(stock)<=0||
       volume(checked_boolean<BRepAlgoAPI_Cut>(operand,stock))>tolerance)
      throw std::invalid_argument("Explicit stock does not contain the target");
    if(volume(holding)>0&&volume(checked_boolean<BRepAlgoAPI_Cut>(holding,stock))>tolerance)
      throw std::invalid_argument("Holding extends outside explicit stock");
  }
  return {stock,holding,{axis,radius,held_side,tolerance}};
}
}
