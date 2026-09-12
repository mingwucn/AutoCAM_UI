#include "envelope.hpp"
#include "material.hpp"
#include "checked_boolean.hpp"
#include <BOPAlgo_ArgumentAnalyzer.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <BRep_Tool.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Section.hxx>
#include <BRepLib.hxx>
#include <BRep_Builder.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <gp_Lin.hxx>
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <vector>
#include <sstream>
#include <Standard_Failure.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <Geom_BezierCurve.hxx>
#include <Geom_BSplineCurve.hxx>
#include <array>
#include <cstdint>
#include <limits>

namespace autocam::brep {
namespace {
// Outward-rounded intervals keep an uncertain derivative coefficient from
// being silently interpreted as zero. No sampled derivative/root is used.
struct Bounds {double lo=0,hi=0;};
Bounds number(double x) {
  if(!std::isfinite(x))throw std::runtime_error("Nonfinite spline coefficient");
  return {x,x};
}
Bounds outward(double lo,double hi) {
  if(!std::isfinite(lo)||!std::isfinite(hi))throw std::runtime_error("Spline interval overflow");
  return {std::nextafter(lo,-std::numeric_limits<double>::infinity()),
          std::nextafter(hi,std::numeric_limits<double>::infinity())};
}
bool zero(const Bounds& x){return x.lo==0&&x.hi==0;}
Bounds add(Bounds a,Bounds b) {
  if(zero(a))return b;if(zero(b))return a;
  return outward(a.lo+b.lo,a.hi+b.hi);
}
Bounds subtract(Bounds a,Bounds b) {
  if(zero(b))return a;
  if(a.lo==a.hi&&b.lo==b.hi&&a.lo==b.lo)return number(0);
  return outward(a.lo-b.hi,a.hi-b.lo);
}
Bounds multiply(Bounds a,Bounds b) {
  if(zero(a)||zero(b))return number(0);
  const std::array<double,4> p{a.lo*b.lo,a.lo*b.hi,a.hi*b.lo,a.hi*b.hi};
  return outward(*std::min_element(p.begin(),p.end()),*std::max_element(p.begin(),p.end()));
}
Bounds divide(Bounds a,Bounds b) {
  if(!(b.lo>0))throw std::runtime_error("Spline weight interval is not positive");
  if(zero(a))return number(0);
  if(a.lo==a.hi&&b.lo==b.hi&&a.lo==b.lo)return number(1);
  const std::array<double,4> p{a.lo/b.lo,a.lo/b.hi,a.hi/b.lo,a.hi/b.hi};
  return outward(*std::min_element(p.begin(),p.end()),*std::max_element(p.begin(),p.end()));
}
using Bernstein=std::vector<Bounds>;
std::pair<Bernstein,Bernstein> subdivide(Bernstein work,Bounds parameter) {
  parameter.lo=std::max(0.,parameter.lo);parameter.hi=std::min(1.,parameter.hi);
  if(parameter.lo>parameter.hi)throw std::runtime_error("Invalid spline subdivision parameter");
  const auto complement=subtract(number(1),parameter);
  Bernstein left(work.size()),right(work.size());
  left.front()=work.front();right.back()=work.back();
  for(std::size_t level=1;level<work.size();++level) {
    for(std::size_t i=0;i<work.size()-level;++i)
      work[i]=add(multiply(complement,work[i]),multiply(parameter,work[i+1]));
    left[level]=work[0];right[work.size()-1-level]=work[work.size()-1-level];
  }
  return {left,right};
}
Bernstein derivative(const Bernstein& a) {
  Bernstein result(a.size()-1);const auto degree=number(double(result.size()));
  for(std::size_t i=0;i<result.size();++i)result[i]=multiply(degree,subtract(a[i+1],a[i]));
  return result;
}
std::uint64_t binomial(unsigned n,unsigned k) {
  // Degrees are limited to OCCT's maximum Bezier degree 25, hence n<=49.
  // These integer coefficients and their products fit exactly in binary64.
  std::uint64_t value=1;k=std::min(k,n-k);
  for(unsigned i=1;i<=k;++i)value=value*(n-k+i)/i;
  return value;
}
Bernstein product(const Bernstein& a,const Bernstein& b) {
  const unsigned m=unsigned(a.size()-1),n=unsigned(b.size()-1);
  Bernstein result(m+n+1);
  for(unsigned i=0;i<=m;++i)for(unsigned j=0;j<=n;++j) {
    const auto scale=divide(number(double(binomial(m,i)*binomial(n,j))),number(double(binomial(m+n,i+j))));
    result[i+j]=add(result[i+j],multiply(scale,multiply(a[i],b[j])));
  }
  return result;
}
struct StationPolynomials {Bernstein numerator,weight,gradient;};
StationPolynomials with_station_gradient(Bernstein numerator,Bernstein weight) {
  StationPolynomials p{std::move(numerator),std::move(weight),{}};
  const auto first=product(derivative(p.numerator),p.weight);
  const auto second=product(p.numerator,derivative(p.weight));
  for(std::size_t i=0;i<first.size();++i)p.gradient.push_back(subtract(first[i],second[i]));
  return p;
}
StationPolynomials station_polynomials(const Handle(Geom_BezierCurve)& curve,const gp_Dir& axis) {
  const auto degree=curve->Degree();
  if(degree<1||degree>25)throw std::runtime_error("Unsupported Bezier degree");
  const auto origin=curve->Pole(1);
  double max_weight=0;
  for(int i=1;i<=curve->NbPoles();++i)max_weight=std::max(max_weight,curve->Weight(i));
  if(!(max_weight>0)||!std::isfinite(max_weight))throw std::runtime_error("Invalid Bezier weights");
  StationPolynomials p;
  for(int i=1;i<=curve->NbPoles();++i) {
    if(!(curve->Weight(i)>0))throw std::runtime_error("Bezier weights must be positive");
    const auto weight=divide(number(curve->Weight(i)),number(max_weight));
    Bounds station;
    for(int coordinate=1;coordinate<=3;++coordinate)
      station=add(station,multiply(subtract(number(curve->Pole(i).Coord(coordinate)),number(origin.Coord(coordinate))),number(axis.Coord(coordinate))));
    p.numerator.push_back(multiply(weight,station));p.weight.push_back(weight);
  }
  return with_station_gradient(std::move(p.numerator),std::move(p.weight));
}
struct HomogeneousSpline {
  Bernstein numerator,weight;
  std::vector<double> knots;
  unsigned degree;
};
Bounds evaluate_spline(const Bernstein& coefficients,const std::vector<double>& knots,
                       unsigned degree,double parameter) {
  const auto upper=std::upper_bound(knots.begin(),knots.end(),parameter);
  const std::size_t span=std::min<std::size_t>(std::size_t(upper-knots.begin()-1),coefficients.size()-1);
  if(span<degree)throw std::runtime_error("Spline evaluation is outside its support");
  Bernstein work;
  for(unsigned j=0;j<=degree;++j)work.push_back(coefficients[span-degree+j]);
  for(unsigned level=1;level<=degree;++level)for(unsigned j=degree;j>=level;--j) {
    const auto i=span-degree+j;
    auto alpha=divide(subtract(number(parameter),number(knots[i])),
                      subtract(number(knots[i+degree-level+1]),number(knots[i])));
    // The active B-spline support proves the exact ratio lies in [0,1].
    alpha.lo=std::max(0.,alpha.lo);alpha.hi=std::min(1.,alpha.hi);
    if(alpha.lo>alpha.hi)throw std::runtime_error("Invalid de Boor support ratio");
    work[j]=add(multiply(subtract(number(1),alpha),work[j-1]),multiply(alpha,work[j]));
  }
  return work[degree];
}
std::vector<HomogeneousSpline> homogeneous_derivatives(const Handle(Geom_BSplineCurve)& curve,const gp_Dir& axis) {
  if(curve->IsPeriodic())throw std::runtime_error("Periodic spline station conversion requires explicit pole unrolling");
  if(curve->Degree()<1||curve->Degree()>25)throw std::runtime_error("Unsupported B-spline degree");
  HomogeneousSpline initial;initial.degree=unsigned(curve->Degree());
  const auto origin=curve->Pole(1);double max_weight=0;
  for(int i=1;i<=curve->NbPoles();++i)max_weight=std::max(max_weight,curve->Weight(i));
  for(int i=1;i<=curve->NbPoles();++i) {
    if(!(curve->Weight(i)>0))throw std::runtime_error("B-spline weights must be positive");
    const auto weight=divide(number(curve->Weight(i)),number(max_weight));Bounds station;
    for(int c=1;c<=3;++c)
      station=add(station,multiply(subtract(number(curve->Pole(i).Coord(c)),number(origin.Coord(c))),number(axis.Coord(c))));
    initial.numerator.push_back(multiply(weight,station));initial.weight.push_back(weight);
  }
  const auto& sequence=curve->KnotSequence();
  for(int i=sequence.Lower();i<=sequence.Upper();++i)initial.knots.push_back(sequence(i));
  if(initial.knots.size()!=initial.numerator.size()+initial.degree+1)
    throw std::runtime_error("Unexpected B-spline knot sequence");
  std::vector<HomogeneousSpline> result{initial};
  while(result.back().degree) {
    const auto& prior=result.back();HomogeneousSpline next;
    next.degree=prior.degree-1;next.knots.assign(prior.knots.begin()+1,prior.knots.end()-1);
    for(std::size_t i=0;i+1<prior.numerator.size();++i) {
      // Repeated knots can create an inactive derivative basis. Its zero-span
      // coefficient contributes nothing to either adjacent open knot interval.
      if(prior.knots[i+prior.degree+1]==prior.knots[i+1]) {
        next.numerator.push_back(number(0));next.weight.push_back(number(0));continue;
      }
      const auto factor=divide(number(double(prior.degree)),subtract(number(prior.knots[i+prior.degree+1]),number(prior.knots[i+1])));
      next.numerator.push_back(multiply(factor,subtract(prior.numerator[i+1],prior.numerator[i])));
      next.weight.push_back(multiply(factor,subtract(prior.weight[i+1],prior.weight[i])));
    }
    result.push_back(std::move(next));
  }
  return result;
}
StationPolynomials spline_arc_polynomials(const std::vector<HomogeneousSpline>& derivatives,double first,double last) {
  // Derive interval Bezier coefficients from the ORIGINAL homogeneous spline.
  // This encloses the conversion arithmetic itself instead of starting with
  // OCCT's already-rounded converted poles and certifying a different curve.
  const unsigned degree=derivatives.front().degree;Bernstein n_derivatives,w_derivatives;
  Bounds factor=number(1);const auto width=subtract(number(last),number(first));
  for(unsigned k=0;k<=degree;++k) {
    const auto& spline=derivatives[k];
    if(k)factor=divide(multiply(factor,width),number(double(degree-k+1)));
    n_derivatives.push_back(multiply(factor,evaluate_spline(spline.numerator,spline.knots,spline.degree,first)));
    w_derivatives.push_back(multiply(factor,evaluate_spline(spline.weight,spline.knots,spline.degree,first)));
  }
  Bernstein n(degree+1),w(degree+1);
  for(unsigned i=0;i<=degree;++i)for(unsigned k=0;k<=i;++k) {
    const auto choose=number(double(binomial(i,k)));
    n[i]=add(n[i],multiply(choose,n_derivatives[k]));w[i]=add(w[i],multiply(choose,w_derivatives[k]));
  }
  return with_station_gradient(std::move(n),std::move(w));
}
double station_diameter(const StationPolynomials& p) {
  double lo=std::numeric_limits<double>::infinity(),hi=-lo;
  for(std::size_t i=0;i<p.weight.size();++i) {
    const auto z=divide(p.numerator[i],p.weight[i]);lo=std::min(lo,z.lo);hi=std::max(hi,z.hi);
  }
  return subtract(number(hi),number(lo)).hi;
}
struct CurveSpan {double first,last;int sign;};
using CurveSpans=std::vector<CurveSpan>;
std::pair<StationPolynomials,StationPolynomials> subdivide(const StationPolynomials& p,Bounds t) {
  const auto n=subdivide(p.numerator,t),w=subdivide(p.weight,t),g=subdivide(p.gradient,t);
  return {{n.first,w.first,g.first},{n.second,w.second,g.second}};
}
Bounds fraction(double value,double first,double last) {
  return divide(subtract(number(value),number(first)),subtract(number(last),number(first)));
}
void isolate_station_spans(const StationPolynomials& p,double first,double last,double tolerance,
                           CurveSpans& result,std::size_t& nodes,std::size_t& omitted,unsigned depth=0) {
  if(++nodes>100000)throw std::runtime_error("Spline station isolation exceeded its work limit");
  if(std::all_of(p.gradient.begin(),p.gradient.end(),[](Bounds x){return zero(x);})) {++omitted;return;}
  const bool positive=std::all_of(p.gradient.begin(),p.gradient.end(),[](Bounds x){return x.lo>=0;});
  const bool negative=std::all_of(p.gradient.begin(),p.gradient.end(),[](Bounds x){return x.hi<=0;});
  if(positive||negative) {
    const int sign=positive?1:-1;
    if(!result.empty()&&result.back().last==first&&result.back().sign==sign)result.back().last=last;
    else result.push_back({first,last,sign});
    return;
  }
  if(station_diameter(p)<=tolerance){++omitted;return;}
  const double middle=first+(last-first)*0.5;
  if(depth>=80||middle<=first||middle>=last)throw std::runtime_error("Unresolved spline station extrema");
  const auto halves=subdivide(p,fraction(middle,first,last));
  isolate_station_spans(halves.first,first,middle,tolerance,result,nodes,omitted,depth+1);
  isolate_station_spans(halves.second,middle,last,tolerance,result,nodes,omitted,depth+1);
}
CurveSpans bezier_station_spans(const Handle(Geom_BezierCurve)& curve,const gp_Dir& axis,
                               double knot_first,double knot_last,double first,double last,
                               double tolerance,std::size_t& omitted) {
  if(!std::isfinite(knot_first)||!std::isfinite(knot_last)||!std::isfinite(first)||!std::isfinite(last)
      ||!(knot_last>knot_first)||first<knot_first||last>knot_last||!(last>first)
      ||!std::isfinite(tolerance)||!(tolerance>0))throw std::runtime_error("Invalid Bezier trim domain");
  auto p=station_polynomials(curve,axis);
  if(first>knot_first)p=subdivide(p,fraction(first,knot_first,knot_last)).second;
  if(last<knot_last)p=subdivide(p,fraction(last,first,knot_last)).first;
  CurveSpans result;std::size_t nodes=0;
  isolate_station_spans(p,first,last,tolerance,result,nodes,omitted);
  return result;
}
CurveSpans bspline_station_spans(const Handle(Geom_BSplineCurve)& curve,const gp_Dir& axis,
                                double first,double last,double tolerance,std::size_t& omitted) {
  if(!std::isfinite(first)||!std::isfinite(last)||!(last>first)
      ||!std::isfinite(tolerance)||!(tolerance>0))throw std::runtime_error("Invalid spline edge domain");
  const auto derivatives=homogeneous_derivatives(curve,axis);
  const auto& basis=derivatives.front();
  for(int i=2;i<curve->NbKnots();++i)
    if(curve->Multiplicity(i)>curve->Degree())throw std::runtime_error("Discontinuous spline station domain");
  // Partition directly at the original distinct knots in the active basis
  // domain. This also handles unclamped endpoints without a converter's
  // knot insertion, endpoint snapping or rounded replacement poles.
  std::vector<double> knots;
  for(std::size_t i=basis.degree;i<=basis.numerator.size();++i)
    if(knots.empty()||basis.knots[i]!=knots.back())knots.push_back(basis.knots[i]);
  if(knots.size()<2||knots.size()>10001)throw std::runtime_error("Unsupported spline arc count");
  if(first<knots.front()||last>knots.back())throw std::runtime_error("Spline edge lies outside its basis domain");
  CurveSpans result;double covered=first;std::size_t nodes=0;
  for(std::size_t i=0;i+1<knots.size();++i) {
    const double lo=std::max(first,knots[i]),hi=std::min(last,knots[i+1]);
    if(!(hi>lo))continue;
    if(lo!=covered)throw std::runtime_error("Spline partition did not cover the edge domain");
    auto polynomials=spline_arc_polynomials(derivatives,knots[i],knots[i+1]);
    if(lo>knots[i])polynomials=subdivide(polynomials,fraction(lo,knots[i],knots[i+1])).second;
    if(hi<knots[i+1])polynomials=subdivide(polynomials,fraction(hi,lo,knots[i+1])).first;
    CurveSpans spans;isolate_station_spans(polynomials,lo,hi,tolerance,spans,nodes,omitted);
    for(const auto& span:spans) {
      // The original B-spline is C0 across every interior knot. Adjacent
      // intervals with equal certified signs form one monotone interval;
      // retain sign-changing extrema and all omitted parameter gaps.
      if(!result.empty()&&result.back().last==span.first&&result.back().sign==span.sign)
        result.back().last=span.last;
      else result.push_back(span);
    }
    covered=hi;
  }
  if(covered!=last)throw std::runtime_error("Spline partition lost the edge endpoint");
  return result;
}
void require_simple_boundary(const TopoDS_Shape& shape) {
  BOPAlgo_ArgumentAnalyzer check;
  check.SetShape1(shape);check.SelfInterMode()=true;check.Perform();
  if(check.HasFaulty())throw std::runtime_error("Revolved boundary self-intersects");
}
void append_meridians(const TopoDS_Shape& target,const gp_Ax1& axis,
                       double tolerance,TopTools_IndexedMapOfShape& edges) {
  const gp_Vec d(axis.Direction());
  for (TopExp_Explorer faces(target,TopAbs_FACE);faces.More();faces.Next()) {
    const auto face=TopoDS::Face(faces.Current());
    BRepAdaptor_Surface surface(face,true);
    gp_Pnt center;gp_Dir primitive_direction=axis.Direction();
    switch (surface.GetType()) {
      case GeomAbs_Cylinder: center=surface.Cylinder().Location();primitive_direction=surface.Cylinder().Axis().Direction();break;
      case GeomAbs_Cone: center=surface.Cone().Location();primitive_direction=surface.Cone().Axis().Direction();break;
      case GeomAbs_Torus: center=surface.Torus().Location();primitive_direction=surface.Torus().Axis().Direction();break;
      case GeomAbs_Sphere: center=surface.Sphere().Location();break;
      default: continue;
    }
    if (!primitive_direction.IsParallel(axis.Direction(),1e-10)) continue;
    const gp_Vec offset(axis.Location(),center);
    auto radial=offset-d*offset.Dot(d);
    const bool centered=radial.Magnitude()<=tolerance;
    if (centered) {
      radial=gp_Vec(gp_Ax2(axis.Location(),axis.Direction()).XDirection());
    }
    for (int meridian=0;meridian<(centered?2:1);++meridian) {
      const gp_Pln plane(axis.Location(),gp_Dir(d.Crossed(radial)));
      BRepAlgoAPI_Section cut(face,plane,false);
      cut.SetNonDestructive(true);cut.Build();
      if (cut.IsDone() && !cut.HasErrors()) {
        // Section the trimmed face, not its infinite supporting surface. These
        // interior meridians are genuine target points, just like boundary edges.
        TopExp::MapShapes(cut.Shape(),TopAbs_EDGE,edges);
      }
      radial=d.Crossed(radial);
    }
  }
}
TopoDS_Shape edge_volume(const Handle(Geom_Curve)& source, double first, double last,
                        const gp_Ax1& axis, double tolerance) {
  // Revolution is invariant under rotation about its axis. Use a common
  // meridian for the profile midpoint to avoid equivalent surfaces carrying
  // unrelated angular parameter frames in subsequent Boolean operations.
  const gp_Vec d(axis.Direction()),reference(gp_Ax2(axis.Location(),axis.Direction()).XDirection());
  const gp_Vec middle(axis.Location(),source->Value((first+last)/2));
  const auto radial=middle-d*middle.Dot(d);
  Handle(Geom_Curve) curve=source;
  if (radial.Magnitude()>tolerance) {
    gp_Trsf rotation;rotation.SetRotation(axis,std::atan2(d.Dot(radial.Crossed(reference)),radial.Dot(reference)));
    curve=Handle(Geom_Curve)::DownCast(source->Transformed(rotation));
  }
  auto edge = BRepBuilderAPI_MakeEdge(curve,first,last).Edge();
  BRepPrimAPI_MakeRevol revolution(edge,axis,true);
  const auto wall = revolution.Shape();
  BRepBuilderAPI_Sewing sewing(tolerance);
  sewing.Add(wall);
  // Reuse the actual generated circular edges, including their seam vertices.
  // Independent circles at the same radius can have different angular seams;
  // sewing those caps can introduce tiny edges and self-intersections.
  for (TopExp_Explorer vertices(edge,TopAbs_VERTEX);vertices.More();vertices.Next()) {
    for (const auto& generated:revolution.Generated(vertices.Current())) {
      if(generated.ShapeType()!=TopAbs_EDGE)continue;
      const auto circle=TopoDS::Edge(generated);
      if(BRep_Tool::Degenerated(circle))continue;
      sewing.Add(BRepBuilderAPI_MakeFace(BRepBuilderAPI_MakeWire(circle).Wire(),true).Face());
    }
  }
  sewing.Perform();
  const auto sewn = sewing.SewedShape();
  if (sewn.ShapeType() != TopAbs_SHELL)
    throw std::runtime_error("Revolved profile did not form a shell");
  auto solid = BRepBuilderAPI_MakeSolid(TopoDS::Shell(sewn)).Solid();
  if (!BRepLib::OrientClosedSolid(solid))
    throw std::runtime_error("Revolved profile is not closed");
  volume(solid); // Reject invalid topology and negative/infinite volume.
  require_simple_boundary(solid);
  return solid;
}
}
TopoDS_Shape radial_envelope(const TopoDS_Shape& target, const gp_Ax1& axis,
                            double tolerance,EnvelopeDiagnostics* diagnostics) {
  if(diagnostics)*diagnostics={};
  if (!std::isfinite(tolerance) || tolerance <= 0)
    throw std::invalid_argument("Envelope tolerance must be finite and positive");
  volume(target);
  // Every contribution is the radial closure of a curve on the target. Their
  // union is therefore inside the target's radial envelope. If it also contains
  // the target (checked below), radial closure proves equality. Face families
  // alone cannot decide this: off-axis holes may have no effect on the envelope.
  TopTools_IndexedMapOfShape edges;
  TopExp::MapShapes(target,TopAbs_EDGE,edges);
  append_meridians(target,axis,tolerance,edges);
  struct Contribution {TopoDS_Shape shape;double volume;};
  std::vector<Contribution> contributions;
  std::size_t omitted=0;
  const gp_Vec d(axis.Direction());
  bool has_spline=false;
  const auto collect=[&](bool spline_only) {
  for (int i=1; i<=edges.Extent(); ++i) {
    auto edge = TopoDS::Edge(edges(i));
    if (BRep_Tool::Degenerated(edge)) continue;
    double first,last;
    auto curve = BRep_Tool::Curve(edge,first,last);
    if (curve.IsNull()) throw std::runtime_error("Envelope edge has no 3D curve");
    BRepAdaptor_Curve adaptor(edge);
    const bool is_spline=adaptor.GetType()==GeomAbs_BSplineCurve || adaptor.GetType()==GeomAbs_BezierCurve;
    has_spline=has_spline||is_spline;
    if(is_spline!=spline_only)continue;
    std::vector<double> cuts{first,last};
    CurveSpans spans;
    if (adaptor.GetType() == GeomAbs_Circle || adaptor.GetType() == GeomAbs_Ellipse) {
      gp_Ax2 frame;
      double r1,r2;
      if (adaptor.GetType() == GeomAbs_Circle) {
        auto circle=adaptor.Circle();frame=circle.Position();r1=r2=circle.Radius();
      } else {
        auto ellipse=adaptor.Ellipse();frame=ellipse.Position();r1=ellipse.MajorRadius();r2=ellipse.MinorRadius();
      }
      const double a=gp_Vec(frame.XDirection()).Dot(d)*r1;
      const double b=gp_Vec(frame.YDirection()).Dot(d)*r2;
      if (std::hypot(a,b) <= tolerance) continue;
      const double base=std::atan2(b,a), pi=std::acos(-1.0);
      for (int k=int(std::floor((first-base)/pi))-1; base+k*pi<last; ++k)
        if (base+k*pi>first) cuts.push_back(base+k*pi);
    } else if (adaptor.GetType() == GeomAbs_Line) {
      if (std::abs(gp_Vec(curve->Value(first),curve->Value(last)).Dot(d)) <= tolerance) continue;
    } else if (adaptor.GetType() == GeomAbs_BSplineCurve || adaptor.GetType()==GeomAbs_BezierCurve) {
      try {
        if(adaptor.GetType()==GeomAbs_BSplineCurve)
          spans=bspline_station_spans(adaptor.BSpline(),axis.Direction(),first,last,tolerance,omitted);
        else spans=bezier_station_spans(adaptor.Bezier(),axis.Direction(),0.,1.,first,last,tolerance,omitted);
      }catch(const std::runtime_error&){++omitted;continue;}
       catch(const Standard_Failure&){++omitted;continue;}
    } else {
      // Other curves can be redundant. They may be omitted only because the
      // final containment check rejects an insufficient envelope candidate.
      continue;
    }
    if(adaptor.GetType()!=GeomAbs_BSplineCurve && adaptor.GetType()!=GeomAbs_BezierCurve) {
      std::sort(cuts.begin(),cuts.end());
      for(std::size_t j=1;j<cuts.size();++j)spans.push_back({cuts[j-1],cuts[j],0});
    }
    for (const auto& span:spans) {
      try {
        auto part=edge_volume(curve,span.first,span.last,axis,tolerance);
        const auto amount=volume(part);
        if (amount>0) contributions.push_back({part,amount});
      } catch (const std::runtime_error&) {++omitted;}
        catch (const Standard_Failure&) {++omitted;}
    }
  }
  };
  const auto assemble=[&]() {
  TopoDS_Shape result;
  auto omitted_here=omitted;
  // Large contributions first avoid needless unions of identical/redundant
  // hole profiles. A failed contribution is omitted, never substituted by an
  // approximation. The final full-target containment check is still required.
  std::stable_sort(contributions.begin(),contributions.end(),
    [](const auto& a,const auto& b){return a.volume>b.volume;});
  for (const auto& contribution : contributions) {
    const auto& part=contribution.shape;
    if (result.IsNull()) {result=part;continue;}
    try {
      bool covered=false;
      try {covered=volume(checked_boolean<BRepAlgoAPI_Cut>(part,result))<=tolerance*tolerance*tolerance;}
      catch(const std::runtime_error&) {}
      if(covered)continue;
      const auto combined_shape=checked_boolean<BRepAlgoAPI_Fuse>(result,part);
      const double combined=volume(combined_shape),previous=volume(result);
      const double allowed=std::max(tolerance*tolerance*tolerance,(previous+contribution.volume)*1e-10);
      if (combined+allowed<std::max(previous,contribution.volume) || combined>previous+contribution.volume+allowed) {
        ++omitted_here;continue;
      }
      require_simple_boundary(combined_shape);
      result=combined_shape;
    } catch (const std::runtime_error&) {++omitted_here;}
      catch (const Standard_Failure&) {++omitted_here;}
  }
  if (result.IsNull()) throw std::runtime_error("No volumetric radial envelope was constructed");
  ShapeUpgrade_UnifySameDomain simplify(result,true,true,true);
  simplify.SetSafeInputMode(true);simplify.SetLinearTolerance(tolerance);simplify.Build();
  const double prior_volume=volume(result),simplified_volume=volume(simplify.Shape());
  if (std::abs(prior_volume-simplified_volume)<=std::max(tolerance*tolerance*tolerance,prior_volume*1e-10))
    result=simplify.Shape();
  if(diagnostics)*diagnostics={result,omitted_here};
  try {volume(result);}catch(const std::runtime_error& error){throw std::runtime_error(std::string("Envelope candidate: ")+error.what());}
  require_simple_boundary(result);
  GProp_GProps area;
  BRepGProp::SurfaceProperties(target,area);
  const double volume_tolerance = std::max(tolerance*tolerance*tolerance,tolerance*area.Mass());
  double missing=0;bool checked=false;
  try {missing=volume(checked_boolean<BRepAlgoAPI_Cut>(target,result));checked=true;}
  catch(const std::runtime_error&) {}
  if (!checked) {
    // A near-coincident cut can leave invalid zero-thickness debris. The
    // equivalent overlap test is accepted only with a valid volumetric result.
    missing=volume(target)-volume(checked_boolean<BRepAlgoAPI_Common>(target,result));
    if (missing < -volume_tolerance) throw std::runtime_error("Envelope overlap exceeds target volume");
  }
  if (missing > volume_tolerance) {
    std::ostringstream message;
    message << "Turning envelope requires additional surface silhouettes or curve extrema: "
      << missing << " mm3 outside candidate; tolerance " << volume_tolerance
      << " mm3 (omitted contributions: " << omitted_here << ")";
    throw std::runtime_error(message.str());
  }
  return result;
  };
  // Analytic contributions often already prove the complete radial closure.
  // Avoid constructing redundant hole/intersection spline solids in that case.
  // Both passes use the identical final validity and containment checks above.
  collect(false);
  try {return assemble();}
  catch(const std::runtime_error&) {if(!has_spline)throw;}
  catch(const Standard_Failure&) {if(!has_spline)throw;}
  collect(true);
  return assemble();
}
}
