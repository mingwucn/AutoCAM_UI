#include "analytic_pcurves.hpp"
#include "io.hpp"
#include "material.hpp"
#include <BOPAlgo_ArgumentAnalyzer.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <Geom2d_Curve.hxx>
#include <Geom_Surface.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <string>
#include <iomanip>
#include <sstream>

namespace {
using namespace autocam::brep;
void require(bool condition,const std::string& message) {
  if(!condition)throw std::runtime_error(message);
}
void require_bound(double actual,double bound,const std::string& message) {
  if(actual<=bound)return;
  std::ostringstream diagnostic;diagnostic<<std::setprecision(17)<<message<<": actual="<<actual<<", bound="<<bound;
  throw std::runtime_error(diagnostic.str());
}
void diagnose_vertices(const TopoDS_Shape& shape,const std::string& label) {
  TopTools_IndexedMapOfShape vertices,edges,faces;
  TopExp::MapShapes(shape,TopAbs_VERTEX,vertices);TopExp::MapShapes(shape,TopAbs_EDGE,edges);TopExp::MapShapes(shape,TopAbs_FACE,faces);
  for(int vi=1;vi<=vertices.Extent();++vi) {
    const auto vertex=TopoDS::Vertex(vertices(vi));
    if(BRep_Tool::Tolerance(vertex)<=1e-7*(1+2e-6))continue;
    double required=1e-7;
    std::cout<<std::setprecision(17)<<label<<" vertex "<<vi<<" stored="<<BRep_Tool::Tolerance(vertex)<<std::endl;
    for(int ei=1;ei<=edges.Extent();++ei) {
      const auto edge=TopoDS::Edge(edges(ei));if(BRep_Tool::Degenerated(edge))continue;
      for(TopExp_Explorer it(edge,TopAbs_VERTEX);it.More();it.Next()) {
        if(!it.Current().IsSame(vertex))continue;
        const auto endpoint=TopoDS::Vertex(it.Current());const BRepAdaptor_Curve curve(edge);
        const double residual=curve.Value(BRep_Tool::Parameter(endpoint,edge)).Distance(BRep_Tool::Pnt(endpoint));
        required=std::max({required,residual*(1+1e-6),BRep_Tool::Tolerance(edge)});
        std::cout<<"  edge "<<ei<<" tol="<<BRep_Tool::Tolerance(edge)<<" endpoint="<<residual<<std::endl;
      }
    }
    for(int fi=1;fi<=faces.Extent();++fi) {
      const auto face=TopoDS::Face(faces(fi));const auto surface=BRep_Tool::Surface(face);
      for(TopExp_Explorer it(face,TopAbs_EDGE);it.More();it.Next())for(const auto orientation:{TopAbs_FORWARD,TopAbs_REVERSED}) {
        const auto edge=TopoDS::Edge(it.Current().Oriented(orientation));double first,last;
        const auto pc=BRep_Tool::CurveOnSurface(edge,face,first,last);if(pc.IsNull())continue;
        for(TopExp_Explorer vt(edge,TopAbs_VERTEX);vt.More();vt.Next()) {
          if(!vt.Current().IsSame(vertex))continue;
          const auto endpoint=TopoDS::Vertex(vt.Current());const auto uv=pc->Value(BRep_Tool::Parameter(endpoint,edge,face));
          const double residual=surface->Value(uv.X(),uv.Y()).Distance(BRep_Tool::Pnt(endpoint));
          const double budget=std::max(BRep_Tool::Tolerance(edge),BRep_Tool::Tolerance(face));
          required=std::max({required,residual*(1+1e-6),budget});
          std::cout<<"  face "<<fi<<" edge "<<edges.FindIndex(edge)<<" branch="<<orientation<<" E/F="<<budget<<" endpoint="<<residual<<std::endl;
        }
      }
    }
    std::cout<<"  independent_incidence_bound="<<required<<std::endl;
  }
}
void require_quality(const CurveSurfaceQuality& quality,const std::string& label) {
  require(quality.tested_incidences>0,label+": no curve/surface incidences checked");
  require(quality.unresolved_incidences==0,label+": unresolved edge parameterization");
  require(quality.residual_exceeds_stored_budget==0,label+": pcurve exceeds edge tolerance");
  require(quality.maximum_curve_surface_residual_mm<=1e-7,label+": pcurve exceeds fixture precision");
  // These analytic fixtures start with separate V/E/F budgets of 1e-7 mm.
  // The small relative margin covers roundoff in prism-generated endpoints;
  // no larger face or unrelated source edge can supply a different budget.
  constexpr double bound=1e-7*(1+2e-6);
  require_bound(quality.maximum_vertex_tolerance_mm,bound,label+": vertex tolerance grew");
  require_bound(quality.maximum_edge_tolerance_mm,bound,label+": edge tolerance grew");
  require_bound(quality.maximum_face_tolerance_mm,bound,label+": face tolerance grew");
}
void seam_and_identity_checks() {
  const auto cylinder=BRepPrimAPI_MakeCylinder(5,10).Shape();
  const auto source_bytes=write_brep(cylinder),source_geometry=geometry3d_identity(cylinder);
  for(int branch=0;branch<2;++branch) {
    BRepBuilderAPI_Copy copy(cylinder,true,false);const auto altered=copy.Shape();
    require(geometry3d_identity(altered)==source_geometry,"Deep copy changed 3D identity");
    bool changed=false;BRep_Builder builder;
    for(TopExp_Explorer faces(altered,TopAbs_FACE);faces.More()&&!changed;faces.Next()) {
      const auto face=TopoDS::Face(faces.Current());
      for(TopExp_Explorer edges(face,TopAbs_EDGE);edges.More();edges.Next()) {
        auto edge=TopoDS::Edge(edges.Current());if(!BRep_Tool::IsClosed(edge,face))continue;
        edge.Orientation(TopAbs_FORWARD);auto reversed=edge;reversed.Reverse();
        double first,last;
        const auto first_pc=Handle(Geom2d_Curve)::DownCast(BRep_Tool::CurveOnSurface(edge,face,first,last)->Copy());
        const auto second_pc=Handle(Geom2d_Curve)::DownCast(BRep_Tool::CurveOnSurface(reversed,face,first,last)->Copy());
        (branch==0?first_pc:second_pc)->Translate(gp_Vec2d(0,1e-4));
        builder.UpdateEdge(edge,first_pc,second_pc,face,0);
        const auto quality=inspect_curve_surface_quality(altered);
        require(quality.maximum_curve_surface_residual_mm>9e-5,"One seam pcurve branch escaped numerical inspection");
        require(quality.residual_exceeds_stored_budget>0,"Seam residual was hidden by stored tolerance");
        require(geometry3d_identity(altered)==source_geometry,"Pcurve-only edit changed 3D identity");
        builder.SameRange(edge,false);
        require(inspect_curve_surface_quality(altered).unresolved_incidences>0,"SameRange=false was accepted");
        builder.SameRange(edge,true);builder.SameParameter(edge,false);
        require(inspect_curve_surface_quality(altered).unresolved_incidences>0,"SameParameter=false was accepted");
        changed=true;break;
      }
    }
    require(changed,"Cylinder fixture had no seam edge");
  }
  gp_Trsf move;move.SetTranslation(gp_Vec(1,2,3));
  const auto moved=BRepBuilderAPI_Transform(cylinder,move,true).Shape();
  require(geometry3d_identity(moved)!=source_geometry,"3D identity missed a geometry change");
  BRepBuilderAPI_Copy vertex_copy(cylinder,true,false);const auto vertex_changed=vertex_copy.Shape();
  TopExp_Explorer vertices(vertex_changed,TopAbs_VERTEX);require(vertices.More(),"Cylinder has no vertex");
  const auto vertex=TopoDS::Vertex(vertices.Current());BRep_Builder builder;
  builder.UpdateVertex(vertex,BRep_Tool::Pnt(vertex).Translated(gp_Vec(1,0,0)),BRep_Tool::Tolerance(vertex));
  require(geometry3d_identity(vertex_changed)!=source_geometry,"3D identity missed a vertex-only change");
  require(write_brep(cylinder)==source_bytes,"Quality/identity diagnostics mutated source");
}
void operand_nonmutation_check() {
  const auto first=BRepPrimAPI_MakeCylinder(5,10).Shape();
  const auto second=BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(1,0,0),gp_Dir(0,0,1)),5,10).Shape();
  TopTools_ListOfShape args,tools,operands;
  args.Append(first);tools.Append(second);operands.Append(first);operands.Append(second);
  BRepAlgoAPI_Fuse fuse;fuse.SetArguments(args);fuse.SetTools(tools);fuse.SetNonDestructive(true);fuse.Build();
  require(fuse.IsDone()&&!fuse.HasErrors(),"Operand immutability fixture failed");
  const auto first_bytes=write_brep(first),second_bytes=write_brep(second);
  const bool first_free=first.Free(),second_free=second.Free();
  const auto repaired=restore_boolean_cylindrical_pcurves(fuse,operands);
  require(BRepCheck_Analyzer(repaired.shape).IsValid(),"Private-copy pcurve result invalid");
  require(first.Free()==first_free&&second.Free()==second_free,"Pcurve helper changed operand topology flags");
  require(write_brep(first)==first_bytes&&write_brep(second)==second_bytes,"Pcurve helper changed an operand");
}
void drilled_case(const TopoDS_Shape& fixture,const gp_Trsf& transform,
                  const std::string& label,int sign) {
  const auto target=BRepBuilderAPI_Transform(fixture,transform,true).Shape();
  const auto bytes=write_brep(target),identity=geometry3d_identity(target);
  require_quality(inspect_curve_surface_quality(target),label+" source");
  const auto direction=gp_Vec(0,0,sign*20).Transformed(transform);
  const auto result=directional_shadow(target,direction);
  require(BRepCheck_Analyzer(result).IsValid(),label+": invalid B-Rep result");
  diagnose_vertices(result,label);
  require_quality(inspect_curve_surface_quality(result),label+" shadow");
  BOPAlgo_ArgumentAnalyzer self_intersection;
  self_intersection.SetShape1(result);self_intersection.SelfInterMode()=true;self_intersection.Perform();
  require(!self_intersection.HasFaulty(),label+": result self-intersects");
  require(std::abs(volume(result)-750*std::acos(-1.))<=1e-6,label+": analytic shadow volume mismatch");
  require(write_brep(target)==bytes,label+": shadow construction mutated source B-Rep");
  require(geometry3d_identity(target)==identity,label+": shadow construction changed source geometry");
  std::cout<<label<<" sign "<<sign<<" passed\n";
}
}
int main() {
  seam_and_identity_checks();
  operand_nonmutation_check();
  const auto cylinder=BRepPrimAPI_MakeCylinder(5,10).Shape();
  const auto drill=BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(-12,0,5),gp_Dir(1,0,0)),1,24).Shape();
  BRepAlgoAPI_Cut cut(cylinder,drill);require(cut.IsDone(),"Drilled fixture construction failed");
  const auto fixture=cut.Shape();
  for(const std::string mode:{"axial","rotated","oblique","translated"}) {
    gp_Trsf transform;
    if(mode=="rotated")transform.SetRotation(gp_Ax1(gp_Pnt(0,0,0),gp_Dir(0,1,0)),std::acos(-1.)/2);
    if(mode=="oblique"||mode=="translated")transform.SetRotation(gp_Ax1(gp_Pnt(0,0,0),gp_Dir(1,1,0)),.7);
    if(mode=="translated")transform.SetTranslationPart(gp_Vec(13,-7,29));
    for(int sign:{1,-1})drilled_case(fixture,transform,mode,sign);
  }
}
