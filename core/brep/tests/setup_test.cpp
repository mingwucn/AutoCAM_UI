#include "setup.hpp"
#include "io.hpp"
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeTorus.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRep_Builder.hxx>
#include <TopoDS_Compound.hxx>
#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>

using namespace autocam::brep;
void require(bool condition,const char* message){if(!condition)throw std::runtime_error(message);}
void origin_is(const TopoDS_Shape& shape,int index,const gp_Pnt& expected) {
  const auto axis=principal_axis(shape,index);
  require(axis.Location().Distance(expected)<1e-12,"Unexpected spindle origin");
  require(axis.Direction().Coord(index+1)==1,"Principal direction was changed");
}
TopoDS_Shape compound(std::initializer_list<TopoDS_Shape> shapes) {
  BRep_Builder builder;TopoDS_Compound result;builder.MakeCompound(result);
  for(const auto& shape:shapes)builder.Add(result,shape);return result;
}
void require_close(double actual,double expected,const char* message) {
  if(std::abs(actual-expected)>1e-6)throw std::runtime_error(std::string(message)+
    ": actual="+std::to_string(actual)+", expected="+std::to_string(expected));
}
template<class F> void rejects(F run,const char* message) {
  bool failed=false;try{run();}catch(const std::exception&){failed=true;}
  require(failed,message);
}
void stock_recipes() {
  StockRecipe box;box.kind=StockRecipe::Kind::box;box.origin_mm={0,0,0};box.size_mm={40,30,30};
  const auto target=BRepPrimAPI_MakeBox(gp_Pnt(10,5,10),20,20,10).Shape();
  const auto original=write_brep(target);const gp_Ax1 axis(gp_Pnt(20,15,0),gp_Dir(0,0,1));
  auto prepared=prepare_stock(target,axis,99,0,-1,&box);
  require_close(volume(prepared.stock),36000,"Explicit box must ignore allowance");
  require_close(volume(prepared.holding),0,"Zero holding must be empty");
  require_close(prepared.setup.stock_radius_mm,25,"Box corner stock radius");
  for(int side:{-1,1}) {
    const auto end=prepare_stock(target,axis,0,5,side,&box);
    require_close(volume(end.holding),6000,"Box holding volume");
    GProp_GProps props;BRepGProp::VolumeProperties(end.holding,props);
    require_close(props.CentreOfMass().Z(),side<0?2.5:27.5,"Box held end");
  }
  require_close(volume(prepare_stock(target,axis,0,30,1,&box).holding),36000,"Full holding is the stock");
  require(write_brep(target)==original,"Explicit stock preparation mutated source target");

  StockRecipe cube=box;cube.origin_mm={-1,-1,-1};cube.size_mm={2,2,2};
  const auto small=BRepPrimAPI_MakeBox(gp_Pnt(-.25,-.25,-.25),.5,.5,.5).Shape();
  const auto small_original=write_brep(small);
  const gp_Ax1 diagonal(gp_Pnt(0,0,0),gp_Dir(1,1,1));
  for(int side:{-1,1}) {
    const auto end=prepare_stock(small,diagonal,0,std::sqrt(3.)/2,side,&cube);
    require_close(volume(end.holding),std::pow(1.5,3)/6,"Oblique box holding must be clipped tetrahedron");
  }
  require(write_brep(small)==small_original,"Oblique holding preparation mutated target");

  StockRecipe cylinder;cylinder.kind=StockRecipe::Kind::cylinder;
  cylinder.radius_mm=5;cylinder.station_min_mm=-2;cylinder.station_max_mm=8;
  for(const auto& direction:{gp_Dir(0,0,1),gp_Dir(0,-1,0),gp_Dir(1,1,1)}) {
    const gp_Ax1 spindle(gp_Pnt(7,8,9),direction);
    const auto part=BRepPrimAPI_MakeCylinder(gp_Ax2(spindle.Location(),direction),1,2).Shape();
    const auto before=write_brep(part);
    for(int side:{-1,1}) {
      const auto end=prepare_stock(part,spindle,100,2,side,&cylinder);
      require_close(volume(end.stock),250*M_PI,"Explicit cylinder volume");
      require_close(volume(end.holding),50*M_PI,"Cylinder holding volume");
      GProp_GProps props;BRepGProp::VolumeProperties(end.holding,props);
      require_close(gp_Vec(spindle.Location(),props.CentreOfMass()).Dot(gp_Vec(direction)),side<0?-1:7,"Cylinder held station");
    }
    require(write_brep(part)==before,"Cylinder preparation mutated target");
  }
  auto invalid=box;invalid.size_mm[0]=0;
  rejects([&]{prepare_stock(target,axis,0,0,-1,&invalid);},"Zero box dimension accepted");
  invalid=box;invalid.origin_mm[1]=std::numeric_limits<double>::quiet_NaN();
  rejects([&]{prepare_stock(target,axis,0,0,-1,&invalid);},"Nonfinite box origin accepted");
  invalid=box;invalid.origin_mm[0]=invalid.size_mm[0]=std::numeric_limits<double>::max();
  rejects([&]{prepare_stock(target,axis,0,0,-1,&invalid);},"Overflowing box bound accepted");
  invalid=cylinder;invalid.radius_mm=-1;
  rejects([&]{prepare_stock(target,axis,0,0,-1,&invalid);},"Negative radius accepted");
  invalid=cylinder;invalid.station_max_mm=invalid.station_min_mm;
  rejects([&]{prepare_stock(target,axis,0,0,-1,&invalid);},"Empty cylinder span accepted");
  rejects([&]{prepare_stock(target,axis,0,31,-1,&box);},"Overlong holding accepted");
  const auto outside=BRepPrimAPI_MakeBox(gp_Pnt(50,0,0),2,2,2).Shape();
  const auto outside_original=write_brep(outside);
  rejects([&]{prepare_stock(outside,axis,0,0,-1,&box);},"Stock outside target accepted");
  require(write_brep(outside)==outside_original,"Rejected preparation mutated target");
}
int main() {
  try {
    for(int index=0;index<3;++index) {
      const gp_Dir direction(index==0?1:0,index==1?1:0,index==2?1:0);
      const gp_Pnt source_origin(2,3,4);auto expected=source_origin;expected.SetCoord(index+1,0);
      origin_is(BRepPrimAPI_MakeCylinder(gp_Ax2(source_origin,direction),2,10).Shape(),index,expected);
      origin_is(BRepPrimAPI_MakeCylinder(gp_Ax2(source_origin,direction.Reversed()),2,10).Shape(),index,expected);
      origin_is(BRepPrimAPI_MakeCone(gp_Ax2(source_origin,direction),3,1,10).Shape(),index,expected);
      origin_is(BRepPrimAPI_MakeTorus(gp_Ax2(source_origin,direction),3,1).Shape(),index,expected);
    }
    const auto box=BRepPrimAPI_MakeBox(gp_Pnt(-5,-5,-5),10,10,10).Shape();
    origin_is(box,2,gp_Pnt(0,0,0));
    const auto offset_hole=BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(.0005,0,-6),gp_Dir(0,0,1)),1,12).Shape();
    origin_is(BRepAlgoAPI_Cut(box,offset_hole).Shape(),2,gp_Pnt(0,0,0));
    const auto left=BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(-8e-8,0,-3),gp_Dir(0,0,1)),1,2).Shape();
    const auto right=BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(8e-8,0,1),gp_Dir(0,0,1)),1,2).Shape();
    origin_is(compound({left,right}),2,gp_Pnt(0,0,0));
    const auto small=BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(-2e-8,0,-3),gp_Dir(0,0,1)),1,2).Shape();
    const auto large=BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(2e-8,0,1),gp_Dir(0,0,1)),2,2).Shape();
    const auto bounding_box=BRepPrimAPI_MakeBox(gp_Pnt(-5,-5,8),10,10,2).Shape();
    origin_is(compound({small,large,bounding_box}),2,gp_Pnt(2e-8,0,0));
    stock_recipes();
    std::cout<<"Principal spindle inference and explicit stock recipes: volume, held ends, oblique clipping, containment, invalid input and source preservation passed\n";
    return 0;
  }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}
