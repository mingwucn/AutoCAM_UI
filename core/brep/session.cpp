#include "session.hpp"
#include "io.hpp"
#include "envelope.hpp"
#include "checked_boolean.hpp"
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <TopTools_ListOfShape.hxx>
#include <cmath>
#include <stdexcept>

namespace autocam::brep {
Session::Session(const TopoDS_Shape& target,const TopoDS_Shape& stock,
                 const TopoDS_Shape& holding,const Setup& setup)
    :target_(target),stock_(stock),holding_(holding),setup_(setup) {
  const auto p=setup.axis.Location();
  if (!std::isfinite(p.X()) || !std::isfinite(p.Y()) || !std::isfinite(p.Z()) ||
      !std::isfinite(setup.stock_radius_mm) || setup.stock_radius_mm<=0 ||
      (setup.held_side!=-1 && setup.held_side!=1)) throw std::invalid_argument("Invalid spindle setup");
  if (volume(target_)<=0 || volume(stock_)<=0)
    throw std::invalid_argument("Target and stock must have positive volume");
  protected_=volume(holding_)==0 ? target_ : checked_boolean<BRepAlgoAPI_Fuse>(target_,holding_);
  material_=std::make_unique<Material>(stock_,protected_,setup_.volume_tolerance_mm3);
}
Preview Session::preview(const Action& action) {
  pending_.reset();
  TopoDS_Shape region;
  if (action.process==Process::milling) {
    region=milling_region(stock_,protected_,action.direction,action.reach_mm);
  } else if (action.process==Process::turning) {
    try {if (envelope_.IsNull()) envelope_=radial_envelope(protected_,setup_.axis);}
    catch (const std::runtime_error& error) {throw std::runtime_error(std::string("Turning envelope: ")+error.what());}
    try {region=turning_region(stock_,envelope_,setup_.axis,setup_.stock_radius_mm,
                          action.turning_operation,action.reach_mm,setup_.held_side);}
    catch (const std::runtime_error& error) {throw std::runtime_error(std::string("Turning reach: ")+error.what());}
  } else { throw std::invalid_argument("Unknown process"); }
  Transition candidate;
  try {candidate=material_->preview(region);}
  catch (const std::runtime_error& error) {throw std::runtime_error(std::string("Material transition: ")+error.what());}
  pending_=candidate;
  ++token_;
  return {token_,revision(),candidate.removed_mm3,candidate.after_mm3};
}
void Session::apply(std::uint64_t token,std::uint64_t expected_revision) {
  if (!pending_ || token!=token_ || expected_revision!=revision())
    throw std::runtime_error("Preview token or material revision is stale");
  material_->commit(*pending_);
  pending_.reset();
}
const TopoDS_Shape& Session::preview_removed(std::uint64_t token) const {
  if (!pending_ || token!=token_) throw std::runtime_error("Preview token is stale");
  return pending_->removed;
}
void Session::cancel_preview() { pending_.reset(); }
void Session::reset() {
  auto replacement=std::make_unique<Material>(stock_,protected_,setup_.volume_tolerance_mm3,revision()+1);
  material_=std::move(replacement);
  pending_.reset();
}
Snapshot Session::snapshot() const {
  return {"shadow-brep-1",write_brep(target_),write_brep(stock_),write_brep(holding_),
          write_brep(remaining()),setup_,revision()};
}
std::unique_ptr<Session> Session::restore(const Snapshot& saved) {
  if (saved.engine!="shadow-brep-1") throw std::invalid_argument("Snapshot engine version is unsupported");
  auto restored=std::make_unique<Session>(read_brep(saved.target),read_brep(saved.stock),
                                        read_brep(saved.holding),saved.setup);
  const auto remaining=read_brep(saved.remaining);
  if (volume(checked_boolean<BRepAlgoAPI_Cut>(remaining,restored->stock_))>saved.setup.volume_tolerance_mm3)
    throw std::invalid_argument("Snapshot contains material outside original stock");
  restored->material_=std::make_unique<Material>(remaining,restored->protected_,
                                                saved.setup.volume_tolerance_mm3,saved.revision);
  return restored;
}
}
