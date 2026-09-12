#include "contours.hpp"
#include <BRepAdaptor_Surface.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <Geom_Surface.hxx>
#include <TopoDS_Edge.hxx>
#include <cmath>
namespace autocam::brep {
bool analytic_directional_contours(const TopoDS_Face& face,const gp_Dir& d,
                                    TopTools_ListOfShape& tools) {
  BRepAdaptor_Surface s(face,true);
  if(s.GetType()==GeomAbs_Plane)return true;
  if(s.GetType()!=GeomAbs_Cylinder && s.GetType()!=GeomAbs_Torus)return false;
  const auto frame=s.GetType()==GeomAbs_Cylinder?s.Cylinder().Position():s.Torus().Position();
  const double a=d.Dot(frame.XDirection()),b=d.Dot(frame.YDirection()),c=d.Dot(frame.Direction());
  if(s.GetType()==GeomAbs_Torus && std::abs(c)>1e-12 && std::hypot(a,b)>1e-12)return false;
  double u0,u1,v0,v1;BRepTools::UVBounds(face,u0,u1,v0,v1);
  const auto surface=BRep_Tool::Surface(face);
  const double pi=std::acos(-1.0),period=2*pi;
  auto iso=[&](bool constant_u,double root){
    const double low=constant_u?u0:v0,high=constant_u?u1:v1;
    for(int k=int(std::floor((low-root)/period));root+k*period<high;++k){
      const double parameter=root+k*period;
      if(parameter<=low+1e-12 || parameter>=high-1e-12)continue;
      const auto curve=constant_u?surface->UIso(parameter):surface->VIso(parameter);
      tools.Append(BRepBuilderAPI_MakeEdge(curve,constant_u?v0:u0,constant_u?v1:u1).Edge());
    }
  };
  if(std::hypot(a,b)>1e-12){
    const double phase=std::atan2(b,a);
    iso(true,phase+pi/2);iso(true,phase-pi/2);
  }
  if(s.GetType()==GeomAbs_Torus){
    if(std::abs(c)<=1e-12){iso(false,pi/2);iso(false,3*pi/2);}
    else {iso(false,0);iso(false,pi);}
  }
  return true;
}
}
