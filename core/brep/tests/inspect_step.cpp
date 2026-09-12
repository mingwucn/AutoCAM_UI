// Native geometry diagnostic. Input STEP bytes are never rewritten.
// Usage: brep_inspect_step STEP [candidate.brep ox oy oz dx dy dz]
// A dumped candidate is UNVERIFIED diagnostic geometry, never material state.
#include "io.hpp"
#include "material.hpp"
#include "envelope.hpp"
#include "setup.hpp"
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBndLib.hxx>
#include <Bnd_Box.hxx>
#include <BRepClass3d_SolidClassifier.hxx>
#include <BOPAlgo_ArgumentAnalyzer.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <fstream>
#include <iostream>
#include <iterator>
int main(int argc,char** argv) {
  if(argc!=2 && argc!=9)return 2;
  try {
    std::ifstream input(argv[1],std::ios::binary);
    const auto target=autocam::brep::read_step(std::string(std::istreambuf_iterator<char>(input),{}));
    std::cout.precision(12);
    BOPAlgo_ArgumentAnalyzer check;check.SetShape1(target);check.SelfInterMode()=true;check.Perform();
    std::cout<<"source_boolean_faults";for(const auto& fault:check.GetCheckResult())std::cout<<" "<<fault.GetCheckStatus();std::cout<<"\n";
    if(argc>2) {
      const gp_Ax1 axis(gp_Pnt(std::stod(argv[3]),std::stod(argv[4]),std::stod(argv[5])),
                        gp_Dir(std::stod(argv[6]),std::stod(argv[7]),std::stod(argv[8])));
      const auto prepared=autocam::brep::prepare_stock(target,axis,5,5,-1);
      const auto protected_shape=BRepAlgoAPI_Fuse(target,prepared.holding).Shape();
      autocam::brep::EnvelopeDiagnostics diagnostic;
      try{autocam::brep::radial_envelope(protected_shape,axis,1e-7,&diagnostic);}
      catch(const std::exception& error){std::cout<<"envelope_error "<<error.what()<<"\n";}
      if(!diagnostic.candidate.IsNull()) {
        std::ofstream output(argv[2],std::ios::binary);output<<autocam::brep::write_brep(diagnostic.candidate);
        std::cout<<"candidate_volume "<<autocam::brep::volume(diagnostic.candidate)<<" omitted "<<diagnostic.omitted_contributions<<"\n";
        for(TopExp_Explorer solids(diagnostic.candidate,TopAbs_SOLID);solids.More();solids.Next()) {
          Bnd_Box b;BRepBndLib::AddOptimal(solids.Current(),b,false,false);const auto lo=b.CornerMin(),hi=b.CornerMax();
          std::cout<<"solid "<<autocam::brep::volume(solids.Current())<<" bounds "<<lo.X()<<","<<lo.Y()<<","<<lo.Z()<<" "<<hi.X()<<","<<hi.Y()<<","<<hi.Z()<<"\n";
          BRepClass3d_SolidClassifier classify(solids.Current());classify.PerformInfinitePoint(1e-7);std::cout<<"infinite_state "<<classify.State();
          for(double x:{-2.,5.,15.,16.,20.}){classify.Perform(gp_Pnt(x,0,0),1e-7);std::cout<<" x"<<x<<":"<<classify.State();}std::cout<<"\n";
          for(const auto& subject:{target,prepared.holding}) {
            try {const auto common=BRepAlgoAPI_Common(subject,solids.Current()).Shape();std::cout<<"component_overlap "<<autocam::brep::volume(common)<<"\n";}
            catch(const std::exception& error){std::cout<<"component_overlap_error "<<error.what()<<"\n";}
          }
        }
      }
      return 0;
    }
    int index=0;
    for(TopExp_Explorer faces(target,TopAbs_FACE);faces.More();faces.Next()) {
      const auto face=TopoDS::Face(faces.Current());BRepAdaptor_Surface s(face,true);
      GProp_GProps area;BRepGProp::SurfaceProperties(face,area);
      std::cout<<"face "<<++index<<" type "<<s.GetType()<<" orientation "<<face.Orientation()<<" area "<<area.Mass();
      gp_Ax1 axis;bool has_axis=true;
      switch(s.GetType()) {
        case GeomAbs_Cylinder: axis=s.Cylinder().Axis();std::cout<<" radius "<<s.Cylinder().Radius();break;
        case GeomAbs_Cone: axis=s.Cone().Axis();std::cout<<" radius "<<s.Cone().RefRadius()<<" angle "<<s.Cone().SemiAngle();break;
        case GeomAbs_Torus: axis=s.Torus().Axis();std::cout<<" radii "<<s.Torus().MajorRadius()<<","<<s.Torus().MinorRadius();break;
        default:has_axis=false;
      }
      if(has_axis){const auto p=axis.Location();const auto d=axis.Direction();std::cout<<" origin "<<p.X()<<","<<p.Y()<<","<<p.Z()<<" direction "<<d.X()<<","<<d.Y()<<","<<d.Z();}
      std::cout<<" edges";for(TopExp_Explorer edges(face,TopAbs_EDGE);edges.More();edges.Next())std::cout<<" "<<BRepAdaptor_Curve(TopoDS::Edge(edges.Current())).GetType();
      std::cout<<"\n";
    }
  }catch(const std::exception& error){std::cerr<<error.what()<<"\n";return 1;}
}
