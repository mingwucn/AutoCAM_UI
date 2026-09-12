// Include the implementation to exercise its private interval algebra without
// adding numerical test hooks to the public native/WASM environment API.
#include "../envelope.cpp"
#include <TColgp_Array1OfPnt.hxx>
#include <TColStd_Array1OfReal.hxx>
#include <TColStd_Array1OfInteger.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepBuilderAPI_NurbsConvert.hxx>
#include <GeomConvert.hxx>
#include <iostream>
using namespace autocam::brep;
void require(bool condition,const char* message){if(!condition)throw std::runtime_error(message);}
Handle(Geom_BezierCurve) bezier(const std::vector<double>& z,const std::vector<double>& weights={}) {
 TColgp_Array1OfPnt points(1,int(z.size()));TColStd_Array1OfReal w(1,int(z.size()));
 for(int i=1;i<=int(z.size());++i){points(i)=gp_Pnt(2,0,z[i-1]);w(i)=weights.empty()?1:weights[i-1];}
 return new Geom_BezierCurve(points,w);
}
std::vector<double> cubic(double c0,double c1,double c2,double c3) {
 return {c0,c0+c1/3,c0+2*c1/3+c2/3,c0+c1+c2+c3};
}
CurveSpans spans(const Handle(Geom_BezierCurve)& curve,double tolerance=1e-7) {
 std::size_t omitted=0;return bezier_station_spans(curve,gp_Dir(0,0,1),0,1,0,1,tolerance,omitted);
}
int main() {
 try {
  const auto rational=bezier({0,1,0},{1,4,1});const auto rational_spans=spans(rational);
  require(rational_spans.size()==2,"Rational quadratic requires two monotone spans");
  require(rational_spans[0].first==0&&rational_spans[1].last==1,"Rational endpoints lost");
  require(rational_spans[0].last<=.5&&rational_spans[1].first>=.5,"Rational root not isolated");
  require(rational_spans[0].sign==1&&rational_spans[1].sign==-1,"Rational signs wrong");
  require(.8-rational->Value(rational_spans[0].last).Z()<=1e-7,"Rational omitted band exceeds axial tolerance");
  const auto rational_spline=GeomConvert::CurveToBSplineCurve(rational);
  std::size_t rational_omitted=0;
  const auto original_derivatives=homogeneous_derivatives(rational_spline,gp_Dir(0,0,1));
  const auto original_arc=spline_arc_polynomials(original_derivatives,0,1);
  const std::array<double,4> exact_gradient{.5,1./6.,-1./6.,-.5};
  for(std::size_t i=0;i<exact_gradient.size();++i)
    require(original_arc.gradient[i].lo<=exact_gradient[i]&&original_arc.gradient[i].hi>=exact_gradient[i],"Original-spline conversion lost exact rational derivative");
  const auto rational_bspline_spans=bspline_station_spans(rational_spline,gp_Dir(0,0,1),0,1,1e-7,rational_omitted);
  require(rational_bspline_spans.size()==2&&rational_bspline_spans[0].last<=.5&&rational_bspline_spans[1].first>=.5,"Original rational B-spline root not isolated");
  const double a=.3;
  const auto repeated=spans(bezier(cubic(-a*a*a,3*a*a,-3*a,1)));
  require(repeated.size()==2&&repeated[0].last<=a&&repeated[1].first>=a,"Repeated derivative root lost");
  require(repeated[0].sign==1&&repeated[1].sign==1,"Repeated-root signs wrong");
  for(double gap:{.01,.0001}) {
   const auto close=spans(bezier(cubic(0,a*a-gap*gap,-a,1./3)));
   require(!close.empty(),"Close-extrema curve entirely lost");
   for(const auto& span:close)require(!(span.first<a-gap&&span.last>a+gap),"Close extrema falsely certified as monotone");
   if(gap==.01)require(close.size()==3&&close[1].sign==-1,"Resolved close-root decreasing span lost");
  }
  const auto endpoint=spans(bezier({0,0,1}));
  require(endpoint.size()==1&&endpoint.front().last==1,"Endpoint root lost complete span");
  require(endpoint.front().first*endpoint.front().first<=1e-7,"Endpoint omitted band exceeds tolerance");
  require(spans(bezier({5,5,5},{1,4,2})).empty(),"Constant station manufactured volume");
  std::size_t omitted=0;bool rejected=false;
  try{bezier_station_spans(rational,gp_Dir(0,0,1),0,1,-.1,1,1e-7,omitted);}catch(const std::runtime_error&){rejected=true;}
  require(rejected,"Out-of-domain Bezier was not rejected");
  for(double tolerance:{0.,-1.,std::numeric_limits<double>::infinity(),std::numeric_limits<double>::quiet_NaN()}) {
   rejected=false;
   try{bspline_station_spans(rational_spline,gp_Dir(0,0,1),0,1,tolerance,omitted);}catch(const std::runtime_error&){rejected=true;}
   require(rejected,"Invalid B-spline tolerance was not rejected");
  }
  TColgp_Array1OfPnt points(1,4);for(int i=1;i<=4;++i)points(i)=gp_Pnt(2,0,i-1);
  TColStd_Array1OfReal knots(1,3);knots(1)=0;knots(2)=.4;knots(3)=1;
  TColStd_Array1OfInteger multiplicities(1,3);multiplicities(1)=3;multiplicities(2)=1;multiplicities(3)=3;
  Handle(Geom_BSplineCurve) spline=new Geom_BSplineCurve(points,knots,multiplicities,2);
  const double trim=.4+1e-10;
  const auto clipped=bspline_station_spans(spline,gp_Dir(0,0,1),trim,.9,1e-7,omitted);
  require(!clipped.empty()&&clipped.front().first==trim&&clipped.back().last==.9,"Near-knot trim snapped or lost");
  TColStd_Array1OfReal unclamped_knots(1,7);
  TColStd_Array1OfInteger unclamped_multiplicities(1,7);
  const std::array<double,7> unclamped_values{-2,-1,0,.4,1,2,3};
  for(int i=1;i<=7;++i){unclamped_knots(i)=unclamped_values[i-1];unclamped_multiplicities(i)=1;}
  Handle(Geom_BSplineCurve) unclamped=new Geom_BSplineCurve(points,unclamped_knots,unclamped_multiplicities,2);
  const auto unclamped_spans=bspline_station_spans(unclamped,gp_Dir(0,0,1),0,1,1e-7,omitted);
  require(unclamped_spans.size()==1&&unclamped_spans[0].first==0&&unclamped_spans[0].last==1,
    "Unclamped active domain was lost or equal-sign knot spans were not joined");
  rejected=false;
  try{bspline_station_spans(unclamped,gp_Dir(0,0,1),-.1,1,1e-7,omitted);}catch(const std::runtime_error&){rejected=true;}
  require(rejected,"Inactive B-spline support was accepted as edge domain");
  TColgp_Array1OfPnt c0_points(1,5);for(int i=1;i<=5;++i)c0_points(i)=gp_Pnt(2,0,i<=3?i-1:5-i);
  multiplicities(2)=2;
  Handle(Geom_BSplineCurve) c0_curve=new Geom_BSplineCurve(c0_points,knots,multiplicities,2);
  const auto c0_spans=bspline_station_spans(c0_curve,gp_Dir(0,0,1),0,1,1e-7,omitted);
  require(c0_spans.size()==2&&c0_spans[0].last==.4&&c0_spans[1].first==.4,"C0 knot extremum lost");
  require(c0_spans[0].sign==1&&c0_spans[1].sign==-1,"C0 derivative side selection wrong");
  const auto reversed=bspline_station_spans(c0_curve,gp_Dir(0,0,-1),0,1,1e-7,omitted);
  require(reversed.size()==2&&reversed[0].sign==-1&&reversed[1].sign==1,"Spindle reversal lost knot extrema");
  auto rotated=Handle(Geom_BezierCurve)::DownCast(rational->Copy());
  gp_Trsf transform;transform.SetRotation(gp_Ax1(gp_Pnt(),gp_Dir(1,2,3)),.713);rotated->Transform(transform);
  gp_Dir direction(0,0,1);direction.Transform(transform);
  transform.SetTranslation(gp_Vec(10000,-30000,7000));rotated->Transform(transform);
  const auto transformed=bezier_station_spans(rotated,direction,0,1,0,1,1e-7,omitted);
  require(transformed.size()==2&&transformed[0].last<=.5&&transformed[1].first>=.5,"Axis transform lost rational extremum");
  // This half cone opens away from the spindle. Its radial maximum lies on
  // the two trimmed generator boundaries, not on a face-interior meridian.
  // NURBS conversion removes analytic-face/line fallbacks, so its necessary
  // boundary really exercises the B-spline path above.
  const gp_Ax2 cone_axis(gp_Pnt(.2,0,0),gp_Dir(0,0,1),gp_Dir(0,1,0));
  const auto half_cone=BRepPrimAPI_MakeCone(cone_axis,5.,3.,4.,std::acos(-1.)).Shape();
  const auto nurbs_cone=BRepBuilderAPI_NurbsConvert(half_cone,true).Shape();
  const auto cone_envelope=radial_envelope(nurbs_cone,gp_Ax1(gp_Pnt(),gp_Dir(0,0,1)));
  const double expected=std::acos(-1.)*((25.+15.+9.)*4./3.+.2*.2*4.);
  require(std::abs(volume(cone_envelope)-expected)<1e-5,"B-spline trimmed-cone envelope volume mismatch");
  std::cout<<"Spline extrema tests passed\n";
 }catch(const std::exception& error){std::cerr<<error.what()<<"\n";return 1;}
}
