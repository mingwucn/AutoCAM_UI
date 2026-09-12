#pragma once
#include "material.hpp"
#include <memory>
#include <optional>
#include <string>

namespace autocam::brep {
enum class Process { milling, turning };
struct Action {
  Process process = Process::milling;
  gp_Dir direction = gp_Dir(0,0,-1);
  double reach_mm = 1;
  TurningOperation turning_operation = TurningOperation::outside;
};
struct Setup {
  gp_Ax1 axis;
  double stock_radius_mm = 1;
  int held_side = -1;
  double volume_tolerance_mm3 = 1e-6;
};
struct Preview {
  std::uint64_t token;
  std::uint64_t revision;
  double removed_mm3;
  double remaining_mm3;
};
struct Snapshot {
  std::string engine = "shadow-brep-1";
  std::string target, stock, holding, remaining;
  Setup setup;
  std::uint64_t revision = 0;
};
std::string encode_snapshot(const Snapshot& snapshot);
Snapshot decode_snapshot(const std::string& bytes);
class Session {
 public:
  Session(const TopoDS_Shape& target, const TopoDS_Shape& stock,
          const TopoDS_Shape& holding, const Setup& setup);
  Preview preview(const Action& action);
  void apply(std::uint64_t token, std::uint64_t expected_revision);
  void cancel_preview();
  void reset();
  Snapshot snapshot() const;
  static std::unique_ptr<Session> restore(const Snapshot& snapshot);
  const TopoDS_Shape& remaining() const { return material_->shape(); }
  const TopoDS_Shape& target() const { return target_; }
  const TopoDS_Shape& stock() const { return stock_; }
  const TopoDS_Shape& holding() const { return holding_; }
  const Setup& setup() const { return setup_; }
  const TopoDS_Shape& preview_removed(std::uint64_t token) const;
  std::uint64_t revision() const { return material_->revision(); }
  double initial_excess_mm3() const { return volume(stock_)-volume(protected_); }
 private:
  TopoDS_Shape target_,stock_,holding_,protected_,envelope_;
  Setup setup_;
  std::unique_ptr<Material> material_;
  std::optional<Transition> pending_;
  std::uint64_t token_ = 0;
};
}
