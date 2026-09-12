#pragma once
#include <TopoDS_Shape.hxx>
#include <gp_Vec.hxx>
#include <gp_Dir.hxx>
#include <gp_Ax1.hxx>
#include <cstdint>

namespace autocam::brep {
double volume(const TopoDS_Shape& shape);
// Union of the protected solid and the volumes swept by its boundary faces.
// The finite sweep must extend beyond the stock in the engagement direction.
TopoDS_Shape directional_shadow(const TopoDS_Shape& protected_shape,
                                const gp_Vec& sweep);
TopoDS_Shape milling_region(const TopoDS_Shape& initial_stock,
                           const TopoDS_Shape& protected_shape,
                           const gp_Dir& engagement, double reach_mm);
enum class TurningOperation { outside, face_positive, face_negative };
// The envelope is a separately prepared, verified filled radial envelope.
// An arbitrary target solid is not a valid substitute for this argument.
TopoDS_Shape turning_region(const TopoDS_Shape& initial_stock,
                           const TopoDS_Shape& radial_envelope,
                           const gp_Ax1& axis, double original_radius_mm,
                           TurningOperation operation, double reach_mm,
                           int held_side);

struct Transition {
  TopoDS_Shape remaining;
  TopoDS_Shape removed;
  double before_mm3;
  double after_mm3;
  double removed_mm3;
  std::uint64_t source_revision;
};

class Material {
 public:
  Material(const TopoDS_Shape& stock, const TopoDS_Shape& protected_shape,
           double volume_tolerance_mm3, std::uint64_t initial_revision = 0);
  Transition preview(const TopoDS_Shape& removal_region) const;
  void commit(const Transition& candidate);
  const TopoDS_Shape& shape() const { return remaining_; }
  std::uint64_t revision() const { return revision_; }
 private:
  TopoDS_Shape remaining_, protected_;
  double tolerance_;
  std::uint64_t revision_ = 0;
};
}
