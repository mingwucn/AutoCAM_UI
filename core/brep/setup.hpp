#pragma once
#include "session.hpp"
#include <array>

namespace autocam::brep {
struct PreparedStock {
  TopoDS_Shape stock,holding;
  Setup setup;
};
struct StockRecipe {
  enum class Kind { box=1, cylinder=2 };
  Kind kind=Kind::box;
  std::array<double,3> origin_mm{},size_mm{};
  double radius_mm=0,station_min_mm=0,station_max_mm=0;
};
gp_Ax1 principal_axis(const TopoDS_Shape& target, int axis_index);
PreparedStock prepare_stock(const TopoDS_Shape& target,const gp_Ax1& axis,
                             double allowance_mm,double holding_length_mm,int held_side,
                             const StockRecipe* recipe=nullptr);
}
