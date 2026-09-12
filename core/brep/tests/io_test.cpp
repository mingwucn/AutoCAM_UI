#include "io.hpp"
#include "material.hpp"
#include <Standard_Failure.hxx>
#include <fstream>
#include <iostream>
#include <iterator>
#include <cmath>
#include <stdexcept>

int main() {
  using namespace autocam::brep;
  try {
    for (const auto* name : {"box.step","overhang.step","stepped-shaft.step"}) {
      std::ifstream file(std::string(SG_FIXTURES)+"/"+name,std::ios::binary);
      if (!file) throw std::runtime_error("Missing STEP fixture");
      std::string bytes((std::istreambuf_iterator<char>(file)),{});
      auto shape=read_step(bytes);
      auto snapshot=write_brep(shape);
      auto restored=read_brep(snapshot);
      const double before=volume(shape),after=volume(restored);
      if (std::abs(before-after)>1e-7*std::max(1.0,before))
        throw std::runtime_error("Snapshot changed material volume");
      std::cout << name << " volume_mm3=" << before << " snapshot_bytes=" << snapshot.size() << '\n';
    }
    bool rejected=false;
    try { read_step("not STEP"); } catch (...) { rejected=true; }
    if (!rejected) throw std::runtime_error("Invalid STEP was accepted");
    rejected=false;
    try { read_brep("not BREP"); } catch (...) { rejected=true; }
    if (!rejected) throw std::runtime_error("Invalid B-Rep was accepted");
    return 0;
  } catch (const Standard_Failure& e) {
    std::cerr << e.GetMessageString() << '\n';return 1;
  } catch (const std::exception& e) {
    std::cerr << e.what() << '\n';return 1;
  }
}
