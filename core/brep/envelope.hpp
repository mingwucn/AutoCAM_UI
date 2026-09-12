#pragma once
#include <TopoDS_Shape.hxx>
#include <gp_Ax1.hxx>

namespace autocam::brep {
struct EnvelopeDiagnostics {
  // May be incomplete or invalid as an envelope. Never use as material state.
  TopoDS_Shape candidate;
  std::size_t omitted_contributions=0;
};
// Continuous radial closure of boundary curves, certified by target containment.
// Insufficient curve coverage fails explicitly; there is no sampled hull.
TopoDS_Shape radial_envelope(const TopoDS_Shape& target, const gp_Ax1& axis,
                            double linear_tolerance_mm = 1e-7,
                            EnvelopeDiagnostics* diagnostics = nullptr);
}
