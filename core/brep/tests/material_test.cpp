#include "material.hpp"
#include "presentation.hpp"
#include "envelope.hpp"
#include "io.hpp"
#include "checked_boolean.hpp"
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeTorus.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRep_Builder.hxx>
#include <TopoDS_Compound.hxx>
#include <BOPAlgo_ArgumentAnalyzer.hxx>
#include <BRep_Tool.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <gp_Pnt.hxx>
#include <cmath>
#include <stdexcept>
#include <iostream>

void assert_volume(double actual, double expected) {
  if (std::abs(actual - expected) > 1e-6) throw std::runtime_error("Volume mismatch: actual "+std::to_string(actual)+", expected "+std::to_string(expected));
}
int main() {
  using namespace autocam::brep;
  auto stock = BRepPrimAPI_MakeBox(10, 10, 10).Shape();
  auto target = BRepPrimAPI_MakeBox(gp_Pnt(2, 2, 2), 6, 6, 6).Shape();
  Material state(stock, target, 1e-6);
  auto candidate = state.preview(stock);
  assert_volume(candidate.removed_mm3, 784);
  assert_volume(volume(state.shape()), 1000); // Preview is non-mutating.
  state.commit(candidate);
  assert_volume(volume(state.shape()), 216);
  bool rejected = false;
  try { state.commit(candidate); } catch (const std::runtime_error&) { rejected = true; }
  if (!rejected) throw std::runtime_error("Stale transition accepted");
  assert_volume(volume(state.shape()), 216);
  assert_volume(state.preview(stock).removed_mm3, 0);
  // A material operand may contain disjoint solids. Supply its solid leaves
  // to OCCT and preserve a valid empty result through subsequent operations.
  BRep_Builder builder;TopoDS_Compound compound;builder.MakeCompound(compound);
  builder.Add(compound,BRepPrimAPI_MakeBox(2,2,2).Shape());
  builder.Add(compound,BRepPrimAPI_MakeBox(gp_Pnt(5,0,0),2,2,2).Shape());
  assert_volume(volume(checked_boolean<BRepAlgoAPI_Common>(compound,stock)),16);
  const auto empty=checked_boolean<BRepAlgoAPI_Cut>(compound,stock);
  assert_volume(volume(empty),0);
  assert_volume(volume(checked_boolean<BRepAlgoAPI_Fuse>(empty,compound)),16);
  auto inward_solid=BRepPrimAPI_MakeBox(2,2,2).Shape();inward_solid.Reverse();
  if(valid_boolean_material(inward_solid))throw std::runtime_error("Negative-volume solid accepted as valid Boolean material");
  std::cout << "box directional shadows" << std::endl;
  auto shadow = directional_shadow(target, gp_Vec(0, 0, 20));
  assert_volume(volume(shadow), 6 * 6 * 26);
  auto opposite = directional_shadow(target, gp_Vec(0, 0, -20));
  assert_volume(volume(opposite), 6 * 6 * 26);
  assert_volume(volume(milling_region(stock, target, gp_Dir(0,0,1), 1)), 100);
  assert_volume(volume(milling_region(stock, target, gp_Dir(0,0,1), 5)), 392);
  assert_volume(volume(milling_region(stock, target, gp_Dir(0,0,1), 20)), 712);
  assert_volume(volume(milling_region(stock, target, gp_Dir(0,0,-1), 20)), 712);
  const auto coarse = tessellate(state.shape(), 1.0);
  const auto fine = tessellate(state.shape(), 0.01);
  if (coarse.positions.empty() || fine.normals.size() != fine.positions.size())
    throw std::runtime_error("Missing mesh data");
  assert_volume(volume(state.shape()), 216);
  auto paths = section(state.shape(), gp_Pln(gp_Pnt(0,0,5), gp_Dir(0,0,1)), 0.1);
  if (paths.size() != 4) throw std::runtime_error("Box section must have four edges");
  for (const auto& path : paths)
    for (std::size_t i=2; i<path.size(); i+=3) assert_volume(path[i], 5);
  const auto round_stock = BRepPrimAPI_MakeCylinder(10,10).Shape();
  std::cout << "turning reach" << std::endl;
  const auto round_target = BRepPrimAPI_MakeCylinder(5,10).Shape();
  const gp_Ax1 axis(gp_Pnt(0,0,0),gp_Dir(0,0,1));
  const double pi = std::acos(-1.0);
  assert_volume(volume(turning_region(round_stock,round_target,axis,10,
      TurningOperation::outside,2,-1)), 360*pi);
  assert_volume(volume(turning_region(round_stock,round_target,axis,10,
      TurningOperation::outside,20,-1)), 750*pi);
  rejected = false;
  try { turning_region(round_stock,round_target,axis,10,
      TurningOperation::face_positive,2,-1); }
  catch (const std::invalid_argument&) { rejected = true; }
  if (!rejected) throw std::runtime_error("Held-end facing accepted");
  std::cout << "radial envelopes" << std::endl;
  assert_volume(volume(radial_envelope(round_target,axis)), 250*pi);
  const gp_Ax1 center_axis(gp_Pnt(5,5,0),gp_Dir(0,0,1));
  assert_volume(volume(radial_envelope(target,center_axis)), 108*pi);
  std::cout << "cylinder axial shadow" << std::endl;
  assert_volume(volume(directional_shadow(round_target,gp_Vec(0,0,20))), 750*pi);
  std::cout << "cylinder transverse shadow" << std::endl;
  assert_volume(volume(directional_shadow(round_target,gp_Vec(20,0,0))), 250*pi+2000);
  std::cout << "sphere shadow" << std::endl;
  auto sphere=BRepPrimAPI_MakeSphere(3).Shape();
  assert_volume(volume(directional_shadow(sphere,gp_Vec(8,6,0))), 36*pi+90*pi);
  std::cout << "toroidal directional shadows" << std::endl;
  const auto torus=BRepPrimAPI_MakeTorus(5,1).Shape();
  std::cout << "torus axial" << std::endl;
  assert_volume(volume(directional_shadow(torus,gp_Vec(0,0,10))),10*pi*pi+200*pi);
  // For translation longer than the ring's inner gap, every projected ray
  // becomes one interval. Integrate the outer radial envelope plus L*footprint.
  std::cout << "torus transverse" << std::endl;
  auto check_torus=[&](const TopoDS_Shape& original,const gp_Vec& direction) {
    const auto before=write_brep(original);
    const auto result=directional_shadow(original,direction);
    assert_volume(volume(result),400+(214.0/3)*pi+5*pi*pi);
    BOPAlgo_ArgumentAnalyzer check;check.SetShape1(result);check.SelfInterMode()=true;check.Perform();
    if(check.HasFaulty())throw std::runtime_error("Torus shadow has self-intersecting tangent artifacts");
    for(TopExp_Explorer vertex(result,TopAbs_VERTEX);vertex.More();vertex.Next())
      if(BRep_Tool::Tolerance(TopoDS::Vertex(vertex.Current()))>1.1e-7)
        throw std::runtime_error("Torus shadow inflated vertex tolerance");
    if(write_brep(original)!=before)throw std::runtime_error("Torus regularization mutated the target");
  };
  check_torus(torus,gp_Vec(20,0,0));check_torus(torus,gp_Vec(-20,0,0));
  gp_Trsf torus_rotation;torus_rotation.SetRotation(gp_Ax1(gp_Pnt(0,0,0),gp_Dir(1,1,0)),.7);
  check_torus(BRepBuilderAPI_Transform(torus,torus_rotation,true).Shape(),gp_Vec(20,0,0).Transformed(torus_rotation));
  std::cout << "stepped shaft envelope" << std::endl;
  auto shaft_a=BRepPrimAPI_MakeCylinder(8,4).Shape();
  auto shaft_b=BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0,0,4),gp_Dir(0,0,1)),5,6).Shape();
  auto shaft=BRepAlgoAPI_Fuse(shaft_a,shaft_b).Shape();
  assert_volume(volume(radial_envelope(shaft,axis)), 406*pi);
  std::cout << "off-axis hole envelope" << std::endl;
  const auto drill=BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(-12,0,5),gp_Dir(1,0,0)),1,24).Shape();
  const auto drilled=BRepAlgoAPI_Cut(round_target,drill).Shape();
  const auto drilled_bytes=write_brep(drilled);
  assert_volume(volume(radial_envelope(drilled,axis)),250*pi);
  assert_volume(volume(directional_shadow(drilled,gp_Vec(0,0,20))),750*pi);
  assert_volume(volume(directional_shadow(drilled,gp_Vec(0,0,-20))),750*pi);
  if(write_brep(drilled)!=drilled_bytes)throw std::runtime_error("Sweep mutated original target");
  gp_Trsf rotate;rotate.SetRotation(gp_Ax1(gp_Pnt(0,0,0),gp_Dir(0,1,0)),pi/2);
  const auto rotated_drilled=BRepBuilderAPI_Transform(drilled,rotate,true).Shape();
  assert_volume(volume(directional_shadow(rotated_drilled,gp_Vec(20,0,0))),750*pi);
  assert_volume(volume(directional_shadow(rotated_drilled,gp_Vec(-20,0,0))),750*pi);
  gp_Trsf oblique;oblique.SetRotation(gp_Ax1(gp_Pnt(0,0,0),gp_Dir(1,1,0)),.7);
  const auto oblique_drilled=BRepBuilderAPI_Transform(drilled,oblique,true).Shape();
  const auto oblique_sweep=gp_Vec(0,0,20).Transformed(oblique);
  assert_volume(volume(directional_shadow(oblique_drilled,oblique_sweep)),750*pi);
  assert_volume(volume(directional_shadow(oblique_drilled,-oblique_sweep)),750*pi);
  assert_volume(volume(radial_envelope(rotated_drilled,gp_Ax1(gp_Pnt(0,0,0),gp_Dir(1,0,0)))),250*pi);
  assert_volume(volume(radial_envelope(rotated_drilled,gp_Ax1(gp_Pnt(0,0,0),gp_Dir(-1,0,0)))),250*pi);
  std::cout << "offset cylinder with inward seam" << std::endl;
  const auto offset_cylinder=BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(3,0,0),gp_Dir(0,0,1),gp_Dir(-1,0,0)),2,4).Shape();
  assert_volume(volume(radial_envelope(offset_cylinder,axis)),100*pi);
  std::cout << "offset sphere interior meridian" << std::endl;
  const auto offset_sphere=BRepPrimAPI_MakeSphere(gp_Pnt(3,0,0),2).Shape();
  assert_volume(volume(radial_envelope(offset_sphere,axis)),(140.0/3)*pi+12*pi*pi);
  std::cout << "shared turning and milling stock" << std::endl;
  auto shared_stock=BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(5,5,0),gp_Dir(0,0,1)),6,10).Shape();
  Material shared(shared_stock,target,1e-5);
  auto envelope=radial_envelope(target,center_axis);
  shared.commit(shared.preview(turning_region(shared_stock,envelope,center_axis,6,
      TurningOperation::outside,10,-1)));
  assert_volume(volume(shared.shape()),108*pi);
  auto mill=shared.preview(milling_region(shared_stock,target,gp_Dir(1,0,0),20));
  if (!(mill.removed_mm3>0)) throw std::runtime_error("Milling did not remove rotational excess");
  shared.commit(mill);
  if (volume(shared.shape()) < 216-1e-6 || shared.revision()!=2)
    throw std::runtime_error("Mixed process state did not preserve target or revision");
}

